// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

interface IERC1155 {
    function balanceOf(address, uint256) external view returns (uint256);
    function safeTransferFrom(address, address, uint256, uint256, bytes calldata) external;
}

interface IPerp {
    function deals(uint256 id) external view returns (
        address long, address short, uint96 marginL, uint96 marginS, uint128 base, uint128 entry, bool open, uint16 levL, uint16 levS
    );
}

interface IGate {
    function deals(uint256 id) external view returns (
        address long, address short, uint8 market, uint96 marginL, uint96 marginS, uint128 base, uint128 entry, bool open, uint16 levL, uint16 levS
    );
}

/// NAND prize pool on X Layer. No admin.
/// A deposit is a share of what is left. Only that address withdraws its share.
/// Claims pay 10 NAND and shrink every share. They stop when the pool is empty.
contract NandGift {
    address public constant NAND = 0x3FA393d3081AcCff9E7989619B688235F6d3EE3F;
    address public constant BOOK = 0xBe686238D5467a3303F2FEBf14df5FD21F80ADe7;
    uint256 public constant ID = 0;
    uint256 public constant PAY = 10;
    uint256 public constant MAX = 5;
    uint256 public constant MIN = 5_000_000;

    uint256 public tracked;
    uint256 public totalShares;
    uint256 public epoch;
    mapping(address => uint256) public shares;
    mapping(address => uint256) public shareEpoch;
    mapping(address => uint256) public trades;
    mapping(address => uint256) public claimed;
    mapping(bytes32 => bool) private used;

    function balance() public view returns (uint256) {
        return IERC1155(NAND).balanceOf(address(this), ID);
    }

    function mine(address user) public view returns (uint256) {
        uint256 s = shareEpoch[user] == epoch ? shares[user] : 0;
        if (s == 0 || totalShares == 0 || tracked == 0) return 0;
        return s * tracked / totalShares;
    }

    function deposit(uint256 amount) external {
        require(amount > 0, "amt");
        uint256 beforeBal = balance();
        IERC1155(NAND).safeTransferFrom(msg.sender, address(this), ID, amount, "");
        uint256 got = balance() - beforeBal;
        require(got > 0, "got");
        _mint(msg.sender, got);
    }

    function withdraw(uint256 amount) external {
        uint256 have = mine(msg.sender);
        require(amount > 0 && amount <= have && amount <= tracked, "amt");
        uint256 s = shareEpoch[msg.sender] == epoch ? shares[msg.sender] : 0;
        uint256 burn = amount * totalShares / tracked;
        require(burn > 0 && burn <= s, "share");
        shares[msg.sender] = s - burn;
        totalShares -= burn;
        tracked -= amount;
        IERC1155(NAND).safeTransferFrom(address(this), msg.sender, ID, amount, "");
    }

    /// One X Layer perpetual fill. The caller's own margin must be at least 5 USDT0.
    function stamp(uint256 id) external {
        bytes32 key = keccak256(abi.encode(BOOK, id, msg.sender));
        require(!used[key], "used");
        (address long, address short, uint96 marginL, uint96 marginS,,,,,) = IPerp(BOOK).deals(id);
        uint256 margin;
        if (msg.sender == long) margin = marginL;
        else if (msg.sender == short) margin = marginS;
        else revert("side");
        require(margin >= MIN, "usd");
        used[key] = true;
        trades[msg.sender] += 1;
    }

    function claim() external {
        require(claimed[msg.sender] < MAX, "max");
        require(trades[msg.sender] > claimed[msg.sender], "trade");
        require(tracked >= PAY && balance() >= PAY, "empty");
        claimed[msg.sender] += 1;
        tracked -= PAY;
        IERC1155(NAND).safeTransferFrom(address(this), msg.sender, ID, PAY, "");
    }

    function _mint(address user, uint256 got) internal {
        if (tracked == 0) {
            epoch += 1;
            totalShares = got;
            tracked = got;
            shares[user] = got;
            shareEpoch[user] = epoch;
            return;
        }
        uint256 s = got * totalShares / tracked;
        require(s > 0, "share");
        if (shareEpoch[user] != epoch) {
            shares[user] = 0;
            shareEpoch[user] = epoch;
        }
        shares[user] += s;
        totalShares += s;
        tracked += got;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external view returns (bytes4) {
        require(msg.sender == NAND, "nand");
        return this.onERC1155Received.selector;
    }
}

/// BEM prize pool on BSC. No admin.
/// Same share rule. One address claims 0.1 BEM once, after more than 10 counted fills.
contract BemGift {
    address public constant BEM = 0x5ce033B2bFCa3Af30b3e8C8457DeaF776A8b695a;
    address public constant PERP = 0xce3511b6E909c9694826cFd5Dbe434d457920EBa;
    address public constant GATE = 0x58eaD5b41Cfd3627791D439402dd65571c286484;
    uint256 public constant PAY = 10_000_000;
    uint256 public constant NEED = 11;
    uint256 public constant MIN = 5 ether;

    uint256 public tracked;
    uint256 public totalShares;
    uint256 public epoch;
    mapping(address => uint256) public shares;
    mapping(address => uint256) public shareEpoch;
    mapping(address => uint256) public trades;
    mapping(address => bool) public claimed;
    mapping(bytes32 => bool) private used;

    function balance() public view returns (uint256) {
        return IERC20(BEM).balanceOf(address(this));
    }

    function mine(address user) public view returns (uint256) {
        uint256 s = shareEpoch[user] == epoch ? shares[user] : 0;
        if (s == 0 || totalShares == 0 || tracked == 0) return 0;
        return s * tracked / totalShares;
    }

    function deposit(uint256 amount) external {
        require(amount > 0, "amt");
        uint256 beforeBal = balance();
        _move(msg.sender, address(this), amount);
        uint256 got = balance() - beforeBal;
        require(got > 0, "got");
        _mint(msg.sender, got);
    }

    function withdraw(uint256 amount) external {
        uint256 have = mine(msg.sender);
        require(amount > 0 && amount <= have && amount <= tracked, "amt");
        uint256 s = shareEpoch[msg.sender] == epoch ? shares[msg.sender] : 0;
        uint256 burn = amount * totalShares / tracked;
        require(burn > 0 && burn <= s, "share");
        shares[msg.sender] = s - burn;
        totalShares -= burn;
        tracked -= amount;
        _move(address(this), msg.sender, amount);
    }

    function stampPerp(uint256 id) external {
        _stamp(PERP, id, true);
    }

    function stampGate(uint256 id) external {
        _stamp(GATE, id, false);
    }

    function claim() external {
        require(!claimed[msg.sender], "once");
        require(trades[msg.sender] >= NEED, "trade");
        require(tracked >= PAY && balance() >= PAY, "empty");
        claimed[msg.sender] = true;
        tracked -= PAY;
        _move(address(this), msg.sender, PAY);
    }

    function _stamp(address book, uint256 id, bool perp) internal {
        bytes32 key = keccak256(abi.encode(book, id, msg.sender));
        require(!used[key], "used");
        address long;
        address short;
        uint256 marginL;
        uint256 marginS;
        if (perp) (long, short, marginL, marginS,,,,,) = IPerp(book).deals(id);
        else (long, short,, marginL, marginS,,,,,) = IGate(book).deals(id);
        uint256 margin;
        if (msg.sender == long) margin = marginL;
        else if (msg.sender == short) margin = marginS;
        else revert("side");
        require(margin >= MIN, "usd");
        used[key] = true;
        trades[msg.sender] += 1;
    }

    function _mint(address user, uint256 got) internal {
        if (tracked == 0) {
            epoch += 1;
            totalShares = got;
            tracked = got;
            shares[user] = got;
            shareEpoch[user] = epoch;
            return;
        }
        uint256 s = got * totalShares / tracked;
        require(s > 0, "share");
        if (shareEpoch[user] != epoch) {
            shares[user] = 0;
            shareEpoch[user] = epoch;
        }
        shares[user] += s;
        totalShares += s;
        tracked += got;
    }

    function _move(address from, address to, uint256 amount) internal {
        bool ok;
        bytes memory data;
        if (from == address(this)) (ok, data) = BEM.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        else (ok, data) = BEM.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "bem");
    }
}
