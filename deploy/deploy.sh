#!/usr/bin/env bash
# Pulls the latest API image, syncs flop files from S3, writes secrets from SSM, and restarts.
# Run as root from /opt/gtotutor. Safe to re-run on every deploy (restarting drops hands in progress).
set -euo pipefail
cd "$(dirname "$0")"
set -a; source deploy.env; set +a

# Flop solver output: only changed files are downloaded.
aws s3 sync "s3://${SOLVER_BUCKET}/solver-output" /data/solver-output --delete --region "$AWS_REGION"

# App secrets live in SSM Parameter Store under /gtotutor/ (e.g. /gtotutor/ANTHROPIC_API_KEY).
aws ssm get-parameters-by-path --path /gtotutor/ --with-decryption --region "$AWS_REGION" \
  --query 'Parameters[].[Name,Value]' --output text \
  | awk -F'\t' '{ sub("^/gtotutor/", "", $1); print $1 "=" $2 }' > .env
chmod 600 .env

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
docker compose pull
docker compose up -d
docker image prune -f
