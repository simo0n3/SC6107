# Decisions Log

Last updated: 2026-02-04

This file records project decisions so implementation can continue without chat history.

## 1. Confirmed Decisions

## 1.1 Platform and tooling

- Chain: Ethereum Sepolia
- Solidity: 0.8.x
- Smart contract framework: Foundry
- Libraries: OpenZeppelin Contracts 5.x
- Randomness: Chainlink VRF v2.5 (subscription mode)
- Frontend: Next.js + ethers v6
- Wallet support: MetaMask only (minimum course requirement)

## 1.2 Game portfolio

- Game A: Dice (single-player multiplier bet)
- Game B: Lottery/Raffle (time-based draw)
- Both games support:
  - ETH betting (`token == address(0)`)
  - ERC20 betting

## 1.3 Contract split

- `TreasuryVault`: custody + payouts + reserved liabilities
- `VRFRouter`: only VRF consumer and dispatcher
- `DiceGame`: commit/reveal/timelock/slashing
- `LotteryGame`: ticketing + draw + finalize
- `TestERC20`: demo token

## 1.4 Failure policy

- If VRF is unfulfilled over timeout, bet can be cancelled/refunded.
- Same bet must not trigger a second randomness request after first request.
- Late callback after cancellation is ignored.

## 1.5 Development sequencing

- First: core contracts + frontend + deploy flow
- Later: full tests, coverage, slither, gas report finalization

## 2. Default Runtime Parameters (Initial)

These are defaults, not immutable. They should be owner-configurable unless noted.

- Dice:
  - `houseEdgeBps = 100` (1%)
  - `revealWindow = 10 minutes`
  - `maxWaitForFulfill = 30 minutes`
  - `rollUnder` range: `1..99` (win if `roll <= rollUnder`)
  - slashing policy for expired reveal: `100% principal forfeiture`
- Lottery:
  - draw configured per round (`startTime`, `endTime`, `ticketPrice`, `token`)
  - empty draw policy: `RolledOver`
  - rollover policy: carry full pot to next draw of the same token
  - `MAX_TICKETS_PER_TX = 50`
  - `MAX_TICKETS_PER_DRAW = 10000` (owner-configurable safety cap)
- Bet limits:
  - min/max policy: global per token (shared by both games)
- VRF:
  - `requestConfirmations = 3`
  - `callbackGasLimit = 300000`
  - `numWords = 1`

## 3. Decision Resolution Status

All previously pending decisions are now confirmed by user input (2026-02-04).

## 3.1 Optional future tuning (not blocking implementation)

- Add `MAX_TICKETS_PER_DRAW` to hard-cap draw size for gas and storage predictability.
- If needed later, split global min/max into per-game override.

## 4. Known Risks and Controls

- Risk: callback revert can block randomness usage  
  Control: router stores fulfillment first, and supports redelivery path.
- Risk: selective reveal attack on dice  
  Control: reveal deadline + strong slashing.
- Risk: insolvency through owner withdrawal  
  Control: vault reserved-liability accounting.
- Risk: event-only off-chain assumptions  
  Control: expose on-chain view methods for all critical data.
