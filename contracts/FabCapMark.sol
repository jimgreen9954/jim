// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "./TickMath.sol";

interface IFabView {
    function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
    function getLiquidity(bytes32 poolId) external view returns (uint128);
}

interface IFabLeg {
    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory, uint160[] memory);
    /// Only the first word is decoded. Extra slot0 words are ignored.
    function slot0() external view returns (uint160 sqrtPriceX96);
}

/// FAB mark in dollars, 18 decimals.
/// The BEM/FAB 0.9% v4 pool has no oracle. This contract never calls the v4 quoter.
/// poke() reads the pool tick from StateView, moves at most 50 ticks, and waits 30 seconds.
/// Those samples are averaged over 10 minutes. The dollar legs are the BEM/WOKB and
/// OKB/USDT0 pools' own 10-minute averages, not their spot prices.
/// guard() stays false until 10 minutes of samples exist, the StateView code changes,
/// or spot and this average differ by more than about 3%.
contract FabCapMark {
    address public immutable stateView;
    address public immutable bemPool;
    address public immutable okbPool;
    bytes32 public immutable poolId;
    bytes32 public immutable pinned;
    uint32 public constant WINDOW = 600;
    uint32 public constant GAP = 30;
    int24 public constant STEP = 50;
    int24 public constant SHIFT = 230270;
    int24 public constant BAND = 296;
    uint24 public constant POOL_FEE = 9000;

    struct Sample {
        uint32 at;
        int24 tick;
    }

    Sample[24] public samples;
    uint8 public count;
    uint8 public cursor;
    int24 public lastTick;
    uint32 public lastAt;
    uint32 public started;

    error Paused();
    error Early();
    error Price();

    constructor(address stateView_, address bemPool_, address okbPool_, bytes32 poolId_) {
        if (stateView_ == address(0) || bemPool_ == address(0) || okbPool_ == address(0) || poolId_ == bytes32(0)) revert Price();
        stateView = stateView_;
        bemPool = bemPool_;
        okbPool = okbPool_;
        poolId = poolId_;
        pinned = stateView_.codehash;
        if (pinned == bytes32(0)) revert Price();
        if (IFabView(stateView_).getLiquidity(poolId_) == 0) revert Price();
        int24 tick = _spotTick();
        samples[0] = Sample(uint32(block.timestamp), tick);
        count = 1;
        cursor = 1;
        lastTick = tick;
        lastAt = uint32(block.timestamp);
        started = uint32(block.timestamp);
        uint256 px = _px(_bookTick(false));
        if (px < 0.01 ether || px > 10 ether) revert Price();
    }

    function poke() external {
        if (address(stateView).codehash != pinned) revert Paused();
        if (block.timestamp < uint256(lastAt) + GAP) revert Early();
        int24 raw = _spotTick();
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
        if (address(stateView).codehash != pinned) return false;
        if (count < 20) return false;
        if (block.timestamp < uint256(started) + WINDOW) return false;
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
        int24 tick = _bookTick(false);
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
        return _px(_bookTick(false));
    }

    function spotUsd() external view returns (uint256) {
        return _px(_bookTick(true));
    }

    function _px(int24 tick) internal pure returns (uint256) {
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(tick);
        uint256 sq = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        uint256 px = (uint256(1) << 192) * 1e8 / sq;
        if (px == 0) revert Price();
        return px;
    }

    function _bookTick(bool spot) internal view returns (int24) {
        int256 sum = _usdTick(spot) + int256(SHIFT);
        if (sum > 800000 || sum < -800000) revert Price();
        return -int24(sum);
    }

    function _usdTick(bool spot) internal view returns (int256) {
        return int256(_logTick(_fabHuman(spot))) + int256(_logTick(_bemHuman(spot))) + int256(_logTick(_okbHuman(spot)));
    }

    /// BEM per 1 FAB, 18 decimals. Both tokens use 8 decimals, so the raw ratio is the human ratio.
    function _fabHuman(bool spot) internal view returns (uint256) {
        int24 tick = spot ? _spotTick() : _fabTwap();
        uint160 sqrtP = TickMath.getSqrtRatioAtTick(tick);
        if (sqrtP == 0) revert Price();
        uint256 sq = uint256(sqrtP) * uint256(sqrtP);
        uint256 human = (uint256(1) << 192) * 1e18 / sq;
        if (human == 0) revert Price();
        return human;
    }

    function _spotTick() internal view returns (int24 tick) {
        (uint160 sqrtP, int24 got, , uint24 lpFee) = IFabView(stateView).getSlot0(poolId);
        if (sqrtP == 0 || lpFee != POOL_FEE) revert Price();
        tick = got;
    }

    function _fabTwap() internal view returns (int24) {
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
        if (spot) return IFabLeg(pool).slot0();
        uint32[] memory ago = new uint32[](2);
        ago[0] = WINDOW;
        ago[1] = 0;
        (int56[] memory cum,) = IFabLeg(pool).observe(ago);
        int56 delta = cum[1] - cum[0];
        int24 tick = int24(delta / int56(uint56(WINDOW)));
        if (delta < 0 && delta % int56(uint56(WINDOW)) != 0) tick--;
        return TickMath.getSqrtRatioAtTick(tick);
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
