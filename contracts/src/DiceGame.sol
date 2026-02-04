// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ITreasuryVault} from "./interfaces/ITreasuryVault.sol";
import {IVRFRouter} from "./interfaces/IVRFRouter.sol";
import {IVRFGame} from "./interfaces/IVRFGame.sol";
import {IAchievementNFT} from "./interfaces/IAchievementNFT.sol";

contract DiceGame is Ownable2Step, Pausable, ReentrancyGuard, IVRFGame {
    using SafeERC20 for IERC20;

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
        address token;
        uint96 amount;
        uint96 maxPayout;
        uint8 rollUnder;
        uint32 createdAt;
        uint32 requestedAt;
        uint32 revealDeadline;
        bytes32 commitHash;
        uint256 requestId;
        uint256 randomWord;
        BetState state;
    }

    error InvalidAddress();
    error InvalidAmount();
    error InvalidRollUnder(uint8 rollUnder);
    error InvalidHouseEdge(uint16 houseEdgeBps);
    error InvalidWindow();
    error InvalidState(BetState current);
    error Unauthorized();
    error CommitMismatch();
    error RevealExpired(uint256 deadline, uint256 nowTs);
    error RevealNotExpired(uint256 deadline, uint256 nowTs);
    error FulfillmentWaitNotExceeded(uint256 eligibleAt, uint256 nowTs);
    error RequestMismatch(uint256 expected, uint256 actual);
    error EthTransferFailed();

    ITreasuryVault public immutable vault;
    IVRFRouter public immutable vrfRouter;
    IAchievementNFT public achievementNft;

    uint16 public houseEdgeBps;
    uint32 public revealWindow;
    uint32 public maxWaitForFulfill;
    uint256 public nextBetId;

    mapping(uint256 => Bet) public bets;
    mapping(uint256 => uint256) public requestIdToBetId;

    event BetCommitted(
        uint256 indexed betId,
        address indexed player,
        address indexed token,
        uint256 amount,
        uint8 rollUnder,
        bytes32 commitHash
    );
    event DiceRandomRequested(uint256 indexed betId, uint256 indexed requestId);
    event DiceRandomFulfilled(uint256 indexed betId, uint256 indexed requestId, uint256 randomWord, uint256 revealDeadline);
    event BetSettled(uint256 indexed betId, uint8 roll, bool won, uint256 payoutAmount);
    event BetSlashed(uint256 indexed betId, uint256 forfeitedAmount);
    event BetCancelled(uint256 indexed betId, uint256 refundedAmount);
    event HouseEdgeUpdated(uint16 houseEdgeBps);
    event RevealWindowUpdated(uint32 revealWindow);
    event MaxWaitUpdated(uint32 maxWaitForFulfill);
    event AchievementNftUpdated(address indexed achievementNft);

    modifier onlyRouter() {
        if (msg.sender != address(vrfRouter)) revert Unauthorized();
        _;
    }

    constructor(
        address vault_,
        address vrfRouter_,
        address achievementNft_,
        uint16 houseEdgeBps_,
        uint32 revealWindow_,
        uint32 maxWaitForFulfill_
    ) Ownable(msg.sender) {
        if (vault_ == address(0) || vrfRouter_ == address(0)) revert InvalidAddress();
        if (houseEdgeBps_ >= 10_000) revert InvalidHouseEdge(houseEdgeBps_);
        if (revealWindow_ == 0 || maxWaitForFulfill_ == 0) revert InvalidWindow();

        vault = ITreasuryVault(vault_);
        vrfRouter = IVRFRouter(vrfRouter_);
        achievementNft = IAchievementNFT(achievementNft_);
        houseEdgeBps = houseEdgeBps_;
        revealWindow = revealWindow_;
        maxWaitForFulfill = maxWaitForFulfill_;
    }

    function commitBet(address token, uint96 amount, uint8 rollUnder, bytes32 commitHash)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 betId)
    {
        if (amount == 0 || commitHash == bytes32(0)) revert InvalidAmount();
        if (rollUnder == 0 || rollUnder > 99) revert InvalidRollUnder(rollUnder);

        _enforceTokenBetLimits(token, amount);

        uint256 maxPayout = previewPayout(amount, rollUnder);
        if (maxPayout < amount) {
            maxPayout = amount;
        }
        if (maxPayout == 0 || maxPayout > type(uint96).max) revert InvalidAmount();

        _collectStake(token, amount);
        vault.increaseReserved(token, maxPayout);

        betId = ++nextBetId;
        Bet storage bet = bets[betId];
        bet.player = msg.sender;
        bet.token = token;
        bet.amount = amount;
        bet.maxPayout = uint96(maxPayout);
        bet.rollUnder = rollUnder;
        bet.createdAt = uint32(block.timestamp);
        bet.commitHash = commitHash;
        bet.state = BetState.Committed;

        emit BetCommitted(betId, msg.sender, token, amount, rollUnder, commitHash);
        _requestRandomness(betId, bet);
    }

    function onRandomness(uint256 roundId, uint256 requestId, uint256 randomWord) external override onlyRouter {
        uint256 betId = requestIdToBetId[requestId];
        if (betId != roundId) revert RequestMismatch(betId, roundId);

        Bet storage bet = bets[betId];
        if (bet.state != BetState.RandomRequested) revert InvalidState(bet.state);
        if (bet.requestId != requestId) revert RequestMismatch(bet.requestId, requestId);

        bet.randomWord = randomWord;
        bet.revealDeadline = uint32(block.timestamp + revealWindow);
        bet.state = BetState.RandomFulfilled;

        emit DiceRandomFulfilled(betId, requestId, randomWord, bet.revealDeadline);
    }

    function revealAndSettle(uint256 betId, bytes32 salt) external nonReentrant whenNotPaused {
        Bet storage bet = bets[betId];
        if (bet.state != BetState.RandomFulfilled) revert InvalidState(bet.state);
        if (msg.sender != bet.player) revert Unauthorized();
        if (block.timestamp > bet.revealDeadline) {
            revert RevealExpired(bet.revealDeadline, block.timestamp);
        }

        bytes32 recomputedCommit = keccak256(
            abi.encode(msg.sender, bet.token, bet.amount, bet.rollUnder, salt, block.chainid, address(this))
        );
        if (recomputedCommit != bet.commitHash) revert CommitMismatch();

        uint256 finalRand = uint256(
            keccak256(abi.encode(bet.randomWord, msg.sender, salt, address(this), block.chainid, betId))
        );
        uint8 roll = uint8((finalRand % 100) + 1);
        bool won = roll <= bet.rollUnder;

        uint256 payoutAmount = 0;
        if (won) {
            payoutAmount = previewPayout(bet.amount, bet.rollUnder);
            vault.payout(bet.token, msg.sender, payoutAmount);
            if (bet.maxPayout > payoutAmount) {
                vault.decreaseReserved(bet.token, bet.maxPayout - payoutAmount);
            }
        } else {
            vault.decreaseReserved(bet.token, bet.maxPayout);
        }

        bet.state = BetState.Settled;
        _tryMintAchievement(msg.sender);
        emit BetSettled(betId, roll, won, payoutAmount);
    }

    function slashExpired(uint256 betId) external nonReentrant whenNotPaused {
        Bet storage bet = bets[betId];
        if (bet.state != BetState.RandomFulfilled) revert InvalidState(bet.state);
        if (block.timestamp <= bet.revealDeadline) {
            revert RevealNotExpired(bet.revealDeadline, block.timestamp);
        }

        bet.state = BetState.Slashed;
        vault.decreaseReserved(bet.token, bet.maxPayout);
        emit BetSlashed(betId, bet.amount);
    }

    function cancelIfUnfulfilled(uint256 betId) external nonReentrant whenNotPaused {
        Bet storage bet = bets[betId];
        if (bet.state != BetState.RandomRequested) revert InvalidState(bet.state);

        uint256 eligibleAt = uint256(bet.requestedAt) + maxWaitForFulfill;
        if (block.timestamp <= eligibleAt) {
            revert FulfillmentWaitNotExceeded(eligibleAt, block.timestamp);
        }

        bet.state = BetState.Cancelled;

        vault.payout(bet.token, bet.player, bet.amount);
        if (bet.maxPayout > bet.amount) {
            vault.decreaseReserved(bet.token, bet.maxPayout - bet.amount);
        }

        emit BetCancelled(betId, bet.amount);
    }

    function previewPayout(uint256 amount, uint8 rollUnder) public view returns (uint256) {
        if (rollUnder == 0 || rollUnder > 99) revert InvalidRollUnder(rollUnder);
        uint256 numerator = amount * (10_000 - houseEdgeBps) * 100;
        uint256 denominator = uint256(rollUnder) * 10_000;
        return numerator / denominator;
    }

    function canSlash(uint256 betId) external view returns (bool) {
        Bet memory bet = bets[betId];
        return bet.state == BetState.RandomFulfilled && block.timestamp > bet.revealDeadline;
    }

    function canCancel(uint256 betId) external view returns (bool) {
        Bet memory bet = bets[betId];
        return bet.state == BetState.RandomRequested && block.timestamp > uint256(bet.requestedAt) + maxWaitForFulfill;
    }

    function setHouseEdgeBps(uint16 houseEdgeBps_) external onlyOwner {
        if (houseEdgeBps_ >= 10_000) revert InvalidHouseEdge(houseEdgeBps_);
        houseEdgeBps = houseEdgeBps_;
        emit HouseEdgeUpdated(houseEdgeBps_);
    }

    function setRevealWindow(uint32 revealWindow_) external onlyOwner {
        if (revealWindow_ == 0) revert InvalidWindow();
        revealWindow = revealWindow_;
        emit RevealWindowUpdated(revealWindow_);
    }

    function setMaxWaitForFulfill(uint32 maxWaitForFulfill_) external onlyOwner {
        if (maxWaitForFulfill_ == 0) revert InvalidWindow();
        maxWaitForFulfill = maxWaitForFulfill_;
        emit MaxWaitUpdated(maxWaitForFulfill_);
    }

    function setAchievementNft(address achievementNft_) external onlyOwner {
        achievementNft = IAchievementNFT(achievementNft_);
        emit AchievementNftUpdated(achievementNft_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _requestRandomness(uint256 betId, Bet storage bet) internal {
        if (bet.state != BetState.Committed) revert InvalidState(bet.state);

        uint256 requestId = vrfRouter.requestRandom(betId, 1);
        bet.requestId = requestId;
        bet.requestedAt = uint32(block.timestamp);
        bet.state = BetState.RandomRequested;
        requestIdToBetId[requestId] = betId;

        emit DiceRandomRequested(betId, requestId);
    }

    function _enforceTokenBetLimits(address token, uint256 amount) internal view {
        (uint96 minBet, uint96 maxBet) = vault.getTokenBetLimits(token);
        if (maxBet == 0 || amount < minBet || amount > maxBet) {
            revert InvalidAmount();
        }
    }

    function _collectStake(address token, uint256 amount) internal {
        if (token == address(0)) {
            if (msg.value != amount) revert InvalidAmount();
            (bool ok,) = payable(address(vault)).call{value: amount}("");
            if (!ok) revert EthTransferFailed();
            return;
        }

        if (msg.value != 0) revert InvalidAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(vault), amount);
    }

    function _tryMintAchievement(address player) internal {
        IAchievementNFT nft = achievementNft;
        if (address(nft) == address(0)) return;

        try nft.mintOnce(player) {} catch {
            // bonus path only; never block core game flow
        }
    }
}
