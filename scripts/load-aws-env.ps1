# Safe loader for AWS credentials from .env.aws.local
# Only extracts: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN, AWS_REGION, AWS_DEFAULT_REGION

param(
    [string]$EnvFile = ".env.aws.local"
)

$script:AWS_LOADED = $false

function Load-AwsEnv {
    param([string]$File)

    if (-not (Test-Path $File)) {
        Write-Error "Env file not found: $File"
        return $false
    }

    $allowedVars = @(
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_SESSION_TOKEN",
        "AWS_REGION",
        "AWS_DEFAULT_REGION"
    )

    Get-Content $File | ForEach-Object {
        if ($_ -match '^([A-Z_]+)=') {
            $key = $Matches[1]
            if ($allowedVars -contains $key) {
                # Extract value (handles quoted values)
                if ($_ -match '^[^=]+="?([^"]*)"?$') {
                    $value = $Matches[1]
                    [System.Environment]::SetEnvironmentVariable($key, $value, [System.EnvironmentVariableTarget]::Process)
                }
            }
        }
    }

    $script:AWS_LOADED = $true
    return $true
}

Load-AwsEnv -File $EnvFile
