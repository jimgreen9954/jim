// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// One confirmation. Pulls the desk fee from the caller, then runs the swap.
/// A revert returns the fee. Only msg.sender can be charged, so a standing
/// allowance cannot be spent by anyone else.
contract DeskLock {
    uint256 private locked;

    function run(
        address token,
        address safe,
        uint256 desk,
        address referrer,
        uint256 reward,
        uint256 pull,
        address spender,
        address router,
        address sweep,
        bytes calldata data
    ) external payable {
        require(locked == 0, "lock");
        locked = 1;
        uint256 value = msg.value;
        if (token == address(0)) {
            if (desk > 0) _sink(safe, desk);
            if (reward > 0) _sink(referrer, reward);
            require(value >= desk + reward, "value");
            value -= desk + reward;
        } else {
            if (desk > 0) _move(token, safe, desk);
            if (reward > 0) _move(token, referrer, reward);
            if (pull > 0) {
                _move(token, address(this), pull);
                _approve(token, spender, pull);
            }
        }
        (bool ok, bytes memory ret) = router.call{value: value}(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        if (sweep != address(0)) {
            uint256 bal = _balance(sweep);
            if (bal > 0) _push(sweep, msg.sender, bal);
        }
        uint256 left = address(this).balance;
        if (left > 0) _sink(msg.sender, left);
        locked = 0;
    }

    receive() external payable {}

    function _move(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(0x23b872dd, msg.sender, to, amount));
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "move");
    }

    function _push(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "push");
    }

    function _balance(address token) internal view returns (uint256 bal) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSelector(0x70a08231, address(this)));
        require(ok && ret.length >= 32, "bal");
        bal = abi.decode(ret, (uint256));
    }

    function _approve(address token, address spender, uint256 amount) internal {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(0x095ea7b3, spender, amount));
        if (ok && (ret.length == 0 || abi.decode(ret, (bool)))) return;
        (bool zeroOk, bytes memory zeroRet) = token.call(abi.encodeWithSelector(0x095ea7b3, spender, uint256(0)));
        require(zeroOk && (zeroRet.length == 0 || abi.decode(zeroRet, (bool))), "approve");
        (bool ok2, bytes memory ret2) = token.call(abi.encodeWithSelector(0x095ea7b3, spender, amount));
        require(ok2 && (ret2.length == 0 || abi.decode(ret2, (bool))), "approve");
    }

    function _sink(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        require(ok, "sink");
    }
}
