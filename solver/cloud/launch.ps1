# Starts a cloud solver run: uploads the spots, the queue and any partial output to S3, then launches
# an EC2 instance (Spot by default) that runs cloud\user-data.sh and terminates itself when done.
# Run from solver/ after cloud\setup.ps1:
#   powershell -ExecutionPolicy Bypass -File cloud\launch.ps1
#   powershell -ExecutionPolicy Bypass -File cloud\launch.ps1 -InstanceType c7a.16xlarge -MaxHours 12
# Re-running after an interruption resumes: finished flops are already in S3 and are skipped.
param(
    [string]$Version = 'preflop-v8',
    [string]$Queue = 'queue-cloud-preflop-v8.txt',
    # 64 vCPUs: 4 solver processes x 16 threads. Graviton (c7g/c8g) or AMD (c7a) both work.
    [string]$InstanceType = 'c7g.16xlarge',
    [int]$ThreadsPerWorker = 16,
    # Hard cap: the instance powers off (and terminates) after this many hours, finished or not.
    [int]$MaxHours = 24,
    [switch]$OnDemand,
    # Git branch or tag the instance builds the solver from.
    [string]$Ref = 'main',
    [string]$Repo = 'JordanCa0/GTOtutor'
)
. "$PSScriptRoot\common.ps1"
Set-Location (Split-Path $PSScriptRoot)

$bucket = Get-SolverBucket
$prefix = "solver-runs/$Version"
$s3 = "s3://$bucket/$prefix"

# Refuse to start a second instance on the same run: both would solve the same flops.
$running = Invoke-Aws ec2 describe-instances --region $Region --filters "Name=tag:Name,Values=$NameTag" 'Name=instance-state-name,Values=pending,running' --query 'Reservations[].Instances[].InstanceId' --output text
if ($running) { throw "a solver instance is already running ($running). Check it with cloud\status.ps1." }

# The queue and every spot it names.
if (-not (Test-Path $Queue)) { throw "queue $Queue not found" }
$spots = @(Get-Content $Queue | ForEach-Object { if ($_ -match '^\s*--spot\s+(\S+)') { $Matches[1] } })
foreach ($s in $spots) { if (-not (Test-Path $s)) { throw "spot file $s (from $Queue) not found" } }
Write-Output "$($spots.Count) jobs from $Queue -> $s3"

# Inputs. Partial output goes up too, so those spots resume instead of starting over; sync never
# deletes, so flops a previous cloud run already solved stay in S3.
Invoke-Aws s3 sync "spots/$Version" "$s3/spots/$Version" --exclude '*' --include '*.json' --only-show-errors
foreach ($s in $spots) {
    $name = [IO.Path]::GetFileNameWithoutExtension($s)
    if (Test-Path "output/$Version/$name") {
        Invoke-Aws s3 sync "output/$Version/$name" "$s3/output/$Version/$name" --exclude '_progress.json' --only-show-errors
    }
}
Invoke-Aws s3 cp $Queue "$s3/queue.txt" --only-show-errors | Out-Null
if (Test-Aws s3api head-object --bucket $bucket --key "$prefix/DONE") { Invoke-Aws s3 rm "$s3/DONE" --only-show-errors | Out-Null }
Write-Output 'uploaded spots, queue and partial output'

# Startup script with this run's settings.
$userData = Get-Content "$PSScriptRoot\user-data.sh" -Raw
$settings = @{ __BUCKET__ = $bucket; __PREFIX__ = $prefix; __REPO__ = $Repo; __REF__ = $Ref; __MAX_HOURS__ = "$MaxHours"; __THREADS__ = "$ThreadsPerWorker"; __REGION__ = $Region }
foreach ($k in $settings.Keys) { $userData = $userData.Replace($k, $settings[$k]) }
$userDataFile = Join-Path $Temp 'user-data.sh'
Write-Lf $userDataFile $userData

# Latest Amazon Linux 2023 for the instance's CPU type (arm64 for Graviton, x86_64 otherwise).
$arch = Invoke-Aws ec2 describe-instance-types --region $Region --instance-types $InstanceType --query 'InstanceTypes[0].ProcessorInfo.SupportedArchitectures[0]' --output text
$amiParam = if ($arch -eq 'arm64') { 'al2023-ami-kernel-default-arm64' } else { 'al2023-ami-kernel-default-x86_64' }
$ami = Invoke-Aws ssm get-parameter --region $Region --name "/aws/service/ami-amazon-linux-latest/$amiParam" --query Parameter.Value --output text
$vpc = Invoke-Aws ec2 describe-vpcs --region $Region --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text
$sg = Invoke-Aws ec2 describe-security-groups --region $Region --filters "Name=group-name,Values=$GroupName" "Name=vpc-id,Values=$vpc" --query 'SecurityGroups[0].GroupId' --output text
if ($sg -eq 'None') { throw "security group $GroupName not found: run cloud\setup.ps1 first" }

# Everything else as one JSON input (PowerShell 5.1 mangles inline JSON arguments).
$spec = @{
    ImageId                           = $ami
    InstanceType                      = $InstanceType
    MinCount                          = 1
    MaxCount                          = 1
    SecurityGroupIds                  = @($sg)
    IamInstanceProfile                = @{ Name = $RoleName }
    InstanceInitiatedShutdownBehavior = 'terminate'
    MetadataOptions                   = @{ HttpTokens = 'required'; HttpEndpoint = 'enabled' }
    BlockDeviceMappings               = @(@{ DeviceName = '/dev/xvda'; Ebs = @{ VolumeSize = 30; VolumeType = 'gp3'; Encrypted = $true; DeleteOnTermination = $true } })
    TagSpecifications                 = @(
        @{ ResourceType = 'instance'; Tags = @(@{ Key = 'Name'; Value = $NameTag }, @{ Key = 'SolverRun'; Value = $Version }) },
        @{ ResourceType = 'volume'; Tags = @(@{ Key = 'Name'; Value = $NameTag }) }
    )
}
if (-not $OnDemand) {
    # One-time Spot: an interruption ends the instance; re-run this script to resume.
    $spec.InstanceMarketOptions = @{ MarketType = 'spot'; SpotOptions = @{ SpotInstanceType = 'one-time'; InstanceInterruptionBehavior = 'terminate' } }
}
$specFile = Join-Path $Temp 'run-instances.json'
Write-Lf $specFile ($spec | ConvertTo-Json -Depth 10)

$id = Invoke-Aws ec2 run-instances --region $Region --cli-input-json "file://$specFile" --user-data "file://$userDataFile" --query 'Instances[0].InstanceId' --output text
$market = if ($OnDemand) { 'on-demand' } else { 'spot' }
Write-Output "launched $id ($InstanceType, $arch, $market, powers off after at most $MaxHours h)"
Write-Output 'It builds the solver first (~5 min), then solves. Check progress: cloud\status.ps1'
