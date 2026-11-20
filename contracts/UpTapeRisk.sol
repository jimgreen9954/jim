// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./TapeRisk.sol";

/// UP book. Five times leverage at most. Opens and liquidations stop when the
/// mark says the official pool moved too far, or its implementation changed.
/// A close still uses the last mark, so a position can be closed.
contract UpTapeRisk is TapeRisk {
    constructor(address usdt_, address pool_, uint256 unit_, address feeTo_) TapeRisk(usdt_, pool_, unit_, feeTo_) {}

    function _maxLev(uint256) internal view override returns (uint16) {
        return 5;
    }

    function _guard() internal view override {
        (bool ok, bytes memory data) = address(pool).staticcall(abi.encodeWithSignature("guard()"));
        if (!ok || data.length < 32 || abi.decode(data, (bool)) != true) revert Bad();
    }
}
