// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITreasuryVault {
    function increaseReserved(address token, uint256 amount) external;

    function decreaseReserved(address token, uint256 amount) external;

    function payout(address token, address to, uint256 amount) external;

    function getTokenBetLimits(address token) external view returns (uint96 minBet, uint96 maxBet);

    function getVaultBalances(address token) external view returns (uint256 totalBalance, uint256 reservedBalance, uint256 freeBalance);
}

