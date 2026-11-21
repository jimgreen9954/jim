// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Test.sol";
import "../contracts/BemCapMark.sol";
import "../contracts/BemCapShip.sol";
import "../contracts/GuardTapeRisk.sol";
import "../contracts/TickMath.sol";

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

contract Leg {
    int24 public spotTick;
    int24 public twapTick;

    function set(int24 spot, int24 twap) external {
        spotTick = spot;
        twapTick = twap;
    }

    function slot0() external view returns (uint160) {
        return TickMath.getSqrtRatioAtTick(spotTick);
    }

    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory cum, uint160[] memory liq) {
        cum = new int56[](secondsAgos.length);
        liq = new uint160[](secondsAgos.length);
        for (uint256 i; i < secondsAgos.length; i++) {
            cum[i] = int56(twapTick) * int56(uint56(1_000_000 - secondsAgos[i]));
        }
    }
}

contract GuardOff {
    function guard() external pure returns (bool) {
        return false;
    }

    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory cum, uint160[] memory liq) {
        cum = new int56[](secondsAgos.length);
        liq = new uint160[](secondsAgos.length);
        uint32 nowT = uint32(block.timestamp);
        for (uint256 i; i < secondsAgos.length; i++) {
            uint32 ago = secondsAgos[i];
            uint32 t = ago > nowT ? 0 : nowT - ago;
            cum[i] = int56(int256(-230270) * int256(uint256(t)));
        }
    }
}

contract BemCapTest is Test {
    Leg bem;
    Leg okb;
    BemCapMark mark;

    function setUp() public {
        bem = new Leg();
        okb = new Leg();
        // Live-sized ticks. BEM/WOKB ~210345, OKB/USDT0 ~232295.
        bem.set(210345, 210345);
        okb.set(232295, 232295);
    }

    function testDeploysInsideTheBand() public {
        mark = new BemCapMark(address(bem), address(okb));
        uint256 px = mark.mark();
        assertGt(px, 1 ether);
        assertLt(px, 100 ether);
        assertEq(mark.spotUsd(), px);
        assertTrue(mark.guard());
    }

    function testGuardFailsWhenSpotRuns() public {
        bem.set(210345 + 400, 210345);
        okb.set(232295, 232295);
        mark = new BemCapMark(address(bem), address(okb));
        assertFalse(mark.guard());
        assertGt(mark.mark(), 1 ether);
    }

    function testOpenStopsWhenGuardIsFalse() public {
        GuardOff paused = new GuardOff();
        Cash cash = new Cash();
        GuardTapeRisk book = new GuardTapeRisk(address(cash), address(paused), 1 ether, address(this));
        cash.mint(address(this), 10 ether);
        cash.approve(address(book), 10 ether);
        uint256 px = book.mark();
        vm.expectRevert(TapeRisk.Bad.selector);
        book.open(true, 1 ether, 5, px);
    }
}

contract BemCapFork is Test {
    address constant BEM = 0x2CcF8aa17F5DF9Fb5D51C9de12135a913fF29f7A;
    address constant OKB = 0xe3BE6A0137f1b0602Fc1a4841686f43B340a5082;
    address constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address constant SAFE = 0xb4D6039394c8B97C3AC3234aa07011B564Fcb88c;

    function setUp() public {
        vm.createSelectFork("https://xlayer.drpc.org");
    }

    function testLivePoolsPriceTheShippedBook() public {
        BemCapShip ship = new BemCapShip(BEM, OKB, USDT0, 1e6, SAFE);
        // The ship emits during construction. Read the mark by deploying it again;
        // the two deployments see the same pools.
        BemCapMark mark = new BemCapMark(BEM, OKB);
        uint256 px = mark.mark();
        uint256 spot = mark.spotUsd();
        emit log_named_uint("twap", px);
        emit log_named_uint("spot", spot);
        emit log_named_uint("guard", mark.guard() ? 1 : 0);
        assertGt(px, 1 ether);
        assertLt(px, 100 ether);
        assertGt(spot, 1 ether);
        assertLt(spot, 100 ether);
        uint256 gap = px > spot ? px - spot : spot - px;
        if (mark.guard()) assertLe(gap * 100, spot * 4);
        GuardTapeRisk book = new GuardTapeRisk(USDT0, address(mark), 1e6, SAFE);
        assertEq(book.mark(), px);
        assertEq(book.MIN_MARGIN(), 1e6);
        assertEq(book.FEE_TO(), SAFE);
        ship;
    }
}
