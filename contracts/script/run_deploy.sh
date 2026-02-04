#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." >/dev/null 2>&1 && pwd)"

cd "${ROOT_DIR}"

if [[ ! -f ".env" ]]; then
  echo "Missing contracts/.env"
  exit 1
fi

set -a
source .env
set +a

if [[ -z "${SEPOLIA_RPC_URL:-}" || -z "${PRIVATE_KEY:-}" || -z "${VRF_SUBSCRIPTION_ID:-}" ]]; then
  echo "Missing required vars in .env (SEPOLIA_RPC_URL, PRIVATE_KEY, VRF_SUBSCRIPTION_ID)"
  exit 1
fi

~/.foundry/bin/forge script script/Deploy.s.sol:Deploy --rpc-url "${SEPOLIA_RPC_URL}" --broadcast

