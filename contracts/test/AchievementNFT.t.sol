// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AchievementNFT} from "../src/AchievementNFT.sol";

contract AchievementNFTTest is Test {
    AchievementNFT internal nft;

    address internal constant MINTER = address(0xBEEF);
    address internal constant USER = address(0xA11CE);

    function setUp() external {
        nft = new AchievementNFT();
        nft.grantRole(nft.MINTER_ROLE(), MINTER);
    }

    function test_NonMinterCannotMintOnce() external {
        vm.prank(USER);
        vm.expectRevert();
        nft.mintOnce(USER);
    }

    function test_MintOnceMintsExpectedToken() external {
        vm.prank(MINTER);
        bool mintedNow = nft.mintOnce(USER);

        assertTrue(mintedNow);
        assertTrue(nft.hasAchievement(USER));
        assertEq(nft.ownerOf(uint256(uint160(USER))), USER);
    }

    function test_MintOnceReturnsFalseForDuplicate() external {
        vm.startPrank(MINTER);
        bool firstMint = nft.mintOnce(USER);
        bool secondMint = nft.mintOnce(USER);
        vm.stopPrank();

        assertTrue(firstMint);
        assertFalse(secondMint);
        assertEq(nft.balanceOf(USER), 1);
    }
}
