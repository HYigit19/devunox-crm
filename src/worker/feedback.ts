// Kunden-Feedback im CRM: liest und schreibt direkt in der Portal-Datenbank (RDB).
// Jedes Kunden-Feedback ist zugleich eine Aufgabe beim Kunden (tasks.external_id = 'review:<id>').
import { Hono } from 'hono';
import { AppEnv, Env, uid } from './util';
import { portalEnabled, portalEnv } from './portal';
import { ensureSchema } from './review-app/schema.js';
import { createToken } from './review-app/auth.js';

export const feedbackRoutes = new Hono<AppEnv>();

const now = () => new Date().toISOString();
const portalOrigin = (env: Env) => (env.REVIEW_URL || 'https://project.review.devunox.ai').replace(/\/$/, '');

async function rdb(env: Env) {
  const penv = await portalEnv(env);
  await ensureSchema(penv);
  return env.RDB!;
}

feedbackRoutes.use('*', async (c, next) => {
  if (!portalEnabled(c.env)) return c.json({ error: 'Kundenportal ist nicht eingerichtet (Binding RDB fehlt).' }, 409);
  return next();
});

/** Portal-Admin zum CRM-Benutzer (gleiche E-Mail) – wird bei Bedarf ohne Passwort angelegt */
async function portalAdmin(env: Env, user: { email: string; name?: string | null }) {
  const db = await rdb(env);
  let a = await db.prepare(`SELECT * FROM users WHERE email = ? AND role = 'admin'`).bind(user.email.toLowerCase()).first<any>();
  if (!a) a = await db.prepare(`SELECT * FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1`).first<any>();
  if (!a) a = await db.prepare(`INSERT INTO users (email, name, role, lang, created_at) VALUES (?, ?, 'admin', 'de', ?) RETURNING *`).bind(user.email.toLowerCase(), user.name || 'devunox', now()).first<any>();
  return a;
}

const fileUrl = (id: number) => `/api/feedback/files/${id}`;

// ---------- Liste
feedbackRoutes.get('/', async (c) => {
  const db = await rdb(c.env);
  const status = c.req.query('status');
  const company = c.req.query('company_id');
  const where = [`i.kind = 'feedback'`];
  const args: unknown[] = [];
  if (status === 'open') where.push(`i.status IN ('offen','in_arbeit','pruefen')`);
  else if (status === 'cr') where.push(`i.cr_status IN ('proposed','approved')`);
  else if (status) { where.push('i.status = ?'); args.push(status); }
  if (company) {
    const co = await c.env.DB.prepare('SELECT customer_no, review_client_id FROM companies WHERE id = ?').bind(company).first<any>();
    where.push('(cl.customer_no = ? OR cl.id = ?)');
    args.push(co?.customer_no || '-', co?.review_client_id || -1);
  }
  const { results } = await db.prepare(
    `SELECT i.id, i.no, i.title, i.body, i.category, i.priority, i.status, i.page_url, i.cr_status, i.cr_amount, i.cr_days, i.cr_currency, i.device, i.screenshot_id, i.created_at, i.last_activity_at, i.last_activity_by,
            p.slug, p.name AS project_name, cl.id AS client_id, cl.name AS client_name, cl.customer_no, u.name AS author_name, u.role AS author_role, lu.role AS last_role,
            (SELECT COUNT(*) FROM comments cm WHERE cm.item_id = i.id AND cm.kind = 'comment') AS n_comments,
            (SELECT COUNT(*) FROM files f WHERE f.item_id = i.id AND f.is_screenshot = 0) AS n_files
     FROM items i JOIN projects p ON p.id = i.project_id JOIN clients cl ON cl.id = p.client_id
     LEFT JOIN users u ON u.id = i.author_id LEFT JOIN users lu ON lu.id = i.last_activity_by
     WHERE ${where.join(' AND ')} ORDER BY i.last_activity_at DESC LIMIT 500`,
  ).bind(...args).all<any>();
  // CRM-Aufgabe und Firma dazuladen
  const ids = results.map((r) => `review:${r.id}`);
  const tasks = new Map<string, any>();
  for (let k = 0; k < ids.length; k += 90) {
    const part = ids.slice(k, k + 90);
    const { results: ts } = await c.env.DB.prepare(`SELECT id, external_id, status, unread, company_id FROM tasks WHERE external_id IN (${part.map(() => '?').join(',')})`).bind(...part).all<any>();
    ts.forEach((t) => tasks.set(t.external_id, t));
  }
  const { results: cos } = await c.env.DB.prepare('SELECT id, name, customer_no, review_client_id FROM companies').all<any>();
  return c.json(
    results.map((r) => {
      const t = tasks.get(`review:${r.id}`);
      const co = cos.find((x) => (r.customer_no && x.customer_no === r.customer_no) || x.review_client_id === r.client_id);
      return { ...r, screenshot_url: r.screenshot_id ? fileUrl(r.screenshot_id) : null, task_id: t?.id || null, task_status: t?.status || null, unread: !!t?.unread || r.last_role === 'client', company_id: co?.id || t?.company_id || null, company_name: co?.name || r.client_name };
    }),
  );
});

// ---------- Detail
async function itemFull(env: Env, id: number) {
  const db = await rdb(env);
  const it = await db.prepare(
    `SELECT i.*, p.slug, p.name AS project_name, p.app_url, cl.name AS client_name, cl.customer_no, u.name AS author_name, u.role AS author_role
     FROM items i JOIN projects p ON p.id = i.project_id JOIN clients cl ON cl.id = p.client_id LEFT JOIN users u ON u.id = i.author_id WHERE i.id = ?`,
  ).bind(id).first<any>();
  if (!it) return null;
  const [cm, fl] = await db.batch([
    db.prepare(`SELECT c.id, c.kind, c.body, c.meta, c.created_at, u.name AS author_name, u.role AS author_role FROM comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.item_id = ? ORDER BY c.created_at, c.id`).bind(id),
    db.prepare(`SELECT id, comment_id, name, mime, size, is_screenshot, created_at FROM files WHERE item_id = ? ORDER BY id`).bind(id),
  ]);
  const task = await env.DB.prepare('SELECT id, status, company_id, project_id FROM tasks WHERE external_id = ?').bind(`review:${id}`).first<any>();
  const { ua, ...rest } = it;
  return {
    ...rest,
    internal: !!it.internal,
    screenshot_url: it.screenshot_id ? fileUrl(it.screenshot_id) : null,
    portal_url: `${portalOrigin(env)}/#/p/${it.slug}/i/${it.id}`,
    comments: (cm.results as any[]).map((x) => ({ ...x, meta: x.meta ? JSON.parse(x.meta) : null })),
    files: (fl.results as any[]).map((f) => ({ ...f, url: fileUrl(f.id) })),
    task,
  };
}

feedbackRoutes.get('/item/:id', async (c) => {
  const r = await itemFull(c.env, Number(c.req.param('id')));
  return r ? c.json(r) : c.json({ error: 'not found' }, 404);
});

/** Feedback zu einer CRM-Aufgabe (für die Aufgaben-Ansicht) */
feedbackRoutes.get('/by-task/:taskId', async (c) => {
  const t = await c.env.DB.prepare('SELECT external_id FROM tasks WHERE id = ?').bind(c.req.param('taskId')).first<any>();
  const id = Number(String(t?.external_id || '').replace('review:', ''));
  if (!id) return c.json(null);
  return c.json(await itemFull(c.env, id));
});

// ---------- Antwort an den Kunden
feedbackRoutes.post('/item/:id/comments', async (c) => {
  const id = Number(c.req.param('id'));
  const { body } = await c.req.json<{ body: string }>();
  const text = String(body || '').trim().slice(0, 8000);
  if (!text) return c.json({ error: 'Bitte eine Antwort schreiben.' }, 400);
  const db = await rdb(c.env);
  const it = await db.prepare('SELECT id FROM items WHERE id = ?').bind(id).first();
  if (!it) return c.json({ error: 'not found' }, 404);
  const admin = await portalAdmin(c.env, c.get('user'));
  const t = now();
  await db.batch([
    db.prepare(`INSERT INTO comments (item_id, author_id, kind, body, created_at) VALUES (?, ?, 'comment', ?, ?)`).bind(id, admin.id, text, t),
    db.prepare('UPDATE items SET last_activity_at = ?, last_activity_by = ?, updated_at = ? WHERE id = ?').bind(t, admin.id, t, id),
    db.prepare('INSERT INTO seen (user_id, item_id, seen_at) VALUES (?, ?, ?) ON CONFLICT(user_id, item_id) DO UPDATE SET seen_at = excluded.seen_at').bind(admin.id, id, t),
  ]);
  const task = await c.env.DB.prepare('SELECT * FROM tasks WHERE external_id = ?').bind(`review:${id}`).first<any>();
  if (task) {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO activities (id, type, subject, body, task_id, project_id, company_id, done) VALUES (?, 'email', ?, ?, ?, ?, ?, 1)`).bind(uid(), 'Antwort an den Kunden (Portal)', text, task.id, task.project_id, task.company_id),
      c.env.DB.prepare(`UPDATE tasks SET unread = 0, updated_at = datetime('now') WHERE id = ?`).bind(task.id),
    ]);
  }
  return c.json(await itemFull(c.env, id));
});

/** Als gelesen markieren (Kunden-Antworten gesehen) */
feedbackRoutes.post('/item/:id/seen', async (c) => {
  const id = Number(c.req.param('id'));
  const admin = await portalAdmin(c.env, c.get('user'));
  await c.env.RDB!.prepare('INSERT INTO seen (user_id, item_id, seen_at) VALUES (?, ?, ?) ON CONFLICT(user_id, item_id) DO UPDATE SET seen_at = excluded.seen_at').bind(admin.id, id, now()).run();
  await c.env.DB.prepare(`UPDATE tasks SET unread = 0 WHERE external_id = ?`).bind(`review:${id}`).run();
  return c.json({ ok: true });
});

// ---------- Anhang an den Kunden
feedbackRoutes.post('/item/:id/files', async (c) => {
  const id = Number(c.req.param('id'));
  const db = await rdb(c.env);
  const it = await db.prepare('SELECT id, project_id FROM items WHERE id = ?').bind(id).first<any>();
  if (!it) return c.json({ error: 'not found' }, 404);
  const form = await c.req.formData();
  const f = form.get('file') as unknown as File;
  if (!f || typeof f === 'string') return c.json({ error: 'Keine Datei' }, 400);
  if (f.size > 25 * 1024 * 1024) return c.json({ error: 'Datei ist größer als 25 MB.' }, 400);
  const admin = await portalAdmin(c.env, c.get('user'));
  const key = `p${it.project_id}/i${id}/${crypto.randomUUID()}`;
  await c.env.RFILES!.put(key, await f.arrayBuffer(), { httpMetadata: { contentType: f.type || 'application/octet-stream' } });
  const t = now();
  await db.batch([
    db.prepare(`INSERT INTO files (project_id, item_id, r2_key, name, mime, size, is_screenshot, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`).bind(it.project_id, id, key, f.name.slice(0, 200), f.type || 'application/octet-stream', f.size, admin.id, t),
    db.prepare('UPDATE items SET last_activity_at = ?, last_activity_by = ?, updated_at = ? WHERE id = ?').bind(t, admin.id, t, id),
  ]);
  return c.json(await itemFull(c.env, id));
});

feedbackRoutes.get('/files/:fid', async (c) => {
  const f = await c.env.RDB!.prepare('SELECT * FROM files WHERE id = ?').bind(Number(c.req.param('fid'))).first<any>();
  if (!f) return c.json({ error: 'not found' }, 404);
  const obj = await c.env.RFILES!.get(f.r2_key);
  if (!obj) return c.json({ error: 'Datei fehlt' }, 404);
  const inline = /^(image\/|application\/pdf|text\/plain)/.test(f.mime);
  return new Response(obj.body, {
    headers: {
      'content-type': f.mime,
      'content-disposition': `${inline && !c.req.query('download') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'content-security-policy': "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=3600',
    },
  });
});

// ---------- Mehraufwand / Änderungswunsch vorschlagen (Kunde gibt im Portal frei)
feedbackRoutes.post('/item/:id/cr', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<{ days?: number; amount?: number; currency?: string; note?: string; withdraw?: boolean }>();
  const db = await rdb(c.env);
  const it = await db.prepare('SELECT * FROM items WHERE id = ?').bind(id).first<any>();
  if (!it) return c.json({ error: 'not found' }, 404);
  const admin = await portalAdmin(c.env, c.get('user'));
  const t = now();
  if (b.withdraw) {
    await db.prepare(`UPDATE items SET cr_status = '', updated_at = ? WHERE id = ?`).bind(t, id).run();
    return c.json(await itemFull(c.env, id));
  }
  const days = Number(b.days) || null, amount = Number(b.amount) || null;
  if (!days && !amount) return c.json({ error: 'Bitte Aufwand oder Preis angeben.' }, 400);
  const cur = b.currency || 'EUR';
  const fmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur });
  const text = `Mehraufwand zur Freigabe: ${days ? `${String(days).replace('.', ',')} PT` : ''}${days && amount ? ' · ' : ''}${amount ? `${fmt.format(amount)} netto` : ''}${b.note ? `\n${b.note}` : ''}`;
  await db.batch([
    db.prepare(`UPDATE items SET cr_status = 'proposed', cr_days = ?, cr_amount = ?, cr_currency = ?, cr_note = ?, cr_decided_at = NULL, cr_decided_by = NULL, last_activity_at = ?, last_activity_by = ?, updated_at = ? WHERE id = ?`).bind(days, amount, cur, b.note || null, t, admin.id, t, id),
    db.prepare(`INSERT INTO comments (item_id, author_id, kind, body, created_at) VALUES (?, ?, 'comment', ?, ?)`).bind(id, admin.id, text, t),
  ]);
  const task = await c.env.DB.prepare('SELECT * FROM tasks WHERE external_id = ?').bind(`review:${id}`).first<any>();
  if (task) await c.env.DB.prepare(`INSERT INTO activities (id, type, subject, body, task_id, project_id, company_id, done) VALUES (?, 'system', 'Mehraufwand zur Freigabe an den Kunden', ?, ?, ?, ?, 1)`).bind(uid(), text, task.id, task.project_id, task.company_id).run();
  return c.json(await itemFull(c.env, id));
});

// ---------- Portalzugang je Firma (mehrere Personen möglich)
async function clientFor(env: Env, co: any) {
  const db = await rdb(env);
  if (co.customer_no) {
    const x = await db.prepare('SELECT * FROM clients WHERE customer_no = ?').bind(co.customer_no).first<any>();
    if (x) return x;
  }
  return co.review_client_id ? db.prepare('SELECT * FROM clients WHERE id = ?').bind(co.review_client_id).first<any>() : null;
}

feedbackRoutes.get('/access/:companyId', async (c) => {
  const co = await c.env.DB.prepare('SELECT id, name, customer_no, review_client_id FROM companies WHERE id = ?').bind(c.req.param('companyId')).first<any>();
  if (!co) return c.json({ error: 'not found' }, 404);
  const db = await rdb(c.env);
  const client = await clientFor(c.env, co);
  if (!client) return c.json({ client: null, users: [], projects: [], open: 0, portal_url: portalOrigin(c.env) });
  const [u, p, open] = await db.batch([
    db.prepare('SELECT id, email, name, lang, active, can_approve, last_login, password_hash IS NOT NULL AS has_password, created_at FROM users WHERE client_id = ? ORDER BY created_at').bind(client.id),
    db.prepare(`SELECT id, slug, name, app_url, status, (SELECT COUNT(*) FROM items i WHERE i.project_id = projects.id AND i.kind = 'feedback') AS n_items FROM projects WHERE client_id = ? ORDER BY name`).bind(client.id),
    db.prepare(`SELECT COUNT(*) AS n FROM items i JOIN projects p ON p.id = i.project_id WHERE p.client_id = ? AND i.kind = 'feedback' AND i.status IN ('offen','in_arbeit','pruefen')`).bind(client.id),
  ]);
  return c.json({ client, users: u.results, projects: p.results, open: (open.results as any[])[0]?.n || 0, portal_url: portalOrigin(c.env) });
});

/** Person anlegen (oder bestehende wählen) und Einladungs-/Passwort-Link erzeugen (14 Tage gültig) */
feedbackRoutes.post('/access/:companyId/invite', async (c) => {
  const co = await c.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(c.req.param('companyId')).first<any>();
  if (!co) return c.json({ error: 'not found' }, 404);
  const b = await c.req.json<{ user_id?: number; contact_id?: string; email?: string; name?: string; lang?: string; can_approve?: boolean }>().catch(() => ({}) as any);
  const db = await rdb(c.env);
  const penv = await portalEnv(c.env);
  const t = now();
  let client = await clientFor(c.env, co);
  if (!client) client = await db.prepare('INSERT INTO clients (name, customer_no, created_at) VALUES (?, ?, ?) RETURNING *').bind(co.name, co.customer_no || null, t).first<any>();
  await c.env.DB.prepare('UPDATE companies SET review_client_id = ? WHERE id = ?').bind(client.id, co.id).run();
  let user: any = b.user_id ? await db.prepare('SELECT * FROM users WHERE id = ? AND client_id = ?').bind(b.user_id, client.id).first<any>() : null;
  if (!user) {
    const ct = b.contact_id ? await c.env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(b.contact_id).first<any>() : null;
    const email = String(b.email || ct?.email || '').trim().toLowerCase();
    const name = String(b.name || (ct ? [ct.first_name, ct.last_name].filter(Boolean).join(' ') : '') || co.name).slice(0, 80);
    const lang = b.lang === 'en' || ct?.language === 'en' ? 'en' : 'de';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' }, 400);
    const exists = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<any>();
    if (exists && exists.client_id !== client.id) return c.json({ error: 'Diese E-Mail hat schon einen Zugang bei einem anderen Kunden.' }, 400);
    user = exists || (await db.prepare(`INSERT INTO users (email, name, role, client_id, lang, can_approve, created_at) VALUES (?, ?, 'client', ?, ?, ?, ?) RETURNING *`).bind(email, name, client.id, lang, b.can_approve === false ? 0 : 1, t).first<any>());
  }
  const purpose = user.password_hash ? 'reset' : 'invite';
  const token = await createToken(penv, user.id, purpose, 14 * 24 * 60);
  await c.env.DB.prepare(`INSERT INTO activities (id, type, subject, body, company_id, done) VALUES (?, 'system', ?, ?, ?, 1)`).bind(uid(), purpose === 'invite' ? 'Kundenportal-Zugang erstellt' : 'Neuer Passwort-Link für das Kundenportal', user.email, co.id).run();
  return c.json({ url: `${portalOrigin(c.env)}/#/link/${token}`, purpose, email: user.email, name: user.name, lang: user.lang });
});

/** Person sperren/entsperren oder Freigaberecht ändern */
feedbackRoutes.put('/access/users/:uid', async (c) => {
  const b = await c.req.json<{ active?: boolean; can_approve?: boolean }>();
  const db = await rdb(c.env);
  const id = Number(c.req.param('uid'));
  const u = await db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'client'`).bind(id).first();
  if (!u) return c.json({ error: 'not found' }, 404);
  if (b.active !== undefined) {
    await db.batch([db.prepare('UPDATE users SET active = ? WHERE id = ?').bind(b.active ? 1 : 0, id), ...(b.active ? [] : [db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id)])]);
  }
  if (b.can_approve !== undefined) await db.prepare('UPDATE users SET can_approve = ? WHERE id = ?').bind(b.can_approve ? 1 : 0, id).run();
  return c.json({ ok: true });
});
