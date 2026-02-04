// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {TreasuryVault} from "../src/TreasuryVault.sol";
import {VRFRouter} from "../src/VRFRouter.sol";
import {DiceGame} from "../src/DiceGame.sol";
import {LotteryGame} from "../src/LotteryGame.sol";
import {TestERC20} from "../src/TestERC20.sol";

contract Deploy is Script {
    struct DeployConfig {
        uint256 privateKey;
        uint256 subscriptionId;
        address vrfCoordinator;
        bytes32 keyHash;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        bool nativePayment;
        uint16 diceHouseEdgeBps;
        uint32 revealWindowSeconds;
        uint32 maxWaitSeconds;
        uint96 minEthBet;
        uint96 maxEthBet;
        uint96 minTokenBet;
        uint96 maxTokenBet;
        uint32 maxTicketsPerTx;
        uint32 maxTicketsPerDraw;
    }

    struct DeployedAddresses {
        address treasuryVault;
        address vrfRouter;
        address diceGame;
        address lotteryGame;
        address testToken;
    }

    function run() external returns (DeployedAddresses memory deployed) {
        DeployConfig memory cfg = _loadConfig();
        vm.startBroadcast(cfg.privateKey);

        TreasuryVault vault = new TreasuryVault();
        VRFRouter router = new VRFRouter(
            cfg.vrfCoordinator,
            cfg.subscriptionId,
            cfg.keyHash,
            cfg.requestConfirmations,
            cfg.callbackGasLimit,
            cfg.nativePayment
        );
        DiceGame dice =
            new DiceGame(address(vault), address(router), cfg.diceHouseEdgeBps, cfg.revealWindowSeconds, cfg.maxWaitSeconds);
        LotteryGame lottery = new LotteryGame(address(vault), address(router));
        TestERC20 testToken = new TestERC20();

        vault.setGameWhitelist(address(dice), true);
        vault.setGameWhitelist(address(lottery), true);
        router.setGameWhitelist(address(dice), true);
        router.setGameWhitelist(address(lottery), true);

        vault.setTokenBetLimits(address(0), cfg.minEthBet, cfg.maxEthBet);
        vault.setTokenBetLimits(address(testToken), cfg.minTokenBet, cfg.maxTokenBet);

        lottery.setMaxTicketsPerTx(cfg.maxTicketsPerTx);
        lottery.setMaxTicketsPerDraw(cfg.maxTicketsPerDraw);

        vm.stopBroadcast();

        deployed = DeployedAddresses({
            treasuryVault: address(vault),
            vrfRouter: address(router),
            diceGame: address(dice),
            lotteryGame: address(lottery),
            testToken: address(testToken)
        });
    }

    function _loadConfig() internal view returns (DeployConfig memory cfg) {
        cfg.privateKey = _loadPrivateKey();
        cfg.subscriptionId = vm.envUint("VRF_SUBSCRIPTION_ID");
        cfg.vrfCoordinator = vm.envOr("VRF_COORDINATOR", address(0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B));
        cfg.keyHash = vm.envOr(
            "VRF_KEY_HASH",
            bytes32(0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae)
        );
        cfg.requestConfirmations = uint16(vm.envOr("VRF_REQUEST_CONFIRMATIONS", uint256(3)));
        cfg.callbackGasLimit = uint32(vm.envOr("VRF_CALLBACK_GAS_LIMIT", uint256(300_000)));
        cfg.nativePayment = vm.envOr("VRF_NATIVE_PAYMENT", false);
        cfg.diceHouseEdgeBps = uint16(vm.envOr("DICE_HOUSE_EDGE_BPS", uint256(100)));
        cfg.revealWindowSeconds = uint32(vm.envOr("DICE_REVEAL_WINDOW", uint256(600)));
        cfg.maxWaitSeconds = uint32(vm.envOr("DICE_MAX_WAIT_FULFILL", uint256(1800)));
        cfg.minEthBet = uint96(vm.envOr("MIN_ETH_BET", uint256(0.001 ether)));
        cfg.maxEthBet = uint96(vm.envOr("MAX_ETH_BET", uint256(1 ether)));
        cfg.minTokenBet = uint96(vm.envOr("MIN_TOKEN_BET", uint256(1e18)));
        cfg.maxTokenBet = uint96(vm.envOr("MAX_TOKEN_BET", uint256(1000e18)));
        cfg.maxTicketsPerTx = uint32(vm.envOr("LOTTERY_MAX_TICKETS_PER_TX", uint256(50)));
        cfg.maxTicketsPerDraw = uint32(vm.envOr("LOTTERY_MAX_TICKETS_PER_DRAW", uint256(10_000)));
    }

    function _loadPrivateKey() internal view returns (uint256) {
        string memory key = vm.envString("PRIVATE_KEY");
        bytes memory keyBytes = bytes(key);
        if (keyBytes.length == 64) {
            key = string.concat("0x", key);
        }
        return vm.parseUint(key);
    }
}
