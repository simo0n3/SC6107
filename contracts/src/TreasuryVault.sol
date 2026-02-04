// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TreasuryVault is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error NotWhitelistedGame(address caller);
    error InvalidAddress();
    error InvalidAmount();
    error InvalidBetLimits();
    error BetAmountOutOfRange(uint256 amount, uint256 minBet, uint256 maxBet);
    error InsufficientLiquidity(address token, uint256 available, uint256 requiredAmount);
    error ReservedUnderflow(address token, uint256 reserved, uint256 amount);
    error EthTransferFailed();

    struct TokenBetLimit {
        uint96 minBet;
        uint96 maxBet;
        bool exists;
    }

    mapping(address => bool) public gameWhitelist;
    mapping(address => uint256) public reservedBalance;
    mapping(address => TokenBetLimit) private s_tokenBetLimits;

    event Funded(address indexed funder, address indexed token, uint256 amount);
    event Withdrawn(address indexed receiver, address indexed token, uint256 amount);
    event Payout(address indexed recipient, address indexed token, uint256 amount);
    event ReservedIncreased(address indexed game, address indexed token, uint256 amount, uint256 totalReserved);
    event ReservedDecreased(address indexed game, address indexed token, uint256 amount, uint256 totalReserved);
    event GameWhitelistUpdated(address indexed game, bool allowed);
    event TokenBetLimitsUpdated(address indexed token, uint96 minBet, uint96 maxBet);

    modifier onlyGame() {
        if (!gameWhitelist[msg.sender]) {
            revert NotWhitelistedGame(msg.sender);
        }
        _;
    }

    constructor() Ownable(msg.sender) {}

    receive() external payable {
        emit Funded(msg.sender, address(0), msg.value);
    }

    function fundETH() external payable whenNotPaused {
        if (msg.value == 0) revert InvalidAmount();
        emit Funded(msg.sender, address(0), msg.value);
    }

    function fundToken(address token, uint256 amount) external whenNotPaused {
        if (token == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, token, amount);
    }

    function withdrawETH(uint256 amount, address to) external onlyOwner nonReentrant whenNotPaused {
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();

        _checkFreeLiquidity(address(0), amount);
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert EthTransferFailed();

        emit Withdrawn(to, address(0), amount);
    }

    function withdrawToken(address token, uint256 amount, address to) external onlyOwner nonReentrant whenNotPaused {
        if (token == address(0) || to == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();

        _checkFreeLiquidity(token, amount);
        IERC20(token).safeTransfer(to, amount);

        emit Withdrawn(to, token, amount);
    }

    function setGameWhitelist(address game, bool allowed) external onlyOwner {
        if (game == address(0)) revert InvalidAddress();
        gameWhitelist[game] = allowed;
        emit GameWhitelistUpdated(game, allowed);
    }

    function setTokenBetLimits(address token, uint96 minBet, uint96 maxBet) external onlyOwner {
        if (maxBet == 0 || minBet > maxBet) revert InvalidBetLimits();
        s_tokenBetLimits[token] = TokenBetLimit({minBet: minBet, maxBet: maxBet, exists: true});
        emit TokenBetLimitsUpdated(token, minBet, maxBet);
    }

    function getTokenBetLimits(address token) external view returns (uint96 minBet, uint96 maxBet) {
        TokenBetLimit memory limits = s_tokenBetLimits[token];
        if (!limits.exists) {
            return (0, 0);
        }
        return (limits.minBet, limits.maxBet);
    }

    function ensureBetWithinLimits(address token, uint256 amount) external view {
        TokenBetLimit memory limits = s_tokenBetLimits[token];
        if (!limits.exists || amount < limits.minBet || amount > limits.maxBet) {
            revert BetAmountOutOfRange(amount, limits.minBet, limits.maxBet);
        }
    }

    function increaseReserved(address token, uint256 amount) external onlyGame whenNotPaused {
        if (amount == 0) revert InvalidAmount();

        uint256 nextReserved = reservedBalance[token] + amount;
        uint256 totalBalance = _balanceOf(token);
        if (nextReserved > totalBalance) {
            revert InsufficientLiquidity(token, totalBalance - reservedBalance[token], amount);
        }

        reservedBalance[token] = nextReserved;
        emit ReservedIncreased(msg.sender, token, amount, nextReserved);
    }

    function decreaseReserved(address token, uint256 amount) external onlyGame whenNotPaused {
        if (amount == 0) revert InvalidAmount();
        uint256 currentReserved = reservedBalance[token];
        if (amount > currentReserved) {
            revert ReservedUnderflow(token, currentReserved, amount);
        }
        uint256 nextReserved = currentReserved - amount;
        reservedBalance[token] = nextReserved;
        emit ReservedDecreased(msg.sender, token, amount, nextReserved);
    }

    function payout(address token, address to, uint256 amount) external onlyGame nonReentrant whenNotPaused {
        if (to == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();

        uint256 currentReserved = reservedBalance[token];
        if (amount > currentReserved) {
            revert ReservedUnderflow(token, currentReserved, amount);
        }

        reservedBalance[token] = currentReserved - amount;
        _transfer(token, to, amount);
        emit Payout(to, token, amount);
    }

    function getVaultBalances(address token) external view returns (uint256 totalBalance, uint256 reserved, uint256 freeBalance) {
        totalBalance = _balanceOf(token);
        reserved = reservedBalance[token];
        freeBalance = totalBalance - reserved;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _checkFreeLiquidity(address token, uint256 amount) internal view {
        uint256 totalBalance = _balanceOf(token);
        uint256 reserved = reservedBalance[token];
        uint256 freeBalance = totalBalance - reserved;
        if (amount > freeBalance) {
            revert InsufficientLiquidity(token, freeBalance, amount);
        }
    }

    function _balanceOf(address token) internal view returns (uint256) {
        if (token == address(0)) {
            return address(this).balance;
        }
        return IERC20(token).balanceOf(address(this));
    }

    function _transfer(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            (bool ok,) = payable(to).call{value: amount}("");
            if (!ok) revert EthTransferFailed();
            return;
        }
        IERC20(token).safeTransfer(to, amount);
    }
}
