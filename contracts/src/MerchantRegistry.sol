// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * MerchantRegistry — danh sách nền tảng được nhận tiền từ Grant.
 *
 * 🔴 PHẢI CÓ KIỂM DUYỆT. Nếu ai cũng tự đăng ký được thì attacker đăng ký
 * chính ví mình làm merchant rồi unwrap Grant về đó → sập toàn bộ mô hình.
 * (SPONSORED-COMPUTE.md §9)
 */
contract MerchantRegistry {
    struct Merchant {
        address payTo;
        bool active;
        string name;
        bytes32 category; // "database", "auth", "monitoring"...
    }

    address public owner;
    mapping(bytes32 => Merchant) public merchants;

    event MerchantRegistered(bytes32 indexed id, address indexed payTo, string name, bytes32 category);
    event MerchantDeactivated(bytes32 indexed id);
    event OwnerChanged(address indexed from, address indexed to);

    error NotOwner();
    error ZeroPayTo();
    error AlreadyRegistered();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function transferOwnership(address to) external onlyOwner {
        emit OwnerChanged(owner, to);
        owner = to;
    }

    function register(bytes32 id, address payTo, string calldata name, bytes32 category)
        external
        onlyOwner
    {
        if (payTo == address(0)) revert ZeroPayTo();
        if (merchants[id].payTo != address(0)) revert AlreadyRegistered();
        merchants[id] = Merchant({payTo: payTo, active: true, name: name, category: category});
        emit MerchantRegistered(id, payTo, name, category);
    }

    function deactivate(bytes32 id) external onlyOwner {
        merchants[id].active = false;
        emit MerchantDeactivated(id);
    }

    /// Nguồn sự thật cho allowlist. GrantManager gọi hàm này — KHÔNG tin payTo từ challenge.
    function isAllowed(bytes32 id, address payTo) external view returns (bool) {
        Merchant storage m = merchants[id];
        return m.active && m.payTo != address(0) && m.payTo == payTo;
    }

    function payToOf(bytes32 id) external view returns (address) {
        return merchants[id].payTo;
    }
}
