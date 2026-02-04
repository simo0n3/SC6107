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
- Lottery:
  - draw configured per round (`startTime`, `endTime`, `ticketPrice`, `token`)
  - empty draw policy: `RolledOver`
- VRF:
  - `requestConfirmations = 3`
  - `callbackGasLimit = 300000`
  - `numWords = 1`

## 3. Pending Decisions (Need User Confirmation)

1. Slashing strictness for expired dice reveals:
   - current default: slash 100% of principal
   - alternative: slash partial ratio (weaker anti-selective-reveal)
2. Lottery rollover fund handling:
   - current default: carry full pot to next draw of same token
3. Max ticket count limits:
   - need practical cap per tx and per draw for gas safety
4. Min/max bet policy:
   - global per token vs per-game per token

If not explicitly changed, current defaults stand.

## 4. Known Risks and Controls

- Risk: callback revert can block randomness usage  
  Control: router stores fulfillment first, and supports redelivery path.
- Risk: selective reveal attack on dice  
  Control: reveal deadline + strong slashing.
- Risk: insolvency through owner withdrawal  
  Control: vault reserved-liability accounting.
- Risk: event-only off-chain assumptions  
  Control: expose on-chain view methods for all critical data.

