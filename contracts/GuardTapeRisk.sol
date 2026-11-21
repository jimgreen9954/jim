// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "./TapeRisk.sol";

/// BEM book. Leverage stays 50. Opens and liquidations stop when the mark's
/// guard() is false. A close still uses the last mark.
contract GuardTapeRisk is TapeRisk {
    constructor(address usdt_, address pool_, uint256 unit_, address feeTo_) TapeRisk(usdt_, pool_, unit_, feeTo_) {}

    function _guard() internal view override {
        (bool ok, bytes memory data) = address(pool).staticcall(abi.encodeWithSignature("guard()"));
        if (!ok || data.length < 32 || abi.decode(data, (bool)) != true) revert Bad();
    }
}
