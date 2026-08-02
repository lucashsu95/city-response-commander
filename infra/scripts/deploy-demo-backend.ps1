# Demo Backend Deployment Script
# Usage: .\deploy-demo-backend.ps1 -EnvFile ..\.env.aws.local -Region us-west-2

param(
    [string]$EnvFile = "..\.env.aws.local",
    [string]$Region = "us-west-2"
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# ── Load AWS credentials ──────────────────────────────────────────────────────
Write-Host "=== Loading AWS Credentials ==="
$loaderPath = Join-Path $ScriptDir "../scripts/load-aws-env.ps1"
. $loaderPath -EnvFile (Join-Path $ScriptDir $EnvFile)

# ── Verify STS ────────────────────────────────────────────────────────────────
Write-Host "=== Verifying STS Identity ==="
$identity = aws sts get-caller-identity --region $Region --output json --no-cli-pager 2>&1
if ($LASTEXITCODE -ne 0) { Write-Error "STS failed: $identity"; exit 1 }
$identity | ConvertFrom-Json | ConvertTo-Json -Depth 3
$accountId = ($identity | ConvertFrom-Json).Account
Write-Host "Account: $accountId"

# ── CDKToolkit check ──────────────────────────────────────────────────────────
Write-Host "=== Checking CDKToolkit ==="
$toolkit = aws cloudformation describe-stacks --stack-name CDKToolkit --region $Region --output json --no-cli-pager 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "CDKToolkit not found, bootstrapping..."
    $bootstrap = npx cdk bootstrap --region $Region --no-cli-pager 2>&1
    Write-Host $bootstrap
    if ($LASTEXITCODE -ne 0) { Write-Error "Bootstrap failed: $bootstrap"; exit 1 }
} else {
    Write-Host "CDKToolkit exists (REUSED)"
}

# ── Build ───────────────────────────────────────────────────────────────────
Write-Host "=== Building Packages ==="
$build = npm run build 2>&1
if ($LASTEXITCODE -ne 0) { Write-Error "Build failed: $build"; exit 1 }
Write-Host "Build complete"

# ── CDK Synth ────────────────────────────────────────────────────────────────
Write-Host "=== CDK Synth ==="
$synth = npx cdk synth --context demoBackend=true --context env=COMPETITION_AWS --region $Region --no-cli-pager 2>&1
if ($LASTEXITCODE -ne 0) { Write-Error "Synth failed: $synth"; exit 1 }
Write-Host "Synth complete"

# ── CDK Deploy ───────────────────────────────────────────────────────────────
Write-Host "=== CDK Deploy ==="
$deploy = npx cdk deploy CityCommanderDemoBackend --context demoBackend=true --context env=COMPETITION_AWS --require-approval never --region $Region --no-cli-pager 2>&1
if ($LASTEXITCODE -ne 0) { Write-Error "Deploy failed: $deploy"; exit 1 }
Write-Host "Deploy complete"
Write-Host $deploy

# ── Get CloudFormation Outputs ───────────────────────────────────────────────
Write-Host "=== Reading CloudFormation Outputs ==="
$outputs = aws cloudformation describe-stacks --stack-name CityCommanderDemoBackend --region $Region --output json --no-cli-pager 2>&1
if ($LASTEXITCODE -ne 0) { Write-Error "Outputs failed: $outputs"; exit 1 }

$stackOutputs = ($outputs | ConvertFrom-Json).Stacks[0].Outputs
Write-Host "=== Stack Outputs ==="
$stackOutputs | ConvertTo-Json -Depth 5

# ── Extract key outputs ──────────────────────────────────────────────────────
$apiUrl = ($stackOutputs | Where-Object { $_.OutputKey -eq 'DemoApiUrl' }).OutputValue
$testPageUrl = ($stackOutputs | Where-Object { $_.OutputKey -eq 'DemoTestPageUrl' }).OutputValue

Write-Host ""
Write-Host "=================================================="
Write-Host "AWS DEMO BACKEND DEPLOYMENT RESULT"
Write-Host "=================================================="
Write-Host "Status: DEPLOYED"
Write-Host "API Base URL: $apiUrl"
Write-Host "Test Page URL: $testPageUrl"
Write-Host ""

# ── Smoke Tests ─────────────────────────────────────────────────────────────
Write-Host "=== Smoke Tests ==="

if ($apiUrl) {
    # Health
    $healthStart = Get-Date
    $health = Invoke-RestMethod -Uri "$apiUrl/health" -Method GET -ContentType "application/json" 2>&1
    $healthLatency = ((Get-Date) - $healthStart).TotalMilliseconds
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[PASS] GET /health - Latency: ${healthLatency}ms"
        Write-Host "  Response: $(($health | ConvertTo-Json -Compress))"
    } else {
        Write-Host "[FAIL] GET /health - $health"
    }

    # Test page
    $testStart = Get-Date
    $testPage = Invoke-WebRequest -Uri "$apiUrl/test" -Method GET 2>&1
    $testLatency = ((Get-Date) - $testStart).TotalMilliseconds
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[PASS] GET /test - Latency: ${testLatency}ms"
    } else {
        Write-Host "[FAIL] GET /test - $testPage"
    }

    # Time-series
    $tsStart = Get-Date
    $ts = Invoke-RestMethod -Uri "$apiUrl/demo/timeseries" -Method GET -ContentType "application/json" 2>&1
    $tsLatency = ((Get-Date) - $tsStart).TotalMilliseconds
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[PASS] GET /demo/timeseries - Latency: ${tsLatency}ms"
    } else {
        Write-Host "[FAIL] GET /demo/timeseries - $ts"
    }

    # ACC_001
    $accStart = Get-Date
    $acc = Invoke-RestMethod -Uri "$apiUrl/demo/incidents" -Method POST -Body '{"event_id":"ACC_001"}' -ContentType "application/json" 2>&1
    $accLatency = ((Get-Date) - $accStart).TotalMilliseconds
    if ($LASTEXITCODE -eq 0) {
        $ete = $acc.ete?.ete_minutes
        Write-Host "[PASS] POST /demo/incidents ACC_001 - Latency: ${accLatency}ms - ETE: $ete"
    } else {
        Write-Host "[FAIL] POST /demo/incidents ACC_001 - $acc"
    }

    # EVT_002
    $evtStart = Get-Date
    $evt = Invoke-RestMethod -Uri "$apiUrl/demo/incidents" -Method POST -Body '{"event_id":"EVT_002"}' -ContentType "application/json" 2>&1
    $evtLatency = ((Get-Date) - $evtStart).TotalMilliseconds
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[PASS] POST /demo/incidents EVT_002 - Latency: ${evtLatency}ms"
    } else {
        Write-Host "[FAIL] POST /demo/incidents EVT_002 - $evt"
    }

    # What-if
    $wiStart = Get-Date
    $wi = Invoke-RestMethod -Uri "$apiUrl/demo/what-if" -Method POST -Body '{"query":"若 BL17 人數增至 40000 人"}' -ContentType "application/json" 2>&1
    $wiLatency = ((Get-Date) - $wiStart).TotalMilliseconds
    if ($LASTEXITCODE -eq 0) {
        $textSource = $wi.text_source
        Write-Host "[PASS] POST /demo/what-if - Latency: ${wiLatency}ms - Source: $textSource"
    } else {
        Write-Host "[FAIL] POST /demo/what-if - $wi"
    }

    # Alerts
    $alertStart = Get-Date
    $alert = Invoke-RestMethod -Uri "$apiUrl/demo/alerts" -Method POST -Body '{"station_id":"BL17","roaming_users":3000,"station_capacity":10000,"languages":["zh","en","ja","ko"]}' -ContentType "application/json" 2>&1
    $alertLatency = ((Get-Date) - $alertStart).TotalMilliseconds
    if ($LASTEXITCODE -eq 0) {
        $triggered = $alert.triggered
        $ratio = $alert.roaming_ratio
        Write-Host "[PASS] POST /demo/alerts - Latency: ${alertLatency}ms - Triggered: $triggered, Ratio: $ratio"
    } else {
        Write-Host "[FAIL] POST /demo/alerts - $alert"
    }
} else {
    Write-Host "No API URL found in outputs, skipping smoke tests"
}

Write-Host ""
Write-Host "=================================================="
Write-Host "Deployment complete. Account: $accountId, Region: $Region"
Write-Host "=================================================="
