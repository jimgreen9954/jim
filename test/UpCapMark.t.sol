// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Test.sol";
import "../contracts/UpCapMark.sol";
import "../contracts/UpTapeRisk.sol";
import "../contracts/UpPerpShip.sol";

interface IERC20Approve {
    function approve(address, uint256) external returns (bool);
}

contract MockUp {
    address public implementation = address(1);
    uint256 public net = 1e8;

    function quoteSell(uint256) external view returns (uint256, uint256, uint256, uint256, uint256) {
        return (0, 0, 0, 0, net);
    }

    function setNet(uint256 n) external {
        net = n;
    }

    function setImpl(address impl) external {
        implementation = impl;
    }
}

contract MockBem {
    function observe(uint32[] calldata secondsAgos) external pure returns (int56[] memory cum, uint160[] memory liq) {
        cum = new int56[](secondsAgos.length);
        liq = new uint160[](secondsAgos.length);
    }

    function slot0() external pure returns (uint160) {
        return uint160(1 << 96);
    }
}

contract UpCapMarkTest is Test {
    MockUp up;
    MockBem bem;
    UpCapMark mark;

    function setUp() public {
        up = new MockUp();
        bem = new MockBem();
        mark = new UpCapMark(address(up), address(bem));
    }

    function testSeedMatchesOneBem() public view {
        assertEq(mark.mark(), 1e8);
        assertTrue(mark.guard());
    }

    function testOnePokeMovesAtMostHalfAPercent() public {
        uint256 before = mark.mark();
        up.setNet(1e8 * 2);
        vm.warp(block.timestamp + 30);
        mark.poke();
        assertEq(mark.lastTick(), 50);
        assertFalse(mark.guard());
        up.setNet(1e8);
        vm.warp(block.timestamp + 600);
        uint256 later = mark.mark();
        assertGt(later, before);
        assertLt(later, before * _pow(51) / 1e18);
    }

    function testSmallMoveStaysOpen() public {
        up.setNet(1e8 + 1e6);
        vm.warp(block.timestamp + 31);
        mark.poke();
        assertLe(mark.lastTick(), int24(50));
        assertTrue(mark.guard());
    }

    function testTwentyPushesStayNearTenPercentAndThreeTimesSurvives() public {
        for (uint256 i; i < 20; i++) {
            up.setNet(1e8 * 100);
            vm.warp(10_000 + i * 31);
            mark.poke();
        }
        assertEq(mark.lastTick(), 1000);
        uint256 grown = _pow(1000);
        assertLt(grown, 1.11e18);
        assertGt(grown, 1.10e18);
        assertFalse(_weak(3, grown));
    }

    function testImplementationChangeStopsQuotes() public {
        up.setImpl(address(2));
        vm.warp(block.timestamp + 30);
        vm.expectRevert(UpCapMark.Paused.selector);
        mark.poke();
        assertFalse(mark.guard());
        assertEq(mark.mark(), 1e8);
    }

    function testForkOfficialPoolIsNearSpot() public {
        vm.createSelectFork("https://bsc-dataseed.binance.org");
        UpCapMark live = new UpCapMark(0xDf40529fa3E797c992272e27B811E59E5f1827Ae, 0x3098D7A051045000d68eC0360753A40C8cABEa31);
        uint256 px = live.mark();
        uint256 spot = live.spotUsd();
        assertGt(px, 0);
        assertTrue(live.guard());
        assertLe(px * 100, spot * 103);
        assertGe(px * 100, spot * 97);
        assertGt(px, 0.02 ether);
        assertLt(px, 50 ether);
        emit log_named_uint("up mark 1e18", px);
        emit log_named_uint("up spot 1e18", spot);
    }

    function testForkShipMatchesSpotAndCapsFive() public {
        vm.createSelectFork("https://bsc-dataseed.binance.org");
        address upPool = 0xDf40529fa3E797c992272e27B811E59E5f1827Ae;
        address bemPool = 0x3098D7A051045000d68eC0360753A40C8cABEa31;
        address usdt = 0x55d398326f99059fF775485246999027B3197955;
        vm.recordLogs();
        new UpPerpShip(
            abi.encodePacked(type(UpCapMark).creationCode, abi.encode(upPool, bemPool)),
            type(UpTapeRisk).creationCode,
            usdt,
            1 ether,
            address(0xE51C19aE6E4261Ed329CC54F1120Cf0Ae09364Bd)
        );
        Vm.Log[] memory logs = vm.getRecordedLogs();
        address book;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == keccak256("Book(address)")) book = address(uint160(uint256(logs[i].topics[1])));
        }
        UpTapeRisk risk = UpTapeRisk(book);
        UpCapMark live = UpCapMark(address(risk.pool()));
        uint256 px = risk.mark();
        uint256 spot = live.spotUsd();
        assertEq(px, live.mark());
        assertLe(px * 100, spot * 103);
        assertGe(px * 100, spot * 97);
        assertTrue(live.guard());
        deal(usdt, address(this), 10 ether);
        IERC20Approve(usdt).approve(book, type(uint256).max);
        risk.open(true, 1 ether, 5, px);
        assertEq(risk.nextQuote(), 1);
        vm.expectRevert(TapeRisk.Bad.selector);
        risk.open(true, 1 ether, 6, px);
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
}
