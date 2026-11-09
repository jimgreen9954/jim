// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IUpSell {
    function quoteSell(uint256 amountIn) external view returns (uint256 wad, uint256 rest, uint256 gross, uint256 fee, uint256 net);
}

interface IBemSlot {
    function slot0() external view returns (uint160 sqrtPriceX96);
}

/// UP perp mark. The book reads observe() as a Uniswap tick. The tick is the
/// official pool's UP/USDT price, not the Pancake UP/WBNB pool.
contract UpOfficialMark {
    address public constant src = 0xDf40529fa3E797c992272e27B811E59E5f1827Ae;
    address public constant bemUsdt = 0x3098D7A051045000d68eC0360753A40C8cABEa31;

    function count() external pure returns (uint8) {
        return 1;
    }

    function poke() external {}

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        int24 tick = _tick();
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

    function _tick() internal view returns (int24) {
        uint256 price = _usdtPerUp();
        uint256 target = price * 1e10;
        uint256 lo;
        uint256 hi = 500000;
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            if (_pow(mid) <= target) lo = mid;
            else hi = mid - 1;
        }
        return -int24(int256(lo));
    }

    /// USDT per 1 UP, 18 decimals. Sell quote is BEM. BEM/USDT is token0 = USDT.
    function _usdtPerUp() internal view returns (uint256) {
        (, , , , uint256 bem) = IUpSell(src).quoteSell(1e18);
        require(bem > 0, "price");
        uint160 sqrtPriceX96 = IBemSlot(bemUsdt).slot0();
        uint256 sq = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        uint256 usdtPerBem = ((uint256(1) << 192) * 1e8) / sq;
        return bem * usdtPerBem / 1e8;
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
