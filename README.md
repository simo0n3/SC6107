# SC6107 - Verifiable Random Game Platform (Option 4)

On-chain gaming platform using Chainlink VRF on Sepolia with two games:

- Dice (commit-reveal + timelock + slashing)
- Lottery (time-based draw + rollover)

Supports both ETH and ERC20 betting, with pooled treasury and house edge.

## Project Structure

```text
.
├── contracts/                # Foundry project
│   ├── src/
│   ├── script/
│   └── test/                 # tests deferred for now
├── frontend/                 # Next.js + ethers v6
├── docs/                     # architecture, decisions, handoff, security/gas drafts
├── SC6107_Development_Project.pdf
└── README.md
```

## Implemented Contracts

- `contracts/src/TreasuryVault.sol`
- `contracts/src/VRFRouter.sol`
- `contracts/src/DiceGame.sol`
- `contracts/src/LotteryGame.sol`
- `contracts/src/TestERC20.sol`

Deploy script:

- `contracts/script/Deploy.s.sol`

## Frontend Pages

- `/` Overview + vault + VRF config panel
- `/dice` Commit/request, reveal/settle, slash/cancel, fulfill tx display
- `/lottery` Create draw, buy, start/finalize, winner + fulfill tx display

## Prerequisites

- Node.js 22+
- npm 11+
- Foundry (Forge)

This environment currently runs Forge through WSL Bash:

```powershell
bash -lc "cd /mnt/e/SC6107/contracts && ~/.foundry/bin/forge build"
```

If Forge is installed natively on your shell PATH, use normal `forge` commands.

## Setup

### 0) Pull dependency submodules (required if cloning fresh)

```powershell
git submodule update --init --recursive
```

### 1) Install frontend dependencies

```powershell
cd frontend
npm install
```

### 2) Configure contract deployment env

```powershell
cd ../contracts
copy .env.example .env
```

Edit `.env` with real values, especially:

- `SEPOLIA_RPC_URL`
- `PRIVATE_KEY`
- `VRF_SUBSCRIPTION_ID`

### 3) Build contracts

```powershell
bash -lc "cd /mnt/e/SC6107/contracts && ~/.foundry/bin/forge build"
```

### 4) Deploy to Sepolia

```powershell
bash -lc "cd /mnt/e/SC6107/contracts && source .env && ~/.foundry/bin/forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast"
```

After deployment, add `VRFRouter` as consumer in Chainlink VRF Subscription.

### 5) Configure frontend env

```powershell
cd ../frontend
copy .env.example .env.local
```

Set deployed addresses:

- `NEXT_PUBLIC_TREASURY_VAULT`
- `NEXT_PUBLIC_VRF_ROUTER`
- `NEXT_PUBLIC_DICE_GAME`
- `NEXT_PUBLIC_LOTTERY_GAME`
- `NEXT_PUBLIC_TEST_TOKEN`

### 6) Run frontend

```powershell
npm run dev
```

## Verified Build Status

- Contracts: `forge build` ✅
- Frontend lint: `npm run lint` ✅
- Frontend build: `npm run build` ✅

## Latest Sepolia Deployment (2026-02-04)

- `TreasuryVault`: `0x2d09DEce7CCf6FD280a0ea0cfcab5b690A429c43`
- `VRFRouter`: `0xb1de5Bd098C971ab6cCa7822Cc0f26f02308898f`
- `DiceGame`: `0xF9B228D277504CE3DEFe6b9842cE9451d2835264`
- `LotteryGame`: `0x6e2E7C97cCE30575FfD7aba674CB166d3BaA5e46`
- `TestERC20`: `0x123aD88392C08eeEbFFDA8436b1f6266b08ff79d`

Important:

- Add `VRFRouter` as consumer in your Chainlink VRF subscription before running live rounds.

## Notes

- Current phase intentionally defers tests/security tooling until full feature completion.
- See `docs/handoff.md` for exact continuation checklist.
