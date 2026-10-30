import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { BLUE, DARK, GREY, LINE, ORANGE, SOFT, clean, drawBrandHeader, embedLogo, fmtDate, wrap } from './pdf';

export type TechRequirement = {
  ref: string;
  title: string;
  description?: string;
  priority?: string | null;
  fit: 'standard' | 'config' | 'custom';
  solution: string;
  effort_days: number;
  package?: string;
};
export type TechProposal = {
  title: string;
  summary: string;
  objectives?: string[];
  solution: string;
  architecture?: string;
  tech_stack?: { area: string; technology: string }[];
  packages: { name: string; description?: string; extra_days?: number }[];
  requirements: TechRequirement[];
  phases?: { name: string; weeks: number; deliverables?: string }[];
  assumptions?: string[];
  exclusions?: string[];
  open_questions?: string[];
  offer_intro?: string;
  language?: 'de' | 'en';
};

export const FIT = {
  de: { standard: 'Standard', config: 'Anpassung', custom: 'Neuentwicklung' },
  en: { standard: 'Standard', config: 'Configuration', custom: 'Custom development' },
};

const T = {
  de: {
    doc: 'Technische Spezifikation', ref: 'zu Angebot', custNo: 'Kundennr.', date: 'Datum', customer: 'Kunde', summary: '1. Ausgangslage', objectives: 'Ziele',
    solution: '2. Lösungsansatz', architecture: 'Architektur', stack: 'Technologie', area: 'Bereich', tech: 'Technologie',
    matrix: '3. Anforderungen und Bewertung (Fit/Gap)', no: 'Nr.', req: 'Anforderung', fit: 'Bewertung', sol: 'Lösung', days: 'PT',
    legend: 'PT = Personentage. Standard = mit vorhandenen Bausteinen abgedeckt · Anpassung = Konfiguration/Anpassung bestehender Komponenten · Neuentwicklung = individuelle Entwicklung.',
    effort: '4. Aufwand je Arbeitspaket', pkg: 'Arbeitspaket', reqs: 'Anforderungen', extra: 'zusätzlich', total: 'Summe Entwicklung', pm: 'Projektmanagement & QS', grand: 'Gesamtaufwand',
    plan: '5. Projektplan', phase: 'Phase', weeks: 'Wochen', deliv: 'Ergebnisse', totalWeeks: 'Gesamtdauer ca.',
    assumptions: '6. Annahmen und Voraussetzungen', exclusions: 'Nicht im Umfang enthalten', questions: 'Offene Fragen', page: 'Seite', prio: 'Priorität',
    days_unit: 'PT', wk: 'Wochen',
  },
  en: {
    doc: 'Technical Specification', ref: 'for proposal', custNo: 'Customer no.', date: 'Date', customer: 'Customer', summary: '1. Background', objectives: 'Objectives',
    solution: '2. Solution approach', architecture: 'Architecture', stack: 'Technology', area: 'Area', tech: 'Technology',
    matrix: '3. Requirements and assessment (fit/gap)', no: 'No.', req: 'Requirement', fit: 'Assessment', sol: 'Solution', days: 'PD',
    legend: 'PD = person days. Standard = covered by existing components · Configuration = configuration/adaptation of existing components · Custom development = individual development.',
    effort: '4. Effort per work package', pkg: 'Work package', reqs: 'Requirements', extra: 'additional', total: 'Development total', pm: 'Project management & QA', grand: 'Total effort',
    plan: '5. Project plan', phase: 'Phase', weeks: 'Weeks', deliv: 'Deliverables', totalWeeks: 'Total duration approx.',
    assumptions: '6. Assumptions and prerequisites', exclusions: 'Out of scope', questions: 'Open questions', page: 'Page', prio: 'Priority',
    days_unit: 'PD', wk: 'weeks',
  },
};

export function packageEffort(p: TechProposal, pmPct: number) {
  const rows = p.packages.map((pk) => {
    const reqs = p.requirements.filter((r) => (r.package || '') === pk.name);
    const days = reqs.reduce((a, r) => a + (Number(r.effort_days) || 0), 0) + (Number(pk.extra_days) || 0);
    return { ...pk, refs: reqs.map((r) => r.ref), days: Math.round(days * 2) / 2 };
  });
  // Anforderungen ohne gültiges Paket
  const known = new Set(p.packages.map((x) => x.name));
  const orphan = p.requirements.filter((r) => !known.has(r.package || ''));
  if (orphan.length)
    rows.push({ name: p.language === 'en' ? 'Further requirements' : 'Weitere Anforderungen', description: '', extra_days: 0, refs: orphan.map((r) => r.ref), days: orphan.reduce((a, r) => a + (Number(r.effort_days) || 0), 0) });
  const dev = rows.reduce((a, r) => a + r.days, 0);
  const pm = Math.round(((dev * pmPct) / 100) * 2) / 2;
  return { rows, dev, pm, total: dev + pm };
}

export async function renderTechPdf(o: {
  p: TechProposal; lang: 'de' | 'en'; quoteNumber: string; date: string; customer: string; customerNo?: string; seller: Record<string, string>; pmPct: number;
}): Promise<Uint8Array> {
  const { p, lang, seller: s } = o;
  const t = T[lang];
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${t.doc} ${o.quoteNumber}`);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 56, CW = W - 2 * M, FOOT = 60;
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const txt = (str: string, x: number, yy: number, size = 9.5, f: PDFFont = font, color = DARK, align: 'left' | 'right' = 'left') => {
    const c = clean(str);
    page.drawText(c, { x: align === 'right' ? x - f.widthOfTextAtSize(c, size) : x, y: yy, size, font: f, color });
  };
  const logo = await embedLogo(pdf);
  const newPage = () => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    drawBrandHeader(page, logo, W, H, M, 110);
    txt(`${t.doc} · ${o.quoteNumber}`, W - M, H - 50, 8.5, font, GREY, 'right');
    y = H - 84;
  };
  const ensure = (h: number) => {
    if (y - h < FOOT + 14) newPage();
  };
  const para = (str: string | undefined, size = 10, color = DARK, gap = 6) => {
    if (!str) return;
    for (const l of wrap(str, font, size, CW)) {
      ensure(size + 4);
      txt(l, M, y, size, font, color);
      y -= size + 4;
    }
    y -= gap;
  };
  const heading = (str: string, size = 13.5) => {
    ensure(size + 40);
    y -= 8;
    page.drawRectangle({ x: M, y: y - 2, width: 3.5, height: size + 2, color: ORANGE });
    txt(str, M + 11, y, size, bold, DARK);
    y -= size + 10;
  };
  const sub = (str: string) => {
    ensure(30);
    txt(str, M, y, 10.5, bold, DARK);
    y -= 15;
  };
  const bullets = (list?: string[]) => {
    for (const b of list || []) {
      const lines = wrap(b, font, 10, CW - 14);
      ensure(lines.length * 14);
      txt('•', M + 2, y, 10, bold, ORANGE);
      lines.forEach((l, i) => txt(l, M + 14, y - i * 14, 10));
      y -= lines.length * 14 + 2;
    }
    y -= 6;
  };
  /** Tabelle mit umbrechenden Spalten */
  const table = (cols: { h: string; w: number; align?: 'right'; bold?: boolean; size?: number }[], rows: string[][], opts: { shade?: (i: number) => boolean } = {}) => {
    const xs: number[] = [];
    cols.reduce((x, c) => (xs.push(x), x + c.w), M);
    const head = () => {
      page.drawRectangle({ x: M - 4, y: y - 5, width: CW + 8, height: 18, color: DARK });
      cols.forEach((c, i) => txt(c.h, c.align === 'right' ? xs[i] + c.w - 4 : xs[i], y, 8, bold, rgb(1, 1, 1), c.align || 'left'));
      y -= 19;
    };
    ensure(40);
    head();
    rows.forEach((r, ri) => {
      const cells = r.map((v, i) => wrap(v || '', cols[i].bold ? bold : font, cols[i].size ?? 8.5, cols[i].w - 8));
      const h = Math.max(...cells.map((c) => c.length)) * 11 + 6;
      if (y - h < FOOT + 14) {
        newPage();
        head();
      }
      if (opts.shade?.(ri)) page.drawRectangle({ x: M - 4, y: y - h + 9, width: CW + 8, height: h, color: SOFT });
      cells.forEach((lines, i) =>
        lines.forEach((l, li) => txt(l, cols[i].align === 'right' ? xs[i] + cols[i].w - 4 : xs[i], y - li * 11, cols[i].size ?? 8.5, cols[i].bold ? bold : font, DARK, cols[i].align || 'left')),
      );
      y -= h;
      page.drawLine({ start: { x: M - 4, y: y + 8 }, end: { x: M + CW + 4, y: y + 8 }, thickness: 0.4, color: LINE });
    });
    y -= 8;
  };

  // ---------- Titelbereich
  newPage();
  y -= 10;
  txt(t.doc, M, y, 26, bold, DARK);
  page.drawRectangle({ x: M, y: y - 10, width: 40, height: 3.5, color: ORANGE });
  y -= 32;
  for (const l of wrap(p.title, font, 13, CW)) {
    txt(l, M, y, 13, font, GREY);
    y -= 17;
  }
  y -= 8;
  const meta: [string, string][] = [
    [t.customer, o.customer],
    ...(o.customerNo ? ([[t.custNo, o.customerNo]] as [string, string][]) : []),
    [t.ref, o.quoteNumber],
    [t.date, fmtDate(o.date, lang)],
  ];
  meta.forEach(([k, v]) => {
    txt(k, M, y, 9, font, GREY);
    txt(v, M + 90, y, 9.5, bold);
    y -= 14;
  });
  y -= 10;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: LINE });
  y -= 18;

  heading(t.summary);
  para(p.summary);
  if (p.objectives?.length) {
    sub(t.objectives);
    bullets(p.objectives);
  }

  heading(t.solution);
  para(p.solution);
  if (p.architecture) {
    sub(t.architecture);
    para(p.architecture);
  }
  if (p.tech_stack?.length) {
    sub(t.stack);
    table([{ h: t.area, w: 150, bold: true }, { h: t.tech, w: CW - 150 }], p.tech_stack.map((x) => [x.area, x.technology]));
  }

  heading(t.matrix);
  const F = FIT[lang];
  table(
    [
      { h: t.no, w: 42 },
      { h: t.req, w: 150, bold: true },
      { h: t.fit, w: 72 },
      { h: t.sol, w: CW - 42 - 150 - 72 - 34 },
      { h: t.days, w: 34, align: 'right' },
    ],
    p.requirements.map((r) => [
      r.ref,
      r.title + (r.priority ? ` (${r.priority})` : ''),
      F[r.fit] || r.fit,
      r.solution,
      new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US').format(Number(r.effort_days) || 0),
    ]),
    { shade: (i) => i % 2 === 1 },
  );
  para(t.legend, 7.5, GREY, 4);

  heading(t.effort);
  const eff = packageEffort(p, o.pmPct);
  const n = (v: number) => new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US').format(v);
  table(
    [
      { h: t.pkg, w: 170, bold: true },
      { h: t.reqs, w: CW - 170 - 60 },
      { h: t.days, w: 60, align: 'right' },
    ],
    [
      ...eff.rows.map((r) => [r.name, [r.refs.join(', '), r.extra_days ? `+ ${n(r.extra_days)} ${t.days_unit} ${t.extra}` : ''].filter(Boolean).join(' '), n(r.days)]),
      [t.total, '', n(eff.dev)],
      [`${t.pm} (${o.pmPct} %)`, '', n(eff.pm)],
      [t.grand, '', n(eff.total)],
    ],
  );

  if (p.phases?.length) {
    heading(t.plan);
    table(
      [
        { h: t.phase, w: 150, bold: true },
        { h: t.weeks, w: 50, align: 'right' },
        { h: t.deliv, w: CW - 200 },
      ],
      p.phases.map((ph) => [ph.name, n(ph.weeks), ph.deliverables || '']),
    );
    para(`${t.totalWeeks} ${n(p.phases.reduce((a, x) => a + (Number(x.weeks) || 0), 0))} ${t.wk}`, 9, GREY);
  }

  if (p.assumptions?.length || p.exclusions?.length || p.open_questions?.length) {
    heading(t.assumptions);
    bullets(p.assumptions);
    if (p.exclusions?.length) {
      sub(t.exclusions);
      bullets(p.exclusions);
    }
    if (p.open_questions?.length) {
      sub(t.questions);
      bullets(p.open_questions);
    }
  }

  pages.forEach((pg, i) => {
    page = pg;
    page.drawLine({ start: { x: M, y: FOOT }, end: { x: W - M, y: FOOT }, thickness: 0.5, color: LINE });
    txt([s.company_legal || s.company_name, s.company_website, s.company_email].filter(Boolean).join(' · '), M, FOOT - 14, 7, font, GREY);
    txt(`${t.page} ${i + 1}/${pages.length}`, W - M, FOOT - 14, 7, font, GREY, 'right');
  });
  return pdf.save();
}
