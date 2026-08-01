# scripts/deploy-amplify-demo.ps1
#
# Manual deployment helper for the City Response Commander AWS Amplify
# smoke environment. Loads temporary credentials from scripts/load-aws-env.ps1,
# builds the React + Vite frontend, packages the dist/ output as a zip, and
# drives: list-apps -> create-app (if needed) -> list-branches -> create-branch
# (if needed) -> create-deployment -> upload zip -> start-deployment ->
# poll get-job -> verify live URL.
#
# SAFETY:
#   - Never prints credential values.
#   - Never prints the zipped presigned URL.
#   - Never writes credentials to a tracked file.
#   - Never uses `aws configure`, `setx`, or [Environment]::SetEnvironmentVariable
#     with a User/Machine target.
#   - Never re-implements env parsing. Always goes through
#     scripts/load-aws-env.ps1.

[CmdletBinding()]
param(
    [string]$EnvFile = ".env.aws.local",
    [string]$Region = "us-west-2",
    [string]$AppName = "city-response-commander-demo",
    [string]$BranchName = "demo",
    [int]$PollIntervalSeconds = 10,
    [int]$PollTimeoutSeconds = 600
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Resolve repository root regardless of where the script is invoked from.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
Set-Location -LiteralPath $RepoRoot

# --- Helpers ---------------------------------------------------------------
function Write-Block([string]$Message) {
    [Console]::Error.WriteLine($Message)
    exit 1
}

function Write-Status([string]$Message) {
    Write-Output $Message
}

function Sanitize-AwsError([string]$Text) {
    # Strip any line that looks like a credential or presigned URL.
    $patterns = @(
        'ASIA[0-9A-Z]{16}',
        'AKIA[0-9A-Z]{16}',
        'IQoJb3JpZ2lu[A-Za-z0-9+/=]+',
        'aws_session_token=[^;\s"]+',
        'x-amz-security-token=[^;\s"]+',
        'https://[^"\s]*amplify[^"\s]*\.amazonaws\.com[^"\s]*',
        'https://[^"\s]*s3[^"\s]*amazonaws\.com[^"\s]*'
    )
    $out = $Text
    foreach ($p in $patterns) {
        $out = [regex]::Replace($out, $p, "[REDACTED]")
    }
    return $out
}

function Invoke-AwsCli([string[]]$Arguments, [string]$Label) {
    $output = & aws @Arguments --no-cli-pager 2>&1
    $exit = $LASTEXITCODE
    if ($exit -ne 0) {
        $text = ($output | Out-String)
        $safe = Sanitize-AwsError $text
        if ($text -match "ExpiredToken") { Write-Block "BLOCKED_EXPIRED_AWS_SESSION at $Label." }
        elseif ($text -match "InvalidClientTokenId") { Write-Block "BLOCKED_INVALID_AWS_SESSION at $Label." }
        elseif ($text -match "UnrecognizedClientException") { Write-Block "BLOCKED_INVALID_AWS_SESSION at $Label." }
        elseif ($text -match "AccessDenied") { Write-Block "BLOCKED_AMPLIFY_PERMISSION at $Label.`n$safe" }
        elseif ($text -match "SignatureDoesNotMatch") { Write-Block "BLOCKED_INVALID_AWS_SESSION at $Label." }
        else { Write-Block "BLOCKED_AWS at $Label (exit $exit).`n$safe" }
    }
    return $output
}

# --- 1. Load credentials via the loader -------------------------------------
if (-not (Test-Path -LiteralPath $EnvFile)) {
    Write-Block "BLOCKED_AWS_ENV_FILE_MISSING: '$EnvFile' was not found. Copy .env.aws.example to .env.aws.local and fill in the values before running this script."
}

$loaderPath = Join-Path $ScriptDir "load-aws-env.ps1"
if (-not (Test-Path -LiteralPath $loaderPath)) {
    Write-Block "BLOCKED_SCRIPT: scripts/load-aws-env.ps1 is missing from the repository."
}

# Dot-source the loader with -SkipIdentityCheck so we own the STS verify
# ourselves in user-friendly output form.
. $loaderPath -EnvFile $EnvFile -SkipIdentityCheck

# --- 2. Verify presence/region of the loaded env vars -----------------------
$required = @("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_REGION")
foreach ($k in $required) {
    $value = [Environment]::GetEnvironmentVariable($k, "Process")
    if ([string]::IsNullOrWhiteSpace($value)) {
        Write-Block "BLOCKED_AWS_ENV_FILE_MISSING: $k is not loaded in the current process."
    }
}

if ($env:AWS_REGION -ne $Region) {
    Write-Block "BLOCKED_WRONG_AWS_REGION: AWS_REGION must be '$Region'."
}
if ($env:AWS_DEFAULT_REGION -and $env:AWS_DEFAULT_REGION -ne $Region) {
    Write-Block "BLOCKED_WRONG_AWS_REGION: AWS_DEFAULT_REGION must be '$Region'."
}

Write-Status "AWS credential environment loaded:"
Write-Status "- AWS_ACCESS_KEY_ID: LOADED"
Write-Status "- AWS_SECRET_ACCESS_KEY: LOADED"
Write-Status "- AWS_SESSION_TOKEN: LOADED"
Write-Status "- AWS_REGION: $env:AWS_REGION"
Write-Status "- AWS_DEFAULT_REGION: $env:AWS_DEFAULT_REGION"
Write-Status "- Credential values printed: NO"

# --- 3. AWS preflight: STS + list-apps -------------------------------------
$callerJson = Invoke-AwsCli @(
    "sts", "get-caller-identity",
    "--region", $Region,
    "--output", "json"
) "sts-get-caller-identity"

$caller = $callerJson | ConvertFrom-Json
Write-Status "AWS STS verified:"
Write-Status "- Account: $($caller.Account)"
Write-Status "- Principal ARN: $($caller.Arn)"
Write-Status "- Region: $Region"

$listAppsJson = Invoke-AwsCli @(
    "amplify", "list-apps",
    "--region", $Region,
    "--max-results", "100",
    "--output", "json"
) "amplify-list-apps"

$listApps = $listAppsJson | ConvertFrom-Json
$matches = @($listApps.apps | Where-Object { $_.name -eq $AppName })

if ($matches.Count -gt 1) {
    Write-Block "BLOCKED_DUPLICATE_AMPLIFY_APPS: more than one Amplify app named '$AppName' exists. Resolve manually before re-running."
}

$appId = $null
$appCreatedOrReused = ""
if ($matches.Count -eq 1) {
    $appId = $matches[0].appId
    $appCreatedOrReused = "REUSED"
    Write-Status "Amplify app REUSED: $AppName (appId=$appId)"
} else {
    Write-Status "Creating Amplify app: $AppName ..."
    $createdJson = Invoke-AwsCli @(
        "amplify", "create-app",
        "--name", $AppName,
        "--platform", "WEB",
        "--region", $Region,
        "--output", "json"
    ) "amplify-create-app"
    $created = $createdJson | ConvertFrom-Json
    $appId = $created.app.appId
    $appCreatedOrReused = "CREATED"
    Write-Status "Amplify app CREATED: $AppName (appId=$appId)"
}

# --- 4. Branch handling -----------------------------------------------------
$listBranchesJson = Invoke-AwsCli @(
    "amplify", "list-branches",
    "--app-id", $appId,
    "--region", $Region,
    "--output", "json"
) "amplify-list-branches"

$listBranches = $listBranchesJson | ConvertFrom-Json
$branchExists = $false
$branchObj = $null
foreach ($b in $listBranches.branches) {
    if ($b.branchName -eq $BranchName) {
        $branchExists = $true
        $branchObj = $b
        break
    }
}

$branchCreatedOrReused = ""
if ($branchExists) {
    $branchCreatedOrReused = "REUSED"
    Write-Status "Amplify branch REUSED: $BranchName"
} else {
    Write-Status "Creating Amplify branch: $BranchName ..."
    Invoke-AwsCli @(
        "amplify", "create-branch",
        "--app-id", $appId,
        "--branch-name", $BranchName,
        "--stage", "DEVELOPMENT",
        "--no-enable-auto-build",
        "--region", $Region,
        "--output", "json"
    ) "amplify-create-branch" | Out-Null
    $branchCreatedOrReused = "CREATED"
    Write-Status "Amplify branch CREATED: $BranchName"
}

# --- 5. Build ---------------------------------------------------------------
Write-Status "Building frontend ..."

$frontendDist = Join-Path $RepoRoot "packages/frontend/dist"
$zipDir = Join-Path $RepoRoot ".tmp/amplify-deploy"
$zipPath = Join-Path $zipDir "$AppName.zip"

try {
    # Only safe, build-time metadata. Never AWS credentials.
    $branchCurrent = (& git branch --show-current) | Out-String
    $commitShort = (& git rev-parse --short HEAD) | Out-String
    $buildTime = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

    $env:VITE_APP_BRANCH = $branchCurrent.Trim()
    $env:VITE_APP_COMMIT = $commitShort.Trim()
    $env:VITE_BUILD_TIME = $buildTime
    $env:VITE_AWS_REGION = $Region

    npm run build --workspace=@city-commander/frontend *>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Block "BLOCKED_BUILD: frontend build failed."
    }

    if (-not (Test-Path -LiteralPath $frontendDist)) {
        Write-Block "BLOCKED_BUILD: packages/frontend/dist was not produced."
    }

    $indexHtml = Join-Path $frontendDist "index.html"
    if (-not (Test-Path -LiteralPath $indexHtml)) {
        Write-Block "BLOCKED_BUILD: packages/frontend/dist/index.html is missing."
    }

    # Bundle security scan (no credential strings shipped to the browser).
    $forbidden = @("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", ".env.aws.local")
    foreach ($p in (Get-ChildItem -Recurse -File -Path $frontendDist)) {
        $content = Get-Content -Raw -LiteralPath $p.FullName -ErrorAction SilentlyContinue
        if ($null -eq $content) { continue }
        foreach ($needle in $forbidden) {
            if ($content -match [regex]::Escape($needle)) {
                Write-Block "BLOCKED_SECURITY_SCAN: '$needle' found in $($p.FullName)."
            }
        }
    }

    # Bundle contains at least one JS and one CSS asset.
    $jsAssets = @(Get-ChildItem -Path $frontendDist/assets -Filter "*.js" -File)
    $cssAssets = @(Get-ChildItem -Path $frontendDist/assets -Filter "*.css" -File)
    if ($jsAssets.Count -lt 1 -or $cssAssets.Count -lt 1) {
        Write-Block "BLOCKED_BUILD: missing JS or CSS asset in dist/assets."
    }
    Write-Status "Build assets OK: 1 HTML, $($jsAssets.Count) JS, $($cssAssets.Count) CSS."

    # --- 6. Zip (only the zip file is removed on re-run) --------------------
    if (-not (Test-Path -LiteralPath $zipDir)) {
        New-Item -ItemType Directory -Path $zipDir -Force | Out-Null
    }
    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }

    Push-Location -LiteralPath $frontendDist
    try {
        Add-Type -A System.IO.Compression.FileSystem
        $zipStream = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
        try {
            $files = Get-ChildItem -Recurse -File
            foreach ($f in $files) {
                $rel = $f.FullName.Substring((Get-Location).Path.Length + 1) -replace '\\', '/'
                [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                    $zipStream,
                    $f.FullName,
                    $rel,
                    [System.IO.Compression.CompressionLevel]::Optimal
                )
            }
        }
        finally {
            $zipStream.Dispose()
        }
    }
    finally {
        Pop-Location
    }

    if (-not (Test-Path -LiteralPath $zipPath)) {
        Write-Block "BLOCKED_DEPLOYMENT: failed to build zip at $zipPath."
    }
    Write-Status "Bundle zipped: $zipPath"

    # --- 7. Amplify manual deployment ----------------------------------------
    $createDeploymentJson = Invoke-AwsCli @(
        "amplify", "create-deployment",
        "--app-id", $appId,
        "--branch-name", $BranchName,
        "--region", $Region,
        "--output", "json"
    ) "amplify-create-deployment"

    $createDeployment = $createDeploymentJson | ConvertFrom-Json
    $jobId = $null
    $zipUploadUrl = $null
    if ($null -ne $createDeployment.zipUploadUrl) {
        # The AWS CLI might return either a top-level zipUploadUrl or a
        # pre-constructed deployment object.
        $zipUploadUrl = $createDeployment.zipUploadUrl
    }
    foreach ($prop in $createDeployment.PSObject.Properties) {
        if ($prop.Name -eq "jobId") { $jobId = [string]$prop.Value }
    }
    if (-not $jobId) {
        # Older API shapes use { job: { jobId } }.
        if ($createDeployment.PSObject.Properties.Match("job").Count -gt 0) {
            $jobId = [string]$createDeployment.job.jobId
        }
    }
    if (-not $zipUploadUrl) {
        # Older API shapes use { job: { zipUploadUrl } }.
        if ($createDeployment.PSObject.Properties.Match("job").Count -gt 0) {
            $zipUploadUrl = [string]$createDeployment.job.zipUploadUrl
        }
    }

    if ([string]::IsNullOrWhiteSpace($jobId)) {
        Write-Block "BLOCKED_DEPLOYMENT: 'aws amplify create-deployment' did not return a jobId."
    }
    if ([string]::IsNullOrWhiteSpace($zipUploadUrl)) {
        Write-Block "BLOCKED_DEPLOYMENT: 'aws amplify create-deployment' did not return a zipUploadUrl."
    }

    Write-Status "Amplify deployment slot created (jobId=$jobId). Uploading bundle ..."
    Write-Status "Presigned URL printed: NO"

    $upload = Invoke-WebRequest -Uri $zipUploadUrl -Method Put -InFile $zipPath -ContentType "application/zip" -UseBasicParsing
    if ($upload.StatusCode -lt 200 -or $upload.StatusCode -ge 300) {
        Write-Block "BLOCKED_DEPLOYMENT: bundle upload failed with HTTP $($upload.StatusCode)."
    }
    Write-Status "Bundle uploaded (HTTP $($upload.StatusCode))."

    Invoke-AwsCli @(
        "amplify", "start-deployment",
        "--app-id", $appId,
        "--branch-name", $BranchName,
        "--job-id", $jobId,
        "--region", $Region,
        "--output", "json"
    ) "amplify-start-deployment" | Out-Null
    Write-Status "Deployment started. Polling status ..."

    $startedAt = Get-Date
    $finalStatus = $null
    while ($true) {
        Start-Sleep -Seconds $PollIntervalSeconds
        $jobJson = Invoke-AwsCli @(
            "amplify", "get-job",
            "--app-id", $appId,
            "--branch-name", $BranchName,
            "--job-id", $jobId,
            "--region", $Region,
            "--output", "json"
        ) "amplify-get-job"
        $job = $jobJson | ConvertFrom-Json
        $status = $job.job.summary.status
        Write-Status "Job status: $status"
        if ($status -eq "SUCCEED" -or $status -eq "FAILED" -or $status -eq "CANCELLED") {
            $finalStatus = $status
            break
        }
        if (((Get-Date) - $startedAt).TotalSeconds -gt $PollTimeoutSeconds) {
            Write-Block "BLOCKED_DEPLOYMENT: timeout after $PollTimeoutSeconds seconds; last status=$status."
        }
    }

    if ($finalStatus -ne "SUCCEED") {
        $failureReason = ""
        if ($job.job.PSObject.Properties.Match("job").Count -gt 0) {
            $failureReason = $job.job.summary.statusReason
        }
        $safe = Sanitize-AwsError $failureReason
        Write-Block "BLOCKED_DEPLOYMENT: job ended with $finalStatus. Reason: $safe"
    }
    Write-Status "Job SUCCEED."

    # --- 8. Live URL verification --------------------------------------------
    $appDetailJson = Invoke-AwsCli @(
        "amplify", "get-app",
        "--app-id", $appId,
        "--region", $Region,
        "--output", "json"
    ) "amplify-get-app"
    $appDetail = $appDetailJson | ConvertFrom-Json
    $defaultDomain = $appDetail.app.defaultDomain

    $branchDetailJson = Invoke-AwsCli @(
        "amplify", "get-branch",
        "--app-id", $appId,
        "--branch-name", $BranchName,
        "--region", $Region,
        "--output", "json"
    ) "amplify-get-branch"
    $branchDetail = $branchDetailJson | ConvertFrom-Json

    $liveUrl = "https://$BranchName.$defaultDomain"
    Write-Status "Default domain: $defaultDomain"
    Write-Status "Branch detail: $($branchDetail.branch.stage)"
    Write-Status "Live URL: $liveUrl"

    $live = Invoke-WebRequest -Uri $liveUrl -Method Get -UseBasicParsing
    if ($live.StatusCode -ne 200) {
        Write-Block "BLOCKED_LIVE_URL: HTTP $($live.StatusCode) at $liveUrl"
    }
    if ($live.Content -notmatch "<html" -or $live.Content -notmatch "index-") {
        Write-Block "BLOCKED_LIVE_URL: response did not include a Vite index.html shell."
    }
    Write-Status "Live URL HTTP 200 OK."

    # Sanity-check the JS and CSS asset URLs.
    $jsMatches = [regex]::Matches($live.Content, 'src="/assets/(index-[^"]+\.js)"')
    $cssMatches = [regex]::Matches($live.Content, 'href="/assets/(index-[^"]+\.css)"')
    if ($jsMatches.Count -lt 1 -or $cssMatches.Count -lt 1) {
        Write-Block "BLOCKED_LIVE_URL: response did not link to JS or CSS assets."
    }
    foreach ($m in $jsMatches) {
        $assetUrl = "https://$BranchName.$defaultDomain/assets/$($m.Groups[1].Value)"
        $probe = $null
        try { $probe = Invoke-WebRequest -Uri $assetUrl -Method Get -UseBasicParsing -ErrorAction Stop }
        catch { Write-Block "BLOCKED_LIVE_URL: asset $assetUrl not reachable: $($_.Exception.Message)" }
        if ($null -ne $probe -and $probe.StatusCode -ne 200) { Write-Block "BLOCKED_LIVE_URL: asset $assetUrl returned HTTP $($probe.StatusCode)" }
    }
    foreach ($m in $cssMatches) {
        $assetUrl = "https://$BranchName.$defaultDomain/assets/$($m.Groups[1].Value)"
        $probe = $null
        try { $probe = Invoke-WebRequest -Uri $assetUrl -Method Get -UseBasicParsing -ErrorAction Stop }
        catch { Write-Block "BLOCKED_LIVE_URL: asset $assetUrl not reachable: $($_.Exception.Message)" }
        if ($null -ne $probe -and $probe.StatusCode -ne 200) { Write-Block "BLOCKED_LIVE_URL: asset $assetUrl returned HTTP $($probe.StatusCode)" }
    }
    Write-Status "JS and CSS assets returned HTTP 200."

    # --- 9. Summary ----------------------------------------------------------
    Write-Output "----SUMMARY----"
    Write-Output "AppName=$AppName"
    Write-Output "AppId=$appId"
    Write-Output "AppCreatedOrReused=$appCreatedOrReused"
    Write-Output "BranchName=$BranchName"
    Write-Output "BranchCreatedOrReused=$branchCreatedOrReused"
    Write-Output "JobId=$jobId"
    Write-Output "JobStatus=$finalStatus"
    Write-Output "DefaultDomain=$defaultDomain"
    Write-Output "LiveUrl=$liveUrl"
    Write-Output "Account=$($caller.Account)"
    Write-Output "PrincipalArn=$($caller.Arn)"
    Write-Output "TemporarySession=YES"
    Write-Output "CredentialsPrinted=NO"
    Write-Output "PresignedUrlPrinted=NO"
    Write-Output "BundleSecurityScan=OK"
}
finally {
    # Clean up only the four VITE_* env vars we set. Leave any other
    # AWS_REGION overrides intact because the user may have supplied them
    # explicitly for the session.
    foreach ($k in @("VITE_APP_BRANCH", "VITE_APP_COMMIT", "VITE_BUILD_TIME", "VITE_AWS_REGION")) {
        Remove-Item -Path "Env:$k" -ErrorAction SilentlyContinue
    }
    # Remove the temporary zip only.
    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
    }
}
