#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." >/dev/null 2>&1 && pwd)"

cd "${ROOT_DIR}"
source .env

COORDINATOR="${VRF_COORDINATOR}"
SUB_ID="${VRF_SUBSCRIPTION_ID}"
ROUTER="0xb1de5Bd098C971ab6cCa7822Cc0f26f02308898f"

echo "coordinator=${COORDINATOR}"
echo "sub_id=${SUB_ID}"
echo "router=${ROUTER}"

echo "getSubscription(subId):"
~/.foundry/bin/cast call --rpc-url "${SEPOLIA_RPC_URL}" "${COORDINATOR}" \
  "getSubscription(uint256)(uint96,uint96,uint64,address,address[])" "${SUB_ID}"

echo "consumerIsAdded(router):"
~/.foundry/bin/cast call --rpc-url "${SEPOLIA_RPC_URL}" "${COORDINATOR}" \
  "consumerIsAdded(uint256,address)(bool)" "${SUB_ID}" "${ROUTER}" || true

echo "pendingRequestExists(subId):"
~/.foundry/bin/cast call --rpc-url "${SEPOLIA_RPC_URL}" "${COORDINATOR}" \
  "pendingRequestExists(uint256)(bool)" "${SUB_ID}"
