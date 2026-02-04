# AI Handoff Guide

Last updated: 2026-02-04

This file enables continuation without relying on chat history.

## 1. Current Implementation Status

Completed:

- Foundry project scaffolded under `contracts/`
- Core contracts implemented:
  - `contracts/src/TreasuryVault.sol`
  - `contracts/src/VRFRouter.sol`
  - `contracts/src/DiceGame.sol`
  - `contracts/src/LotteryGame.sol`
  - `contracts/src/TestERC20.sol`
- Interface files implemented:
  - `contracts/src/interfaces/ITreasuryVault.sol`
  - `contracts/src/interfaces/IVRFRouter.sol`
  - `contracts/src/interfaces/IVRFGame.sol`
- Sepolia deployment script implemented:
  - `contracts/script/Deploy.s.sol`
- Frontend implemented with pages:
  - `frontend/app/page.tsx` (overview)
  - `frontend/app/dice/page.tsx`
  - `frontend/app/lottery/page.tsx`
- Frontend wallet hook/component implemented:
  - `frontend/hooks/useWallet.ts`
  - `frontend/components/AppHeader.tsx`
- Environment templates added:
  - `contracts/.env.example`
  - `frontend/.env.example`

Build validation completed:

- Contracts: `forge build` passes
- Frontend: `npm run lint` passes
- Frontend: `npm run build` passes

## 2. Source of Truth

Read in this order:

1. `docs/implementation-spec.md`
2. `docs/decisions.md`
3. `docs/architecture.md`

## 3. Important Runtime Behavior Already Implemented

- Dice:
  - `commitBet` requests VRF immediately
  - reveal window and 100% principal slashing enforced
  - stale unfulfilled request can be cancelled/refunded
- Lottery:
  - `MAX_TICKETS_PER_TX = 50`
  - `MAX_TICKETS_PER_DRAW = 10000` (configurable)
  - no-ticket draw is rolled over at `startDraw` (no VRF request)
- Treasury:
  - per-token global min/max bet limits
  - reserve accounting prevents unsafe owner withdrawal
- VRF router:
  - only whitelisted games can request randomness
  - callback stores fulfillment first, then attempts delivery
  - manual `retryDelivery` available

## 4. Known Follow-up Tasks (Next Priority)

1. Deploy to Sepolia and record deployed addresses in docs/README
2. Configure frontend `.env.local` with deployed addresses
3. Create at least one live draw for demo readiness
4. Add tests (unit/integration/fuzz/invariant) and coverage report
5. Run Slither and finalize `docs/security-analysis.md`
6. Add gas snapshots and finalize `docs/gas-optimization.md`

## 5. Sepolia VRF Values

- Coordinator: `0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B`
- LINK: `0x779877A7B0D9E8603169DdbD7836e478b4624789`
- KeyHash (500 gwei): `0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae`

## 6. Commands

### Contracts (current machine setup)

```powershell
bash -lc "cd /mnt/e/SC6107/contracts && ~/.foundry/bin/forge build"
bash -lc "cd /mnt/e/SC6107/contracts && ~/.foundry/bin/forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast"
```

### Frontend

```powershell
cd frontend
npm install
npm run lint
npm run build
npm run dev
```

## 7. Deferred Work (Intentional)

- Full test suite and 80%+ coverage verification
- Slither report and remediation log
- Final gas benchmark documentation

