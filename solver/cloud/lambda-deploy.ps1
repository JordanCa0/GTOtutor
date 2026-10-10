# Builds the live turn/river solver (src/bin/live.rs) as an arm64 container image and deploys it as
# the Lambda function gtotutor-turn-solver. Safe to re-run: it creates what's missing and updates the
# code otherwise. Run from solver/ with Docker running:
#   powershell -ExecutionPolicy Bypass -File cloud\lambda-deploy.ps1
#
# AGPL conditions (docs/postflop-plan.md): it deploys only a commit that is pushed to GitHub with no
# local changes under solver/, so the source link the app shows is exactly what runs. The function
# has no URL; only the API's role can invoke it. Its own role can only write its logs.
param(
    # Concurrent solves at most: a hard cap on cost. Skipped if the account's Lambda limit is too low.
    [int]$MaxConcurrency = 10,
    # 10240 MB gives Lambda's maximum of 6 vCPUs; the solve itself needs well under 1 GB. New accounts
    # are capped at 3008 MB (about 2 vCPUs) until AWS raises the limit: pass -MemoryMb 3008 until then.
    [int]$MemoryMb = 10240,
    # Longer than the API waits (LIVE_SOLVE_TIMEOUT_MS), so a slow solve still lands in the cache.
    [int]$TimeoutSeconds = 60
)
. "$PSScriptRoot\common.ps1"
Set-Location (Split-Path $PSScriptRoot)

$function = 'gtotutor-turn-solver'
$roleName = 'gtotutor-turn-solver'
$account = Get-AccountId
$registry = "$account.dkr.ecr.$Region.amazonaws.com"
$repo = "$registry/$function"

# 1. Only pushed, clean commits (AGPL condition 4).
$commit = (git rev-parse HEAD).Trim()
if (git status --porcelain -- . ':!output' ':!spots') { throw 'solver/ has uncommitted changes: commit and push them first' }
if (-not (git branch -r --contains $commit)) { throw "commit $commit is not pushed to GitHub: push it first" }
Write-Output "deploying commit $commit"

# 2. Image repository (keeps the last 5 images).
if (-not (Test-Aws ecr describe-repositories --region $Region --repository-names $function)) {
    Invoke-Aws ecr create-repository --region $Region --repository-name $function --image-scanning-configuration scanOnPush=true | Out-Null
    $lifecycle = Join-Path $Temp 'ecr-lifecycle.json'
    Write-Lf $lifecycle '{"rules":[{"rulePriority":1,"description":"keep the last 5 images","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":5},"action":{"type":"expire"}}]}'
    Invoke-Aws ecr put-lifecycle-policy --region $Region --repository-name $function --lifecycle-policy-text "file://$lifecycle" | Out-Null
    Write-Output "created ECR repository $function"
}

# 3. Build and push. --provenance=false: Lambda accepts a plain image manifest, not an index.
# Piped through cmd: PowerShell 5.1 re-encodes text piped into a native program, which ECR rejects.
cmd /c "aws ecr get-login-password --region $Region | docker login --username AWS --password-stdin $registry" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'docker login to ECR failed' }
docker buildx build --platform linux/arm64 --provenance=false --sbom=false -f lambda/Dockerfile --build-arg "GIT_COMMIT=$commit" -t "${repo}:$commit" --push .
if ($LASTEXITCODE -ne 0) { throw 'image build failed' }

# 4. Execution role: CloudWatch logs only. No S3, no database, no secrets (AGPL condition 5).
if (-not (Test-Aws iam get-role --role-name $roleName)) {
    Invoke-Aws iam create-role --role-name $roleName --assume-role-policy-document "file://$PSScriptRoot\lambda-trust.json" --description 'GTOtutor live turn/river solver: logs only' | Out-Null
    Invoke-Aws iam attach-role-policy --role-name $roleName --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole | Out-Null
    Write-Output "created role $roleName; waiting for it to propagate"
    Start-Sleep -Seconds 10
}
$roleArn = Invoke-Aws iam get-role --role-name $roleName --query Role.Arn --output text

# 5. Function: create, or update the code and settings.
if (Test-Aws lambda get-function --region $Region --function-name $function) {
    Invoke-Aws lambda update-function-code --region $Region --function-name $function --image-uri "${repo}:$commit" | Out-Null
    Invoke-Aws lambda wait function-updated-v2 --region $Region --function-name $function
    Invoke-Aws lambda update-function-configuration --region $Region --function-name $function --memory-size $MemoryMb --timeout $TimeoutSeconds | Out-Null
    Write-Output "updated $function"
} else {
    Invoke-Aws lambda create-function --region $Region --function-name $function --package-type Image --code "ImageUri=${repo}:$commit" `
        --role $roleArn --architectures arm64 --memory-size $MemoryMb --timeout $TimeoutSeconds `
        --description 'GTOtutor live turn/river solver (AGPL-3.0, source: github.com/JordanCa0/GTOtutor/tree/<commit>/solver)' | Out-Null
    Write-Output "created $function"
}
Invoke-Aws lambda wait function-updated-v2 --region $Region --function-name $function
Invoke-Aws lambda tag-resource --region $Region --resource (Invoke-Aws lambda get-function --region $Region --function-name $function --query Configuration.FunctionArn --output text) --tags "commit=$commit" | Out-Null

# 6. Concurrency cap. Lambda must keep 100 unreserved, so new accounts (limit 10) can't reserve any.
$limit = [int](Invoke-Aws lambda get-account-settings --region $Region --query AccountLimit.ConcurrentExecutions --output text)
if ($limit -ge $MaxConcurrency + 100) {
    Invoke-Aws lambda put-function-concurrency --region $Region --function-name $function --reserved-concurrent-executions $MaxConcurrency | Out-Null
    Write-Output "reserved concurrency: $MaxConcurrency"
} else {
    Write-Output "account concurrency limit is $limit, so no reserved cap was set (the account limit caps it instead)"
}

# 7. Logs: 30 days.
$logGroup = "/aws/lambda/$function"
# Fails harmlessly if it already exists.
Test-Aws logs create-log-group --region $Region --log-group-name $logGroup | Out-Null
Invoke-Aws logs put-retention-policy --region $Region --log-group-name $logGroup --retention-in-days 30 | Out-Null

Write-Output "done: $function runs commit $commit. Test it with cloud\lambda-test.ps1."
