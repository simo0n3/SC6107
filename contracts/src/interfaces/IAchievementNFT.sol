// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAchievementNFT {
    function mintOnce(address to) external returns (bool mintedNow);

    function hasAchievement(address user) external view returns (bool);
}
