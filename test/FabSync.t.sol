// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Test.sol";
import "../contracts/FabSyncMark.sol";
import "../contracts/FabSyncShip.sol";
import "../contracts/SyncTierTapeRisk.sol";
import "../contracts/TickMath.sol";

contract FabView {
    int24 public tick = 37970;

    function set(int24 next) external {
        tick = next;
    }

    function getSlot0(bytes32) external view returns (uint160, int24, uint24, uint24) {
        return (TickMath.getSqrtRatioAtTick(tick), tick, 0, 9000);
    }

    function getLiquidity(bytes32) external pure returns (uint128) {
        return 1;
    }
}

contract FabDollar {
    int24 public tick;

    constructor(int24 tick_) {
        tick = tick_;
    }

    function slot0() external view returns (uint160) {
        return TickMath.getSqrtRatioAtTick(tick);
    }

    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory cum, uint160[] memory liq) {
        cum = new int56[](secondsAgos.length);
        liq = new uint160[](secondsAgos.length);
        for (uint256 i; i < secondsAgos.length; i++) {
            cum[i] = int56(tick) * int56(uint56(1_000_000 - secondsAgos[i]));
        }
    }
}

contract FabSyncTest is Test {
    function testSmashDoesNotMoveTheAverageAndPinStopsIt() public {
        vm.warp(1_000_000);
        FabView view_ = new FabView();
        FabDollar bem = new FabDollar(210345);
        FabDollar okb = new FabDollar(232295);
        FabSyncMark mark = new FabSyncMark(address(view_), address(bem), address(okb), bytes32(uint256(1)));
        mark.bind(address(this));
        uint256 before = mark.mark();
        int24 seed = mark.lastTick();
        assertTrue(mark.guard());
        assertGt(before, 0.01 ether);
        assertLt(before, 10 ether);
        view_.set(37970 + 5000);
        vm.warp(block.timestamp + 31);
        mark.note();
        assertEq(mark.mark(), before);
        assertEq(mark.lastTick(), seed - 50);
        int24 clipped = mark.lastTick();
        vm.etch(address(view_), hex"6002600c60003960016000f3");
        assertFalse(mark.guard());
        vm.warp(block.timestamp + 600);
        mark.note();
        assertEq(mark.lastTick(), clipped);
        assertEq(mark.touched(), 2);
    }
}

interface IFabQuote {
    function quoteExactInputSingle(FabQuote memory params) external returns (uint256 amountOut, uint256 gasEstimate);
}

struct FabKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct FabQuote {
    FabKey poolKey;
    bool zeroForOne;
    uint128 exactAmount;
    bytes hookData;
}

contract FabSyncFork is Test {
    address constant QUOTER = 0x8928074CA1b241D8Ec02815881c1Af11E8bC5219;
    address constant BEM = 0x60e62Efa9405d6873C5deaBD4E6CC91c25363952;
    address constant FAB = 0x72F349B1Eee7833B26f8C81a8410775A4e231ed2;

    function testForkFabShipMatchesSpotAndCapLoses() public {
        vm.createSelectFork("https://rpc.xlayer.tech");
        vm.recordLogs();
        new FabSyncShip();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256("Shipped(address,address)");
        address markAddr;
        address bookAddr;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] != topic) continue;
            markAddr = address(uint160(uint256(logs[i].topics[1])));
            bookAddr = address(uint160(uint256(logs[i].topics[2])));
        }
        FabSyncMark mark = FabSyncMark(markAddr);
        SyncTierTapeRisk book = SyncTierTapeRisk(bookAddr);
        uint256 px = book.mark();
        uint256 spot = mark.spotUsd();
        emit log_named_uint("fab mark", px);
        emit log_named_uint("fab spot", spot);
        assertGt(px, 0.02 ether);
        assertLt(px, 2 ether);
        if (mark.guard()) {
            uint256 gap = px > spot ? px - spot : spot - px;
            assertLe(gap * 100, spot);
        }
        uint256 inventory = _inventory(spot, 97);
        emit log_named_uint("fab inventory", inventory);
        SyncTierTapeRisk live = SyncTierTapeRisk(0xb87A0D23A9D5c1F63C2DeA9331fBaA1B0C027D0A);
        emit log_named_uint("live cap", live.cap());
        emit log_named_uint("live open", live.openCap());
        assertLe(live.openCap() * 1e12, inventory / 2);
    }

    function testForkFabHoldCost() public {
        vm.createSelectFork("https://rpc.xlayer.tech");
        FabSyncMark mark = new FabSyncMark(
            0x76Fd297e2D437cd7f76d50F01AfE6160f86e9990,
            0x2CcF8aa17F5DF9Fb5D51C9de12135a913fF29f7A,
            0xe3BE6A0137f1b0602Fc1a4841686f43B340a5082,
            keccak256(abi.encode(BEM, FAB, uint24(9000), int24(180), address(0)))
        );
        _logFab(mark.spotUsd(), 99);
        _logFab(mark.spotUsd(), 96);
    }

    function _logFab(uint256 spot, uint256 keep) internal {
        uint256 inventory = _inventory(spot, keep);
        uint256 sold = inventory * 1e8 / spot;
        uint256 unit = _out(1e8);
        uint256 got = _out(sold);
        uint256 fair = sold * unit / 1e8;
        uint256 slip = fair > got ? (fair - got) * spot / unit : 0;
        emit log_named_uint("fab keep", keep);
        emit log_named_uint("fab inventory", inventory);
        emit log_named_uint("fab one way", slip);
        emit log_named_uint("fab cap from two slips", slip * 2 * 125);
    }

    function _inventory(uint256 spot, uint256 keep) internal returns (uint256) {
        uint256 unit = _out(1e8);
        uint256 lo = 1e8;
        uint256 hi = 20_000_000e8;
        uint256 best;
        for (uint256 i; i < 18; i++) {
            uint256 mid = (lo + hi) / 2;
            uint256 a = _out(mid);
            uint256 b = _out(mid + 1e8);
            if (b <= a) {
                hi = mid;
                continue;
            }
            if ((b - a) * 100 <= unit * keep) {
                best = mid;
                hi = mid;
            } else lo = mid;
        }
        require(best > 0, "no fab");
        return best * spot / 1e8;
    }

    function _out(uint256 amount) internal returns (uint256) {
        FabQuote memory params = FabQuote(FabKey(BEM, FAB, 9000, 180, address(0)), false, uint128(amount), "");
        try IFabQuote(QUOTER).quoteExactInputSingle(params) returns (uint256 out, uint256) {
            return out;
        } catch {
            return 0;
        }
    }
}
