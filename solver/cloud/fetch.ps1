# Downloads a cloud run's solved flops into output/<version>/ next to the local ones. Only new files
# come down, nothing local is deleted, and it's safe to run while the instance is still solving.
# Run from solver/:  powershell -ExecutionPolicy Bypass -File cloud\fetch.ps1 [-Version preflop-v8] [-Run <run>]
param([string]$Version = 'preflop-v8', [string]$Run = '')
if (-not $Run) { $Run = $Version }
. "$PSScriptRoot\common.ps1"
Set-Location (Split-Path $PSScriptRoot)

$s3 = "s3://$(Get-SolverBucket)/solver-runs/$Run/output/$Version"
Invoke-Aws s3 sync $s3 "output/$Version" --exclude '*/_progress.json' --only-show-errors
Write-Output "downloaded $s3 -> output/$Version"
Get-ChildItem "output/$Version" -Directory | ForEach-Object {
    $n = (Get-ChildItem $_.FullName | Where-Object Name -Match '^([2-9TJQKA][cdhs]){3}\.json$').Count
    '{0,-22} {1,5}' -f $_.Name, $n
}
