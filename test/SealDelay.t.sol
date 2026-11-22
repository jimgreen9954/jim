// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Test.sol";
import "../contracts/SealRebate.sol";

contract Tip is IERC20 {
    mapping(address => uint256) public balanceOf;
    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract SealDelayTest is Test {
    Tip tip;
    SealRebate pool;
    address clerk = address(0xC1);

    function setUp() public {
        tip = new Tip();
        pool = new SealRebate(address(tip), address(0), address(0), address(0), address(0), address(0), clerk);
        tip.mint(address(pool), 100);
    }

    function testClerkWaitsADayAndAStrangerCannotWithdraw() public {
        vm.prank(address(0xB0B));
        vm.expectRevert(SealRebate.Bad.selector);
        pool.queue(40);

        vm.prank(clerk);
        pool.queue(40);
        vm.prank(clerk);
        vm.expectRevert(SealRebate.Bad.selector);
        pool.withdraw();

        vm.warp(block.timestamp + 1 days);
        vm.prank(address(0xB0B));
        vm.expectRevert(SealRebate.Bad.selector);
        pool.withdraw();

        vm.prank(clerk);
        pool.withdraw();
        assertEq(tip.balanceOf(clerk), 40);
        assertEq(tip.balanceOf(address(pool)), 60);
    }

    function testAClaimDuringTheWaitShrinksThePayout() public {
        vm.prank(clerk);
        pool.queue(100);
        tip.mint(address(1), 0);
        // Someone is paid from the pool while the clerk is waiting.
        vm.prank(address(pool));
        tip.transfer(address(0xB0B), 30);
        vm.warp(block.timestamp + 1 days);
        vm.prank(clerk);
        pool.withdraw();
        assertEq(tip.balanceOf(clerk), 70);
        assertEq(tip.balanceOf(address(pool)), 0);
    }
}
