// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IVRFRouter {
    function requestRandom(uint256 roundId, uint32 numWords) external returns (uint256 requestId);

    function getVrfConfig()
        external
        view
        returns (
            address coordinator,
            uint256 subscriptionId,
            bytes32 keyHash,
            uint16 requestConfirmations,
            uint32 callbackGasLimit,
            bool nativePayment
        );
}

