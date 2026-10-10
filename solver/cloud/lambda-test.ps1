# Invokes the deployed live solver with a saved request and prints how long it took. Make a request
# with the benchmark (from solver/):
#   cargo run --release --bin turn-bench -- --spot spots/preflop-v9/btn_vs_bb_srp_100.json `
#     --flop-file output/preflop-v9/btn_vs_bb_srp_100/As7h4h.json --line 0.0 --turn Kc --rivers 5d --trees c --write req
#   powershell -ExecutionPolicy Bypass -File cloud\lambda-test.ps1 -Request req.c.request.json
param(
    [Parameter(Mandatory)] [string]$Request,
    [int]$Times = 2
)
. "$PSScriptRoot\common.ps1"
Set-Location (Split-Path $PSScriptRoot)

$out = Join-Path $Temp 'lambda-response.json'
for ($i = 1; $i -le $Times; $i++) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    Invoke-Aws lambda invoke --region $Region --function-name gtotutor-turn-solver --cli-binary-format raw-in-base64-out `
        --payload "fileb://$Request" $out | Out-Null
    $sw.Stop()
    $r = Get-Content $out -Raw | ConvertFrom-Json
    if ($r.error) { throw "solver error: $($r.error)" }
    $kb = [math]::Round($r.gz.Length / 1024)
    Write-Output ("run {0}: {1:N2}s round trip, {2:N2}s in the function, {3} KB, commit {4}" -f $i, $sw.Elapsed.TotalSeconds, $r.seconds, $kb, $r.commit)
}
