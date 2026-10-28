// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface ISwapV3 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

interface ISwapV2 {
    function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts);
    function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts);
}

interface ITape {
    function swap(uint8 quote, bool tapeIn, uint256 amountIn, uint256 minOut) external returns (uint256 out);
}

/// Official rounds. The deployer is fixed. A claim has to be a normal wallet, has to buy the named asset, and has to wait out the pace.
contract RedPacket {
    address public immutable deployer;
    address public immutable router;
    address public immutable quote;
    address public immutable wrapped;
    address public immutable tapePool;
    address public immutable tapeQuote;
    address public immutable tapeToken;
    address public immutable tapeBem;
    uint256 public immutable quoteScale;
    uint8 public immutable kind;
    uint256 public constant PACE = 3 minutes;

    address public token;
    uint8 public mode;
    uint256 public fixedAmt;
    uint256 public lo;
    uint256 public hi;
    uint256 public packetsLeft;
    uint256 public dayCap;
    uint256 public cursor;
    uint256 public claimedToday;
    uint256 public spotNeed;
    uint256 public perpNeed;
    uint8 public gate;
    bool public ready;
    uint256 public endsAt;
    uint24 public swapFee;
    uint256 public lastClaimAt;
    mapping(address => uint256) public credit;
    struct Lot { address who; uint256 left; }
    Lot[] private lots;
    uint256 private head;
    mapping(address => uint256) public lastDay;
    uint256 private entered;

    event Claimed(address indexed who, uint256 indexed day, uint256 amount);
    event Funded(address indexed from, uint256 amount);
    event RuleSet(address token, uint8 mode, uint256 fixedAmt, uint256 lo, uint256 hi, uint256 packets, uint256 dayCap, uint256 spotNeed, uint256 perpNeed, uint8 gate, uint256 life);

    modifier lock() {
        require(entered == 0, "re");
        entered = 1;
        _;
        entered = 0;
    }

    constructor(address deployer_, address router_, address quote_, address wrapped_, address tapePool_, address tapeQuote_, address tapeToken_, address tapeBem_, uint256 quoteScale_, uint8 kind_) {
        require(deployer_ != address(0) && router_ != address(0) && quote_ != address(0) && wrapped_ != address(0) && quoteScale_ > 0 && kind_ < 2, "setup");
        deployer = deployer_;
        router = router_;
        quote = quote_;
        wrapped = wrapped_;
        tapePool = tapePool_;
        tapeQuote = tapeQuote_;
        tapeToken = tapeToken_;
        tapeBem = tapeBem_;
        quoteScale = quoteScale_;
        kind = kind_;
    }

    function deposit(uint256 amount) external {
        require(token != address(0) && amount > 0, "token");
        _pull(token, msg.sender, amount);
        _note(msg.sender, amount);
        emit Funded(msg.sender, amount);
    }

    function depositNative() external payable {
        require(token == address(0) && msg.value > 0, "native");
        _note(msg.sender, msg.value);
        emit Funded(msg.sender, msg.value);
    }

    function setRule(address token_, uint8 mode_, uint256 fixedAmt_, uint256 lo_, uint256 hi_, uint256 packets_, uint256 dayCap_, uint256 spotNeed_, uint256 perpNeed_, uint8 gate_, uint256 life_, uint24 fee_) external {
        require(msg.sender == deployer, "deployer");
        require(mode_ < 3 && gate_ < 2, "mode");
        require(life_ == 1 days || life_ == 7 days || life_ == 30 days, "life");
        if (mode_ == 1) require(hi_ >= lo_ && lo_ > 0, "range");
        if (mode_ == 0) require(fixedAmt_ > 0, "amount");
        if (mode_ == 2) require(packets_ > 0, "packets");
        if (token_ != token && _balance() > 0) revert("dust");
        uint256 need = spotNeed_ > perpNeed_ ? spotNeed_ : perpNeed_;
        require(need > 0, "task");
        address task = hi_ == 1 ? wrapped : address(uint160(hi_));
        require(task != address(0) && task != quote && task != tapeQuote, "task");
        if (kind == 0) require(fee_ == 100 || fee_ == 500 || fee_ == 2500 || fee_ == 10000, "fee");
        token = token_;
        mode = mode_;
        fixedAmt = fixedAmt_;
        lo = lo_;
        hi = hi_;
        packetsLeft = packets_;
        dayCap = dayCap_;
        spotNeed = spotNeed_;
        perpNeed = perpNeed_;
        gate = gate_;
        swapFee = fee_;
        endsAt = block.timestamp + life_;
        ready = true;
        emit RuleSet(token_, mode_, fixedAmt_, lo_, hi_, packets_, dayCap_, spotNeed_, perpNeed_, gate_, life_);
    }

    function withdraw(uint256 amount) external {
        require(block.timestamp > endsAt, "early");
        require(amount > 0 && credit[msg.sender] >= amount, "credit");
        uint256 left = amount;
        for (uint256 i = head; i < lots.length && left > 0; i++) {
            if (lots[i].who != msg.sender || lots[i].left == 0) continue;
            uint256 use = lots[i].left > left ? left : lots[i].left;
            lots[i].left -= use;
            left -= use;
        }
        require(left == 0, "lot");
        credit[msg.sender] -= amount;
        _push(msg.sender, amount);
    }

    function claim(uint256 amountIn, uint256 minOut) external lock {
        require(msg.sender == tx.origin, "bot");
        require(block.timestamp >= lastClaimAt + PACE, "pace");
        require(ready, "rule");
        require(block.timestamp <= endsAt, "late");
        uint256 day = sgDay(block.timestamp);
        require(lastDay[msg.sender] != day, "day");
        if (cursor != day) {
            cursor = day;
            claimedToday = 0;
        }
        require(dayCap == 0 || claimedToday < dayCap, "cap");
        _buy(amountIn, minOut);
        lastClaimAt = block.timestamp;
        uint256 bal = _balance();
        uint256 pay = mode == 0 ? _fixed(bal) : mode == 1 ? _range(bal) : _lucky(bal);
        require(pay > 0 && pay <= bal, "empty");
        lastDay[msg.sender] = day;
        claimedToday += 1;
        if (mode == 2 && packetsLeft > 0) packetsLeft -= 1;
        _eat(pay);
        _push(msg.sender, pay);
        emit Claimed(msg.sender, day, pay);
    }

    function claimsToday(uint256 ts) external view returns (uint256) {
        return cursor == sgDay(ts) ? claimedToday : 0;
    }

    function sgDay(uint256 ts) public pure returns (uint256) {
        return (ts + 8 hours) / 1 days;
    }

    function _buy(uint256 amountIn, uint256 minOut) internal {
        uint256 need = spotNeed > perpNeed ? spotNeed : perpNeed;
        require(need > 0 && amountIn >= need * quoteScale, "task");
        require(minOut > 0, "buy");
        address task = hi == 1 ? wrapped : address(uint160(hi));
        require(task != address(0) && task != quote && task != tapeQuote, "task");
        if (tapePool != address(0) && (task == tapeToken || task == tapeBem)) {
            _buyTape(task, amountIn, minOut);
            return;
        }
        _pull(quote, msg.sender, amountIn);
        _approve(quote, router, amountIn);
        if (kind == 0) _buyV3(task, amountIn, minOut);
        else if (hi == 1) _buyNative(amountIn, minOut);
        else _buyV2(task, amountIn, minOut);
        _approve(quote, router, 0);
    }

    function _buyV3(address task, uint256 amountIn, uint256 minOut) internal {
        uint256 before = IERC20(task).balanceOf(msg.sender);
        uint256 out = ISwapV3(router).exactInputSingle(ISwapV3.ExactInputSingleParams({
            tokenIn: quote,
            tokenOut: task,
            fee: swapFee,
            recipient: msg.sender,
            deadline: block.timestamp,
            amountIn: amountIn,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0
        }));
        require(out >= minOut && IERC20(task).balanceOf(msg.sender) >= before + minOut, "buy");
    }

    function _buyV2(address task, uint256 amountIn, uint256 minOut) internal {
        uint256 before = IERC20(task).balanceOf(msg.sender);
        address[] memory path = _path(task);
        uint256[] memory amounts = ISwapV2(router).swapExactTokensForTokens(amountIn, minOut, path, msg.sender, block.timestamp);
        require(amounts[amounts.length - 1] >= minOut && IERC20(task).balanceOf(msg.sender) >= before + minOut, "buy");
    }

    function _buyNative(uint256 amountIn, uint256 minOut) internal {
        address[] memory path = _path(wrapped);
        uint256[] memory amounts = ISwapV2(router).swapExactTokensForETH(amountIn, minOut, path, msg.sender, block.timestamp);
        require(amounts[amounts.length - 1] >= minOut, "buy");
    }

    function _buyTape(address task, uint256 amountIn, uint256 minOut) internal {
        _pull(tapeQuote, msg.sender, amountIn);
        _approve(tapeQuote, tapePool, amountIn);
        uint256 tapeOut = ITape(tapePool).swap(0, false, amountIn, task == tapeToken ? minOut : 1);
        _approve(tapeQuote, tapePool, 0);
        if (task == tapeToken) {
            _forward(tapeToken, tapeOut);
            return;
        }
        _approve(tapeToken, tapePool, tapeOut);
        uint256 bemOut = ITape(tapePool).swap(1, true, tapeOut, minOut);
        _approve(tapeToken, tapePool, 0);
        _forward(tapeBem, bemOut);
    }

    function _path(address out) internal view returns (address[] memory path) {
        path = new address[](2);
        path[0] = quote;
        path[1] = out;
    }

    function _fixed(uint256 bal) internal view returns (uint256) {
        return fixedAmt <= bal ? fixedAmt : 0;
    }

    function _range(uint256 bal) internal view returns (uint256) {
        uint256 top = hi > bal ? bal : hi;
        if (lo > top) return 0;
        if (lo == top) return lo;
        uint256 seed = uint256(keccak256(abi.encodePacked(block.prevrandao, msg.sender, claimedToday, bal)));
        return lo + (seed % (top - lo + 1));
    }

    function _lucky(uint256 bal) internal view returns (uint256) {
        if (packetsLeft == 0 || bal == 0) return 0;
        if (packetsLeft == 1) return bal;
        uint256 keep = packetsLeft - 1;
        if (bal <= keep) return 0;
        uint256 cap = (bal / packetsLeft) * 2;
        uint256 room = bal - keep;
        if (cap > room) cap = room;
        if (cap == 0) return 0;
        uint256 seed = uint256(keccak256(abi.encodePacked(block.prevrandao, msg.sender, packetsLeft, bal)));
        return 1 + (seed % cap);
    }

    function _note(address who, uint256 amount) internal {
        credit[who] += amount;
        lots.push(Lot(who, amount));
    }

    function _eat(uint256 amount) internal {
        uint256 left = amount;
        uint256 i = head;
        while (left > 0 && i < lots.length) {
            if (lots[i].left == 0) { i++; continue; }
            uint256 use = lots[i].left > left ? left : lots[i].left;
            lots[i].left -= use;
            credit[lots[i].who] -= use;
            left -= use;
            if (lots[i].left == 0) i++;
        }
        require(left == 0, "credit");
        head = i;
    }

    function _balance() internal view returns (uint256) {
        if (token == address(0)) return address(this).balance;
        return IERC20(token).balanceOf(address(this));
    }

    function _pull(address erc, address from, uint256 amount) internal {
        (bool ok, bytes memory data) = erc.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, address(this), amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "pull");
    }

    function _approve(address erc, address spender, uint256 amount) internal {
        (bool zeroOk, bytes memory zeroData) = erc.call(abi.encodeWithSelector(IERC20.approve.selector, spender, 0));
        require(zeroOk && (zeroData.length == 0 || abi.decode(zeroData, (bool))), "approve");
        if (amount == 0) return;
        (bool ok, bytes memory data) = erc.call(abi.encodeWithSelector(IERC20.approve.selector, spender, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "approve");
    }

    function _forward(address erc, uint256 amount) internal {
        (bool ok, bytes memory data) = erc.call(abi.encodeWithSelector(IERC20.transfer.selector, msg.sender, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "buy");
    }

    function _push(address to, uint256 amount) internal {
        if (token == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            require(ok, "push");
            return;
        }
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "push");
    }
}
