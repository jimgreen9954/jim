// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Test.sol";
import "../contracts/FabCapMark.sol";
import "../contracts/FabCapShip.sol";
import "../contracts/TierTapeRisk.sol";
import "../contracts/TickMath.sol";

contract FabCash {
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

contract FabLeg {
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

contract FabView {
    int24 public tick;

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

contract FabCapTest is Test {
    FabView view_;
    FabLeg bem;
    FabLeg okb;
    FabCapMark mark;
    bytes32 id = bytes32(uint256(1));

    function setUp() public {
        view_ = new FabView();
        bem = new FabLeg();
        okb = new FabLeg();
        view_.set(37970);
        bem.set(210345, 210345);
        okb.set(232295, 232295);
        mark = new FabCapMark(address(view_), address(bem), address(okb), id);
    }

    function testStartsClosedAndClips() public {
        uint256 px = mark.mark();
        assertGt(px, 0.01 ether);
        assertLt(px, 10 ether);
        assertEq(mark.count(), 1);
        assertFalse(mark.guard());
        vm.expectRevert(FabCapMark.Early.selector);
        mark.poke();
        uint256 t = block.timestamp;
        view_.set(37970 + 500);
        t += 31;
        vm.warp(t);
        mark.poke();
        assertEq(mark.lastTick(), 37970 + 50);
    }

    function testOpensOnlyAfterTheWindow() public {
        FabCash cash = new FabCash();
        TierTapeRisk book = new TierTapeRisk(address(cash), address(mark), 1e6, address(this));
        cash.mint(address(this), 50e6);
        cash.approve(address(book), 50e6);
        uint256 px = book.mark();
        vm.expectRevert(TapeRisk.Bad.selector);
        book.open(true, 1e6, 5, px);
        uint256 t = block.timestamp;
        for (uint256 i; i < 20; i++) {
            t += 31;
            vm.warp(t);
            mark.poke();
        }
        assertTrue(mark.guard());
        px = book.mark();
        assertEq(px, mark.mark());
        book.open(true, 1e6, 50, px);
        vm.expectRevert(TapeRisk.Bad.selector);
        book.open(true, 1e6, 51, px);
        vm.etch(address(view_), hex"00");
        assertFalse(mark.guard());
    }

    function testGuardFailsWhenSpotRuns() public {
        uint256 t = block.timestamp;
        for (uint256 i; i < 20; i++) {
            t += 31;
            vm.warp(t);
            mark.poke();
        }
        assertTrue(mark.guard());
        view_.set(mark.lastTick() + 400);
        assertFalse(mark.guard());
    }
}

contract FabCapFork is Test {
    function setUp() public {
        vm.createSelectFork("https://rpc.xlayer.tech");
    }

    function testLivePoolCanShip() public {
        uint256 gas = gasleft();
        vm.recordLogs();
        new FabCapShip();
        uint256 used = gas - gasleft();
        emit log_named_uint("ship gas", used);
        assertLt(used, 16_000_000);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256("Shipped(address,address)");
        address madeMark;
        address madeBook;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics.length == 3 && logs[i].topics[0] == topic) {
                madeMark = address(uint160(uint256(logs[i].topics[1])));
                madeBook = address(uint160(uint256(logs[i].topics[2])));
            }
        }
        assertTrue(madeMark != address(0) && madeBook != address(0));
        FabCapMark mark = FabCapMark(madeMark);
        TierTapeRisk book = TierTapeRisk(madeBook);
        uint256 px = mark.mark();
        uint256 spot = mark.spotUsd();
        emit log_named_uint("twap", px);
        emit log_named_uint("spot", spot);
        emit log_named_int("tick", mark.lastTick());
        assertGt(px, 0.02 ether);
        assertLt(px, 2 ether);
        assertGt(spot, 0.02 ether);
        assertLt(spot, 2 ether);
        assertEq(mark.count(), 1);
        assertFalse(mark.guard());
        assertEq(book.mark(), px);
        assertEq(book.MIN_MARGIN(), 1e6);
        assertEq(book.FEE_TO(), 0xb4D6039394c8B97C3AC3234aa07011B564Fcb88c);
        assertEq(address(book.pool()), madeMark);
        bytes32 quoter = bytes32(uint256(uint160(0x8928074CA1b241D8Ec02815881c1Af11E8bC5219)));
        assertFalse(_hasAddress(address(mark).code, quoter));
    }

    function _hasAddress(bytes memory code, bytes32 word) internal pure returns (bool) {
        if (code.length < 20) return false;
        for (uint256 i; i + 20 <= code.length; i++) {
            bytes32 got;
            assembly {
                got := shr(96, mload(add(add(code, 32), i)))
            }
            if (got == word) return true;
        }
        return false;
    }
}
