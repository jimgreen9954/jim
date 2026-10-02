// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Local stand-in for a Uniswap V3 pool.observe. The page pushes the BSC
/// pool tick. Each later push can move at most 50 ticks, and only every 30s.
contract TapeMark {
    int24 public tick;
    uint32 public updated;
    error Bad();

    function observe(uint32[] calldata)
        external
        view
        returns (int56[] memory cumulatives, uint160[] memory liquidity)
    {
        cumulatives = new int56[](2);
        liquidity = new uint160[](2);
        cumulatives[1] = int56(tick) * 600;
    }

    function push(int24 next) external {
        if (updated != 0) {
            if (block.timestamp < updated + 30) revert Bad();
            int24 diff = next > tick ? next - tick : tick - next;
            if (diff > 50) revert Bad();
        }
        tick = next;
        updated = uint32(block.timestamp);
    }
}
