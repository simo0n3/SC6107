export const treasuryVaultAbi = [
  "function getVaultBalances(address token) view returns (uint256 totalBalance, uint256 reservedBalance, uint256 freeBalance)",
  "function getTokenBetLimits(address token) view returns (uint96 minBet, uint96 maxBet)",
] as const;

export const vrfRouterAbi = [
  "function getVrfConfig() view returns (address coordinator, uint256 subscriptionId, bytes32 keyHash, uint16 requestConfirmations, uint32 callbackGasLimit, bool nativePayment)",
] as const;

export const diceGameAbi = [
  "function commitBet(address token, uint96 amount, uint8 rollUnder, bytes32 commitHash) payable returns (uint256 betId)",
  "function revealAndSettle(uint256 betId, bytes32 salt)",
  "function slashExpired(uint256 betId)",
  "function cancelIfUnfulfilled(uint256 betId)",
  "function bets(uint256 betId) view returns (address player, address token, uint96 amount, uint96 maxPayout, uint8 rollUnder, uint32 createdAt, uint32 requestedAt, uint32 revealDeadline, bytes32 commitHash, uint256 requestId, uint256 randomWord, uint8 state)",
  "function nextBetId() view returns (uint256)",
  "event BetCommitted(uint256 indexed betId, address indexed player, address indexed token, uint256 amount, uint8 rollUnder, bytes32 commitHash)",
  "event DiceRandomRequested(uint256 indexed betId, uint256 indexed requestId)",
  "event DiceRandomFulfilled(uint256 indexed betId, uint256 indexed requestId, uint256 randomWord, uint256 revealDeadline)",
  "event BetSettled(uint256 indexed betId, uint8 roll, bool won, uint256 payoutAmount)",
  "event BetCancelled(uint256 indexed betId, uint256 refundedAmount)",
  "event BetSlashed(uint256 indexed betId, uint256 forfeitedAmount)",
] as const;

export const lotteryGameAbi = [
  "function createDraw(address token, uint96 ticketPrice, uint32 startTime, uint32 endTime, uint16 houseEdgeBps) returns (uint256 drawId)",
  "function buyTickets(uint256 drawId, uint32 count) payable",
  "function startDraw(uint256 drawId)",
  "function finalizeDraw(uint256 drawId)",
  "function draws(uint256 drawId) view returns (address token, uint96 ticketPrice, uint16 houseEdgeBps, uint32 startTime, uint32 endTime, uint8 status, uint256 requestId, uint256 randomWord, address winner, uint256 totalTickets, uint256 potAmount)",
  "function nextDrawId() view returns (uint256)",
  "function getCurrentPrize(uint256 drawId) view returns (uint256 grossPot, uint256 winnerPayout, uint256 houseTake)",
  "event DrawCreated(uint256 indexed drawId, address indexed token, uint256 ticketPrice, uint256 startTime, uint256 endTime, uint256 carryInPot, uint16 houseEdgeBps)",
  "event TicketsBought(uint256 indexed drawId, address indexed buyer, uint256 count, uint256 cost, uint256 totalTickets, uint256 potAmount)",
  "event LotteryRandomRequested(uint256 indexed drawId, uint256 indexed requestId)",
  "event LotteryRandomFulfilled(uint256 indexed drawId, uint256 indexed requestId, uint256 randomWord)",
  "event LotteryFinalized(uint256 indexed drawId, address indexed winner, uint256 winnerIndex, uint256 winnerPayout, uint256 houseTake)",
  "event LotteryRolledOver(uint256 indexed drawId, address indexed token, uint256 amount)",
] as const;

export const erc20Abi = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function faucet()",
] as const;

