// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract RedBooth {
    address[] public packets;

    event Opened(address indexed creator, address packet);

    function count() external view returns (uint256) {
        return packets.length;
    }

    function open(bytes calldata init, bytes calldata beginData) external payable returns (address packet) {
        bytes32 salt = keccak256(abi.encode(packets.length));
        bytes memory code = init;
        assembly {
            packet := create2(0, add(code, 0x20), mload(code), salt)
        }
        require(packet != address(0), "create");
        packets.push(packet);
        (bool ok, ) = packet.call{value: msg.value}(beginData);
        require(ok, "begin");
        emit Opened(msg.sender, packet);
    }
}
