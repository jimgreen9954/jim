// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./TickMath.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

interface IPool {
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
}

/// New book. Does not call the stake, mine, lock, or pool-deposit contracts.
/// Funding moves margin between the two sides of one deal. It is capped.
/// Insurance is filled only from a liquidation slice and cannot be withdrawn.
/// ADL takes only unrealised profit from one other deal, never that trader's principal.
contract TapeRisk {
    IERC20 public immutable usdt;
    IPool public immutable pool;
    address public constant FEE_TO = 0x823b9F6A93Ac44Ce5A469823A336c15b6117054D;
    uint32 public constant TWAP = 600;
    uint256 public immutable MIN_MARGIN;
    uint256 public immutable MAX_MARGIN;
    uint256 public constant FEE_NUM = 2;
    uint256 public constant FEE_DEN = 1000;
    uint256 public constant DISCOUNT_NUM = 4;
    uint256 public constant REWARD_NUM = 6;
    uint256 public constant HOUR8 = 8 hours;
    int256 public constant FUND_CAP = 5e14;

    mapping(address => address) public referrerOf;
    mapping(address => uint256) public accrued;
    mapping(bytes32 => address) public codeOwner;
    mapping(address => bytes32) public codeOf;

    struct Quote {
        address user;
        bool long;
        uint96 margin;
        uint16 lev;
        bool open;
        uint128 price;
    }

    struct Deal {
        address long;
        address short;
        uint96 marginL;
        uint96 marginS;
        uint128 base;
        uint128 entry;
        bool open;
        uint16 levL;
        uint16 levS;
    }

    uint256 public nextQuote;
    mapping(uint256 => Quote) public quotes;
    uint256 public nextDeal;
    mapping(uint256 => Deal) public deals;
    mapping(uint256 => uint32) public fundedAt;
    uint256 public nextStop;
    mapping(uint256 => Stop) public stops;
    uint256 public nextTwap;
    mapping(uint256 => Twap) public twaps;
    mapping(uint256 => Trail) public trails;
    uint256 public lastPrice;
    uint256 public insurance;
    uint256 private entered = 1;

    struct Stop {
        address user;
        bool long;
        uint96 margin;
        uint16 lev;
        uint128 triggerPx;
        bool open;
    }

    struct Twap {
        address user;
        bool long;
        uint96 each;
        uint16 lev;
        uint8 left;
        uint32 nextAt;
        uint32 gap;
        bool open;
    }

    struct Trail {
        address user;
        bool long;
        uint32 bps;
        uint128 peak;
        bool open;
    }

    event Posted(uint256 indexed id, address indexed user, bool long, uint256 margin, uint16 lev, uint256 price);
    event Cancelled(uint256 indexed id, address indexed user, uint256 margin);
    event Matched(uint256 indexed id, uint256 indexed quoteId, address indexed long, address short, uint256 base, uint256 entry, uint256 fee);
    event Settled(uint256 indexed id, uint256 payLong, uint256 payShort, address caller);
    event Covered(uint256 indexed id, uint256 fromInsurance, uint256 fromAdl);

    error Bad();
    error Busy();

    constructor(address usdt_, address pool_, uint256 unit_) {
        if (unit_ != 1 ether && unit_ != 1e6) revert Bad();
        usdt = IERC20(usdt_);
        pool = IPool(pool_);
        MIN_MARGIN = unit_;
        MAX_MARGIN = unit_ * 500;
    }

    modifier nonReentrant() {
        if (entered != 1) revert Busy();
        entered = 2;
        _;
        entered = 1;
    }

    function mark() public view returns (uint256) {
        uint32[] memory ago = new uint32[](2);
        ago[0] = TWAP;
        ago[1] = 0;
        (int56[] memory ticks,) = pool.observe(ago);
        int56 delta = ticks[1] - ticks[0];
        int24 tick = int24(delta / int56(uint56(TWAP)));
        if (delta < 0 && delta % int56(uint56(TWAP)) != 0) tick--;
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(tick);
        uint256 sq = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        uint256 px = (uint256(1) << 192) * 1e8 / sq;
        if (px == 0) revert Bad();
        return px;
    }

    function priced() external pure returns (bool) { return true; }
    function rebates() external pure returns (bool) { return true; }
    function riskBook() external pure returns (bool) { return true; }

    /// 8h rate, 1e18 = 100%. Positive means longs pay shorts. Capped at 0.05%.
    function fundingRate() public view returns (int256) {
        uint256 markPx = mark();
        uint256 last = lastPrice == 0 ? markPx : lastPrice;
        int256 raw = (int256(last) - int256(markPx)) * 1e18 / int256(markPx);
        if (raw > FUND_CAP) return FUND_CAP;
        if (raw < -FUND_CAP) return -FUND_CAP;
        return raw;
    }

    function register(bytes32 code) external {
        if (code == bytes32(0) || codeOwner[code] != address(0) || codeOf[msg.sender] != bytes32(0)) revert Bad();
        codeOwner[code] = msg.sender;
        codeOf[msg.sender] = code;
    }

    function tierSet() external pure returns (uint256) { return 2; }

    function bind(bytes32 code) external {
        address who = codeOwner[code];
        if (who == address(0) || who == msg.sender || referrerOf[msg.sender] != address(0)) revert Bad();
        referrerOf[msg.sender] = who;
    }

    function claim(uint256 amount) external nonReentrant {
        uint256 step = MIN_MARGIN;
        if (amount == 0 || amount % step != 0) revert Bad();
        uint256 n = amount / step;
        if (n != 1 && n != 10 && n != 20 && n != 50 && n != 100 && n != 300 && n != 500) revert Bad();
        if (accrued[msg.sender] < amount) revert Bad();
        accrued[msg.sender] -= amount;
        _pay(msg.sender, amount);
    }

    function open(bool long, uint256 margin, uint16 lev, uint256 price) external nonReentrant {
        mark();
        _check(margin, lev);
        if (price < 1e16 || price > 100_000 ether) revert Bad();
        _take(msg.sender, margin);
        uint256 id = ++nextQuote;
        quotes[id] = Quote(msg.sender, long, uint96(margin), lev, true, uint128(price));
        emit Posted(id, msg.sender, long, margin, lev, price);
    }

    function take(uint256 quoteId, uint256 margin, uint16 lev) external nonReentrant {
        mark();
        Quote memory q = quotes[quoteId];
        if (!q.open || q.user == msg.sender) revert Bad();
        _check(margin, lev);
        quotes[quoteId].open = false;
        _take(msg.sender, margin);
        _match(q, quoteId, msg.sender, !q.long, margin, lev);
    }

    function cancel(uint256 quoteId) external nonReentrant {
        Quote memory q = quotes[quoteId];
        if (!q.open || q.user != msg.sender) revert Bad();
        quotes[quoteId].open = false;
        uint256 fee = uint256(q.margin) * FEE_NUM / FEE_DEN;
        fee = _feeSplit(msg.sender, fee);
        _pay(msg.sender, uint256(q.margin) - fee);
        emit Cancelled(quoteId, msg.sender, uint256(q.margin) - fee);
    }

    /// Resting only. Reverts if this price would meet an opposite quote.
    function openPost(bool long, uint256 margin, uint16 lev, uint256 price) external nonReentrant {
        mark();
        _check(margin, lev);
        if (price < 1e16 || price > 100_000 ether) revert Bad();
        if (_crossed(long, price)) revert Bad();
        _take(msg.sender, margin);
        uint256 id = ++nextQuote;
        quotes[id] = Quote(msg.sender, long, uint96(margin), lev, true, uint128(price));
        emit Posted(id, msg.sender, long, margin, lev, price);
    }

    /// One signature, two to five resting quotes between the two prices.
    function openScale(bool long, uint256 margin, uint16 lev, uint256 startPx, uint256 endPx, uint8 count) external nonReentrant {
        if (count < 2 || count > 5) revert Bad();
        mark();
        uint256 each = margin / count;
        _check(each, lev);
        _take(msg.sender, each * count);
        uint256 lo = startPx < endPx ? startPx : endPx;
        uint256 hi = startPx < endPx ? endPx : startPx;
        for (uint8 i = 0; i < count; i++) {
            uint256 px = lo + (hi - lo) * i / (count - 1);
            if (px < 1e16 || px > 100_000 ether) revert Bad();
            uint256 id = ++nextQuote;
            quotes[id] = Quote(msg.sender, long, uint96(each), lev, true, uint128(px));
            emit Posted(id, msg.sender, long, each, lev, px);
        }
        if (margin > each * count) _pay(msg.sender, margin - each * count);
    }

    /// Long fires when mark rises to the trigger. Short fires when mark falls to it.
    function openStop(bool long, uint256 margin, uint16 lev, uint256 triggerPx) external nonReentrant {
        mark();
        _check(margin, lev);
        if (triggerPx < 1e16 || triggerPx > 100_000 ether) revert Bad();
        _take(msg.sender, margin);
        uint256 id = ++nextStop;
        stops[id] = Stop(msg.sender, long, uint96(margin), lev, uint128(triggerPx), true);
    }

    function fireStop(uint256 id) external nonReentrant {
        Stop memory s = stops[id];
        if (!s.open) revert Bad();
        uint256 px = mark();
        if (s.long) { if (px < s.triggerPx) revert Bad(); }
        else if (px > s.triggerPx) revert Bad();
        stops[id].open = false;
        uint256 qid = ++nextQuote;
        quotes[qid] = Quote(s.user, s.long, s.margin, s.lev, true, uint128(px));
        emit Posted(qid, s.user, s.long, s.margin, s.lev, px);
    }

    function cancelStop(uint256 id) external nonReentrant {
        Stop memory s = stops[id];
        if (!s.open || s.user != msg.sender) revert Bad();
        stops[id].open = false;
        _pay(s.user, s.margin);
    }

    /// First slice rests now. Anyone can poke the next slice after the gap.
    function openTwap(bool long, uint256 margin, uint16 lev, uint8 slices, uint32 gap) external nonReentrant {
        if (slices < 2 || slices > 12) revert Bad();
        if (gap < 30 || gap > 1 days) revert Bad();
        uint256 each = margin / slices;
        _check(each, lev);
        _take(msg.sender, each * slices);
        uint256 id = ++nextTwap;
        twaps[id] = Twap(msg.sender, long, uint96(each), lev, slices, uint32(block.timestamp), gap, true);
        _poke(id);
    }

    function pokeTwap(uint256 id) external nonReentrant {
        _poke(id);
    }

    function cancelTwap(uint256 id) external nonReentrant {
        Twap memory t = twaps[id];
        if (!t.open || t.user != msg.sender) revert Bad();
        twaps[id].open = false;
        _pay(t.user, uint256(t.each) * t.left);
    }

    /// Distance is in basis points. 500 means a 5% retrace from the best price closes the deal.
    function armTrail(uint256 id, uint32 bps) external nonReentrant {
        Deal memory d = deals[id];
        if (!d.open || (msg.sender != d.long && msg.sender != d.short)) revert Bad();
        if (bps < 10 || bps > 5000) revert Bad();
        uint256 px = mark();
        trails[id] = Trail(msg.sender, msg.sender == d.long, bps, uint128(px), true);
    }

    function pokeTrail(uint256 id) external nonReentrant {
        Trail storage t = trails[id];
        if (!t.open) revert Bad();
        uint256 px = mark();
        if (t.long) {
            if (px > t.peak) { t.peak = uint128(px); return; }
            if (px * 10000 > uint256(t.peak) * (10000 - t.bps)) revert Bad();
        } else {
            if (t.peak == 0 || px < t.peak) { t.peak = uint128(px); return; }
            if (px * 10000 < uint256(t.peak) * (10000 + t.bps)) revert Bad();
        }
        t.open = false;
        _settle(id, false);
    }

    function cancelTrail(uint256 id) external nonReentrant {
        Trail memory t = trails[id];
        if (!t.open || t.user != msg.sender) revert Bad();
        trails[id].open = false;
    }

    function accrue(uint256 id) external nonReentrant {
        _accrue(id);
    }

    function close(uint256 id) external nonReentrant {
        Deal memory d = deals[id];
        if (msg.sender != d.long && msg.sender != d.short) revert Bad();
        _settle(id, false);
    }

    function liquidate(uint256 id) external nonReentrant {
        _settle(id, true);
    }

    function _check(uint256 margin, uint16 lev) internal view {
        if (lev < 1 || lev > 1000) revert Bad();
        if (margin < MIN_MARGIN || margin > MAX_MARGIN) revert Bad();
    }

    function _match(Quote memory q, uint256 quoteId, address taker, bool takerLong, uint256 takerMargin, uint16 takerLev) internal {
        uint256 px = q.price;
        if (px == 0) revert Bad();
        uint256 baseQ = uint256(q.margin) * q.lev * 1e18 / px;
        uint256 baseT = takerMargin * takerLev * 1e18 / px;
        uint256 base = baseQ < baseT ? baseQ : baseT;
        if (base == 0) revert Bad();
        uint256 usedQ = base * px / (uint256(q.lev) * 1e18);
        uint256 usedT = base * px / (uint256(takerLev) * 1e18);
        if (usedQ > q.margin || usedT > takerMargin) revert Bad();
        uint256 feeQ = _feeSplit(q.user, usedQ * FEE_NUM / FEE_DEN);
        uint256 feeT = _feeSplit(taker, usedT * FEE_NUM / FEE_DEN);
        address long = takerLong ? taker : q.user;
        address short = takerLong ? q.user : taker;
        uint16 levL = takerLong ? takerLev : q.lev;
        uint16 levS = takerLong ? q.lev : takerLev;
        uint256 id = ++nextDeal;
        deals[id] = Deal(long, short, uint96(takerLong ? usedT - feeT : usedQ - feeQ), uint96(takerLong ? usedQ - feeQ : usedT - feeT), uint128(base), uint128(px), true, levL, levS);
        fundedAt[id] = uint32(block.timestamp);
        lastPrice = px;
        if (q.margin > usedQ) _pay(q.user, uint256(q.margin) - usedQ);
        if (takerMargin > usedT) _pay(taker, takerMargin - usedT);
        emit Matched(id, quoteId, long, short, base, px, feeQ + feeT);
    }

    function _crossed(bool long, uint256 price) internal view returns (bool) {
        uint256 n = nextQuote;
        if (n == 0) return false;
        uint256 start = n > 24 ? n - 23 : 1;
        for (uint256 i = n; ; i--) {
            Quote memory q = quotes[i];
            if (q.open && q.long != long && q.price > 0) {
                if (long && q.price <= price) return true;
                if (!long && q.price >= price) return true;
            }
            if (i == start) break;
        }
        return false;
    }

    function _poke(uint256 id) internal {
        Twap storage t = twaps[id];
        if (!t.open || t.left == 0 || block.timestamp < t.nextAt) revert Bad();
        uint256 px = mark();
        uint256 qid = ++nextQuote;
        quotes[qid] = Quote(t.user, t.long, t.each, t.lev, true, uint128(px));
        emit Posted(qid, t.user, t.long, t.each, t.lev, px);
        t.left -= 1;
        t.nextAt = uint32(block.timestamp) + t.gap;
        if (t.left == 0) t.open = false;
    }

    function _accrue(uint256 id) internal {
        for (uint256 i = 0; i < 4; i++) {
            if (!_accrueOnce(id)) return;
        }
    }

    function _accrueOnce(uint256 id) internal returns (bool) {
        Deal storage d = deals[id];
        if (!d.open) return false;
        uint32 at = fundedAt[id];
        if (at == 0 || block.timestamp <= at) return false;
        uint256 elapsed = block.timestamp - at;
        if (elapsed > 7 days) elapsed = 7 days;
        int256 rate = fundingRate();
        uint256 px = mark();
        int256 pay = int256(uint256(d.base) * px / 1e18) * rate / 1e18;
        pay = pay * int256(elapsed) / int256(HOUR8);
        fundedAt[id] = uint32(at + elapsed);
        if (pay == 0) return elapsed == 7 days && block.timestamp > fundedAt[id];
        if (pay > 0) {
            uint256 due = uint256(pay);
            uint256 cap = uint256(d.marginL) / 10;
            if (due > cap) due = cap;
            if (due > 0 && due < d.marginL) {
                d.marginL -= uint96(due);
                d.marginS += uint96(due);
            }
        } else {
            uint256 due = uint256(-pay);
            uint256 cap = uint256(d.marginS) / 10;
            if (due > cap) due = cap;
            if (due > 0 && due < d.marginS) {
                d.marginS -= uint96(due);
                d.marginL += uint96(due);
            }
        }
        return elapsed == 7 days && block.timestamp > fundedAt[id];
    }

    function _settle(uint256 id, bool mustLiq) internal {
        _accrue(id);
        Deal memory d = deals[id];
        if (!d.open) revert Bad();
        uint256 px = mark();
        (uint256 eqL, uint256 eqS, bool weakL, bool weakS) = _equity(d, px);
        if (mustLiq && !weakL && !weakS) revert Bad();
        deals[id].open = false;
        uint256 bounty;
        if (mustLiq) {
            (bounty, eqL, eqS) = _slice(eqL, eqS, weakL, weakS);
        }
        (uint256 gap, bool winnerLong) = _gap(d, px);
        uint256 cover = gap > insurance ? insurance : gap;
        insurance -= cover;
        uint256 adl;
        if (mustLiq && gap > cover) adl = _adl(id, winnerLong, gap - cover, px);
        if (winnerLong) eqL += cover + adl;
        else eqS += cover + adl;
        if (cover + adl > 0) emit Covered(id, cover, adl);
        if (bounty > 0) _pay(msg.sender, bounty);
        _pay(d.long, eqL);
        _pay(d.short, eqS);
        emit Settled(id, eqL, eqS, msg.sender);
    }

    function _slice(uint256 eqL, uint256 eqS, bool weakL, bool weakS) internal returns (uint256 bounty, uint256 left, uint256 right) {
        left = eqL;
        right = eqS;
        if (weakL && left > 0) {
            uint256 caller = left / 10;
            uint256 pot = left / 10;
            bounty += caller;
            insurance += pot;
            left -= caller + pot;
        }
        if (weakS && right > 0) {
            uint256 caller = right / 10;
            uint256 pot = right / 10;
            bounty += caller;
            insurance += pot;
            right -= caller + pot;
        }
    }

    function _gap(Deal memory d, uint256 px) internal pure returns (uint256 gap, bool winnerLong) {
        int256 pnl = int256(uint256(d.base)) * (int256(px) - int256(uint256(d.entry))) / 1e18;
        int256 left = int256(uint256(d.marginL)) + pnl;
        int256 right = int256(uint256(d.marginS)) - pnl;
        if (left < 0) return (uint256(-left), false);
        if (right < 0) return (uint256(-right), true);
        return (0, false);
    }

    /// Takes profit from one other open deal. Payout on that deal stays at least its old margin.
    function _adl(uint256 skip, bool takeLong, uint256 need, uint256 px) internal returns (uint256) {
        uint256 n = nextDeal;
        if (n == 0 || need == 0) return 0;
        uint256 start = n > 32 ? n - 31 : 1;
        uint256 best;
        uint256 bestTake;
        for (uint256 i = n; ; i--) {
            if (i != skip && deals[i].open) {
                Deal memory o = deals[i];
                (uint256 eqL, uint256 eqS,,) = _equity(o, px);
                uint256 margin = takeLong ? uint256(o.marginL) : uint256(o.marginS);
                uint256 eq = takeLong ? eqL : eqS;
                if (eq > margin && margin > 1) {
                    uint256 profit = eq - margin;
                    uint256 room = margin - 1;
                    uint256 can = profit < room ? profit : room;
                    if (can > bestTake) {
                        bestTake = can;
                        best = i;
                    }
                }
            }
            if (i == start) break;
        }
        if (best == 0 || bestTake == 0) return 0;
        uint256 take = bestTake < need ? bestTake : need;
        if (takeLong) deals[best].marginL -= uint96(take);
        else deals[best].marginS -= uint96(take);
        return take;
    }

    function _equity(Deal memory d, uint256 px) internal pure returns (uint256 eqL, uint256 eqS, bool weakL, bool weakS) {
        int256 pnl = int256(uint256(d.base)) * (int256(px) - int256(uint256(d.entry))) / 1e18;
        int256 left = int256(uint256(d.marginL)) + pnl;
        int256 right = int256(uint256(d.marginS)) - pnl;
        if (left < 0) { right += left; left = 0; }
        if (right < 0) { left += right; right = 0; }
        eqL = uint256(left);
        eqS = uint256(right);
        uint256 notional = uint256(d.base) * px / 1e18;
        weakL = left * int256(uint256(d.levL)) * 2 <= int256(notional);
        weakS = right * int256(uint256(d.levS)) * 2 <= int256(notional);
    }

    function _feeSplit(address user, uint256 fee) internal returns (uint256) {
        address ref = referrerOf[user];
        if (ref == address(0) || fee == 0) {
            _pay(FEE_TO, fee);
            return fee;
        }
        uint256 discount = fee * DISCOUNT_NUM / 100;
        uint256 reward = fee * REWARD_NUM / 100;
        accrued[ref] += reward;
        _pay(FEE_TO, fee - discount - reward);
        return fee - discount;
    }

    function _take(address from, uint256 amount) internal {
        uint256 beforeBal = usdt.balanceOf(address(this));
        _call(abi.encodeWithSelector(usdt.transferFrom.selector, from, address(this), amount));
        if (usdt.balanceOf(address(this)) - beforeBal < amount) revert Bad();
    }

    function _pay(address to, uint256 amount) internal {
        if (amount == 0 || to == address(0)) return;
        _call(abi.encodeWithSelector(usdt.transfer.selector, to, amount));
    }

    function _call(bytes memory data) internal {
        (bool ok, bytes memory ret) = address(usdt).call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert Bad();
    }
}
