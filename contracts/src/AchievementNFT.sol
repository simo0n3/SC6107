// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract AchievementNFT is ERC721, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    error InvalidRecipient();

    mapping(address => bool) public minted;

    constructor() ERC721("SC6107 Achievement", "SC7A") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function mintOnce(address to) external onlyRole(MINTER_ROLE) returns (bool mintedNow) {
        if (to == address(0)) revert InvalidRecipient();
        if (minted[to]) return false;

        minted[to] = true;
        _safeMint(to, uint256(uint160(to)));
        return true;
    }

    function hasAchievement(address user) external view returns (bool) {
        return minted[user];
    }
}
