import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, degrees, rgb } from 'pdf-lib';
import { LOGO_PNG_B64, LOGO_RATIO } from './logo';

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
  customer_no?: string;
  totals: { subtotal: number; discount: number; net: number; taxes: { rate: number; amount: number }[]; tax_total: number; total: number };
  buyer: { company?: string | null; contact?: string | null; street?: string | null; zip?: string | null; city?: string | null; country?: string | null; vat_id?: string | null };
  seller: Record<string, string>;
  sign?: { signature?: Uint8Array | null; stamp?: Uint8Array | null; name: string; role: string; place?: string; date: string } | null;
};

const L = {
  de: {
    quote: 'Angebot', number: 'Angebotsnr.', customer: 'Kundennr.', date: 'Datum', valid: 'Gültig bis', vat: 'USt-IdNr.', pos: 'Pos.', desc: 'Beschreibung', qty: 'Menge',
    price: 'Einzelpreis', total: 'Gesamt', subtotal: 'Zwischensumme', discount: 'Rabatt', net: 'Nettobetrag', tax: 'MwSt.', gross: 'Gesamtbetrag',
    page: 'Seite', md: 'Geschäftsführer', reg: 'Register', bank: 'Bank',
    rc: 'Reverse Charge – Steuerschuldnerschaft des Leistungsempfängers (Art. 196 MwStSystRL). Die Umsatzsteuer wird vom Leistungsempfänger geschuldet.',
    noneu: 'Nicht im Inland steuerbare Leistung (Leistungsort beim Empfänger). Die Umsatzsteuer ist ggf. vom Leistungsempfänger nach dem Recht seines Landes abzuführen.',
    allnet: 'Alle Preise netto zzgl. gesetzlicher Umsatzsteuer.',
    signed: 'Digital unterschrieben und gestempelt',
    on: 'am',
  },
  en: {
    quote: 'Proposal', number: 'Proposal no.', customer: 'Customer no.', date: 'Date', valid: 'Valid until', vat: 'VAT ID', pos: 'Item', desc: 'Description', qty: 'Qty',
    price: 'Unit price', total: 'Amount', subtotal: 'Subtotal', discount: 'Discount', net: 'Net amount', tax: 'VAT', gross: 'Total',
    page: 'Page', md: 'Managing Director', reg: 'Register', bank: 'Bank',
    rc: 'Reverse charge – VAT to be accounted for by the recipient (Art. 196 Council Directive 2006/112/EC).',
    noneu: 'Service not subject to VAT in the country of the supplier (place of supply is the recipient’s country). Any VAT or sales tax is to be accounted for by the recipient.',
    allnet: 'All prices are net, plus statutory VAT.',
    signed: 'Digitally signed and stamped',
    on: 'on',
  },
};

// WinAnsi kann keine polnischen u. a. Sonderzeichen – sinnvoll ersetzen
const MAP: Record<string, string> = {
  'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ś': 's', 'ź': 'z', 'ż': 'z', 'Ą': 'A', 'Ć': 'C', 'Ę': 'E', 'Ł': 'L', 'Ń': 'N', 'Ś': 'S', 'Ź': 'Z', 'Ż': 'Z',
  'č': 'c', 'ř': 'r', 'š': 's', 'ž': 'z', 'ě': 'e', 'ů': 'u', 'Č': 'C', 'Ř': 'R', 'Š': 'S', 'Ž': 'Z', 'ğ': 'g', 'ı': 'i', 'ş': 's', 'Ğ': 'G', 'İ': 'I', 'Ş': 'S',
  '‑': '-', '‒': '-', '―': '-', '−': '-', ' ': ' ', ' ': ' ', ' ': ' ', '→': '->', '✓': 'x',
};
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export function clean(s: string | null | undefined): string {
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
export function fmtDate(iso: string | null | undefined, lang: 'de' | 'en') {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return lang === 'de' ? `${d}.${m}.${y}` : `${y}-${m}-${d}`;
}

export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
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

// devunox AI Markenfarben
export const ORANGE = rgb(1, 0.353, 0.122); // #FF5A1F
export const RUST = rgb(0.584, 0.227, 0.106); // #953A1B
export const BLUE = ORANGE; // Akzentfarbe (Name aus älterer Version)
export const DARK = rgb(0.078, 0.078, 0.09); // #141417
export const GREY = rgb(0.45, 0.45, 0.5);
export const LINE = rgb(0.9, 0.9, 0.92);
export const SOFT = rgb(0.957, 0.957, 0.965); // #F4F4F6

export async function embedLogo(pdf: PDFDocument): Promise<PDFImage> {
  const bin = atob(LOGO_PNG_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return pdf.embedPng(bytes);
}

/** Kopfzeile im devunox-AI-Stil: Logo links, dunkler Balken mit orangem Akzent oben */
export function drawBrandHeader(page: PDFPage, logo: PDFImage, W: number, H: number, M: number, logoWidth = 140) {
  page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: DARK });
  page.drawRectangle({ x: 0, y: H - 8, width: 150, height: 8, color: ORANGE });
  page.drawRectangle({ x: 150, y: H - 8, width: 70, height: 8, color: RUST });
  const h = logoWidth * LOGO_RATIO;
  page.drawImage(logo, { x: M - 2, y: H - 40 - h, width: logoWidth, height: h });
  return H - 40 - h;
}

export async function renderQuotePdf(d: QuoteDoc): Promise<Uint8Array> {
  const t = L[d.language] || L.de;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${t.quote} ${d.number}`);
  pdf.setAuthor(clean(d.seller.company_name));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 56, CW = W - 2 * M;
  const FOOT = 78;
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
  const logo = await embedLogo(pdf);
  const newPage = () => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    drawBrandHeader(page, logo, W, H, M, 150);
    // Firmendaten rechts im Briefkopf
    const right: [string, boolean][] = [
      [s.company_legal || s.company_name, true],
      [s.company_street, false],
      [[s.company_zip, s.company_city].filter(Boolean).join(' '), false],
      [s.company_phone ? `Tel. ${s.company_phone}` : '', false],
      [s.company_email, false],
      [s.company_website, false],
    ].filter(([v]) => !!v) as [string, boolean][];
    right.forEach(([r, strong], i) => text(r, W - M, H - 36 - i * 10.5, { size: strong ? 8.5 : 8, f: strong ? bold : font, color: strong ? DARK : GREY, align: 'right' }));
    y = Math.min(H - 94, H - 36 - right.length * 10.5 - 16);
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
    ...(d.customer_no ? ([[t.customer, d.customer_no]] as [string, string][]) : []),
    [t.number, d.number],
    [t.date, fmtDate(d.issue_date, d.language)],
  ];
  if (d.valid_until) meta.push([t.valid, fmtDate(d.valid_until, d.language)]);
  meta.forEach(([k, v], i) => {
    text(k, W - M - 150, yStart - i * 13, { size: 9, color: GREY });
    text(v, W - M, yStart - i * 13, { size: 9, f: bold, align: 'right' });
  });
  y = Math.min(yStart - buyerLines.length * 13, yStart - meta.length * 13) - 34;

  text(`${t.quote} ${d.number}`, M, y, { size: 20, f: bold });
  page.drawRectangle({ x: M, y: y - 8, width: 34, height: 3, color: ORANGE });
  y -= 8;
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
    page.drawRectangle({ x: M - 6, y: y - 6, width: CW + 12, height: 20, color: SOFT });
    page.drawRectangle({ x: M - 6, y: y - 6, width: 3, height: 20, color: ORANGE });
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
    const EN_PL: Record<string, string> = { day: 'Days', hour: 'Hours', month: 'Months', week: 'Weeks', year: 'Years', 'person-day': 'Person-days', license: 'Licenses' };
    const unit = d.language === 'en' && it.qty !== 1 && EN_PL[(it.unit || '').toLowerCase()] ? EN_PL[(it.unit || '').toLowerCase()] : it.unit || '';
    text(`${num(it.qty, d.language)} ${unit}`.trim(), col.qty, y, { size: 9.5, align: 'right' });
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
      y -= 8;
      page.drawRectangle({ x: M + CW - 228, y: y - 7, width: 236, height: 21, color: DARK });
      text(k, M + CW - 220, y, { size: 11, f: bold, color: rgb(1, 1, 1) });
      text(v, M + CW, y, { size: 11, f: bold, color: ORANGE, align: 'right' });
      y -= 22;
      continue;
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
    const outroLines = wrap(d.outro, font, 10, CW);
    ensure(Math.min(outroLines.length, 8) * 14);
    for (const l of outroLines) {
      ensure(14);
      text(l, M, y, { size: 10 });
      y -= 14;
    }
  }

  // Digitale Unterschrift & Firmenstempel
  if (d.sign && (d.sign.signature || d.sign.stamp)) {
    const sig = d.sign.signature ? await pdf.embedPng(d.sign.signature).catch(() => null) : null;
    const stp = d.sign.stamp ? await pdf.embedPng(d.sign.stamp).catch(() => null) : null;
    const blockH = 132;
    y -= 10;
    ensure(blockH);
    const top = y;
    // Unterschrift links über der Linie
    const lineY = top - 66;
    if (sig) {
      const w = 160, h = Math.min(60, (w * sig.height) / sig.width);
      page.drawImage(sig, { x: M, y: lineY + 2, width: (h * sig.width) / sig.height, height: h });
    }
    page.drawLine({ start: { x: M, y: lineY }, end: { x: M + 200, y: lineY }, thickness: 0.6, color: GREY });
    text(d.sign.name, M, lineY - 12, { size: 9.5, f: bold });
    if (d.sign.role) text(d.sign.role, M, lineY - 24, { size: 8.5, color: GREY });
    // Stempel rechts daneben, leicht gedreht
    if (stp) {
      const w = 170, h = (w * stp.height) / stp.width;
      page.drawImage(stp, { x: M + 228, y: lineY - 34, width: w, height: h, rotate: degrees(-3), opacity: 0.95 });
    }
    // Vermerk
    const when = [d.sign.place, fmtDate(d.sign.date, d.language)].filter(Boolean).join(', ');
    const label = [t.signed, when].filter(Boolean).join(' · ');
    const ly = lineY - 50;
    const lw = bold.widthOfTextAtSize(clean(label), 8.5) + 26;
    page.drawRectangle({ x: M, y: ly - 6, width: lw, height: 18, color: rgb(1, 0.94, 0.91), borderColor: ORANGE, borderWidth: 0.6 });
    page.drawCircle({ x: M + 9, y: ly + 3, size: 3, color: ORANGE });
    text(label, M + 18, ly, { size: 8.5, f: bold, color: RUST });
    y = ly - 20;
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
