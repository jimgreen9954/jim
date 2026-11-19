// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20 {
    function transferFrom(address, address, uint256) external returns (bool);
}

/// One payment per id. A second call with the same id reverts. There is no admin.
contract TapeFee {
    mapping(bytes32 => bool) public paid;

    error Bad();

    function pay(bytes32 id, address token, address referrer, uint256 reward, address desk, uint256 deskAmt) external payable {
        if (id == bytes32(0) || paid[id]) revert Bad();
        if (reward == 0 && deskAmt == 0) revert Bad();
        paid[id] = true;
        if (token == address(0)) {
            if (msg.value != reward + deskAmt) revert Bad();
            _push(referrer, reward);
            _push(desk, deskAmt);
        } else {
            if (msg.value != 0) revert Bad();
            _pull(token, referrer, reward);
            _pull(token, desk, deskAmt);
        }
    }

    function _pull(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (to == address(0)) revert Bad();
        if (!IERC20(token).transferFrom(msg.sender, to, amount)) revert Bad();
    }

    function _push(address to, uint256 amount) internal {
        if (amount == 0) return;
        if (to == address(0)) revert Bad();
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert Bad();
    }
}
