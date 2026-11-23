// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Test.sol";
import "../contracts/RedPerp.sol";
import "../contracts/RedStamp.sol";

contract TipBook {
    uint256 public nextDeal;
    address public who;
    bool public shut;

    function shutDown(bool on) external {
        shut = on;
    }

    function deals(uint256)
        external
        view
        returns (address, address, uint96, uint96, uint128, uint128, bool, uint16, uint16)
    {
        return (who, address(1), 1 ether, 1 ether, 1, 1 ether, !shut, 1, 1);
    }
}

contract AsBooth {
    function arm(address packet) external payable {
        RedPerp(payable(packet)).begin{value: msg.value}(
            address(0), 0.1 ether, uint256(uint160(0x070c66555535e1145275df54f4eEBBfd28d98581)), 1 ether, 0, 1 days, 0, 0.3 ether
        );
    }
}

contract RedPerpLoTest is Test {
    address constant BOOK = 0x070c66555535e1145275df54f4eEBBfd28d98581;
    address constant STAMP = 0x30E48e1FA7B8FF93E213814d7EA3BbF35B28731A;
    address constant BOOTH = 0x284Fa8819980A229622B711A52BF66bD9cDCbC2d;
    address constant SAFE = 0xE51C19aE6E4261Ed329CC54F1120Cf0Ae09364Bd;
    address constant TRADER = address(0xB0B);

    function testOldDealCannotClaimAndOneFillPaysOnce() public {
        vm.chainId(56);
        vm.warp(1_700_000_000);
        vm.etch(BOOK, type(TipBook).runtimeCode);
        vm.store(BOOK, 0, bytes32(uint256(1)));
        vm.store(BOOK, bytes32(uint256(1)), bytes32(uint256(uint160(TRADER))));
        vm.etch(STAMP, type(RedStamp).runtimeCode);
        vm.etch(BOOTH, type(AsBooth).runtimeCode);

        RedPerp first = new RedPerp(SAFE);
        RedPerp second = new RedPerp(SAFE);
        vm.prank(SAFE);
        RedStamp(STAMP).allow(keccak256(address(first).code));

        AsBooth(BOOTH).arm{value: 0.3 ether}(address(first));
        AsBooth(BOOTH).arm{value: 0.3 ether}(address(second));
        assertEq(first.lo(), 2);
        assertEq(second.lo(), 2);

        vm.prank(TRADER, TRADER);
        vm.expectRevert(bytes("task"));
        first.trade(1, 0);

        vm.prank(TRADER, TRADER);
        first.trade(2, 0);
        assertEq(first.prizeOf(TRADER), 0);

        vm.prank(TRADER, TRADER);
        vm.expectRevert(bytes("used"));
        second.trade(2, 0);

        vm.warp(block.timestamp + 4 minutes);
        vm.prank(TRADER, TRADER);
        vm.expectRevert(bytes("hold"));
        first.trade(2, 0);

        TipBook(BOOK).shutDown(true);
        vm.warp(block.timestamp + 1 minutes);
        vm.prank(TRADER, TRADER);
        vm.expectRevert(bytes("open"));
        first.trade(2, 0);
        TipBook(BOOK).shutDown(false);

        vm.prank(TRADER, TRADER);
        first.trade(2, 0);
        assertEq(first.prizeOf(TRADER), 0.1 ether);

        vm.prank(TRADER, TRADER);
        first.claim();
        vm.prank(SAFE);
        RedStamp(STAMP).revoke(keccak256(address(first).code));
        vm.prank(TRADER, TRADER);
        vm.expectRevert(bytes("code"));
        first.trade(3, 0);

        vm.prank(SAFE);
        RedStamp(STAMP).allow(keccak256(address(first).code));
        vm.prank(TRADER, TRADER);
        vm.expectRevert(bytes("rival"));
        first.trade(3, 0);
    }

    function testRuntimeHashes() public {
        emit log_bytes32(keccak256(address(new RedPerp(0xE51C19aE6E4261Ed329CC54F1120Cf0Ae09364Bd)).code));
        emit log_bytes32(keccak256(address(new RedPerp(0xb4D6039394c8B97C3AC3234aa07011B564Fcb88c)).code));
    }
}
