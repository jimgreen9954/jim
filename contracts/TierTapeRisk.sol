// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./TapeRisk.sol";

/// UP, TAPE and FAB book. Leverage depends on the margin of that call.
/// 20 units and under can use 50x. 100 units and under can use 20x.
/// Anything larger stops at 5x. One unit is 1 USDT or 1 USDT0.
/// Opens and liquidations stop when the mark's guard() is false.
/// A close still uses the last mark.
contract TierTapeRisk is TapeRisk {
    constructor(address usdt_, address pool_, uint256 unit_, address feeTo_) TapeRisk(usdt_, pool_, unit_, feeTo_) {}

    function _maxLev(uint256 margin) internal view override returns (uint16) {
        if (margin <= MIN_MARGIN * 20) return 50;
        if (margin <= MIN_MARGIN * 100) return 20;
        return 5;
    }

    function _guard() internal view override {
        (bool ok, bytes memory data) = address(pool).staticcall(abi.encodeWithSignature("guard()"));
        if (!ok || data.length < 32 || abi.decode(data, (bool)) != true) revert Bad();
    }
}
