# Runs solver jobs one after another until a deadline, keeping the PC awake meanwhile.
# Each line of the queue file is the solver's arguments, e.g.
#   --spot spots/preflop-v3/btn_vs_bb_srp_100.json --out output/preflop-v3
# Blank lines and lines starting with # are skipped. At the deadline the running solve is stopped;
# the solver resumes from the finished flops next time, so nothing is lost but the current flop.
# Run from solver/:  powershell -ExecutionPolicy Bypass -File run-queue.ps1 -Queue queue.txt -Until 09:00
# (-Until never runs the whole queue.)
param(
    [Parameter(Mandatory = $true)][string]$Queue,
    [string]$Until = "09:00",
    [string]$Log = "queue.log"
)
Add-Type -Namespace Win32 -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
# -Until never: no deadline, run every job to the end.
if ($Until -eq "never") { $deadline = [datetime]::MaxValue } else {
    $deadline = [datetime]::Today.Add([timespan]::Parse($Until))
    if ($deadline -le (Get-Date)) { $deadline = $deadline.AddDays(1) }
}
[void][Win32.Power]::SetThreadExecutionState([uint32]"0x80000001") # ES_CONTINUOUS | ES_SYSTEM_REQUIRED

function Say($msg) { $line = "$(Get-Date -Format 'HH:mm:ss') $msg"; Write-Output $line; Add-Content -Path $Log -Value $line -Encoding utf8 }

$exe = Join-Path $PSScriptRoot "target\release\gtotutor-solver.exe"
Say "queue $Queue until $deadline"
$jobs = Get-Content $Queue | Where-Object { $_.Trim() -and -not $_.Trim().StartsWith("#") }
$n = 0
foreach ($job in $jobs) {
    $n++
    if ((Get-Date) -ge $deadline) { Say "deadline reached before job $n"; break }
    Say "job $n/$($jobs.Count): $job"
    $out = "$([IO.Path]::GetFileNameWithoutExtension($Queue))-job$n.log"
    try {
        $p = Start-Process -FilePath $exe -ArgumentList $job -WorkingDirectory $PSScriptRoot -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError "$out.err" -ErrorAction Stop
    } catch {
        # E.g. Windows blocking the binary. Every other job would fail the same way, so stop here.
        Say "could not start the solver: $($_.Exception.Message)"
        break
    }
    while (-not $p.HasExited) {
        if ((Get-Date) -ge $deadline) {
            Stop-Process -Id $p.Id -Force
            Say "deadline: stopped job $n (resumable)"
            break
        }
        Start-Sleep -Seconds 15
    }
    if ($p.HasExited) { Say "job $n finished (exit $($p.ExitCode))" }
}
[void][Win32.Power]::SetThreadExecutionState([uint32]"0x80000000")
Say "queue done"
