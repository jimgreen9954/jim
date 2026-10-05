// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// Six transistor markets. Margin is BSC USDT. The mark is pushed from the
/// official TapeOut price. No admin.
contract GatePerp {
    IERC20 public immutable usdt;
    address public constant FEE_TO = 0x823b9F6A93Ac44Ce5A469823A336c15b6117054D;
    uint256 public constant MIN_MARGIN = 1 ether;
    uint256 public constant MAX_MARGIN = 500 ether;
    uint256 public constant FEE_NUM = 2;
    uint256 public constant FEE_DEN = 1000;
    uint256 public constant DISCOUNT_NUM = 4;
    uint256 public constant REWARD_NUM = 6;

    mapping(address => address) public referrerOf;
    mapping(address => uint256) public accrued;
    mapping(bytes32 => address) public codeOwner;
    mapping(address => bytes32) public codeOf;
    mapping(uint8 => uint256) public marks;
    mapping(uint8 => uint256) public markedAt;

    struct Quote {
        address user;
        uint8 market;
        bool long;
        uint96 margin;
        uint16 lev;
        bool open;
        uint128 price;
    }

    struct Deal {
        address long;
        address short;
        uint8 market;
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

    error Bad();
    error Busy();

    constructor(address token) {
        usdt = IERC20(token);
    }

    modifier nonReentrant() {
        if (entered != 1) revert Busy();
        entered = 2;
        _;
        entered = 1;
    }

    function rebates() external pure returns (bool) {
        return true;
    }

    function tierSet() external pure returns (uint256) {
        return 2;
    }

    function push(uint8 market, uint256 px) external {
        if (market > 5 || px == 0 || px > 1000 ether) revert Bad();
        uint256 prev = marks[market];
        if (prev != 0) {
            if (block.timestamp < markedAt[market] + 10) revert Bad();
            if (px * 2 > prev * 3 || prev * 2 > px * 3) revert Bad();
        }
        marks[market] = px;
        markedAt[market] = block.timestamp;
    }

    function register(bytes32 code) external {
        if (code == bytes32(0) || codeOwner[code] != address(0) || codeOf[msg.sender] != bytes32(0)) revert Bad();
        codeOwner[code] = msg.sender;
        codeOf[msg.sender] = code;
    }

    function bind(bytes32 code) external {
        address who = codeOwner[code];
        if (who == address(0) || who == msg.sender || referrerOf[msg.sender] != address(0)) revert Bad();
        referrerOf[msg.sender] = who;
    }

    function claim(uint256 amount) external nonReentrant {
        if (amount == 0 || amount % MIN_MARGIN != 0) revert Bad();
        uint256 n = amount / MIN_MARGIN;
        if (n != 1 && n != 10 && n != 20 && n != 50 && n != 100 && n != 300 && n != 500) revert Bad();
        if (accrued[msg.sender] < amount) revert Bad();
        accrued[msg.sender] -= amount;
        _pay(msg.sender, amount);
    }

    function open(uint8 market, bool long, uint256 margin, uint16 lev, uint256 price) external nonReentrant {
        if (market > 5 || marks[market] == 0) revert Bad();
        _check(margin, lev, price);
        _take(msg.sender, margin);
        uint256 id = ++nextQuote;
        quotes[id] = Quote(msg.sender, market, long, uint96(margin), lev, true, uint128(price));
    }

    function take(uint256 quoteId, uint256 margin, uint16 lev) external nonReentrant {
        Quote memory q = quotes[quoteId];
        if (!q.open || q.user == msg.sender) revert Bad();
        _check(margin, lev, q.price);
        quotes[quoteId].open = false;
        _take(msg.sender, margin);
        _match(q, msg.sender, !q.long, margin, lev);
    }

    function cancel(uint256 quoteId) external nonReentrant {
        Quote memory q = quotes[quoteId];
        if (!q.open || q.user != msg.sender) revert Bad();
        quotes[quoteId].open = false;
        uint256 fee = _feeSplit(msg.sender, uint256(q.margin) * FEE_NUM / FEE_DEN);
        _pay(msg.sender, uint256(q.margin) - fee);
    }

    function close(uint256 id) external nonReentrant {
        Deal memory d = deals[id];
        if (msg.sender != d.long && msg.sender != d.short) revert Bad();
        _settle(id);
    }

    function _check(uint256 margin, uint16 lev, uint256 price) internal pure {
        if (lev < 1 || lev > 1000) revert Bad();
        if (margin < MIN_MARGIN || margin > MAX_MARGIN) revert Bad();
        if (price == 0 || price > 1000 ether) revert Bad();
    }

    function _match(Quote memory q, address taker, bool takerLong, uint256 takerMargin, uint16 takerLev) internal {
        uint256 px = q.price;
        uint256 baseQ = uint256(q.margin) * q.lev * 1e18 / px;
        uint256 baseT = takerMargin * takerLev * 1e18 / px;
        uint256 base = baseQ < baseT ? baseQ : baseT;
        if (base == 0) revert Bad();
        uint256 usedQ = base * px / (uint256(q.lev) * 1e18);
        uint256 usedT = base * px / (uint256(takerLev) * 1e18);
        uint256 feeQ = _feeSplit(q.user, usedQ * FEE_NUM / FEE_DEN);
        uint256 feeT = _feeSplit(taker, usedT * FEE_NUM / FEE_DEN);
        address long = takerLong ? taker : q.user;
        address short = takerLong ? q.user : taker;
        uint256 id = ++nextDeal;
        deals[id] = Deal(
            long,
            short,
            q.market,
            uint96(takerLong ? usedT - feeT : usedQ - feeQ),
            uint96(takerLong ? usedQ - feeQ : usedT - feeT),
            uint128(base),
            uint128(px),
            true,
            takerLong ? takerLev : q.lev,
            takerLong ? q.lev : takerLev
        );
        if (q.margin > usedQ) _pay(q.user, uint256(q.margin) - usedQ);
        if (takerMargin > usedT) _pay(taker, takerMargin - usedT);
    }

    function _settle(uint256 id) internal {
        Deal memory d = deals[id];
        if (!d.open) revert Bad();
        uint256 px = marks[d.market];
        if (px == 0) revert Bad();
        deals[id].open = false;
        (uint256 eqL, uint256 eqS) = _equity(d, px);
        _pay(d.long, eqL);
        _pay(d.short, eqS);
    }

    function _equity(Deal memory d, uint256 px) internal pure returns (uint256 eqL, uint256 eqS) {
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
