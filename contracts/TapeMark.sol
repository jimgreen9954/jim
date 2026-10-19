// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Time-weighted mark for the X Layer BEM book.
/// Only the fee address can post a tick. There is no owner and no way to change that address.
/// Settlement reads a 10-minute average. One post is not the settlement price.
contract TapeMark {
    address public constant ORACLE = 0x823b9F6A93Ac44Ce5A469823A336c15b6117054D;
    uint32 public constant WINDOW = 600;
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

    function push(int24 next) external {
        if (msg.sender != ORACLE) revert Bad();
        if (next < -887272 || next > 887272) revert Bad();
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
        int24 diff = next > prev.tick ? next - prev.tick : prev.tick - next;
        if (diff > 50) revert Bad();
        int56 cum = prev.cum + int56(prev.tick) * int56(uint56(nowT - prev.time));
        uint8 i = (last + 1) % SLOTS;
        obs[i] = Obs(nowT, cum, next);
        last = i;
        tick = next;
        if (count < SLOTS) count += 1;
    }

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory cumulatives, uint160[] memory liquidity)
    {
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

    function _at(uint32 target) internal view returns (int56) {
        uint8 oldestI = last;
        for (uint8 n = 1; n < count; n++) oldestI = oldestI == 0 ? SLOTS - 1 : oldestI - 1;
        Obs memory oldest = obs[oldestI];
        if (target < oldest.time) {
            return oldest.cum - int56(oldest.tick) * int56(uint56(oldest.time - target));
        }
        uint8 i = last;
        for (uint8 n = 0; n < count; n++) {
            Obs memory row = obs[i];
            if (row.time <= target) {
                return row.cum + int56(row.tick) * int56(uint56(target - row.time));
            }
            if (n + 1 == count) break;
            i = i == 0 ? SLOTS - 1 : i - 1;
        }
        revert Bad();
    }
}
