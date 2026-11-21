// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "./SyncLeg.sol";

interface IFabView {
    function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
    function getLiquidity(bytes32 poolId) external view returns (uint128);
}

interface IFabDollar {
    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory, uint160[] memory);
    function slot0() external view returns (uint160 sqrtPriceX96);
}

/// FAB mark. The v4 pool has no oracle. Trades record the StateView spot tick.
/// This contract never calls the quoter. StateView's runtime is pinned.
/// A new runtime stops new opens and liquidations. Closes still read mark().
contract FabSyncMark is SyncLeg {
    address public immutable stateView;
    address public immutable bemPool;
    address public immutable okbPool;
    bytes32 public immutable poolId;
    bytes32 public immutable pinnedCode;
    uint24 public constant POOL_FEE = 9000;

    constructor(address stateView_, address bemPool_, address okbPool_, bytes32 poolId_) {
        if (stateView_ == address(0) || bemPool_ == address(0) || okbPool_ == address(0) || poolId_ == bytes32(0)) revert Price();
        stateView = stateView_;
        bemPool = bemPool_;
        okbPool = okbPool_;
        poolId = poolId_;
        pinnedCode = stateView_.codehash;
        if (pinnedCode == bytes32(0) || pinnedCode == 0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470) revert Price();
        if (IFabView(stateView_).getLiquidity(poolId_) == 0) revert Price();
        _seed();
    }

    function _pinned() internal view override returns (bool) {
        return stateView.codehash == pinnedCode;
    }

    function _leg() internal view override returns (int24) {
        return _logTick(_fabHuman());
    }

    function _other(bool spot) internal view override returns (int24) {
        int256 sum = int256(_logTick(_bemHuman(spot))) + int256(_logTick(_okbHuman(spot)));
        if (sum > type(int24).max || sum < type(int24).min) revert Price();
        return int24(sum);
    }

    /// BEM per 1 FAB, 18 decimals. Both tokens use 8 decimals.
    function _fabHuman() internal view returns (uint256) {
        (uint160 sqrtP,, , uint24 lpFee) = IFabView(stateView).getSlot0(poolId);
        if (sqrtP == 0 || lpFee != POOL_FEE) revert Price();
        uint256 sq = uint256(sqrtP) * uint256(sqrtP);
        uint256 human = (uint256(1) << 192) * 1e18 / sq;
        if (human == 0) revert Price();
        return human;
    }

    /// WOKB per 1 BEM, 18 decimals. Token0 is BEM (8) and token1 is WOKB (18).
    function _bemHuman(bool spot) internal view returns (uint256) {
        uint160 sqrtP = _sqrt(bemPool, spot);
        if (sqrtP == 0) revert Price();
        uint256 sq = uint256(sqrtP) * uint256(sqrtP);
        uint256 human = (sq >> 192) * 1e8;
        if (human == 0) revert Price();
        return human;
    }

    /// USDT per 1 OKB, 18 decimals. Token0 is USDT0 (6) and token1 is WOKB (18).
    function _okbHuman(bool spot) internal view returns (uint256) {
        uint160 sqrtP = _sqrt(okbPool, spot);
        if (sqrtP == 0) revert Price();
        uint256 sq = uint256(sqrtP) * uint256(sqrtP);
        uint256 perRaw = (uint256(1) << 192) * 1e12 / sq;
        if (perRaw == 0) revert Price();
        return perRaw * 1e18;
    }

    function _sqrt(address pool, bool spot) internal view returns (uint160) {
        if (spot) return IFabDollar(pool).slot0();
        uint32[] memory ago = new uint32[](2);
        ago[0] = WINDOW;
        ago[1] = 0;
        (int56[] memory cum,) = IFabDollar(pool).observe(ago);
        int56 delta = cum[1] - cum[0];
        int24 tick = int24(delta / int56(uint56(WINDOW)));
        if (delta < 0 && delta % int56(uint56(WINDOW)) != 0) tick--;
        return TickMath.getSqrtRatioAtTick(tick);
    }
}
