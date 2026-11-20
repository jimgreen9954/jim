// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "./TickMath.sol";

interface IUpSell {
    function quoteSell(uint256 amountIn) external view returns (uint256 wad, uint256 rest, uint256 gross, uint256 fee, uint256 net);
    function implementation() external view returns (address);
}

interface IBemTwap {
    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory, uint160[] memory);
    /// Pancake v3. Only the first word is decoded. feeProtocol is uint32 there, not uint8.
    function slot0() external view returns (uint160 sqrtPriceX96);
}

/// UP mark. The UP/BEM leg is the tapeup.io official pool. Each poke may move
/// that leg by at most 50 ticks, and pokes are at least 30 seconds apart.
/// The stored samples are averaged over 10 minutes. BEM/USDT is the Pancake
/// pool's own 10-minute average, not its spot price. The book tick is the sum.
/// If tapeup.io changes the proxy implementation, quotes stop moving and
/// guard() fails, so the book will not open or liquidate.
contract UpCapMark {
    address public immutable upPool;
    address public immutable bemPool;
    address public immutable pinnedImpl;
    uint32 public constant GAP = 30;
    uint32 public constant WINDOW = 600;
    int24 public constant STEP = 50;
    int24 public constant SHIFT = 230270;
    int24 public constant BAND = 296;
    uint256 public constant ONE_UP = 1e18;

    struct Sample {
        uint32 at;
        int24 tick;
    }

    Sample[24] public samples;
    uint8 public count;
    uint8 public cursor;
    int24 public lastTick;
    uint32 public lastAt;

    error Paused();
    error Early();
    error Price();

    constructor(address upPool_, address bemPool_) {
        if (upPool_ == address(0) || bemPool_ == address(0)) revert Price();
        upPool = upPool_;
        bemPool = bemPool_;
        pinnedImpl = IUpSell(upPool_).implementation();
        if (pinnedImpl == address(0)) revert Price();
        int24 tick = _spotUp();
        samples[0] = Sample(uint32(block.timestamp), tick);
        count = 1;
        cursor = 1;
        lastTick = tick;
        lastAt = uint32(block.timestamp);
        uint256 twapBem = _bemHuman(false);
        uint256 spotBem = _bemHuman(true);
        uint256 gap = twapBem > spotBem ? twapBem - spotBem : spotBem - twapBem;
        if (spotBem == 0 || gap * 100 > spotBem * 3) revert Price();
    }

    function poke() external {
        if (!_implOk()) revert Paused();
        if (block.timestamp < uint256(lastAt) + GAP) revert Early();
        int24 raw = _spotUp();
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
        if (!_implOk()) return false;
        int24 spot = _spotUp();
        int24 avg = _upTwap();
        int24 gap = spot > avg ? spot - avg : avg - spot;
        return gap <= BAND;
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

    /// Official spot times the BEM pool spot. The deploy stops if this is far from mark().
    function spotUsd() external view returns (uint256) {
        int256 sum = int256(_spotUp()) + int256(_bemTick(true)) + int256(SHIFT);
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

    function upTwap() external view returns (int24) {
        return _upTwap();
    }

    function _implOk() internal view returns (bool) {
        try IUpSell(upPool).implementation() returns (address impl) {
            return impl == pinnedImpl;
        } catch {
            return false;
        }
    }

    function _spotUp() internal view returns (int24) {
        (, , , , uint256 net) = IUpSell(upPool).quoteSell(ONE_UP);
        if (net == 0) revert Price();
        return _logTick(net * 1e10);
    }

    function _bookTick() internal view returns (int24) {
        int256 sum = int256(_upTwap()) + int256(_bemTick(false)) + int256(SHIFT);
        if (sum > 800000 || sum < -800000) revert Price();
        return -int24(sum);
    }

    function _bemTick(bool spot) internal view returns (int24) {
        return _logTick(_bemHuman(spot));
    }

    /// USDT per 1 BEM, 18 decimals. The pool has USDT as token0 and BEM as token1.
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

    function _upTwap() internal view returns (int24) {
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
