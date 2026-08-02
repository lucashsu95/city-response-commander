$ErrorActionPreference = 'Stop'

$content = Get-Content '.env.aws.local'
foreach ($line in $content) {
  if ($line -match '^\s*(\w+)\s*=\s*"?([^"]*)"?\s*$') {
    $name = $matches[1]
    if ($name -in @('AWS_REGION','AWS_DEFAULT_REGION','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN')) {
      Set-Item -Path "Env:$name" -Value $matches[2]
    }
  }
}
Write-Output "LOADED: $env:AWS_REGION"