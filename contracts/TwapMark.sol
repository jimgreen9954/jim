// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "./TickMath.sol";

interface IUniTwap {
    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory, uint160[] memory);
}

/// Mark for a Uniswap v3 pool. The book reads observe() and prices it as
/// px = 1e8 / 1.0001^tick. The tick returned here is the pool's own 10-minute
/// average, shifted so that px is the quote-per-base price in 1e18 units.
/// A single trade cannot move a 10-minute average to a new price.
contract TwapMark {
    address public immutable src;
    bool public immutable quoteIsToken0;
    uint8 public immutable baseDec;
    uint8 public immutable quoteDec;
    uint32 public constant WINDOW = 600;

    constructor(address src_, bool quoteIsToken0_, uint8 baseDec_, uint8 quoteDec_) {
        if (src_ == address(0)) revert();
        if (baseDec_ > 18 || quoteDec_ > 18) revert();
        src = src_;
        quoteIsToken0 = quoteIsToken0_;
        baseDec = baseDec_;
        quoteDec = quoteDec_;
    }

    function count() external pure returns (uint8) {
        return 1;
    }

    function poke() external {}

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        int24 tick = _bookTick();
        uint256 n = secondsAgos.length;
        tickCumulatives = new int56[](n);
        secondsPerLiquidityCumulativeX128s = new uint160[](n);
        uint32 nowT = uint32(block.timestamp);
        for (uint256 i; i < n; i++) {
            uint32 ago = secondsAgos[i];
            uint32 t = ago > nowT ? 0 : nowT - ago;
            tickCumulatives[i] = int56(int256(tick) * int256(uint256(t)));
        }
    }

    /// The price a TapeRisk book would read from this mark, in 1e18 units.
    function mark() external view returns (uint256) {
        int24 tick = _bookTick();
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(tick);
        uint256 sq = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        uint256 px = (uint256(1) << 192) * 1e8 / sq;
        if (px == 0) revert();
        return px;
    }

    function _twap() internal view returns (int24 tick) {
        uint32[] memory ago = new uint32[](2);
        ago[0] = WINDOW;
        ago[1] = 0;
        (int56[] memory cum,) = IUniTwap(src).observe(ago);
        int56 delta = cum[1] - cum[0];
        tick = int24(delta / int56(uint56(WINDOW)));
        if (delta < 0 && delta % int56(uint56(WINDOW)) != 0) tick--;
    }

    function _bookTick() internal view returns (int24) {
        uint256 human = _human(TickMath.getSqrtRatioAtTick(_twap()));
        if (human == 0) revert();
        uint256 target = human * 1e10;
        uint256 lo;
        uint256 hi = 700000;
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            if (_pow(mid) <= target) lo = mid;
            else hi = mid - 1;
        }
        if (lo == 0 || lo > 700000) revert();
        return -int24(int256(lo));
    }

    /// Quote tokens for one base token, 18 decimals.
    function _human(uint160 sqrtP) internal view returns (uint256) {
        if (sqrtP == 0) revert();
        uint256 sq = uint256(sqrtP) * uint256(sqrtP);
        uint256 raw;
        if (quoteIsToken0) raw = ((uint256(1) << 192) * 1e18) / sq;
        else raw = (sq / (uint256(1) << 96)) * 1e18 / (uint256(1) << 96);
        if (baseDec == quoteDec) return raw;
        if (baseDec > quoteDec) return raw * (10 ** (baseDec - quoteDec));
        return raw / (10 ** (quoteDec - baseDec));
    }

    function _pow(uint256 n) internal pure returns (uint256) {
        uint256 r = 1e18;
        uint256 b = 1000100000000000000;
        while (n > 0) {
            if (n & 1 == 1) r = r * b / 1e18;
            b = b * b / 1e18;
            n >>= 1;
        }
        return r;
    }
}
