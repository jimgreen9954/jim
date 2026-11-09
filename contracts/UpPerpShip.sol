// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract UpPerpShip {
    event Book(address indexed book);

    constructor(bytes memory markCode, bytes memory riskCode, address usdt, uint256 scale, address safe) {
        address mark = _create(markCode);
        bytes memory bookCode = bytes.concat(riskCode, abi.encode(usdt, mark, scale, safe));
        emit Book(_create(bookCode));
    }

    function _create(bytes memory code) internal returns (address addr) {
        assembly {
            addr := create(0, add(code, 0x20), mload(code))
        }
        require(addr != address(0), "create");
    }
}
