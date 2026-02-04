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

contract LotteryGame is Ownable2Step, Pausable, ReentrancyGuard, IVRFGame {
    using SafeERC20 for IERC20;

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

    error InvalidAddress();
    error InvalidAmount();
    error InvalidDrawWindow();
    error InvalidHouseEdge(uint16 houseEdgeBps);
    error InvalidState(DrawStatus current);
    error Unauthorized();
    error RequestMismatch(uint256 expected, uint256 actual);
    error TooManyTickets(uint256 count, uint256 maxAllowed);
    error DrawSoldOut(uint256 requestedTotal, uint256 maxAllowed);
    error DrawNotStarted(uint256 startTime, uint256 nowTs);
    error DrawNotEnded(uint256 endTime, uint256 nowTs);
    error EthTransferFailed();

    ITreasuryVault public immutable vault;
    IVRFRouter public immutable vrfRouter;

    uint32 public maxTicketsPerTx = 50;
    uint32 public maxTicketsPerDraw = 10_000;
    uint256 public nextDrawId;

    mapping(uint256 => Draw) public draws;
    mapping(uint256 => mapping(uint256 => address)) public ticketOwner;
    mapping(uint256 => mapping(address => uint256)) public ticketsOf;
    mapping(uint256 => uint256) public requestIdToDrawId;
    mapping(address => uint256) public rolloverPotByToken;

    event DrawCreated(
        uint256 indexed drawId,
        address indexed token,
        uint256 ticketPrice,
        uint256 startTime,
        uint256 endTime,
        uint256 carryInPot,
        uint16 houseEdgeBps
    );
    event TicketsBought(
        uint256 indexed drawId,
        address indexed buyer,
        uint256 count,
        uint256 cost,
        uint256 totalTickets,
        uint256 potAmount
    );
    event LotteryRandomRequested(uint256 indexed drawId, uint256 indexed requestId);
    event LotteryRandomFulfilled(uint256 indexed drawId, uint256 indexed requestId, uint256 randomWord);
    event LotteryFinalized(
        uint256 indexed drawId,
        address indexed winner,
        uint256 winnerIndex,
        uint256 winnerPayout,
        uint256 houseTake
    );
    event LotteryRolledOver(uint256 indexed drawId, address indexed token, uint256 amount);
    event MaxTicketsPerTxUpdated(uint32 maxTicketsPerTx);
    event MaxTicketsPerDrawUpdated(uint32 maxTicketsPerDraw);

    modifier onlyRouter() {
        if (msg.sender != address(vrfRouter)) revert Unauthorized();
        _;
    }

    constructor(address vault_, address vrfRouter_) Ownable(msg.sender) {
        if (vault_ == address(0) || vrfRouter_ == address(0)) revert InvalidAddress();
        vault = ITreasuryVault(vault_);
        vrfRouter = IVRFRouter(vrfRouter_);
    }

    function createDraw(address token, uint96 ticketPrice, uint32 startTime, uint32 endTime, uint16 houseEdgeBps)
        external
        onlyOwner
        whenNotPaused
        returns (uint256 drawId)
    {
        if (ticketPrice == 0) revert InvalidAmount();
        if (startTime >= endTime || endTime <= block.timestamp) revert InvalidDrawWindow();
        if (houseEdgeBps >= 10_000) revert InvalidHouseEdge(houseEdgeBps);

        drawId = ++nextDrawId;

        uint256 carryInPot = rolloverPotByToken[token];
        if (carryInPot > 0) {
            rolloverPotByToken[token] = 0;
        }

        Draw storage draw = draws[drawId];
        draw.token = token;
        draw.ticketPrice = ticketPrice;
        draw.houseEdgeBps = houseEdgeBps;
        draw.startTime = startTime;
        draw.endTime = endTime;
        draw.status = DrawStatus.Open;
        draw.potAmount = carryInPot;

        emit DrawCreated(drawId, token, ticketPrice, startTime, endTime, carryInPot, houseEdgeBps);
    }

    function buyTickets(uint256 drawId, uint32 count) external payable nonReentrant whenNotPaused {
        Draw storage draw = draws[drawId];
        if (draw.status != DrawStatus.Open) revert InvalidState(draw.status);
        if (count == 0) revert InvalidAmount();
        if (count > maxTicketsPerTx) revert TooManyTickets(count, maxTicketsPerTx);
        if (block.timestamp < draw.startTime) {
            revert DrawNotStarted(draw.startTime, block.timestamp);
        }
        if (block.timestamp >= draw.endTime) {
            revert DrawNotEnded(draw.endTime, block.timestamp);
        }

        uint256 newTotalTickets = draw.totalTickets + count;
        if (newTotalTickets > maxTicketsPerDraw) {
            revert DrawSoldOut(newTotalTickets, maxTicketsPerDraw);
        }

        uint256 cost = uint256(draw.ticketPrice) * count;
        _enforceTokenBetLimits(draw.token, cost);
        _collectPayment(draw.token, cost);
        vault.increaseReserved(draw.token, cost);

        uint256 firstTicketIndex = draw.totalTickets;
        for (uint256 i = 0; i < count; ++i) {
            ticketOwner[drawId][firstTicketIndex + i] = msg.sender;
        }

        draw.totalTickets = newTotalTickets;
        draw.potAmount += cost;
        ticketsOf[drawId][msg.sender] += count;

        emit TicketsBought(drawId, msg.sender, count, cost, draw.totalTickets, draw.potAmount);
    }

    function startDraw(uint256 drawId) external whenNotPaused {
        Draw storage draw = draws[drawId];
        if (draw.status != DrawStatus.Open) revert InvalidState(draw.status);
        if (block.timestamp < draw.endTime) {
            revert DrawNotEnded(draw.endTime, block.timestamp);
        }

        if (draw.totalTickets == 0) {
            draw.status = DrawStatus.RolledOver;
            rolloverPotByToken[draw.token] += draw.potAmount;
            emit LotteryRolledOver(drawId, draw.token, draw.potAmount);
            return;
        }

        uint256 requestId = vrfRouter.requestRandom(drawId, 1);
        draw.requestId = requestId;
        draw.status = DrawStatus.RandomRequested;
        requestIdToDrawId[requestId] = drawId;

        emit LotteryRandomRequested(drawId, requestId);
    }

    function onRandomness(uint256 roundId, uint256 requestId, uint256 randomWord) external override onlyRouter {
        uint256 drawId = requestIdToDrawId[requestId];
        if (drawId != roundId) revert RequestMismatch(drawId, roundId);

        Draw storage draw = draws[drawId];
        if (draw.status != DrawStatus.RandomRequested) revert InvalidState(draw.status);
        if (draw.requestId != requestId) revert RequestMismatch(draw.requestId, requestId);

        draw.randomWord = randomWord;
        draw.status = DrawStatus.RandomFulfilled;
        emit LotteryRandomFulfilled(drawId, requestId, randomWord);
    }

    function finalizeDraw(uint256 drawId) external nonReentrant whenNotPaused {
        Draw storage draw = draws[drawId];
        if (draw.status != DrawStatus.RandomFulfilled) revert InvalidState(draw.status);

        if (draw.totalTickets == 0) {
            draw.status = DrawStatus.RolledOver;
            rolloverPotByToken[draw.token] += draw.potAmount;
            emit LotteryRolledOver(drawId, draw.token, draw.potAmount);
            return;
        }

        uint256 winnerIndex = draw.randomWord % draw.totalTickets;
        address winner = ticketOwner[drawId][winnerIndex];
        if (winner == address(0)) revert InvalidAddress();

        uint256 houseTake = (draw.potAmount * draw.houseEdgeBps) / 10_000;
        uint256 winnerPayout = draw.potAmount - houseTake;

        draw.winner = winner;
        draw.status = DrawStatus.Finalized;

        if (winnerPayout > 0) {
            vault.payout(draw.token, winner, winnerPayout);
        }
        if (houseTake > 0) {
            vault.decreaseReserved(draw.token, houseTake);
        }

        emit LotteryFinalized(drawId, winner, winnerIndex, winnerPayout, houseTake);
    }

    function getCurrentPrize(uint256 drawId) external view returns (uint256 grossPot, uint256 winnerPayout, uint256 houseTake) {
        Draw memory draw = draws[drawId];
        grossPot = draw.potAmount;
        houseTake = (draw.potAmount * draw.houseEdgeBps) / 10_000;
        winnerPayout = draw.potAmount - houseTake;
    }

    function setMaxTicketsPerTx(uint32 maxTicketsPerTx_) external onlyOwner {
        if (maxTicketsPerTx_ == 0) revert InvalidAmount();
        maxTicketsPerTx = maxTicketsPerTx_;
        emit MaxTicketsPerTxUpdated(maxTicketsPerTx_);
    }

    function setMaxTicketsPerDraw(uint32 maxTicketsPerDraw_) external onlyOwner {
        if (maxTicketsPerDraw_ == 0) revert InvalidAmount();
        maxTicketsPerDraw = maxTicketsPerDraw_;
        emit MaxTicketsPerDrawUpdated(maxTicketsPerDraw_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _enforceTokenBetLimits(address token, uint256 amount) internal view {
        (uint96 minBet, uint96 maxBet) = vault.getTokenBetLimits(token);
        if (maxBet == 0 || amount < minBet || amount > maxBet) {
            revert InvalidAmount();
        }
    }

    function _collectPayment(address token, uint256 amount) internal {
        if (token == address(0)) {
            if (msg.value != amount) revert InvalidAmount();
            (bool ok,) = payable(address(vault)).call{value: amount}("");
            if (!ok) revert EthTransferFailed();
            return;
        }

        if (msg.value != 0) revert InvalidAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(vault), amount);
    }
}

