// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "./TickMath.sol";

/// Shared clip and 10-minute average. A trade calls note(). The longer the
/// wait since the last note, the further one note may move, up to about 10%.
/// About 0.5% is allowed after 30 seconds. Orders still read the average.
abstract contract SyncLeg {
    uint32 public constant GAP = 30;
    uint32 public constant WINDOW = 600;
    int24 public constant STEP = 50;
    int24 public constant MAX_STEP = 1000;
    int24 public constant BAND = 296;
    int24 public constant SHIFT = 230270;

    struct Sample {
        uint32 at;
        int24 tick;
    }

    Sample[24] public samples;
    uint8 public count;
    uint8 public cursor;
    int24 public lastTick;
    uint32 public lastAt;
    uint32 public touched;

    error Price();

    function note() external {
        touched += 1;
        if (!_pinned()) return;
        uint32 nowT = uint32(block.timestamp);
        if (nowT < lastAt + GAP) return;
        int24 raw = _leg();
        int24 room = _room(nowT - lastAt);
        int24 next = raw;
        if (next > lastTick + room) next = lastTick + room;
        if (next < lastTick - room) next = lastTick - room;
        samples[cursor] = Sample(nowT, next);
        cursor = (cursor + 1) % 24;
        if (count < 24) count += 1;
        lastTick = next;
        lastAt = nowT;
    }

    function guard() external view returns (bool) {
        return _ok();
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

    function spotUsd() external view returns (uint256) {
        return _px(_spotTick());
    }

    function legTwap() external view returns (int24) {
        return _legTwap();
    }

    function _seed() internal {
        int24 tick = _leg();
        samples[0] = Sample(uint32(block.timestamp), tick);
        count = 1;
        cursor = 1;
        lastTick = tick;
        lastAt = uint32(block.timestamp);
        // Spot can sit more than 3% from the average. That pauses opens.
        // It must not stop the book from being deployed.
        uint256 px = _px(_bookTick());
        if (px < 0.01 ether || px > 100 ether) revert Price();
    }

    function _ok() internal view returns (bool) {
        if (!_pinned()) return false;
        int256 spot = _usd(true);
        int256 avg = _usd(false);
        int256 gap = spot > avg ? spot - avg : avg - spot;
        return gap <= int256(BAND);
    }

    function _room(uint32 elapsed) internal pure returns (int24) {
        uint256 steps = uint256(elapsed) / GAP;
        if (steps == 0) return 0;
        uint256 ticks = steps * uint256(uint24(STEP));
        if (ticks > uint256(uint24(MAX_STEP))) ticks = uint256(uint24(MAX_STEP));
        return int24(uint24(ticks));
    }

    function _bookTick() internal view returns (int24) {
        int256 sum = _usd(false) + int256(SHIFT);
        if (sum > 800000 || sum < -800000) revert Price();
        return -int24(sum);
    }

    function _spotTick() internal view returns (int24) {
        int256 sum = _usd(true) + int256(SHIFT);
        if (sum > 800000 || sum < -800000) revert Price();
        return -int24(sum);
    }

    function _usd(bool spot) internal view returns (int256) {
        int24 leg = spot ? _leg() : _legTwap();
        return int256(leg) + int256(_other(spot));
    }

    function _legTwap() internal view returns (int24) {
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

    function _px(int24 tick) internal pure returns (uint256) {
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(tick);
        uint256 sq = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        uint256 px = (uint256(1) << 192) * 1e8 / sq;
        if (px == 0) revert Price();
        return px;
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

    function _pinned() internal view virtual returns (bool);
    function _leg() internal view virtual returns (int24);
    function _other(bool spot) internal view virtual returns (int24);
}
