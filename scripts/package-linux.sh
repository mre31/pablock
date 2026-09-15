#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
engine="${CONTAINER_ENGINE:-podman}"
"$engine" build -f scripts/Containerfile -t pablock-builder .
"$engine" run --rm --security-opt label=disable \
  -v "$PWD:/workspace" -v pablock-build-target:/workspace/target \
  -v pablock-build-node:/workspace/node_modules -v pablock-build-cargo:/opt/cargo/registry \
  pablock-builder sh -c 'pnpm install --frozen-lockfile && pnpm tauri build --no-bundle && pnpm tauri bundle && mkdir -p artifacts && cp target/release/bundle/deb/*.deb target/release/bundle/appimage/*.AppImage target/release/pablock artifacts/ && cd artifacts && sha256sum Pablock_*.deb Pablock_*.AppImage pablock > SHA256SUMS'
