// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Stand-in for a Coinbase B20 stock token in tests: 8 decimals, plus the
///         multiplier surface the real assets expose. Not deployed to mainnet.
contract MockB20 is ERC20 {
    uint8 private immutable _decimals;
    uint256 public multiplier = 1e18;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function WAD_PRECISION() external pure returns (uint256) {
        return 1e18;
    }

    function setMultiplier(uint256 m) external {
        multiplier = m;
    }

    function toScaledBalance(uint256 raw) external view returns (uint256) {
        return (raw * multiplier) / 1e18;
    }
}

/// @notice A token that skims a fee on transfer, to prove the vault credits what it
///         actually received rather than what was requested.
contract FeeOnTransferToken is ERC20 {
    uint256 public feeBps = 100; // 1%

    constructor() ERC20("Fee", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0)) {
            super._update(from, to, value);
            return;
        }
        uint256 fee = (value * feeBps) / 10_000;
        super._update(from, address(0xdead), fee);
        super._update(from, to, value - fee);
    }
}
