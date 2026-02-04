# System Architecture

Last updated: 2026-02-04

## 1. High-Level Components

```text
User (MetaMask)
   |
   v
Frontend (Next.js + ethers v6)
   |                         +-----------------------------+
   | tx/calls                | Chainlink VRF (Sepolia)     |
   v                         | Coordinator + Subscription   |
DiceGame / LotteryGame <----> VRFRouter (single consumer)  |
   |                           +-----------------------------+
   | payout/funds
   v
TreasuryVault (ETH + ERC20 custody)
```

## 2. Trust Boundaries

- User wallet signs all user actions.
- Frontend is convenience only, not trusted for correctness.
- Smart contracts enforce full game logic and payout policy.
- Chainlink VRF provides randomness source and proof-backed fulfillment.

## 3. Contract Interaction Rules

1. Game contracts never hold long-term bankroll.
2. Treasury is the sole payout source and liability keeper.
3. Only whitelisted games can:
   - reserve payout obligations
   - release obligations
   - execute payouts
4. Only VRFRouter talks to Chainlink coordinator.
5. Games request randomness through VRFRouter only.

## 4. Dice Flow

```text
[User] commitBet
  -> DiceGame validates bet and transfers stake to TreasuryVault
  -> DiceGame asks VRFRouter.requestRandom(betId)
  -> VRFRouter requests Chainlink
  -> Chainlink fulfills VRFRouter
  -> VRFRouter stores result + delivers to DiceGame
  -> DiceGame sets revealDeadline
[User] revealAndSettle
  -> DiceGame verifies commit
  -> DiceGame computes roll and win/loss
  -> on win: TreasuryVault.payout(player)
  -> release reserve + finalize state
```

Timeout branches:

- If no fulfill after max wait: `cancelIfUnfulfilled` (refund)
- If fulfilled but no reveal by deadline: `slashExpired`

## 5. Lottery Flow

```text
[Owner] createDraw
[Users] buyTickets
  -> funds move to TreasuryVault
  -> ticket index ownership recorded
[Anyone] startDraw after endTime
  -> request VRF through VRFRouter
VRF fulfillment
  -> randomWord stored
[Anyone] finalizeDraw
  -> if totalTickets == 0: rollover
  -> else pick winner and payout from TreasuryVault
```

## 6. Data Consistency Strategy

- Request mapping:
  - Router tracks `requestId -> game + roundId`
  - Games track local `roundId -> requestId`
- Idempotency:
  - State checks prevent second finalize/settle
  - Late fulfill after cancellation is ignored
- Accounting:
  - Vault tracks reserved liabilities per token
  - Owner withdrawals limited to free liquidity

## 7. Failure Handling Strategy

- VRF callback should not depend on heavy game logic.
- Router stores random result first, then attempts delivery.
- If delivery call fails:
  - emit `RandomDeliveryFailed`
  - allow manual redelivery (`retryDelivery`)
- Game level timeout paths keep protocol operational.

## 8. Access Control Model

- `Ownable2Step`: ownership transfer safety.
- `Pausable`: stop key write operations during incidents.
- `ReentrancyGuard`: payout and token movement paths.
- Whitelist gating:
  - Treasury payout functions
  - Router randomness requesters

## 9. Security-Sensitive Invariants (Design Level)

1. No bet/draw can be settled/finalized more than once.
2. Randomness request ownership is unambiguous.
3. Payout cannot exceed vault free liquidity.
4. User cannot alter committed bet parameters at reveal time.
5. Cancel/slash paths are mutually exclusive with settle path.

