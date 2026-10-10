# Shows a cloud solver run: the instance's state, flops solved per spot, and the end of its log.
# Run from solver/:  powershell -ExecutionPolicy Bypass -File cloud\status.ps1 [-Version preflop-v8] [-Run <run>]
param([string]$Version = 'preflop-v8', [string]$Run = '')
if (-not $Run) { $Run = $Version }
. "$PSScriptRoot\common.ps1"

$s3 = "s3://$(Get-SolverBucket)/solver-runs/$Run"

$instances = Invoke-Aws ec2 describe-instances --region $Region --filters "Name=tag:Name,Values=$NameTag" --query 'Reservations[].Instances[].[InstanceId,State.Name,InstanceType,LaunchTime,Tags[?Key==`SolverRun`]|[0].Value]' --output text
Write-Output '--- instances (recently terminated ones stay listed for about an hour)'
if ($instances) { $instances } else { Write-Output 'none' }

$done = Test-Aws s3 cp "$s3/DONE" -
Write-Output "--- run $Run"
if ($done) { Write-Output "queue finished at $done. Download with cloud\fetch.ps1 -Version $Version -Run $Run" } else { Write-Output 'not finished' }

Write-Output '--- flops solved per spot (updated every 5 minutes)'
$status = Test-Aws s3 cp "$s3/status.txt" -
if ($status) { $status } else { Write-Output 'no status yet (the instance is still building the solver)' }

Write-Output '--- end of the instance log'
$latest = Test-Aws s3 ls "$s3/logs/"
if ($latest) {
    $log = ($latest | Sort-Object | Select-Object -Last 1) -split '\s+' | Select-Object -Last 1
    Test-Aws s3 cp "$s3/logs/$log" - | Select-Object -Last 15
} else {
    Write-Output 'no log yet'
}
