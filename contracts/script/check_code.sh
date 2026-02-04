#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." >/dev/null 2>&1 && pwd)"

cd "${ROOT_DIR}"
source .env

if [[ "$#" -eq 0 ]]; then
  echo "Usage: script/check_code.sh <address> [address...]"
  exit 1
fi

for addr in "$@"; do
  code="$(~/.foundry/bin/cast code --rpc-url "${SEPOLIA_RPC_URL}" "${addr}" 2>/dev/null || true)"
  echo "${addr} code_len=${#code}"
done

