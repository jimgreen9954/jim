// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "./TickMath.sol";

interface ITapeSwap {
    function previewSwap(uint8 quote, bool tapeIn, uint256 amountIn) external view returns (uint256 fee, uint256 out);
}

interface IOkbTwap {
    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory, uint160[] memory);
    /// Only the first word is decoded.
    function slot0() external view returns (uint160 sqrtPriceX96);
}

/// TAPE mark. One TAPE sold into the official pool's OKB side.
/// That leg moves at most 50 ticks per poke, and pokes are at least 30 seconds apart.
/// Those samples are averaged over 10 minutes. OKB/USDT0 is that pool's own
/// 10-minute average, not its spot price. USDT0 is token0 and WOKB is token1.
/// If the official spot and this average differ by more than about 3%, guard()
/// is false and the book will not open or liquidate. Close still uses mark().
contract TapeCapMark {
    address public immutable tapePool;
    address public immutable okbPool;
    uint32 public constant GAP = 30;
    uint32 public constant WINDOW = 600;
    int24 public constant STEP = 50;
    int24 public constant SHIFT = 230270;
    int24 public constant BAND = 296;
    uint256 public constant ONE_TAPE = 1e8;
    uint8 public constant OKB_QUOTE = 1;

    struct Sample {
        uint32 at;
        int24 tick;
    }

    Sample[24] public samples;
    uint8 public count;
    uint8 public cursor;
    int24 public lastTick;
    uint32 public lastAt;

    error Early();
    error Price();

    constructor(address tapePool_, address okbPool_) {
        if (tapePool_ == address(0) || okbPool_ == address(0)) revert Price();
        tapePool = tapePool_;
        okbPool = okbPool_;
        int24 tick = _tapeSpot();
        samples[0] = Sample(uint32(block.timestamp), tick);
        count = 1;
        cursor = 1;
        lastTick = tick;
        lastAt = uint32(block.timestamp);
        uint256 twapOkb = _okbHuman(false);
        uint256 spotOkb = _okbHuman(true);
        uint256 gap = twapOkb > spotOkb ? twapOkb - spotOkb : spotOkb - twapOkb;
        if (spotOkb == 0 || gap * 100 > spotOkb * 3) revert Price();
        uint256 px = _px(_bookTick());
        if (px < 0.01 ether || px > 100 ether) revert Price();
    }

    function poke() external {
        if (block.timestamp < uint256(lastAt) + GAP) revert Early();
        int24 raw = _tapeSpot();
        int24 next = raw;
        if (next > lastTick + STEP) next = lastTick + STEP;
        if (next < lastTick - STEP) next = lastTick - STEP;
        samples[cursor] = Sample(uint32(block.timestamp), next);
        cursor = (cursor + 1) % 24;
        if (count < 24) count += 1;
        lastTick = next;
        lastAt = uint32(block.timestamp);
    }

    function guard() external view returns (bool) {
        int256 spot = _usdTick(true);
        int256 avg = _usdTick(false);
        int256 gap = spot > avg ? spot - avg : avg - spot;
        return gap <= int256(BAND);
    }

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

    function mark() external view returns (uint256) {
        return _px(_bookTick());
    }

    /// Official TAPE/OKB spot times the OKB pool spot.
    function spotUsd() external view returns (uint256) {
        int256 sum = int256(_tapeSpot()) + int256(_logTick(_okbHuman(true))) + int256(SHIFT);
        if (sum > 800000 || sum < -800000) revert Price();
        return _px(-int24(sum));
    }

    function _px(int24 tick) internal pure returns (uint256) {
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(tick);
        uint256 sq = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        uint256 px = (uint256(1) << 192) * 1e8 / sq;
        if (px == 0) revert Price();
        return px;
    }

    function _bookTick() internal view returns (int24) {
        int256 sum = _usdTick(false) + int256(SHIFT);
        if (sum > 800000 || sum < -800000) revert Price();
        return -int24(sum);
    }

    function _usdTick(bool spot) internal view returns (int256) {
        int24 tape = spot ? _tapeSpot() : _tapeTwap();
        return int256(tape) + int256(_logTick(_okbHuman(spot)));
    }

    function _tapeSpot() internal view returns (int24) {
        (, uint256 out) = ITapeSwap(tapePool).previewSwap(OKB_QUOTE, true, ONE_TAPE);
        if (out == 0) revert Price();
        return _logTick(out);
    }

    /// 18-decimal USDT per 1 OKB. USDT0 is token0, WOKB is token1.
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

    function _tapeTwap() internal view returns (int24) {
        uint32 nowT = uint32(block.timestamp);
        uint32 start = nowT > WINDOW ? nowT - WINDOW : 0;
        int24 carry = samples[0].tick;
        uint32 from = start;
        int256 area;
        uint8 n = count;
        for (uint8 k; k < n; k++) {
            uint8 idx = (cursor + 24 - n + k) % 24;
            Sample memory s = samples[idx];
            if (s.at <= start) {
                carry = s.tick;
                continue;
            }
            if (s.at > from) area += int256(carry) * int256(uint256(s.at - from));
            carry = s.tick;
            from = s.at;
        }
        if (nowT > from) area += int256(carry) * int256(uint256(nowT - from));
        uint32 span = nowT - start;
        if (span == 0) return carry;
        return int24(area / int256(uint256(span)));
    }

    function _logTick(uint256 human) internal pure returns (int24) {
        if (human == 0) revert Price();
        if (human == 1e18) return 0;
        if (human > 1e18) return int24(int256(_search(human)));
        return -int24(int256(_search(1e36 / human)));
    }

    function _search(uint256 human) internal pure returns (uint256) {
        uint256 lo;
        uint256 hi = 700000;
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            if (_pow(mid) <= human) lo = mid;
            else hi = mid - 1;
        }
        return lo;
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
