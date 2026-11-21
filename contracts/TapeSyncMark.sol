// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "./SyncLeg.sol";

interface ITapeSwap {
    function previewSwap(uint8 quote, bool tapeIn, uint256 amountIn) external view returns (uint256 fee, uint256 out);
}

interface IOkbTwap {
    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory, uint160[] memory);
    function slot0() external view returns (uint160 sqrtPriceX96);
}

/// TAPE mark. Trades call note(). The official pool's runtime code is pinned.
/// A new runtime stops new opens and liquidations. Closes still read mark().
contract TapeSyncMark is SyncLeg {
    address public immutable tapePool;
    address public immutable okbPool;
    bytes32 public immutable pinnedCode;
    uint256 public constant ONE_TAPE = 1e8;
    uint8 public constant OKB_QUOTE = 1;

    constructor(address tapePool_, address okbPool_) {
        if (tapePool_ == address(0) || okbPool_ == address(0)) revert Price();
        tapePool = tapePool_;
        okbPool = okbPool_;
        pinnedCode = tapePool_.codehash;
        if (pinnedCode == bytes32(0) || pinnedCode == 0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470) revert Price();
        _seed();
    }

    function _pinned() internal view override returns (bool) {
        return tapePool.codehash == pinnedCode;
    }

    function _leg() internal view override returns (int24) {
        (, uint256 out) = ITapeSwap(tapePool).previewSwap(OKB_QUOTE, true, ONE_TAPE);
        if (out == 0) revert Price();
        return _logTick(out);
    }

    function _other(bool spot) internal view override returns (int24) {
        return _logTick(_okbHuman(spot));
    }

    /// 18-decimal USD per 1 OKB. USDT0 is token0, WOKB is token1.
    function _okbHuman(bool spot) internal view returns (uint256) {
        uint160 sqrtP;
        if (spot) {
            sqrtP = IOkbTwap(okbPool).slot0();
        } else {
            uint32[] memory ago = new uint32[](2);
            ago[0] = WINDOW;
            ago[1] = 0;
            (int56[] memory cum,) = IOkbTwap(okbPool).observe(ago);
            int56 delta = cum[1] - cum[0];
            int24 tick = int24(delta / int56(uint56(WINDOW)));
            if (delta < 0 && delta % int56(uint56(WINDOW)) != 0) tick--;
            sqrtP = TickMath.getSqrtRatioAtTick(tick);
        }
        if (sqrtP == 0) revert Price();
        uint256 sq = uint256(sqrtP) * uint256(sqrtP);
        uint256 perRaw = (uint256(1) << 192) * 1e12 / sq;
        if (perRaw == 0) revert Price();
        return perRaw * 1e18;
    }
}
