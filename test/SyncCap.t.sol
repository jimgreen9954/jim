// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Test.sol";
import "../contracts/UpSyncMark.sol";
import "../contracts/TapeSyncMark.sol";
import "../contracts/SyncTierTapeRisk.sol";
import "../contracts/UpSyncShip.sol";
import "../contracts/TapeSyncShip.sol";

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

contract MockUp {
    address public implementation = address(0xBEEF);
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

contract MockTape {
    uint256 public out = 1e18;
    bytes32 public codehash = keccak256("tape");

    function previewSwap(uint8, bool, uint256) external view returns (uint256, uint256) {
        return (0, out);
    }

    function setOut(uint256 n) external {
        out = n;
    }
}

contract MockV3 {
    int24 public spotTick;
    int24 public twapTick;

    constructor(int24 tick) {
        spotTick = tick;
        twapTick = tick;
    }

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

contract SyncCapTest is Test {
    MockUp up;
    MockV3 bem;
    UpSyncMark mark;
    SyncTierTapeRisk book;
    Cash cash;

    function setUp() public {
        vm.warp(1_000_000);
        up = new MockUp();
        bem = new MockV3(-230270);
        mark = new UpSyncMark(address(up), address(bem));
        cash = new Cash();
        book = new SyncTierTapeRisk(address(cash), address(mark), 1 ether, address(this), 500 ether);
        mark.bind(address(book));
        _back(book, 100 ether);
    }

    function testSyncReopensAfterFivePercent() public {
        uint256 start = up.net();
        up.setNet(start * 105 / 100);
        assertFalse(mark.guard());
        uint32 t = uint32(block.timestamp);
        uint256 steps;
        for (uint256 i; i < 80 && !mark.guard(); i++) {
            t += 31;
            vm.warp(t);
            book.sync();
            steps++;
        }
        assertTrue(mark.guard());
        assertGt(steps, 1);
        emit log_named_uint("syncs to reopen", steps);
    }

    function testTradesRecordThePrice() public {
        uint256 px = book.mark();
        assertGt(px, 0.5 ether);
        assertLt(px, 2 ether);
        assertTrue(mark.guard());
        _fund();
        vm.prank(address(0xA11));
        book.open(true, 1 ether, 5, px);
        assertEq(mark.touched(), 1);
        vm.warp(block.timestamp + 31);
        vm.prank(address(0xB22));
        book.take(1, 1 ether, 5);
        assertEq(mark.touched(), 2);
        assertApproxEqAbs(book.openNotional(), 5 ether, 1000);
        vm.warp(block.timestamp + 31);
        vm.prank(address(0xA11));
        book.close(1);
        assertEq(mark.touched(), 3);
        assertEq(book.openNotional(), 0);
    }

    function testQuietSmallMoveFillsOnTheFirstTrade() public {
        _fund();
        uint256 t = block.timestamp + 2 days;
        vm.warp(t);
        up.setNet(1e8 * 1003 / 1000);
        uint256 px = book.mark();
        vm.prank(address(0xA11));
        book.open(true, 1 ether, 5, px);
        assertEq(mark.touched(), 1);
        assertGt(mark.lastTick(), 20);
        assertLt(mark.lastTick(), 40);
        assertTrue(mark.guard());
    }

    function testDeploysWhileTheDollarAverageIsAway() public {
        bem.set(-230270, -230270 - 700);
        UpSyncMark wide = new UpSyncMark(address(up), address(bem));
        assertFalse(wide.guard());
        uint256 px = wide.mark();
        assertGt(px, 0.01 ether);
        assertLt(px, 100 ether);
    }

    function testOneSmashDoesNotMoveTheAverage() public {
        uint256 before = book.mark();
        up.setNet(1e8 * 2);
        vm.warp(block.timestamp + 31);
        vm.prank(address(book));
        mark.note();
        assertEq(book.mark(), before);
        assertEq(mark.lastTick(), 50);
        assertLt(mark.lastTick(), 51);
    }

    function testBigQuietMovePausesOpensButNotCloses() public {
        _fund();
        uint256 px = book.mark();
        vm.prank(address(0xA11));
        book.open(true, 1 ether, 5, px);
        vm.prank(address(0xB22));
        book.take(1, 1 ether, 5);
        uint256 t = block.timestamp + 2 days;
        vm.warp(t);
        up.setNet(1e8 * 115 / 100);
        vm.prank(address(book));
        mark.note();
        assertEq(mark.lastTick(), 50);
        assertFalse(mark.guard());
        uint256 paused = book.mark();
        vm.expectRevert(TapeRisk.Bad.selector);
        vm.prank(address(0xA11));
        book.open(true, 1 ether, 5, paused);
        vm.prank(address(0xA11));
        book.close(1);
        assertEq(book.openNotional(), 0);
    }

    function testAFourPercentJumpStaysPaused() public {
        uint256 t = block.timestamp + 2 days;
        vm.warp(t);
        up.setNet(1e8 * 104 / 100);
        vm.prank(address(book));
        mark.note();
        assertEq(mark.lastTick(), 50);
        assertFalse(mark.guard());
        vm.warp(t + 200);
        assertFalse(mark.guard());
    }

    function testHoldingThePriceIsWhatMovesTheAverage() public {
        uint256 before = book.mark();
        uint256 t = block.timestamp;
        for (uint256 i; i < 6; i++) {
            t += 31;
            vm.warp(t);
            up.setNet(1e8 * 100);
            vm.prank(address(book));
            mark.note();
            assertLt(book.mark() * 100, before * 104);
        }
        assertEq(mark.lastTick(), 300);
    }

    function testOneAddressCannotFillTheBook() public {
        SyncTierTapeRisk tight = new SyncTierTapeRisk(address(cash), address(mark), 1 ether, address(this), 100 ether);
        _fundTo(address(tight));
        cash.mint(address(0xC33), 500 ether);
        cash.mint(address(0xD44), 500 ether);
        vm.prank(address(0xC33));
        cash.approve(address(tight), type(uint256).max);
        vm.prank(address(0xD44));
        cash.approve(address(tight), type(uint256).max);
        uint256 px = tight.mark();
        vm.prank(address(0xA11));
        tight.open(true, 1 ether, 20, px);
        vm.prank(address(0xB22));
        tight.take(1, 1 ether, 20);
        assertApproxEqAbs(tight.longOf(address(0xA11)), 20 ether, 1000);
        assertApproxEqAbs(tight.shortOf(address(0xB22)), 20 ether, 1000);
        vm.prank(address(0xD44));
        tight.open(true, 1 ether, 20, px);
        vm.expectRevert(TapeRisk.Bad.selector);
        vm.prank(address(0xB22));
        tight.take(2, 1 ether, 20);
        vm.prank(address(0xC33));
        tight.take(2, 1 ether, 20);
        assertApproxEqAbs(tight.longNotional(), 40 ether, 1000);
    }

    function testTheSixthSliceDoesNotFit() public {
        SyncTierTapeRisk tight = new SyncTierTapeRisk(address(cash), address(mark), 1 ether, address(this), 100 ether);
        _back(tight, 100 ether);
        uint256 px = tight.mark();
        for (uint256 i; i < 6; i++) {
            address maker = address(uint160(0x1000 + i));
            address taker = address(uint160(0x2000 + i));
            cash.mint(maker, 10 ether);
            cash.mint(taker, 10 ether);
            vm.prank(maker);
            cash.approve(address(tight), type(uint256).max);
            vm.prank(taker);
            cash.approve(address(tight), type(uint256).max);
            vm.prank(maker);
            tight.open(true, 1 ether, 20, px);
            if (i == 5) {
                vm.prank(taker);
                vm.expectRevert(TapeRisk.Bad.selector);
                tight.take(i + 1, 1 ether, 20);
            } else {
                vm.prank(taker);
                tight.take(i + 1, 1 ether, 20);
            }
        }
        assertApproxEqAbs(tight.longNotional(), 100 ether, 5000);
        assertApproxEqAbs(tight.shortNotional(), 100 ether, 5000);
    }

    function testOneTraderCanUseBothSides() public {
        SyncTierTapeRisk tight = new SyncTierTapeRisk(address(cash), address(mark), 1 ether, address(this), 100 ether);
        _fundTo(address(tight));
        cash.mint(address(0xC33), 500 ether);
        vm.prank(address(0xC33));
        cash.approve(address(tight), type(uint256).max);
        uint256 px = tight.mark();
        vm.prank(address(0xA11));
        tight.open(true, 1 ether, 20, px);
        vm.prank(address(0xB22));
        tight.take(1, 1 ether, 20);
        vm.prank(address(0xA11));
        tight.open(false, 1 ether, 20, px);
        vm.prank(address(0xC33));
        tight.take(2, 1 ether, 20);
        assertApproxEqAbs(tight.longOf(address(0xA11)), 20 ether, 1000);
        assertApproxEqAbs(tight.shortOf(address(0xA11)), 20 ether, 1000);
        vm.prank(address(0xA11));
        tight.open(true, 1 ether, 20, px);
        vm.expectRevert(TapeRisk.Bad.selector);
        vm.prank(address(0xB22));
        tight.take(3, 1 ether, 20);
    }

    function testARaiseWaitsADayAndACutDoesNot() public {
        book.setCap(400 ether);
        assertEq(book.cap(), 400 ether);
        assertEq(book.pendingCap(), 0);
        book.setCap(800 ether);
        assertEq(book.cap(), 400 ether);
        assertEq(book.pendingCap(), 800 ether);
        vm.warp(block.timestamp + 1 days - 1);
        vm.expectRevert(SyncTierTapeRisk.Wait.selector);
        book.applyCap();
        vm.warp(block.timestamp + 1);
        book.applyCap();
        assertEq(book.cap(), 800 ether);
        vm.prank(address(0xA11));
        vm.expectRevert(SyncTierTapeRisk.Denied.selector);
        book.setCap(1 ether);
    }

    function testOneTradeCannotLiquidateFifty() public {
        _fund();
        uint256 px = book.mark();
        vm.prank(address(0xA11));
        book.open(true, 1 ether, 50, px);
        vm.prank(address(0xB22));
        book.take(1, 1 ether, 50);
        vm.expectRevert(SyncLeg.Denied.selector);
        mark.note();
        vm.warp(block.timestamp + 31);
        up.setNet(1e8 / 2);
        book.accrue(1);
        assertEq(mark.lastTick(), -50);
        up.setNet(1e8);
        assertTrue(mark.guard());
        vm.expectRevert(TapeRisk.Bad.selector);
        book.liquidate(1);
        (,,,,,, bool open,,) = book.deals(1);
        assertTrue(open);
    }

    function testASecondReadingBeforeTwoMinutesDoesNotLiquidate() public {
        _fund();
        uint256 px = book.mark();
        vm.prank(address(0xA11));
        book.open(true, 1 ether, 50, px);
        vm.prank(address(0xB22));
        book.take(1, 1 ether, 50);
        uint256 clock = block.timestamp;
        uint256 net = 1e8;
        for (uint256 i; i < 200 && book.liqSeen(1) == 0; i++) {
            if (mark.guard()) net = net * 9995 / 10000;
            up.setNet(net);
            clock += 31;
            vm.warp(clock);
            vm.prank(address(book));
            mark.note();
            if (mark.guard()) try this.pokeLiq() {} catch {}
        }
        assertGt(book.liqSeen(1), 0);
        (,,,,,, bool still,,) = book.deals(1);
        assertTrue(still);
        uint256 held = cash.balanceOf(address(0xBEEF));
        clock += 2 minutes - 1;
        vm.warp(clock);
        vm.prank(address(book));
        mark.note();
        book.liquidate(1);
        (,,,,,, still,,) = book.deals(1);
        assertTrue(still);
        clock += 1;
        vm.warp(clock);
        vm.prank(address(book));
        mark.note();
        book.liquidate(1);
        (,,,,,, still,,) = book.deals(1);
        assertFalse(still);
        assertEq(cash.balanceOf(address(0xBEEF)), held);
    }

    function testARecoveredPriceClearsTheLiquidation() public {
        _fund();
        uint256 px = book.mark();
        vm.prank(address(0xA11));
        book.open(true, 1 ether, 50, px);
        vm.prank(address(0xB22));
        book.take(1, 1 ether, 50);
        uint256 clock = block.timestamp;
        uint256 net = 1e8;
        for (uint256 i; i < 200 && book.liqSeen(1) == 0; i++) {
            if (mark.guard()) net = net * 9995 / 10000;
            up.setNet(net);
            clock += 31;
            vm.warp(clock);
            book.sync();
            if (mark.guard()) try this.pokeLiq() {} catch {}
        }
        assertGt(book.liqSeen(1), 0);
        up.setNet(1e8);
        for (uint256 i; i < 200 && book.liqSeen(1) != 0; i++) {
            clock += 31;
            vm.warp(clock);
            book.sync();
        }
        assertEq(book.liqSeen(1), 0);
        clock += 2 minutes;
        vm.warp(clock);
        vm.expectRevert(TapeRisk.Bad.selector);
        book.liquidate(1);
        (,,,,,, bool still,,) = book.deals(1);
        assertTrue(still);
    }

    function testInsuranceShrinksTheCap() public {
        SyncTierTapeRisk thin = new SyncTierTapeRisk(address(cash), address(mark), 1 ether, address(this), 1_000 ether);
        cash.mint(address(0xA11), 100 ether);
        cash.mint(address(0xB22), 100 ether);
        vm.prank(address(0xA11));
        cash.approve(address(thin), type(uint256).max);
        vm.prank(address(0xB22));
        cash.approve(address(thin), type(uint256).max);
        _back(thin, 1 ether);
        assertEq(thin.openCap(), 20 ether);
        uint256 px = thin.mark();
        vm.prank(address(0xA11));
        thin.open(true, 1 ether, 50, px);
        vm.prank(address(0xB22));
        vm.expectRevert(TapeRisk.Bad.selector);
        thin.take(1, 1 ether, 50);
    }

    function testFeesStayInInsurance() public {
        _fund();
        uint256 insured = book.insurance();
        uint256 held = cash.balanceOf(address(this));
        uint256 px = book.mark();
        vm.prank(address(0xA11));
        book.open(true, 1 ether, 5, px);
        vm.prank(address(0xB22));
        book.take(1, 1 ether, 5);
        assertGt(book.insurance(), insured);
        assertEq(cash.balanceOf(address(this)), held);
    }

    function pokeLiq() external {
        book.liquidate(1);
    }

    function testCapIsBelowTheOpen() public {
        SyncTierTapeRisk tight = new SyncTierTapeRisk(address(cash), address(mark), 1 ether, address(this), 100 ether);
        _fundTo(address(tight));
        uint256 px = tight.mark();
        vm.prank(address(0xA11));
        tight.open(true, 1 ether, 50, px);
        vm.expectRevert(TapeRisk.Bad.selector);
        vm.prank(address(0xB22));
        tight.take(1, 1 ether, 50);
        vm.prank(address(0xA11));
        tight.cancel(1);
        vm.prank(address(0xA11));
        tight.open(true, 1 ether, 20, px);
        vm.prank(address(0xB22));
        tight.take(2, 1 ether, 20);
        assertApproxEqAbs(tight.openNotional(), 20 ether, 1000);
    }

    function testTiersStay() public {
        _fund();
        uint256 px = book.mark();
        vm.prank(address(0xA11));
        book.open(true, 1 ether, 50, px);
        vm.prank(address(0xA11));
        book.open(true, 10 ether, 50, px);
        vm.prank(address(0xA11));
        vm.expectRevert(TapeRisk.Bad.selector);
        book.open(true, 11 ether, 50, px);
        vm.prank(address(0xA11));
        vm.expectRevert(TapeRisk.Bad.selector);
        book.open(true, 1 ether, 51, px);
        vm.prank(address(0xA11));
        vm.expectRevert(TapeRisk.Bad.selector);
        book.open(true, 21 ether, 50, px);
        vm.prank(address(0xA11));
        book.open(true, 101 ether, 5, px);
    }

    function testPinStopsOpens() public {
        _fund();
        uint256 px = book.mark();
        vm.prank(address(0xA11));
        book.open(true, 1 ether, 5, px);
        vm.prank(address(0xB22));
        book.take(1, 1 ether, 5);
        up.setImpl(address(0xCAFE));
        vm.warp(block.timestamp + 31);
        assertFalse(mark.guard());
        vm.prank(address(0xB22));
        vm.expectRevert(TapeRisk.Bad.selector);
        book.liquidate(1);
        vm.prank(address(0xA11));
        book.close(1);
    }

    function testTapeCodehashPin() public {
        MockTape tape = new MockTape();
        MockV3 okb = new MockV3(276324);
        TapeSyncMark live = new TapeSyncMark(address(tape), address(okb));
        live.bind(address(this));
        assertGt(live.mark(), 0.5 ether);
        assertLt(live.mark(), 2 ether);
        uint256 before = live.mark();
        vm.etch(address(tape), hex"6002600c60003960016000f3");
        assertFalse(live.guard());
        vm.warp(block.timestamp + 600);
        live.note();
        assertEq(live.mark(), before);
    }

    function _fund() internal {
        _fundTo(address(book));
    }

    function _fundTo(address who) internal {
        cash.mint(address(0xA11), 500 ether);
        cash.mint(address(0xB22), 500 ether);
        vm.prank(address(0xA11));
        cash.approve(who, type(uint256).max);
        vm.prank(address(0xB22));
        cash.approve(who, type(uint256).max);
        _back(SyncTierTapeRisk(who), 100 ether);
    }

    function _back(SyncTierTapeRisk who, uint256 amount) internal {
        cash.mint(address(this), amount);
        cash.approve(address(who), amount);
        who.fundInsurance(amount);
    }
}

interface IUpLive {
    function quoteSell(uint256) external view returns (uint256, uint256, uint256, uint256, uint256 net);
    function sell(uint256, uint256) external;
    function buy(uint256, uint256) external;
    function deposit(uint256) external;
}

interface IUpAsset {
    function assetOf(address) external view returns (uint256);
}

interface IUpBuy {
    function quoteBuy(uint256 amountIn) external view returns (uint256 instantIn, uint256 reservoir, uint256 fee, uint256 gross, uint256 tax, uint256 net);
}

interface IUpPos {
    function position(address) external view returns (uint256 budget, uint256 spent, uint256 opened, uint256 updated);
}

interface IUpRelease {
    function pendingRelease(address) external view returns (uint256);
    function releasable(address) external view returns (uint256);
}

interface ITapeLive {
    function previewSwap(uint8, bool, uint256) external view returns (uint256, uint256 out);
    function swap(uint8, bool, uint256, uint256) external payable;
}

interface IERC20Live {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

interface ISlot {
    function slot0() external view returns (uint160);
}

contract SyncCapFork is Test {
    address constant UP = 0xDf40529fa3E797c992272e27B811E59E5f1827Ae;
    address constant UP_TOKEN = 0xEd99445d72787Adb627cD8588586984DF548CD2F;
    address constant BEM_BSC = 0x5ce033B2bFCa3Af30b3e8C8457DeaF776A8b695a;
    address constant BEM_POOL = 0x3098D7A051045000d68eC0360753A40C8cABEa31;
    address constant TAPE = 0x58eaD5b41Cfd3627791D439402dd65571c286484;
    address constant TAPE_TOKEN = 0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3;
    address constant OKB_POOL = 0xe3BE6A0137f1b0602Fc1a4841686f43B340a5082;

    receive() external payable {}

    /// Real UP pool on a BSC fork. The sell quote is walked 5%. sync() does not check the guard.
    /// The 10-minute average needs more than one note. This records how many.
    function testForkSyncReopensAfterFivePercent() public {
        vm.createSelectFork("https://bsc-dataseed.binance.org");
        vm.recordLogs();
        new UpSyncShip();
        (address markAddr, address bookAddr) = _shipped();
        UpSyncMark mark = UpSyncMark(markAddr);
        SyncTierTapeRisk book = SyncTierTapeRisk(bookAddr);
        (,,,, uint256 net) = IUpLive(UP).quoteSell(1e18);
        uint256 jumped = net * 105 / 100;
        vm.mockCall(UP, abi.encodeWithSelector(IUpLive.quoteSell.selector, uint256(1e18)), abi.encode(uint256(0), uint256(0), uint256(0), uint256(0), jumped));
        assertFalse(mark.guard());
        uint256 t = block.timestamp;
        uint256 steps;
        for (uint256 i; i < 80 && !mark.guard(); i++) {
            t += 31;
            vm.warp(t);
            book.sync();
            steps++;
        }
        emit log_named_uint("fork syncs to reopen", steps);
        emit log_named_uint("fork guard", mark.guard() ? 1 : 0);
        assertGt(steps, 1);
        assertTrue(mark.guard());
    }

    function testForkUpShipMatchesSpotAndCapLoses() public {
        vm.createSelectFork("https://bsc-dataseed.binance.org");
        vm.recordLogs();
        new UpSyncShip();
        (address markAddr, address bookAddr) = _shipped();
        UpSyncMark mark = UpSyncMark(markAddr);
        SyncTierTapeRisk book = SyncTierTapeRisk(bookAddr);
        uint256 px = book.mark();
        uint256 spot = mark.spotUsd();
        emit log_named_uint("up mark", px);
        emit log_named_uint("up spot", spot);
        assertGt(px, 0.02 ether);
        assertLt(px, 5 ether);
        emit log_named_uint("up guard", mark.guard() ? 1 : 0);
        if (mark.guard()) {
            uint256 gap = px > spot ? px - spot : spot - px;
            assertLe(gap * 100, spot);
        }
        uint256 inventory = _upInventory();
        emit log_named_uint("up inventory", inventory);
        assertLt(book.cap(), inventory);
    }

    function testForkTapeShipMatchesSpotAndCapLoses() public {
        vm.createSelectFork("https://xlayer.drpc.org");
        vm.recordLogs();
        new TapeSyncShip();
        (address markAddr, address bookAddr) = _shipped();
        TapeSyncMark mark = TapeSyncMark(markAddr);
        SyncTierTapeRisk book = SyncTierTapeRisk(bookAddr);
        uint256 px = book.mark();
        uint256 spot = mark.spotUsd();
        emit log_named_uint("tape mark", px);
        emit log_named_uint("tape spot", spot);
        assertGt(px, 0.01 ether);
        assertLt(px, 5 ether);
        emit log_named_uint("tape guard", mark.guard() ? 1 : 0);
        if (mark.guard()) {
            uint256 gap = px > spot ? px - spot : spot - px;
            assertLe(gap * 100, spot);
        }
        uint256 inventory = _tapeInventory();
        emit log_named_uint("tape inventory", inventory);
        assertLt(book.cap() * 1e12, inventory);
    }

    function testForkHoldCost() public {
        vm.createSelectFork("https://bsc-dataseed.binance.org");
        _logUp(99);
        _logUp(96);
        vm.createSelectFork("https://rpc.xlayer.tech");
        _logTape(99);
        _logTape(96);
    }

    function _logUp(uint256 keep) internal {
        uint256 spot = _upNet(1e18);
        uint256 sold = _searchUp(spot, keep);
        uint256 fair = sold * spot / 1e18;
        uint256 inventory = fair * _bemUsd() / 1e8;
        (,,,, uint256 net) = IUpLive(UP).quoteSell(sold);
        uint256 slip = fair > net ? (fair - net) * _bemUsd() / 1e8 : 0;
        emit log_named_uint("up keep", keep);
        emit log_named_uint("up inventory", inventory);
        emit log_named_uint("up slippage", slip);
        emit log_named_uint("up half inventory", inventory / 2);
    }

    function _logTape(uint256 keep) internal {
        (, uint256 out) = ITapeLive(TAPE).previewSwap(1, true, 1e8);
        uint256 sold = _searchTape(out, keep);
        uint256 fair = sold * out / 1e8;
        uint256 inventory = fair * _okbUsd() / 1e18;
        (, uint256 got) = ITapeLive(TAPE).previewSwap(1, true, sold);
        uint256 slip = fair > got ? (fair - got) * _okbUsd() / 1e18 : 0;
        emit log_named_uint("tape keep", keep);
        emit log_named_uint("tape inventory", inventory);
        emit log_named_uint("tape slippage", slip);
        emit log_named_uint("tape half inventory", inventory / 2);
    }

    function testForkRoundTrip() public {
        vm.createSelectFork("https://bsc-dataseed.binance.org");
        _roundUp(99);
        vm.createSelectFork("https://rpc.xlayer.tech");
        _roundTape(99);
    }

    function _roundUp(uint256 keep) internal {
        uint256 spot = _upNet(1e18);
        uint256 sold = _searchUp(spot, keep);
        uint256 bemBefore = IERC20Live(BEM_BSC).balanceOf(address(this));
        uint256 upBefore = IERC20Live(UP_TOKEN).balanceOf(address(this));
        this.tryUp(sold);
        uint256 bemGot = IERC20Live(BEM_BSC).balanceOf(address(this)) - bemBefore;
        (uint256 instantIn, uint256 reservoir, uint256 fee, uint256 gross, uint256 tax, uint256 net) = IUpBuy(UP).quoteBuy(bemGot);
        emit log_named_uint("up bem", bemGot);
        emit log_named_uint("up quote instant", instantIn);
        emit log_named_uint("up quote reservoir", reservoir);
        emit log_named_uint("up quote fee", fee);
        emit log_named_uint("up quote gross", gross);
        emit log_named_uint("up quote tax", tax);
        emit log_named_uint("up quote net", net);
        vm.warp(block.timestamp + 121);
        IERC20Live(BEM_BSC).approve(UP, bemGot);
        IUpLive(UP).buy(bemGot, 0);
        (uint256 budget, uint256 spent, uint256 opened, uint256 updated) = IUpPos(UP).position(address(this));
        emit log_named_uint("up budget", budget);
        emit log_named_uint("up spent", spent);
        emit log_named_uint("up opened", opened);
        emit log_named_uint("up updated", updated);
        uint256 instant = IERC20Live(UP_TOKEN).balanceOf(address(this)) - upBefore;
        uint256 vested;
        try IUpRelease(UP).pendingRelease(address(this)) returns (uint256 p) { vested = p; } catch {}
        try IUpRelease(UP).releasable(address(this)) returns (uint256 r) { vested += r; } catch {}
        uint256 back = budget;
        uint256 loss = sold > back ? sold - back : 0;
        uint256 lossUsd = loss * spot / 1e18 * _bemUsd() / 1e8;
        uint256 fair = sold * spot / 1e18;
        uint256 slip = fair > bemGot ? (fair - bemGot) * _bemUsd() / 1e8 : 0;
        emit log_named_uint("up one way", slip);
        emit log_named_uint("up round loss", lossUsd);
        emit log_named_uint("up cap from round", lossUsd * 125);
        emit log_named_uint("up cap from two slips", slip * 2 * 125);
    }

    function _roundTape(uint256 keep) internal {
        (, uint256 out) = ITapeLive(TAPE).previewSwap(1, true, 1e8);
        uint256 sold = _searchTape(out, keep);
        address wokb = 0xe538905cf8410324e03A5A23C1c177a474D59b2b;
        uint256 nativeBefore = address(this).balance;
        this.tryTape(sold);
        uint256 tapeLeft = IERC20Live(TAPE_TOKEN).balanceOf(address(this));
        uint256 wokbGot = IERC20Live(wokb).balanceOf(address(this));
        uint256 nativeGot = address(this).balance - nativeBefore;
        vm.warp(block.timestamp + 121);
        if (wokbGot > 0) {
            IERC20Live(wokb).approve(TAPE, wokbGot);
            ITapeLive(TAPE).swap(1, false, wokbGot, 0);
        } else if (nativeGot > 0) {
            ITapeLive(TAPE).swap{value: nativeGot}(1, false, nativeGot, 0);
        }
        uint256 back = IERC20Live(TAPE_TOKEN).balanceOf(address(this));
        uint256 loss = sold > back ? sold - back : 0;
        uint256 lossUsd = loss * out / 1e8 * _okbUsd() / 1e18;
        emit log_named_uint("tape sold", sold);
        emit log_named_uint("tape left after sell", tapeLeft);
        emit log_named_uint("tape wokb", wokbGot);
        emit log_named_uint("tape native", nativeGot);
        emit log_named_uint("tape back", back);
        emit log_named_uint("tape round loss", lossUsd);
        emit log_named_uint("tape cap125", lossUsd * 125);
    }

    function _shipped() internal returns (address markAddr, address bookAddr) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256("Shipped(address,address)");
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] != topic) continue;
            markAddr = address(uint160(uint256(logs[i].topics[1])));
            bookAddr = address(uint160(uint256(logs[i].topics[2])));
        }
        require(markAddr != address(0) && bookAddr != address(0), "ship");
    }

    function _upInventory() internal returns (uint256) {
        uint256 spot = _upNet(1e18);
        uint256 sold = _searchUp(spot, 97);
        uint256 fair = sold * spot / 1e18;
        return fair * _bemUsd() / 1e8;
    }

    function _tapeInventory() internal returns (uint256) {
        (, uint256 out) = ITapeLive(TAPE).previewSwap(1, true, 1e8);
        uint256 sold = _searchTape(out, 97);
        uint256 fair = sold * out / 1e8;
        return fair * _okbUsd() / 1e18;
    }

    function _searchUp(uint256 spot, uint256 keep) internal returns (uint256 best) {
        uint256 lo = 1e18;
        uint256 hi = 2_000_000e18;
        for (uint256 i; i < 18; i++) {
            uint256 mid = (lo + hi) / 2;
            uint256 snap = vm.snapshotState();
            bool moved;
            try this.tryUp(mid) {
                moved = _upNet(1e18) * 100 <= spot * keep;
            } catch {
                hi = mid;
                vm.revertToState(snap);
                continue;
            }
            vm.revertToState(snap);
            if (moved) {
                best = mid;
                hi = mid;
            } else lo = mid;
        }
        require(best > 0, "no up");
    }

    function _searchTape(uint256 spotOut, uint256 keep) internal returns (uint256 best) {
        uint256 lo = 1e8;
        uint256 hi = 20_000e8;
        for (uint256 i; i < 18; i++) {
            uint256 mid = (lo + hi) / 2;
            uint256 snap = vm.snapshotState();
            bool moved;
            try this.tryTape(mid) {
                (, uint256 nowOut) = ITapeLive(TAPE).previewSwap(1, true, 1e8);
                moved = nowOut * 100 <= spotOut * keep;
            } catch {
                hi = mid;
                vm.revertToState(snap);
                continue;
            }
            vm.revertToState(snap);
            if (moved) {
                best = mid;
                hi = mid;
            } else lo = mid;
        }
        require(best > 0, "no tape");
    }

    function tryUp(uint256 amount) external {
        deal(UP_TOKEN, address(this), amount);
        IERC20Live(UP_TOKEN).approve(UP, amount);
        IUpLive(UP).deposit(amount);
        IUpLive(UP).sell(amount, 0);
    }

    function tryTape(uint256 amount) external {
        deal(TAPE_TOKEN, address(this), amount);
        IERC20Live(TAPE_TOKEN).approve(TAPE, amount);
        ITapeLive(TAPE).swap(1, true, amount, 0);
    }

    function _upNet(uint256 amount) internal view returns (uint256 net) {
        (,,,, net) = IUpLive(UP).quoteSell(amount);
    }

    function _bemUsd() internal view returns (uint256) {
        uint160 sqrtP = ISlot(BEM_POOL).slot0();
        uint256 sq = uint256(sqrtP) * uint256(sqrtP);
        return ((uint256(1) << 192) * 1e18) / sq / 1e10;
    }

    function _okbUsd() internal view returns (uint256) {
        uint160 sqrtP = ISlot(OKB_POOL).slot0();
        uint256 sq = uint256(sqrtP) * uint256(sqrtP);
        return (uint256(1) << 192) * 1e12 / sq * 1e18;
    }
}
