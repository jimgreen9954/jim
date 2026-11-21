// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "./UpSyncMark.sol";
import "./SyncTierTapeRisk.sol";

/// One multisig transaction. Deploys the UP mark and the tiered book.
/// The page does not switch to these addresses until they are checked.
/// CAP is 500 USDT of entry notional. Moving the official pool 3% took about
/// 686 USDT of inventory when this was set. A round trip lost about 10 USDT.
contract UpSyncShip {
    address public constant UP_POOL = 0xDf40529fa3E797c992272e27B811E59E5f1827Ae;
    address public constant BEM_POOL = 0x3098D7A051045000d68eC0360753A40C8cABEa31;
    address public constant USDT = 0x55d398326f99059fF775485246999027B3197955;
    address public constant SAFE = 0xE51C19aE6E4261Ed329CC54F1120Cf0Ae09364Bd;
    uint256 public constant CAP = 500 ether;

    event Shipped(address indexed mark, address indexed book);

    constructor() {
        UpSyncMark mark = new UpSyncMark(UP_POOL, BEM_POOL);
        SyncTierTapeRisk book = new SyncTierTapeRisk(USDT, address(mark), 1 ether, SAFE, CAP);
        emit Shipped(address(mark), address(book));
    }
}
