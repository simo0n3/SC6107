// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AchievementNFT} from "../src/AchievementNFT.sol";
import {DiceGame} from "../src/DiceGame.sol";
import {LotteryGame} from "../src/LotteryGame.sol";
import {TreasuryVault} from "../src/TreasuryVault.sol";
import {IVRFGame} from "../src/interfaces/IVRFGame.sol";

contract MockVRFRouter {
    struct Request {
        address game;
        uint256 roundId;
    }

    uint256 public nextRequestId;
    mapping(uint256 => Request) public requests;

    function requestRandom(uint256 roundId, uint32) external returns (uint256 requestId) {
        requestId = ++nextRequestId;
        requests[requestId] = Request({game: msg.sender, roundId: roundId});
    }

    function fulfill(uint256 requestId, uint256 randomWord) external {
        Request memory request = requests[requestId];
        IVRFGame(request.game).onRandomness(request.roundId, requestId, randomWord);
    }
}

contract RevertingAchievementNFT {
    function mintOnce(address) external pure returns (bool) {
        revert("mint failed");
    }

    function hasAchievement(address) external pure returns (bool) {
        return false;
    }
}

contract GameAchievementIntegrationTest is Test {
    TreasuryVault internal vault;
    MockVRFRouter internal router;
    AchievementNFT internal achievement;
    DiceGame internal dice;
    LotteryGame internal lottery;

    address internal constant PLAYER = address(0xABCD);

    function setUp() external {
        vault = new TreasuryVault();
        router = new MockVRFRouter();
        achievement = new AchievementNFT();
        dice = new DiceGame(address(vault), address(router), address(achievement), 100, 600, 1800);
        lottery = new LotteryGame(address(vault), address(router), address(achievement));

        vault.setGameWhitelist(address(dice), true);
        vault.setGameWhitelist(address(lottery), true);
        vault.setTokenBetLimits(address(0), 1, type(uint96).max);

        achievement.grantRole(achievement.MINTER_ROLE(), address(dice));
        achievement.grantRole(achievement.MINTER_ROLE(), address(lottery));
    }

    function test_DiceRevealAndSettleMintsAchievementOnce() external {
        _settleDiceBetFor(PLAYER);
        assertTrue(achievement.hasAchievement(PLAYER));

        _settleDiceBetFor(PLAYER);
        assertEq(achievement.balanceOf(PLAYER), 1);
    }

    function test_LotteryBuyTicketsMintsAchievementOnce() external {
        uint256 drawId = _createOpenDraw();

        vm.deal(PLAYER, 10 ether);
        vm.prank(PLAYER);
        lottery.buyTickets{value: 1 ether}(drawId, 1);
        assertTrue(achievement.hasAchievement(PLAYER));

        vm.prank(PLAYER);
        lottery.buyTickets{value: 1 ether}(drawId, 1);
        assertEq(achievement.balanceOf(PLAYER), 1);
    }

    function test_DiceStillSettlesWhenAchievementMintReverts() external {
        RevertingAchievementNFT revertingNft = new RevertingAchievementNFT();
        dice.setAchievementNft(address(revertingNft));

        uint256 betId = _settleDiceBetFor(PLAYER);
        (,,,,,,,,,,, uint8 state) = dice.bets(betId);
        assertEq(state, 4);
    }

    function test_LotteryBuyStillSucceedsWhenAchievementMintReverts() external {
        RevertingAchievementNFT revertingNft = new RevertingAchievementNFT();
        lottery.setAchievementNft(address(revertingNft));

        uint256 drawId = _createOpenDraw();
        vm.deal(PLAYER, 2 ether);

        vm.prank(PLAYER);
        lottery.buyTickets{value: 1 ether}(drawId, 1);

        assertEq(lottery.ticketsOf(drawId, PLAYER), 1);
    }

    function _createOpenDraw() internal returns (uint256 drawId) {
        uint32 startTime = uint32(block.timestamp);
        uint32 endTime = uint32(block.timestamp + 1 days);
        drawId = lottery.createDraw(address(0), 1 ether, startTime, endTime, 100);
    }

    function _settleDiceBetFor(address player) internal returns (uint256 betId) {
        bytes32 salt = keccak256(abi.encodePacked("salt", player, block.number, block.timestamp));
        uint96 amount = uint96(1 ether);
        uint8 rollUnder = 99;
        bytes32 commitHash =
            keccak256(abi.encode(player, address(0), amount, rollUnder, salt, block.chainid, address(dice)));

        vm.deal(player, 10 ether);
        vm.prank(player);
        betId = dice.commitBet{value: amount}(address(0), amount, rollUnder, commitHash);

        (,,,,,,,,, uint256 requestId,,) = dice.bets(betId);
        router.fulfill(requestId, uint256(keccak256(abi.encodePacked("rand", betId))));

        vm.prank(player);
        dice.revealAndSettle(betId, salt);
    }
}
