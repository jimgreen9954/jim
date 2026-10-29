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

interface IWrap {
    function deposit() external payable;
    function withdraw(uint256) external;
}

interface ISpot {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

interface ITape {
    function swap(uint8 quote, bool tapeIn, uint256 amountIn, uint256 minOut) external payable returns (uint256 out);
}

/// Personal rounds. Anyone can start one when the pool is empty. A claim has to be a normal wallet, has to buy the named asset, and has to wait out the pace.
contract RedPacketOpen {
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
    address internal constant BEM_SPOT = 0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA;
    uint24 internal constant BEM_FEE = 10000;

    address public creator;
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
    mapping(address => uint256) public tradedDay;
    uint256 private entered;

    event Claimed(address indexed who, uint256 indexed day, uint256 amount);
    event Traded(address indexed who, uint256 indexed day, uint8 side);
    event Funded(address indexed from, uint256 amount);
    event RuleSet(address token, uint8 mode, uint256 fixedAmt, uint256 lo, uint256 hi, uint256 packets, uint256 dayCap, uint256 spotNeed, uint256 perpNeed, uint8 gate, uint256 life);

    modifier lock() {
        require(entered == 0, "re");
        entered = 1;
        _;
        entered = 0;
    }

    constructor(address router_, address quote_, address wrapped_, address tapePool_, address tapeQuote_, address tapeToken_, address tapeBem_, uint256 quoteScale_, uint8 kind_) {
        require(router_ != address(0) && quote_ != address(0) && wrapped_ != address(0) && quoteScale_ > 0 && kind_ < 2, "setup");
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
        if (_balance() > 0) require(msg.sender == creator, "creator");
        else creator = msg.sender;
        require(mode_ < 3 && gate_ < 2, "mode");
        require(life_ == 1 days || life_ == 7 days || life_ == 30 days, "life");
        if (mode_ == 1) require(hi_ >= lo_ && lo_ > 0, "range");
        if (mode_ == 0) require(fixedAmt_ > 0, "amount");
        if (mode_ == 2) require(packets_ > 0, "packets");
        if (token_ != token && _balance() > 0) revert("dust");
        uint256 need = spotNeed_ > perpNeed_ ? spotNeed_ : perpNeed_;
        require(need > 0, "task");
        address task = hi_ == 1 ? wrapped : address(uint160(hi_));
        require(task != address(0) && task != wrapped, "task");
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

    function begin(address token_, uint256 fixedAmt_, uint256 hi_, uint256 spotNeed_, uint8 gate_, uint256 life_, uint24 fee_, uint256 fundAmt) external payable {
        require(creator == address(0) && !ready, "begun");
        require(gate_ < 2, "mode");
        require(life_ == 1 days || life_ == 7 days || life_ == 30 days, "life");
        require(fixedAmt_ > 0 && fundAmt > 0, "amount");
        require(spotNeed_ > 0, "task");
        address task = hi_ == 1 ? wrapped : address(uint160(hi_));
        require(task != address(0) && task != wrapped, "task");
        if (kind == 0) require(fee_ == 100 || fee_ == 500 || fee_ == 2500 || fee_ == 10000, "fee");
        creator = tx.origin;
        token = token_;
        mode = 0;
        fixedAmt = fixedAmt_;
        hi = hi_;
        spotNeed = spotNeed_;
        gate = gate_;
        swapFee = fee_;
        endsAt = block.timestamp + life_;
        ready = true;
        if (token_ == address(0)) {
            require(msg.value == fundAmt, "native");
            _note(tx.origin, msg.value);
        } else {
            require(msg.value == 0, "native");
            _pull(token_, tx.origin, fundAmt);
            _note(tx.origin, fundAmt);
        }
        emit RuleSet(token_, 0, fixedAmt_, 0, hi_, 0, 0, spotNeed_, 0, gate_, life_);
        emit Funded(tx.origin, fundAmt);
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

    receive() external payable {}

    function trade(uint256 amountIn, uint256 minOut) external payable lock {
        require(msg.sender == tx.origin, "bot");
        require(ready, "rule");
        require(block.timestamp <= endsAt, "late");
        uint256 day = sgDay(block.timestamp);
        require(lastDay[msg.sender] != day && tradedDay[msg.sender] != day, "day");
        if (cursor != day) {
            cursor = day;
            claimedToday = 0;
        }
        require(dayCap == 0 || claimedToday < dayCap, "cap");
        if (gate == 0) _buy(minOut);
        else _sell(amountIn, minOut);
        tradedDay[msg.sender] = day;
        emit Traded(msg.sender, day, gate);
    }

    function claim() external lock {
        require(msg.sender == tx.origin, "bot");
        require(ready, "rule");
        require(block.timestamp <= endsAt, "late");
        uint256 day = sgDay(block.timestamp);
        require(tradedDay[msg.sender] == day, "task");
        require(lastDay[msg.sender] != day, "day");
        if (cursor != day) {
            cursor = day;
            claimedToday = 0;
        }
        require(dayCap == 0 || claimedToday < dayCap, "cap");
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

    function _mark() internal view returns (uint256) {
        if (token == address(0)) return address(this).balance - msg.value;
        return IERC20(token).balanceOf(address(this));
    }

    function _keep(uint256 mark) internal view {
        uint256 nowBal = token == address(0) ? address(this).balance : IERC20(token).balanceOf(address(this));
        require(nowBal == mark, "prize");
    }

    function _buy(uint256 minOut) internal {
        uint256 mark = _mark();
        uint256 need = spotNeed > perpNeed ? spotNeed : perpNeed;
        require(need > 0 && msg.value >= need, "task");
        require(minOut > 0, "buy");
        address task = hi == 1 ? wrapped : address(uint160(hi));
        require(task != address(0) && task != wrapped, "task");
        if (msg.value > need) {
            (bool sent, ) = msg.sender.call{value: msg.value - need}("");
            require(sent, "refund");
        }
        if (tapePool != address(0) && task == tapeToken) {
            uint256 before = IERC20(tapeToken).balanceOf(address(this));
            ITape(tapePool).swap{value: need}(1, false, need, minOut);
            uint256 got = IERC20(tapeToken).balanceOf(address(this)) - before;
            require(got >= minOut, "buy");
            _forward(tapeToken, got);
            _keep(mark);
            return;
        }
        IWrap(wrapped).deposit{value: need}();
        if (tapeBem != address(0) && task == tapeBem) {
            _spotBuy(task, need, minOut);
            _keep(mark);
            return;
        }
        if (tapePool != address(0) && (task == tapeToken || task == tapeBem)) {
            _buyTape(task, need, minOut);
            _keep(mark);
            return;
        }
        _approve(wrapped, router, need);
        if (kind == 0) _buyBsc(task, need, minOut);
        else _buyV2(task, need, minOut);
        _approve(wrapped, router, 0);
        _keep(mark);
    }

    function _tier(address token) internal pure returns (uint24) {
        if (token == 0x5ce033B2bFCa3Af30b3e8C8457DeaF776A8b695a) return 10000;
        if (token == 0x2170Ed0880ac9A755fd29B2688956BD959F933F8) return 500;
        if (token == 0x21cAef8A43163Eea865baeE23b9C2E327696A3bf) return 500;
        if (token == 0x1Ba42e5193dfA8B03D15dd1B86a3113bbBEF8Eeb) return 500;
        return 100;
    }

    function _v3(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint256 minOut, address recipient) internal returns (uint256) {
        (bool ok, bytes memory data) = router.call(
            abi.encodeCall(
                ISwapV3.exactInputSingle,
                (ISwapV3.ExactInputSingleParams({
                    tokenIn: tokenIn,
                    tokenOut: tokenOut,
                    fee: fee,
                    recipient: recipient,
                    deadline: block.timestamp,
                    amountIn: amountIn,
                    amountOutMinimum: minOut,
                    sqrtPriceLimitX96: 0
                }))
            )
        );
        if (!ok || data.length < 32) return 0;
        return abi.decode(data, (uint256));
    }

    function _buyBsc(address task, uint256 amountIn, uint256 minOut) internal {
        if (task == quote) {
            require(_v3(wrapped, task, 100, amountIn, minOut, msg.sender) >= minOut, "buy");
            return;
        }
        if (_v3(wrapped, task, _tier(task), amountIn, minOut, msg.sender) >= minOut) return;
        uint256 usdt = _v3(wrapped, quote, 100, amountIn, 1, address(this));
        require(usdt > 0, "buy");
        _approve(quote, router, usdt);
        uint256 out = _v3(quote, task, _tier(task), usdt, minOut, msg.sender);
        _approve(quote, router, 0);
        require(out >= minOut, "buy");
    }

    function _sellBsc(address task, uint256 amountIn, uint256 minOut) internal {
        if (task == quote) {
            uint256 native = _v3(task, wrapped, 100, amountIn, minOut, address(this));
            require(native >= minOut, "buy");
            IWrap(wrapped).withdraw(native);
            return;
        }
        uint256 direct = _v3(task, wrapped, _tier(task), amountIn, minOut, address(this));
        if (direct >= minOut) {
            IWrap(wrapped).withdraw(direct);
            return;
        }
        uint256 usdt = _v3(task, quote, _tier(task), amountIn, 1, address(this));
        require(usdt > 0, "buy");
        _approve(quote, router, usdt);
        uint256 out = _v3(quote, wrapped, 100, usdt, minOut, address(this));
        _approve(quote, router, 0);
        require(out >= minOut, "buy");
        IWrap(wrapped).withdraw(out);
    }

    function _buyV3(address task, uint256 amountIn, uint256 minOut) internal {
        uint256 before = IERC20(task).balanceOf(msg.sender);
        uint256 out = ISwapV3(router).exactInputSingle(ISwapV3.ExactInputSingleParams({
            tokenIn: wrapped,
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

    function _buyTape(address task, uint256 amountIn, uint256 minOut) internal {
        _approve(wrapped, router, amountIn);
        address[] memory path = _path(tapeQuote);
        uint256[] memory amounts = ISwapV2(router).swapExactTokensForTokens(amountIn, 1, path, address(this), block.timestamp);
        _approve(wrapped, router, 0);
        uint256 usdt = amounts[amounts.length - 1];
        _approve(tapeQuote, tapePool, usdt);
        uint256 tapeOut = ITape(tapePool).swap(0, false, usdt, task == tapeToken ? minOut : 1);
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

    function _spotBuy(address task, uint256 amountIn, uint256 minOut) internal {
        _approve(wrapped, BEM_SPOT, amountIn);
        uint256 before = IERC20(task).balanceOf(msg.sender);
        uint256 out = ISpot(BEM_SPOT).exactInputSingle(ISpot.ExactInputSingleParams({
            tokenIn: wrapped,
            tokenOut: task,
            fee: BEM_FEE,
            recipient: msg.sender,
            amountIn: amountIn,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0
        }));
        _approve(wrapped, BEM_SPOT, 0);
        require(out >= minOut && IERC20(task).balanceOf(msg.sender) >= before + minOut, "buy");
    }

    function _spotSell(address task, uint256 amountIn, uint256 minOut) internal {
        _approve(task, BEM_SPOT, amountIn);
        uint256 out = ISpot(BEM_SPOT).exactInputSingle(ISpot.ExactInputSingleParams({
            tokenIn: task,
            tokenOut: wrapped,
            fee: BEM_FEE,
            recipient: address(this),
            amountIn: amountIn,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0
        }));
        _approve(task, BEM_SPOT, 0);
        require(out >= minOut, "buy");
        IWrap(wrapped).withdraw(out);
    }

    function _path(address out) internal view returns (address[] memory path) {
        path = new address[](2);
        path[0] = wrapped;
        path[1] = out;
    }

    function _sell(uint256 amountIn, uint256 minOut) internal {
        require(msg.value == 0, "value");
        uint256 mark = _mark();
        uint256 need = spotNeed > perpNeed ? spotNeed : perpNeed;
        require(need > 0 && amountIn > 0 && minOut >= need, "task");
        address task = hi == 1 ? wrapped : address(uint160(hi));
        require(task != address(0) && task != wrapped, "task");
        uint256 before = address(this).balance;
        if (tapeBem != address(0) && task == tapeBem) {
            _pull(task, msg.sender, amountIn);
            _spotSell(task, amountIn, minOut);
        } else if (tapePool != address(0) && task == tapeToken) {
            _pull(task, msg.sender, amountIn);
            _approve(task, tapePool, amountIn);
            ITape(tapePool).swap(1, true, amountIn, minOut);
            _approve(task, tapePool, 0);
        } else if (tapePool != address(0) && task == tapeBem) _sellTape(task, amountIn);
        else {
            _pull(task, msg.sender, amountIn);
            _approve(task, router, amountIn);
            if (kind == 0) _sellBsc(task, amountIn, minOut);
            else _sellV2(task, amountIn, minOut);
            _approve(task, router, 0);
        }
        uint256 got = address(this).balance - before;
        require(got >= need, "buy");
        (bool sent, ) = msg.sender.call{value: got}("");
        require(sent, "push");
        _keep(mark);
    }

    function _sellV3(address task, uint256 amountIn, uint256 minOut) internal {
        uint256 out = ISwapV3(router).exactInputSingle(ISwapV3.ExactInputSingleParams({
            tokenIn: task,
            tokenOut: wrapped,
            fee: swapFee,
            recipient: address(this),
            deadline: block.timestamp,
            amountIn: amountIn,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0
        }));
        require(out >= minOut, "buy");
        IWrap(wrapped).withdraw(out);
    }

    function _sellV2(address task, uint256 amountIn, uint256 minOut) internal {
        address[] memory path = new address[](2);
        path[0] = task;
        path[1] = wrapped;
        uint256[] memory amounts = ISwapV2(router).swapExactTokensForETH(amountIn, minOut, path, address(this), block.timestamp);
        require(amounts[amounts.length - 1] >= minOut, "buy");
    }

    function _sellTape(address task, uint256 amountIn) internal {
        _pull(task, msg.sender, amountIn);
        uint256 usdt;
        if (task == tapeBem) {
            _approve(tapeBem, tapePool, amountIn);
            uint256 tapeOut = ITape(tapePool).swap(1, false, amountIn, 1);
            _approve(tapeBem, tapePool, 0);
            _approve(tapeToken, tapePool, tapeOut);
            usdt = ITape(tapePool).swap(0, true, tapeOut, 1);
            _approve(tapeToken, tapePool, 0);
        } else {
            _approve(tapeToken, tapePool, amountIn);
            usdt = ITape(tapePool).swap(0, true, amountIn, 1);
            _approve(tapeToken, tapePool, 0);
        }
        _approve(tapeQuote, router, usdt);
        address[] memory path = new address[](2);
        path[0] = tapeQuote;
        path[1] = wrapped;
        uint256[] memory amounts = ISwapV2(router).swapExactTokensForETH(usdt, 1, path, address(this), block.timestamp);
        _approve(tapeQuote, router, 0);
        require(amounts[amounts.length - 1] > 0, "buy");
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
