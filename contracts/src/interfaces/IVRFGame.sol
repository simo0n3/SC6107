// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IVRFGame {
    function onRandomness(uint256 roundId, uint256 requestId, uint256 randomWord) external;
}

