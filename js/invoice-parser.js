// Parser for Taiwan 電子發票 (e-invoice) left/right QR code strings.
//
// Field layout verified 2026-08 against 財政部財政資訊中心公告
// 「電子發票證明聯一維及二維條碼規格說明」(v1.8/1.9) via a worked example
// (real invoice string decoded field-by-field) rather than from memory.
// Multi-item invoices and non-UTF8 encodings were NOT verified against a
// real scan — if a real invoice fails to parse, check HEADER_LEN math and
// the item-triplet grouping below against that specific invoice first.
//
// Left QR = 77-char fixed-width header, then ':'-separated extension fields:
//   [0..10)  invoiceNumber   10 chars, e.g. "ZJ71292204"
//   [10..17) issueDate       7 chars: 民國年(3) + 月(2) + 日(2)
//   [17..21) randomCode      4 digits
//   [21..29) salesAmountHex  8 hex chars, untaxed amount
//   [29..37) totalAmountHex  8 hex chars, amount incl. tax
//   [37..45) buyerTaxId      8 digits ("00000000" = consumer)
//   [45..53) sellerTaxId     8 digits
//   [53..77) verifyInfo      24 chars, AES+Base64, opaque (not decrypted here)
// then ':'-joined: sellerUseArea, qrItemCount, totalItemCount, encoding(0=Big5/1=UTF8/2=Base64),
//   followed by qrItemCount repeats of (name, qty, unitPrice), optional trailing note.
//
// Right QR (when present) carries overflow items for invoices with more
// line items than fit in the left QR's extension area — same
// (name, qty, unitPrice) triplet grouping, colon-separated, no header.

const HEADER_LEN = 77;

function rocDateToISO(d7) {
  if (!/^\d{7}$/.test(d7)) return null;
  const rocYear = parseInt(d7.slice(0, 3), 10);
  const month = d7.slice(3, 5);
  const day = d7.slice(5, 7);
  const adYear = rocYear + 1911;
  if (month < '01' || month > '12' || day < '01' || day > '31') return null;
  return `${adYear}-${month}-${day}`;
}

function hexToInt(hex8) {
  if (!/^[0-9A-Fa-f]{8}$/.test(hex8)) return null;
  return parseInt(hex8, 16);
}

function parseItemTriples(tokens) {
  const items = [];
  for (let i = 0; i + 2 < tokens.length; i += 3) {
    const name = tokens[i];
    const qty = Number(tokens[i + 1]);
    const unitPrice = Number(tokens[i + 2]);
    if (name === undefined || Number.isNaN(qty) || Number.isNaN(unitPrice)) break;
    items.push({ name, qty, unitPrice });
  }
  return items;
}

function parseLeftQR(raw) {
  if (typeof raw !== 'string' || raw.length < HEADER_LEN) {
    return { ok: false, reason: 'too-short' };
  }

  const header = raw.slice(0, HEADER_LEN);
  const invoiceNumber = header.slice(0, 10);
  const dateStr = header.slice(10, 17);
  const randomCode = header.slice(17, 21);
  const salesHex = header.slice(21, 29);
  const totalHex = header.slice(29, 37);
  const buyerTaxId = header.slice(37, 45);
  const sellerTaxId = header.slice(45, 53);
  const verifyInfo = header.slice(53, 77);

  if (!/^[A-Za-z0-9]{2}\d{8}$/.test(invoiceNumber)) {
    return { ok: false, reason: 'bad-invoice-number' };
  }
  const date = rocDateToISO(dateStr);
  if (!date) return { ok: false, reason: 'bad-date' };
  if (!/^\d{4}$/.test(randomCode)) return { ok: false, reason: 'bad-random-code' };

  const salesAmount = hexToInt(salesHex);
  const totalAmount = hexToInt(totalHex);
  if (salesAmount === null || totalAmount === null) return { ok: false, reason: 'bad-amount' };

  if (!/^\d{8}$/.test(buyerTaxId) || !/^\d{8}$/.test(sellerTaxId)) {
    return { ok: false, reason: 'bad-tax-id' };
  }
  if (verifyInfo.length !== 24) return { ok: false, reason: 'bad-verify-info' };

  const data = {
    invoiceNumber,
    invoiceRandomCode: randomCode,
    date,
    salesAmount,
    totalAmount,
    buyerTaxId,
    sellerTaxId,
    verifyInfo,
    items: [],
    note: '',
  };

  // Extension fields are optional — a bare 77-char header still parses ok.
  const rest = raw.slice(HEADER_LEN).replace(/^:/, '');
  if (rest.length > 0) {
    const tokens = rest.split(':');
    const [, qrItemCountStr, , , ...itemTokens] = tokens;
    const qrItemCount = Number(qrItemCountStr);
    if (!Number.isNaN(qrItemCount) && qrItemCount > 0) {
      const items = parseItemTriples(itemTokens.slice(0, qrItemCount * 3));
      data.items = items;
      const leftover = itemTokens.slice(qrItemCount * 3);
      if (leftover.length > 0) data.note = leftover.join(':');
    } else if (itemTokens.length > 0) {
      // Encoding/count fields didn't parse as expected — best-effort item grouping.
      data.items = parseItemTriples(itemTokens);
    }
  }

  return { ok: true, data };
}

function parseRightQR(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  return parseItemTriples(raw.split(':'));
}

// Main entry point. rightRaw is optional (invoices with few line items may
// only print/encode a left QR).
function parseInvoiceQR(leftRaw, rightRaw) {
  const left = parseLeftQR(leftRaw);
  if (!left.ok) return left;
  if (rightRaw) {
    const rightItems = parseRightQR(rightRaw);
    left.data.items = left.data.items.concat(rightItems);
  }
  return left;
}

const InvoiceParser = { parseInvoiceQR, parseLeftQR, parseRightQR, rocDateToISO, hexToInt };

if (typeof window !== 'undefined') window.InvoiceParser = InvoiceParser;
if (typeof module !== 'undefined' && module.exports) module.exports = InvoiceParser;
