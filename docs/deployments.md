# Deployments

## Sepolia (Chain ID 11155111)

Deployment date: 2026-02-04

- `TreasuryVault`: `0x2d09DEce7CCf6FD280a0ea0cfcab5b690A429c43`
- `VRFRouter`: `0xb1de5Bd098C971ab6cCa7822Cc0f26f02308898f`
- `DiceGame`: `0xF9B228D277504CE3DEFe6b9842cE9451d2835264`
- `LotteryGame`: `0x6e2E7C97cCE30575FfD7aba674CB166d3BaA5e46`
- `TestERC20`: `0x123aD88392C08eeEbFFDA8436b1f6266b08ff79d`

Post-deploy checks completed on-chain:

- Vault whitelist: dice/lottery = `true`
- Router whitelist: dice/lottery = `true`
- ETH bet limits: `1e15` to `1e18`
- Test token bet limits: `1e18` to `1e21`
- Lottery limits:
  - `maxTicketsPerTx = 50`
  - `maxTicketsPerDraw = 10000`

Operational next step:

- Add `VRFRouter` (`0xb1de5Bd098C971ab6cCa7822Cc0f26f02308898f`) as consumer in your Chainlink VRF subscription.

