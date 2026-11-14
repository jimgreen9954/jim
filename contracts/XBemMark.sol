// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./TickMath.sol";

interface ISlot0 {
    function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool);
}

/// Mark for the X Layer BEM book.
/// Reads the liquid Uniswap v3 BEM/WOKB 1% pool and the Uniswap v3 USDT0/WOKB pool.
/// The empty v4 OKB/BEM pool is not used. No admin.
/// Anyone can poke. A fresh poke moves at most 50 ticks, and at least 30 seconds must pass.
/// After 30 quiet minutes the next poke may jump to the pools.
contract XBemMark {
    ISlot0 public constant BEM = ISlot0(0x2CcF8aa17F5DF9Fb5D51C9de12135a913fF29f7A);
    ISlot0 public constant OKB = ISlot0(0xe3BE6A0137f1b0602Fc1a4841686f43B340a5082);
    uint32 public constant STALE = 1800;
    uint8 public constant SLOTS = 32;

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

    function poke() external {
        int24 next = _poolTick();
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
        if (nowT > prev.time + STALE) {
            obs[0] = Obs(nowT, 0, next);
            tick = next;
            last = 0;
            count = 1;
            return;
        }
        int24 step = next > prev.tick ? next - prev.tick : prev.tick - next;
        if (step > 50) next = next > prev.tick ? prev.tick + 50 : prev.tick - 50;
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
            if (nowT > head.time + STALE) revert Bad();
            cumulatives[i] = _at(nowT - ago);
        }
    }

    function _poolTick() internal view returns (int24) {
        (uint160 bemSqrt,,,,,,) = BEM.slot0();
        (uint160 okbSqrt,,,,,,) = OKB.slot0();
        if (bemSqrt == 0 || okbSqrt == 0) revert Bad();
        // BEM is token0 (8 decimals) and WOKB is token1 (18). USDT0 is token0 (6) and WOKB is token1 (18).
        // USDT per BEM = (WOKB/BEM) * (USDT0/WOKB) * 10^(8-6). The perp mark is that price at 1e18.
        uint256 syn = uint256(okbSqrt) * (uint256(1) << 96) / uint256(bemSqrt) / 1e6;
        if (syn < TickMath.MIN_SQRT_RATIO || syn >= TickMath.MAX_SQRT_RATIO) revert Bad();
        return TickMath.getTickAtSqrtRatio(uint160(syn));
    }

    function _at(uint32 target) internal view returns (int56) {
        uint8 oldestI = last;
        for (uint8 n = 1; n < count; n++) oldestI = oldestI == 0 ? SLOTS - 1 : oldestI - 1;
        Obs memory oldest = obs[oldestI];
        if (target < oldest.time) revert Bad();
        uint8 i = last;
        for (uint8 n = 0; n < count; n++) {
            Obs memory row = obs[i];
            if (row.time <= target) return row.cum + int56(row.tick) * int56(uint56(target - row.time));
            if (n + 1 == count) break;
            i = i == 0 ? SLOTS - 1 : i - 1;
        }
        revert Bad();
    }
}
