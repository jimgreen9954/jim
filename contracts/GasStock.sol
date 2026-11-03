// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// One side of the OKB/BNB desk. It holds only the native coin of that chain.
/// No admin. The fee address is fixed. A funder takes back only their own unused balance.
/// A lot locks that balance for one taker and one hash. The taker collects it by showing
/// the preimage. After the deadline it returns to the funder's unused balance.
/// This contract does not mint a coin on the other chain.
contract GasStock {
    address public immutable feeTo;
    uint256 public constant CUT = 20;
    uint256 private entered;

    struct Lot {
        address maker;
        address taker;
        uint256 net;
        bytes32 key;
        uint64 expire;
        bool live;
    }

    uint256 public nextId = 1;
    mapping(uint256 => Lot) public lot;
    mapping(address => uint256) public spare;

    event Funded(address indexed who, uint256 amount);
    event Pulled(address indexed who, uint256 amount);
    event Opened(uint256 indexed id, address indexed maker, address indexed taker, uint256 net, bytes32 key, uint64 expire);
    event Filled(uint256 indexed id, address indexed taker, uint256 net);
    event Refunded(uint256 indexed id, address indexed maker, uint256 net);

    constructor(address feeTo_) {
        require(feeTo_ != address(0), "fee");
        feeTo = feeTo_;
    }

    modifier guard() {
        require(entered == 0, "re");
        entered = 1;
        _;
        entered = 0;
    }

    function fund() external payable guard {
        require(msg.value > 0, "amount");
        spare[msg.sender] += msg.value;
        emit Funded(msg.sender, msg.value);
    }

    function pull(uint256 amount) external guard {
        require(amount > 0 && amount <= spare[msg.sender], "amount");
        spare[msg.sender] -= amount;
        _send(msg.sender, amount);
        emit Pulled(msg.sender, amount);
    }

    function open(address taker, bytes32 key, uint64 expire) external payable guard returns (uint256 id) {
        require(taker != address(0) && key != bytes32(0), "who");
        require(expire > block.timestamp && expire <= block.timestamp + 2 days, "time");
        uint256 gross = msg.value;
        require(gross > 0, "amount");
        uint256 fee = gross * CUT / 10000;
        uint256 net = gross - fee;
        require(net > 0, "net");
        if (fee > 0) _send(feeTo, fee);
        id = nextId++;
        lot[id] = Lot(msg.sender, taker, net, key, expire, true);
        emit Opened(id, msg.sender, taker, net, key, expire);
    }

    function openSpare(address taker, bytes32 key, uint64 expire, uint256 net) external guard returns (uint256 id) {
        require(taker != address(0) && key != bytes32(0), "who");
        require(expire > block.timestamp && expire <= block.timestamp + 2 days, "time");
        require(net > 0 && net <= spare[msg.sender], "amount");
        spare[msg.sender] -= net;
        id = nextId++;
        lot[id] = Lot(msg.sender, taker, net, key, expire, true);
        emit Opened(id, msg.sender, taker, net, key, expire);
    }

    function fill(uint256 id, bytes32 secret) external guard {
        Lot memory row = lot[id];
        require(row.live && block.timestamp < row.expire, "open");
        require(keccak256(abi.encodePacked(secret)) == row.key, "key");
        lot[id].live = false;
        _send(row.taker, row.net);
        emit Filled(id, row.taker, row.net);
    }

    function refund(uint256 id) external guard {
        Lot memory row = lot[id];
        require(row.live && block.timestamp >= row.expire, "open");
        lot[id].live = false;
        spare[row.maker] += row.net;
        emit Refunded(id, row.maker, row.net);
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        require(ok, "send");
    }
}
