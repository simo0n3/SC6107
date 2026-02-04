# AI Handoff Guide

Last updated: 2026-02-04

This file is for seamless continuation by another AI model or developer.

## 1. Current Status

- Option selected: Option 4 (On-Chain Verifiable Random Game Platform)
- Only source artifact in repo at start: `SC6107_Development_Project.pdf`
- No contracts or frontend code generated yet
- Documentation baseline is now created in `docs/`

## 2. Source of Truth

Read in this order:

1. `docs/implementation-spec.md`
2. `docs/decisions.md`
3. `docs/architecture.md`

## 3. Next Execution Steps

1. Scaffold repository structure (`contracts/`, `frontend/`, etc.)
2. Initialize Foundry project under `contracts/`
3. Add dependencies:
   - OpenZeppelin Contracts 5.x
   - Chainlink contracts for VRF v2.5
4. Implement contracts in this order:
   - `TreasuryVault.sol`
   - `VRFRouter.sol`
   - `DiceGame.sol`
   - `LotteryGame.sol`
   - `TestERC20.sol`
5. Add deploy scripts for Sepolia
6. Initialize Next.js frontend and wire basic pages (`/`, `/dice`, `/lottery`)

## 4. Critical Constraints to Preserve

- Dice must use commit-reveal + reveal deadline + slashing.
- Randomness must come from VRF only.
- Do not introduce "retry randomness for same bet" logic.
- Ensure vault has reserve accounting before allowing owner withdrawals.
- Keep callback path lightweight and non-blocking.

## 5. Sepolia VRF Values (planned)

- Coordinator: `0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B`
- LINK: `0x779877A7B0D9E8603169DdbD7836e478b4624789`
- KeyHash (500 gwei): `0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae`

## 6. Command Shortlist

### Foundry

```powershell
forge init contracts
forge build
forge script script/Deploy.s.sol --rpc-url $env:SEPOLIA_RPC_URL --broadcast
```

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

## 7. Deferred Work (Explicit)

These are intentionally postponed until full feature completion:

- Unit tests
- Integration tests
- Fuzz/invariant tests
- Gas benchmarks
- Slither report and final security write-up

## 8. Resume Checklist

When a new AI/developer resumes:

1. Confirm unresolved items in `docs/decisions.md`
2. Keep interfaces aligned with `docs/implementation-spec.md`
3. Update docs immediately if implementation deviates
4. Continue in small commits by feature milestone

