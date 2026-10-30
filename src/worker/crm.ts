import { Hono } from 'hono';
import { AppEnv, insertRow, pick, uid, updateRow, getSettings } from './util';
import { getAccessToken, listMailsWith, sendMail, textToHtml, createEvent } from './google';
import { researchCompany, draftEmail } from './ai';
import { createCompany } from './work';

export const crmRoutes = new Hono<AppEnv>();

const COMPANY_FIELDS = ['name', 'website', 'industry', 'size', 'street', 'zip', 'city', 'country', 'vat_id', 'phone', 'email', 'tags', 'notes', 'research'];
const CONTACT_FIELDS = ['company_id', 'salutation', 'first_name', 'last_name', 'email', 'phone', 'position', 'linkedin', 'language', 'country', 'consent', 'consent_note', 'tags', 'notes'];
const DEAL_FIELDS = ['title', 'company_id', 'contact_id', 'stage', 'value', 'currency', 'probability', 'expected_close', 'source', 'notes'];

function upperCountry(d: Record<string, unknown>) {
  if (typeof d.country === 'string') d.country = d.country.trim().toUpperCase().slice(0, 2) || null;
  return d;
}

// ---------------- Firmen
crmRoutes.get('/companies', async (c) => {
  const q = c.req.query('q');
  const { results } = await c.env.DB.prepare(
    `SELECT co.*, (SELECT COUNT(*) FROM contacts WHERE company_id = co.id) AS contact_count,
            (SELECT COUNT(*) FROM deals WHERE company_id = co.id AND stage NOT IN ('won','lost')) AS open_deals
     FROM companies co ${q ? 'WHERE co.name LIKE ?1 OR co.city LIKE ?1 OR co.tags LIKE ?1 OR co.industry LIKE ?1 OR co.customer_no LIKE ?1' : ''}
     ORDER BY co.name COLLATE NOCASE LIMIT 1000`,
  )
    .bind(...(q ? [`%${q}%`] : []))
    .all();
  return c.json(results);
});
crmRoutes.post('/companies', async (c) => {
  const body = await c.req.json<any>();
  if (!body.name) return c.json({ error: 'Name fehlt' }, 400);
  const { id } = await createCompany(c.env, upperCountry(pick(body, COMPANY_FIELDS)), c.get('user').id);
  return c.json(await c.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(id).first());
});
crmRoutes.get('/companies/:id', async (c) => {
  const id = c.req.param('id');
  const company = await c.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(id).first();
  if (!company) return c.json({ error: 'not found' }, 404);
  const [contacts, deals, quotes] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM contacts WHERE company_id = ? ORDER BY last_name').bind(id),
    c.env.DB.prepare('SELECT * FROM deals WHERE company_id = ? ORDER BY updated_at DESC').bind(id),
    c.env.DB.prepare('SELECT id, number, title, status, total, currency, issue_date FROM quotes WHERE company_id = ? ORDER BY created_at DESC').bind(id),
  ]);
  return c.json({ ...company, contacts: contacts.results, deals: deals.results, quotes: quotes.results });
});
crmRoutes.put('/companies/:id', async (c) => {
  await updateRow(c.env.DB, 'companies', c.req.param('id'), upperCountry(pick(await c.req.json(), COMPANY_FIELDS)));
  return c.json(await c.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(c.req.param('id')).first());
});
crmRoutes.delete('/companies/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM companies WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});
crmRoutes.post('/companies/:id/research', async (c) => {
  const id = c.req.param('id');
  const co = await c.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(id).first<any>();
  if (!co) return c.json({ error: 'not found' }, 404);
  const research = await researchCompany(c.env, co);
  await c.env.DB.prepare(`UPDATE companies SET research = ?, updated_at = datetime('now') WHERE id = ?`).bind(research, id).run();
  return c.json({ research });
});

// ---------------- Kontakte
crmRoutes.get('/contacts', async (c) => {
  const q = c.req.query('q');
  const tag = c.req.query('tag');
  const consent = c.req.query('consent');
  const where: string[] = [];
  const args: unknown[] = [];
  if (q) {
    where.push(`(ct.first_name LIKE ? OR ct.last_name LIKE ? OR ct.email LIKE ? OR co.name LIKE ? OR ct.position LIKE ?)`);
    args.push(...Array(5).fill(`%${q}%`));
  }
  if (tag) {
    where.push(`(',' || REPLACE(COALESCE(ct.tags,''), ' ', '') || ',') LIKE ?`);
    args.push(`%,${tag.replace(/\s/g, '')},%`);
  }
  if (consent) {
    where.push('ct.consent = ?');
    args.push(consent);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT ct.*, co.name AS company_name, co.country AS company_country FROM contacts ct LEFT JOIN companies co ON co.id = ct.company_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ct.updated_at DESC LIMIT 2000`,
  )
    .bind(...args)
    .all();
  return c.json(results);
});
crmRoutes.post('/contacts', async (c) => {
  const body = await c.req.json<any>();
  const id = uid();
  await insertRow(c.env.DB, 'contacts', { id, ...upperCountry(pick(body, CONTACT_FIELDS)), owner_id: c.get('user').id });
  return c.json(await c.env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(id).first());
});
crmRoutes.get('/contacts/:id', async (c) => {
  const id = c.req.param('id');
  const ct = await c.env.DB.prepare(
    'SELECT ct.*, co.name AS company_name, co.country AS company_country FROM contacts ct LEFT JOIN companies co ON co.id = ct.company_id WHERE ct.id = ?',
  )
    .bind(id)
    .first();
  if (!ct) return c.json({ error: 'not found' }, 404);
  const [deals, quotes, enr] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM deals WHERE contact_id = ? ORDER BY updated_at DESC').bind(id),
    c.env.DB.prepare('SELECT id, number, title, status, total, currency, issue_date FROM quotes WHERE contact_id = ? ORDER BY created_at DESC').bind(id),
    c.env.DB.prepare('SELECT e.*, k.name AS campaign_name FROM enrollments e JOIN campaigns k ON k.id = e.campaign_id WHERE e.contact_id = ?').bind(id),
  ]);
  return c.json({ ...ct, deals: deals.results, quotes: quotes.results, enrollments: enr.results });
});
crmRoutes.put('/contacts/:id', async (c) => {
  await updateRow(c.env.DB, 'contacts', c.req.param('id'), upperCountry(pick(await c.req.json(), CONTACT_FIELDS)));
  return c.json(await c.env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(c.req.param('id')).first());
});
crmRoutes.delete('/contacts/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM contacts WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

/** CSV-Import (z. B. aus LinkedIn Sales Navigator / Apollo). Firmen werden per Name zugeordnet oder angelegt. */
crmRoutes.post('/contacts/import', async (c) => {
  const { rows, tags, consent } = await c.req.json<{ rows: Record<string, string>[]; tags?: string; consent?: string }>();
  if (!Array.isArray(rows) || !rows.length) return c.json({ error: 'Keine Zeilen' }, 400);
  if (rows.length > 2000) return c.json({ error: 'Max. 2000 Zeilen pro Import' }, 400);
  const userId = c.get('user').id;
  const { results: existingCos } = await c.env.DB.prepare('SELECT id, name FROM companies').all<{ id: string; name: string }>();
  const coByName = new Map(existingCos.map((x) => [x.name.trim().toLowerCase(), x.id]));
  const { results: existingMails } = await c.env.DB.prepare('SELECT LOWER(email) AS e FROM contacts WHERE email IS NOT NULL').all<{ e: string }>();
  const mails = new Set(existingMails.map((x) => x.e));
  const stmts: D1PreparedStatement[] = [];
  let created = 0, skipped = 0, companies = 0;
  for (const r of rows) {
    const email = (r.email || '').trim().toLowerCase();
    if (email && mails.has(email)) {
      skipped++;
      continue;
    }
    if (!r.first_name && !r.last_name && !email) {
      skipped++;
      continue;
    }
    let companyId: string | null = null;
    const coName = (r.company || '').trim();
    if (coName) {
      companyId = coByName.get(coName.toLowerCase()) || null;
      if (!companyId) {
        companyId = (
          await createCompany(
            c.env,
            { name: coName, website: r.website || null, industry: r.industry || null, city: r.city || null, country: (r.country || '').toUpperCase().slice(0, 2) || null },
            userId,
          )
        ).id;
        coByName.set(coName.toLowerCase(), companyId);
        companies++;
      }
    }
    if (email) mails.add(email);
    const tagList = [r.tags, tags].filter(Boolean).join(',');
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO contacts (id, company_id, salutation, first_name, last_name, email, phone, position, linkedin, language, country, consent, tags, owner_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        uid(), companyId, r.salutation || null, r.first_name || null, r.last_name || null, email || null, r.phone || null, r.position || null,
        r.linkedin || null, r.language || null, (r.country || '').toUpperCase().slice(0, 2) || null, consent || 'none', tagList || null, userId,
      ),
    );
    created++;
  }
  for (let i = 0; i < stmts.length; i += 80) await c.env.DB.batch(stmts.slice(i, i + 80));
  return c.json({ created, skipped, companies });
});

crmRoutes.get('/contacts/:id/emails', async (c) => {
  const ct = await c.env.DB.prepare('SELECT email FROM contacts WHERE id = ?').bind(c.req.param('id')).first<{ email: string }>();
  if (!ct?.email) return c.json([]);
  const token = await getAccessToken(c.env, c.get('user').id);
  return c.json(await listMailsWith(token, ct.email, 25));
});

crmRoutes.post('/contacts/:id/ai-email', async (c) => {
  const { purpose, language, quote_id } = await c.req.json<any>();
  const contact = await c.env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(c.req.param('id')).first<any>();
  const company = contact?.company_id ? await c.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(contact.company_id).first<any>() : null;
  const quote = quote_id ? await c.env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(quote_id).first<any>() : null;
  const s = await getSettings(c.env.DB);
  const lang = language || contact?.language || 'de';
  const out = await draftEmail(c.env, { contact, company, purpose, language: lang, quote });
  return c.json({ subject: out.subject, body: `${out.body.trim()}\n\n${s.ai_signature}` });
});

crmRoutes.post('/contacts/:id/send-email', async (c) => {
  const id = c.req.param('id');
  const { subject, body, cc } = await c.req.json<any>();
  const ct = await c.env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(id).first<any>();
  if (!ct?.email) return c.json({ error: 'Kontakt hat keine E-Mail-Adresse' }, 400);
  if (ct.consent === 'opt_out') return c.json({ error: 'Kontakt hat sich abgemeldet – kein Versand.' }, 400);
  const user = c.get('user');
  const token = await getAccessToken(c.env, user.id);
  const sent = await sendMail(token, { from: user.email, fromName: user.name || undefined, to: ct.email, cc, subject, text: body, html: textToHtml(body) });
  await c.env.DB.prepare(
    `INSERT INTO activities (id, type, subject, body, contact_id, company_id, done, gmail_thread_id, created_by) VALUES (?, 'email', ?, ?, ?, ?, 1, ?, ?)`,
  )
    .bind(uid(), subject, body, id, ct.company_id, sent.threadId, user.id)
    .run();
  return c.json({ ok: true });
});

// ---------------- Deals
crmRoutes.get('/deals', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT d.*, co.name AS company_name, TRIM(COALESCE(ct.first_name,'') || ' ' || COALESCE(ct.last_name,'')) AS contact_name
     FROM deals d LEFT JOIN companies co ON co.id = d.company_id LEFT JOIN contacts ct ON ct.id = d.contact_id ORDER BY d.updated_at DESC LIMIT 1000`,
  ).all();
  return c.json(results);
});
crmRoutes.post('/deals', async (c) => {
  const body = await c.req.json<any>();
  if (!body.title) return c.json({ error: 'Titel fehlt' }, 400);
  const id = uid();
  await insertRow(c.env.DB, 'deals', { id, ...pick(body, DEAL_FIELDS), owner_id: c.get('user').id });
  return c.json(await c.env.DB.prepare('SELECT * FROM deals WHERE id = ?').bind(id).first());
});
crmRoutes.put('/deals/:id', async (c) => {
  const body = await c.req.json<any>();
  const data = pick(body, DEAL_FIELDS);
  if (data.stage === 'won' && body.probability === undefined) data.probability = 100;
  if (data.stage === 'lost' && body.probability === undefined) data.probability = 0;
  await updateRow(c.env.DB, 'deals', c.req.param('id'), data);
  return c.json(await c.env.DB.prepare('SELECT * FROM deals WHERE id = ?').bind(c.req.param('id')).first());
});
crmRoutes.delete('/deals/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM deals WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---------------- Aktivitäten
crmRoutes.get('/activities', async (c) => {
  const where: string[] = [];
  const args: unknown[] = [];
  for (const k of ['contact_id', 'company_id', 'deal_id', 'quote_id', 'type']) {
    const v = c.req.query(k);
    if (v) {
      where.push(`a.${k} = ?`);
      args.push(v);
    }
  }
  if (c.req.query('open')) where.push(`a.type = 'task' AND a.done = 0`);
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, co.name AS company_name, TRIM(COALESCE(ct.first_name,'') || ' ' || COALESCE(ct.last_name,'')) AS contact_name
     FROM activities a LEFT JOIN companies co ON co.id = a.company_id LEFT JOIN contacts ct ON ct.id = a.contact_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY ${c.req.query('open') ? 'a.due_at IS NULL, a.due_at' : 'a.created_at DESC'} LIMIT ${Number(c.req.query('limit')) || 200}`,
  )
    .bind(...args)
    .all();
  return c.json(results);
});
crmRoutes.post('/activities', async (c) => {
  const body = await c.req.json<any>();
  const user = c.get('user');
  const id = uid();
  let calendarId: string | null = null;
  let calendarLink: string | null = null;
  if (body.add_to_calendar && body.due_at) {
    const tz = c.env.TIMEZONE || 'Europe/Berlin';
    const start = body.due_at.length === 16 ? body.due_at + ':00' : body.due_at;
    const endDate = new Date(new Date(start + 'Z').getTime() + (Number(body.duration_min) || 30) * 60000).toISOString().slice(0, 19);
    const ct = body.contact_id ? await c.env.DB.prepare('SELECT email FROM contacts WHERE id = ?').bind(body.contact_id).first<any>() : null;
    const token = await getAccessToken(c.env, user.id);
    const ev = await createEvent(token, {
      summary: body.subject || 'Termin',
      description: body.body || '',
      start,
      end: endDate,
      timeZone: tz,
      attendees: body.invite_contact && ct?.email ? [ct.email] : undefined,
    });
    calendarId = ev.id;
    calendarLink = ev.htmlLink;
  }
  await insertRow(c.env.DB, 'activities', {
    id,
    ...pick(body, ['type', 'subject', 'body', 'company_id', 'contact_id', 'deal_id', 'quote_id', 'due_at', 'done']),
    calendar_event_id: calendarId,
    created_by: user.id,
  });
  return c.json({ ...(await c.env.DB.prepare('SELECT * FROM activities WHERE id = ?').bind(id).first()), calendar_link: calendarLink });
});
crmRoutes.put('/activities/:id', async (c) => {
  await updateRow(c.env.DB, 'activities', c.req.param('id'), pick(await c.req.json(), ['subject', 'body', 'due_at', 'done']), false);
  return c.json({ ok: true });
});
crmRoutes.delete('/activities/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM activities WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---------------- Artikel
crmRoutes.get('/products', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM products ORDER BY active DESC, name COLLATE NOCASE').all();
  return c.json(results);
});
crmRoutes.post('/products', async (c) => {
  const id = uid();
  await insertRow(c.env.DB, 'products', { id, ...pick(await c.req.json(), ['name', 'description', 'unit', 'price', 'currency', 'tax_rate', 'active']) });
  return c.json(await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first());
});
crmRoutes.put('/products/:id', async (c) => {
  await updateRow(c.env.DB, 'products', c.req.param('id'), pick(await c.req.json(), ['name', 'description', 'unit', 'price', 'currency', 'tax_rate', 'active']), false);
  return c.json({ ok: true });
});
crmRoutes.delete('/products/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM products WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});
