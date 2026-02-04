// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract TestERC20 is ERC20, Ownable2Step {
    uint256 public constant FAUCET_AMOUNT = 1_000e18;

    constructor() ERC20("SC6107 Test Token", "SC7") Ownable(msg.sender) {
        _mint(msg.sender, 1_000_000e18);
    }

    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}

