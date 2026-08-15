const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  PageBreak, LevelFormat, convertInchesToTwip, PositionalTab,
  PositionalTabAlignment, PositionalTabLeader, PositionalTabRelativeTo,
} = require("docx");
const fs = require("fs");

// ---- palette ----
const INK = "1A1A2E";
const ACCENT = "0E6E55";      // deep teal-green — infra / money
const ACCENT_DARK = "0A4F3D";
const MUTED = "5B6472";
const RULE = "D8DCE1";
const TAG_BG = "E8F3EF";
const WARN = "B23A2F";

const FONT = "Calibri";

function H1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 0, after: 200 },
    children: [new TextRun({ text, bold: true, size: 34, color: ACCENT_DARK, font: FONT })],
  });
}

function Kicker(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 40 },
    pageBreakBefore: !!opts.pageBreak,
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 18, color: ACCENT, font: FONT, characterSpacing: 20 })],
  });
}

function H2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 260, after: 120 },
    children: [new TextRun({ text, bold: true, size: 24, color: INK, font: FONT })],
  });
}

function P(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 140, line: 300 },
    children: Array.isArray(text) ? text : [new TextRun({ text, size: 21, color: INK, font: FONT, italics: !!opts.italics, bold: !!opts.bold })],
  });
}

function Lead(text) {
  return new Paragraph({
    spacing: { after: 220, line: 320 },
    children: [new TextRun({ text, size: 24, color: INK, font: FONT })],
  });
}

const bulletNumbering = {
  config: [
    {
      reference: "bullets",
      levels: [
        { level: 0, format: LevelFormat.BULLET, text: "–", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: convertInchesToTwip(0.28), hanging: convertInchesToTwip(0.18) } } } },
      ],
    },
  ],
};

function Bul(text, opts = {}) {
  const runs = Array.isArray(text)
    ? text
    : [new TextRun({ text, size: 21, color: INK, font: FONT })];
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { after: opts.after ?? 80, line: 280 },
    children: runs,
  });
}

function bold(text) {
  return new TextRun({ text, bold: true, size: 21, color: INK, font: FONT });
}
function norm(text) {
  return new TextRun({ text, size: 21, color: INK, font: FONT });
}
function accentBold(text) {
  return new TextRun({ text, bold: true, size: 21, color: ACCENT_DARK, font: FONT });
}

function rule() {
  return new Paragraph({
    spacing: { before: 60, after: 220 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 1 } },
    children: [],
  });
}

function tagRow(items) {
  // simple inline "tags" rendered as a table row of shaded cells
  return new Table({
    width: { size: 9600, type: WidthType.DXA },
    columnWidths: items.map(() => Math.floor(9600 / items.length)),
    borders: {
      top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({
        children: items.map((t) => new TableCell({
          width: { size: Math.floor(9600 / items.length), type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, color: "auto", fill: TAG_BG },
          margins: { top: 100, bottom: 100, left: 140, right: 140 },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: t, size: 18, bold: true, color: ACCENT_DARK, font: FONT })],
          })],
        })),
      }),
    ],
  });
}

function simpleTable(headers, rows, widths) {
  const total = 9600;
  const colWidths = widths || headers.map(() => Math.floor(total / headers.length));
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => new TableCell({
      width: { size: colWidths[i], type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, color: "auto", fill: ACCENT_DARK },
      margins: { top: 90, bottom: 90, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 18, color: "FFFFFF", font: FONT })] })],
    })),
  });
  const bodyRows = rows.map((r, ri) => new TableRow({
    children: r.map((c, i) => new TableCell({
      width: { size: colWidths[i], type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, color: "auto", fill: ri % 2 === 0 ? "FFFFFF" : "F4F6F5" },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({
        children: (Array.isArray(c) ? c : [c]).map((t) =>
          typeof t === "string" ? new TextRun({ text: t, size: 18, color: INK, font: FONT }) : t
        ),
      })],
    })),
  }));
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: colWidths,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      left: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      right: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: RULE },
    },
    rows: [headerRow, ...bodyRows],
  });
}

function calloutBox(label, text, color) {
  return new Table({
    width: { size: 9600, type: WidthType.DXA },
    columnWidths: [9600],
    borders: {
      top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.SINGLE, size: 24, color: color || ACCENT },
      right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({
        children: [new TableCell({
          width: { size: 9600, type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, color: "auto", fill: "F7F9F8" },
          margins: { top: 140, bottom: 140, left: 220, right: 220 },
          children: [
            new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: label, bold: true, size: 18, color: color || ACCENT_DARK, font: FONT })] }),
            new Paragraph({ spacing: {}, children: [new TextRun({ text, size: 20, color: INK, font: FONT })] }),
          ],
        })],
      }),
    ],
  });
}

function pageFooterNote() {
  return new Paragraph({ children: [] });
}

// =====================================================================
// CONTENT
// =====================================================================

const cover = [
  new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: "PITCH DECK", bold: true, size: 20, color: ACCENT, font: FONT, characterSpacing: 30 })] }),
  new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text: "Sponsored Compute", bold: true, size: 56, color: INK, font: FONT })],
  }),
  new Paragraph({
    spacing: { after: 260 },
    children: [new TextRun({ text: "Credit hạ tầng ràng buộc mục đích cho AI coding agent — Avalanche · XSGD · x402", size: 24, color: MUTED, font: FONT, italics: true })],
  }),
  rule(),
];

const sec1 = [
  Kicker("Vì sao dự án này ra đời"),
  H1("Hackathon tốn kém, giữ chân sai đối tượng"),
  Lead("Nền tảng dev-tool (database, monitoring, auth…) chi hàng chục nghìn đô mỗi năm để tài trợ hackathon, đổi lấy vài chục developer dùng thử trong 24–48 giờ. Khi sự kiện kết thúc, phần lớn quan hệ đó cũng kết thúc theo — không có cơ chế nào giữ credit chảy tiếp sau ngày đóng cổng."),
  H2("Trong khi đó, cách developer build sản phẩm đã đổi"),
  P([
    norm("Với "), bold("Claude Code, Codex, Cursor"),
    norm(" và các AI coding agent khác, một developer đi từ ý tưởng tới sản phẩm chạy được trong vài giờ, không phải vài tuần — cái gọi là "),
    bold("vibecoding"),
    norm(". Tốc độ build đã tăng vọt, nhưng tốc độ "), bold("tiếp cận hạ tầng"), norm(" (database, auth, monitoring…) vẫn đi theo mô hình cũ: đăng ký tài khoản, nhập thẻ tín dụng quốc tế, xin credit thủ công từ từng nhà cung cấp."),
  ]),
  P([
    norm("Đó là điểm nghẽn thật: agent build xong trong 10 phút, nhưng "), bold("cắm hạ tầng thật"), norm(" vẫn mất công sức của một con người ngồi điền form, quẹt thẻ, chờ duyệt — ở đúng chỗ mà agent lẽ ra có thể tự làm."),
  ]),
  H2("Sponsored Compute: kênh tài trợ hạ tầng chạy ngay trong agent"),
  Bul([norm("Sponsor ký quỹ stablecoin cho một "), bold("campaign"), norm(" — một lần, không phải một sự kiện.")]),
  Bul([norm("Agent của developer "), bold("tự phát hiện, tự claim, tự tiêu"), norm(" credit đó ngay trong lúc code — không rời terminal, không cần hackathon làm trung gian.")]),
  Bul([norm("Không cần "), bold("quan hệ hợp đồng riêng"), norm(" giữa mỗi sponsor và mỗi developer — hợp đồng nằm trong smart contract, không trong email pitch.")]),
  Bul([norm("Chi phí sponsor tỉ lệ với "), bold("usage thật"), norm(", đo bằng dấu vết on-chain — không phải một khoản tài trợ cố định đổ vào một sự kiện rồi biến mất.")]),
  calloutBox("SO SÁNH NGẮN", "Hackathon = tốn kém, một lần, giữ chân giả (chỉ trong khung sự kiện). Sponsored Compute = liên tục, on-chain, đo lường bằng usage thật, mở ra cho bất kỳ developer nào gõ “tôi cần database” vào agent của mình.", ACCENT),
];

const sec2 = [
  Kicker("Giải pháp", { pageBreak: true }),
  H1("Sponsored Compute là gì"),
  Lead("Một nền tảng dev-tool (sponsor) ký quỹ XSGD trên Avalanche cho một campaign. Developer nhận một Grant — XSGD bị bọc theo cơ chế PBM (Purpose Bound Money, ERC-7291), chỉ bung ra khi trả cho đúng merchant sponsor đã cho phép. Agent tiêu Grant đó bằng cách trả tiền usage qua x402, mỗi lần một khoản nhỏ, đúng lúc cần."),
  H2("Luồng cấp phát"),
  P("Sponsor nạp XSGD vào pool  →  Developer hỏi agent cần hạ tầng gì  →  Agent hiện danh sách có tài trợ + không tài trợ  →  Người dùng chọn  →  Grant (PBM voucher) được phát  →  Dịch vụ trả 402 theo usage  →  Grant unwrap → ký EIP-3009 → settle  →  Hết Grant → dừng dịch vụ, không âm thầm tính tiền dev."),
  H2("Ba tính chất khiến nó khác một hệ điểm thưởng thông thường"),
  Bul([accentBold("Tiền di chuyển thật. "), norm("Platform nhận được tài trợ từ sponsor mà không cần ký hợp đồng riêng — chỉ cần chấp nhận x402.")]),
  Bul([accentBold("Enforcement nằm trong công cụ thanh toán. "), norm("Trần chi, hạn dùng, danh sách merchant được phép nằm trong chính đồng tiền (on-chain), không nằm trong billing system nội bộ của từng platform.")]),
  Bul([accentBold("Xác thực bằng khoá, không bằng tài khoản. "), norm("Một cái máy — agent — tự đổi được credit, không cần con người đăng nhập từng nơi.")]),
  H2("Ba luật liêm chính danh sách — cam kết không thương lượng"),
  Bul([norm("Luôn hiện cả lựa chọn "), bold("không tài trợ"), norm(", đánh dấu rõ ràng số lượng mỗi bên.")]),
  Bul([bold("Không bao giờ bán thứ hạng"), norm(" — xếp theo độ phù hợp kỹ thuật; tài trợ chỉ là một nhãn hiển thị.")]),
  Bul([norm("Chỉ hiện danh sách khi "), bold("người dùng chủ động hỏi"), norm(" — agent không tự tạo ra nhu cầu để đẩy tài trợ.")]),
  calloutBox("VÌ SAO BA LUẬT NÀY QUAN TRỌNG", "Nếu agent gợi ý tool mà có tiền phía sau, sản phẩm đang bán lòng tin — và lòng tin chỉ bán được một lần. Đây là tài sản duy nhất phải giữ.", ACCENT),
];

const whyRows = [
  ["Avalanche C-Chain", "Finality ~1 giây, phí ~$0.001/giao dịch — đủ rẻ và đủ nhanh để trả theo phiên usage nhỏ lẻ thay vì gộp hoá đơn cuối tháng. Chạy thử trên Fuji (43113), sẵn đường lên mainnet (43114)."],
  ["XSGD", "Stablecoin SGD do tổ chức được MAS cấp phép phát hành (StraitsX). Credit tài trợ chính là XSGD thật — không cần ledger quy đổi riêng, không có vòng đóng sổ. Hỗ trợ sẵn EIP-3009 (transferWithAuthorization) nên agent ký được off-chain và x402 settle trực tiếp."],
  ["x402", "Giao thức HTTP 402 cho phép agent trả tiền theo usage mà không cần tài khoản, không cần API key, không cần thẻ — đúng mô hình pay-as-you-go mà một AI agent cần để tự vận hành hạ tầng."],
  ["0xGasless", "Facilitator công khai đã verify hỗ trợ Fuji + XSGD, không cần API key, tự trả gas cho giao dịch thanh toán — agent không cần giữ AVAX riêng để chi trả mỗi lần settle. Đi kèm ERC-8004 cho danh tính agent on-chain."],
];

const sec3 = [
  Kicker("Lựa chọn công nghệ", { pageBreak: true }),
  H1("Vì sao Avalanche · XSGD · 0xGasless · x402"),
  Lead("Bốn mảnh ghép này không phải lựa chọn ngẫu nhiên trong một cuộc thi — mỗi mảnh giải đúng một ràng buộc mà mô hình “credit tài trợ chảy qua agent” bắt buộc phải có."),
  simpleTable(["Thành phần", "Vì sao chọn"], whyRows, [2300, 7300]),
  H2("Mảnh ghép còn thiếu mà cả bốn cái trên không tự giải: ràng buộc mục đích"),
  P([
    norm("x402 cho agent tiêu tiền mà "), bold("không ràng buộc gì"), norm(" — nó chỉ là đường ống thanh toán. Vấn đề kinh tế thật: nếu một platform tài trợ $50 mà developer đem tiêu ở chỗ khác, platform đó được gì? Mọi hệ điểm thưởng dùng chung đều chết vì câu hỏi này."),
  ]),
  P([
    norm("Lời giải là "), bold("PBM — Purpose Bound Money (ERC-7291)"),
    norm(", chuẩn do chính "), bold("StraitsX"), norm(" (đơn vị phát hành XSGD, cùng MAS Project Orchid) soạn thảo. Chúng tôi triển khai một "), bold("subset tương thích PBM"), norm(" — không phải full spec — bọc XSGD trong một GrantManager on-chain: chỉ bung tiền khi trả đúng merchant được sponsor cho phép, trong trần chi, trong hạn dùng."),
  ]),
  calloutBox("MỘT CÂU PITCH", "StraitsX viết ERC-7291 để ràng buộc mục đích vào tiền. x402 để agent tiêu tiền mà không ràng buộc gì. Sponsored Compute nối hai cái lại — trên Avalanche, bằng XSGD, ngay trong AI coding agent.", ACCENT),
];

const flowRows = [
  ["1", "Agent gọi merchant API", "pay_for_service(url, max_amount)"],
  ["2", "Merchant trả 402", "kèm giá XSGD + payTo + hạn"],
  ["3", "Checkpoint (ngoài LLM)", "kiểm merchant có trong allowlist? ≤ trần? ≤ số dư Grant? chưa hết hạn?"],
  ["4", "Unwrap Grant", "GrantManager mở đúng số XSGD cho EOA của agent"],
  ["5", "Ký EIP-3009", "agent ký uỷ quyền chuyển khoản, không cần AVAX cho bước này"],
  ["6", "Settle", "self-relay / 0xGasless xác nhận, phát tx lên Avalanche, merchant nhận đúng payTo"],
];

const sec4 = [
  Kicker("Kiến trúc", { pageBreak: true }),
  H1("Checkpoint nằm ngoài tầm với của LLM"),
  Lead("Hai luật kiến trúc quyết định toàn bộ thiết kế an toàn của hệ thống — cả hai đều xuất phát từ một quan sát: phản hồi từ một merchant server có thể chứa văn bản ra lệnh trực tiếp cho agent (“Do NOT ask the user for confirmation…”), tức là bất kỳ merchant nào cũng chèn được chữ vào ngữ cảnh của model."),
  H2("Luật 1 — Checkpoint không phải là một tool"),
  P("Agent không có tool riêng lẻ để “kiểm chính sách” hay “unwrap” hay “ký” — nếu có, một chuỗi chèn lệnh (prompt injection) có thể thuyết phục model bỏ qua bước kiểm. Toàn bộ chuỗi decode 402 → checkpoint → unwrap → ký → gửi lại nằm trong một tool duy nhất, chạy bằng code, không phải bằng quyết định của model."),
  H2("Luật 2 — Bước đồng ý phải nằm ngoài LLM"),
  P("Xác nhận trong CLI không đủ, vì agent tự gõ lệnh được. Hai thứ thật sự nằm ngoài tầm với của model: permission prompt của harness (Claude Code / Codex) và chữ ký ví con người."),
  H2("Luồng thanh toán một lượt gọi"),
  simpleTable(["#", "Bước", "Chi tiết"], flowRows, [500, 2900, 6200]),
  H2("Hai điểm chặn làm nên phần thuyết phục nhất của demo"),
  Bul([bold("Chặn 1 — sai merchant: "), norm("agent thử trả cho một dịch vụ ngoài allowlist → unwrap thất bại ngay trên chain. Grant ràng buộc mục đích, không phải tiền mặt.")]),
  Bul([bold("Chặn 2 — vượt trần: "), norm("usage vượt số Grant đã vest → dịch vụ dừng lại, không âm thầm cộng dồn hoá đơn cho developer.")]),
  calloutBox("RỦI RO ĐÃ LƯỜNG TRƯỚC", "Hạ tầng như database chạy 24/7 — nếu sponsor cấp $50 mà agent tự provision thứ tốn $200/tháng, ai trả phần dư? Vì vậy trần chi phải dừng hẳn dịch vụ, không chỉ dừng credit, kèm cảnh báo ở 80% và 95% mức dùng.", WARN),
];

const tierRows = [
  ["Tier 0 — chỉ nạp tiền", "~15 phút", "Nạp XSGD, đăng ký payTo, tạo campaign", "Rail thẻ ảo (platform không cần biết x402)"],
  ["Tier 1 — bật x402", "~1 giờ", "Thêm một đoạn middleware vào API sẵn có", "x402 trực tiếp"],
  ["Tier 2 — repo mẫu", "~nửa ngày", "Ship template repo có .mcp.json + endpoint cấp projectId", "x402 + tranche tự động lớn hơn"],
];

const sec5 = [
  Kicker("Go-to-market", { pageBreak: true }),
  H1("Vì sao một nền tảng infra chọn kênh này thay vì hackathon"),
  Lead("Người trả tiền là các nền tảng dev-tool (database, auth, monitoring, observability…) đang cạnh tranh để có developer dùng thử sớm. Thay vì đốt một khoản tài trợ cố định cho một sự kiện 24–48 giờ, họ ký quỹ credit chảy liên tục, đo lường bằng usage thật thay vì lời hứa."),
  H2("Ba mức onboarding — mỗi mức dùng được độc lập, không mức nào bắt buộc phải viết nhiều code"),
  simpleTable(["Mức", "Công sức", "Sponsor cần làm", "Agent trả bằng"], tierRows, [2000, 1300, 3400, 2900]),
  H2("Vì sao rẻ hơn và bám hơn hackathon"),
  Bul([norm("Không cần đàm phán hợp đồng với từng developer — chỉ cần chấp nhận x402 hoặc đơn giản hơn là nạp tiền vào pool (Tier 0).")]),
  Bul([norm("Chi phí tỉ lệ thuận với usage thật đã xác minh on-chain, không phải một khoản ngân sách sự kiện chốt trước.")]),
  Bul([norm("Credit gắn liền với dự án thật (chống farm) và nhả dần theo tranche dựa trên dấu vết thanh toán — sponsor chỉ trả tiếp khi developer thật sự dùng.")]),
  Bul([norm("Kênh phân phối là chính AI coding agent mà developer đã mở sẵn khi làm việc — không cần landing page riêng, không cần booth sự kiện.")]),
  calloutBox("KHÁC GÌ CREDIT KIỂU AWS ACTIVATE", "Credit thông thường là một lời hứa nằm trong database của một nhà cung cấp, chỉ người đổi được. Sponsored Compute là một tài sản đã ký quỹ, dùng được cho nhiều nhà cung cấp, và một cái máy (agent) tự đổi được — đúng mô hình cho thế giới nhiều sponsor, nhiều platform, người đổi là AI.", ACCENT),
];

const tractionRows = [
  ["Smart contracts", "MerchantRegistry + GrantManager triển khai trên Avalanche Fuji (43113); registry chấp thuận merchant, Grant thực thi allowlist, trần chi, hạn dùng, thu hồi on-chain."],
  ["Merchant đã đăng ký", "SupaDB (database), NeonLite (database), SentryWatch (monitoring) — đủ đa dạng để demo danh sách có/không tài trợ."],
  ["CLI + MCP server", "5 tool cho agent: list_sponsored_platforms, check_project_sponsorship, claim_sponsored_grant, get_grant_status, pay_for_service — ví agent tạo tự động, khoá lưu trong OS keychain, không lộ vào context model."],
  ["Web console (Next.js)", "Trang sponsor tạo/nạp campaign, trang merchant xem lịch sử settlement, API x402-protected mẫu (/api/v1/query), triển khai được thẳng lên Vercel."],
  ["Lưu trữ & chống replay", "Supabase lưu lịch sử thanh toán, campaign, Grant đã claim — atomic ở tầng serverless, cần thiết để chống replay nonce khi chạy nhiều instance."],
  ["Kiểm thử", "Bộ test cho checkpoint, signer, relay và contract (Hardhat) chạy qua npm test; typecheck riêng cho core và MCP."],
];

const sec6 = [
  Kicker("Traction", { pageBreak: true }),
  H1("Đã build, không chỉ là slide"),
  Lead("Toàn bộ vòng đã chạy được đầu-cuối trên Avalanche Fuji: Grant phát trên chain → checkpoint xác minh → unwrap → ký EIP-3009 → settle → giao dịch xem được trên Snowtrace."),
  simpleTable(["Hạng mục", "Trạng thái"], tractionRows, [2400, 7200]),
  H2("Cấu trúc repo"),
  P([
    accentBold("contracts/  "), norm("Solidity + Hardhat  ·  "),
    accentBold("src/  "), norm("Grant, checkpoint, signer, relay, CLI  ·  "),
    accentBold("mcp/  "), norm("MCP server cho coding agent  ·  "),
    accentBold("web/  "), norm("sponsor console, merchant dashboard, API routes  ·  "),
    accentBold("web/supabase/  "), norm("schema cho registry và lịch sử thanh toán"),
  ]),
];

const askRows = [
  ["Cầu nối ngoài x402", "Hoàn thiện rail thẻ ảo cho platform chưa hỗ trợ x402, để credit vẫn tiêu được ở bất kỳ nơi nào nhận thẻ."],
  ["Chuyển mainnet", "Từ Fuji (43113) sang Avalanche C-Chain mainnet (43114) khi có thanh khoản XSGD thật và đã qua review bảo mật."],
  ["Escrow hai pha", "Đóng khoảng trống giữa unwrap và settle để production không phụ thuộc vào giả định “agent luôn trả lại đúng”."],
  ["Đối tác sponsor thật", "Tuyển thêm 2–3 nền tảng dev-tool làm design partner để kiểm chứng mô hình ba tầng onboarding ngoài môi trường demo."],
];

const sec7 = [
  Kicker("Roadmap & Ask", { pageBreak: true }),
  H1("Việc tiếp theo"),
  simpleTable(["Việc cần làm", "Vì sao"], askRows, [2600, 7000]),
  H2("Điều chúng tôi đang xin"),
  Bul([norm("Nhà tài trợ hạ tầng sẵn sàng thử Tier 0 (chỉ nạp tiền, ~15 phút) để kiểm chứng vòng lặp campaign → claim → usage → vesting với developer thật.")]),
  Bul([norm("Phản hồi kỹ thuật về mức độ tương thích PBM subset với ERC-7291 đầy đủ, từ đội đã đọc reference implementation.")]),
  Bul([norm("Kết nối tới thanh khoản XSGD mainnet và một vòng security review trước khi rời testnet.")]),
  rule(),
  P([norm("Liên hệ: "), bold("kurodenjiro1@gmail.com"), norm("   ·   Repo: "), norm("x402-hack")], { after: 0 }),
];

const doc = new Document({
  numbering: bulletNumbering,
  styles: {
    default: {
      document: { run: { font: FONT, size: 21, color: INK } },
    },
  },
  sections: [
    {
      properties: {
        page: {
          margin: { top: 900, bottom: 900, left: 1000, right: 1000 },
        },
      },
      children: [
        ...cover,
        ...sec1,
        ...sec2,
        ...sec3,
        ...sec4,
        ...sec5,
        ...sec6,
        ...sec7,
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(__dirname + "/Sponsored-Compute-Pitch.docx", buf);
  console.log("written");
});
