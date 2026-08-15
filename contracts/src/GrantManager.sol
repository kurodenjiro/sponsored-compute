// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MerchantRegistry} from "./MerchantRegistry.sol";

interface IERC20 {
    function transferFrom(address from, address to, uint256 v) external returns (bool);
    function transfer(address to, uint256 v) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
}

/**
 * GrantManager — PBM-compatible subset của ERC-7291.
 *
 * ⚠️ KHÔNG phải full ERC-7291. Phải tuyên bố rõ khi trình bày — StraitsX là
 * tác giả chuẩn, nói quá là bị phát hiện ngay.
 *
 * Ánh xạ ERC-7291:
 *   sovToken        = XSGD (ERC-20)
 *   PBM wrapper     = contract này (giữ XSGD, phát Grant)
 *   compliance guard= _checkUnwrap()
 *   token manager   = MerchantRegistry
 *
 * Khác biệt so với credit thường / Crossmint Scopes / starter kit Ava Labs:
 *   - bên THỨ BA (sponsor) cấp tiền, không phải chủ ví tự giới hạn mình
 *   - vesting theo tranche, xác minh bằng chính dòng chi tiêu on-chain
 *   - sponsor revoke được bất cứ lúc nào
 *   - non-transferable
 *
 * ⚠️ Gộp SponsorPool vào đây (khác §7.1 của doc) để giảm bề mặt lỗi trong
 * thời gian hackathon. Một contract, một nguồn sự thật.
 */
contract GrantManager {
    // ------------------------------------------------------------------ types

    struct Campaign {
        address sponsor;
        bytes32 merchantId;
        uint256 funded;             // XSGD đã nạp
        uint256 committed;          // đã cam kết cho các Grant
        uint256 grantAmount;        // mỗi Grant bao nhiêu
        uint32  trancheCount;
        uint32  tranchePeriod;      // giây
        uint256 minSpendPerTranche; // phải tiêu bao nhiêu mới mở tranche kế
        uint32  minDaysPerTranche;
        uint64  grantValidity;      // giây, tính từ lúc phát
        uint256 perTxCap;
        uint256 dailyCap;
        address attestor;           // ký projectId (Tier 2). address(0) = Tier 0/1
        bool    paused;
    }

    struct Grant {
        bytes32 campaignId;
        bytes32 merchantId;
        bytes32 projectId;
        address owner;   // developer
        address signer;  // EOA của agent — nhận XSGD rồi ký EIP-3009
        uint256 total;
        uint256 released;
        uint256 spent;
        uint32  trancheClaimed;
        uint32  daysUsed;
        uint64  issuedAt;
        uint64  expiry;
        bool    revoked;
    }

    // ----------------------------------------------------------------- storage

    IERC20 public immutable xsgd;
    MerchantRegistry public immutable registry;

    mapping(bytes32 => Campaign) public campaigns;
    mapping(uint256 => Grant) public grants;
    /// một projectId chỉ được MỘT Grant — fork repo không nhân bản được tiền
    mapping(bytes32 => uint256) public grantIdOfProject;
    mapping(uint256 => mapping(uint256 => uint256)) public spentOnDay; // grantId => day => amount
    mapping(uint256 => mapping(uint256 => bool)) public dayCounted;
    mapping(uint256 => uint256) public spentAtTranche; // grantId => spent tại lần claim trước

    uint256 public nextGrantId = 1;

    // ------------------------------------------------------------------ events

    event CampaignCreated(bytes32 indexed id, address indexed sponsor, bytes32 indexed merchantId);
    event Funded(bytes32 indexed id, uint256 amount, uint256 total);
    event CampaignPaused(bytes32 indexed id, bool paused);
    event GrantIssued(uint256 indexed grantId, bytes32 indexed campaignId, bytes32 indexed projectId, address owner, address signer, uint256 total);
    /// Dấu vết attribution — dùng để đối soát usage theo dự án (thay cho payTo riêng từng project)
    event Unwrapped(uint256 indexed grantId, bytes32 indexed projectId, address indexed payTo, uint256 amount, bytes32 nonce);
    event TrancheClaimed(uint256 indexed grantId, uint32 tranche, uint256 released);
    event GrantRevoked(uint256 indexed grantId, uint256 returned);

    // ------------------------------------------------------------------ errors

    error NotSponsor();
    error NotOwnerOfGrant();
    error CampaignPausedErr();
    error InsufficientCampaignFunds();
    error ProjectAlreadyGranted();
    error GrantRevokedErr();
    error GrantExpired();
    error MerchantNotAllowed();
    error OverPerTxCap();
    error OverDailyCap();
    error OverVested();
    error TrancheNotReady();
    error TrancheSpendTooLow();
    error TrancheDaysTooLow();
    error AllTranchesClaimed();
    error ZeroAmount();

    constructor(address _xsgd, address _registry) {
        xsgd = IERC20(_xsgd);
        registry = MerchantRegistry(_registry);
    }

    // ---------------------------------------------------------------- sponsor

    function createCampaign(bytes32 id, Campaign calldata c) external {
        require(campaigns[id].sponsor == address(0), "campaign exists");
        require(c.trancheCount > 0, "trancheCount=0");
        require(c.grantAmount > 0, "grantAmount=0");
        Campaign storage s = campaigns[id];
        s.sponsor = msg.sender;
        s.merchantId = c.merchantId;
        s.grantAmount = c.grantAmount;
        s.trancheCount = c.trancheCount;
        s.tranchePeriod = c.tranchePeriod;
        s.minSpendPerTranche = c.minSpendPerTranche;
        s.minDaysPerTranche = c.minDaysPerTranche;
        s.grantValidity = c.grantValidity;
        s.perTxCap = c.perTxCap;
        s.dailyCap = c.dailyCap;
        s.attestor = c.attestor;
        emit CampaignCreated(id, msg.sender, c.merchantId);
    }

    function fund(bytes32 id, uint256 amount) external {
        Campaign storage c = campaigns[id];
        require(c.sponsor != address(0), "no campaign");
        if (amount == 0) revert ZeroAmount();
        require(xsgd.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        c.funded += amount;
        emit Funded(id, amount, c.funded);
    }

    function setPaused(bytes32 id, bool p) external {
        Campaign storage c = campaigns[id];
        if (msg.sender != c.sponsor) revert NotSponsor();
        c.paused = p;
        emit CampaignPaused(id, p);
    }

    function withdrawUnused(bytes32 id) external {
        Campaign storage c = campaigns[id];
        if (msg.sender != c.sponsor) revert NotSponsor();
        uint256 free = c.funded - c.committed;
        c.funded -= free;
        require(xsgd.transfer(c.sponsor, free), "transfer failed");
    }

    // ------------------------------------------------------------ issue grant

    /**
     * Phát Grant. Một projectId — một Grant, vĩnh viễn.
     * Người khác clone repo có sẵn projectId sẽ bị chặn ở đây.
     */
    function issueGrant(bytes32 campaignId, bytes32 projectId, address owner_, address signer_)
        external
        returns (uint256 grantId)
    {
        Campaign storage c = campaigns[campaignId];
        require(c.sponsor != address(0), "no campaign");
        if (c.paused) revert CampaignPausedErr();
        if (grantIdOfProject[projectId] != 0) revert ProjectAlreadyGranted();
        if (c.funded - c.committed < c.grantAmount) revert InsufficientCampaignFunds();

        c.committed += c.grantAmount;
        grantId = nextGrantId++;

        uint256 firstTranche = c.grantAmount / c.trancheCount;
        grants[grantId] = Grant({
            campaignId: campaignId,
            merchantId: c.merchantId,
            projectId: projectId,
            owner: owner_,
            signer: signer_,
            total: c.grantAmount,
            released: firstTranche,
            spent: 0,
            trancheClaimed: 1,
            daysUsed: 0,
            issuedAt: uint64(block.timestamp),
            expiry: uint64(block.timestamp) + c.grantValidity,
            revoked: false
        });
        grantIdOfProject[projectId] = grantId;

        emit GrantIssued(grantId, campaignId, projectId, owner_, signer_, c.grantAmount);
    }

    // ---------------------------------------------------------------- unwrap

    /**
     * Compliance guard — bản on-chain của checkpoint.
     * Nhả ĐÚNG `amount` XSGD sang `signer` ngay trước khi ký EIP-3009.
     *
     * ⚠️ Khoảng trống đã biết (§13.2): signer có thể nhận XSGD rồi không trả.
     *    Thiệt hại chặn ở perTxCap/dailyCap/released. Production cần escrow hai pha.
     */
    function unwrap(uint256 grantId, address payTo, uint256 amount, bytes32 nonce) external {
        Grant storage g = grants[grantId];
        Campaign storage c = campaigns[g.campaignId];
        if (msg.sender != g.signer && msg.sender != g.owner) revert NotOwnerOfGrant();
        if (amount == 0) revert ZeroAmount();
        if (g.revoked) revert GrantRevokedErr();
        if (block.timestamp >= g.expiry) revert GrantExpired();
        if (c.paused) revert CampaignPausedErr();

        // allowlist: nguồn sự thật là registry, KHÔNG phải challenge của merchant
        if (!registry.isAllowed(g.merchantId, payTo)) revert MerchantNotAllowed();

        if (amount > c.perTxCap) revert OverPerTxCap();

        uint256 day = block.timestamp / 1 days;
        if (spentOnDay[grantId][day] + amount > c.dailyCap) revert OverDailyCap();
        if (g.spent + amount > g.released) revert OverVested();

        if (!dayCounted[grantId][day]) {
            dayCounted[grantId][day] = true;
            g.daysUsed += 1;
        }
        spentOnDay[grantId][day] += amount;
        g.spent += amount;

        require(xsgd.transfer(g.signer, amount), "transfer failed");
        emit Unwrapped(grantId, g.projectId, payTo, amount, nonce);
    }

    // --------------------------------------------------------------- vesting

    /// Điều kiện nhả tranche xác minh HOÀN TOÀN bằng state on-chain — không cần oracle.
    function claimTranche(uint256 grantId) external {
        Grant storage g = grants[grantId];
        Campaign storage c = campaigns[g.campaignId];
        if (g.revoked) revert GrantRevokedErr();
        if (g.trancheClaimed >= c.trancheCount) revert AllTranchesClaimed();
        if (block.timestamp < g.issuedAt + uint256(g.trancheClaimed) * c.tranchePeriod) {
            revert TrancheNotReady();
        }
        if (g.spent - spentAtTranche[grantId] < c.minSpendPerTranche) revert TrancheSpendTooLow();
        if (g.daysUsed < c.minDaysPerTranche * g.trancheClaimed) revert TrancheDaysTooLow();

        spentAtTranche[grantId] = g.spent;
        g.trancheClaimed += 1;
        uint256 add = g.total / c.trancheCount;
        g.released += add;
        emit TrancheClaimed(grantId, g.trancheClaimed, g.released);
    }

    // --------------------------------------------------------------- revoke

    /// Sponsor thu hồi phần chưa tiêu — hiệu lực NGAY.
    function revokeGrant(uint256 grantId) external {
        Grant storage g = grants[grantId];
        Campaign storage c = campaigns[g.campaignId];
        if (msg.sender != c.sponsor) revert NotSponsor();
        if (g.revoked) revert GrantRevokedErr();
        g.revoked = true;
        uint256 unspent = g.total - g.spent;
        c.committed -= unspent;
        emit GrantRevoked(grantId, unspent);
    }

    // ----------------------------------------------------------------- views

    /// Khớp ABI mà src/grant.ts đọc.
    function grantOf(bytes32 projectId)
        external
        view
        returns (
            uint256 grantId, bytes32 merchantId, address signer,
            uint256 total, uint256 released, uint256 spent, uint256 spentToday,
            uint256 perTxCap, uint256 dailyCap, uint64 expiry, bool revoked
        )
    {
        grantId = grantIdOfProject[projectId];
        if (grantId == 0) return (0, bytes32(0), address(0), 0, 0, 0, 0, 0, 0, 0, false);
        Grant storage g = grants[grantId];
        Campaign storage c = campaigns[g.campaignId];
        return (
            grantId, g.merchantId, g.signer,
            g.total, g.released, g.spent, spentOnDay[grantId][block.timestamp / 1 days],
            c.perTxCap, c.dailyCap, g.expiry, g.revoked || c.paused
        );
    }

    function allowedPayTo(uint256 grantId) external view returns (address[] memory out) {
        Grant storage g = grants[grantId];
        address p = registry.payToOf(g.merchantId);
        // Return the same allowlist state that unwrap() enforces. A deactivated
        // merchant must disappear from client-side checkpoint data immediately.
        bool allowed = p != address(0) && registry.isAllowed(g.merchantId, p);
        out = new address[](allowed ? 1 : 0);
        if (allowed) out[0] = p;
    }
}
