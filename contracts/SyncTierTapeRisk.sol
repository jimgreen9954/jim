// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "./TapeRisk.sol";

/// UP, TAPE and FAB book. Each open, close, liquidation and margin move records the mark.
/// Leverage is tiered. Long notional and short notional are each capped.
/// One address can hold at most a fifth of the cap on a side.
/// The live cap is the smaller of the multisig cap and 20 times the insurance.
/// The multisig can lower its cap now. A higher cap waits a day.
/// A liquidation needs two weak readings, at least two minutes apart.
/// A later price note clears a reading once that position is safe again.
/// The liquidation slice stays in insurance. The caller is not paid.
/// Opens and liquidations stop when guard() is false. A close still uses mark().
contract SyncTierTapeRisk is TapeRisk {
    uint256 public cap;
    uint256 public pendingCap;
    uint256 public pendingAt;
    uint256 public longNotional;
    uint256 public shortNotional;
    mapping(address => uint256) public longOf;
    mapping(address => uint256) public shortOf;
    mapping(uint256 => uint32) public liqSeen;
    uint256[] private liqWait;
    uint256 public constant DELAY = 1 days;
    uint256 public constant LIQ_GAP = 2 minutes;

    error Wait();
    error Denied();

    event LiqWait(uint256 indexed id, uint32 at);

    constructor(address usdt_, address pool_, uint256 unit_, address feeTo_, uint256 cap_)
        TapeRisk(usdt_, pool_, unit_, feeTo_)
    {
        if (cap_ == 0) revert Bad();
        cap = cap_;
    }

    /// Lower, or the same, applies now and clears a pending raise. A raise only schedules.
    function setCap(uint256 next) external {
        if (msg.sender != FEE_TO) revert Denied();
        if (next == 0) revert Bad();
        if (next <= cap) {
            cap = next;
            pendingCap = 0;
            pendingAt = 0;
            return;
        }
        pendingCap = next;
        pendingAt = block.timestamp;
    }

    function applyCap() external {
        if (pendingAt == 0 || pendingCap <= cap) revert Bad();
        if (block.timestamp < pendingAt + DELAY) revert Wait();
        cap = pendingCap;
        pendingCap = 0;
        pendingAt = 0;
    }

    /// Anyone can record the mark. Opens and liquidations still check the guard.
    /// The mark itself waits 30 seconds and moves at most about 0.5%.
    function sync() external {
        _note();
    }

    /// Anyone can add insurance. It cannot be withdrawn. Fees also stay here.
    function fundInsurance(uint256 amount) external {
        if (amount == 0) revert Bad();
        _take(msg.sender, amount);
        insurance += amount;
    }

    /// The side that is losing can add margin during the two-minute wait. A pause does not block this.
    function addMargin(uint256 id, uint256 amount) external nonReentrant {
        _note();
        Deal memory d = deals[id];
        if (!d.open || amount == 0) revert Bad();
        if (msg.sender == d.long) {
            if (uint256(d.marginL) + amount > type(uint96).max) revert Bad();
            _take(msg.sender, amount);
            deals[id].marginL = uint96(uint256(d.marginL) + amount);
        } else if (msg.sender == d.short) {
            if (uint256(d.marginS) + amount > type(uint96).max) revert Bad();
            _take(msg.sender, amount);
            deals[id].marginS = uint96(uint256(d.marginS) + amount);
        } else {
            revert Bad();
        }
    }

    /// Depth cap, unless insurance cannot cover a twentieth of it.
    function openCap() public view returns (uint256) {
        uint256 backed = insurance * 20;
        return backed < cap ? backed : cap;
    }

    function _maxLev(uint256 margin) internal view override returns (uint16) {
        if (margin <= MIN_MARGIN * 10) return 50;
        if (margin <= MIN_MARGIN * 100) return 20;
        return 5;
    }

    function _cap() internal view override returns (uint256) {
        return openCap();
    }

    function _reserve(address long, address short, uint256 notion) internal override {
        uint256 room = openCap();
        uint256 one = cap / 5;
        if (notion == 0 || one == 0 || room == 0 || notion > one || notion > room) revert Bad();
        if (longNotional > room - notion || shortNotional > room - notion) revert Bad();
        if (longOf[long] > one - notion || shortOf[short] > one - notion) revert Bad();
        longNotional += notion;
        shortNotional += notion;
        longOf[long] += notion;
        shortOf[short] += notion;
        openNotional += notion;
    }

    function _release(address long, address short, uint256 notion) internal override {
        longNotional = _sub(longNotional, notion);
        shortNotional = _sub(shortNotional, notion);
        longOf[long] = _sub(longOf[long], notion);
        shortOf[short] = _sub(shortOf[short], notion);
        openNotional = _sub(openNotional, notion);
    }

    function _sub(uint256 have, uint256 notion) private pure returns (uint256) {
        return have >= notion ? have - notion : 0;
    }

    function _guard() internal view override {
        (bool ok, bytes memory data) = address(pool).staticcall(abi.encodeWithSignature("guard()"));
        if (!ok || data.length < 32 || abi.decode(data, (bool)) != true) revert Bad();
    }

    function _note() internal override {
        address(pool).call(abi.encodeWithSignature("note()"));
        _clearSafe();
    }

    function _clearSafe() private {
        uint256 px = mark();
        uint256 i;
        while (i < liqWait.length) {
            uint256 id = liqWait[i];
            Deal memory d = deals[id];
            bool drop = !d.open;
            if (!drop) {
                (,, bool weakL, bool weakS) = _equity(d, px);
                drop = !weakL && !weakS;
                if (drop) liqSeen[id] = 0;
            }
            if (!drop) {
                i++;
                continue;
            }
            liqWait[i] = liqWait[liqWait.length - 1];
            liqWait.pop();
        }
    }

    function _forget(uint256 id) private {
        uint256 n = liqWait.length;
        for (uint256 i; i < n; i++) {
            if (liqWait[i] != id) continue;
            liqWait[i] = liqWait[n - 1];
            liqWait.pop();
            return;
        }
    }

    function _liqReady(uint256 id) internal override returns (bool) {
        Deal memory d = deals[id];
        if (!d.open) revert Bad();
        uint256 px = mark();
        (,, bool weakL, bool weakS) = _equity(d, px);
        if (!weakL && !weakS) {
            liqSeen[id] = 0;
            _forget(id);
            revert Bad();
        }
        uint32 prev = liqSeen[id];
        if (prev == 0) {
            liqSeen[id] = uint32(block.timestamp);
            liqWait.push(id);
            emit LiqWait(id, uint32(block.timestamp));
            return false;
        }
        if (block.timestamp < uint256(prev) + LIQ_GAP) return false;
        liqSeen[id] = 0;
        _forget(id);
        return true;
    }

    /// The old tenth for the caller stays in the book as insurance.
    function _slice(uint256 eqL, uint256 eqS, bool weakL, bool weakS)
        internal
        override
        returns (uint256 bounty, uint256 left, uint256 right)
    {
        left = eqL;
        right = eqS;
        bounty = 0;
        if (weakL && left > 0) {
            uint256 pot = left / 10 + left / 10;
            insurance += pot;
            left -= pot;
        }
        if (weakS && right > 0) {
            uint256 pot = right / 10 + right / 10;
            insurance += pot;
            right -= pot;
        }
    }

    /// The book's fee stays as insurance instead of being paid to the multisig.
    function _feeSplit(address user, uint256 fee) internal override returns (uint256) {
        address ref = referrerOf[user];
        if (ref == address(0) || fee == 0) {
            insurance += fee;
            return fee;
        }
        uint256 discount = fee * DISCOUNT_NUM / 100;
        uint256 reward = fee * REWARD_NUM / 100;
        accrued[ref] += reward;
        insurance += fee - discount - reward;
        return fee - discount;
    }
}