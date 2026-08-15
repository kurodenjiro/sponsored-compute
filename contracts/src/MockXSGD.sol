// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * XSGD giả — CHỈ dùng cho unit test trên mạng local.
 * KHÔNG deploy lên Fuji/mainnet: ở đó dùng XSGD thật của StraitsX.
 *
 * Cố ý KHÔNG implement ERC-1271, giống hệt XSGD thật (đã đọc bytecode:
 * impl 0x3f811bb6e605ef518b0cd9281eb4d9ad88a3953f không có selector 1626ba7e).
 */
contract MockXSGD {
    string public constant name = "XSGD";
    string public constant symbol = "XSGD";
    uint8 public constant decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 v) external {
        balanceOf[to] += v;
        emit Transfer(address(0), to, v);
    }

    function approve(address spender, uint256 v) external returns (bool) {
        allowance[msg.sender][spender] = v;
        emit Approval(msg.sender, spender, v);
        return true;
    }

    function transfer(address to, uint256 v) external returns (bool) {
        require(balanceOf[msg.sender] >= v, "insufficient");
        balanceOf[msg.sender] -= v;
        balanceOf[to] += v;
        emit Transfer(msg.sender, to, v);
        return true;
    }

    function transferFrom(address from, address to, uint256 v) external returns (bool) {
        require(balanceOf[from] >= v, "insufficient");
        uint256 a = allowance[from][msg.sender];
        require(a >= v, "not allowed");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - v;
        balanceOf[from] -= v;
        balanceOf[to] += v;
        emit Transfer(from, to, v);
        return true;
    }
}
