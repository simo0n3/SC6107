# Gas Optimization Log (Working Draft)

Last updated: 2026-02-04
Status: Template created; measurements to be added after implementation

## 1. Target Operations

- Dice:
  - `commitBet`
  - `revealAndSettle`
  - `slashExpired`
- Lottery:
  - `buyTickets`
  - `startDraw`
  - `finalizeDraw`
- Vault:
  - `payout`

## 2. Planned Optimization Techniques

- Use compact data types (`uint96`, `uint32`, `uint16`, `uint8`) where safe
- Minimize storage writes in hot paths
- Cache storage reads to memory/local vars
- Avoid unbounded loops in settlement paths
- Use custom errors instead of long revert strings
- Keep callback code minimal and constant-time per request

## 3. Measurement Plan

After implementation:

1. Add gas-focused tests for core methods
2. Capture gas snapshots with Foundry
3. Document baseline and post-optimization deltas

## 4. Results Table (to fill)

| Operation | Baseline Gas | Optimized Gas | Delta | Notes |
| --- | ---: | ---: | ---: | --- |
| commitBet | TBD | TBD | TBD | |
| revealAndSettle | TBD | TBD | TBD | |
| buyTickets | TBD | TBD | TBD | |
| finalizeDraw | TBD | TBD | TBD | |
| payout | TBD | TBD | TBD | |

## 5. Trade-off Notes (to fill)

- Readability vs micro-optimization decisions
- Storage packing impacts on maintainability
- Event verbosity vs gas cost

