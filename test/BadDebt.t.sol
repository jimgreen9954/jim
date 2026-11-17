// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Test.sol";
import "../contracts/TapeLendErc.sol";
import "../contracts/TermBook.sol";

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
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract SpotBook {
    uint256 public tape = 1e8;
    uint256 public okb = 1 ether;

    function okbPool() external view returns (uint256, uint256, uint256) {
        return (tape, okb, 0);
    }

    function bemPool() external view returns (uint256, uint256, uint256) {
        return (tape, okb, 0);
    }
}

contract OraclePool {
    address public token0;
    address public token1;
    int24 public tick;

    constructor(address usdt, address coll) {
        token0 = usdt;
        token1 = coll;
    }

    function setTick(int24 next) external {
        tick = next;
    }

    function observe(uint32[] calldata) external view returns (int56[] memory cum, uint160[] memory sqrt) {
        cum = new int56[](2);
        cum[1] = int56(tick) * 1800;
        sqrt = new uint160[](2);
    }
}

contract BadDebtTest is Test {
    uint256 internal constant UNIT = 1e18;

    Cash internal usdt;
    Cash internal coll;
    OraclePool internal oracle;
    TapeLendErc internal lend;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal liq = makeAddr("liq");
    address internal dave = makeAddr("dave");
    address internal fee = makeAddr("fee");

    function setUp() public {
        usdt = new Cash();
        coll = new Cash();
        oracle = new OraclePool(address(usdt), address(coll));
        lend = new TapeLendErc(0, address(usdt), address(coll), address(oracle), 18, fee);
    }

    function _fund(address who, uint256 usdtAmt, uint256 collAmt) internal {
        usdt.mint(who, usdtAmt);
        coll.mint(who, collAmt);
        vm.startPrank(who);
        usdt.approve(address(lend), type(uint256).max);
        coll.approve(address(lend), type(uint256).max);
        vm.stopPrank();
    }

    function _deposit(address who, uint256 amount) internal {
        vm.prank(who);
        lend.deposit(amount);
    }

    /// Two equal suppliers, one borrower, then a crash that collateral cannot cover.
    function _lendBook(int24 crash) internal returns (uint256 shortfall) {
        _fund(alice, 1_000 * UNIT, 0);
        _fund(bob, 1_000 * UNIT, 0);
        _fund(carol, 0, 1_000 * UNIT);
        _fund(liq, 2_000 * UNIT, 0);
        _deposit(alice, 1_000 * UNIT);
        _deposit(bob, 1_000 * UNIT);
        vm.startPrank(carol);
        lend.lock(1_000 * UNIT);
        lend.borrow(500 * UNIT);
        vm.stopPrank();
        oracle.setTick(crash);
        vm.prank(liq);
        lend.liquidate(carol, type(uint256).max);
        shortfall = lend.impaired();
        uint256 stillCovered = lend.totalBorrow();
        assertGt(shortfall, 100 * UNIT, "shortfall");
        assertLt(stillCovered, shortfall / 5, "bad debt still in totalBorrow");
        assertEq(lend.assets(), lend.cash() + stillCovered, "assets include uncovered debt");
        assertEq(lend.debtOf(carol), shortfall + lend.totalBorrow(), "obligation split wrong");
    }

    function testLendWorthlessCollateralIsNotAnAsset() public {
        uint256 shortfall = _lendBook(800000);
        assertEq(shortfall, 500 * UNIT, "full debt should be impaired");
        assertEq(lend.cash(), 1_500 * UNIT, "only unborrowed cash remains");
    }

    function testLendNewDepositAfterShortfallUsesImpairedNav() public {
        _lendBook(800000);
        uint256 assetsBefore = lend.assets();
        uint256 sharesBefore = lend.totalShares();
        uint256 bad = lend.impaired();
        assertGt(bad, 0);
        uint256 depositAmt = 100 * UNIT;
        _fund(dave, depositAmt, 0);
        _deposit(dave, depositAmt);
        uint256 minted = lend.totalShares() - sharesBefore;
        uint256 fair = depositAmt * (sharesBefore + 1_000_000) / (assetsBefore + 1_000);
        uint256 inflated = depositAmt * (sharesBefore + 1_000_000) / (assetsBefore + bad + 1_000);
        assertEq(minted, fair, "minted on book value");
        assertGt(minted, inflated, "new deposit got too few shares");
        uint256 daveSupply = lend.supplyOf(dave);
        assertApproxEqAbs(daveSupply, depositAmt, 1e12, "dave did not buy at impaired nav");
    }

    function testLendSequentialWithdrawalsShareTheLoss() public {
        _lendBook(800000);
        uint256 aliceShares = lend.shareOf(alice);
        uint256 bobShares = lend.shareOf(bob);
        uint256 pool = lend.cash();
        vm.prank(alice);
        lend.withdraw(aliceShares);
        uint256 aliceGot = usdt.balanceOf(alice);
        vm.prank(bob);
        lend.withdraw(bobShares);
        uint256 bobGot = usdt.balanceOf(bob);
        assertApproxEqRel(aliceGot, bobGot, 0.001e18, "exit order changed the loss");
        assertApproxEqAbs(aliceGot + bobGot, pool, 1e12, "cash was not the impaired nav");
        assertLt(aliceGot, 900 * UNIT, "first exit took pre-loss cash");
        assertEq(lend.totalShares(), 0);
    }

    function testLendPartialThenFullRecoveryCreditsOnce() public {
        uint256 shortfall = _lendBook(800000);
        uint256 assets0 = lend.assets();
        uint256 borrow0 = lend.totalBorrow();
        uint256 half = shortfall / 2;
        _fund(carol, shortfall, 0);
        vm.prank(carol);
        lend.repay(half);
        assertEq(lend.totalBorrow(), borrow0, "recovery reopened the loan asset");
        assertEq(lend.impaired(), shortfall - half);
        assertEq(lend.assets(), assets0 + half, "partial recovery counted twice");
        assertEq(lend.debtOf(carol), shortfall - half);
        vm.prank(carol);
        lend.repay(shortfall - half);
        assertEq(lend.impaired(), 0);
        assertEq(lend.totalBorrow(), borrow0);
        assertEq(lend.assets(), assets0 + shortfall, "full recovery counted twice");
        assertEq(lend.debtOf(carol), 0);
        assertEq(lend.assets(), lend.cash());
    }

    function testLendZeroNavRecoveryStaysWithTheOldGeneration() public {
        _fund(alice, 500 * UNIT, 0);
        _fund(bob, 500 * UNIT, 0);
        _fund(carol, 0, 4_000 * UNIT);
        _deposit(alice, 500 * UNIT);
        _deposit(bob, 500 * UNIT);
        vm.startPrank(carol);
        lend.lock(4_000 * UNIT);
        lend.borrow(1_000 * UNIT);
        vm.stopPrank();
        oracle.setTick(800000);
        vm.prank(liq);
        lend.liquidate(carol, type(uint256).max);
        assertEq(lend.cash(), 0, "cash left");
        assertEq(lend.totalBorrow(), 0, "worthless debt still an asset");
        assertEq(lend.assets(), 0, "nav not zero");
        assertEq(lend.impaired(), 1_000 * UNIT);

        uint256 freshDeposit = 200 * UNIT;
        _fund(dave, freshDeposit, 0);
        _deposit(dave, freshDeposit);
        assertEq(lend.assets(), freshDeposit, "restart priced the dead book");
        assertEq(lend.supplyOf(alice), 0, "old shares survived the restart");
        assertApproxEqAbs(lend.supplyOf(dave), freshDeposit, 1e12);

        uint256 recovered = 400 * UNIT;
        _fund(carol, recovered, 0);
        vm.prank(carol);
        lend.repay(recovered);
        assertEq(lend.assets(), freshDeposit, "recovery paid the new pool");
        assertEq(lend.totalBorrow(), 0, "recovery restored totalBorrow");
        assertEq(lend.impaired(), 1_000 * UNIT - recovered);

        (uint256 aliceClaim,,) = lend.rescue(alice);
        (uint256 bobClaim,,) = lend.rescue(bob);
        assertGt(aliceClaim, 0);
        assertGt(bobClaim, 0);
        vm.prank(alice);
        lend.claim(aliceClaim);
        vm.prank(bob);
        lend.claim(bobClaim);
        assertApproxEqAbs(usdt.balanceOf(alice) + usdt.balanceOf(bob), recovered, 1);
        assertEq(lend.assets(), freshDeposit, "claim changed the new pool");
        vm.expectRevert();
        vm.prank(alice);
        lend.claim(1);
    }

    /// A shortfall opened after the restart belongs to the new suppliers.
    /// Repaying the frozen generation must not move that cash, or be booked twice.
    function testLendRecoveryAfterRestartFollowsItsGeneration() public {
        _fund(alice, 500 * UNIT, 0);
        _fund(bob, 500 * UNIT, 0);
        _fund(carol, 0, 4_000 * UNIT);
        _deposit(alice, 500 * UNIT);
        _deposit(bob, 500 * UNIT);
        vm.startPrank(carol);
        lend.lock(4_000 * UNIT);
        lend.borrow(1_000 * UNIT);
        vm.stopPrank();
        oracle.setTick(800000);
        vm.prank(liq);
        lend.liquidate(carol, type(uint256).max);
        assertEq(lend.assets(), 0);

        uint256 freshDeposit = 2_000 * UNIT;
        _fund(dave, freshDeposit, 0);
        _deposit(dave, freshDeposit);

        address eve = makeAddr("eve");
        _fund(eve, 0, 2_000 * UNIT);
        oracle.setTick(0);
        vm.startPrank(eve);
        lend.lock(2_000 * UNIT);
        lend.borrow(500 * UNIT);
        vm.stopPrank();
        oracle.setTick(800000);
        vm.prank(liq);
        lend.liquidate(eve, type(uint256).max);

        assertEq(lend.totalBorrow(), 0, "new bad debt stayed in totalBorrow");
        assertEq(lend.impaired(), 1_500 * UNIT);
        assertEq(lend.cash(), 1_500 * UNIT);
        assertEq(lend.rescuePot(), 0);

        _fund(eve, 200 * UNIT, 0);
        vm.prank(eve);
        lend.repay(200 * UNIT);
        assertEq(lend.assets(), 1_700 * UNIT, "new recovery missed the new pool");
        assertEq(lend.rescuePot(), 0, "new recovery paid the frozen generation");
        assertEq(lend.totalBorrow(), 0, "new recovery reopened totalBorrow");
        assertEq(lend.impaired(), 1_300 * UNIT);
        uint256 daveAfterNew = lend.supplyOf(dave);
        assertApproxEqAbs(daveAfterNew, 1_700 * UNIT, 1e12);

        _fund(carol, 300 * UNIT, 0);
        vm.prank(carol);
        lend.repay(300 * UNIT);
        assertEq(lend.assets(), 1_700 * UNIT, "old recovery paid the new pool");
        assertEq(lend.rescuePot(), 300 * UNIT, "old recovery was not frozen");
        assertEq(lend.totalBorrow(), 0, "old recovery reopened totalBorrow");
        assertEq(lend.impaired(), 1_000 * UNIT, "recovery retired the memo twice");
        assertApproxEqAbs(lend.supplyOf(dave), daveAfterNew, 1, "old recovery changed new nav");
        assertEq(lend.debtOf(carol), 700 * UNIT);
        assertEq(lend.debtOf(eve), 300 * UNIT);
    }

    function _mark(TermBook book, uint8 id, uint256 price) internal {
        vm.store(address(book), keccak256(abi.encode(uint256(id), uint256(0))), bytes32(price));
        vm.store(address(book), keccak256(abi.encode(uint256(id), uint256(1))), bytes32(uint256(block.timestamp)));
        vm.store(address(book), keccak256(abi.encode(uint256(id), uint256(2))), bytes32(uint256(3)));
        vm.store(address(book), keccak256(abi.encode(uint256(id), uint256(3))), bytes32(uint256(1)));
    }

    function _termBook(uint256 crashPx) internal returns (TermBook book, uint256 id, uint256 shortfall) {
        vm.chainId(56);
        book = new TermBook(fee);
        address usdtBsc = book.tokenOf(0);
        Cash token = new Cash();
        vm.etch(usdtBsc, address(token).code);
        Cash stable = Cash(usdtBsc);
        _mark(book, 0, 1e18);
        _mark(book, 1, 100e18);
        assertTrue(book.fresh(0) && book.fresh(1));

        uint256 each = 10_000e18;
        stable.mint(alice, each);
        stable.mint(bob, each);
        vm.startPrank(alice);
        stable.approve(address(book), type(uint256).max);
        book.deposit(0, each);
        vm.stopPrank();
        vm.startPrank(bob);
        stable.approve(address(book), type(uint256).max);
        book.deposit(0, each);
        vm.stopPrank();

        stable.mint(liq, 1_000e18);
        vm.prank(liq);
        stable.approve(address(book), type(uint256).max);

        uint256 principal = 5_000e18;
        vm.deal(carol, 100 ether);
        vm.prank(carol);
        book.open{value: 100 ether}(1, 0, 0, 100 ether, principal);
        _mark(book, 1, crashPx);
        vm.prank(liq);
        book.liquidate(1);
        shortfall = book.impaired(0);
        id = 1;
        assertGt(shortfall, 1_000e18, "term shortfall");
        assertLt(book.principalOut(0), shortfall / 5, "unrecoverable principal still in principalOut");
        (uint256 supplyA,,) = book.account(0, alice);
        (uint256 supplyB,,) = book.account(0, bob);
        uint256 nav = _navOf(book);
        assertApproxEqAbs(supplyA + supplyB, nav, 2, "shares priced on book principal");
        assertLt(nav, each * 2 - shortfall / 2, "nav ignored the shortfall");
    }

    function _navOf(TermBook book) internal view returns (uint256) {
        (uint256 cashAmt, uint256 outAmt,,,,,) = book.pool(0);
        return cashAmt + outAmt;
    }

    function testTermWorthlessCollateralIsNotAnAsset() public {
        (TermBook book,, uint256 shortfall) = _termBook(1);
        assertGt(shortfall, 4_999e18, "almost all principal still an asset");
        assertEq(book.principalOut(0), 0);
        (uint256 cashAmt,,,,,,) = book.pool(0);
        assertLt(cashAmt, 15_000e18 + 1e15);
        assertEq(book.debtOf(1), shortfall, "borrower obligation dropped");
    }

    function testTermNewDepositSequentialWithdrawPartialAndFullRecovery() public {
        (TermBook book,, uint256 shortfall) = _termBook(1e18);
        uint256 nav0 = _navOf(book);
        address usdtBsc = book.tokenOf(0);
        Cash stable = Cash(usdtBsc);
        uint256 depositAmt = 1_000e18;
        stable.mint(dave, depositAmt);
        vm.startPrank(dave);
        stable.approve(address(book), type(uint256).max);
        book.deposit(0, depositAmt);
        vm.stopPrank();
        (uint256 daveSupply,, uint256 daveShares) = book.account(0, dave);
        uint256 fairShares = depositAmt * (book.totalShares(0) - daveShares) / nav0;
        assertEq(daveShares, fairShares, "mint used pre-loss principal");
        assertApproxEqAbs(daveSupply, depositAmt, 1e12);

        (,, uint256 aliceShares) = book.account(0, alice);
        (,, uint256 bobShares) = book.account(0, bob);
        uint256 aliceBefore = stable.balanceOf(alice);
        uint256 bobBefore = stable.balanceOf(bob);
        vm.prank(alice);
        book.withdraw(0, aliceShares);
        vm.prank(bob);
        book.withdraw(0, bobShares);
        uint256 aliceGot = stable.balanceOf(alice) - aliceBefore;
        uint256 bobGot = stable.balanceOf(bob) - bobBefore;
        assertApproxEqRel(aliceGot, bobGot, 0.001e18, "term exit order");
        assertLt(aliceGot, 9_000e18, "first term exit took the shortfall");

        // Dave still holds the post-impairment book. Recover against that nav.
        uint256 daveNav = _navOf(book);
        uint256 half = shortfall / 2;
        stable.mint(carol, shortfall);
        vm.startPrank(carol);
        stable.approve(address(book), type(uint256).max);
        book.repay(1, half);
        vm.stopPrank();
        assertEq(book.principalOut(0), 0, "recovery put principal back on the book");
        assertEq(_navOf(book), daveNav + half, "partial recovery counted twice");
        assertEq(book.impaired(0), shortfall - half);
        vm.prank(carol);
        book.repay(1, shortfall - half);
        assertEq(book.impaired(0), 0);
        assertEq(book.principalOut(0), 0);
        assertEq(_navOf(book), daveNav + shortfall, "full recovery counted twice");
        assertEq(book.debtOf(1), 0);
    }

    function testTermZeroNavRecoveryDoesNotRestartAsProfit() public {
        vm.chainId(56);
        TermBook book = new TermBook(fee);
        address usdtBsc = book.tokenOf(0);
        Cash token = new Cash();
        vm.etch(usdtBsc, address(token).code);
        Cash stable = Cash(usdtBsc);
        _mark(book, 0, 1e18);
        _mark(book, 1, 100e18);
        uint256 each = 10e18;
        stable.mint(alice, each);
        vm.startPrank(alice);
        stable.approve(address(book), type(uint256).max);
        book.deposit(0, each);
        vm.stopPrank();
        vm.deal(carol, 1 ether);
        vm.prank(carol);
        book.open{value: 0.2 ether}(1, 0, 0, 0.2 ether, each);
        _mark(book, 1, 1);
        vm.prank(liq);
        book.liquidate(1);
        (uint256 cashAmt, uint256 outAmt,,,,,) = book.pool(0);
        assertEq(cashAmt, 0);
        assertEq(outAmt, 0, "zero-nav principal still booked");
        assertEq(book.impaired(0), each);

        uint256 freshDeposit = 250e18;
        stable.mint(dave, freshDeposit);
        vm.startPrank(dave);
        stable.approve(address(book), type(uint256).max);
        book.deposit(0, freshDeposit);
        vm.stopPrank();
        (uint256 daveSupply,,) = book.account(0, dave);
        (uint256 aliceSupply,,) = book.account(0, alice);
        assertEq(aliceSupply, 0, "old term shares priced into the new book");
        assertApproxEqAbs(daveSupply, freshDeposit, 1);

        uint256 recovered = 6e18;
        stable.mint(carol, recovered);
        vm.startPrank(carol);
        stable.approve(address(book), type(uint256).max);
        book.repay(1, recovered);
        vm.stopPrank();
        (uint256 daveAfter,,) = book.account(0, dave);
        assertEq(daveAfter, daveSupply, "recovery became new-pool profit");
        assertEq(book.principalOut(0), 0);
        (uint256 claimable,,) = book.rescue(0, alice);
        assertGt(claimable, 0);
        vm.prank(alice);
        book.claim(0, claimable);
        assertEq(stable.balanceOf(alice), recovered);
        (uint256 daveFinal,,) = book.account(0, dave);
        assertEq(daveFinal, daveSupply);
        vm.expectRevert();
        vm.prank(alice);
        book.claim(0, 1);
        uint256 more = 2e18;
        stable.mint(carol, more);
        vm.prank(carol);
        book.repay(1, more);
        (uint256 daveLater,,) = book.account(0, dave);
        assertEq(daveLater, daveSupply, "later recovery entered the new pool");
        assertEq(book.rescuePot(0), more);
        vm.prank(alice);
        book.claim(0, type(uint256).max);
        assertEq(stable.balanceOf(alice), recovered + more);
    }

    /// The shortfall is already visible. Nobody has called liquidate.
    function testLendShortfallPricesSharesBeforeLiquidation() public {
        _fund(alice, 1_000 * UNIT, 0);
        _fund(bob, 1_000 * UNIT, 0);
        _fund(carol, 0, 1_000 * UNIT);
        _deposit(alice, 1_000 * UNIT);
        _deposit(bob, 1_000 * UNIT);
        vm.startPrank(carol);
        lend.lock(1_000 * UNIT);
        lend.borrow(500 * UNIT);
        vm.stopPrank();
        oracle.setTick(800000);

        assertEq(lend.impaired(), 0, "crystallized before anyone acted");
        assertEq(lend.totalBorrow(), 500 * UNIT, "debt left the index early");
        assertEq(lend.cash() + lend.totalBorrow(), 2_000 * UNIT, "book no longer shows the hole");
        assertEq(lend.assets(), 1_500 * UNIT, "view still prices uncovered debt");
        assertEq(lend.debtOf(carol), 500 * UNIT, "borrower was forgiven");
        assertLt(lend.supplyOf(alice), 900 * UNIT, "quoted supply ignored the hole");

        uint256 aliceShares = lend.shareOf(alice);
        vm.prank(alice);
        lend.withdraw(aliceShares);
        uint256 aliceGot = usdt.balanceOf(alice);
        assertLt(aliceGot, 900 * UNIT, "first exit before liquidation took pre-loss cash");
        assertApproxEqAbs(aliceGot, 750 * UNIT, 1e15, "alice did not take half the remaining cash");
        assertEq(lend.impaired(), 500 * UNIT, "withdraw did not crystallize the hole");
        assertEq(lend.totalBorrow(), 0, "uncovered debt stayed in totalBorrow");
        assertEq(lend.debtOf(carol), 500 * UNIT, "obligation dropped on the way out");
        assertEq(lend.collateral(carol), 1_000 * UNIT, "residual collateral disappeared");

        uint256 bobShares = lend.shareOf(bob);
        vm.prank(bob);
        lend.withdraw(bobShares);
        assertApproxEqRel(usdt.balanceOf(bob), aliceGot, 0.001e18, "second exit before liquidation");

        vm.prank(liq);
        lend.liquidate(carol, type(uint256).max);
        assertEq(lend.collateral(carol), 0, "residual collateral could not be seized");
        assertEq(coll.balanceOf(liq), 1_000 * UNIT, "liquidator did not receive the residual");
        assertEq(lend.debtOf(carol), 500 * UNIT, "seizing collateral forgave the debt");
    }

    function testTermShortfallPricesSharesBeforeLiquidation() public {
        vm.chainId(56);
        TermBook book = new TermBook(fee);
        address usdtBsc = book.tokenOf(0);
        Cash token = new Cash();
        vm.etch(usdtBsc, address(token).code);
        Cash stable = Cash(usdtBsc);
        _mark(book, 0, 1e18);
        _mark(book, 1, 100e18);
        uint256 each = 10_000e18;
        stable.mint(alice, each);
        stable.mint(bob, each);
        vm.startPrank(alice);
        stable.approve(address(book), type(uint256).max);
        book.deposit(0, each);
        vm.stopPrank();
        vm.startPrank(bob);
        stable.approve(address(book), type(uint256).max);
        book.deposit(0, each);
        vm.stopPrank();
        vm.deal(carol, 100 ether);
        vm.prank(carol);
        book.open{value: 100 ether}(1, 0, 0, 100 ether, 5_000e18);
        _mark(book, 1, 1);

        assertEq(book.impaired(0), 0, "term hole crystallized early");
        assertGt(book.principalOut(0), 4_000e18, "principal left the book early");
        (uint256 supplyA,, uint256 aliceShares) = book.account(0, alice);
        assertLt(supplyA, 8_000e18, "term view still uses booked principal");
        assertEq(book.debtOf(1), 5_000e18, "term borrower was forgiven");

        uint256 before = stable.balanceOf(alice);
        vm.prank(alice);
        book.withdraw(0, aliceShares);
        uint256 got = stable.balanceOf(alice) - before;
        assertLt(got, 9_000e18, "first term exit before liquidation took pre-loss cash");
        assertGt(book.impaired(0), 4_999e18, "withdraw left the principal booked");
        assertLt(book.principalOut(0), 1_000, "uncovered principal stayed in principalOut");
        assertEq(book.debtOf(1), 5_000e18, "term obligation dropped");
    }

    /// Taking some recovery must not enlarge the other supplier's claim on what is repaid later.
    function testPartialClaimKeepsTheOriginalSplit() public {
        _fund(alice, 500 * UNIT, 0);
        _fund(bob, 500 * UNIT, 0);
        _fund(carol, 0, 4_000 * UNIT);
        _fund(liq, 1, 0);
        _deposit(alice, 500 * UNIT);
        _deposit(bob, 500 * UNIT);
        vm.startPrank(carol);
        lend.lock(4_000 * UNIT);
        lend.borrow(1_000 * UNIT);
        vm.stopPrank();
        oracle.setTick(800000);
        vm.prank(liq);
        lend.liquidate(carol, type(uint256).max);
        _fund(dave, 200 * UNIT, 0);
        _deposit(dave, 200 * UNIT);

        _fund(carol, 900 * UNIT, 0);
        vm.prank(carol);
        lend.repay(400 * UNIT);
        assertEq(lend.rescueEver(), 400 * UNIT, "recovery was not reserved");
        assertGt(lend.rescueShares(), 0, "frozen generation has no weight");
        (uint256 aliceWeight,, uint256 weight) = lend.rescue(alice);
        (uint256 bobWeight,,) = lend.rescue(bob);
        assertEq(aliceWeight + bobWeight, weight);
        assertGt(aliceWeight * 400 * UNIT / weight, lend.rescuePot() / 4, "partial claim exceeds alice");
        uint256 piece = lend.rescuePot() / 4;
        vm.prank(alice);
        lend.claim(piece);

        vm.prank(carol);
        lend.repay(400 * UNIT);
        assertEq(lend.assets(), 200 * UNIT, "later recovery entered the new pool");
        vm.prank(alice);
        lend.claim(type(uint256).max);
        vm.prank(bob);
        lend.claim(type(uint256).max);
        assertApproxEqAbs(usdt.balanceOf(alice), aliceWeight * 800 * UNIT / weight, 2);
        assertApproxEqAbs(usdt.balanceOf(bob), bobWeight * 800 * UNIT / weight, 2);
        assertEq(lend.assets(), 200 * UNIT);

        vm.prank(carol);
        lend.repay(100 * UNIT);
        assertEq(lend.rescuePot(), 100 * UNIT, "recovery after a full take was not reserved");
        assertEq(lend.assets(), 200 * UNIT, "recovery after a full take entered the new pool");
        vm.prank(alice);
        lend.claim(type(uint256).max);
        vm.prank(bob);
        lend.claim(type(uint256).max);
        assertApproxEqAbs(usdt.balanceOf(alice), aliceWeight * 900 * UNIT / weight, 3);
        assertApproxEqAbs(usdt.balanceOf(bob), bobWeight * 900 * UNIT / weight, 3);
    }

    function testLaggingTapePriceBlocksWithdrawal() public {
        address open = 0x58eaD5b41Cfd3627791D439402dd65571c286484;
        address okbPool = 0xe3BE6A0137f1b0602Fc1a4841686f43B340a5082;
        vm.etch(open, address(new SpotBook()).code);
        vm.store(open, bytes32(0), bytes32(uint256(1e8)));
        vm.store(open, bytes32(uint256(1)), bytes32(uint256(1 ether)));
        vm.etch(okbPool, address(new OraclePool(address(1), address(2))).code);
        address usdtX = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
        address tape = 0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3;
        vm.etch(usdtX, address(usdt).code);
        vm.etch(tape, address(coll).code);
        TapeLendErc book = new TapeLendErc(1, usdtX, tape, open, 8, fee);
        Cash usd = Cash(usdtX);
        Cash tok = Cash(tape);
        usd.mint(alice, 1_000e18);
        tok.mint(carol, 1_000e8);
        vm.startPrank(alice);
        usd.approve(address(book), type(uint256).max);
        book.deposit(1_000e18);
        vm.stopPrank();
        vm.startPrank(carol);
        tok.approve(address(book), type(uint256).max);
        book.lock(1_000e8);
        book.borrow(500e18);
        vm.stopPrank();

        vm.store(open, bytes32(uint256(1)), bytes32(uint256(0.01 ether)));
        vm.warp(block.timestamp + 30);
        book.poke();
        assertFalse(book.fresh(), "one step still counts as fresh");
        assertGt(book.assets(), 900e18, "lagging stored price still treats the debt as covered");
        uint256 aliceShares = book.shareOf(alice);
        vm.expectRevert();
        vm.prank(alice);
        book.withdraw(aliceShares);

        vm.warp(block.timestamp + 30 minutes);
        assertFalse(book.fresh(), "expired price still counts as fresh");
        vm.expectRevert();
        vm.prank(alice);
        book.withdraw(aliceShares);
    }

    function testStaleTermPriceBlocksWithdrawal() public {
        vm.chainId(56);
        TermBook book = new TermBook(fee);
        address usdtBsc = book.tokenOf(0);
        vm.etch(usdtBsc, address(usdt).code);
        Cash stable = Cash(usdtBsc);
        _mark(book, 0, 1e18);
        _mark(book, 1, 100e18);
        stable.mint(alice, 1_000e18);
        vm.startPrank(alice);
        stable.approve(address(book), type(uint256).max);
        book.deposit(0, 1_000e18);
        vm.stopPrank();
        vm.deal(carol, 1 ether);
        vm.prank(carol);
        book.open{value: 1 ether}(1, 0, 0, 1 ether, 40e18);
        vm.warp(block.timestamp + 31 minutes);
        vm.expectRevert(TermBook.Stale.selector);
        vm.prank(alice);
        book.withdraw(0, 100e18);
        _mark(book, 0, 1e18);
        _mark(book, 1, 1);
        vm.prank(alice);
        book.withdraw(0, 100e18);
        assertLt(stable.balanceOf(alice), 98e18, "stale collateral price priced the withdrawal");
        assertGt(stable.balanceOf(alice), 90e18);
    }

    function testOpenLoanCapBoundsWithdrawal() public {
        vm.chainId(56);
        TermBook book = new TermBook(fee);
        address usdtBsc = book.tokenOf(0);
        vm.etch(usdtBsc, address(usdt).code);
        Cash stable = Cash(usdtBsc);
        _mark(book, 0, 1e18);
        _mark(book, 1, 100e18);
        stable.mint(alice, 1_000e18);
        vm.startPrank(alice);
        stable.approve(address(book), type(uint256).max);
        book.deposit(0, 1_000e18);
        vm.stopPrank();
        uint256 n = book.MAX_OPEN();
        for (uint256 i; i < n; i++) {
            address user = address(uint160(0xA000 + i));
            vm.deal(user, 1 ether);
            vm.prank(user);
            book.open{value: 0.2 ether}(1, 0, 0, 0.2 ether, 10e18);
        }
        vm.deal(address(0xB000), 1 ether);
        vm.prank(address(0xB000));
        vm.expectRevert();
        book.open{value: 0.2 ether}(1, 0, 0, 0.2 ether, 10e18);
        uint256 used;
        uint256 mark = gasleft();
        vm.prank(alice);
        book.withdraw(0, 1e18);
        used = mark - gasleft();
        emit log_named_uint("term withdraw gas at cap", used);
        assertLt(used, 8_000_000, "withdrawal at the loan cap does not fit");
    }
}
