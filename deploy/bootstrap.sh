#!/usr/bin/env bash
# One-time setup on a fresh Amazon Linux 2023 instance: Docker, the Compose plugin, and the app folder.
# Run as root (Session Manager: `sudo bash bootstrap.sh`).
set -euo pipefail

dnf install -y docker
systemctl enable --now docker

# Amazon Linux doesn't package the Compose plugin; install the release binary for this CPU.
arch=$(uname -m)
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${arch}" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

mkdir -p /opt/gtotutor /data/solver-output
echo "Now copy docker-compose.yml, Caddyfile, deploy.sh and deploy.env into /opt/gtotutor, then run deploy.sh."
