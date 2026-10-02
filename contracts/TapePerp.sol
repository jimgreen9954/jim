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

/// Bilateral isolated BEM perp. Anyone can post several quotes.
/// Someone else picks a quote and takes the other side. 0.2% of each
/// matched margin is paid to the developer. No admin, no upgrade.
contract TapePerp {
    IERC20 public immutable usdt;
    IPool public immutable pool;
    address public constant FEE_TO = 0xb67741A0463779c0dab3fDCFE883bA7572AC0AC2;
    uint32 public constant TWAP = 600;
    uint256 public immutable MIN_MARGIN;
    uint256 public immutable MAX_MARGIN;
    uint256 public constant FEE_NUM = 2;
    uint256 public constant FEE_DEN = 1000;
    uint256 public constant DISCOUNT_NUM = 4;
    uint256 public constant REWARD_NUM = 6;

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
    uint256 private entered = 1;

    event Posted(uint256 indexed id, address indexed user, bool long, uint256 margin, uint16 lev, uint256 price);
    event Cancelled(uint256 indexed id, address indexed user, uint256 margin);
    event Matched(
        uint256 indexed id,
        uint256 indexed quoteId,
        address indexed long,
        address short,
        uint256 base,
        uint256 entry,
        uint256 fee
    );
    event Settled(uint256 indexed id, uint256 payLong, uint256 payShort, address caller);

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

    function priced() external pure returns (bool) {
        return true;
    }

    function rebates() external pure returns (bool) {
        return true;
    }

    function register(bytes32 code) external {
        if (code == bytes32(0) || codeOwner[code] != address(0) || codeOf[msg.sender] != bytes32(0)) revert Bad();
        codeOwner[code] = msg.sender;
        codeOf[msg.sender] = code;
    }

    function tierSet() external pure returns (uint256) {
        return 2;
    }

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
        _check(margin, lev);
        if (price < 1e16 || price > 100_000 ether) revert Bad();
        _take(msg.sender, margin);
        uint256 id = ++nextQuote;
        quotes[id] = Quote(msg.sender, long, uint96(margin), lev, true, uint128(price));
        emit Posted(id, msg.sender, long, margin, lev, price);
    }

    function take(uint256 quoteId, uint256 margin, uint16 lev) external nonReentrant {
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
        uint256 back = uint256(q.margin) - fee;
        _pay(msg.sender, back);
        emit Cancelled(quoteId, msg.sender, back);
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

    function _match(
        Quote memory q,
        uint256 quoteId,
        address taker,
        bool takerLong,
        uint256 takerMargin,
        uint16 takerLev
    ) internal {
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
        uint256 netQ = usedQ - feeQ;
        uint256 netT = usedT - feeT;
        address long = takerLong ? taker : q.user;
        address short = takerLong ? q.user : taker;
        uint256 marginL = takerLong ? netT : netQ;
        uint256 marginS = takerLong ? netQ : netT;
        uint16 levL = takerLong ? takerLev : q.lev;
        uint16 levS = takerLong ? q.lev : takerLev;
        uint256 id = ++nextDeal;
        deals[id] = Deal(long, short, uint96(marginL), uint96(marginS), uint128(base), uint128(px), true, levL, levS);
        if (q.margin > usedQ) _pay(q.user, uint256(q.margin) - usedQ);
        if (takerMargin > usedT) _pay(taker, takerMargin - usedT);
        emit Matched(id, quoteId, long, short, base, px, feeQ + feeT);
    }

    function _settle(uint256 id, bool mustLiq) internal {
        Deal memory d = deals[id];
        if (!d.open) revert Bad();
        uint256 px = mark();
        (uint256 eqL, uint256 eqS, bool weakL, bool weakS) = _equity(d, px);
        if (mustLiq && !weakL && !weakS) revert Bad();
        deals[id].open = false;
        uint256 bounty;
        if (mustLiq && weakL && eqL > 0) {
            bounty += eqL / 5;
            eqL -= eqL / 5;
        }
        if (mustLiq && weakS && eqS > 0) {
            bounty += eqS / 5;
            eqS -= eqS / 5;
        }
        if (bounty > 0) _pay(msg.sender, bounty);
        _pay(d.long, eqL);
        _pay(d.short, eqS);
        emit Settled(id, eqL, eqS, msg.sender);
    }

    function _equity(Deal memory d, uint256 px) internal pure returns (uint256 eqL, uint256 eqS, bool weakL, bool weakS) {
        int256 pnl = int256(uint256(d.base)) * (int256(px) - int256(uint256(d.entry))) / 1e18;
        int256 left = int256(uint256(d.marginL)) + pnl;
        int256 right = int256(uint256(d.marginS)) - pnl;
        if (left < 0) {
            right += left;
            left = 0;
        }
        if (right < 0) {
            left += right;
            right = 0;
        }
        eqL = uint256(left);
        eqS = uint256(right);
        uint256 notional = uint256(d.base) * px / 1e18;
        weakL = left * int256(uint256(d.levL)) * 2 <= int256(notional);
        weakS = right * int256(uint256(d.levS)) * 2 <= int256(notional);
    }

    function _feeSplit(address user, uint256 fee) internal returns (uint256 charge) {
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
        if (amount == 0) return;
        _call(abi.encodeWithSelector(usdt.transfer.selector, to, amount));
    }

    function _call(bytes memory data) internal {
        (bool ok, bytes memory ret) = address(usdt).call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert Bad();
    }
}
