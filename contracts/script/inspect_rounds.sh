#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." >/dev/null 2>&1 && pwd)"

cd "${ROOT_DIR}"
source .env

LOTTERY="0x6e2E7C97cCE30575FfD7aba674CB166d3BaA5e46"
DICE="0xF9B228D277504CE3DEFe6b9842cE9451d2835264"
ROUTER="0xb1de5Bd098C971ab6cCa7822Cc0f26f02308898f"

draw_id="${1:-1}"
bet_id="${2:-1}"

echo "draw ${draw_id}:"
~/.foundry/bin/cast call --rpc-url "${SEPOLIA_RPC_URL}" "${LOTTERY}" \
  "draws(uint256)(address,uint96,uint16,uint32,uint32,uint8,uint256,uint256,address,uint256,uint256)" "${draw_id}"

draw_request_id="$(~/.foundry/bin/cast call --rpc-url "${SEPOLIA_RPC_URL}" "${LOTTERY}" \
  "draws(uint256)(address,uint96,uint16,uint32,uint32,uint8,uint256,uint256,address,uint256,uint256)" "${draw_id}" \
  | sed -n '7p' | awk '{print $1}')"

if [[ "${draw_request_id}" != "0" ]]; then
  echo "router request context for draw requestId=${draw_request_id}:"
  ~/.foundry/bin/cast call --rpc-url "${SEPOLIA_RPC_URL}" "${ROUTER}" \
    "getRequestContext(uint256)(address,uint256,uint32,bool,bool,uint256)" "${draw_request_id}"
fi

echo "bet ${bet_id}:"
~/.foundry/bin/cast call --rpc-url "${SEPOLIA_RPC_URL}" "${DICE}" \
  "bets(uint256)(address,address,uint96,uint96,uint8,uint32,uint32,uint32,bytes32,uint256,uint256,uint8)" "${bet_id}"

bet_request_id="$(~/.foundry/bin/cast call --rpc-url "${SEPOLIA_RPC_URL}" "${DICE}" \
  "bets(uint256)(address,address,uint96,uint96,uint8,uint32,uint32,uint32,bytes32,uint256,uint256,uint8)" "${bet_id}" \
  | sed -n '10p' | awk '{print $1}')"

if [[ "${bet_request_id}" != "0" ]]; then
  echo "router request context for bet requestId=${bet_request_id}:"
  ~/.foundry/bin/cast call --rpc-url "${SEPOLIA_RPC_URL}" "${ROUTER}" \
    "getRequestContext(uint256)(address,uint256,uint32,bool,bool,uint256)" "${bet_request_id}"
fi

