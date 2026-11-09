// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
}

interface IPerp {
    function nextDeal() external view returns (uint256);
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

/// Prize packet that stamps a perp fill. trade() does not open the position.
/// It reads the book, checks the caller is on a new deal of the required side
/// and margin, then stamps tradedDay so claim() can pay.
contract RedPerp {
    uint256 public constant PACE = 180;
    address public constant BOOTH = 0x284Fa8819980A229622B711A52BF66bD9cDCbC2d;
    address public constant BSC_BEM = 0xdA4aA9E0aaad6F91835cD19345D49a8fcA8d019A;
    address public constant BSC_UP = 0x5f913f7AFa71c51d69F472b0fE4c3EC74b1132F8;
    address public constant X_BEM = 0xE8Ed0fE7a7aaEF822b2e5Ce9679ccACcF3aEFF56;
    address public constant X_TAPE = 0x9b17D0F6431957661AdD30051de2615cb08A3886;
    address public constant X_FAB = 0x6Bd480BF658FaB7A2cb758c0408A7b3B5B94B431;

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
    mapping(uint256 => bool) private used;

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

    function perp() external pure returns (bool) {
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
        _arm(token_, 0, fixedAmt_, hi_, spotNeed_, gate_, life_, fee_, fundAmt_);
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

    function trade(uint256 dealId, uint256) external {
        require(locked == 0, "bot");
        locked = 1;
        require(tx.origin == msg.sender, "bot");
        require(ready, "rule");
        require(block.timestamp <= endsAt, "late");
        uint256 day = sgDay(block.timestamp);
        require(tradedDay[msg.sender] != day, "day");
        require(dealId >= lo, "task");
        require(!used[dealId], "task");
        address book = address(uint160(hi));
        (address long, address short, uint96 marginL, uint96 marginS,,,,,) = IPerp(book).deals(dealId);
        bool wantShort = gate == 1;
        require((wantShort ? short : long) == msg.sender, "task");
        uint256 margin = wantShort ? uint256(marginS) : uint256(marginL);
        require(margin * 100 >= spotNeed * 99, "task");
        used[dealId] = true;
        tradedDay[msg.sender] = day;
        emit Traded(msg.sender, day, dealId, margin);
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
        uint256 hi_,
        uint256 spotNeed_,
        uint8 gate_,
        uint256 life_,
        uint24 fee_,
        uint256 fundAmt_
    ) internal {
        require(fixedAmt_ > 0 && fundAmt_ >= fixedAmt_, "amount");
        _save(token_, mode_, fixedAmt_, hi_, spotNeed_, gate_, life_, fee_);
        lo = IPerp(address(uint160(hi_))).nextDeal();
        uint256 n = fundAmt_ / fixedAmt_;
        require(n > 0, "packets");
        packetsLeft = n;
        dayCap = n;
        ready = true;
        emit RuleSet(token_, mode_, fixedAmt_, lo, hi_, n, n, spotNeed_, 0, gate_, life_);
    }

    function _save(
        address token_,
        uint8 mode_,
        uint256 fixedAmt_,
        uint256 hi_,
        uint256 spotNeed_,
        uint8 gate_,
        uint256 life_,
        uint24 fee_
    ) internal {
        _book(hi_);
        require(gate_ <= 1, "mode");
        require(life_ == 1 days || life_ == 7 days || life_ == 30 days, "life");
        require(spotNeed_ > 0, "amount");
        token = token_;
        mode = mode_;
        fixedAmt = fixedAmt_;
        lo = 0;
        hi = hi_;
        spotNeed = spotNeed_;
        perpNeed = 0;
        gate = gate_;
        swapFee = fee_;
        endsAt = block.timestamp + life_;
    }

    function _book(uint256 hi_) internal view returns (address book) {
        book = address(uint160(hi_));
        if (block.chainid == 56) require(book == BSC_BEM || book == BSC_UP, "task");
        else if (block.chainid == 196) require(book == X_BEM || book == X_TAPE || book == X_FAB, "task");
        else revert("task");
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
