#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." >/dev/null 2>&1 && pwd)"

cd "${ROOT_DIR}"
source .env

if [[ "$#" -ne 5 ]]; then
  echo "Usage: script/check_config.sh <vault> <router> <dice> <lottery> <token>"
  exit 1
fi

vault="$1"
router="$2"
dice="$3"
lottery="$4"
token="$5"

echo "vault.gameWhitelist(dice)"
~/.foundry/bin/cast call --rpc-url "${SEPOLIA_RPC_URL}" "${vault}" "gameWhitelist(address)(bool)" "${dice}"
echo "vault.gameWhitelist(lottery)"
~/.foundry/bin/cast call --rpc-url "${SEPOLIA_RPC_URL}" "${vault}" "gameWhitelist(address)(bool)" "${lottery}"

echo "router.gameWhitelist(dice)"
~/.foundry/bin/cast call --rpc-url "${SEPOLIA_RPC_URL}" "${router}" "gameWhitelist(address)(bool)" "${dice}"
echo "router.gameWhitelist(lottery)"
~/.foundry/bin/cast call --rpc-url "${SEPOLIA_RPC_URL}" "${router}" "gameWhitelist(address)(bool)" "${lottery}"

echo "vault.getTokenBetLimits(ETH)"
~/.foundry/bin/cast call --rpc-url "${SEPOLIA_RPC_URL}" "${vault}" "getTokenBetLimits(address)(uint96,uint96)" "0x0000000000000000000000000000000000000000"
echo "vault.getTokenBetLimits(token)"
~/.foundry/bin/cast call --rpc-url "${SEPOLIA_RPC_URL}" "${vault}" "getTokenBetLimits(address)(uint96,uint96)" "${token}"

echo "lottery.maxTicketsPerTx()"
~/.foundry/bin/cast call --rpc-url "${SEPOLIA_RPC_URL}" "${lottery}" "maxTicketsPerTx()(uint32)"
echo "lottery.maxTicketsPerDraw()"
~/.foundry/bin/cast call --rpc-url "${SEPOLIA_RPC_URL}" "${lottery}" "maxTicketsPerDraw()(uint32)"

