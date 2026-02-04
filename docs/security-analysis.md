# Security Analysis (Working Draft)

Last updated: 2026-02-04
Status: Template created; findings to be added after implementation

## 1. Threat Model Scope

- Contracts in scope:
  - TreasuryVault
  - VRFRouter
  - DiceGame
  - LotteryGame
- Assets at risk:
  - ETH and ERC20 bankroll
  - Pending user payouts
  - Draw/bet state integrity

## 2. Required Vulnerability Coverage (Course Mapping)

- Reentrancy
- Integer overflow/underflow
- Front-running / MEV (where applicable)
- Access control bypass

## 3. Planned Controls

- `ReentrancyGuard` on payout and token movement paths
- `Ownable2Step` for privileged administration
- `Pausable` for emergency response
- `SafeERC20` for token transfer safety
- CEI pattern on all external-call paths
- Commitment binding for dice inputs
- Timelocked reveal + slashing for selective reveal resistance

## 4. Contract-Specific Notes (to fill)

## 4.1 TreasuryVault

- [ ] Whitelist enforcement verified
- [ ] Reserve accounting prevents insolvency withdrawals
- [ ] Pause coverage verified

## 4.2 VRFRouter

- [ ] Only whitelisted game can request randomness
- [ ] Fulfillment path cannot be blocked by game callback failures
- [ ] Request ID mapping integrity

## 4.3 DiceGame

- [ ] Commit validation (player/params/secret binding)
- [ ] Mutually exclusive settle/slash/cancel branches
- [ ] Timeout handling and stale callback handling

## 4.4 LotteryGame

- [ ] Draw lifecycle guards
- [ ] Finalize exactly once
- [ ] Empty draw rollover correctness

## 5. Tooling Evidence (to fill)

- Slither command:
  - `slither contracts/src --exclude naming-convention`
- Findings summary:
  - [ ] Critical
  - [ ] High
  - [ ] Medium
  - [ ] Low/Informational
- Remediation log:
  - [ ] All critical resolved
  - [ ] Justification for accepted residual risks

## 6. Open Security Questions

- Should dice slashing be 100% principal or configurable ratio?
- Should large lottery payouts include delayed claim pattern?
- Should owner parameter changes have timelock?

