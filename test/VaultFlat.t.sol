// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Test.sol";
import "../contracts/TapeVault.sol";

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

contract Book {
    Cash public cash;
    uint256 public nextQuote;
    uint256 public nextDeal;
    uint256 public payout = type(uint256).max;

    struct Quote {
        address user;
        bool long;
        uint96 margin;
        uint16 lev;
        bool open;
        uint128 price;
    }

    struct Deal {
        address long;
        address short;
        uint96 marginL;
        uint96 marginS;
        uint128 base;
        uint128 entry;
        bool open;
        uint16 levL;
        uint16 levS;
    }

    mapping(uint256 => Quote) public quotes;
    mapping(uint256 => Deal) public deals;

    constructor(Cash cash_) {
        cash = cash_;
    }

    function open(bool long, uint256 margin, uint16 lev, uint256 price) external {
        cash.transferFrom(msg.sender, address(this), margin);
        quotes[++nextQuote] = Quote(msg.sender, long, uint96(margin), lev, true, uint128(price));
    }

    function take(uint256 quoteId, uint256 margin, uint16 lev) external {
        cash.transferFrom(msg.sender, address(this), margin);
        Quote storage q = quotes[quoteId];
        q.open = false;
        deals[++nextDeal] = Deal(
            q.long ? q.user : msg.sender,
            q.long ? msg.sender : q.user,
            q.long ? q.margin : uint96(margin),
            q.long ? uint96(margin) : q.margin,
            1,
            q.price,
            true,
            q.long ? q.lev : lev,
            q.long ? lev : q.lev
        );
    }

    function cancel(uint256 quoteId) external {
        Quote storage q = quotes[quoteId];
        q.open = false;
        cash.transfer(q.user, q.margin);
    }

    function close(uint256 id) external {
        Deal storage d = deals[id];
        d.open = false;
        uint256 margin = d.long == msg.sender ? d.marginL : d.marginS;
        uint256 out = payout == type(uint256).max ? margin : payout;
        if (out > 0) cash.transfer(msg.sender, out);
    }

    function fill(uint256 quoteId) external {
        Quote storage q = quotes[quoteId];
        q.open = false;
        deals[++nextDeal] = Deal(q.user, address(1), q.margin, q.margin, 1, q.price, true, q.lev, 1);
    }

    function setPayout(uint256 payout_) external {
        payout = payout_;
    }
}

contract VaultFlatTest is Test {
    Cash cash;
    Book book;
    TapeVault vault;
    address leader = address(0xA11CE);
    address alice = address(0xA1);
    address bob = address(0xB0B);

    function setUp() public {
        cash = new Cash();
        book = new Book(cash);
        vault = new TapeVault(address(cash), address(book), leader, 0);
    }

    function _fund(address who, uint256 amount) internal {
        cash.mint(who, amount);
        vm.prank(who);
        cash.approve(address(vault), amount);
    }

    function testOpenLossCannotBeDumpedOnTheOtherDepositor() public {
        _fund(alice, 100 ether);
        _fund(bob, 100 ether);
        vm.prank(alice);
        vault.deposit(100 ether);
        vm.prank(bob);
        vault.deposit(100 ether);

        vm.prank(leader);
        vault.open(true, 100 ether, 1, 1 ether);
        book.fill(1);
        vault.sync();
        uint256 bobShares = vault.shares(bob);

        vm.prank(bob);
        vm.expectRevert(TapeVault.Bad.selector);
        vault.withdraw(bobShares);
        _fund(bob, 50 ether);
        vm.prank(bob);
        vm.expectRevert(TapeVault.Bad.selector);
        vault.deposit(50 ether);

        book.setPayout(1 ether);
        vm.prank(leader);
        vault.close(1);

        uint256 bobSharesLeft = vault.shares(bob);
        uint256 bobBefore = cash.balanceOf(bob);
        vm.prank(bob);
        vault.withdraw(bobSharesLeft);
        uint256 bobOut = cash.balanceOf(bob) - bobBefore;
        uint256 left = cash.balanceOf(address(vault));
        assertGt(bobOut, 40 ether);
        assertLt(bobOut, 70 ether);
        assertGt(left, 40 ether);
        assertLt(left, 70 ether);
    }

    function testNinthDealDoesNotGrowEquityOnASecondSync() public {
        _fund(alice, 20 ether);
        vm.prank(alice);
        vault.deposit(20 ether);
        for (uint256 i = 0; i < 9; i++) {
            vm.prank(leader);
            vault.open(true, 1 ether, 1, 1 ether);
            book.fill(book.nextQuote());
            vault.sync();
        }
        assertEq(vault.dealCount(), 9);
        assertEq(vault.hang(), 0);
        uint256 marked = vault.equity();
        vault.sync();
        assertEq(vault.equity(), marked);
        vault.sync();
        assertEq(vault.equity(), marked);
    }

    function testPartialCloseStillBlocksUntilFlat() public {
        _fund(alice, 10 ether);
        vm.prank(alice);
        vault.deposit(10 ether);
        vm.prank(leader);
        vault.open(true, 1 ether, 1, 1 ether);
        book.fill(1);
        vm.prank(leader);
        vault.open(false, 1 ether, 1, 1 ether);
        book.fill(2);
        vault.sync();
        vm.prank(leader);
        vault.close(1);
        assertEq(vault.dealCount(), 1);
        uint256 aliceShares = vault.shares(alice);
        vm.prank(alice);
        vm.expectRevert(TapeVault.Bad.selector);
        vault.withdraw(aliceShares);
        uint256 marked = vault.equity();
        vault.sync();
        assertEq(vault.equity(), marked);
    }

    function testCapRejectsInsteadOfAnonymousHang() public {
        _fund(alice, 40 ether);
        vm.prank(alice);
        vault.deposit(40 ether);
        for (uint256 i = 0; i < 32; i++) {
            vm.prank(leader);
            vault.open(true, 1 ether, 1, 1 ether);
            book.fill(book.nextQuote());
            vault.sync();
        }
        uint256 marked = vault.equity();
        vm.prank(leader);
        vm.expectRevert(TapeVault.Bad.selector);
        vault.open(true, 1 ether, 1, 1 ether);
        assertEq(vault.equity(), marked);
        assertEq(vault.hang(), 0);
    }

    function testAnyoneFlattensAQuoteAfterSixHours() public {
        _fund(alice, 10 ether);
        vm.prank(alice);
        vault.deposit(10 ether);
        vm.prank(bob);
        vm.expectRevert(TapeVault.Bad.selector);
        vault.askExit();
        vm.prank(bob);
        vm.expectRevert(TapeVault.Bad.selector);
        vault.forceFlat();

        vm.prank(leader);
        vault.open(true, 1 ether, 1, 1 ether);
        vm.prank(alice);
        vault.askExit();
        assertGt(vault.exitAt(), 0);
        vm.prank(leader);
        vm.expectRevert(TapeVault.Bad.selector);
        vault.open(false, 1 ether, 1, 1 ether);
        vm.prank(bob);
        vm.expectRevert(TapeVault.Bad.selector);
        vault.forceFlat();

        vm.warp(block.timestamp + 6 hours);
        vm.prank(bob);
        vault.forceFlat();
        assertEq(vault.quoteCount(), 0);
        assertEq(vault.exitAt(), 0);
        uint256 shares = vault.shares(alice);
        vm.prank(alice);
        vault.withdraw(shares);
        assertEq(vault.shares(alice), 0);
        assertEq(cash.balanceOf(alice), 10 ether);
    }

    function testAnyoneClosesADealAfterSixHours() public {
        _fund(alice, 10 ether);
        vm.prank(alice);
        vault.deposit(10 ether);
        vm.prank(leader);
        vault.open(true, 1 ether, 1, 1 ether);
        book.fill(book.nextQuote());
        vault.sync();
        assertEq(vault.dealCount(), 1);
        vm.prank(alice);
        vault.askExit();
        vm.warp(block.timestamp + 6 hours - 1);
        vm.prank(bob);
        vm.expectRevert(TapeVault.Bad.selector);
        vault.forceFlat();
        vm.warp(block.timestamp + 1);
        vm.prank(bob);
        vault.forceFlat();
        assertEq(vault.dealCount(), 0);
        assertEq(vault.locked(), 0);
    }
}
