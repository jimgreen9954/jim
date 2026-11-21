// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "./BemCapMark.sol";
import "./GuardTapeRisk.sol";

/// One multisig transaction. Deploys the BEM mark and the 50x book.
/// The page does not switch to these addresses until they are checked.
contract BemCapShip {
    event Shipped(address indexed mark, address indexed book);

    constructor(address bemPool, address okbPool, address usdt, uint256 unit, address feeTo) {
        BemCapMark mark = new BemCapMark(bemPool, okbPool);
        GuardTapeRisk book = new GuardTapeRisk(usdt, address(mark), unit, feeTo);
        emit Shipped(address(mark), address(book));
    }
}
