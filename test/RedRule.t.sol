// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Test.sol";
import "../contracts/RedNext.sol";

contract Route {
    function swapExactETHForTokens(uint256, address[] calldata, address, uint256) external payable returns (uint256[] memory amounts) {
        amounts = new uint256[](2);
        amounts[1] = 1;
    }
}

contract RedRuleTest is Test {
    function testCreatorCannotRewriteARoundAfterTheTask() public {
        Route router = new Route();
        RedNext next = new RedNext(address(router), address(1), address(2), address(3), address(4), address(5), address(6), 1, 1);
        address task = address(0xBEEF);
        address alice = makeAddr("alice");
        address bob = makeAddr("bob");
        vm.warp(1_700_000_000);
        address booth = next.BOOTH();
        vm.deal(booth, 20 ether);
        vm.prank(booth, alice);
        next.begin{value: 10 ether}(address(0), 1 ether, uint256(uint160(task)), 0.01 ether, 0, 1 days, 0, 10 ether);

        vm.prank(alice);
        next.setRule(address(0), 0, 2 ether, 0, uint256(uint160(task)), 10, 10, 0.01 ether, 0, 0, 1 days, 0);
        assertEq(next.fixedAmt(), 2 ether);
        assertEq(next.tasksDone(), 0);

        vm.deal(bob, 1 ether);
        vm.prank(bob, bob);
        next.trade{value: 0.01 ether}(0, 1);
        assertEq(next.tasksDone(), 1);

        vm.prank(alice);
        vm.expectRevert(bytes("frozen"));
        next.setRule(address(0), 0, 1, 0, uint256(uint160(task)), 1, 0, 0.01 ether, 0, 0, 1 days, 0);
        assertEq(next.fixedAmt(), 2 ether, "earned prize was rewritten");
        assertEq(next.dayCap(), 10);

        vm.warp(block.timestamp + 180);
        vm.prank(bob, bob);
        next.claim();
        assertEq(bob.balance, 1 ether - 0.01 ether + 2 ether, "claim did not pay the frozen prize");

        vm.warp(next.endsAt() + 1);
        vm.prank(alice);
        next.setRule(address(0), 0, 1 ether, 0, uint256(uint160(task)), 4, 4, 0.01 ether, 0, 0, 1 days, 0);
        assertEq(next.tasksDone(), 0, "a later round stayed frozen");
        assertEq(next.fixedAmt(), 1 ether);
    }

    function testCreatorCannotWithdrawAnEarnedPrize() public {
        Route router = new Route();
        RedNext next = new RedNext(address(router), address(1), address(2), address(3), address(4), address(5), address(6), 1, 1);
        address task = address(0xBEEF);
        address alice = makeAddr("alice");
        address bob = makeAddr("bob");
        vm.warp(1_700_000_000);
        address booth = next.BOOTH();
        vm.deal(booth, 20 ether);
        vm.prank(booth, alice);
        next.begin{value: 10 ether}(address(0), 1 ether, uint256(uint160(task)), 0.01 ether, 0, 7 days, 0, 10 ether);

        vm.deal(bob, 1 ether);
        vm.prank(bob, bob);
        next.trade{value: 0.01 ether}(0, 1);
        assertEq(next.prizeOf(bob), 1 ether);
        assertEq(next.reserved(), 1 ether);

        vm.prank(alice);
        vm.expectRevert(bytes("early"));
        next.withdraw(9 ether);

        vm.warp(next.endsAt() + 1);
        vm.prank(alice);
        vm.expectRevert(bytes("earned"));
        next.withdraw(10 ether);
        vm.prank(alice);
        next.withdraw(9 ether);
        assertEq(address(next).balance, 1 ether, "earned prize was withdrawn");

        vm.prank(bob, bob);
        next.claim();
        assertEq(bob.balance, 1 ether - 0.01 ether + 1 ether, "earned prize was not paid after the round");
        assertEq(next.reserved(), 0);
    }
}
