# API image. Build from the repo root (npm workspaces):
#   docker buildx build --platform linux/arm64 --provenance=false --sbom=false -f apps/api/Dockerfile -t gtotutor-api .
FROM node:24-slim
WORKDIR /app

# Every workspace manifest is copied so the lockfile stays consistent; only the API's deps are installed.
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w apps/api -w packages/shared-types && npm cache clean --force

COPY packages/shared-types packages/shared-types
COPY apps/api apps/api
# Solved charts ship in the image but stay off unless PREFLOP_CHARTS points at them.
COPY preflop/charts/preflop-v8.json preflop/charts/preflop-v9.json preflop/charts/

# Flop solver output is mounted here (synced from S3), not baked into the image.
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 SOLVER_OUTPUT_DIR=/data/solver-output
USER node
EXPOSE 3001
CMD ["npm", "start", "-w", "apps/api"]
