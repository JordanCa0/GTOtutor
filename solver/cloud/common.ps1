# Shared by setup.ps1, launch.ps1, status.ps1 and fetch.ps1 (dot-sourced).
$ErrorActionPreference = 'Stop'

$Region = 'us-east-1'
$RoleName = 'gtotutor-solver-runner'
$GroupName = 'gtotutor-solver-sg'
$NameTag = 'gtotutor-solver'

# Runs the AWS CLI and throws if it fails, so a script never carries on after a failed step.
function Invoke-Aws {
    $out = & aws @args
    if ($LASTEXITCODE -ne 0) { throw "aws $($args -join ' ') failed (exit $LASTEXITCODE)" }
    $out
}

# Same, for calls whose failure is an answer (e.g. "does this role exist?"): returns $null instead.
function Test-Aws {
    # PowerShell 5.1 turns redirected stderr from a native command into an error under 'Stop'.
    $ErrorActionPreference = 'Continue'
    $out = & aws @args 2> $null
    if ($LASTEXITCODE -ne 0) { return $null }
    $out
}

function Get-AccountId { Invoke-Aws sts get-caller-identity --query Account --output text }

# The flop-solve bucket from docs/deployment.md; cloud runs live under its solver-runs/ prefix.
function Get-SolverBucket { "gtotutor-solver-$(Get-AccountId)" }

# Writes text with LF endings and no BOM (user data and JSON for the AWS CLI).
function Write-Lf([string]$Path, [string]$Text) {
    [IO.File]::WriteAllText($Path, ($Text -replace "`r`n", "`n"), (New-Object Text.UTF8Encoding $false))
}

$Temp = Join-Path ([IO.Path]::GetTempPath()) 'gtotutor-solver-cloud'
New-Item -ItemType Directory -Force $Temp | Out-Null
