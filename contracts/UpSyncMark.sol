// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "./SyncLeg.sol";

interface IUpSell {
    function quoteSell(uint256 amountIn) external view returns (uint256 wad, uint256 rest, uint256 gross, uint256 fee, uint256 net);
    function implementation() external view returns (address);
}

interface IBemTwap {
    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory, uint160[] memory);
    function slot0() external view returns (uint160 sqrtPriceX96);
}

/// UP mark. Trades call note(). The official pool's implementation is pinned.
/// A new implementation stops new opens and liquidations. Closes still read mark().
contract UpSyncMark is SyncLeg {
    address public immutable upPool;
    address public immutable bemPool;
    address public immutable pinnedImpl;
    uint256 public constant ONE_UP = 1e18;

    constructor(address upPool_, address bemPool_) {
        if (upPool_ == address(0) || bemPool_ == address(0)) revert Price();
        upPool = upPool_;
        bemPool = bemPool_;
        pinnedImpl = IUpSell(upPool_).implementation();
        if (pinnedImpl == address(0)) revert Price();
        _seed();
    }

    function _pinned() internal view override returns (bool) {
        try IUpSell(upPool).implementation() returns (address impl) {
            return impl == pinnedImpl;
        } catch {
            return false;
        }
    }

    function _leg() internal view override returns (int24) {
        (,,,, uint256 net) = IUpSell(upPool).quoteSell(ONE_UP);
        if (net == 0) revert Price();
        return _logTick(net * 1e10);
    }

    function _other(bool spot) internal view override returns (int24) {
        return _logTick(_bemHuman(spot));
    }

    /// USDT per 1 BEM, scaled the same way as UpCapMark. USDT is token0.
    function _bemHuman(bool spot) internal view returns (uint256) {
        uint160 sqrtP;
        if (spot) {
            sqrtP = IBemTwap(bemPool).slot0();
        } else {
            uint32[] memory ago = new uint32[](2);
            ago[0] = WINDOW;
            ago[1] = 0;
            (int56[] memory cum,) = IBemTwap(bemPool).observe(ago);
            int56 delta = cum[1] - cum[0];
            int24 tick = int24(delta / int56(uint56(WINDOW)));
            if (delta < 0 && delta % int56(uint56(WINDOW)) != 0) tick--;
            sqrtP = TickMath.getSqrtRatioAtTick(tick);
        }
        uint256 sq = uint256(sqrtP) * uint256(sqrtP);
        uint256 raw = ((uint256(1) << 192) * 1e18) / sq;
        return raw / 1e10;
    }
}
