// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

interface IRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

interface IPool {
    function slot0() external view returns (uint160 sqrtPriceX96, int24, uint16, uint16, uint16, uint8, bool);
}

interface ISplit {
    function orders(uint64 id)
        external
        view
        returns (address user, uint256 tokenId, bool bid, uint128 price, uint128 size, uint128 left, uint256 prev, uint256 next);
}

struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

/// X Layer prize packet. trade() itself swaps BEM/FAB on the 0.9% v4 pool,
/// or checks a live TAPE-hash order, then stamps tradedDay so claim() can pay.
contract RedDesk {
    uint256 public constant PACE = 180;
    address public constant BOOTH = 0x284Fa8819980A229622B711A52BF66bD9cDCbC2d;
    address public constant SAFE = 0xb4D6039394c8B97C3AC3234aa07011B564Fcb88c;
    address public constant FAB = 0x72F349B1Eee7833B26f8C81a8410775A4e231ed2;
    address public constant BEM = 0x60e62Efa9405d6873C5deaBD4E6CC91c25363952;
    address public constant ROUTER_V4 = 0xDa00aE15d3A71466517129255255db7c0c0956d3;
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address public constant BEM_POOL = 0x2CcF8aa17F5DF9Fb5D51C9de12135a913fF29f7A;
    address public constant HASH = 0x08BD11220b6A87F1D16B54b5521d4e90BB0d1B1b;
    uint256 private constant Q96 = 2 ** 96;
    uint256 private constant HASH_ID = 80;

    address public immutable deployer;
    address public immutable router = 0x881fB2f98c13d521009464e7D1CBf16E1b394e8E;
    address public immutable quote = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address public immutable wrapped = 0xe538905cf8410324e03A5A23C1c177a474D59b2b;
    address public immutable tapePool = 0x58eaD5b41Cfd3627791D439402dd65571c286484;
    address public immutable tapeQuote = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address public immutable tapeToken = 0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3;
    address public immutable tapeBem = 0x60e62Efa9405d6873C5deaBD4E6CC91c25363952;

    address public creator;
    address public token;
    uint8 public mode;
    uint8 public gate;
    uint8 public kind = 1;
    uint24 public swapFee;
    uint256 public fixedAmt;
    uint256 public lo;
    uint256 public hi;
    uint256 public packetsLeft;
    uint256 public dayCap;
    uint256 public spotNeed;
    uint256 public perpNeed;
    uint256 public endsAt;
    uint256 public quoteScale = 1;
    uint256 public lastClaimAt;
    uint256 public claimDay;
    uint256 public claimedToday;
    bool public ready;
    uint256 private locked;

    mapping(address => uint256) public lastDay;
    mapping(address => uint256) public tradedDay;
    mapping(uint64 => bool) public used;

    event Claimed(address indexed who, uint256 indexed day, uint256 amount);
    event Funded(address indexed from, uint256 amount);
    event Traded(address indexed who, uint256 indexed day, uint256 spent, uint256 got);
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

    constructor(address deployer_) {
        require(deployer_ != address(0), "deployer");
        deployer = deployer_;
        creator = deployer_;
    }

    receive() external payable {}

    function desk() external pure returns (bool) {
        return true;
    }

    function sgDay(uint256 ts) public pure returns (uint256) {
        return (ts + 8 hours) / 1 days;
    }

    function claimsToday(uint256 ts) external view returns (uint256) {
        return sgDay(ts) == claimDay ? claimedToday : 0;
    }

    function credit(address who) external view returns (uint256) {
        if (who != creator && who != deployer) return 0;
        return token == address(0) ? address(this).balance : IERC20(token).balanceOf(address(this));
    }

    function cursor() external pure returns (uint256) {
        return 0;
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
        _arm(token_, 0, fixedAmt_, 0, hi_, spotNeed_, 0, gate_, life_, fee_, fundAmt_);
        creator = tx.origin;
        _take(token_, fundAmt_);
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
        require(msg.sender == deployer, "deployer");
        require(creator == deployer, "rule");
        require(packets_ > 0 && dayCap_ > 0 && fixedAmt_ > 0, "packets");
        _save(token_, mode_, fixedAmt_, lo_, hi_, spotNeed_, perpNeed_, gate_, life_, fee_);
        packetsLeft = packets_;
        dayCap = dayCap_;
        ready = true;
        emit RuleSet(token_, mode_, fixedAmt_, lo_, hi_, packets_, dayCap_, spotNeed_, perpNeed_, gate_, life_);
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
        require(msg.sender == creator || msg.sender == deployer, "creator");
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

    function trade(uint256 amountIn, uint256 minOut) external payable {
        require(locked == 0, "bot");
        locked = 1;
        require(tx.origin == msg.sender, "bot");
        require(ready, "rule");
        require(block.timestamp <= endsAt, "late");
        uint256 day = sgDay(block.timestamp);
        require(tradedDay[msg.sender] != day, "day");
        uint256 spent;
        uint256 got;
        if (hi == uint256(uint160(HASH))) {
            uint64 id = uint64(amountIn);
            (address user, uint256 tokenId, bool bid, uint128 price, uint128 size,,,) = ISplit(HASH).orders(id);
            require(user == msg.sender && tokenId == HASH_ID && price > 0 && size >= 1, "task");
            require(gate == 1 ? !bid : bid, "task");
            require(!used[id], "task");
            used[id] = true;
            spent = amountIn;
            got = 1;
        } else if (hi == uint256(uint160(FAB))) {
            require(amountIn > 0 && minOut > 0 && spotNeed > 0, "amount");
            bool buy = gate != 1;
            uint256 fee = (amountIn * 20) / 10_000;
            uint256 swapIn = amountIn - fee;
            require(swapIn > 0 && swapIn <= type(uint128).max && minOut <= type(uint128).max, "amount");
            address input = buy ? BEM : FAB;
            _pull(input, msg.sender, amountIn);
            if (fee > 0) _push(input, SAFE, fee);
            if (buy) require(_bemOkb(swapIn) * 100 >= spotNeed * 95, "buy");
            got = _swap(buy, swapIn, minOut);
            if (!buy) require(_bemOkb(got) * 100 >= spotNeed * 95, "buy");
            _push(buy ? FAB : BEM, msg.sender, got);
            spent = amountIn;
        } else {
            revert("task");
        }
        tradedDay[msg.sender] = day;
        emit Traded(msg.sender, day, spent, got);
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
        uint8 mode_,
        uint256 fixedAmt_,
        uint256 lo_,
        uint256 hi_,
        uint256 spotNeed_,
        uint256 perpNeed_,
        uint8 gate_,
        uint256 life_,
        uint24 fee_,
        uint256 fundAmt_
    ) internal {
        require(fixedAmt_ > 0 && fundAmt_ >= fixedAmt_, "amount");
        _save(token_, mode_, fixedAmt_, lo_, hi_, spotNeed_, perpNeed_, gate_, life_, fee_);
        uint256 n = fundAmt_ / fixedAmt_;
        require(n > 0, "packets");
        packetsLeft = n;
        dayCap = n;
        ready = true;
        emit RuleSet(token_, mode_, fixedAmt_, lo_, hi_, n, n, spotNeed_, perpNeed_, gate_, life_);
    }

    function _save(
        address token_,
        uint8 mode_,
        uint256 fixedAmt_,
        uint256 lo_,
        uint256 hi_,
        uint256 spotNeed_,
        uint256 perpNeed_,
        uint8 gate_,
        uint256 life_,
        uint24 fee_
    ) internal {
        require(hi_ == uint256(uint160(FAB)) || hi_ == uint256(uint160(HASH)), "task");
        require(gate_ <= 1, "mode");
        require(life_ == 1 days || life_ == 7 days || life_ == 30 days, "life");
        require(spotNeed_ > 0, "amount");
        token = token_;
        mode = mode_;
        fixedAmt = fixedAmt_;
        lo = lo_;
        hi = hi_;
        spotNeed = spotNeed_;
        perpNeed = perpNeed_;
        gate = gate_;
        swapFee = fee_;
        endsAt = block.timestamp + life_;
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

    function _bemOkb(uint256 bemIn) internal view returns (uint256) {
        (uint160 sqrt,,,,,,) = IPool(BEM_POOL).slot0();
        require(sqrt > 0, "buy");
        uint256 step = (bemIn * uint256(sqrt)) / Q96;
        return (step * uint256(sqrt)) / Q96;
    }

    function _swap(bool buy, uint256 swapIn, uint256 minOut) internal returns (uint256 got) {
        address input = buy ? BEM : FAB;
        address output = buy ? FAB : BEM;
        _call(input, abi.encodeWithSelector(IERC20.approve.selector, PERMIT2, swapIn));
        IPermit2(PERMIT2).approve(input, ROUTER_V4, uint160(swapIn), uint48(block.timestamp + 1 hours));
        uint256 beforeBal = IERC20(output).balanceOf(address(this));
        bytes memory swapParam = abi.encode(
            PoolKey(BEM, FAB, 9000, 180, address(0)),
            buy,
            uint128(swapIn),
            uint128(minOut),
            bytes("")
        );
        bytes[] memory inner = new bytes[](3);
        inner[0] = swapParam;
        inner[1] = abi.encode(input, swapIn);
        inner[2] = abi.encode(output, minOut);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(bytes(hex"060c0f"), inner);
        IRouter(ROUTER_V4).execute(hex"10", inputs, block.timestamp + 20 minutes);
        got = IERC20(output).balanceOf(address(this)) - beforeBal;
        require(got >= minOut, "buy");
    }

    function _pull(address token_, address from, uint256 amount) internal {
        _call(token_, abi.encodeWithSelector(bytes4(keccak256("transferFrom(address,address,uint256)")), from, address(this), amount));
    }

    function _push(address token_, address to, uint256 amount) internal {
        _call(token_, abi.encodeWithSelector(bytes4(keccak256("transfer(address,uint256)")), to, amount));
    }

    function _call(address token_, bytes memory data) internal {
        (bool ok, bytes memory ret) = token_.call(data);
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "pull");
    }
}
