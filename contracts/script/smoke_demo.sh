#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." >/dev/null 2>&1 && pwd)"

cd "${ROOT_DIR}"
source .env

VAULT="0x2d09DEce7CCf6FD280a0ea0cfcab5b690A429c43"
ROUTER="0xb1de5Bd098C971ab6cCa7822Cc0f26f02308898f"
DICE="0xF9B228D277504CE3DEFe6b9842cE9451d2835264"
LOTTERY="0x6e2E7C97cCE30575FfD7aba674CB166d3BaA5e46"
TOKEN="0x123aD88392C08eeEbFFDA8436b1f6266b08ff79d"
ZERO="0x0000000000000000000000000000000000000000"
CHAIN_ID="11155111"

DICE_BET_WEI="1000000000000000"         # 0.001 ETH
ROLL_UNDER="49"
LOTTERY_TICKET_WEI="1000000000000000"   # 0.001 ETH
LOTTERY_DURATION_SEC="120"

send_and_wait() {
  local tx_hash
  tx_hash="$(~/.foundry/bin/cast send --rpc-url "${SEPOLIA_RPC_URL}" --private-key "${PRIVATE_KEY}" --async "$@" | tr -d '\r\n ')"
  echo "tx submitted: ${tx_hash}" >&2

  for _ in $(seq 1 80); do
    local receipt status
    if receipt="$(~/.foundry/bin/cast receipt --rpc-url "${SEPOLIA_RPC_URL}" --async --json "${tx_hash}" 2>/dev/null)"; then
      status="$(echo "${receipt}" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')"
      if [[ "${status}" == "0x1" || "${status}" == "1" ]]; then
        echo "tx mined: ${tx_hash}" >&2
        echo "${tx_hash}"
        return 0
      fi
      if [[ "${status}" == "0x0" || "${status}" == "0" ]]; then
        echo "tx reverted: ${tx_hash}" >&2
        return 1
      fi
    fi
    sleep 3
  done

  echo "tx timeout waiting receipt: ${tx_hash}" >&2
  return 1
}

first_token() {
  awk '{print $1}'
}

get_bet_field() {
  local bet_id="$1"
  local line_no="$2"
  ~/.foundry/bin/cast call --rpc-url "${SEPOLIA_RPC_URL}" "${DICE}" \
    "bets(uint256)(address,address,uint96,uint96,uint8,uint32,uint32,uint32,bytes32,uint256,uint256,uint8)" "${bet_id}" \
    | sed -n "${line_no}p" | first_token
}

get_draw_field() {
  local draw_id="$1"
  local line_no="$2"
  ~/.foundry/bin/cast call --rpc-url "${SEPOLIA_RPC_URL}" "${LOTTERY}" \
    "draws(uint256)(address,uint96,uint16,uint32,uint32,uint8,uint256,uint256,address,uint256,uint256)" "${draw_id}" \
    | sed -n "${line_no}p" | first_token
}

get_vault_field() {
  local token="$1"
  local line_no="$2"
  ~/.foundry/bin/cast call --rpc-url "${SEPOLIA_RPC_URL}" "${VAULT}" \
    "getVaultBalances(address)(uint256,uint256,uint256)" "${token}" \
    | sed -n "${line_no}p" | first_token
}

poll_until_bet_state() {
  local bet_id="$1"
  local target_state="$2"
  for _ in $(seq 1 60); do
    local state
    state="$(get_bet_field "${bet_id}" 12)"
    echo "bet ${bet_id} state=${state}" >&2
    if [[ "${state}" == "${target_state}" ]]; then
      return 0
    fi
    sleep 10
  done
  return 1
}

poll_until_draw_state() {
  local draw_id="$1"
  local target_state="$2"
  for _ in $(seq 1 60); do
    local state
    state="$(get_draw_field "${draw_id}" 6)"
    echo "draw ${draw_id} status=${state}" >&2
    if [[ "${state}" == "${target_state}" ]]; then
      return 0
    fi
    sleep 10
  done
  return 1
}

main() {
  local deployer
  deployer="$(~/.foundry/bin/cast wallet address --private-key "${PRIVATE_KEY}")"
  echo "deployer=${deployer}"

  local chain
  chain="$(~/.foundry/bin/cast chain-id --rpc-url "${SEPOLIA_RPC_URL}")"
  echo "chain_id=${chain}"
  if [[ "${chain}" != "${CHAIN_ID}" ]]; then
    echo "Wrong chain id, expected ${CHAIN_ID}" >&2
    exit 1
  fi

  echo "Step 1/8: check vault liquidity"
  local eth_free token_free
  eth_free="$(get_vault_field "${ZERO}" 3)"
  token_free="$(get_vault_field "${TOKEN}" 3)"
  echo "vault_eth_free=${eth_free}"
  echo "vault_token_free=${token_free}"

  echo "Step 2/8: create lottery draw"
  local draw_prev draw_id now_ts end_ts
  draw_prev="$(~/.foundry/bin/cast call --rpc-url "${SEPOLIA_RPC_URL}" "${LOTTERY}" "nextDrawId()(uint256)" | first_token)"
  draw_id="$((draw_prev + 1))"
  now_ts="$(date +%s)"
  end_ts="$((now_ts + LOTTERY_DURATION_SEC))"
  send_and_wait "${LOTTERY}" "createDraw(address,uint96,uint32,uint32,uint16)" "${ZERO}" "${LOTTERY_TICKET_WEI}" "${now_ts}" "${end_ts}" "100" >/dev/null
  echo "draw_id=${draw_id}"

  echo "Step 3/8: buy 1 ticket"
  send_and_wait --value "${LOTTERY_TICKET_WEI}" "${LOTTERY}" "buyTickets(uint256,uint32)" "${draw_id}" "1" >/dev/null

  echo "Step 4/8: wait draw end and start draw"
  local current_ts
  current_ts="$(date +%s)"
  if (( current_ts <= end_ts )); then
    sleep "$((end_ts - current_ts + 2))"
  fi
  send_and_wait "${LOTTERY}" "startDraw(uint256)" "${draw_id}" >/dev/null

  echo "Step 5/8: wait randomness for lottery and finalize"
  if ! poll_until_draw_state "${draw_id}" "3"; then
    echo "Lottery random fulfillment timeout" >&2
    exit 1
  fi
  send_and_wait "${LOTTERY}" "finalizeDraw(uint256)" "${draw_id}" >/dev/null
  local winner
  winner="$(get_draw_field "${draw_id}" 9)"
  echo "lottery_winner=${winner}"

  echo "Step 6/8: place dice bet"
  local bet_prev bet_id salt encoded commit
  bet_prev="$(~/.foundry/bin/cast call --rpc-url "${SEPOLIA_RPC_URL}" "${DICE}" "nextBetId()(uint256)" | first_token)"
  bet_id="$((bet_prev + 1))"
  salt="$(~/.foundry/bin/cast wallet new | sed -n 's/.*Private key: //p' | sed -n '1p')"
  encoded="$(~/.foundry/bin/cast abi-encode "f(address,address,uint96,uint8,bytes32,uint256,address)" "${deployer}" "${ZERO}" "${DICE_BET_WEI}" "${ROLL_UNDER}" "${salt}" "${CHAIN_ID}" "${DICE}")"
  commit="$(~/.foundry/bin/cast keccak "${encoded}")"
  send_and_wait --value "${DICE_BET_WEI}" "${DICE}" "commitBet(address,uint96,uint8,bytes32)" "${ZERO}" "${DICE_BET_WEI}" "${ROLL_UNDER}" "${commit}" >/dev/null
  echo "bet_id=${bet_id}"
  echo "bet_salt=${salt}"

  echo "Step 7/8: wait randomness for dice"
  if ! poll_until_bet_state "${bet_id}" "3"; then
    echo "Dice random fulfillment timeout" >&2
    exit 1
  fi

  echo "Step 8/8: reveal and settle dice"
  send_and_wait "${DICE}" "revealAndSettle(uint256,bytes32)" "${bet_id}" "${salt}" >/dev/null
  local final_state
  final_state="$(get_bet_field "${bet_id}" 12)"
  echo "dice_final_state=${final_state}"

  echo "smoke_demo_done=true"
}

main "$@"
