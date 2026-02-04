// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IVRFCoordinatorV2Plus} from "chainlink/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";
import {VRFV2PlusClient} from "chainlink/vrf/dev/libraries/VRFV2PlusClient.sol";
import {IVRFGame} from "./interfaces/IVRFGame.sol";
import {IVRFRouter} from "./interfaces/IVRFRouter.sol";

contract VRFRouter is Ownable2Step, Pausable, IVRFRouter {
    error NotCoordinator(address caller);
    error NotWhitelistedGame(address caller);
    error InvalidAddress();
    error InvalidConfig();
    error InvalidNumWords(uint32 numWords);
    error UnknownRequest(uint256 requestId);
    error AlreadyFulfilled(uint256 requestId);
    error NotFulfilled(uint256 requestId);
    error AlreadyDelivered(uint256 requestId);

    struct RequestContext {
        address game;
        uint256 roundId;
        uint32 numWords;
        bool fulfilled;
        bool delivered;
        uint256 randomWord;
    }

    IVRFCoordinatorV2Plus public immutable coordinator;

    uint256 public subscriptionId;
    bytes32 public keyHash;
    uint16 public requestConfirmations;
    uint32 public callbackGasLimit;
    bool public nativePayment;

    mapping(address => bool) public gameWhitelist;
    mapping(uint256 => RequestContext) private s_requests;

    event GameWhitelistUpdated(address indexed game, bool allowed);
    event VrfConfigUpdated(
        uint256 indexed subscriptionId,
        bytes32 indexed keyHash,
        uint16 requestConfirmations,
        uint32 callbackGasLimit,
        bool nativePayment
    );
    event RandomRequested(uint256 indexed requestId, address indexed game, uint256 indexed roundId, uint32 numWords);
    event RandomFulfilled(uint256 indexed requestId, address indexed game, uint256 indexed roundId, uint256 randomWord);
    event RandomDelivered(uint256 indexed requestId, address indexed game, uint256 indexed roundId);
    event RandomDeliveryFailed(uint256 indexed requestId, address indexed game, uint256 indexed roundId, bytes reason);

    modifier onlyGame() {
        if (!gameWhitelist[msg.sender]) {
            revert NotWhitelistedGame(msg.sender);
        }
        _;
    }

    constructor(
        address coordinator_,
        uint256 subscriptionId_,
        bytes32 keyHash_,
        uint16 requestConfirmations_,
        uint32 callbackGasLimit_,
        bool nativePayment_
    ) Ownable(msg.sender) {
        if (coordinator_ == address(0)) revert InvalidAddress();
        coordinator = IVRFCoordinatorV2Plus(coordinator_);
        _setVrfConfig(subscriptionId_, keyHash_, requestConfirmations_, callbackGasLimit_, nativePayment_);
    }

    function requestRandom(uint256 roundId, uint32 numWords) external onlyGame whenNotPaused returns (uint256 requestId) {
        if (numWords == 0) revert InvalidNumWords(numWords);

        requestId = coordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: keyHash,
                subId: subscriptionId,
                requestConfirmations: requestConfirmations,
                callbackGasLimit: callbackGasLimit,
                numWords: numWords,
                extraArgs: VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: nativePayment}))
            })
        );

        s_requests[requestId] = RequestContext({
            game: msg.sender,
            roundId: roundId,
            numWords: numWords,
            fulfilled: false,
            delivered: false,
            randomWord: 0
        });

        emit RandomRequested(requestId, msg.sender, roundId, numWords);
    }

    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external {
        if (msg.sender != address(coordinator)) {
            revert NotCoordinator(msg.sender);
        }

        RequestContext storage request = s_requests[requestId];
        if (request.game == address(0)) {
            revert UnknownRequest(requestId);
        }
        if (request.fulfilled) {
            revert AlreadyFulfilled(requestId);
        }

        request.fulfilled = true;
        if (randomWords.length > 0) {
            request.randomWord = randomWords[0];
        }

        emit RandomFulfilled(requestId, request.game, request.roundId, request.randomWord);
        _tryDeliver(requestId, request);
    }

    function retryDelivery(uint256 requestId) external whenNotPaused {
        RequestContext storage request = s_requests[requestId];
        if (request.game == address(0)) {
            revert UnknownRequest(requestId);
        }
        if (!request.fulfilled) {
            revert NotFulfilled(requestId);
        }
        if (request.delivered) {
            revert AlreadyDelivered(requestId);
        }
        _tryDeliver(requestId, request);
    }

    function setGameWhitelist(address game, bool allowed) external onlyOwner {
        if (game == address(0)) revert InvalidAddress();
        gameWhitelist[game] = allowed;
        emit GameWhitelistUpdated(game, allowed);
    }

    function setVrfConfig(
        uint256 subscriptionId_,
        bytes32 keyHash_,
        uint16 requestConfirmations_,
        uint32 callbackGasLimit_,
        bool nativePayment_
    ) external onlyOwner {
        _setVrfConfig(subscriptionId_, keyHash_, requestConfirmations_, callbackGasLimit_, nativePayment_);
    }

    function getRequestContext(uint256 requestId)
        external
        view
        returns (address game, uint256 roundId, uint32 numWords, bool fulfilled, bool delivered, uint256 randomWord)
    {
        RequestContext memory request = s_requests[requestId];
        return (request.game, request.roundId, request.numWords, request.fulfilled, request.delivered, request.randomWord);
    }

    function getVrfConfig()
        external
        view
        returns (
            address coordinator_,
            uint256 subscriptionId_,
            bytes32 keyHash_,
            uint16 requestConfirmations_,
            uint32 callbackGasLimit_,
            bool nativePayment_
        )
    {
        return (address(coordinator), subscriptionId, keyHash, requestConfirmations, callbackGasLimit, nativePayment);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _setVrfConfig(
        uint256 subscriptionId_,
        bytes32 keyHash_,
        uint16 requestConfirmations_,
        uint32 callbackGasLimit_,
        bool nativePayment_
    ) internal {
        if (subscriptionId_ == 0 || keyHash_ == bytes32(0) || requestConfirmations_ == 0 || callbackGasLimit_ == 0) {
            revert InvalidConfig();
        }
        subscriptionId = subscriptionId_;
        keyHash = keyHash_;
        requestConfirmations = requestConfirmations_;
        callbackGasLimit = callbackGasLimit_;
        nativePayment = nativePayment_;

        emit VrfConfigUpdated(subscriptionId_, keyHash_, requestConfirmations_, callbackGasLimit_, nativePayment_);
    }

    function _tryDeliver(uint256 requestId, RequestContext storage request) internal {
        if (request.delivered) {
            return;
        }

        (bool ok, bytes memory reason) = request.game.call(
            abi.encodeWithSelector(IVRFGame.onRandomness.selector, request.roundId, requestId, request.randomWord)
        );

        if (ok) {
            request.delivered = true;
            emit RandomDelivered(requestId, request.game, request.roundId);
        } else {
            emit RandomDeliveryFailed(requestId, request.game, request.roundId, reason);
        }
    }
}

