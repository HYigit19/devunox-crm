// Zeiterfassung, Kundenakte (Zeitleiste aller Arbeiten), globale Suche, Projekt-Statusbericht
import { Hono } from 'hono';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { AppEnv, Env, getSettings, insertRow, todayIso, uid, updateRow } from './util';
import { DARK, GREY, LINE, ORANGE, SOFT, clean, drawBrandHeader, embedLogo, fmtDate, wrap } from './pdf';
import { storeDocument } from './work';

// ======================================================================= Zeiterfassung

export const timeRoutes = new Hono<AppEnv>();

const TIME_SELECT = `SELECT te.*, t.title AS task_title, p.name AS project_name, co.name AS company_name, co.customer_no, u.name AS user_name
  FROM time_entries te LEFT JOIN tasks t ON t.id = te.task_id LEFT JOIN projects p ON p.id = te.project_id
  LEFT JOIN companies co ON co.id = te.company_id LEFT JOIN users u ON u.id = te.user_id`;

function timeFilter(c: any) {
  const where: string[] = [];
  const args: unknown[] = [];
  for (const k of ['company_id', 'project_id', 'task_id', 'user_id']) {
    const v = c.req.query(k);
    if (v) {
      where.push(`te.${k} = ?`);
      args.push(v);
    }
  }
  if (c.req.query('from')) {
    where.push('te.date >= ?');
    args.push(c.req.query('from'));
  }
  if (c.req.query('to')) {
    where.push('te.date <= ?');
    args.push(c.req.query('to'));
  }
  return { where: where.length ? 'WHERE ' + where.join(' AND ') : '', args };
}

timeRoutes.get('/', async (c) => {
  const { where, args } = timeFilter(c);
  const { results } = await c.env.DB.prepare(`${TIME_SELECT} ${where} ORDER BY te.date DESC, te.created_at DESC LIMIT 2000`).bind(...args).all();
  const total = (results as any[]).reduce((a, r) => a + r.minutes, 0);
  const billable = (results as any[]).filter((r) => r.billable).reduce((a, r) => a + r.minutes, 0);
  return c.json({ entries: results, total_minutes: total, billable_minutes: billable });
});

timeRoutes.get('/export.csv', async (c) => {
  const { where, args } = timeFilter(c);
  const { results } = await c.env.DB.prepare(`${TIME_SELECT} ${where} ORDER BY te.date, te.created_at`).bind(...args).all<any>();
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [
    ['Datum', 'Kundennr.', 'Kunde', 'Projekt', 'Aufgabe', 'Beschreibung', 'Stunden', 'Abrechenbar', 'Mitarbeiter'],
    ...results.map((r) => [r.date, r.customer_no, r.company_name, r.project_name, r.task_title, r.description, (r.minutes / 60).toFixed(2).replace('.', ','), r.billable ? 'ja' : 'nein', r.user_name]),
  ];
  return new Response('﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n'), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="Zeiterfassung_${todayIso()}.csv"` },
  });
});

async function resolveScope(env: Env, body: any) {
  let { company_id, project_id } = body;
  if (body.task_id) {
    const t = await env.DB.prepare('SELECT project_id, company_id FROM tasks WHERE id = ?').bind(body.task_id).first<any>();
    project_id = project_id || t?.project_id || null;
    company_id = company_id || t?.company_id || null;
  }
  if (project_id && !company_id) company_id = (await env.DB.prepare('SELECT company_id FROM projects WHERE id = ?').bind(project_id).first<any>())?.company_id || null;
  return { company_id: company_id || null, project_id: project_id || null };
}

timeRoutes.post('/', async (c) => {
  const body = await c.req.json<any>();
  const minutes = Math.round(Number(body.minutes));
  if (!minutes || minutes < 1 || minutes > 24 * 60) return c.json({ error: 'Bitte eine Dauer zwischen 1 Minute und 24 Stunden angeben.' }, 400);
  const scope = await resolveScope(c.env, body);
  const id = uid();
  await insertRow(c.env.DB, 'time_entries', {
    id, ...scope, task_id: body.task_id || null, user_id: c.get('user').id, date: body.date || todayIso(c.env.TIMEZONE), minutes, description: body.description || null, billable: body.billable === 0 ? 0 : 1,
  });
  return c.json(await c.env.DB.prepare(`${TIME_SELECT} WHERE te.id = ?`).bind(id).first());
});

timeRoutes.put('/:id', async (c) => {
  const body = await c.req.json<any>();
  const data: Record<string, unknown> = {};
  for (const k of ['date', 'minutes', 'description', 'billable', 'task_id', 'project_id']) if (k in body) data[k] = body[k];
  await updateRow(c.env.DB, 'time_entries', c.req.param('id'), data, false);
  return c.json({ ok: true });
});

timeRoutes.delete('/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM time_entries WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ======================================================================= Kundenakte

export const insightRoutes = new Hono<AppEnv>();

/** Übersicht + Zeitleiste aller Arbeiten für einen Kunden */
insightRoutes.get('/companies/:id/file', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const [co, quotes, tasks, docs, time, acts, projects, timeByProject] = await db.batch([
    db.prepare('SELECT * FROM companies WHERE id = ?').bind(id),
    db.prepare('SELECT id, number, title, status, total, currency, issue_date, sent_at, decided_at, created_at FROM quotes WHERE company_id = ?').bind(id),
    db.prepare('SELECT t.id, t.title, t.status, t.source, t.created_at, t.completed_at, p.name AS project_name FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE t.company_id = ?').bind(id),
    db.prepare('SELECT id, name, folder, source, size, created_at FROM documents WHERE company_id = ?').bind(id),
    db.prepare('SELECT te.id, te.date, te.minutes, te.description, te.billable, te.created_at, t.title AS task_title, p.name AS project_name FROM time_entries te LEFT JOIN tasks t ON t.id = te.task_id LEFT JOIN projects p ON p.id = te.project_id WHERE te.company_id = ?').bind(id),
    db.prepare(`SELECT id, type, subject, body, created_at, contact_id, task_id FROM activities WHERE company_id = ? AND type != 'system' ORDER BY created_at DESC LIMIT 300`).bind(id),
    db.prepare('SELECT id, name, status, created_at FROM projects WHERE company_id = ?').bind(id),
    db.prepare(`SELECT COALESCE(p.name, 'Ohne Projekt') AS project, SUM(te.minutes) AS minutes, SUM(CASE WHEN te.billable = 1 THEN te.minutes ELSE 0 END) AS billable
                FROM time_entries te LEFT JOIN projects p ON p.id = te.project_id WHERE te.company_id = ? GROUP BY p.id ORDER BY minutes DESC`).bind(id),
  ]);
  const company = co.results[0] as any;
  if (!company) return c.json({ error: 'not found' }, 404);
  type Ev = { at: string; kind: string; title: string; detail?: string; link?: string; ref?: string };
  const ev: Ev[] = [];
  for (const q of quotes.results as any[]) {
    ev.push({ at: q.created_at, kind: 'quote', title: `Angebot ${q.number} erstellt`, detail: q.title, link: `#/quotes/${q.id}` });
    if (q.sent_at) ev.push({ at: q.sent_at, kind: 'quote', title: `Angebot ${q.number} versendet`, detail: q.title, link: `#/quotes/${q.id}` });
    if (q.decided_at) ev.push({ at: q.decided_at, kind: q.status === 'accepted' ? 'won' : 'lost', title: `Angebot ${q.number} ${q.status === 'accepted' ? 'angenommen' : 'abgelehnt'}`, link: `#/quotes/${q.id}` });
  }
  for (const t of tasks.results as any[]) {
    ev.push({ at: t.created_at, kind: t.source === 'review' ? 'feedback' : 'task', title: `${t.source === 'review' ? 'Feedback' : 'Aufgabe'}: ${t.title}`, detail: t.project_name, ref: t.id });
    if (t.completed_at) ev.push({ at: t.completed_at, kind: 'done', title: `Erledigt: ${t.title}`, detail: t.project_name, ref: t.id });
  }
  for (const d of docs.results as any[]) ev.push({ at: d.created_at, kind: 'doc', title: `Dokument: ${d.name}`, detail: d.folder, link: `/api/documents/${d.id}/file` });
  for (const te of time.results as any[]) ev.push({ at: te.created_at, kind: 'time', title: `${(te.minutes / 60).toFixed(2).replace('.', ',')} h erfasst${te.task_title ? ` – ${te.task_title}` : ''}`, detail: [te.project_name, te.description].filter(Boolean).join(' · ') });
  for (const a of acts.results as any[]) ev.push({ at: a.created_at, kind: a.type === 'email' || a.type === 'agent' ? 'mail' : 'note', title: a.subject || a.type, detail: (a.body || '').slice(0, 240), ref: a.task_id || undefined });
  for (const p of projects.results as any[]) ev.push({ at: p.created_at, kind: 'project', title: `Projekt angelegt: ${p.name}`, link: `#/projects/${p.id}` });
  const norm = (s: string) => (s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  ev.sort((a, b) => norm(b.at).localeCompare(norm(a.at)));
  const q = quotes.results as any[];
  const tk = tasks.results as any[];
  const minutes = (time.results as any[]).reduce((a, r) => a + r.minutes, 0);
  return c.json({
    company,
    stats: {
      won: q.filter((x) => x.status === 'accepted').reduce((a, x) => a + x.total, 0),
      open_quotes: q.filter((x) => x.status === 'sent').length,
      quotes: q.length,
      projects: (projects.results as any[]).filter((p) => p.status !== 'done').length,
      tasks_open: tk.filter((t) => t.status !== 'done').length,
      tasks_done: tk.filter((t) => t.status === 'done').length,
      feedback_open: tk.filter((t) => t.source === 'review' && t.status !== 'done').length,
      documents: (docs.results as any[]).length,
      minutes,
      billable_minutes: (time.results as any[]).filter((r) => r.billable).reduce((a, r) => a + r.minutes, 0),
    },
    time_by_project: timeByProject.results,
    events: ev.slice(0, 400),
  });
});

// ======================================================================= Suche

insightRoutes.get('/search', async (c) => {
  const q = (c.req.query('q') || '').trim();
  if (q.length < 2) return c.json([]);
  const like = `%${q}%`;
  const db = c.env.DB;
  const [co, ct, qu, pr, tk, dc] = await db.batch([
    db.prepare(`SELECT id, name, customer_no, city FROM companies WHERE name LIKE ?1 OR customer_no LIKE ?1 OR city LIKE ?1 LIMIT 6`).bind(like),
    db.prepare(`SELECT ct.id, ct.first_name, ct.last_name, ct.email, co.name AS company_name FROM contacts ct LEFT JOIN companies co ON co.id = ct.company_id
                WHERE ct.first_name LIKE ?1 OR ct.last_name LIKE ?1 OR ct.email LIKE ?1 OR (ct.first_name || ' ' || ct.last_name) LIKE ?1 LIMIT 6`).bind(like),
    db.prepare(`SELECT q.id, q.number, q.title, co.name AS company_name FROM quotes q LEFT JOIN companies co ON co.id = q.company_id WHERE q.number LIKE ?1 OR q.title LIKE ?1 OR co.customer_no LIKE ?1 LIMIT 6`).bind(like),
    db.prepare(`SELECT p.id, p.name, co.name AS company_name FROM projects p LEFT JOIN companies co ON co.id = p.company_id WHERE p.name LIKE ?1 OR p.review_slug LIKE ?1 LIMIT 6`).bind(like),
    db.prepare(`SELECT t.id, t.title, p.name AS project_name FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE t.title LIKE ?1 LIMIT 6`).bind(like),
    db.prepare(`SELECT d.id, d.name, co.name AS company_name, co.customer_no FROM documents d LEFT JOIN companies co ON co.id = d.company_id WHERE d.name LIKE ?1 OR d.tags LIKE ?1 LIMIT 6`).bind(like),
  ]);
  const out: { type: string; id: string; title: string; sub?: string; href: string }[] = [];
  for (const r of co.results as any[]) out.push({ type: 'Kunde', id: r.id, title: r.name, sub: [r.customer_no, r.city].filter(Boolean).join(' · '), href: `#/companies/${r.id}` });
  for (const r of ct.results as any[]) out.push({ type: 'Kontakt', id: r.id, title: [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email, sub: r.company_name, href: `#/contacts/${r.id}` });
  for (const r of qu.results as any[]) out.push({ type: 'Angebot', id: r.id, title: `${r.number} ${r.title || ''}`.trim(), sub: r.company_name, href: `#/quotes/${r.id}` });
  for (const r of pr.results as any[]) out.push({ type: 'Projekt', id: r.id, title: r.name, sub: r.company_name, href: `#/projects/${r.id}` });
  for (const r of tk.results as any[]) out.push({ type: 'Aufgabe', id: r.id, title: r.title, sub: r.project_name, href: `#/tasks?open=${r.id}` });
  for (const r of dc.results as any[]) out.push({ type: 'Dokument', id: r.id, title: r.name, sub: [r.customer_no, r.company_name].filter(Boolean).join(' · '), href: `/api/documents/${r.id}/file` });
  return c.json(out);
});

// ======================================================================= Projekt-Statusbericht (PDF)

const R = {
  de: {
    doc: 'Projektstatusbericht', customer: 'Kunde', custNo: 'Kundennr.', date: 'Stand', period: 'Zeitraum', progress: 'Fortschritt', of: 'von', tasksDone: 'Aufgaben erledigt',
    open: 'Offen', doing: 'In Arbeit', review: 'Beim Kunden zur Prüfung', done: 'Erledigt', hours: 'Erfasste Zeit', billable: 'davon abrechenbar', h: 'Std.',
    s1: '1. Überblick', s2: '2. Erledigt im Zeitraum', s3: '3. In Arbeit und offen', s4: '4. Kunden-Feedback (devunox Review)', s5: '5. Aufwand', month: 'Monat', none: 'Keine Einträge.',
    task: 'Aufgabe', status: 'Status', due: 'Fällig', page: 'Seite', feedbackOpen: 'offen', feedbackDone: 'erledigt',
  },
  en: {
    doc: 'Project status report', customer: 'Customer', custNo: 'Customer no.', date: 'As of', period: 'Period', progress: 'Progress', of: 'of', tasksDone: 'tasks completed',
    open: 'Open', doing: 'In progress', review: 'With customer for review', done: 'Done', hours: 'Time logged', billable: 'billable', h: 'h',
    s1: '1. Overview', s2: '2. Completed in period', s3: '3. In progress and open', s4: '4. Customer feedback (devunox Review)', s5: '5. Effort', month: 'Month', none: 'No entries.',
    task: 'Task', status: 'Status', due: 'Due', page: 'Page', feedbackOpen: 'open', feedbackDone: 'done',
  },
};

export async function renderProjectReport(env: Env, projectId: string, lang: 'de' | 'en', days = 30) {
  const t = R[lang];
  const p = await env.DB.prepare('SELECT p.*, co.name AS company_name, co.customer_no FROM projects p LEFT JOIN companies co ON co.id = p.company_id WHERE p.id = ?').bind(projectId).first<any>();
  if (!p) throw new Error('Projekt nicht gefunden');
  const s = await getSettings(env.DB);
  const { results: tasks } = await env.DB.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY sort, created_at').bind(projectId).all<any>();
  const { results: time } = await env.DB.prepare(`SELECT substr(date,1,7) AS month, SUM(minutes) AS minutes, SUM(CASE WHEN billable=1 THEN minutes ELSE 0 END) AS billable FROM time_entries WHERE project_id = ? GROUP BY month ORDER BY month`).bind(projectId).all<any>();
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const statusLabel: Record<string, string> = { todo: t.open, doing: t.doing, review: t.review, done: t.done };
  const done = tasks.filter((x) => x.status === 'done');
  const doneRecent = done.filter((x) => (x.completed_at || '') >= since.slice(0, 10));
  const openList = tasks.filter((x) => x.status !== 'done');
  const fb = tasks.filter((x) => x.source === 'review');
  const totalMin = time.reduce((a, r) => a + r.minutes, 0);
  const billMin = time.reduce((a, r) => a + r.billable, 0);
  const n = (v: number) => new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: 1 }).format(v);

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${t.doc} – ${p.name}`);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedLogo(pdf);
  const W = 595.28, H = 841.89, M = 56, CW = W - 2 * M, FOOT = 60;
  const pages: any[] = [];
  let page: any;
  let y = 0;
  const txt = (str: string, x: number, yy: number, size = 9.5, f = font, color = DARK, align: 'left' | 'right' = 'left') => {
    const c2 = clean(str);
    page.drawText(c2, { x: align === 'right' ? x - f.widthOfTextAtSize(c2, size) : x, y: yy, size, font: f, color });
  };
  const newPage = () => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    drawBrandHeader(page, logo, W, H, M, 110);
    txt(`${t.doc} · ${p.customer_no || ''}`, W - M, H - 50, 8.5, font, GREY, 'right');
    y = H - 84;
  };
  const ensure = (h: number) => y - h < FOOT + 14 && newPage();
  const heading = (str: string) => {
    ensure(50);
    y -= 8;
    page.drawRectangle({ x: M, y: y - 2, width: 3.5, height: 15, color: ORANGE });
    txt(str, M + 11, y, 13, bold);
    y -= 22;
  };
  const table = (cols: { h: string; w: number; align?: 'right' }[], rows: string[][]) => {
    if (!rows.length) {
      txt(t.none, M, y, 9.5, font, GREY);
      y -= 18;
      return;
    }
    const xs: number[] = [];
    cols.reduce((x, c2) => (xs.push(x), x + c2.w), M);
    const head = () => {
      page.drawRectangle({ x: M - 4, y: y - 5, width: CW + 8, height: 18, color: DARK });
      cols.forEach((c2, i) => txt(c2.h, c2.align === 'right' ? xs[i] + c2.w - 4 : xs[i], y, 8, bold, rgb(1, 1, 1), c2.align || 'left'));
      y -= 19;
    };
    ensure(40);
    head();
    rows.forEach((r, ri) => {
      const cells = r.map((v, i) => wrap(v || '', font, 8.5, cols[i].w - 8));
      const h = Math.max(...cells.map((x) => x.length)) * 11 + 6;
      if (y - h < FOOT + 14) {
        newPage();
        head();
      }
      if (ri % 2) page.drawRectangle({ x: M - 4, y: y - h + 9, width: CW + 8, height: h, color: SOFT });
      cells.forEach((lines, i) => lines.forEach((l, li) => txt(l, cols[i].align === 'right' ? xs[i] + cols[i].w - 4 : xs[i], y - li * 11, 8.5, font, DARK, cols[i].align || 'left')));
      y -= h;
    });
    y -= 10;
  };

  newPage();
  y -= 10;
  txt(t.doc, M, y, 24, bold);
  page.drawRectangle({ x: M, y: y - 10, width: 40, height: 3.5, color: ORANGE });
  y -= 30;
  txt(p.name, M, y, 13, font, GREY);
  y -= 22;
  for (const [k, v] of [[t.customer, p.company_name || '–'], [t.custNo, p.customer_no || '–'], [t.date, fmtDate(todayIso(env.TIMEZONE), lang)], [t.period, `${lang === 'de' ? 'letzte' : 'last'} ${days} ${lang === 'de' ? 'Tage' : 'days'}`]] as [string, string][]) {
    txt(k, M, y, 9, font, GREY);
    txt(v, M + 90, y, 9.5, bold);
    y -= 14;
  }
  y -= 8;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: LINE });
  y -= 14;

  heading(t.s1);
  const pct = tasks.length ? Math.round((done.length / tasks.length) * 100) : 0;
  // Kennzahlen-Kacheln
  const tiles: [string, string][] = [
    [`${pct} %`, `${t.progress} · ${done.length} ${t.of} ${tasks.length} ${t.tasksDone}`],
    [String(tasks.filter((x) => x.status === 'doing').length), t.doing],
    [String(tasks.filter((x) => x.status === 'review').length), t.review],
    [`${n(totalMin / 60)} ${t.h}`, `${t.hours} · ${n(billMin / 60)} ${t.billable}`],
  ];
  const tw = (CW - 3 * 10) / 4;
  tiles.forEach(([big, small], i) => {
    const x = M + i * (tw + 10);
    page.drawRectangle({ x, y: y - 52, width: tw, height: 62, color: i === 0 ? DARK : SOFT });
    txt(big, x + 10, y - 14, 17, bold, i === 0 ? ORANGE : DARK);
    wrap(small, font, 7.5, tw - 20).slice(0, 3).forEach((l, li) => txt(l, x + 10, y - 30 - li * 9, 7.5, font, i === 0 ? rgb(0.85, 0.85, 0.88) : GREY));
  });
  y -= 66;
  page.drawRectangle({ x: M, y, width: CW, height: 6, color: SOFT });
  page.drawRectangle({ x: M, y, width: (CW * pct) / 100, height: 6, color: ORANGE });
  y -= 22;
  if (p.description) {
    for (const l of wrap(p.description, font, 9.5, CW)) {
      ensure(14);
      txt(l, M, y, 9.5);
      y -= 13;
    }
    y -= 6;
  }

  heading(t.s2);
  table([{ h: t.task, w: CW - 90 }, { h: t.done, w: 90, align: 'right' }], doneRecent.map((x) => [x.title, fmtDate(x.completed_at, lang)]));
  heading(t.s3);
  table(
    [{ h: t.task, w: CW - 170 }, { h: t.status, w: 110 }, { h: t.due, w: 60, align: 'right' }],
    openList.map((x) => [x.title, statusLabel[x.status], x.due_at ? fmtDate(x.due_at, lang) : '–']),
  );
  if (fb.length) {
    heading(t.s4);
    txt(`${fb.filter((x) => x.status !== 'done').length} ${t.feedbackOpen} · ${fb.filter((x) => x.status === 'done').length} ${t.feedbackDone}`, M, y, 9.5, font, GREY);
    y -= 16;
  }
  heading(t.s5);
  table(
    [{ h: t.month, w: CW - 180 }, { h: t.hours, w: 90, align: 'right' }, { h: t.billable, w: 90, align: 'right' }],
    time.map((r) => [new Date(r.month + '-15T12:00:00Z').toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', { month: 'long', year: 'numeric' }), `${n(r.minutes / 60)} ${t.h}`, `${n(r.billable / 60)} ${t.h}`]),
  );

  pages.forEach((pg, i) => {
    page = pg;
    page.drawLine({ start: { x: M, y: FOOT }, end: { x: W - M, y: FOOT }, thickness: 0.5, color: LINE });
    txt([s.company_legal || s.company_name, s.company_website, s.company_email].filter(Boolean).join(' · '), M, FOOT - 14, 7, font, GREY);
    txt(`${t.page} ${i + 1}/${pages.length}`, W - M, FOOT - 14, 7, font, GREY, 'right');
  });
  const bytes = await pdf.save();
  const filename = `${p.customer_no ? p.customer_no + '_' : ''}${lang === 'en' ? 'Status_Report' : 'Statusbericht'}_${p.name.replace(/[^\w\-äöüÄÖÜß ]+/g, '').trim().replace(/\s+/g, '_')}_${todayIso(env.TIMEZONE)}.pdf`;
  return { bytes, filename, project: p };
}

insightRoutes.get('/projects/:id/report', async (c) => {
  const lang = c.req.query('lang') === 'en' ? 'en' : 'de';
  const r = await renderProjectReport(c.env, c.req.param('id'), lang, Number(c.req.query('days')) || 30);
  if (c.req.query('archive') && r.project.company_id) {
    await storeDocument(c.env, { company_id: r.project.company_id, project_id: r.project.id, folder: '/Berichte/', name: r.filename, data: r.bytes, mime: 'application/pdf', source: 'report', userId: c.get('user').id });
  }
  return new Response(r.bytes as unknown as BodyInit, { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${r.filename}"` } });
});
