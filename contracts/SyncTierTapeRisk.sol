// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "./TapeRisk.sol";

/// UP and TAPE book. Each open, close, liquidation and margin move records the mark.
/// Leverage is tiered. Total entry notional cannot pass CAP.
/// Opens and liquidations stop when guard() is false. A close still uses mark().
contract SyncTierTapeRisk is TapeRisk {
    uint256 public immutable CAP;

    constructor(address usdt_, address pool_, uint256 unit_, address feeTo_, uint256 cap_)
        TapeRisk(usdt_, pool_, unit_, feeTo_)
    {
        if (cap_ == 0) revert Bad();
        CAP = cap_;
    }

    function _maxLev(uint256 margin) internal view override returns (uint16) {
        if (margin <= MIN_MARGIN * 20) return 50;
        if (margin <= MIN_MARGIN * 100) return 20;
        return 5;
    }

    function _cap() internal view override returns (uint256) {
        return CAP;
    }

    function _guard() internal view override {
        (bool ok, bytes memory data) = address(pool).staticcall(abi.encodeWithSignature("guard()"));
        if (!ok || data.length < 32 || abi.decode(data, (bool)) != true) revert Bad();
    }

    function _note() internal override {
        address(pool).call(abi.encodeWithSignature("note()"));
    }
}
