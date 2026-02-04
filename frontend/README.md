# Frontend (Next.js + ethers v6)

Pages:

- `/` Overview + VRF metadata
- `/dice` Dice flow (commit/request/reveal/slash/cancel)
- `/lottery` Lottery flow (create/buy/start/finalize)

## Setup

```powershell
copy .env.example .env.local
npm install
npm run dev
```

Required env variables:

- `NEXT_PUBLIC_TREASURY_VAULT`
- `NEXT_PUBLIC_VRF_ROUTER`
- `NEXT_PUBLIC_DICE_GAME`
- `NEXT_PUBLIC_LOTTERY_GAME`
- `NEXT_PUBLIC_TEST_TOKEN` (optional but recommended for ERC20 demo)

## Build Checks

```powershell
npm run lint
npm run build
```

## Notes

- Wallet support: MetaMask only.
- Frontend enforces Sepolia network check.
- Dice salt is stored in browser localStorage by `betId`; keep same browser profile for reveal.

