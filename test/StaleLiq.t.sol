// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Test.sol";
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

contract StaleLiqTest is Test {
    address constant USDT = 0x55d398326f99059fF775485246999027B3197955;
    address constant BEM = 0x5ce033B2bFCa3Af30b3e8C8457DeaF776A8b695a;

    TermBook book;
    Cash usdt;
    Cash bem;
    address lender = makeAddr("lender");
    address user = makeAddr("user");
    address liq = makeAddr("liq");

    function setUp() public {
        vm.chainId(56);
        usdt = new Cash();
        bem = new Cash();
        vm.etch(USDT, address(usdt).code);
        vm.etch(BEM, address(bem).code);
        book = new TermBook(makeAddr("safe"));
        Cash(USDT).mint(lender, 1_000 ether);
        Cash(BEM).mint(user, 100e8);
        vm.prank(lender);
        Cash(USDT).approve(address(book), type(uint256).max);
        vm.prank(user);
        Cash(BEM).approve(address(book), type(uint256).max);
        vm.prank(lender);
        book.deposit(0, 1_000 ether);
        book.poke(0);
        _mark(2, 1 ether, true);
        vm.prank(user);
        book.open(2, 0, 0, 100e8, 40 ether);
    }

    function testFreshLiquidatesAtTheNormalLine() public {
        _mark(2, 0.5 ether, true);
        vm.prank(liq);
        Cash(USDT).mint(liq, 40 ether);
        vm.prank(liq);
        Cash(USDT).approve(address(book), type(uint256).max);
        vm.prank(liq);
        book.liquidate(1);
        assertEq(book.openLoans(user), 0);
    }

    function testStalePriceRefusesAMildShort() public {
        _mark(2, 0.5 ether, true);
        vm.warp(block.timestamp + 31 minutes);
        vm.prank(liq);
        Cash(USDT).mint(liq, 40 ether);
        vm.prank(liq);
        Cash(USDT).approve(address(book), type(uint256).max);
        vm.prank(liq);
        vm.expectRevert(TermBook.Bad.selector);
        book.liquidate(1);
        assertEq(book.openLoans(user), 1);
    }

    function testStalePriceClosesADeepShortWithoutABonus() public {
        _mark(2, 0.43 ether, true);
        vm.warp(block.timestamp + 31 minutes);
        vm.prank(liq);
        Cash(USDT).mint(liq, 40 ether);
        vm.prank(liq);
        Cash(USDT).approve(address(book), type(uint256).max);
        uint256 before = Cash(BEM).balanceOf(liq);
        vm.prank(liq);
        book.liquidate(1);
        uint256 seized = Cash(BEM).balanceOf(liq) - before;
        assertEq(book.openLoans(user), 0);
        assertLt(seized, 100e8, "stale liquidation took the whole pile");
    }

    function _mark(uint8 id, uint256 price, bool ready) internal {
        vm.store(address(book), keccak256(abi.encode(uint256(id), uint256(0))), bytes32(price));
        vm.store(address(book), keccak256(abi.encode(uint256(id), uint256(1))), bytes32(block.timestamp));
        vm.store(address(book), keccak256(abi.encode(uint256(id), uint256(3))), ready ? bytes32(uint256(1)) : bytes32(0));
    }
}
