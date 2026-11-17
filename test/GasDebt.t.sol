// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Test.sol";
import "../contracts/TapeLend.sol";

contract GasCash {
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

contract GasWrap is GasCash {
    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "wrap");
    }

    receive() external payable {}
}

contract GasOracle {
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

/// OKB and BNB pools. Same shortfall rule as the ERC lend, including collateral left behind after the index is written off.
contract GasDebtTest is Test {
    uint256 internal constant UNIT = 1e18;

    GasCash internal usdt;
    GasWrap internal weth;
    GasOracle internal oracle;
    TapeLend internal gas;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal liq = makeAddr("liq");
    address internal dave = makeAddr("dave");
    address internal fee = makeAddr("fee");

    function setUp() public {
        usdt = new GasCash();
        weth = new GasWrap();
        oracle = new GasOracle(address(usdt), address(weth));
        gas = new TapeLend(address(usdt), address(weth), address(oracle), fee);
    }

    function _deposit(address who, uint256 amount) internal {
        usdt.mint(who, amount);
        vm.startPrank(who);
        usdt.approve(address(gas), type(uint256).max);
        gas.deposit(amount);
        vm.stopPrank();
    }

    function testGasShortfallPricesSharesBeforeLiquidation() public {
        _deposit(alice, 1_000 * UNIT);
        _deposit(bob, 1_000 * UNIT);
        vm.deal(carol, 1_000 ether);
        vm.prank(carol);
        gas.lockNative{value: 1_000 ether}();
        vm.prank(carol);
        gas.borrow(500 * UNIT);
        oracle.setTick(800000);

        assertEq(gas.impaired(), 0, "crystallized before anyone acted");
        assertEq(gas.assets(), 1_500 * UNIT, "view still prices uncovered debt");
        assertEq(gas.debtOf(carol), 500 * UNIT, "borrower was forgiven");
        assertLt(gas.supplyOf(alice), 900 * UNIT, "quote ignored the hole");

        uint256 aliceShares = gas.shares(alice);
        vm.prank(alice);
        gas.withdraw(aliceShares);
        uint256 aliceGot = usdt.balanceOf(alice);
        assertLt(aliceGot, 900 * UNIT, "first exit before liquidation took pre-loss cash");
        assertApproxEqAbs(aliceGot, 750 * UNIT, 1e15, "alice did not take half the remaining cash");
        assertEq(gas.impaired(), 500 * UNIT);
        assertEq(gas.totalBorrow(), 0, "uncovered debt stayed in totalBorrow");
        assertEq(gas.collateral(carol), 1_000 ether, "residual collateral disappeared");
        assertEq(gas.debtOf(carol), 500 * UNIT);

        vm.prank(liq);
        gas.liquidate(carol, type(uint256).max);
        assertEq(gas.collateral(carol), 0, "residual collateral could not be seized");
        assertEq(liq.balance, 1_000 ether, "liquidator did not receive the residual");
        assertEq(gas.debtOf(carol), 500 * UNIT, "seizing collateral forgave the debt");
        assertEq(gas.assets(), gas.cash());
    }

    function testGasZeroNavRecoveryIsNotNewCash() public {
        _deposit(alice, 500 * UNIT);
        _deposit(bob, 500 * UNIT);
        vm.deal(carol, 2_000 ether);
        vm.prank(carol);
        gas.lockNative{value: 2_000 ether}();
        vm.prank(carol);
        gas.borrow(1_000 * UNIT);
        oracle.setTick(800000);

        _deposit(dave, 200 * UNIT);
        assertEq(gas.assets(), 200 * UNIT, "restart priced the dead book");
        assertEq(gas.supplyOf(alice), 0, "old shares survived the restart");

        usdt.mint(carol, 400 * UNIT);
        vm.startPrank(carol);
        usdt.approve(address(gas), type(uint256).max);
        gas.repay(400 * UNIT);
        vm.stopPrank();
        assertEq(gas.assets(), 200 * UNIT, "old recovery paid the new pool");
        assertEq(gas.rescuePot(), 400 * UNIT);
        assertEq(gas.totalBorrow(), 0, "recovery reopened totalBorrow");

        uint256 aliceShares = gas.shares(alice);
        uint256 bobShares = gas.shares(bob);
        vm.prank(alice);
        gas.claim(aliceShares);
        vm.prank(bob);
        gas.claim(bobShares);
        assertApproxEqAbs(usdt.balanceOf(alice) + usdt.balanceOf(bob), 400 * UNIT, 1);
        assertEq(gas.assets(), 200 * UNIT, "claim changed the new pool");

        usdt.mint(carol, 100 * UNIT);
        vm.prank(carol);
        gas.repay(100 * UNIT);
        assertEq(gas.assets(), 200 * UNIT, "recovery after a full take entered the new pool");
        assertEq(gas.rescuePot(), 100 * UNIT);
        vm.prank(alice);
        gas.claim(type(uint256).max);
        vm.prank(bob);
        gas.claim(type(uint256).max);
        assertApproxEqAbs(usdt.balanceOf(alice) + usdt.balanceOf(bob), 500 * UNIT, 2);
        assertEq(gas.assets(), 200 * UNIT);
    }

    function testDebtorCapBoundsWithdrawal() public {
        _deposit(alice, 100_000 * UNIT);
        uint256 n = gas.MAX_DEBTORS();
        for (uint256 i; i < n; i++) {
            address user = address(uint160(0xC000 + i));
            vm.deal(user, 4 ether);
            vm.startPrank(user);
            gas.lockNative{value: 4 ether}();
            gas.borrow(1 * UNIT);
            vm.stopPrank();
        }
        vm.deal(address(0xD000), 4 ether);
        vm.startPrank(address(0xD000));
        gas.lockNative{value: 4 ether}();
        vm.stopPrank();
        vm.expectRevert();
        vm.prank(address(0xD000));
        gas.borrow(1 * UNIT);
        uint256 half = gas.shares(alice) / 2;
        uint256 mark = gasleft();
        vm.prank(alice);
        gas.withdraw(half);
        uint256 used = mark - gasleft();
        emit log_named_uint("lend withdraw gas at cap", used);
        assertLt(used, 8_000_000, "withdrawal at the borrower cap does not fit");
    }
}
