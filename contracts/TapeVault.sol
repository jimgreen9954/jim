// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}

interface IBook {
    function open(bool long, uint256 margin, uint16 lev, uint256 price) external;
    function take(uint256 quoteId, uint256 margin, uint16 lev) external;
    function cancel(uint256 quoteId) external;
    function close(uint256 id) external;
    function nextQuote() external view returns (uint256);
    function nextDeal() external view returns (uint256);
    function quotes(uint256 id)
        external
        view
        returns (address user, bool long, uint96 margin, uint16 lev, bool open, uint128 price);
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
}

/// Copy vault for one already-deployed perp.
/// The vault itself posts, takes, and closes. The leader cannot withdraw deposits.
/// A performance cut is paid only from realized profit, and only when nothing is open.
/// There is no owner and no rescue.
contract TapeVault {
    IERC20 public immutable usdt;
    address public immutable book;
    address public immutable leader;
    uint16 public immutable feeBps;
    uint256 public totalShares;
    uint256 public hwm;
    uint256 public locked;
    uint256 public hang;
    bool public live;
    mapping(address => uint256) public shares;

    uint256[] public quoteIds;
    uint256[] public dealIds;
    mapping(uint256 => bool) private knownDeal;

    uint256 private entered = 1;
    uint256 private skipHang;
    uint256 private constant DEAD = 1_000_000;
    uint256 private constant DUST = 1_000;
    uint256 private constant CAP = 8;

    error Bad();

    constructor(address usdt_, address book_, address leader_, uint16 feeBps_) {
        if (usdt_ == address(0) || book_ == address(0) || leader_ == address(0)) revert Bad();
        if (feeBps_ > 1000) revert Bad();
        usdt = IERC20(usdt_);
        book = book_;
        leader = leader_;
        feeBps = feeBps_;
        _token(abi.encodeWithSelector(IERC20.approve.selector, book_, type(uint256).max));
    }

    modifier guarded() {
        if (entered != 1) revert Bad();
        entered = 2;
        _;
        entered = 1;
    }

    function deposit(uint256 amount) external guarded {
        if (amount == 0) revert Bad();
        _sync();
        uint256 equity = _equity();
        uint256 minted = amount * (totalShares + DEAD) / (equity + DUST);
        if (minted == 0) revert Bad();
        _pull(msg.sender, amount);
        shares[msg.sender] += minted;
        totalShares += minted;
        if (!live) {
            live = true;
            hwm = _price(_equity());
        }
    }

    function withdraw(uint256 shareAmt) external guarded {
        if (shareAmt == 0 || shareAmt > shares[msg.sender] || totalShares == 0) revert Bad();
        _sync();
        uint256 equity = _equity();
        uint256 out = shareAmt * (equity + DUST) / (totalShares + DEAD);
        uint256 idle = usdt.balanceOf(address(this));
        if (out == 0 || out > idle) revert Bad();
        shares[msg.sender] -= shareAmt;
        totalShares -= shareAmt;
        _push(msg.sender, out);
        if (locked == 0) _crystallize();
    }

    function open(bool long, uint256 margin, uint16 lev, uint256 price) external guarded {
        if (msg.sender != leader) revert Bad();
        if (quoteIds.length >= CAP) revert Bad();
        _sync();
        if (margin == 0 || margin > usdt.balanceOf(address(this))) revert Bad();
        uint256 before = IBook(book).nextQuote();
        IBook(book).open(long, margin, lev, price);
        uint256 id = IBook(book).nextQuote();
        if (id == before) revert Bad();
        quoteIds.push(id);
        _sync();
    }

    function take(uint256 quoteId, uint256 margin, uint16 lev) external guarded {
        if (msg.sender != leader) revert Bad();
        if (dealIds.length >= CAP) revert Bad();
        _sync();
        if (margin == 0 || margin > usdt.balanceOf(address(this))) revert Bad();
        uint256 before = IBook(book).nextDeal();
        IBook(book).take(quoteId, margin, lev);
        uint256 id = IBook(book).nextDeal();
        if (id == before) revert Bad();
        _remember(id);
        _sync();
    }

    function cancel(uint256 quoteId) external guarded {
        if (msg.sender != leader) revert Bad();
        skipHang = quoteId;
        IBook(book).cancel(quoteId);
        _sync();
        skipHang = 0;
    }

    function close(uint256 id) external guarded {
        if (msg.sender != leader) revert Bad();
        IBook(book).close(id);
        _sync();
    }

    /// Anyone may attach a deal the vault is already on, so a filled quote is not forgotten.
    function resolve(uint256 id) external guarded {
        (uint256 ours, bool open) = _side(id);
        if (ours == 0) revert Bad();
        if (open) _remember(id);
        _sync();
    }

    function sync() external guarded {
        _sync();
    }

    function equity() external view returns (uint256) {
        return _equity();
    }

    function idle() external view returns (uint256) {
        return usdt.balanceOf(address(this));
    }

    function quoteCount() external view returns (uint256) {
        return quoteIds.length;
    }

    function dealCount() external view returns (uint256) {
        return dealIds.length;
    }

    function _sync() internal {
        _absorb();
        uint256 sum;
        uint256 i;
        while (i < quoteIds.length) {
            uint256 id = quoteIds[i];
            (address user, bool open, uint256 margin) = _quote(id);
            if (open && user == address(this) && margin > 0) {
                sum += margin;
                unchecked {
                    ++i;
                }
            } else {
                _dropQuote(i);
                if (id != skipHang && !_dealtSince) hang += margin;
            }
        }
        i = 0;
        while (i < dealIds.length) {
            (uint256 ours, bool open) = _side(dealIds[i]);
            if (open && ours > 0) {
                sum += ours;
                unchecked {
                    ++i;
                }
            } else {
                _dropDeal(i);
            }
        }
        sum += hang;
        locked = sum;
        _dealtSince = false;
        if (locked == 0) _crystallize();
    }

    bool private _dealtSince;

    function _absorb() internal {
        uint256 tip = IBook(book).nextDeal();
        if (tip == 0) return;
        uint256 start = tip > 64 ? tip - 64 : 0;
        for (uint256 id = tip; id > start; id--) {
            (uint256 ours, bool open) = _side(id);
            if (open && ours > 0 && !knownDeal[id]) {
                if (dealIds.length >= CAP) {
                    hang += ours;
                } else {
                    _remember(id);
                }
                _dealtSince = true;
            }
        }
    }

    function _remember(uint256 id) internal {
        if (knownDeal[id] || dealIds.length >= CAP) return;
        (uint256 ours, bool open) = _side(id);
        if (!open || ours == 0) return;
        knownDeal[id] = true;
        dealIds.push(id);
        if (hang <= ours) hang = 0;
        else if (hang - ours <= ours / 50) hang = 0;
        else hang -= ours;
    }

    function _quote(uint256 id) internal view returns (address user, bool open, uint256 margin) {
        try IBook(book).quotes(id) returns (address u, bool, uint96 m, uint16, bool o, uint128) {
            return (u, o, uint256(m));
        } catch {
            return (address(0), false, 0);
        }
    }

    function _side(uint256 id) internal view returns (uint256 ours, bool open) {
        try IBook(book).deals(id) returns (
            address long,
            address short,
            uint96 marginL,
            uint96 marginS,
            uint128,
            uint128,
            bool o,
            uint16,
            uint16
        ) {
            if (long == address(this)) return (uint256(marginL), o);
            if (short == address(this)) return (uint256(marginS), o);
            return (0, o);
        } catch {
            return (0, false);
        }
    }

    function _dropQuote(uint256 i) internal {
        uint256 last = quoteIds.length - 1;
        if (i != last) quoteIds[i] = quoteIds[last];
        quoteIds.pop();
    }

    function _dropDeal(uint256 i) internal {
        uint256 id = dealIds[i];
        knownDeal[id] = false;
        uint256 last = dealIds.length - 1;
        if (i != last) dealIds[i] = dealIds[last];
        dealIds.pop();
    }

    function _equity() internal view returns (uint256) {
        return usdt.balanceOf(address(this)) + locked;
    }

    function _price(uint256 equity) internal view returns (uint256) {
        return (equity + DUST) * 1e18 / (totalShares + DEAD);
    }

    function _crystallize() internal {
        if (!live || totalShares == 0 || feeBps == 0) return;
        uint256 equity = usdt.balanceOf(address(this));
        uint256 price = _price(equity);
        if (price <= hwm) return;
        uint256 profit = (price - hwm) * totalShares / 1e18;
        uint256 fee = profit * feeBps / 10_000;
        if (fee == 0 || fee > equity) return;
        _push(leader, fee);
        hwm = _price(usdt.balanceOf(address(this)));
    }

    function _pull(address from, uint256 amount) internal {
        uint256 before = usdt.balanceOf(address(this));
        _token(abi.encodeWithSelector(IERC20.transferFrom.selector, from, address(this), amount));
        if (usdt.balanceOf(address(this)) - before < amount) revert Bad();
    }

    function _push(address to, uint256 amount) internal {
        if (amount == 0 || to == address(0)) revert Bad();
        _token(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
    }

    function _token(bytes memory data) internal {
        (bool ok, bytes memory ret) = address(usdt).call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert Bad();
    }
}
