// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./TickMath.sol";

interface ISlot0 {
    function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool);
}

interface ITapePool {
    function previewSwap(uint8 quote, bool tapeIn, uint256 amountIn) external view returns (uint256 fee, uint256 out);
}

interface IV2Reserves {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32);
}

/// Mark for one pool. TapeRisk reads observe() and turns the tick back into a 1e18 price.
/// Kind 0 reads a Uniswap v3 slot0.
/// Kind 1 is TAPE: one TAPE sold for OKB, then the USDT0/WOKB pool. The result is USDT per TAPE.
/// Kind 2 is a Pancake v2 base/WBNB pair, then the WBNB/USDT pool. The result is USDT per base.
/// Anyone can poke. Thirty seconds must pass. The tick is the pool, not a posted number.
contract DeskMark {
    address public immutable src;
    uint8 public immutable kind;
    bool public immutable quoteIsToken0;
    uint8 public immutable baseDec;
    uint8 public immutable quoteDec;
    uint8 public constant SLOTS = 32;
    address public constant OKB_USDT = 0xe3BE6A0137f1b0602Fc1a4841686f43B340a5082;
    address public constant WBNB_USDT = 0x172fcD41E0913e95784454622d1c3724f546f849;

    int24 public tick;
    uint8 public last;
    uint8 public count;

    struct Obs {
        uint32 time;
        int56 cum;
        int24 tick;
    }

    Obs[32] public obs;

    error Bad();

    constructor(address src_, uint8 kind_, bool quoteIsToken0_, uint8 baseDec_, uint8 quoteDec_) {
        if (src_ == address(0) || kind_ > 2) revert Bad();
        if (baseDec_ > 18 || quoteDec_ > 18) revert Bad();
        if (kind_ == 0 && baseDec_ < quoteDec_) revert Bad();
        src = src_;
        kind = kind_;
        quoteIsToken0 = quoteIsToken0_;
        baseDec = baseDec_;
        quoteDec = quoteDec_;
    }

    function poke() external {
        int24 next = _tick();
        uint32 nowT = uint32(block.timestamp);
        if (count == 0) {
            obs[0] = Obs(nowT, 0, next);
            tick = next;
            last = 0;
            count = 1;
            return;
        }
        Obs memory prev = obs[last];
        if (nowT < prev.time + 30) revert Bad();
        int56 cum = prev.cum + int56(prev.tick) * int56(uint56(nowT - prev.time));
        uint8 i = (last + 1) % SLOTS;
        obs[i] = Obs(nowT, cum, next);
        last = i;
        tick = next;
        if (count < SLOTS) count += 1;
    }

    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory cumulatives, uint160[] memory liquidity) {
        if (count == 0) revert Bad();
        Obs memory head = obs[last];
        uint32 nowT = uint32(block.timestamp);
        int56 nowCum = head.cum + int56(head.tick) * int56(uint56(nowT - head.time));
        cumulatives = new int56[](secondsAgos.length);
        liquidity = new uint160[](secondsAgos.length);
        for (uint256 i = 0; i < secondsAgos.length; i++) {
            uint32 ago = secondsAgos[i];
            if (ago == 0) {
                cumulatives[i] = nowCum;
                continue;
            }
            if (ago > nowT) revert Bad();
            cumulatives[i] = _at(nowT - ago);
        }
    }

    function _tick() internal view returns (int24) {
        uint256 price = _price();
        if (price < 1e16 || price > 10_000_000 ether) revert Bad();
        uint256 sq = (uint256(1) << 192) * 1e8 / price;
        uint256 root = _sqrt(sq);
        if (root < TickMath.MIN_SQRT_RATIO || root >= TickMath.MAX_SQRT_RATIO) revert Bad();
        return TickMath.getTickAtSqrtRatio(uint160(root));
    }

    /// USDT per one token, 1e18 scale. The perp divides this by 1e18.
    function _price() internal view returns (uint256) {
        if (kind == 1) {
            (, uint256 okbOut) = ITapePool(src).previewSwap(1, true, 10 ** uint256(baseDec));
            if (okbOut == 0) revert Bad();
            (uint160 sqrtX96,,,,,,) = ISlot0(OKB_USDT).slot0();
            if (sqrtX96 == 0) revert Bad();
            uint256 sq = uint256(sqrtX96) * uint256(sqrtX96);
            uint256 usdtPerOkb = ((uint256(1) << 192) * 1e12 / sq) * 1e18;
            if (usdtPerOkb == 0) revert Bad();
            return okbOut * usdtPerOkb / 1e18;
        }
        if (kind == 2) {
            (uint112 r0, uint112 r1,) = IV2Reserves(src).getReserves();
            uint256 wbnbRaw = quoteIsToken0 ? uint256(r0) : uint256(r1);
            uint256 baseRaw = quoteIsToken0 ? uint256(r1) : uint256(r0);
            if (baseRaw == 0 || wbnbRaw == 0) revert Bad();
            uint256 wbnbPer = wbnbRaw * (10 ** uint256(baseDec)) * 1e18 / (baseRaw * (10 ** uint256(quoteDec)));
            if (wbnbPer == 0) revert Bad();
            (uint160 sqrtX96,,,,,,) = ISlot0(WBNB_USDT).slot0();
            if (sqrtX96 == 0) revert Bad();
            uint256 sq = uint256(sqrtX96) * uint256(sqrtX96);
            uint256 span = uint256(1) << 192;
            uint256 usdtPerWbnb = span * 1e18 / sq;
            if (usdtPerWbnb == 0) revert Bad();
            return wbnbPer * usdtPerWbnb / 1e18;
        }
        (uint160 sqrtX96,,,,,,) = ISlot0(src).slot0();
        if (sqrtX96 == 0) revert Bad();
        uint256 sq = uint256(sqrtX96) * uint256(sqrtX96);
        uint256 span = uint256(1) << 192;
        uint256 scale = 10 ** uint256(baseDec - quoteDec);
        if (quoteIsToken0) return scale * 1e18 * span / sq;
        return sq / span * scale * 1e18 + (sq % span) * scale * 1e18 / span;
    }

    function _at(uint32 target) internal view returns (int56) {
        uint8 oldestI = last;
        for (uint8 n = 1; n < count; n++) oldestI = oldestI == 0 ? SLOTS - 1 : oldestI - 1;
        Obs memory oldest = obs[oldestI];
        if (target < oldest.time) return oldest.cum - int56(oldest.tick) * int56(uint56(oldest.time - target));
        uint8 i = last;
        for (uint8 n = 0; n < count; n++) {
            Obs memory row = obs[i];
            if (row.time <= target) return row.cum + int56(row.tick) * int56(uint56(target - row.time));
            if (n + 1 == count) break;
            i = i == 0 ? SLOTS - 1 : i - 1;
        }
        revert Bad();
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}
