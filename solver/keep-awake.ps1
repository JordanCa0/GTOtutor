# Keeps Windows from sleeping until the given time (default 09:05), then exits.
# Uses SetThreadExecutionState, which only lasts while this process runs: nothing to undo.
param([string]$Until = "09:05")
Add-Type -Namespace Win32 -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
$deadline = [datetime]::Today.Add([timespan]::Parse($Until))
if ($deadline -le (Get-Date)) { $deadline = $deadline.AddDays(1) }
# ES_CONTINUOUS | ES_SYSTEM_REQUIRED
[void][Win32.Power]::SetThreadExecutionState([uint32]"0x80000001")
Write-Output "keeping the PC awake until $deadline"
while ((Get-Date) -lt $deadline) { Start-Sleep -Seconds 60 }
[void][Win32.Power]::SetThreadExecutionState([uint32]"0x80000000")
Write-Output "done"
