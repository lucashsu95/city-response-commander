# scripts/load-aws-env.ps1
#
# Load competition AWS temporary credentials from a local .env file into the
# current PowerShell process environment.
#
# SAFETY:
#   - Never reads values from a key other than the allow-list.
#   - Never prints credential values.
#   - Never writes to User / Machine environment.
#   - Never uses `setx`, `aws configure`, or `aws configure set`.
#   - Never exec'd during this round of the task; intended to be invoked by
#     a human operator in a fresh PowerShell session.
#
# Usage:
#   . .\scripts\load-aws-env.ps1
#   . .\scripts\load-aws-env.ps1 -EnvFile .env.aws.local
#   . .\scripts\load-aws-env.ps1 -EnvFile .env.aws.local -SkipIdentityCheck
#
# Exit codes (string written to stderr, then `exit 1`):
#   BLOCKED_AWS_ENV_FILE_MISSING
#   BLOCKED_UNSUPPORTED_AWS_ENV_KEY
#   BLOCKED_MISSING_AWS_ENV_VALUE
#   BLOCKED_WRONG_AWS_REGION
#   BLOCKED_EXPIRED_AWS_SESSION
#   BLOCKED_INVALID_AWS_SESSION
#   BLOCKED_AWS_ACCESS_DENIED
#   BLOCKED_AWS_IDENTITY_CHECK

[CmdletBinding()]
param(
    [string]$EnvFile = ".env.aws.local",
    [switch]$SkipIdentityCheck
)

$ErrorActionPreference = "Stop"

# Allow-list of variable names that may be set on the current process.
$AllowedKeys = @(
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_REGION",
    "AWS_DEFAULT_REGION"
)

# Required non-empty keys for any meaningful AWS call.
$RequiredKeys = @(
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_REGION"
)

# Strict target region for this competition.
$ExpectedRegion = "us-west-2"

function Write-Block([string]$Message) {
    [Console]::Error.WriteLine($Message)
    exit 1
}

if (-not (Test-Path -LiteralPath $EnvFile)) {
    Write-Block "BLOCKED_AWS_ENV_FILE_MISSING: '$EnvFile' was not found. Copy .env.aws.example to .env.aws.local and fill in the values before running this script."
}

# Parse the env file line by line. We use a StreamReader + a strict manual
# parser to avoid Invoke-Expression and to make any accidental value echo
# extremely unlikely.
$parsed = @{}
try {
    $reader = [System.IO.File]::OpenText((Resolve-Path -LiteralPath $EnvFile).Path)
    try {
        while (-not $reader.EndOfStream) {
            $rawLine = $reader.ReadLine()
            if ($null -eq $rawLine) { break }

            $line = $rawLine.Trim()
            if ($line.Length -eq 0) { continue }
            if ($line.StartsWith("#")) { continue }

            # Only accept KEY=VALUE with the FIRST '=' as the separator.
            $eqIndex = $line.IndexOf('=')
            if ($eqIndex -lt 1) {
                Write-Block "BLOCKED_AWS_ENV_FILE_MISSING: malformed line in '$EnvFile' (expected KEY=VALUE)."
            }

            $key = $line.Substring(0, $eqIndex).Trim()
            $value = $line.Substring($eqIndex + 1)

            if ($AllowedKeys -notcontains $key) {
                Write-Block "BLOCKED_UNSUPPORTED_AWS_ENV_KEY: key '$key' is not in the allow-list. Refusing to load."
            }

            # Strip an optional single character of surrounding single or
            # double quote. We do NOT print the value.
            if ($value.Length -ge 2) {
                $first = $value[0]
                $last = $value[$value.Length - 1]
                if (($first -eq '"' -and $last -eq '"') -or
                    ($first -eq "'" -and $last -eq "'")) {
                    $value = $value.Substring(1, $value.Length - 2)
                }
            }

            $value = $value.Trim()
            $parsed[$key] = $value
        }
    }
    finally {
        $reader.Close()
        $reader.Dispose()
    }
}
catch {
    Write-Block "BLOCKED_AWS_ENV_FILE_MISSING: failed to read '$EnvFile'."
}

# Required keys must be present and non-empty.
foreach ($k in $RequiredKeys) {
    if (-not $parsed.ContainsKey($k)) {
        Write-Block "BLOCKED_MISSING_AWS_ENV_VALUE: required key '$k' is not present in '$EnvFile'."
    }
    if ([string]::IsNullOrWhiteSpace($parsed[$k])) {
        Write-Block "BLOCKED_MISSING_AWS_ENV_VALUE: required key '$k' is empty in '$EnvFile'."
    }
}

# Region guard. AWS_REGION is required; AWS_DEFAULT_REGION is optional.
if ($parsed["AWS_REGION"] -ne $ExpectedRegion) {
    Write-Block "BLOCKED_WRONG_AWS_REGION: AWS_REGION must be '$ExpectedRegion' but was a different value."
}

# Set on current process only. No [System.Environment]::SetEnvironmentVariable
# with User/Machine targets, no `setx`, no `aws configure`.
foreach ($k in $AllowedKeys) {
    if ($parsed.ContainsKey($k)) {
        Set-Item -Path "Env:$k" -Value $parsed[$k]
    }
}

# Sanity: print only the load status, never the values.
$regionDisplay = if ($parsed.ContainsKey("AWS_REGION")) { $parsed["AWS_REGION"] } else { "(missing)" }
Write-Output "AWS credential environment loaded:"
Write-Output "- AWS_ACCESS_KEY_ID: LOADED"
Write-Output "- AWS_SECRET_ACCESS_KEY: LOADED"
Write-Output "- AWS_SESSION_TOKEN: LOADED"
Write-Output "- AWS_REGION: $regionDisplay"
if ($parsed.ContainsKey("AWS_DEFAULT_REGION")) {
    Write-Output "- AWS_DEFAULT_REGION: $($parsed['AWS_DEFAULT_REGION'])"
} else {
    Write-Output "- AWS_DEFAULT_REGION: (not set)"
}
Write-Output "- Credential values printed: NO"

# Optional identity verification. Guarded by -SkipIdentityCheck so this file
# can be parsed and syntax-checked without invoking `aws`.
if (-not $SkipIdentityCheck) {
    if (-not (Get-Command -Name "aws" -ErrorAction SilentlyContinue)) {
        Write-Block "BLOCKED_AWS_IDENTITY_CHECK: AWS CLI is not on PATH. Install AWS CLI v2 or re-run with -SkipIdentityCheck."
    }

    $configureList = & aws configure list 2>&1
    if ($LASTEXITCODE -ne 0) {
        $message = ($configureList | Out-String).Trim()
        Write-Block "BLOCKED_AWS_IDENTITY_CHECK: 'aws configure list' failed. AWS CLI output did not include credentials.`n$message"
    }

    $stsOutput = & aws sts get-caller-identity --region $ExpectedRegion 2>&1
    $stsText = ($stsOutput | Out-String)
    if ($LASTEXITCODE -ne 0) {
        if ($stsText -match "ExpiredToken") {
            Write-Block "BLOCKED_EXPIRED_AWS_SESSION"
        }
        elseif ($stsText -match "InvalidClientTokenId") {
            Write-Block "BLOCKED_INVALID_AWS_SESSION"
        }
        elseif ($stsText -match "AccessDenied") {
            Write-Block "BLOCKED_AWS_ACCESS_DENIED"
        }
        else {
            Write-Block "BLOCKED_AWS_IDENTITY_CHECK: 'aws sts get-caller-identity' failed.`n$stsText"
        }
    }
}
