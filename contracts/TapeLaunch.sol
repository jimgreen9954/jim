// SPDX-License-Identifier: MIT
// Compile with solc 0.8.24, optimizer enabled, 1 run, viaIR true.
pragma solidity 0.8.24;

/// X Layer launch factory for projects created on this site.
///
/// Mint proceeds are split when they arrive. Two ledgers inside the project
/// spend themselves. Neither needs another signature from the creator.
///
///   - 30% is the creator's. After the sale closes they can claim it.
///   - 40% has no withdraw. After close, a listing under 2x mint that has sat
///     for a day can be bought by this ledger. The NFT is burned. At most
///     1/90 of the closing balance per day. The creator address cannot sell
///     into it. A second wallet still can, which is why the day is capped.
///   - The last 30% is not a linear vest. After 90 days the creator can take
///     all of it only if three consecutive days each had a listing at or above
///     2x that was already a day old, and no listing under 2x. After those 90
///     days, three missed or cheap days forfeit it forever. Then anyone may
///     call once a day. OKB is spent half on BEM and half on TAPE, and both
///     are burned. BEM or TAPE already held is burned, not sold.
///
/// The 2x check is this contract's own listings, not a same-transaction spot
/// print. A spot print can be pushed under 2x inside one transaction and would
/// drain a vault that market-buys on that print. That path is not here.
/// One cheap listing larger than the daily cap can still sit for three days
/// and forfeit the last 30%. The creator can clear a listing the cap can pay.
/// The OKB buy uses 95% of the pool mid as a floor. A searcher can still
/// worsen that one day. One day is at most 1/90 of the ledger.
/// No owner, no upgrade, no pause, no rescue. buybackOn is ignored. Buyback
/// is always available after close. The 0.2% secondary fee is only taken on
/// sales inside this contract. OKX and tapeout.net sales do not pass through
/// here. Half of a TAPE payment is burned. Half of a BEM or OKB payment is
/// locked here with no swap and no withdraw. The OKB seed has no withdraw.

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}

interface IRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256);
}

interface IWOKB {
    function deposit() external payable;
}

interface IBemPool {
    function slot0() external view returns (uint160 sqrtPriceX96, int24, uint16, uint16, uint16, uint8, bool);
}

interface ITapePool {
    function bemPool() external view returns (uint256 tape, uint256 quote, uint256 shares);
    function swap(uint8 quote, bool tapeIn, uint256 amountIn, uint256 minOut) external returns (uint256);
}

contract TapeDrop {
    address public constant TAPE = 0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3;
    address public constant BEM = 0x60e62Efa9405d6873C5deaBD4E6CC91c25363952;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address public constant WOKB = 0xe538905cf8410324e03A5A23C1c177a474D59b2b;
    address public constant ROUTER = 0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA;
    address public constant BEM_POOL = 0x2CcF8aa17F5DF9Fb5D51C9de12135a913fF29f7A;
    address public constant TAPE_POOL = 0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641;
    uint256 public constant ONE_TAPE = 100_000_000;
    uint256 public constant SEED_BEM = 1_000_000;
    uint256 public constant UNIT_BEM = 100_000;
    uint256 public constant SEED_OKB = 10 ** 16;
    uint256 public constant VEST = 90 days;
    uint256 public constant DELAY = 1 days;
    uint8 public constant PAIR = 1;
    uint8 public constant OKB = 2;
    uint8 public constant BEM_ONLY = 3;

    address public immutable factory;
    address public immutable creator;
    address public immutable platform;
    uint8 public immutable mode;
    uint32 public immutable multiplier;
    uint32 public immutable supply;
    uint32 public immutable reserve;
    bool public immutable buybackOn;
    uint256 public immutable lockedOkb;
    string public name;
    string public symbol;
    string public baseUri;

    bool public seeded;
    bool public live;
    bool public closed;
    uint64 public bornAt;
    uint64 public closedAt;
    uint32 public publicMinted;
    uint32 public mintedCount;
    uint256 private entered = 1;

    uint256 public creatorTape;
    uint256 public vestTape;
    uint256 public claimedVestTape;
    uint256 public vaultTape;
    uint256 public burnTape;
    uint256 public creatorBem;
    uint256 public vestBem;
    uint256 public claimedVestBem;
    uint256 public vaultBem;
    uint256 public burnBem;
    uint256 public creatorOkb;
    uint256 public vestOkb;
    uint256 public claimedVestOkb;
    uint256 public vaultOkb;
    uint256 public burnOkb;
    uint256 public basisTape;
    uint256 public basisBem;
    uint256 public basisOkb;
    uint256 public vestBasisTape;
    uint256 public vestBasisBem;
    uint256 public vestBasisOkb;
    uint32 public underCount;
    uint64 public lastPokeDay;
    uint32 public highStreak;
    uint32 public lowStreak;
    uint64 public lastBurnDay;
    bool public forfeit;
    uint256 public day;
    uint256 public spentTape;
    uint256 public spentBem;
    uint256 public spentOkb;

    mapping(uint256 => address) private ownerOfId;
    mapping(address => uint256) private bal;
    mapping(uint256 => address) private approvedOf;
    mapping(address => mapping(address => bool)) private ops;
    mapping(address => uint32) public mintedBy;
    mapping(bytes32 => bool) public traitUsed;

    struct Listing {
        address seller;
        uint256 quote;
        uint64 at;
    }
    mapping(uint256 => Listing) public listings;

    event Transfer(address indexed from, address indexed to, uint256 indexed id);
    event Approval(address indexed owner, address indexed spender, uint256 indexed id);
    event ApprovalForAll(address indexed owner, address indexed operator, bool ok);
    event Minted(address indexed to, uint256 indexed id);
    event Listed(uint256 indexed id, address indexed seller, uint256 quote);
    event Bought(uint256 indexed id, address indexed buyer, uint256 quote);
    event Cancelled(uint256 indexed id);
    event Closed(uint64 at);
    event Claimed(address indexed to);
    event BoughtBack(uint256 indexed id, address indexed seller, uint256 quote);
    event Poked(uint64 day, bool high, uint32 highStreak, uint32 lowStreak);
    event Forfeited(uint64 day);
    event Burned(address indexed token, uint256 amount);

    modifier lock() {
        require(entered == 1, "reenter");
        entered = 2;
        _;
        entered = 1;
    }

    constructor(
        address creator_,
        address platform_,
        uint8 mode_,
        uint32 multiplier_,
        uint32 supply_,
        uint32 reserve_,
        bool buyback_,
        string memory name_,
        string memory symbol_,
        string memory base_
    ) payable {
        factory = msg.sender;
        creator = creator_;
        platform = platform_;
        mode = mode_;
        multiplier = multiplier_;
        supply = supply_;
        reserve = reserve_;
        buybackOn = buyback_;
        name = name_;
        symbol = symbol_;
        baseUri = base_;
        bornAt = uint64(block.timestamp);
        vaultOkb = msg.value;
        lockedOkb = msg.value;
    }

    function lockLaunchToken() external {
        require(msg.sender == factory && !seeded, "seed");
        seeded = true;
        if (mode != OKB) {
            require(IERC20(BEM).balanceOf(address(this)) == SEED_BEM, "bem");
            vaultBem = SEED_BEM;
        }
    }

    function open() external {
        require(msg.sender == factory && seeded && !live, "open");
        live = true;
    }

    function unitTape() public view returns (uint256) {
        if (mode != PAIR) return 0;
        return uint256(multiplier) * ONE_TAPE;
    }

    function unitBem() public view returns (uint256) {
        if (mode == OKB) return 0;
        return uint256(multiplier) * UNIT_BEM;
    }

    function unitOkb() public view returns (uint256) {
        if (mode != OKB) return 0;
        return uint256(multiplier) * 1 ether;
    }

    function claimReserve(uint256 id, bytes32 trait) external lock {
        require(live && msg.sender == creator, "reserve");
        require(id > 0 && id <= reserve && ownerOfId[id] == address(0), "id");
        _use(trait);
        _mint(creator, id);
    }

    function mint(uint256 qty, bytes32[] calldata traits) external payable lock {
        require(live && !closed, "closed");
        require(qty > 0 && qty <= 10 && traits.length == qty, "qty");
        require(mintedBy[msg.sender] + qty <= 10, "wallet");
        require(uint256(publicMinted) + qty <= uint256(supply) - reserve, "sold");
        uint256 tape = unitTape() * qty;
        uint256 bem = unitBem() * qty;
        uint256 okb = unitOkb() * qty;
        if (mode == OKB) require(msg.value == okb, "value");
        else require(msg.value == 0, "value");
        mintedBy[msg.sender] += uint32(qty);
        uint256 id = uint256(reserve) + publicMinted + 1;
        publicMinted += uint32(qty);
        _book(tape, bem, okb);
        for (uint256 i = 0; i < qty; i++) {
            _use(traits[i]);
            _mint(msg.sender, id + i);
        }
        if (tape > 0) _pull(TAPE, msg.sender, address(this), tape);
        if (bem > 0) _pull(BEM, msg.sender, address(this), bem);
    }

    function close() external lock {
        require(live && !closed, "closed");
        bool soldOut = publicMinted == supply - reserve;
        bool matured = msg.sender == creator && block.timestamp >= uint256(bornAt) + VEST;
        require(soldOut || matured, "early");
        closed = true;
        closedAt = uint64(block.timestamp);
        uint256 keepBem = mode == OKB ? 0 : SEED_BEM;
        basisTape = vaultTape;
        basisBem = vaultBem > keepBem ? vaultBem - keepBem : 0;
        basisOkb = vaultOkb > lockedOkb ? vaultOkb - lockedOkb : 0;
        vestBasisTape = vestTape;
        vestBasisBem = vestBem;
        vestBasisOkb = vestOkb;
        emit Closed(closedAt);
    }

    function claim() external lock {
        require(closed && msg.sender == creator, "claim");
        uint256 tape = creatorTape;
        uint256 bem = creatorBem;
        uint256 okb = creatorOkb;
        creatorTape = 0;
        creatorBem = 0;
        creatorOkb = 0;
        if (tape > 0) _push(TAPE, creator, tape);
        if (bem > 0) _push(BEM, creator, bem);
        if (okb > 0) _okb(creator, okb);
        emit Claimed(creator);
    }

    function claimVest() external lock {
        require(closed && msg.sender == creator && !forfeit, "vest");
        require(block.timestamp >= uint256(closedAt) + VEST, "time");
        require(highStreak >= 3 && underCount == 0, "px");
        require(lastPokeDay + 1 >= block.timestamp / 1 days, "stale");
        uint256 tape = vestTape;
        uint256 bem = vestBem;
        uint256 okb = vestOkb;
        vestTape = 0;
        vestBem = 0;
        vestOkb = 0;
        claimedVestTape += tape;
        claimedVestBem += bem;
        claimedVestOkb += okb;
        if (tape > 0) _push(TAPE, creator, tape);
        if (bem > 0) _push(BEM, creator, bem);
        if (okb > 0) _okb(creator, okb);
        emit Claimed(creator);
    }

    function poke(uint256 id) external lock {
        require(closed && !forfeit, "poke");
        uint64 today = uint64(block.timestamp / 1 days);
        require(today != lastPokeDay, "day");
        bool past = block.timestamp >= uint256(closedAt) + VEST;
        if (lastPokeDay != 0 && today > lastPokeDay + 1) {
            highStreak = 0;
            if (past) lowStreak += uint32(today - lastPokeDay - 1);
        }
        lastPokeDay = today;
        bool high = underCount == 0 && _over2(id);
        if (high) {
            highStreak += 1;
            lowStreak = 0;
        } else {
            highStreak = 0;
            if (past) lowStreak += 1;
        }
        emit Poked(today, high, highStreak, lowStreak);
        if (past && lowStreak >= 3) {
            forfeit = true;
            emit Forfeited(today);
        }
    }

    function burnDay() external lock {
        require(forfeit, "open");
        uint64 today = uint64(block.timestamp / 1 days);
        require(today != lastBurnDay, "day");
        lastBurnDay = today;
        uint256 tape = _take(vestBasisTape, vestTape);
        if (tape > 0) {
            vestTape -= tape;
            _push(TAPE, DEAD, tape);
            emit Burned(TAPE, tape);
        }
        uint256 bem = _take(vestBasisBem, vestBem);
        if (bem > 0) {
            vestBem -= bem;
            _push(BEM, DEAD, bem);
            emit Burned(BEM, bem);
        }
        uint256 okb = _take(vestBasisOkb, vestOkb);
        if (okb > 0) {
            vestOkb -= okb;
            uint256 half = okb / 2;
            uint256 rest = okb - half;
            if (half > 0) {
                uint256 bemOut = _okbToBem(half);
                _push(BEM, DEAD, bemOut);
                emit Burned(BEM, bemOut);
            }
            if (rest > 0) {
                uint256 bemForTape = _okbToBem(rest);
                uint256 tapeOut = _bemToTape(bemForTape);
                _push(TAPE, DEAD, tapeOut);
                emit Burned(TAPE, tapeOut);
            }
        }
    }

    function list(uint256 id, uint256 quote) external lock {
        require(ownerOfId[id] == msg.sender && msg.sender != address(this), "owner");
        require(quote >= 10_000 && quote <= type(uint256).max / 1000, "quote");
        listings[id] = Listing(msg.sender, quote, uint64(block.timestamp));
        _note(quote, true);
        _move(msg.sender, address(this), id);
        emit Listed(id, msg.sender, quote);
    }

    function cancel(uint256 id) external lock {
        Listing memory row = listings[id];
        require(row.seller == msg.sender, "seller");
        _note(row.quote, false);
        delete listings[id];
        _move(address(this), msg.sender, id);
        emit Cancelled(id);
    }

    function buy(uint256 id) external payable lock {
        Listing memory row = listings[id];
        require(row.seller != address(0) && row.seller != msg.sender, "list");
        _note(row.quote, false);
        delete listings[id];
        (uint256 toSeller, uint256 toPlat, uint256 toBurn) = _split(row.quote);
        if (mode == OKB) {
            require(msg.value == row.quote, "value");
            burnOkb += toBurn;
            _okb(row.seller, toSeller);
            _okb(platform, toPlat);
        } else {
            require(msg.value == 0, "value");
            _pull(BEM, msg.sender, address(this), row.quote);
            burnBem += toBurn;
            _push(BEM, row.seller, toSeller);
            _push(BEM, platform, toPlat);
            if (mode == PAIR) {
                uint256 tape = row.quote * 1000;
                (uint256 sellerT, uint256 platT, uint256 burnT) = _split(tape);
                _pull(TAPE, msg.sender, address(this), tape);
                burnTape += burnT;
                _push(TAPE, row.seller, sellerT);
                _push(TAPE, platform, platT);
            }
        }
        _move(address(this), msg.sender, id);
        emit Bought(id, msg.sender, row.quote);
    }

    function buyback(uint256 id) external lock {
        require(closed, "back");
        Listing memory row = listings[id];
        require(row.seller != address(0) && row.seller != creator, "seller");
        require(block.timestamp >= uint256(row.at) + DELAY, "delay");
        _roll();
        _note(row.quote, false);
        delete listings[id];
        if (mode == OKB) {
            require(row.quote < unitOkb() * 2, "px");
            require(spentOkb + row.quote <= _cap(basisOkb), "cap");
            require(vaultOkb >= row.quote + lockedOkb, "vault");
            spentOkb += row.quote;
            vaultOkb -= row.quote;
            _okb(row.seller, row.quote);
        } else {
            require(row.quote < unitBem() * 2, "px");
            uint256 keepBem = SEED_BEM;
            require(spentBem + row.quote <= _cap(basisBem), "cap");
            require(vaultBem >= row.quote + keepBem, "vault");
            spentBem += row.quote;
            vaultBem -= row.quote;
            _push(BEM, row.seller, row.quote);
            if (mode == PAIR) {
                uint256 tape = row.quote * 1000;
                require(spentTape + tape <= _cap(basisTape), "cap");
                require(vaultTape >= tape, "vault");
                spentTape += tape;
                vaultTape -= tape;
                _push(TAPE, row.seller, tape);
            }
        }
        _move(address(this), DEAD, id);
        emit BoughtBack(id, row.seller, row.quote);
    }

    function ownerOf(uint256 id) external view returns (address) {
        address owner = ownerOfId[id];
        require(owner != address(0), "id");
        return owner;
    }

    function balanceOf(address account) external view returns (uint256) {
        require(account != address(0), "zero");
        return bal[account];
    }

    function getApproved(uint256 id) external view returns (address) {
        require(ownerOfId[id] != address(0), "id");
        return approvedOf[id];
    }

    function isApprovedForAll(address account, address operator) external view returns (bool) {
        return ops[account][operator];
    }

    function approve(address spender, uint256 id) external {
        address owner = ownerOfId[id];
        require(msg.sender == owner || ops[owner][msg.sender], "auth");
        approvedOf[id] = spender;
        emit Approval(owner, spender, id);
    }

    function setApprovalForAll(address operator, bool ok) external {
        ops[msg.sender][operator] = ok;
        emit ApprovalForAll(msg.sender, operator, ok);
    }

    function transferFrom(address from, address to, uint256 id) external lock {
        _auth(from, id);
        _move(from, to, id);
    }

    function safeTransferFrom(address from, address to, uint256 id) external lock {
        _auth(from, id);
        _move(from, to, id);
        _check(from, to, id, "");
    }

    function safeTransferFrom(address from, address to, uint256 id, bytes calldata data) external lock {
        _auth(from, id);
        _move(from, to, id);
        _check(from, to, id, data);
    }

    function tokenURI(uint256 id) external view returns (string memory) {
        require(ownerOfId[id] != address(0), "id");
        if (bytes(baseUri).length == 0) return "";
        return string.concat(baseUri, _dec(id));
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 || id == 0x80ac58cd || id == 0x5b5e139f;
    }

    function vestReady(uint256 bucket, uint256 claimed) external view returns (uint256) {
        if (!closed || forfeit || highStreak < 3 || underCount != 0) return 0;
        if (block.timestamp < uint256(closedAt) + VEST) return 0;
        if (lastPokeDay + 1 < block.timestamp / 1 days) return 0;
        if (bucket <= claimed) return 0;
        return bucket - claimed;
    }

    function _vested(uint256 bucket) internal view returns (uint256) {
        if (!closed || forfeit || bucket == 0 || highStreak < 3 || underCount != 0) return 0;
        if (block.timestamp < uint256(closedAt) + VEST) return 0;
        if (lastPokeDay + 1 < block.timestamp / 1 days) return 0;
        return bucket;
    }

    function _book(uint256 tape, uint256 bem, uint256 okb) internal {
        if (tape > 0) {
            uint256 c = tape * 30 / 100;
            uint256 v = tape * 30 / 100;
            creatorTape += c;
            vestTape += v;
            vaultTape += tape - c - v;
        }
        if (bem > 0) {
            uint256 c = bem * 30 / 100;
            uint256 v = bem * 30 / 100;
            creatorBem += c;
            vestBem += v;
            vaultBem += bem - c - v;
        }
        if (okb > 0) {
            uint256 c = okb * 30 / 100;
            uint256 v = okb * 30 / 100;
            creatorOkb += c;
            vestOkb += v;
            vaultOkb += okb - c - v;
        }
    }

    function _split(uint256 price) internal pure returns (uint256 seller, uint256 plat, uint256 burn) {
        uint256 fee = price * 20 / 10_000;
        plat = fee / 2;
        burn = fee - plat;
        seller = price - fee;
    }

    function _roll() internal {
        uint256 today = block.timestamp / 1 days;
        if (today != day) {
            day = today;
            spentTape = 0;
            spentBem = 0;
            spentOkb = 0;
        }
    }

    function _quoteUnit() internal view returns (uint256) {
        if (mode == OKB) return unitOkb();
        return unitBem();
    }

    function _note(uint256 quote, bool add) internal {
        if (quote < _quoteUnit() * 2) {
            if (add) underCount += 1;
            else underCount -= 1;
        }
    }

    function _over2(uint256 id) internal view returns (bool) {
        Listing memory row = listings[id];
        if (row.seller == address(0)) return false;
        if (block.timestamp < uint256(row.at) + DELAY) return false;
        return row.quote >= _quoteUnit() * 2;
    }

    function _cap(uint256 basis) internal pure returns (uint256) {
        if (basis == 0) return 0;
        uint256 slice = basis / 90;
        return slice == 0 ? basis : slice;
    }

    function _take(uint256 basis, uint256 left) internal pure returns (uint256) {
        if (left == 0) return 0;
        uint256 slice = _cap(basis);
        if (slice == 0 || slice > left) return left;
        return slice;
    }

    function _approve(address token, address spender, uint256 amount) internal {
        (bool zeroOk, bytes memory zeroData) = token.call(abi.encodeWithSelector(0x095ea7b3, spender, uint256(0)));
        require(zeroOk && (zeroData.length == 0 || abi.decode(zeroData, (bool))), "approve");
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0x095ea7b3, spender, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "approve");
    }

    function _okbToBem(uint256 okbIn) internal returns (uint256 out) {
        require(okbIn > 0, "okb");
        IWOKB(WOKB).deposit{value: okbIn}();
        _approve(WOKB, ROUTER, okbIn);
        (uint160 sqrt,,,,,,) = IBemPool(BEM_POOL).slot0();
        require(sqrt > 0, "px");
        uint256 step = (okbIn << 96) / uint256(sqrt);
        uint256 mid = (step << 96) / uint256(sqrt);
        uint256 minOut = mid * 95 / 100;
        require(minOut > 0, "min");
        out = IRouter(ROUTER).exactInputSingle(
            IRouter.ExactInputSingleParams({
                tokenIn: WOKB,
                tokenOut: BEM,
                fee: 10_000,
                recipient: address(this),
                amountIn: okbIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );
    }

    function _bemToTape(uint256 bemIn) internal returns (uint256 out) {
        require(bemIn > 0, "bem");
        _approve(BEM, TAPE_POOL, bemIn);
        (uint256 tape, uint256 quote,) = ITapePool(TAPE_POOL).bemPool();
        require(quote > 0 && tape > 0, "pool");
        uint256 net = bemIn - (bemIn * 20 / 10_000);
        uint256 mid = (tape * net) / (quote + net);
        uint256 minOut = mid * 95 / 100;
        require(minOut > 0, "min");
        out = ITapePool(TAPE_POOL).swap(1, false, bemIn, minOut);
    }

    function _use(bytes32 trait) internal {
        require(trait != 0 && !traitUsed[trait], "trait");
        traitUsed[trait] = true;
    }

    function _mint(address to, uint256 id) internal {
        require(to != address(0) && ownerOfId[id] == address(0), "mint");
        ownerOfId[id] = to;
        bal[to] += 1;
        mintedCount += 1;
        emit Transfer(address(0), to, id);
        emit Minted(to, id);
    }

    function _auth(address from, uint256 id) internal view {
        address owner = ownerOfId[id];
        require(owner == from, "from");
        require(msg.sender == owner || msg.sender == approvedOf[id] || ops[owner][msg.sender], "auth");
    }

    function _move(address from, address to, uint256 id) internal {
        require(ownerOfId[id] == from && to != address(0), "move");
        delete approvedOf[id];
        ownerOfId[id] = to;
        bal[from] -= 1;
        bal[to] += 1;
        emit Transfer(from, to, id);
    }

    function _check(address from, address to, uint256 id, bytes memory data) internal {
        if (to.code.length == 0) return;
        (bool ok, bytes memory ret) = to.call(abi.encodeWithSelector(bytes4(0x150b7a02), msg.sender, from, id, data));
        require(ok && ret.length >= 32 && bytes4(ret) == bytes4(0x150b7a02), "receiver");
    }

    function _pull(address token, address from, address to, uint256 amount) internal {
        uint256 before = IERC20(token).balanceOf(to);
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0x23b872dd, from, to, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "pull");
        require(IERC20(token).balanceOf(to) - before == amount, "exact");
    }

    function _push(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "push");
    }

    function _okb(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        require(ok, "okb");
    }

    function _dec(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 n = value;
        uint256 len;
        while (n > 0) {
            len++;
            n /= 10;
        }
        bytes memory out = new bytes(len);
        while (value > 0) {
            len--;
            out[len] = bytes1(uint8(48 + value % 10));
            value /= 10;
        }
        return string(out);
    }
}

contract TapeLaunchFactory {
    address public constant TAPE = 0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3;
    address public constant BEM = 0x60e62Efa9405d6873C5deaBD4E6CC91c25363952;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant ONE_TAPE = 100_000_000;
    uint256 public constant SEED_BEM = 1_000_000;
    uint256 public constant SEED_OKB = 10 ** 16;

    address public immutable platform;
    uint256 public immutable okbSeed;
    bool public immutable buyback;
    uint256 private entered = 1;

    event Created(address indexed drop, address indexed creator, uint8 mode, uint32 multiplier, uint32 supply);

    constructor(address platform_, uint256 okbSeed_, bool buyback_) {
        require(platform_ != address(0), "platform");
        require(okbSeed_ > 0 && okbSeed_ <= 10 ether, "seed");
        platform = platform_;
        okbSeed = okbSeed_;
        buyback = buyback_;
    }

    function create(
        uint8 mode,
        uint32 multiplier,
        uint32 supply,
        uint32 reserve,
        string calldata name_,
        string calldata symbol_,
        string calldata base_
    ) external payable returns (address drop) {
        require(entered == 1, "reenter");
        entered = 2;
        require(mode == 1 || mode == 2 || mode == 3, "mode");
        require(multiplier >= 1 && multiplier <= 1_000_000, "mult");
        require(supply >= 1 && supply <= 100_000 && reserve <= supply, "supply");
        require(bytes(name_).length > 0 && bytes(name_).length <= 32, "name");
        require(bytes(symbol_).length > 0 && bytes(symbol_).length <= 16, "symbol");
        require(bytes(base_).length <= 128, "uri");
        uint256 value = okbSeed;
        if (mode == 2) value += SEED_OKB;
        require(msg.value == value, "value");
        TapeDrop born = new TapeDrop{value: msg.value}(
            msg.sender,
            platform,
            mode,
            multiplier,
            supply,
            reserve,
            buyback,
            name_,
            symbol_,
            base_
        );
        if (mode != 2) _pull(BEM, msg.sender, address(born), SEED_BEM);
        born.lockLaunchToken();
        _pull(TAPE, msg.sender, DEAD, ONE_TAPE);
        born.open();
        entered = 1;
        emit Created(address(born), msg.sender, mode, multiplier, supply);
        return address(born);
    }

    function _pull(address token, address from, address to, uint256 amount) internal {
        uint256 before = IERC20(token).balanceOf(to);
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0x23b872dd, from, to, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "pull");
        require(IERC20(token).balanceOf(to) - before == amount, "exact");
    }
}
