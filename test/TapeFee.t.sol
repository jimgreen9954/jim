// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Test.sol";
import "../contracts/TapeFee.sol";

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

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract TapeFeeTest is Test {
    TapeFee fee;
    Cash cash;
    address desk = address(0xD1);
    address ref = address(0xA1);

    function setUp() public {
        fee = new TapeFee();
        cash = new Cash();
    }

    function testTokenPaysOnce() public {
        cash.mint(address(this), 100);
        cash.approve(address(fee), 100);
        bytes32 id = keccak256("fill");
        fee.pay(id, address(cash), ref, 6, desk, 90);
        assertEq(cash.balanceOf(ref), 6);
        assertEq(cash.balanceOf(desk), 90);
        assertTrue(fee.paid(id));
        vm.expectRevert(TapeFee.Bad.selector);
        fee.pay(id, address(cash), ref, 6, desk, 90);
    }

    function testNativePaysOnce() public {
        bytes32 id = keccak256("native");
        fee.pay{value: 10}(id, address(0), ref, 4, desk, 6);
        assertEq(ref.balance, 4);
        assertEq(desk.balance, 6);
        vm.expectRevert(TapeFee.Bad.selector);
        fee.pay{value: 10}(id, address(0), ref, 4, desk, 6);
    }

    receive() external payable {}
}
