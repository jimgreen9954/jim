// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256) external;
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
    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory amounts);

    function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        returns (uint256[] memory amounts);
}

interface IUp {
    function quoteBuyWithUSDT(uint256 amountIn) external view returns (uint256 bemIn);
    function buyWithUSDT(uint256 amountIn, uint256 minOut, uint256 minBem) external;
    function sell(uint256 amountIn, uint256 minOut) external;
}

interface ITape {
    function swap(uint8 quote, bool tapeIn, uint256 amountIn, uint256 minOut) external payable;
}

/// One spawned spot packet. BSC (kind 0) swaps on the fee stored at publish,
/// which is the pool that actually has the coin. A 0.01% hop is only the
/// BNB/USDT leg. X Layer (kind 1) uses the TAPE pool or the V2 router.
contract RedNext {
    uint256 public constant PACE = 180;
    address public constant BOOTH = 0x284Fa8819980A229622B711A52BF66bD9cDCbC2d;
    uint24 internal constant HOP = 100;
    address internal constant UP_TOKEN = 0xEd99445d72787Adb627cD8588586984DF548CD2F;
    address internal constant UP_POOL = 0xDf40529fa3E797c992272e27B811E59E5f1827Ae;
    address internal constant UP_BEM = 0x5ce033B2bFCa3Af30b3e8C8457DeaF776A8b695a;

    address public immutable router;
    address public immutable quote;
    address public immutable wrapped;
    address public immutable tapePool;
    address public immutable tapeQuote;
    address public immutable tapeToken;
    address public immutable tapeBem;
    uint256 public immutable quoteScale;
    uint8 public immutable kind;

    address public creator;
    address public token;
    uint8 public mode;
    uint8 public gate;
    uint24 public swapFee;
    uint256 public fixedAmt;
    uint256 public lo;
    uint256 public hi;
    uint256 public packetsLeft;
    uint256 public dayCap;
    uint256 public spotNeed;
    uint256 public perpNeed;
    uint256 public endsAt;
    uint256 public lastClaimAt;
    uint256 public claimDay;
    uint256 public claimedToday;
    bool public ready;
    uint256 private locked;

    mapping(address => uint256) public lastDay;
    mapping(address => uint256) public tradedDay;

    event Claimed(address indexed who, uint256 indexed day, uint256 amount);
    event Funded(address indexed from, uint256 amount);
    event Traded(address indexed who, uint256 indexed day, uint8 side);
    event RuleSet(
        address token,
        uint8 mode,
        uint256 fixedAmt,
        uint256 lo,
        uint256 hi,
        uint256 packets,
        uint256 dayCap,
        uint256 spotNeed,
        uint256 perpNeed,
        uint8 gate,
        uint256 life
    );

    constructor(
        address router_,
        address quote_,
        address wrapped_,
        address tapePool_,
        address tapeQuote_,
        address tapeToken_,
        address tapeBem_,
        uint256 quoteScale_,
        uint8 kind_
    ) {
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

    receive() external payable {}

    function sgDay(uint256 ts) public pure returns (uint256) {
        return (ts + 8 hours) / 1 days;
    }

    function claimsToday(uint256 ts) external view returns (uint256) {
        return sgDay(ts) == claimDay ? claimedToday : 0;
    }

    function credit(address who) external view returns (uint256) {
        if (who != creator) return 0;
        return token == address(0) ? address(this).balance : IERC20(token).balanceOf(address(this));
    }

    function cursor() external view returns (uint256) {
        return lo;
    }

    function begin(
        address token_,
        uint256 fixedAmt_,
        uint256 hi_,
        uint256 spotNeed_,
        uint8 gate_,
        uint256 life_,
        uint24 fee_,
        uint256 fundAmt_
    ) external payable {
        require(msg.sender == BOOTH, "creator");
        require(!ready, "rule");
        _arm(token_, fixedAmt_, hi_, spotNeed_, gate_, life_, fee_, fundAmt_);
        creator = tx.origin;
        _take(token_, fundAmt_);
    }

    function deposit(uint256 amount) external {
        require(ready && token != address(0), "native");
        require(amount > 0 && fixedAmt > 0, "amount");
        _pull(token, msg.sender, amount);
        packetsLeft += amount / fixedAmt;
        emit Funded(msg.sender, amount);
    }

    function depositNative() external payable {
        require(ready && token == address(0), "token");
        require(msg.value > 0 && fixedAmt > 0, "amount");
        packetsLeft += msg.value / fixedAmt;
        emit Funded(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        require(msg.sender == creator, "creator");
        require(block.timestamp > endsAt, "early");
        require(amount > 0, "amount");
        if (token == address(0)) {
            (bool ok,) = msg.sender.call{value: amount}("");
            require(ok, "prize");
        } else {
            _push(token, msg.sender, amount);
        }
        uint256 bal = token == address(0) ? address(this).balance : IERC20(token).balanceOf(address(this));
        packetsLeft = fixedAmt == 0 ? 0 : bal / fixedAmt;
    }

    function setRule(
        address token_,
        uint8 mode_,
        uint256 fixedAmt_,
        uint256 lo_,
        uint256 hi_,
        uint256 packets_,
        uint256 dayCap_,
        uint256 spotNeed_,
        uint256 perpNeed_,
        uint8 gate_,
        uint256 life_,
        uint24 fee_
    ) external {
        require(msg.sender == creator, "creator");
        require(gate_ <= 1, "mode");
        require(life_ == 1 days || life_ == 7 days || life_ == 30 days, "life");
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

    function trade(uint256 amountIn, uint256 minOut) external payable {
        require(locked == 0, "bot");
        locked = 1;
        require(tx.origin == msg.sender, "bot");
        require(ready, "rule");
        require(block.timestamp <= endsAt, "late");
        uint256 day = sgDay(block.timestamp);
        require(tradedDay[msg.sender] != day, "day");
        address task = address(uint160(hi));
        require(task != address(0), "task");
        if (gate == 0) {
            require(msg.value == spotNeed && spotNeed > 0, "amount");
            _buy(task, msg.value, minOut);
        } else {
            require(amountIn > 0 && minOut > 0, "amount");
            _sell(task, amountIn, minOut);
        }
        tradedDay[msg.sender] = day;
        emit Traded(msg.sender, day, gate);
        locked = 0;
    }

    function claim() external {
        require(tx.origin == msg.sender, "bot");
        require(ready, "rule");
        require(block.timestamp <= endsAt, "late");
        require(block.timestamp >= lastClaimAt + PACE, "pace");
        uint256 day = sgDay(block.timestamp);
        require(tradedDay[msg.sender] == day, "task");
        require(lastDay[msg.sender] != day, "day");
        if (claimDay != day) {
            claimDay = day;
            claimedToday = 0;
        }
        require(packetsLeft > 0, "empty");
        require(dayCap > 0 && claimedToday < dayCap, "cap");
        uint256 pay = fixedAmt;
        require(pay > 0, "empty");
        packetsLeft -= 1;
        claimedToday += 1;
        lastDay[msg.sender] = day;
        lastClaimAt = block.timestamp;
        if (token == address(0)) {
            (bool ok,) = msg.sender.call{value: pay}("");
            require(ok, "prize");
        } else {
            _push(token, msg.sender, pay);
        }
        emit Claimed(msg.sender, day, pay);
    }

    function _arm(
        address token_,
        uint256 fixedAmt_,
        uint256 hi_,
        uint256 spotNeed_,
        uint8 gate_,
        uint256 life_,
        uint24 fee_,
        uint256 fundAmt_
    ) internal {
        require(fixedAmt_ > 0 && fundAmt_ >= fixedAmt_, "amount");
        require(gate_ <= 1, "mode");
        require(life_ == 1 days || life_ == 7 days || life_ == 30 days, "life");
        require(spotNeed_ > 0 && hi_ > 1, "amount");
        token = token_;
        mode = 0;
        fixedAmt = fixedAmt_;
        lo = 0;
        hi = hi_;
        spotNeed = spotNeed_;
        perpNeed = 0;
        gate = gate_;
        swapFee = fee_;
        endsAt = block.timestamp + life_;
        uint256 n = fundAmt_ / fixedAmt_;
        require(n > 0, "packets");
        packetsLeft = n;
        dayCap = n;
        ready = true;
        emit RuleSet(token_, 0, fixedAmt_, 0, hi_, n, n, spotNeed_, 0, gate_, life_);
    }

    function _take(address token_, uint256 fundAmt_) internal {
        if (token_ == address(0)) {
            require(msg.value == fundAmt_, "native");
            return;
        }
        require(msg.value == 0, "native");
        _pull(token_, tx.origin, fundAmt_);
        emit Funded(tx.origin, fundAmt_);
    }

    function _buy(address task, uint256 amountIn, uint256 minOut) internal {
        if (kind == 1 && task == tapeToken && tapePool != address(0)) {
            ITape(tapePool).swap{value: amountIn}(1, false, amountIn, minOut);
            return;
        }
        if (kind == 1) {
            address[] memory path = new address[](2);
            path[0] = wrapped;
            path[1] = task;
            ISwapV2(router).swapExactETHForTokens{value: amountIn}(minOut, path, msg.sender, block.timestamp + 20 minutes);
            return;
        }
        if (task == UP_TOKEN) {
            _buyOfficial(amountIn, minOut);
            return;
        }
        IWETH(wrapped).deposit{value: amountIn}();
        uint256 got = _v3(wrapped, task, swapFee == 0 ? HOP : swapFee, amountIn, msg.sender, minOut);
        require(got >= minOut, "buy");
    }

    function _sell(address task, uint256 amountIn, uint256 minOut) internal {
        _pull(task, msg.sender, amountIn);
        if (kind == 1 && task == tapeToken && tapePool != address(0)) {
            _approve(task, tapePool, amountIn);
            uint256 beforeBal = address(this).balance;
            ITape(tapePool).swap(1, true, amountIn, minOut);
            uint256 got = address(this).balance - beforeBal;
            require(got >= minOut, "buy");
            (bool ok,) = msg.sender.call{value: got}("");
            require(ok, "prize");
            return;
        }
        if (kind == 1) {
            _approve(task, router, amountIn);
            address[] memory path = new address[](2);
            path[0] = task;
            path[1] = wrapped;
            uint256 beforeBal = address(this).balance;
            ISwapV2(router).swapExactTokensForETH(amountIn, minOut, path, address(this), block.timestamp + 20 minutes);
            uint256 got = address(this).balance - beforeBal;
            require(got >= minOut, "buy");
            (bool ok,) = msg.sender.call{value: got}("");
            require(ok, "prize");
            return;
        }
        if (task == UP_TOKEN) {
            _sellOfficial(amountIn, minOut);
            return;
        }
        uint24 fee = swapFee == 0 ? HOP : swapFee;
        uint256 out = _v3(task, wrapped, fee, amountIn, address(this), minOut);
        require(out >= minOut, "buy");
        IWETH(wrapped).withdraw(out);
        (bool ok,) = msg.sender.call{value: out}("");
        require(ok, "prize");
    }

    function _buyOfficial(uint256 amountIn, uint256 minOut) internal {
        IWETH(wrapped).deposit{value: amountIn}();
        uint256 usdt = _exact(wrapped, quote, HOP, amountIn, address(this), 1);
        uint256 bem = IUp(UP_POOL).quoteBuyWithUSDT(usdt);
        require(bem > 0, "buy");
        _approve(quote, UP_POOL, usdt);
        uint256 beforeUp = IERC20(UP_TOKEN).balanceOf(address(this));
        IUp(UP_POOL).buyWithUSDT(usdt, minOut, bem * 99 / 100);
        uint256 got = IERC20(UP_TOKEN).balanceOf(address(this)) - beforeUp;
        require(got >= minOut, "buy");
        _push(UP_TOKEN, msg.sender, got);
    }

    function _sellOfficial(uint256 amountIn, uint256 minOut) internal {
        _approve(UP_TOKEN, UP_POOL, amountIn);
        uint256 beforeBem = IERC20(UP_BEM).balanceOf(address(this));
        IUp(UP_POOL).sell(amountIn, 1);
        uint256 bem = IERC20(UP_BEM).balanceOf(address(this)) - beforeBem;
        require(bem > 0, "buy");
        uint256 wbnb = _exact(UP_BEM, wrapped, 10000, bem, address(this), minOut);
        require(wbnb >= minOut, "buy");
        IWETH(wrapped).withdraw(wbnb);
        (bool ok,) = msg.sender.call{value: wbnb}("");
        require(ok, "prize");
    }

    function _v3(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, address recipient, uint256 minOut)
        internal
        returns (uint256)
    {
        _approve(tokenIn, router, amountIn);
        try ISwapV3(router).exactInputSingle(
            ISwapV3.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: recipient,
                deadline: block.timestamp + 20 minutes,
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        ) returns (uint256 out) {
            return out;
        } catch {
            if (tokenIn == quote || tokenOut == quote) revert("buy");
            uint24 inFee = tokenIn == wrapped ? HOP : fee;
            uint24 outFee = tokenOut == wrapped ? HOP : fee;
            uint256 mid = _exact(tokenIn, quote, inFee, amountIn, address(this), 1);
            return _exact(quote, tokenOut, outFee, mid, recipient, minOut);
        }
    }

    function _exact(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, address recipient, uint256 minOut)
        internal
        returns (uint256)
    {
        _approve(tokenIn, router, amountIn);
        try ISwapV3(router).exactInputSingle(
            ISwapV3.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: recipient,
                deadline: block.timestamp + 20 minutes,
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        ) returns (uint256 out) {
            return out;
        } catch {
            revert("buy");
        }
    }

    function _approve(address token_, address spender, uint256 amount) internal {
        _call(token_, abi.encodeWithSelector(IERC20.approve.selector, spender, 0));
        _call(token_, abi.encodeWithSelector(IERC20.approve.selector, spender, amount));
    }

    function _pull(address token_, address from, uint256 amount) internal {
        _call(token_, abi.encodeWithSelector(IERC20.transferFrom.selector, from, address(this), amount));
    }

    function _push(address token_, address to, uint256 amount) internal {
        _call(token_, abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
    }

    function _call(address token_, bytes memory data) internal {
        (bool ok, bytes memory ret) = token_.call(data);
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "pull");
    }
}
