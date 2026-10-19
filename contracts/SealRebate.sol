// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

interface ICircuits {
    function ownerOf(uint256 id) external view returns (address);
    function circuitInfo(uint256 id) external view returns (uint256, uint256, uint256, uint256);
}

interface ITape {
    function deals(uint256 id)
        external
        view
        returns (
            address long,
            address short,
            uint96 marginL,
            uint96 marginS,
            uint128 base,
            uint128 entry,
            bool open,
            uint16 levL,
            uint16 levS
        );
    function referrerOf(address user) external view returns (address);
}

interface IGate {
    function deals(uint256 id)
        external
        view
        returns (
            address long,
            address short,
            uint8 market,
            uint96 marginL,
            uint96 marginS,
            uint128 base,
            uint128 entry,
            bool open,
            uint16 levL,
            uint16 levS
        );
    function referrerOf(address user) external view returns (address);
}

/// Refunds half of a matched fee after three seal circuits.
/// One claim per Singapore week (Monday 00:00, UTC+8). The book fee is unchanged.
/// The pool is funded by transfer, never pulled from the fee address.
contract SealRebate {
    IERC20 public immutable usdt;
    address public immutable circuits;
    address public immutable clerk;
    address public immutable gate;

    mapping(address => bool) public tape;
    mapping(address => bool) public passed;
    mapping(address => mapping(uint256 => mapping(address => bool))) public claimed;
    mapping(address => uint256) public claimedWeek;
    uint256 private entered = 1;

    error Bad();

    constructor(address usdt_, address circuits_, address gate_, address a, address b, address c) {
        if (usdt_ == address(0)) revert Bad();
        usdt = IERC20(usdt_);
        circuits = circuits_;
        clerk = tx.origin;
        gate = gate_;
        if (a != address(0)) tape[a] = true;
        if (b != address(0)) tape[b] = true;
        if (c != address(0)) tape[c] = true;
    }

    function qualify(uint256 a, uint256 b, uint256 c) external {
        if (circuits == address(0) || a == b || b == c || a == c) revert Bad();
        _own(a);
        _own(b);
        _own(c);
        passed[msg.sender] = true;
    }

    function pass(address who) external {
        if (circuits != address(0) || msg.sender != clerk || who == address(0)) revert Bad();
        passed[who] = true;
    }

    function fund(uint256 amount) external lock {
        _take(msg.sender, amount);
    }

    function withdraw(uint256 amount) external lock {
        if (msg.sender != clerk || amount == 0) revert Bad();
        _pay(msg.sender, amount);
    }

    function preview(address book, uint256 dealId, address user) external view returns (uint256) {
        (address long, address short, uint256 marginL, uint256 marginS) = _sides(book, dealId);
        uint256 net = user == long ? marginL : user == short ? marginS : 0;
        if (net == 0) return 0;
        return _fee(book, user, net) / 2;
    }

    /// Monday 00:00 Asia/Singapore. Epoch Thursday makes Monday land 3 days earlier.
    function weekOf(uint256 ts) public pure returns (uint256) {
        uint256 wall = ts + 8 hours;
        uint256 dayIndex = wall / 1 days;
        uint256 back = (dayIndex + 3) % 7;
        return (dayIndex - back) / 7;
    }

    function claim(address[] calldata books_, uint256[] calldata ids) external lock {
        if (!passed[msg.sender] || books_.length != ids.length || books_.length == 0 || books_.length > 40) revert Bad();
        uint256 w = weekOf(block.timestamp) + 1;
        if (claimedWeek[msg.sender] == w) revert Bad();
        uint256 sum;
        for (uint256 i; i < ids.length; ++i) {
            if (claimed[books_[i]][ids[i]][msg.sender]) revert Bad();
            (address long, address short, uint256 marginL, uint256 marginS) = _sides(books_[i], ids[i]);
            uint256 net = msg.sender == long ? marginL : msg.sender == short ? marginS : 0;
            uint256 pay = _fee(books_[i], msg.sender, net) / 2;
            if (pay == 0) revert Bad();
            claimed[books_[i]][ids[i]][msg.sender] = true;
            sum += pay;
        }
        claimedWeek[msg.sender] = w;
        _pay(msg.sender, sum);
    }

    modifier lock() {
        if (entered != 1) revert Bad();
        entered = 2;
        _;
        entered = 1;
    }

    function _own(uint256 id) internal view {
        if (ICircuits(circuits).ownerOf(id) != msg.sender) revert Bad();
        (uint256 nIn, uint256 nOut,, uint256 gates) = ICircuits(circuits).circuitInfo(id);
        if (nIn != 4 || nOut != 1 || gates != 3) revert Bad();
    }

    function _sides(address book, uint256 dealId)
        internal
        view
        returns (address long, address short, uint256 marginL, uint256 marginS)
    {
        if (tape[book]) {
            (long, short, marginL, marginS,,,,,) = ITape(book).deals(dealId);
            return (long, short, marginL, marginS);
        }
        if (book == gate && gate != address(0)) {
            (long, short,, marginL, marginS,,,,,) = IGate(book).deals(dealId);
            return (long, short, marginL, marginS);
        }
        revert Bad();
    }

    function _fee(address book, address user, uint256 net) internal view returns (uint256) {
        if (net == 0) return 0;
        address ref = tape[book] ? ITape(book).referrerOf(user) : IGate(book).referrerOf(user);
        if (ref == address(0)) {
            uint256 guess = net * 2 / 998;
            uint256 again = (net + guess) * 2 / 1000;
            return again < guess ? again : guess;
        }
        uint256 guess = net * 192 / 99808;
        uint256 gross = (net + guess) * 2 / 1000;
        uint256 charge = gross - (gross * 4) / 100;
        return charge < guess ? charge : guess;
    }

    function _take(address from, uint256 amount) internal {
        (bool ok, bytes memory ret) = address(usdt).call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, address(this), amount)
        );
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert Bad();
    }

    function _pay(address to, uint256 amount) internal {
        (bool ok, bytes memory ret) = address(usdt).call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert Bad();
    }
}
