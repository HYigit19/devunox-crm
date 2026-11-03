import { Hono } from 'hono';
import { AppEnv, Env, addDays, getSettings, insertRow, nextNumber, pick, round2, suggestTaxMode, todayIso, uid, updateRow } from './util';
import { renderQuotePdf, money } from './pdf';
import { getAccessToken, sendMail, senderEmail, textToHtml, uploadToDrive, driveQuotesFolder } from './google';
import { draftQuote } from './ai';
import { buildTechPdf, loadTech } from './rfq';
import { storeDocument } from './work';
import { loadSignAsset } from './sign';

export const quoteRoutes = new Hono<AppEnv>();

type Item = { name: string; description?: string; qty: number; unit?: string; unit_price: number; discount_pct?: number; tax_rate?: number; product_id?: string };

export function computeTotals(items: Item[], discountPct: number, taxMode: string) {
  const lines = items.map((i) => ({ net: (Number(i.qty) || 0) * (Number(i.unit_price) || 0) * (1 - (Number(i.discount_pct) || 0) / 100), rate: Number(i.tax_rate) || 0 }));
  const subtotal = round2(lines.reduce((a, l) => a + l.net, 0));
  const discount = round2((subtotal * (Number(discountPct) || 0)) / 100);
  const net = round2(subtotal - discount);
  const factor = subtotal ? net / subtotal : 1;
  const byRate = new Map<number, number>();
  if (taxMode === 'standard') for (const l of lines) byRate.set(l.rate, (byRate.get(l.rate) || 0) + l.net * factor);
  const taxes = [...byRate.entries()].filter(([r]) => r > 0).map(([rate, base]) => ({ rate, amount: round2((base * rate) / 100) }));
  const tax_total = round2(taxes.reduce((a, t) => a + t.amount, 0));
  return { subtotal, discount, net, taxes, tax_total, total: round2(net + tax_total) };
}

const QUOTE_FIELDS = ['title', 'company_id', 'contact_id', 'deal_id', 'language', 'currency', 'tax_mode', 'issue_date', 'valid_until', 'intro', 'outro', 'discount_pct', 'status', 'signed'];

// Spalte „signed“ kommt mit Migration 0006. Bis sie eingespielt ist, läuft alles ohne sie weiter (Standard: unterschrieben).
let signedCol: boolean | null = null;
async function hasSignedCol(db: D1Database) {
  if (signedCol === null) {
    const { results } = await db.prepare('PRAGMA table_info(quotes)').all<{ name: string }>();
    signedCol = results.some((r) => r.name === 'signed');
  }
  return signedCol;
}
async function quoteData(db: D1Database, data: Record<string, unknown>) {
  if (!(await hasSignedCol(db))) delete data.signed;
  return data;
}

async function saveItems(db: D1Database, quoteId: string, items: Item[], defaultRate: number) {
  const stmts = [db.prepare('DELETE FROM quote_items WHERE quote_id = ?').bind(quoteId)];
  items.forEach((it, idx) =>
    stmts.push(
      db
        .prepare(
          'INSERT INTO quote_items (id, quote_id, pos, product_id, name, description, qty, unit, unit_price, discount_pct, tax_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          uid(), quoteId, idx + 1, it.product_id || null, it.name || '', it.description || null, Number(it.qty) || 0, it.unit || null,
          Number(it.unit_price) || 0, Number(it.discount_pct) || 0, it.tax_rate === undefined || it.tax_rate === null || (it.tax_rate as any) === '' ? defaultRate : Number(it.tax_rate),
        ),
    ),
  );
  await db.batch(stmts);
}

async function refreshTotals(db: D1Database, id: string) {
  const q = await db.prepare('SELECT discount_pct, tax_mode FROM quotes WHERE id = ?').bind(id).first<any>();
  const { results } = await db.prepare('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY pos').bind(id).all<any>();
  const t = computeTotals(results, q.discount_pct, q.tax_mode);
  await db.prepare('UPDATE quotes SET subtotal = ?, tax_total = ?, total = ? WHERE id = ?').bind(t.subtotal, t.tax_total, t.total, id).run();
  return t;
}

export async function loadQuote(env: Env, id: string) {
  const q = await env.DB.prepare(
    `SELECT q.*, co.name AS company_name, co.customer_no, TRIM(COALESCE(ct.first_name,'') || ' ' || COALESCE(ct.last_name,'')) AS contact_name, ct.email AS contact_email
     FROM quotes q LEFT JOIN companies co ON co.id = q.company_id LEFT JOIN contacts ct ON ct.id = q.contact_id WHERE q.id = ?`,
  )
    .bind(id)
    .first<any>();
  if (!q) return null;
  const { results: items } = await env.DB.prepare('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY pos').bind(id).all<any>();
  return { ...q, items, totals: computeTotals(items, q.discount_pct, q.tax_mode) };
}

export async function buildPdf(env: Env, id: string) {
  const q = await loadQuote(env, id);
  if (!q) throw new Error('Angebot nicht gefunden');
  const s = await getSettings(env.DB);
  const company = q.company_id ? await env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(q.company_id).first<any>() : null;
  const contact = q.contact_id ? await env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(q.contact_id).first<any>() : null;
  const countryName = (c?: string | null) => {
    if (!c) return '';
    try {
      return new Intl.DisplayNames([q.language === 'en' ? 'en' : 'de'], { type: 'region' }).of(c.toUpperCase()) || c;
    } catch {
      return c;
    }
  };
  const bytes = await renderQuotePdf({
    number: q.number,
    title: q.title,
    language: q.language === 'en' ? 'en' : 'de',
    currency: q.currency || 'EUR',
    tax_mode: q.tax_mode,
    issue_date: q.issue_date,
    valid_until: q.valid_until,
    intro: q.intro,
    outro: q.outro,
    discount_pct: q.discount_pct,
    items: q.items,
    totals: q.totals,
    customer_no: company?.customer_no || '',
    buyer: {
      company: company?.name,
      contact: contact ? [contact.salutation, contact.first_name, contact.last_name].filter(Boolean).join(' ') : null,
      street: company?.street,
      zip: company?.zip,
      city: company?.city,
      country: company?.country && company.country !== s.company_country ? countryName(company.country) : '',
      vat_id: company?.vat_id,
    },
    seller: { ...s, company_country: countryName(s.company_country) },
    sign: q.signed === 0 ? null : {
      signature: await loadSignAsset(env, 'signature').catch(() => null),
      stamp: await loadSignAsset(env, 'stamp').catch(() => null),
      name: s.sign_name || s.company_managing_director || '',
      role: s.sign_role || '',
      place: s.sign_place || s.company_city || '',
      date: q.issue_date || todayIso(env.TIMEZONE || 'Europe/Berlin'),
    },
  });
  return { bytes, filename: `${company?.customer_no ? company.customer_no + '_' : ''}${q.language === 'en' ? 'Proposal' : 'Angebot'}_${q.number}.pdf`, quote: q };
}

async function uploadTechToDrive(env: Env, token: string, folder: string, quoteId: string) {
  const tp = await loadTech(env, quoteId);
  if (!tp) return;
  const pdf = await buildTechPdf(env, quoteId);
  if (!pdf) return;
  const f = await uploadToDrive(token, folder, pdf.filename, pdf.bytes, tp.drive_file_id);
  await env.DB.prepare('UPDATE tech_proposals SET drive_file_id = ? WHERE quote_id = ?').bind(f.id, quoteId).run();
}

// ---------------- Routen

quoteRoutes.get('/', async (c) => {
  const status = c.req.query('status');
  const company = c.req.query('company_id');
  const where: string[] = [];
  const args: unknown[] = [];
  if (status) {
    where.push('q.status = ?');
    args.push(status);
  }
  if (company) {
    where.push('q.company_id = ?');
    args.push(company);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT q.id, q.number, q.title, q.status, q.currency, q.total, q.issue_date, q.valid_until, q.sent_at, q.company_id, q.contact_id, q.deal_id,
            co.name AS company_name, co.customer_no, TRIM(COALESCE(ct.first_name,'') || ' ' || COALESCE(ct.last_name,'')) AS contact_name
     FROM quotes q LEFT JOIN companies co ON co.id = q.company_id LEFT JOIN contacts ct ON ct.id = q.contact_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY q.created_at DESC LIMIT 500`,
  )
    .bind(...args)
    .all();
  return c.json(results);
});

quoteRoutes.post('/', async (c) => {
  const body = await c.req.json<any>();
  const s = await getSettings(c.env.DB);
  const tz = c.env.TIMEZONE || 'Europe/Berlin';
  const company = body.company_id ? await c.env.DB.prepare('SELECT country FROM companies WHERE id = ?').bind(body.company_id).first<any>() : null;
  const lang = body.language || (company?.country && !['DE', 'AT', 'CH', 'LI'].includes(company.country) ? 'en' : 'de');
  const issue = body.issue_date || todayIso(tz);
  const id = uid();
  const number = await nextNumber(c.env.DB, 'quote', s.quote_prefix || 'AN', Number(issue.slice(0, 4)));
  await insertRow(c.env.DB, 'quotes', await quoteData(c.env.DB, {
    id,
    number,
    status: 'draft',
    title: body.title || null,
    company_id: body.company_id || null,
    contact_id: body.contact_id || null,
    deal_id: body.deal_id || null,
    language: lang,
    currency: body.currency || 'EUR',
    tax_mode: body.tax_mode || suggestTaxMode(s.company_country, company?.country),
    issue_date: issue,
    valid_until: body.valid_until || addDays(issue, Number(s.quote_valid_days) || 30),
    intro: body.intro ?? s[`quote_intro_${lang}`],
    outro: body.outro ?? s[`quote_outro_${lang}`],
    discount_pct: body.discount_pct || 0,
    signed: body.signed === 0 || body.signed === false ? 0 : 1,
    created_by: c.get('user').id,
  }));
  if (Array.isArray(body.items)) await saveItems(c.env.DB, id, body.items, Number(s.default_tax_rate) || 0);
  await refreshTotals(c.env.DB, id);
  return c.json(await loadQuote(c.env, id));
});

quoteRoutes.get('/:id', async (c) => {
  const q = await loadQuote(c.env, c.req.param('id'));
  return q ? c.json(q) : c.json({ error: 'not found' }, 404);
});

quoteRoutes.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<any>();
  const s = await getSettings(c.env.DB);
  const data = pick(body, QUOTE_FIELDS);
  if ('signed' in data) data.signed = data.signed === 0 || data.signed === '0' || data.signed === false ? 0 : 1;
  await updateRow(c.env.DB, 'quotes', id, await quoteData(c.env.DB, data));
  if (Array.isArray(body.items)) await saveItems(c.env.DB, id, body.items, Number(s.default_tax_rate) || 0);
  await refreshTotals(c.env.DB, id);
  return c.json(await loadQuote(c.env, id));
});

quoteRoutes.delete('/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM quotes WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

quoteRoutes.post('/:id/duplicate', async (c) => {
  const src = await loadQuote(c.env, c.req.param('id'));
  if (!src) return c.json({ error: 'not found' }, 404);
  const s = await getSettings(c.env.DB);
  const id = uid();
  const issue = todayIso(c.env.TIMEZONE);
  await insertRow(c.env.DB, 'quotes', await quoteData(c.env.DB, {
    id,
    number: await nextNumber(c.env.DB, 'quote', s.quote_prefix || 'AN', Number(issue.slice(0, 4))),
    status: 'draft',
    title: src.title,
    company_id: src.company_id,
    contact_id: src.contact_id,
    deal_id: src.deal_id,
    language: src.language,
    currency: src.currency,
    tax_mode: src.tax_mode,
    issue_date: issue,
    valid_until: addDays(issue, Number(s.quote_valid_days) || 30),
    intro: src.intro,
    outro: src.outro,
    discount_pct: src.discount_pct,
    signed: src.signed ?? 1,
    created_by: c.get('user').id,
  }));
  await saveItems(c.env.DB, id, src.items, Number(s.default_tax_rate) || 0);
  await refreshTotals(c.env.DB, id);
  const tp = await loadTech(c.env, src.id);
  if (tp) await c.env.DB.prepare('INSERT INTO tech_proposals (id, quote_id, source_file, data) VALUES (?, ?, ?, ?)').bind(uid(), id, tp.source_file, JSON.stringify(tp.data)).run();
  return c.json({ id });
});

quoteRoutes.post('/:id/status', async (c) => {
  const id = c.req.param('id');
  const { status } = await c.req.json<{ status: string }>();
  if (!['draft', 'sent', 'accepted', 'rejected', 'expired'].includes(status)) return c.json({ error: 'Ungültiger Status' }, 400);
  await c.env.DB.prepare(`UPDATE quotes SET status = ?, decided_at = CASE WHEN ? IN ('accepted','rejected') THEN datetime('now') ELSE decided_at END, updated_at = datetime('now') WHERE id = ?`)
    .bind(status, status, id)
    .run();
  const q = await c.env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first<any>();
  if (q?.deal_id && (status === 'accepted' || status === 'rejected')) {
    await c.env.DB.prepare(`UPDATE deals SET stage = ?, probability = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(status === 'accepted' ? 'won' : 'lost', status === 'accepted' ? 100 : 0, q.deal_id)
      .run();
  }
  if (status === 'accepted' && q?.company_id) {
    try {
      const pdf = await buildPdf(c.env, id);
      await storeDocument(c.env, { company_id: q.company_id, folder: '/Angebote/', name: pdf.filename, data: pdf.bytes, mime: 'application/pdf', source: 'quote', userId: c.get('user').id });
    } catch {
      /* nicht kritisch */
    }
  }
  await c.env.DB.prepare(`INSERT INTO activities (id, type, subject, company_id, contact_id, deal_id, quote_id, done, created_by) VALUES (?, 'system', ?, ?, ?, ?, ?, 1, ?)`)
    .bind(uid(), `Angebot ${q.number}: ${({ draft: 'Entwurf', sent: 'versendet', accepted: 'angenommen', rejected: 'abgelehnt', expired: 'abgelaufen' } as Record<string, string>)[status]}`, q.company_id, q.contact_id, q.deal_id, id, c.get('user').id)
    .run();
  return c.json(await loadQuote(c.env, id));
});

quoteRoutes.get('/:id/pdf', async (c) => {
  const { bytes, filename } = await buildPdf(c.env, c.req.param('id'));
  return new Response(bytes as unknown as BodyInit, {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `${c.req.query('download') ? 'attachment' : 'inline'}; filename="${filename}"` },
  });
});

quoteRoutes.post('/:id/drive', async (c) => {
  const { bytes, filename, quote } = await buildPdf(c.env, c.req.param('id'));
  const token = await getAccessToken(c.env, c.get('user').id);
  const folder = await driveQuotesFolder(c.env, token);
  const f = await uploadToDrive(token, folder, filename, bytes, quote.drive_file_id);
  await c.env.DB.prepare('UPDATE quotes SET drive_file_id = ? WHERE id = ?').bind(f.id, quote.id).run();
  await uploadTechToDrive(c.env, token, folder, quote.id);
  return c.json({ id: f.id, link: f.webViewLink });
});

/** E-Mail-Vorschlag zum Versand */
quoteRoutes.get('/:id/mail-draft', async (c) => {
  const q = await loadQuote(c.env, c.req.param('id'));
  if (!q) return c.json({ error: 'not found' }, 404);
  const s = await getSettings(c.env.DB);
  const contact = q.contact_id ? await c.env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(q.contact_id).first<any>() : null;
  const en = q.language === 'en';
  const greet = contact
    ? en
      ? `Dear ${[contact.first_name, contact.last_name].filter(Boolean).join(' ')},`
      : contact.salutation
        ? `Guten Tag ${contact.salutation} ${contact.last_name || ''},`.replace(/\s+,/, ',')
        : `Guten Tag ${[contact.first_name, contact.last_name].filter(Boolean).join(' ')},`
    : en ? 'Dear Sir or Madam,' : 'Sehr geehrte Damen und Herren,';
  const total = money(q.total, q.currency, en ? 'en' : 'de');
  const hasTech = !!(await loadTech(c.env, q.id));
  const techLine = hasTech ? (en ? ' together with the technical specification' : ' zusammen mit der technischen Spezifikation') : '';
  const body = en
    ? `${greet}\n\nplease find attached our proposal ${q.number}${q.title ? ` – ${q.title}` : ''} (total ${total})${techLine}.\n\nI would be happy to walk you through it in a short call. Just reply to this email with a convenient time.\n\n${s.ai_signature}`
    : `${greet}\n\nanbei erhalten Sie unser Angebot ${q.number}${q.title ? ` – ${q.title}` : ''} über ${total}${techLine}.\n\nGerne gehe ich es in einem kurzen Termin mit Ihnen durch – antworten Sie einfach mit einem passenden Zeitpunkt.\n\n${s.ai_signature}`;
  return c.json({
    to: contact?.email || '',
    subject: en ? `Proposal ${q.number}${q.title ? ` – ${q.title}` : ''}` : `Angebot ${q.number}${q.title ? ` – ${q.title}` : ''}`,
    body,
    hasTech,
  });
});

quoteRoutes.post('/:id/send', async (c) => {
  const id = c.req.param('id');
  const { to, cc, subject, body, saveToDrive, includeTech = true } = await c.req.json<any>();
  if (!to || !subject) return c.json({ error: 'Empfänger und Betreff erforderlich' }, 400);
  const { bytes, filename, quote } = await buildPdf(c.env, id);
  const tech = includeTech ? await buildTechPdf(c.env, id) : null;
  const user = c.get('user');
  const s = await getSettings(c.env.DB);
  const token = await getAccessToken(c.env, user.id);
  const sent = await sendMail(token, {
    from: await senderEmail(c.env, user.id),
    fromName: user.name || s.company_name,
    to,
    cc,
    subject,
    text: body,
    html: textToHtml(body),
    attachments: [{ filename, mimeType: 'application/pdf', data: bytes }, ...(tech ? [{ filename: tech.filename, mimeType: 'application/pdf', data: tech.bytes }] : [])],
  });
  if (saveToDrive) {
    try {
      const folder = await driveQuotesFolder(c.env, token);
      const f = await uploadToDrive(token, folder, filename, bytes, quote.drive_file_id);
      await c.env.DB.prepare('UPDATE quotes SET drive_file_id = ? WHERE id = ?').bind(f.id, id).run();
      if (tech) await uploadTechToDrive(c.env, token, folder, id);
    } catch {
      /* Versand war erfolgreich – Drive-Fehler nicht blockierend */
    }
  }
  // Versendete PDFs in der Dokumentenablage des Kunden ablegen (Ordner /Angebote/)
  try {
    if (quote.company_id) {
      await storeDocument(c.env, { company_id: quote.company_id, folder: '/Angebote/', name: filename, data: bytes, mime: 'application/pdf', source: 'quote', userId: user.id });
      if (tech) await storeDocument(c.env, { company_id: quote.company_id, folder: '/Technische Spezifikationen/', name: tech.filename, data: tech.bytes, mime: 'application/pdf', source: 'tech', userId: user.id });
    }
  } catch {
    /* Ablage nicht kritisch */
  }
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE quotes SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END, sent_at = datetime('now') WHERE id = ?`).bind(id),
    c.env.DB.prepare(
      `INSERT INTO activities (id, type, subject, body, company_id, contact_id, deal_id, quote_id, done, gmail_thread_id, created_by) VALUES (?, 'email', ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(uid(), subject, body, quote.company_id, quote.contact_id, quote.deal_id, id, sent.threadId, user.id),
    ...(quote.deal_id ? [c.env.DB.prepare(`UPDATE deals SET stage = 'proposal', probability = MAX(probability, 50) WHERE id = ? AND stage IN ('lead','qualified')`).bind(quote.deal_id)] : []),
  ]);
  return c.json({ ok: true, threadId: sent.threadId });
});

quoteRoutes.post('/ai-draft', async (c) => {
  const body = await c.req.json<any>();
  const { results: products } = await c.env.DB.prepare('SELECT * FROM products WHERE active = 1').all();
  const out = await draftQuote(c.env, { request: body.request, products, language: body.language || 'de', currency: body.currency || 'EUR', customer: body.customer });
  return c.json(out);
});

quoteRoutes.post('/:id/archive', async (c) => {
  const id = c.req.param('id');
  const { bytes, filename, quote } = await buildPdf(c.env, id);
  if (!quote.company_id) return c.json({ error: 'Bitte zuerst eine Firma wählen.' }, 400);
  await storeDocument(c.env, { company_id: quote.company_id, folder: '/Angebote/', name: filename, data: bytes, mime: 'application/pdf', source: 'quote', userId: c.get('user').id });
  const tech = await buildTechPdf(c.env, id);
  if (tech) await storeDocument(c.env, { company_id: quote.company_id, folder: '/Technische Spezifikationen/', name: tech.filename, data: tech.bytes, mime: 'application/pdf', source: 'tech', userId: c.get('user').id });
  return c.json({ ok: true });
});
