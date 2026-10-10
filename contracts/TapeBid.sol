// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

interface IERC20 {
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// Fixed bid. One buyer address, no admin, no upgrade.
/// Only BUYER can deposit USDT0 and take back unspent USDT0 or bought TAPE.
/// Anyone else can only sell whole TAPE and is paid USDT0 in the same transaction.
contract TapeBid {
    IERC20 public constant TAPE = IERC20(0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3);
    IERC20 public constant USDT = IERC20(0x779Ded0c9e1022225f8E0630b35a9b54bE713736);
    address public constant BUYER = 0x585d2DF4B8fDDA783B074555e6F3787e3fCB39D7;
    uint256 public constant UNIT = 100_000_000;
    uint256 public constant PRICE = 100_000;
    uint256 private entered = 1;

    uint256 public usdtPool;
    uint256 public tapeBought;

    modifier lock() {
        require(entered == 1, "reenter");
        entered = 2;
        _;
        entered = 1;
    }

    modifier onlyBuyer() {
        require(msg.sender == BUYER, "buyer");
        _;
    }

    function fundUsdt(uint256 amount) external lock onlyBuyer {
        require(amount > 0, "amount");
        _pull(USDT, amount);
        usdtPool += amount;
    }

    function withdrawUsdt(uint256 amount) external lock onlyBuyer {
        require(amount > 0 && amount <= usdtPool, "amount");
        usdtPool -= amount;
        _push(USDT, amount);
    }

    function withdrawTape(uint256 amount) external lock onlyBuyer {
        require(amount > 0 && amount <= tapeBought, "amount");
        tapeBought -= amount;
        _push(TAPE, amount);
    }

    function sell(uint256 tapeAmount) external lock {
        require(tapeAmount >= UNIT && tapeAmount % UNIT == 0, "integer");
        uint256 cost = tapeAmount / UNIT * PRICE;
        require(usdtPool >= cost, "pool");
        usdtPool -= cost;
        tapeBought += tapeAmount;
        _pull(TAPE, tapeAmount);
        _push(USDT, cost);
    }

    function _pull(IERC20 token, uint256 amount) internal {
        _move(address(token), abi.encodeWithSelector(IERC20.transferFrom.selector, msg.sender, address(this), amount));
    }

    function _push(IERC20 token, uint256 amount) internal {
        _move(address(token), abi.encodeWithSelector(IERC20.transfer.selector, msg.sender, amount));
    }

    function _move(address token, bytes memory data) internal {
        (bool ok, bytes memory ret) = token.call(data);
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "token");
    }
}
