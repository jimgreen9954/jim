// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Test.sol";
import "../contracts/TapeCapMark.sol";
import "../contracts/TapeRisk.sol";
import "../contracts/TickMath.sol";
import "../contracts/TierTapeRisk.sol";
import "../contracts/UpPerpShip.sol";

interface IOkbPool {
    function okbPool() external view returns (uint256 tape, uint256 quote, uint256 shares);
}

contract Cash {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockTape {
    uint256 public out = 1e6;

    function previewSwap(uint8, bool, uint256) external view returns (uint256, uint256) {
        return (0, out);
    }

    function setOut(uint256 next) external {
        out = next;
    }
}

contract MockOkb {
    int24 public tick;

    function setTick(int24 next) external {
        tick = next;
    }

    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory cum, uint160[] memory liq) {
        cum = new int56[](secondsAgos.length);
        liq = new uint160[](secondsAgos.length);
        for (uint256 i; i < secondsAgos.length; i++) {
            cum[i] = int56(tick) * int56(uint56(1_000_000 - secondsAgos[i]));
        }
    }

    function slot0() external view returns (uint160) {
        return TickMath.getSqrtRatioAtTick(tick);
    }
}

contract TierMarkTest is Test {
    MockTape tape;
    MockOkb okb;
    TapeCapMark mark;
    Cash cash;
    TierTapeRisk book;
    TapeRisk plain;

    function setUp() public {
        vm.warp(1_000_000);
        tape = new MockTape();
        okb = new MockOkb();
        mark = new TapeCapMark(address(tape), address(okb));
        cash = new Cash();
        book = new TierTapeRisk(address(cash), address(mark), 1 ether, address(this));
        plain = new TapeRisk(address(cash), address(mark), 1 ether, address(this));
    }

    function testSeedIsNearOneDollar() public view {
        uint256 px = mark.mark();
        assertGt(px, 0.99 ether);
        assertLt(px, 1.01 ether);
        assertTrue(mark.guard());
    }

    function testOnePokeMovesAtMostHalfAPercent() public {
        uint256 before = mark.mark();
        int24 seed = mark.lastTick();
        tape.setOut(2e6);
        vm.warp(block.timestamp + 30);
        mark.poke();
        assertEq(mark.lastTick(), seed + 50);
        assertFalse(mark.guard());
        tape.setOut(1e6);
        vm.warp(block.timestamp + 600);
        uint256 later = mark.mark();
        assertGt(later, before);
        assertLt(later, before * _pow(51) / 1e18);
    }

    function testGuardPauseBlocksOpenAndLiquidationButNotClose() public {
        uint256 px = book.mark();
        _fund(address(this), 100 ether);
        _fund(address(1), 100 ether);
        book.open(true, 20 ether, 5, px);
        vm.prank(address(1));
        book.take(1, 20 ether, 5);
        tape.setOut(2e6);
        vm.warp(block.timestamp + 31);
        mark.poke();
        assertFalse(mark.guard());
        vm.expectRevert(TapeRisk.Bad.selector);
        book.open(true, 1 ether, 1, px);
        vm.expectRevert(TapeRisk.Bad.selector);
        book.liquidate(1);
        book.close(1);
        assertEq(book.nextDeal(), 1);
    }

    function testTierBoundaries() public {
        uint256 px = book.mark();
        _fund(address(this), 1000 ether);
        book.open(true, 20 ether, 50, px);
        vm.expectRevert(TapeRisk.Bad.selector);
        book.open(true, 20 ether + 1, 50, px);
        book.open(true, 20 ether + 1, 20, px);
        book.open(true, 100 ether, 20, px);
        vm.expectRevert(TapeRisk.Bad.selector);
        book.open(true, 100 ether, 21, px);
        book.open(true, 100 ether + 1, 5, px);
        vm.expectRevert(TapeRisk.Bad.selector);
        book.open(true, 100 ether + 1, 6, px);
        plain.open(true, 200 ether, 50, px);
    }

    function testUsdt0UnitUsesTheSameMultiples() public {
        TierTapeRisk small = new TierTapeRisk(address(cash), address(mark), 1e6, address(this));
        uint256 px = small.mark();
        cash.mint(address(this), 1_000e6);
        cash.approve(address(small), type(uint256).max);
        small.open(true, 20e6, 50, px);
        vm.expectRevert(TapeRisk.Bad.selector);
        small.open(true, 20e6 + 1, 50, px);
        small.open(true, 100e6 + 1, 5, px);
    }

    function testSplitCannotRaiseTheCap() public {
        uint256 px = book.mark();
        _fund(address(this), 500 ether);
        vm.expectRevert(TapeRisk.Bad.selector);
        book.openScale(true, 200 ether, 20, px, px, 2);
        book.openScale(true, 40 ether, 20, px, px, 2);
    }

    function testFiftyTimesNeedsAboutOnePercent() public pure {
        assertFalse(_weak(50, _pow(50)));
        assertTrue(_weak(50, _pow(102)));
        assertTrue(_weak(5, _pow(1000)));
        assertFalse(_weak(3, _pow(1000)));
    }

    function testForkTapeIsNearSpotAndLogsLiquidationCost() public {
        vm.createSelectFork("https://rpc.xlayer.tech");
        TapeCapMark live = new TapeCapMark(
            0x58eaD5b41Cfd3627791D439402dd65571c286484,
            0xe3BE6A0137f1b0602Fc1a4841686f43B340a5082
        );
        uint256 px = live.mark();
        uint256 spot = live.spotUsd();
        assertGt(px, 0.05 ether);
        assertLt(px, 100 ether);
        assertTrue(live.guard());
        assertLe(px * 100, spot * 103);
        assertGe(px * 100, spot * 97);
        (uint256 reserve,,) = IOkbPool(0x58eaD5b41Cfd3627791D439402dd65571c286484).okbPool();
        (uint256 gross,) = _tapeToMove(0x58eaD5b41Cfd3627791D439402dd65571c286484);
        assertGt(gross, 1e8);
        assertLt(gross, reserve / 10);
        emit log_named_uint("tape raw to move spot about 1.01 percent", gross);
        emit log_named_uint("tape tokens", gross / 1e8);
        emit log_named_uint("tape mark 1e18", px);
        emit log_named_uint("tape spot 1e18", spot);
    }

    function testForkShipStaysInsideTheBand() public {
        vm.createSelectFork("https://rpc.xlayer.tech");
        address tapePool = 0x58eaD5b41Cfd3627791D439402dd65571c286484;
        address okbPool = 0xe3BE6A0137f1b0602Fc1a4841686f43B340a5082;
        address usdt = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
        vm.recordLogs();
        new UpPerpShip(
            abi.encodePacked(type(TapeCapMark).creationCode, abi.encode(tapePool, okbPool)),
            type(TierTapeRisk).creationCode,
            usdt,
            1e6,
            address(0xb4D6039394c8B97C3AC3234aa07011B564Fcb88c)
        );
        Vm.Log[] memory logs = vm.getRecordedLogs();
        address made;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == keccak256("Book(address)")) made = address(uint160(uint256(logs[i].topics[1])));
        }
        TierTapeRisk risk = TierTapeRisk(made);
        TapeCapMark live = TapeCapMark(address(risk.pool()));
        assertEq(risk.mark(), live.mark());
        assertTrue(live.guard());
        deal(usdt, address(this), 30e6);
        Cash(usdt).approve(made, type(uint256).max);
        uint256 px = risk.mark();
        risk.open(true, 20e6, 50, px);
        vm.expectRevert(TapeRisk.Bad.selector);
        risk.open(true, 20e6 + 1, 50, px);
    }

    function _fund(address who, uint256 amount) internal {
        cash.mint(who, amount);
        vm.prank(who);
        cash.approve(address(book), type(uint256).max);
        vm.prank(who);
        cash.approve(address(plain), type(uint256).max);
    }

    function _tapeToMove(address pool) internal view returns (uint256 gross, uint256 okbSpent) {
        (uint256 reserve, uint256 quote,) = IOkbPool(pool).okbPool();
        uint256 newTape = _sqrt(reserve * reserve * 99 / 98);
        uint256 net = newTape - reserve;
        gross = net * 1000 / 998 + 1;
        uint256 next = reserve + gross * 998 / 1000;
        okbSpent = quote - reserve * quote / next;
    }

    function _weak(uint256 lev, uint256 ratio1e18) internal pure returns (bool) {
        uint256 left = 1e18 - lev * (ratio1e18 - 1e18);
        uint256 notional = lev * ratio1e18;
        return left * lev * 2 <= notional;
    }

    function _pow(uint256 n) internal pure returns (uint256 r) {
        r = 1e18;
        uint256 b = 1000100000000000000;
        while (n > 0) {
            if (n & 1 == 1) r = r * b / 1e18;
            b = b * b / 1e18;
            n >>= 1;
        }
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
