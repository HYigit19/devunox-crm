import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';

export type DocItem = { pos: number; name: string; description?: string | null; qty: number; unit?: string | null; unit_price: number; discount_pct?: number | null; tax_rate?: number | null };

export type QuoteDoc = {
  number: string;
  title?: string | null;
  language: 'de' | 'en';
  currency: string;
  tax_mode: string;
  issue_date: string;
  valid_until?: string | null;
  intro?: string | null;
  outro?: string | null;
  discount_pct?: number | null;
  items: DocItem[];
  totals: { subtotal: number; discount: number; net: number; taxes: { rate: number; amount: number }[]; tax_total: number; total: number };
  buyer: { company?: string | null; contact?: string | null; street?: string | null; zip?: string | null; city?: string | null; country?: string | null; vat_id?: string | null };
  seller: Record<string, string>;
};

const L = {
  de: {
    quote: 'Angebot', number: 'Angebotsnr.', date: 'Datum', valid: 'Gültig bis', vat: 'USt-IdNr.', pos: 'Pos.', desc: 'Beschreibung', qty: 'Menge',
    price: 'Einzelpreis', total: 'Gesamt', subtotal: 'Zwischensumme', discount: 'Rabatt', net: 'Nettobetrag', tax: 'MwSt.', gross: 'Gesamtbetrag',
    page: 'Seite', md: 'Geschäftsführer', reg: 'Register', bank: 'Bank',
    rc: 'Reverse Charge – Steuerschuldnerschaft des Leistungsempfängers (Art. 196 MwStSystRL). Die Umsatzsteuer wird vom Leistungsempfänger geschuldet.',
    noneu: 'Nicht im Inland steuerbare Leistung (Leistungsort beim Empfänger). Die Umsatzsteuer ist ggf. vom Leistungsempfänger nach dem Recht seines Landes abzuführen.',
    allnet: 'Alle Preise netto zzgl. gesetzlicher Umsatzsteuer.',
  },
  en: {
    quote: 'Proposal', number: 'Proposal no.', date: 'Date', valid: 'Valid until', vat: 'VAT ID', pos: 'Item', desc: 'Description', qty: 'Qty',
    price: 'Unit price', total: 'Amount', subtotal: 'Subtotal', discount: 'Discount', net: 'Net amount', tax: 'VAT', gross: 'Total',
    page: 'Page', md: 'Managing Director', reg: 'Register', bank: 'Bank',
    rc: 'Reverse charge – VAT to be accounted for by the recipient (Art. 196 Council Directive 2006/112/EC).',
    noneu: 'Service not subject to VAT in the country of the supplier (place of supply is the recipient’s country). Any VAT or sales tax is to be accounted for by the recipient.',
    allnet: 'All prices are net, plus statutory VAT.',
  },
};

// WinAnsi kann keine polnischen u. a. Sonderzeichen – sinnvoll ersetzen
const MAP: Record<string, string> = {
  'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ś': 's', 'ź': 'z', 'ż': 'z', 'Ą': 'A', 'Ć': 'C', 'Ę': 'E', 'Ł': 'L', 'Ń': 'N', 'Ś': 'S', 'Ź': 'Z', 'Ż': 'Z',
  'č': 'c', 'ř': 'r', 'š': 's', 'ž': 'z', 'ě': 'e', 'ů': 'u', 'Č': 'C', 'Ř': 'R', 'Š': 'S', 'Ž': 'Z', 'ğ': 'g', 'ı': 'i', 'ş': 's', 'Ğ': 'G', 'İ': 'I', 'Ş': 'S',
  '‑': '-', '‒': '-', '―': '-', '−': '-', ' ': ' ', ' ': ' ', ' ': ' ', '→': '->', '✓': 'x',
};
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
function clean(s: string | null | undefined): string {
  if (!s) return '';
  let out = '';
  for (const ch of s.replace(/\r/g, '')) {
    if (MAP[ch]) out += MAP[ch];
    else {
      const code = ch.charCodeAt(0);
      if (ch === '\n' || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.includes(ch)) out += ch;
      else out += ch.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?');
    }
  }
  return out;
}

export function money(n: number, currency: string, lang: 'de' | 'en') {
  return new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', { style: 'currency', currency }).format(n);
}
function num(n: number, lang: 'de' | 'en') {
  return new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: 2 }).format(n);
}
function fmtDate(iso: string | null | undefined, lang: 'de' | 'en') {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return lang === 'de' ? `${d}.${m}.${y}` : `${y}-${m}-${d}`;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of clean(text).split('\n')) {
    if (!para.trim()) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(test, size) <= width) line = test;
      else {
        if (line) lines.push(line);
        // sehr lange Wörter hart umbrechen
        let w = word;
        while (font.widthOfTextAtSize(w, size) > width) {
          let i = w.length;
          while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > width) i--;
          lines.push(w.slice(0, i));
          w = w.slice(i);
        }
        line = w;
      }
    }
    lines.push(line);
  }
  return lines;
}

const BLUE = rgb(0.11, 0.3, 0.85);
const DARK = rgb(0.12, 0.14, 0.2);
const GREY = rgb(0.42, 0.45, 0.52);
const LINE = rgb(0.86, 0.88, 0.92);

export async function renderQuotePdf(d: QuoteDoc): Promise<Uint8Array> {
  const t = L[d.language] || L.de;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${t.quote} ${d.number}`);
  pdf.setAuthor(clean(d.seller.company_name));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 56, CW = W - 2 * M;
  const FOOT = 92;
  let page!: PDFPage;
  let y = 0;
  const pages: PDFPage[] = [];

  const text = (s: string, x: number, yy: number, opt: { size?: number; f?: PDFFont; color?: any; align?: 'right' | 'left' } = {}) => {
    const size = opt.size ?? 9.5;
    const f = opt.f ?? font;
    const c = clean(s);
    const xx = opt.align === 'right' ? x - f.widthOfTextAtSize(c, size) : x;
    page.drawText(c, { x: xx, y: yy, size, font: f, color: opt.color ?? DARK });
  };

  const s = d.seller;
  const newPage = () => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: BLUE });
    text(s.company_name || 'Devunox Solutions', M, H - 52, { size: 16, f: bold, color: BLUE });
    const right = [s.company_website, s.company_email, s.company_phone].filter(Boolean);
    right.forEach((r, i) => text(r, W - M, H - 40 - i * 11, { size: 8, color: GREY, align: 'right' }));
    y = H - 90;
  };
  const ensure = (h: number) => {
    if (y - h < FOOT + 10) newPage();
  };

  newPage();
  // Absenderzeile + Empfänger
  const senderLine = [s.company_legal || s.company_name, s.company_street, [s.company_zip, s.company_city].filter(Boolean).join(' '), s.company_country]
    .filter(Boolean)
    .join(' · ');
  text(senderLine, M, y, { size: 7, color: GREY });
  y -= 18;
  const b = d.buyer;
  const buyerLines = [b.company, b.contact, b.street, [b.zip, b.city].filter(Boolean).join(' '), b.country, b.vat_id ? `${t.vat}: ${b.vat_id}` : '']
    .filter(Boolean) as string[];
  const yStart = y;
  buyerLines.forEach((l, i) => text(l, M, y - i * 13, { size: 10, f: i === 0 ? bold : font }));

  // Meta rechts
  const meta: [string, string][] = [
    [t.number, d.number],
    [t.date, fmtDate(d.issue_date, d.language)],
  ];
  if (d.valid_until) meta.push([t.valid, fmtDate(d.valid_until, d.language)]);
  meta.forEach(([k, v], i) => {
    text(k, W - M - 150, yStart - i * 13, { size: 9, color: GREY });
    text(v, W - M, yStart - i * 13, { size: 9, f: bold, align: 'right' });
  });
  y = Math.min(yStart - buyerLines.length * 13, yStart - meta.length * 13) - 34;

  text(`${t.quote} ${d.number}`, M, y, { size: 17, f: bold });
  y -= 18;
  if (d.title) {
    for (const l of wrap(d.title, font, 11, CW)) {
      text(l, M, y, { size: 11, color: GREY });
      y -= 14;
    }
  }
  y -= 10;
  if (d.intro) {
    for (const l of wrap(d.intro, font, 10, CW)) {
      ensure(14);
      text(l, M, y, { size: 10 });
      y -= 14;
    }
    y -= 8;
  }

  // Tabelle
  const col = { pos: M, desc: M + 30, qty: M + CW - 190, price: M + CW - 85, total: M + CW };
  const descW = col.qty - col.desc - 50;
  const header = () => {
    page.drawRectangle({ x: M - 6, y: y - 6, width: CW + 12, height: 20, color: rgb(0.95, 0.96, 0.99) });
    text(t.pos, col.pos, y, { size: 8.5, f: bold, color: GREY });
    text(t.desc, col.desc, y, { size: 8.5, f: bold, color: GREY });
    text(t.qty, col.qty, y, { size: 8.5, f: bold, color: GREY, align: 'right' });
    text(t.price, col.price, y, { size: 8.5, f: bold, color: GREY, align: 'right' });
    text(t.total, col.total, y, { size: 8.5, f: bold, color: GREY, align: 'right' });
    y -= 22;
  };
  ensure(60);
  header();
  for (const it of d.items) {
    const nameLines = wrap(it.name, bold, 9.5, descW);
    const descLines = it.description ? wrap(it.description, font, 8.5, descW) : [];
    const h = nameLines.length * 12 + descLines.length * 11 + 10;
    if (y - h < FOOT + 10) {
      newPage();
      header();
    }
    const lineTotal = it.qty * it.unit_price * (1 - (it.discount_pct || 0) / 100);
    text(String(it.pos), col.pos, y, { size: 9.5 });
    text(`${num(it.qty, d.language)} ${it.unit || ''}`.trim(), col.qty, y, { size: 9.5, align: 'right' });
    text(money(it.unit_price, d.currency, d.language), col.price, y, { size: 9.5, align: 'right' });
    text(money(lineTotal, d.currency, d.language), col.total, y, { size: 9.5, align: 'right' });
    if (it.discount_pct) text(`-${num(it.discount_pct, d.language)} %`, col.price, y - 11, { size: 8, color: GREY, align: 'right' });
    nameLines.forEach((l, i) => text(l, col.desc, y - i * 12, { size: 9.5, f: bold }));
    let yy = y - nameLines.length * 12;
    descLines.forEach((l) => {
      text(l, col.desc, yy, { size: 8.5, color: GREY });
      yy -= 11;
    });
    y = yy - 6;
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: M + CW, y: y + 2 }, thickness: 0.5, color: LINE });
    y -= 10;
  }

  // Summen
  const tt = d.totals;
  const rows: [string, string, boolean][] = [];
  if (tt.discount) {
    rows.push([t.subtotal, money(tt.subtotal, d.currency, d.language), false]);
    rows.push([`${t.discount} ${num(d.discount_pct || 0, d.language)} %`, '-' + money(tt.discount, d.currency, d.language), false]);
  }
  rows.push([t.net, money(tt.net, d.currency, d.language), false]);
  if (d.tax_mode === 'standard') for (const tx of tt.taxes) rows.push([`${t.tax} ${num(tx.rate, d.language)} %`, money(tx.amount, d.currency, d.language), false]);
  else rows.push([`${t.tax} 0 %`, money(0, d.currency, d.language), false]);
  rows.push([t.gross, money(tt.total, d.currency, d.language), true]);
  ensure(rows.length * 15 + 20);
  for (const [k, v, strong] of rows) {
    if (strong) {
      page.drawLine({ start: { x: M + CW - 220, y: y + 11 }, end: { x: M + CW, y: y + 11 }, thickness: 1, color: DARK });
      y -= 3;
    }
    text(k, M + CW - 220, y, { size: strong ? 11 : 9.5, f: strong ? bold : font });
    text(v, M + CW, y, { size: strong ? 11 : 9.5, f: strong ? bold : font, align: 'right' });
    y -= strong ? 18 : 14;
  }
  y -= 8;

  const note =
    d.tax_mode === 'reverse_charge' ? t.rc + (d.language === 'de' ? ' / Odwrotne obciążenie.' : ' / Odwrotne obciążenie.')
    : d.tax_mode === 'non_eu' ? t.noneu
    : d.tax_mode === 'none' ? (d.language === 'de' ? s.note_none_de : s.note_none_en) || ''
    : '';
  for (const l of wrap(note, font, 8.5, CW)) {
    ensure(12);
    text(l, M, y, { size: 8.5, color: GREY });
    y -= 12;
  }
  if (note) y -= 8;
  if (d.outro) {
    for (const l of wrap(d.outro, font, 10, CW)) {
      ensure(14);
      text(l, M, y, { size: 10 });
      y -= 14;
    }
  }

  // Fußzeile auf allen Seiten
  const colsFoot: string[][] = [
    [s.company_legal || s.company_name, s.company_street, [s.company_zip, s.company_city].filter(Boolean).join(' '), s.company_country].filter(Boolean),
    [s.company_managing_director ? `${t.md}: ${s.company_managing_director}` : '', s.company_vat_id ? `${t.vat}: ${s.company_vat_id}` : '', s.company_register ? `${t.reg}: ${s.company_register}` : ''].filter(Boolean),
    [s.bank_name ? `${t.bank}: ${s.bank_name}` : '', s.bank_iban ? `IBAN: ${s.bank_iban}` : '', s.bank_bic ? `BIC: ${s.bank_bic}` : ''].filter(Boolean),
  ];
  pages.forEach((p, idx) => {
    page = p;
    page.drawLine({ start: { x: M, y: FOOT - 10 }, end: { x: W - M, y: FOOT - 10 }, thickness: 0.5, color: LINE });
    colsFoot.forEach((lines, ci) => lines.forEach((l, li) => text(l, M + ci * (CW / 3), FOOT - 24 - li * 10, { size: 7, color: GREY })));
    text(`${t.page} ${idx + 1}/${pages.length}`, W - M, 30, { size: 7, color: GREY, align: 'right' });
  });

  return pdf.save();
}
