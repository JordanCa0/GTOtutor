# One-time AWS setup for cloud solver runs. Safe to re-run: it skips what already exists.
#   - IAM role + instance profile gtotutor-solver-runner: read/write solver-runs/ in the solver bucket
#     only (the API server's role stays read-only), plus Session Manager access for debugging.
#   - Security group gtotutor-solver-sg in the default VPC: no inbound access at all.
# Run from solver/:  powershell -ExecutionPolicy Bypass -File cloud\setup.ps1
. "$PSScriptRoot\common.ps1"

$bucket = Get-SolverBucket
Write-Output "account $(Get-AccountId), bucket $bucket, region $Region"

if (-not (Test-Aws s3api head-bucket --bucket $bucket)) { throw "bucket $bucket not found: create it first (docs/deployment.md, step 2)" }

# Role the instance runs as.
if (Test-Aws iam get-role --role-name $RoleName) {
    Write-Output "role $RoleName exists"
} else {
    Invoke-Aws iam create-role --role-name $RoleName --assume-role-policy-document "file://$PSScriptRoot\ec2-trust.json" --description 'GTOtutor cloud flop solver: read/write solver-runs/ only' | Out-Null
    Write-Output "created role $RoleName"
}
$policy = Join-Path $Temp 'runner-policy.json'
Write-Lf $policy ((Get-Content "$PSScriptRoot\runner-policy.json" -Raw) -replace 'SOLVER_BUCKET', $bucket)
Invoke-Aws iam put-role-policy --role-name $RoleName --policy-name solver-runs-s3 --policy-document "file://$policy" | Out-Null
Invoke-Aws iam attach-role-policy --role-name $RoleName --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore | Out-Null
Write-Output "role policy: s3 read/write on $bucket/solver-runs/*, Session Manager"

# Instance profile: the wrapper EC2 needs to attach a role (the console makes one automatically; the CLI doesn't).
if (Test-Aws iam get-instance-profile --instance-profile-name $RoleName) {
    Write-Output "instance profile $RoleName exists"
} else {
    Invoke-Aws iam create-instance-profile --instance-profile-name $RoleName | Out-Null
    Invoke-Aws iam add-role-to-instance-profile --instance-profile-name $RoleName --role-name $RoleName | Out-Null
    Write-Output "created instance profile $RoleName"
}

# Security group with no inbound rules: the instance only reaches out (GitHub, S3, AWS APIs).
$vpc = Invoke-Aws ec2 describe-vpcs --region $Region --filters 'Name=is-default,Values=true' --query 'Vpcs[0].VpcId' --output text
if ($vpc -eq 'None') { throw "no default VPC in $Region" }
$sg = Invoke-Aws ec2 describe-security-groups --region $Region --filters "Name=group-name,Values=$GroupName" "Name=vpc-id,Values=$vpc" --query 'SecurityGroups[0].GroupId' --output text
if ($sg -eq 'None') {
    $sg = Invoke-Aws ec2 create-security-group --region $Region --group-name $GroupName --description 'GTOtutor cloud solver: no inbound access' --vpc-id $vpc --query GroupId --output text
    Write-Output "created security group $GroupName ($sg)"
} else {
    Write-Output "security group $GroupName exists ($sg)"
}

Write-Output 'setup done. Next: request a Spot vCPU quota if needed, then run cloud\launch.ps1 (see cloud\README.md).'
