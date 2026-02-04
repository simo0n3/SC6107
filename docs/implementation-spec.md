# Implementation Specification (Option 4)

Last updated: 2026-02-04  
Status: Approved for implementation start  
Network: Ethereum Sepolia

## 1. Objective

Build an on-chain verifiable random gaming platform with:

1. At least 2 game types: Dice + Lottery
2. ETH and ERC20 betting support
3. Chainlink VRF integration
4. Anti-cheating mechanism: commit-reveal + timelock + slashing
5. Frontend with MetaMask support and verifiable randomness display

Testing and full audit artifacts are deferred until core app is complete.

## 2. Scope (Phase 1 Build)

### In scope now

- Smart contracts (Foundry): treasury, VRF router, dice, lottery, test token
- Deployment scripts (Sepolia)
- Frontend (Next.js + ethers v6), MetaMask-only
- Runtime safety controls (`pause`, access control, non-reentrancy)
- Operational docs and handoff docs

### Deferred (after full feature completion)

- Unit/integration/fuzz/invariant/gas tests
- Slither run and final security report
- Coverage target and gas benchmark finalization

## 3. Repository Layout

Target structure:

```text
project-root/
  README.md
  contracts/
    foundry.toml
    src/
      TreasuryVault.sol
      VRFRouter.sol
      DiceGame.sol
      LotteryGame.sol
      TestERC20.sol
      interfaces/
    script/
    test/                 # intentionally deferred
  frontend/
  docs/
  scripts/                # optional external scripts
  package.json
```

## 4. Contract Architecture

## 4.1 TreasuryVault

Responsibilities:

- Custody ETH/ERC20 bankroll
- Controlled payouts to game winners
- Track reserved liabilities to prevent insolvency withdrawals
- Allow owner funding and owner withdrawals (subject to liquidity checks)
- Pause emergency-sensitive actions

Core rules:

- Only whitelisted game contracts can call payout-related methods
- `withdraw` must not reduce free balance below reserved obligations
- Use `SafeERC20` for all token transfers
- Store global per-token betting limits shared by all games:
  - `minBet[token]`
  - `maxBet[token]`

## 4.2 VRFRouter (single Chainlink consumer)

Responsibilities:

- Only contract requesting randomness from Chainlink VRF
- Keep `requestId -> (game, roundId)` mapping
- Persist fulfillment result
- Deliver randomness to target game
- Never block fulfillment due to downstream game issues

Design rule:

- VRF callback path must avoid heavy logic and avoid reverts
- If game delivery fails in callback, keep randomness stored and allow manual pull/consume path

## 4.3 DiceGame

Responsibilities:

- Accept bets with commit hash
- Request randomness for each bet
- Receive/store VRF random word
- Reveal+settle with deterministic formula
- Slash expired unrevealed bets
- Cancel and refund on VRF timeout

## 4.4 LotteryGame

Responsibilities:

- Manage draw windows
- Sell tickets in ETH/ERC20
- Trigger draw after end time
- Finalize with VRF randomness
- Handle empty draw edge case (rollover)

## 4.5 TestERC20

Simple mintable token for demo and integration.

## 5. Data Model and State Machines

## 5.1 Dice

```solidity
enum BetState {
  None,
  Committed,
  RandomRequested,
  RandomFulfilled,
  Settled,
  Slashed,
  Cancelled
}

struct Bet {
  address player;
  address token;          // address(0) for ETH
  uint96 amount;
  uint96 maxPayout;       // reserved liability, always >= amount
  uint8 rollUnder;        // 1..99, win if roll <= rollUnder
  uint32 createdAt;
  uint32 revealDeadline;
  bytes32 commitHash;
  bytes32 clientNonce;    // optional store only if design needs; default do not store clear secret
  uint256 requestId;
  uint256 randomWord;
  BetState state;
}
```

State transitions:

1. `commitBet` -> `Committed`
2. internal/external `requestRandom` -> `RandomRequested`
3. `onRandomness` -> `RandomFulfilled` + set `revealDeadline`
4. `revealAndSettle` -> `Settled`
5. `slashExpired` -> `Slashed`
6. `cancelIfUnfulfilled` -> `Cancelled`

### Dice fairness math

- Roll: `roll = (finalRand % 100) + 1`
- Win condition: `roll <= rollUnder`
- Derivation:
  - `finalRand = uint256(keccak256(abi.encode(randomWord, player, salt, address(this), block.chainid, betId)))`
- Payout (includes principal):
  - `payout = amount * (10000 - houseEdgeBps) * 100 / (rollUnder * 10000)`
- All multiplications use checked math with integer rounding down
- Liability reservation rule: reserve `max(amount, payout)` to keep refund path solvent

## 5.2 Lottery

```solidity
enum DrawStatus {
  None,
  Open,
  RandomRequested,
  RandomFulfilled,
  Finalized,
  RolledOver
}

struct Draw {
  address token;
  uint96 ticketPrice;
  uint16 houseEdgeBps;
  uint32 startTime;
  uint32 endTime;
  DrawStatus status;
  uint256 requestId;
  uint256 randomWord;
  address winner;
  uint256 totalTickets;
  uint256 potAmount;
}
```

State transitions:

1. `createDraw` -> `Open`
2. `buyTickets` stays `Open`
3. `startDraw` after end time:
   - if no ticket: `RolledOver`
   - else: `RandomRequested`
4. `onRandomness` -> `RandomFulfilled`
5. `finalizeDraw` -> `Finalized` + payout

Ticket ownership model for MVP:

- `mapping(uint256 => mapping(uint256 => address)) ticketOwner`
- Optional optimization later: packed ranges per buyer
- `MAX_TICKETS_PER_TX` is enforced in `buyTickets` (default: `50`)
- `MAX_TICKETS_PER_DRAW` is enforced to cap draw growth (default: `10000`)

## 6. API Surface (MVP)

The following external methods are required.

## 6.1 TreasuryVault

- `fundETH() payable`
- `fundToken(address token, uint256 amount)`
- `withdrawETH(uint256 amount, address to) onlyOwner`
- `withdrawToken(address token, uint256 amount, address to) onlyOwner`
- `setGameWhitelist(address game, bool allowed) onlyOwner`
- `setTokenBetLimits(address token, uint96 minBet, uint96 maxBet) onlyOwner`
- `getTokenBetLimits(address token) view returns (uint96 minBet, uint96 maxBet)`
- `increaseReserved(address token, uint256 amount) onlyGame`
- `decreaseReserved(address token, uint256 amount) onlyGame`
- `payout(address token, address to, uint256 amount) onlyGame nonReentrant`
- `pause()/unpause() onlyOwner`

## 6.2 VRFRouter

- `requestRandom(uint256 roundId, uint32 numWords) onlyWhitelistedGame returns (uint256 requestId)`
- `setGameWhitelist(address game, bool allowed) onlyOwner`
- `setVrfConfig(...) onlyOwner`
- `retryDelivery(uint256 requestId)` (manual redelivery if first callback-to-game failed)
- `getRequestContext(uint256 requestId) view`
- `getVrfConfig() view`

## 6.3 DiceGame

- `commitBet(address token, uint96 amount, uint8 rollUnder, bytes32 commitHash) payable`
- `revealAndSettle(uint256 betId, bytes32 salt)`
- `slashExpired(uint256 betId)`
- `cancelIfUnfulfilled(uint256 betId)`
- admin setters: house edge, reveal window, max wait, pause
- view helpers: `getBet`, `previewPayout`, `canSlash`, `canCancel`

## 6.4 LotteryGame

- `createDraw(address token, uint96 ticketPrice, uint32 start, uint32 end, uint16 houseEdgeBps) onlyOwner`
- `buyTickets(uint256 drawId, uint32 count) payable`
- `startDraw(uint256 drawId)`
- `finalizeDraw(uint256 drawId)`
- admin setters: max tickets per tx (`default=50`), pause
- view helpers: `getDraw`, `getTicketOwner`, `getCurrentPrize`

## 7. Events

At minimum:

- Vault: `Funded`, `Withdrawn`, `Payout`, `ReservedChanged`, `GameWhitelistUpdated`
- Router: `RandomRequested`, `RandomFulfilled`, `RandomDeliveryFailed`, `RandomDelivered`
- Dice: `BetCommitted`, `DiceRandomRequested`, `DiceRandomFulfilled`, `BetSettled`, `BetSlashed`, `BetCancelled`
- Lottery: `DrawCreated`, `TicketsBought`, `LotteryRandomRequested`, `LotteryRandomFulfilled`, `LotteryFinalized`, `LotteryRolledOver`

## 8. Anti-Cheating and MEV Strategy

## 8.1 Commit-Reveal

Commit formula:

```solidity
keccak256(
  abi.encode(
    player,
    token,
    amount,
    rollUnder,
    salt,
    userNonce,
    block.chainid,
    address(diceGame)
  )
)
```

Rules:

- Commitment binds player + exact bet parameters
- Front-running cannot steal commit because attacker cannot reveal original secret

## 8.2 Timelock + Slashing

- On randomness fulfillment, set `revealDeadline = fulfilledAt + revealWindow`
- If deadline passes without reveal, anyone can call `slashExpired`
- Default policy: slash full bet principal (strict anti-selective-reveal)

## 8.3 Failure and retry policy

- For `RandomRequested` bets that exceed `maxWaitForFulfill`, allow cancel and refund
- Do not re-request randomness for same bet after first request (prevents selective request discard)
- If callback arrives after cancellation, it is ignored by state guard

## 9. Chainlink VRF Configuration (Sepolia)

Target version: VRF v2.5

- Coordinator: `0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B`
- LINK token: `0x779877A7B0D9E8603169DdbD7836e478b4624789`
- Key hash (500 gwei lane): `0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae`
- `requestConfirmations`: default `3`
- `callbackGasLimit`: default `300000`
- `numWords`: default `1`

Subscription flow:

1. Create subscription on Sepolia
2. Fund with LINK
3. Deploy `VRFRouter`
4. Add `VRFRouter` as consumer
5. Set subscription ID in deployment config

## 10. Frontend Scope (MVP)

## 10.1 Common

- Wallet connect (MetaMask)
- Chain guard (force Sepolia)
- Show vault balances and key protocol configs
- Show tx hashes and links to Sepolia explorer

## 10.2 Dice page

- Inputs: token, amount, rollUnder
- Generate client secret and commit hash locally
- Trigger `commitBet`
- Track states from events
- Reveal action before deadline
- Display:
  - requestId
  - randomWord
  - revealDeadline
  - final roll
  - payout

## 10.3 Lottery page

- Draw list/status, countdown, ticket purchase
- `startDraw` and `finalizeDraw` buttons (permissionless where applicable)
- Display winner, payout, and VRF request/fulfillment references

## 10.4 Verifiability panel

Must expose:

- coordinator
- subscriptionId
- keyHash
- requestId
- fulfillment tx hash
- randomWord

## 11. Deployment Sequence

1. Deploy `TreasuryVault`
2. Deploy `VRFRouter` with Sepolia config + `subscriptionId`
3. Deploy `DiceGame`
4. Deploy `LotteryGame`
5. Whitelist games in vault and router
6. Optionally deploy `TestERC20`
7. Fund vault (ETH + ERC20)
8. Add `VRFRouter` consumer in Chainlink subscription
9. Frontend `.env` update with deployed addresses

## 12. Acceptance Criteria for Phase 1

Phase 1 is complete when:

1. Contracts compile and deploy on Sepolia
2. Dice full loop works: commit -> VRF -> reveal -> settle/slash/cancel
3. Lottery full loop works: create -> buy -> draw -> finalize/rollover
4. ETH and ERC20 flow both work on both games
5. Frontend can execute above flows through MetaMask
6. Verifiability panel shows live VRF metadata
