# The live turn/river solver as an AWS Lambda container image (arm64 / Graviton).
# Built by cloud/lambda-deploy.ps1 from solver/ as the build context:
#   docker buildx build --platform linux/arm64 -f lambda/Dockerfile --build-arg GIT_COMMIT=<sha> .
# It cross-compiles on the build machine's own CPU (no slow emulation), against Debian bullseye's
# older glibc so the binary runs on Amazon Linux 2023.

FROM --platform=$BUILDPLATFORM rust:1-bullseye AS build
RUN apt-get update && apt-get install -y --no-install-recommends gcc-aarch64-linux-gnu libc6-dev-arm64-cross \
    && rm -rf /var/lib/apt/lists/* && rustup target add aarch64-unknown-linux-gnu
ENV CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc
WORKDIR /src
COPY Cargo.toml Cargo.lock USAGE.txt ./
COPY src src
# The commit shown to users (AGPL condition 3); must be a commit pushed to GitHub.
ARG GIT_COMMIT=dev
ENV GIT_COMMIT=$GIT_COMMIT
RUN cargo build --release --features service --bin live --target aarch64-unknown-linux-gnu

FROM public.ecr.aws/lambda/provided:al2023-arm64
# The base image's entrypoint runs /var/runtime/bootstrap, which serves the Lambda runtime API.
COPY --from=build /src/target/aarch64-unknown-linux-gnu/release/live /var/runtime/bootstrap
CMD ["handler"]
