# Contracts Workspace

Foundry workspace for SC6107 Option 4.

## Core Files

- `src/TreasuryVault.sol`
- `src/VRFRouter.sol`
- `src/DiceGame.sol`
- `src/LotteryGame.sol`
- `src/TestERC20.sol`
- `script/Deploy.s.sol`

If this repo was cloned freshly, initialize submodules first:

```powershell
git submodule update --init --recursive
```

## Build

```powershell
bash -lc "cd /mnt/e/SC6107/contracts && ~/.foundry/bin/forge build"
```

## Deploy

1. Copy env template:

```powershell
copy .env.example .env
```

2. Fill required values (`SEPOLIA_RPC_URL`, `PRIVATE_KEY`, `VRF_SUBSCRIPTION_ID`).

3. Deploy:

```powershell
bash -lc "cd /mnt/e/SC6107/contracts && source .env && ~/.foundry/bin/forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast"
```

## Notes

- Randomness uses Chainlink VRF v2.5 via `VRFRouter`.
- `DiceGame` uses commit-reveal with strict 100% slashing on expired reveal.
- `LotteryGame` has `MAX_TICKETS_PER_TX = 50` and rollover for no-ticket rounds.
