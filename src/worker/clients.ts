// Kundenmanagement: Kundensysteme (Hosting), Abos & Abrechnung, Stundenkontingente, Wartung & Überwachung, Lizenzen,
// Releases, Verträge, Checklisten, Zugangsdaten-Tresor, Monatsberichte, Kunden-Cockpit (Health-Score, Rentabilität), Team.
import { Hono } from 'hono';
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { AppEnv, Env, addDays, decrypt, encrypt, getSettings, hashPassword, insertRow, pick, todayIso, toBase64Url, uid, updateRow } from './util';
import { DARK, GREY, LINE, ORANGE, SOFT, clean, drawBrandHeader, embedLogo, wrap } from './pdf';
import { storeDocument } from './work';
import { getAccessToken, sendMail, senderEmail, textToHtml } from './google';

export const clientRoutes = new Hono<AppEnv>();

// ---------------------------------------------------------------- Bereitschaft (Migrationen 0008/0009)
let ready: boolean | null = null;
let checkedAt = 0;
export async function clientsReady(env: Env) {
  if (ready || Date.now() - checkedAt < 60_000) return !!ready;
  checkedAt = Date.now();
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('systems','subscriptions','licenses','contracts','vault_items','client_reports')`).first<{ n: number }>();
  ready = (r?.n || 0) === 6;
  return ready;
}
clientRoutes.use('*', async (c, next) => {
  if (!(await clientsReady(c.env))) return c.json({ error: 'Für die Kundenverwaltung fehlen die Datenbank-Updates 0008 und 0009 (npx wrangler d1 migrations apply DB --remote).', setup: true }, 409);
  return next();
});

async function isAdmin(c: any) {
  const u = await c.env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(c.get('user').id).first();
  return !u || (u as any).role !== 'member';
}
const adminOnly = async (c: any, next: any) => ((await isAdmin(c)) ? next() : c.json({ error: 'Nur für Administratoren.' }, 403));

const today = (env: Env) => todayIso(env.TIMEZONE || 'Europe/Berlin');
const monthKey = (iso: string) => iso.slice(0, 7);
const factor = (interval: string) => (interval === 'year' ? 1 / 12 : interval === 'quarter' ? 1 / 3 : 1);
const months = (interval: string) => (interval === 'year' ? 12 : interval === 'quarter' ? 3 : 1);
const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400000);

/** Aufgabe aus dem Betrieb anlegen – je Schlüssel nur einmal (tasks.external_id) */
async function opsTask(env: Env, o: { key: string; title: string; description?: string; company_id?: string | null; project_id?: string | null; priority?: string; due?: string | null }) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tasks (id, title, description, status, priority, company_id, project_id, source, external_id, due_at, unread, sort) VALUES (?, ?, ?, 'todo', ?, ?, ?, 'ops', ?, ?, 1, ?)`,
  )
    .bind(uid(), o.title.slice(0, 200), o.description || null, o.priority || 'medium', o.company_id || null, o.project_id || null, `ops:${o.key}`, o.due ? (o.due.length === 10 ? `${o.due} 09:00` : o.due) : null, -Date.now() / 1000)
    .run();
}

// ================================================================ Kundensysteme
const SYSTEM_FIELDS = ['company_id', 'project_id', 'name', 'kind', 'hosting', 'hosting_note', 'status', 'prod_url', 'staging_url', 'admin_url', 'repo_url', 'cf_worker', 'version', 'stack', 'domain', 'domain_expires', 'ssl_expires', 'backup_info', 'last_backup_at', 'last_update_at', 'maintenance_hours', 'sla', 'monitor', 'notes'];

clientRoutes.get('/systems', async (c) => {
  const company = c.req.query('company_id');
  const { results } = await c.env.DB.prepare(
    `SELECT s.*, co.name AS company_name, co.customer_no,
       (SELECT ROUND(100.0 * AVG(ok), 2) FROM system_checks k WHERE k.system_id = s.id AND k.at >= datetime('now','-30 days')) AS uptime30,
       (SELECT COUNT(*) FROM licenses l WHERE l.system_id = s.id AND l.status = 'active') AS n_licenses,
       (SELECT version || ' · ' || released_at FROM releases r WHERE r.system_id = s.id ORDER BY released_at DESC, created_at DESC LIMIT 1) AS last_release,
       (SELECT COALESCE(SUM(amount * CASE interval WHEN 'year' THEN 1.0/12 WHEN 'quarter' THEN 1.0/3 ELSE 1 END),0) FROM subscriptions su WHERE su.system_id = s.id AND su.status = 'active') AS mrr
     FROM systems s LEFT JOIN companies co ON co.id = s.company_id ${company ? 'WHERE s.company_id = ?' : ''} ORDER BY co.name, s.name`,
  ).bind(...(company ? [company] : [])).all();
  return c.json(results);
});
clientRoutes.post('/systems', async (c) => {
  const id = uid();
  await insertRow(c.env.DB, 'systems', { id, ...pick(await c.req.json(), SYSTEM_FIELDS) });
  return c.json(await c.env.DB.prepare('SELECT * FROM systems WHERE id = ?').bind(id).first());
});
clientRoutes.put('/systems/:id', async (c) => {
  await updateRow(c.env.DB, 'systems', c.req.param('id'), pick(await c.req.json(), SYSTEM_FIELDS));
  return c.json(await c.env.DB.prepare('SELECT * FROM systems WHERE id = ?').bind(c.req.param('id')).first());
});
clientRoutes.delete('/systems/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM systems WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});
clientRoutes.get('/systems/:id/checks', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT ok, status, ms, error, at FROM system_checks WHERE system_id = ? ORDER BY at DESC LIMIT 96').bind(c.req.param('id')).all();
  return c.json(results);
});

async function checkSystem(env: Env, s: any) {
  const url = s.prod_url;
  if (!url) return null;
  const t0 = Date.now();
  let ok = 0, status: number | null = null, error: string | null = null;
  try {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 10_000);
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': 'devunox-monitor/1.0' } });
    clearTimeout(tm);
    status = res.status;
    ok = res.status < 500 ? 1 : 0;
    if (!ok) error = `HTTP ${res.status}`;
    await res.body?.cancel();
  } catch (e: any) {
    error = e?.name === 'AbortError' ? 'Zeitüberschreitung (10 s)' : String(e?.message || e).slice(0, 200);
  }
  const ms = Date.now() - t0;
  const wasDown = s.check_ok === 0;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO system_checks (system_id, ok, status, ms, error) VALUES (?, ?, ?, ?, ?)').bind(s.id, ok, status, ms, error),
    env.DB.prepare(`UPDATE systems SET check_ok = ?, check_status = ?, check_ms = ?, check_error = ?, check_at = datetime('now'), down_since = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(down_since, datetime('now')) END WHERE id = ?`).bind(ok, status, ms, error, ok, s.id),
    env.DB.prepare(`DELETE FROM system_checks WHERE system_id = ? AND at < datetime('now','-90 days')`).bind(s.id),
  ]);
  if (!ok && !wasDown) {
    await opsTask(env, { key: `down:${s.id}:${new Date().toISOString().slice(0, 13)}`, title: `⚠ ${s.name} ist nicht erreichbar`, description: `${url}\n${error || ''}\n\nAutomatisch erkannt von der Überwachung.`, company_id: s.company_id, project_id: s.project_id, priority: 'high', due: today(env) });
  }
  return { ok: !!ok, status, ms, error };
}
clientRoutes.post('/systems/:id/check', async (c) => {
  const s = await c.env.DB.prepare('SELECT * FROM systems WHERE id = ?').bind(c.req.param('id')).first<any>();
  if (!s) return c.json({ error: 'not found' }, 404);
  if (!s.prod_url) return c.json({ error: 'Bitte zuerst die Live-Adresse eintragen.' }, 400);
  return c.json(await checkSystem(c.env, s));
});

// ================================================================ Abos & Abrechnung
const SUB_FIELDS = ['company_id', 'system_id', 'name', 'amount', 'currency', 'interval', 'start_date', 'end_date', 'notice_days', 'billing_day', 'status', 'includes', 'included_hours', 'overage_rate', 'notes'];

async function hoursThisMonth(env: Env, companyId: string, ym: string) {
  const r = await env.DB.prepare(`SELECT COALESCE(SUM(minutes),0) AS m FROM time_entries WHERE company_id = ? AND substr(date,1,7) = ?`).bind(companyId, ym).first<{ m: number }>();
  return (r?.m || 0) / 60;
}

clientRoutes.get('/subscriptions', async (c) => {
  const company = c.req.query('company_id');
  const ym = monthKey(today(c.env));
  const { results } = await c.env.DB.prepare(
    `SELECT su.*, co.name AS company_name, co.customer_no, sy.name AS system_name,
       (SELECT COUNT(*) FROM subscription_periods p WHERE p.subscription_id = su.id AND p.status != 'paid') AS open_periods
     FROM subscriptions su LEFT JOIN companies co ON co.id = su.company_id LEFT JOIN systems sy ON sy.id = su.system_id
     ${company ? 'WHERE su.company_id = ?' : ''} ORDER BY su.status, co.name, su.name`,
  ).bind(...(company ? [company] : [])).all<any>();
  const out: any[] = [];
  for (const s of results) out.push({ ...s, mrr: s.status === 'active' ? s.amount * factor(s.interval) : 0, hours_used: s.company_id && s.included_hours ? await hoursThisMonth(c.env, s.company_id, ym) : 0 });
  return c.json(out);
});
clientRoutes.post('/subscriptions', async (c) => {
  const id = uid();
  const b = pick(await c.req.json(), SUB_FIELDS);
  if (!b.start_date) b.start_date = today(c.env);
  await insertRow(c.env.DB, 'subscriptions', { id, ...b });
  await generatePeriods(c.env);
  return c.json(await c.env.DB.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(id).first());
});
clientRoutes.put('/subscriptions/:id', async (c) => {
  await updateRow(c.env.DB, 'subscriptions', c.req.param('id'), pick(await c.req.json(), SUB_FIELDS));
  return c.json(await c.env.DB.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(c.req.param('id')).first());
});
clientRoutes.delete('/subscriptions/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM subscriptions WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});
clientRoutes.get('/periods', async (c) => {
  const st = c.req.query('status');
  const company = c.req.query('company_id');
  const where: string[] = [];
  const args: unknown[] = [];
  if (st === 'unpaid') where.push(`p.status != 'paid'`);
  else if (st) { where.push('p.status = ?'); args.push(st); }
  if (company) { where.push('p.company_id = ?'); args.push(company); }
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, su.name AS sub_name, su.interval, co.name AS company_name, co.customer_no,
       CASE WHEN p.status != 'paid' AND p.due_date < date('now') THEN 1 ELSE 0 END AS overdue
     FROM subscription_periods p JOIN subscriptions su ON su.id = p.subscription_id LEFT JOIN companies co ON co.id = p.company_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.due_date DESC LIMIT 500`,
  ).bind(...args).all();
  return c.json(results);
});
clientRoutes.put('/periods/:id', async (c) => {
  const b = await c.req.json<{ status?: string; invoice_no?: string }>();
  const data: Record<string, unknown> = {};
  if (b.invoice_no !== undefined) data.invoice_no = b.invoice_no || null;
  if (b.status) {
    data.status = b.status;
    if (b.status === 'invoiced') data.invoiced_at = today(c.env);
    if (b.status === 'paid') data.paid_at = today(c.env);
    if (b.status === 'open') { data.invoiced_at = null; data.paid_at = null; }
  }
  await updateRow(c.env.DB, 'subscription_periods', c.req.param('id'), data, false);
  if (b.status === 'paid' || b.status === 'invoiced') await c.env.DB.prepare(`UPDATE tasks SET status = 'done', completed_at = datetime('now') WHERE external_id = ? AND status != 'done'`).bind(`ops:bill:${c.req.param('id')}`).run();
  return c.json({ ok: true });
});
clientRoutes.post('/periods/run', async (c) => c.json({ created: await generatePeriods(c.env) }));

/** Fällige Abrechnungszeiträume anlegen (inkl. Aufgabe „Rechnung stellen“) */
export async function generatePeriods(env: Env) {
  const t = today(env);
  const { results } = await env.DB.prepare(`SELECT su.*, co.name AS company_name FROM subscriptions su LEFT JOIN companies co ON co.id = su.company_id WHERE su.status = 'active'`).all<any>();
  let created = 0;
  for (const s of results) {
    const step = months(s.interval);
    let ym = monthKey(s.start_date);
    const until = monthKey(t);
    for (let guard = 0; ym <= until && guard < 240; guard++, ym = addMonths(ym, step)) {
      if (s.end_date && ym > monthKey(s.end_date)) break;
      const due = `${ym}-${String(Math.min(28, Math.max(1, s.billing_day || 1))).padStart(2, '0')}`;
      if (due > t) break;
      const id = uid();
      const r = await env.DB.prepare('INSERT OR IGNORE INTO subscription_periods (id, subscription_id, company_id, period, amount, currency, due_date) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, s.id, s.company_id, ym, s.amount, s.currency, due).run();
      if (r.meta.changes) {
        created++;
        // nur für aktuelle Zeiträume eine Aufgabe (keine Flut beim Nachtragen alter Monate)
        if (daysBetween(due, t) <= 31) await opsTask(env, { key: `bill:${id}`, title: `Rechnung stellen: ${s.company_name || 'Kunde'} – ${s.name} (${ym})`, description: `${new Intl.NumberFormat('de-DE', { style: 'currency', currency: s.currency || 'EUR' }).format(s.amount)} netto · fällig ${due}\nNach dem Versand unter Kundensysteme → Abrechnung als „gestellt“ markieren.`, company_id: s.company_id, due });
      }
    }
  }
  return created;
}

// ================================================================ Lizenzen (On-Premise / Fremd-Cloud)
const LIC_FIELDS = ['company_id', 'system_id', 'edition', 'seats', 'modules', 'valid_from', 'valid_until', 'status', 'notes'];

async function signingKey(env: Env): Promise<{ priv: CryptoKey; pub: string }> {
  let row = await env.DB.prepare(`SELECT * FROM license_signing WHERE id = 'main'`).first<any>();
  if (!row) {
    const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' } as any, true, ['sign', 'verify'])) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    const pub = toBase64Url(new Uint8Array((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer));
    await env.DB.prepare(`INSERT OR IGNORE INTO license_signing (id, public_key, private_jwk_enc) VALUES ('main', ?, ?)`).bind(pub, await encrypt(env.ENCRYPTION_KEY, JSON.stringify(jwk))).run();
    row = await env.DB.prepare(`SELECT * FROM license_signing WHERE id = 'main'`).first<any>();
  }
  const jwk = JSON.parse(await decrypt(env.ENCRYPTION_KEY, row.private_jwk_enc));
  const priv = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' } as any, false, ['sign']);
  return { priv, pub: row.public_key };
}

async function signLicense(env: Env, id: string) {
  const l = await env.DB.prepare(`SELECT l.*, co.name AS company_name, co.customer_no, sy.name AS system_name FROM licenses l LEFT JOIN companies co ON co.id = l.company_id LEFT JOIN systems sy ON sy.id = l.system_id WHERE l.id = ?`).bind(id).first<any>();
  if (!l) throw new Error('Lizenz nicht gefunden');
  const payload = {
    v: 1, lic: l.id, cust: l.customer_no || null, company: l.company_name || null, system: l.system_name || null, edition: l.edition,
    seats: l.seats || 0, modules: (l.modules || '').split(',').map((x: string) => x.trim()).filter(Boolean), from: l.valid_from, until: l.valid_until || null, iat: new Date().toISOString(),
  };
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const { priv } = await signingKey(env);
  const sig = toBase64Url(new Uint8Array(await crypto.subtle.sign('Ed25519' as any, priv, new TextEncoder().encode(body))));
  const key = `DVX1.${body}.${sig}`;
  await env.DB.prepare(`UPDATE licenses SET license_key = ?, updated_at = datetime('now') WHERE id = ?`).bind(key, id).run();
  return key;
}

clientRoutes.get('/licenses', async (c) => {
  const company = c.req.query('company_id');
  const { results } = await c.env.DB.prepare(
    `SELECT l.*, co.name AS company_name, co.customer_no, sy.name AS system_name, sy.hosting FROM licenses l LEFT JOIN companies co ON co.id = l.company_id LEFT JOIN systems sy ON sy.id = l.system_id ${company ? 'WHERE l.company_id = ?' : ''} ORDER BY l.valid_until IS NULL, l.valid_until`,
  ).bind(...(company ? [company] : [])).all();
  return c.json(results);
});
clientRoutes.post('/licenses', async (c) => {
  const id = uid();
  const b = pick(await c.req.json(), LIC_FIELDS);
  if (!b.valid_from) b.valid_from = today(c.env);
  await insertRow(c.env.DB, 'licenses', { id, ...b });
  await signLicense(c.env, id);
  return c.json(await c.env.DB.prepare('SELECT * FROM licenses WHERE id = ?').bind(id).first());
});
clientRoutes.put('/licenses/:id', async (c) => {
  await updateRow(c.env.DB, 'licenses', c.req.param('id'), pick(await c.req.json(), LIC_FIELDS));
  await signLicense(c.env, c.req.param('id'));
  return c.json(await c.env.DB.prepare('SELECT * FROM licenses WHERE id = ?').bind(c.req.param('id')).first());
});
/** Verlängern um 12 Monate (ab bisherigem Ende) und neu signieren */
clientRoutes.post('/licenses/:id/renew', async (c) => {
  const l = await c.env.DB.prepare('SELECT * FROM licenses WHERE id = ?').bind(c.req.param('id')).first<any>();
  if (!l) return c.json({ error: 'not found' }, 404);
  const base = l.valid_until && l.valid_until > today(c.env) ? l.valid_until : today(c.env);
  const d = new Date(base + 'T12:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  await c.env.DB.prepare(`UPDATE licenses SET valid_until = ?, status = 'active' WHERE id = ?`).bind(d.toISOString().slice(0, 10), l.id).run();
  await signLicense(c.env, l.id);
  return c.json(await c.env.DB.prepare('SELECT * FROM licenses WHERE id = ?').bind(l.id).first());
});
clientRoutes.delete('/licenses/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM licenses WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});
clientRoutes.get('/licenses-public-key', async (c) => c.json({ public_key: (await signingKey(c.env)).pub, algorithm: 'Ed25519', format: 'DVX1.<base64url(JSON)>.<base64url(Signatur über den JSON-Teil)>' }));

// ================================================================ Releases
clientRoutes.get('/releases', async (c) => {
  const sys = c.req.query('system_id');
  const company = c.req.query('company_id');
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, sy.name AS system_name, co.name AS company_name FROM releases r LEFT JOIN systems sy ON sy.id = r.system_id LEFT JOIN companies co ON co.id = r.company_id
     ${sys ? 'WHERE r.system_id = ?' : company ? 'WHERE r.company_id = ?' : ''} ORDER BY r.released_at DESC, r.created_at DESC LIMIT 200`,
  ).bind(...(sys ? [sys] : company ? [company] : [])).all();
  return c.json(results);
});
clientRoutes.post('/releases', async (c) => {
  const b = await c.req.json<any>();
  const sys = await c.env.DB.prepare('SELECT * FROM systems WHERE id = ?').bind(b.system_id).first<any>();
  if (!sys) return c.json({ error: 'System fehlt' }, 400);
  const id = uid();
  const date = b.released_at || today(c.env);
  await insertRow(c.env.DB, 'releases', { id, system_id: sys.id, company_id: sys.company_id, version: String(b.version || '').trim() || date, released_at: date, title: b.title || null, notes: b.notes || null, created_by: c.get('user').id });
  await c.env.DB.prepare(`UPDATE systems SET version = ?, last_update_at = ?, updated_at = datetime('now') WHERE id = ?`).bind(String(b.version || '').trim() || sys.version, date, sys.id).run();
  return c.json({ id });
});
clientRoutes.delete('/releases/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM releases WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ================================================================ Verträge & Compliance
const CONTRACT_FIELDS = ['company_id', 'kind', 'title', 'status', 'signed_at', 'start_date', 'end_date', 'notice_days', 'auto_renew', 'renew_months', 'document_id', 'notes'];
/** Spätester Kündigungstermin (Ende minus Kündigungsfrist) */
const noticeDeadline = (k: any) => (k.end_date ? addDays(k.end_date, -(Number(k.notice_days) || 0)) : null);

clientRoutes.get('/contracts', async (c) => {
  const company = c.req.query('company_id');
  const { results } = await c.env.DB.prepare(
    `SELECT k.*, co.name AS company_name, co.customer_no, d.name AS document_name FROM contracts k LEFT JOIN companies co ON co.id = k.company_id LEFT JOIN documents d ON d.id = k.document_id
     ${company ? 'WHERE k.company_id = ?' : ''} ORDER BY k.end_date IS NULL, k.end_date`,
  ).bind(...(company ? [company] : [])).all<any>();
  return c.json(results.map((k) => ({ ...k, notice_deadline: noticeDeadline(k) })));
});
clientRoutes.post('/contracts', async (c) => {
  const id = uid();
  await insertRow(c.env.DB, 'contracts', { id, ...pick(await c.req.json(), CONTRACT_FIELDS) });
  return c.json({ id });
});
clientRoutes.put('/contracts/:id', async (c) => {
  await updateRow(c.env.DB, 'contracts', c.req.param('id'), pick(await c.req.json(), CONTRACT_FIELDS));
  return c.json({ ok: true });
});
clientRoutes.delete('/contracts/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM contracts WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ================================================================ Checklisten
export const CHECKLIST_TEMPLATES: Record<string, { title: string; items: [string, string?][] }> = {
  onboarding: {
    title: 'Onboarding',
    items: [
      ['Rahmenvertrag / Angebot unterschrieben'],
      ['AVV (Auftragsverarbeitung) unterschrieben', 'unter Verträge ablegen'],
      ['Ansprechpartner, Rechnungsadresse und USt-IdNr. im CRM gepflegt'],
      ['Kundenportal-Zugang erstellt und Einladung gesendet'],
      ['Projekt angelegt und mit dem Portal verbunden'],
      ['Domain & DNS geklärt (Cloudflare-Zone oder Kunden-DNS)'],
      ['Repository angelegt und Zugänge im Tresor gespeichert'],
      ['Hosting eingerichtet (devunox Cloud / On-Premise / Fremd-Cloud)'],
      ['System unter Kundensysteme angelegt, Überwachung aktiv'],
      ['Backups eingerichtet und Wiederherstellung getestet'],
      ['Abo / Wartungsvertrag angelegt, Abrechnung geprüft'],
      ['Kick-off-Termin durchgeführt'],
    ],
  },
  offboarding: {
    title: 'Offboarding',
    items: [
      ['Kündigung bestätigt, Enddatum in Abo und Vertrag eingetragen'],
      ['Letzte Rechnung gestellt und bezahlt'],
      ['Datenexport an den Kunden übergeben'],
      ['Domain/DNS an den Kunden übertragen'],
      ['Lizenzen widerrufen'],
      ['Überwachung beendet, System auf „Beendet“ gesetzt'],
      ['Kundenportal-Zugang gesperrt'],
      ['Zugangsdaten im Tresor gelöscht oder zurückgegeben'],
      ['Daten gelöscht und Löschung schriftlich bestätigt (AVV)'],
    ],
  },
};

clientRoutes.get('/checklists', async (c) => {
  const company = c.req.query('company_id');
  const { results: lists } = await c.env.DB.prepare(`SELECT * FROM checklists ${company ? 'WHERE company_id = ?' : ''} ORDER BY created_at DESC`).bind(...(company ? [company] : [])).all<any>();
  if (!lists.length) return c.json([]);
  const { results: items } = await c.env.DB.prepare(`SELECT * FROM checklist_items WHERE checklist_id IN (${lists.map(() => '?').join(',')}) ORDER BY sort`).bind(...lists.map((l) => l.id)).all<any>();
  return c.json(lists.map((l) => ({ ...l, items: items.filter((i) => i.checklist_id === l.id) })));
});
clientRoutes.post('/checklists', async (c) => {
  const b = await c.req.json<{ company_id: string; kind: string; title?: string }>();
  const tpl = CHECKLIST_TEMPLATES[b.kind] || { title: b.title || 'Checkliste', items: [] };
  const id = uid();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO checklists (id, company_id, kind, title) VALUES (?, ?, ?, ?)').bind(id, b.company_id, b.kind || 'custom', b.title || tpl.title),
    ...tpl.items.map(([label, hint], i) => c.env.DB.prepare('INSERT INTO checklist_items (id, checklist_id, label, hint, sort) VALUES (?, ?, ?, ?, ?)').bind(uid(), id, label, hint || null, i)),
  ]);
  return c.json({ id });
});
clientRoutes.post('/checklists/:id/items', async (c) => {
  const { label } = await c.req.json<{ label: string }>();
  const max = await c.env.DB.prepare('SELECT COALESCE(MAX(sort),0) AS m FROM checklist_items WHERE checklist_id = ?').bind(c.req.param('id')).first<{ m: number }>();
  await c.env.DB.prepare('INSERT INTO checklist_items (id, checklist_id, label, sort) VALUES (?, ?, ?, ?)').bind(uid(), c.req.param('id'), String(label).slice(0, 300), (max?.m || 0) + 1).run();
  return c.json({ ok: true });
});
clientRoutes.put('/checklist-items/:id', async (c) => {
  const b = await c.req.json<{ done?: boolean; label?: string }>();
  if (b.done !== undefined) await c.env.DB.prepare(`UPDATE checklist_items SET done = ?, done_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END, done_by = ? WHERE id = ?`).bind(b.done ? 1 : 0, b.done ? 1 : 0, c.get('user').name || c.get('user').email, c.req.param('id')).run();
  if (b.label) await c.env.DB.prepare('UPDATE checklist_items SET label = ? WHERE id = ?').bind(b.label.slice(0, 300), c.req.param('id')).run();
  return c.json({ ok: true });
});
clientRoutes.delete('/checklist-items/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM checklist_items WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});
clientRoutes.delete('/checklists/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM checklists WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ================================================================ Zugangsdaten-Tresor
clientRoutes.get('/vault', async (c) => {
  const company = c.req.query('company_id');
  const { results } = await c.env.DB.prepare(
    `SELECT v.id, v.company_id, v.system_id, v.label, v.url, v.username, v.notes, v.created_at, v.updated_at, v.secret_enc IS NOT NULL AS has_secret,
       co.name AS company_name, sy.name AS system_name, (SELECT MAX(at) FROM vault_log l WHERE l.item_id = v.id AND l.action = 'reveal') AS last_reveal
     FROM vault_items v LEFT JOIN companies co ON co.id = v.company_id LEFT JOIN systems sy ON sy.id = v.system_id ${company ? 'WHERE v.company_id = ?' : ''} ORDER BY co.name, v.label`,
  ).bind(...(company ? [company] : [])).all();
  return c.json(results);
});
async function vaultLog(c: any, item: string, action: string) {
  await c.env.DB.prepare('INSERT INTO vault_log (item_id, user_id, user_email, action) VALUES (?, ?, ?, ?)').bind(item, c.get('user').id, c.get('user').email, action).run();
}
clientRoutes.post('/vault', async (c) => {
  const b = await c.req.json<any>();
  const id = uid();
  await insertRow(c.env.DB, 'vault_items', { id, company_id: b.company_id || null, system_id: b.system_id || null, label: String(b.label || 'Zugang').slice(0, 120), url: b.url || null, username: b.username || null, secret_enc: b.secret ? await encrypt(c.env.ENCRYPTION_KEY, String(b.secret)) : null, notes: b.notes || null, created_by: c.get('user').id });
  await vaultLog(c, id, 'create');
  return c.json({ id });
});
clientRoutes.put('/vault/:id', async (c) => {
  const b = await c.req.json<any>();
  const data: Record<string, unknown> = pick(b, ['label', 'url', 'username', 'notes', 'system_id']);
  if (b.secret !== undefined) data.secret_enc = b.secret ? await encrypt(c.env.ENCRYPTION_KEY, String(b.secret)) : null;
  await updateRow(c.env.DB, 'vault_items', c.req.param('id'), data);
  await vaultLog(c, c.req.param('id'), 'update');
  return c.json({ ok: true });
});
clientRoutes.post('/vault/:id/reveal', async (c) => {
  const v = await c.env.DB.prepare('SELECT secret_enc FROM vault_items WHERE id = ?').bind(c.req.param('id')).first<any>();
  if (!v) return c.json({ error: 'not found' }, 404);
  await vaultLog(c, c.req.param('id'), 'reveal');
  return c.json({ secret: v.secret_enc ? await decrypt(c.env.ENCRYPTION_KEY, v.secret_enc) : '' });
});
clientRoutes.get('/vault/:id/log', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM vault_log WHERE item_id = ? ORDER BY at DESC LIMIT 50').bind(c.req.param('id')).all();
  return c.json(results);
});
clientRoutes.delete('/vault/:id', adminOnly, async (c) => {
  await vaultLog(c, c.req.param('id'), 'delete');
  await c.env.DB.prepare('DELETE FROM vault_items WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ================================================================ Kunden-Cockpit (Health-Score, Rentabilität, Fristen)
type Warn = { level: 'red' | 'amber'; text: string; href?: string };

clientRoutes.get('/cockpit', async (c) => {
  const env = c.env;
  const t = today(env);
  const ym = monthKey(t);
  const year = t.slice(0, 4);
  const s = await getSettings(env.DB);
  const hourCost = Number(s.internal_hour_cost) || 0;
  const contactDays = Number(s.health_contact_days) || 30;
  const soon = addDays(t, 30);

  const q = (sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args);
  const [cos, systems, subs, periods, tasks, acts, quotes, hours, hoursMonth, lic, contracts, owners] = (await env.DB.batch([
    q(`SELECT id, name, customer_no, owner_id, tags, created_at FROM companies ORDER BY name`),
    q(`SELECT id, company_id, name, status, monitor, check_ok, down_since, domain_expires, ssl_expires, hosting FROM systems WHERE status != 'ended'`),
    q(`SELECT * FROM subscriptions WHERE status = 'active'`),
    q(`SELECT company_id, status, amount, due_date, paid_at FROM subscription_periods`),
    q(`SELECT company_id, status, priority, due_at, unread, source FROM tasks WHERE status != 'done' AND company_id IS NOT NULL`),
    q(`SELECT company_id, MAX(created_at) AS last FROM activities WHERE company_id IS NOT NULL AND type IN ('email','call','meeting','note') GROUP BY company_id`),
    q(`SELECT company_id, SUM(total) AS sum FROM quotes WHERE status = 'accepted' AND substr(COALESCE(decided_at, issue_date),1,4) = ? GROUP BY company_id`, year),
    q(`SELECT company_id, SUM(minutes) AS m FROM time_entries WHERE substr(date,1,4) = ? AND company_id IS NOT NULL GROUP BY company_id`, year),
    q(`SELECT company_id, SUM(minutes) AS m FROM time_entries WHERE substr(date,1,7) = ? AND company_id IS NOT NULL GROUP BY company_id`, ym),
    q(`SELECT id, company_id, edition, valid_until, status FROM licenses WHERE status = 'active'`),
    q(`SELECT id, company_id, kind, title, status, end_date, notice_days, auto_renew FROM contracts WHERE status != 'ended'`),
    q(`SELECT id, name, email FROM users`),
  ])).map((r) => r.results as any[]);

  const by = <T extends { company_id: string }>(list: T[], id: string) => list.filter((x) => x.company_id === id);
  const rows = cos.map((co: any) => {
    const warns: Warn[] = [];
    let score = 100;
    const sys = by(systems, co.id);
    for (const x of sys) if (x.monitor && x.check_ok === 0) { score -= 40; warns.push({ level: 'red', text: `${x.name} ist nicht erreichbar` }); }
    for (const x of sys) {
      for (const [k, label] of [['domain_expires', 'Domain'], ['ssl_expires', 'SSL-Zertifikat']] as const) {
        if (x[k] && x[k] <= soon) { score -= 10; warns.push({ level: x[k] < t ? 'red' : 'amber', text: `${label} ${x.name} läuft ab am ${x[k]}` }); }
      }
    }
    const per = by(periods, co.id);
    const overdue = per.filter((p) => p.status !== 'paid' && p.due_date < addDays(t, -14));
    if (overdue.length) { score -= 25; warns.push({ level: 'red', text: `${overdue.length} Abrechnung(en) überfällig` }); }
    const tk = by(tasks, co.id);
    const late = tk.filter((x) => x.due_at && x.due_at.slice(0, 10) < t);
    if (late.length) { score -= Math.min(20, late.length * 5); warns.push({ level: 'amber', text: `${late.length} Aufgabe(n) überfällig` }); }
    const unread = tk.filter((x) => x.unread);
    if (unread.length) { score -= Math.min(15, unread.length * 5); warns.push({ level: 'amber', text: `${unread.length} neue Kundenreaktion(en)` }); }
    const fb = tk.filter((x) => x.source === 'review').length;
    const sb = by(subs, co.id);
    const incl = sb.reduce((a, x) => a + (Number(x.included_hours) || 0), 0);
    const usedMonth = ((by(hoursMonth, co.id)[0]?.m as number) || 0) / 60;
    if (incl > 0 && usedMonth > incl) { score -= 10; warns.push({ level: 'red', text: `Stundenkontingent überschritten (${usedMonth.toFixed(1)} / ${incl} h)` }); }
    else if (incl > 0 && usedMonth >= incl * 0.8) { score -= 5; warns.push({ level: 'amber', text: `Stundenkontingent zu ${Math.round((usedMonth / incl) * 100)} % verbraucht` }); }
    for (const l of by(lic, co.id)) if (l.valid_until && l.valid_until <= soon) { score -= 10; warns.push({ level: l.valid_until < t ? 'red' : 'amber', text: `Lizenz ${l.edition} läuft ab am ${l.valid_until}` }); }
    for (const k of by(contracts, co.id)) {
      const nd = noticeDeadline(k);
      if (nd && nd >= t && nd <= soon) { score -= 5; warns.push({ level: 'amber', text: `${k.title}: Kündigungsfrist endet am ${nd}` }); }
      if (k.kind === 'dpa' && k.status !== 'signed') { score -= 5; warns.push({ level: 'amber', text: 'AVV noch nicht unterschrieben' }); }
    }
    const isClient = sb.length > 0 || sys.length > 0;
    const last = by(acts, co.id)[0]?.last as string | undefined;
    if (isClient && (!last || daysBetween(last, t) > contactDays)) { score -= 10; warns.push({ level: 'amber', text: last ? `Kein Kontakt seit ${daysBetween(last, t)} Tagen` : 'Noch kein Kontakt erfasst' }); }

    const mrr = sb.reduce((a, x) => a + x.amount * factor(x.interval), 0);
    const paid = per.filter((p) => p.status === 'paid' && (p.paid_at || p.due_date).slice(0, 4) === year).reduce((a, p) => a + p.amount, 0);
    const revenue = ((by(quotes, co.id)[0]?.sum as number) || 0) + paid;
    const hoursYear = ((by(hours, co.id)[0]?.m as number) || 0) / 60;
    const cost = hoursYear * hourCost;
    const owner = owners.find((u: any) => u.id === co.owner_id);
    return {
      id: co.id, name: co.name, customer_no: co.customer_no, owner: owner ? owner.name || owner.email : null, owner_id: co.owner_id,
      score: Math.max(0, score), level: score >= 80 ? 'green' : score >= 50 ? 'amber' : 'red', warns, is_client: isClient,
      systems: sys.length, systems_down: sys.filter((x) => x.monitor && x.check_ok === 0).length, open_tasks: tk.length, feedback_open: fb,
      mrr, revenue, hours: hoursYear, cost, margin: revenue - cost, margin_pct: revenue ? Math.round(((revenue - cost) / revenue) * 100) : null,
      included_hours: incl, hours_month: usedMonth, last_contact: last || null,
    };
  });
  const clients = rows.filter((r) => r.is_client || r.open_tasks || r.revenue);
  const unpaid = periods.filter((p: any) => p.status !== 'paid');
  return c.json({
    kpi: {
      mrr: clients.reduce((a, r) => a + r.mrr, 0),
      clients: clients.length,
      systems: systems.length,
      down: systems.filter((x: any) => x.monitor && x.check_ok === 0).length,
      unpaid: unpaid.reduce((a: number, p: any) => a + p.amount, 0),
      overdue: unpaid.filter((p: any) => p.due_date < t).reduce((a: number, p: any) => a + p.amount, 0),
      red: clients.filter((r) => r.level === 'red').length,
      amber: clients.filter((r) => r.level === 'amber').length,
      revenue: clients.reduce((a, r) => a + r.revenue, 0),
      margin: clients.reduce((a, r) => a + r.margin, 0),
    },
    clients: clients.sort((a, b) => a.score - b.score || b.mrr - a.mrr),
    hour_cost: hourCost,
  });
});

// ================================================================ Monatsbericht (PDF, DE/EN)
const RL = {
  de: { doc: 'Monatsbericht', cust: 'Kundennr.', period: 'Zeitraum', sys: 'Systeme & Verfügbarkeit', avail: 'Verfügbarkeit', ver: 'Version', none: 'Keine Einträge.', rel: 'Releases & Neuerungen', done: 'Erledigt', open: 'Offen / in Arbeit', fb: 'Feedback aus dem Kundenportal', hours: 'Aufwand', incl: 'Kontingent', used: 'Geleistet', next: 'Nächste Schritte', status: { todo: 'Offen', doing: 'In Arbeit', review: 'Bei Ihnen zur Prüfung', done: 'Erledigt' } as Record<string, string>, hosting: 'Betrieb', page: 'Seite', intro: (n: string, m: string) => `Hier ist die Zusammenfassung für ${n} im ${m}.`, h: 'Std.', fbline: (a: number, b: number, c: number) => `${a} neue Punkte · ${b} umgesetzt · ${c} offen` },
  en: { doc: 'Monthly report', cust: 'Customer no.', period: 'Period', sys: 'Systems & availability', avail: 'Availability', ver: 'Version', none: 'No entries.', rel: 'Releases & updates', done: 'Completed', open: 'Open / in progress', fb: 'Feedback from the client portal', hours: 'Effort', incl: 'Included', used: 'Delivered', next: 'Next steps', status: { todo: 'Open', doing: 'In progress', review: 'Awaiting your review', done: 'Done' } as Record<string, string>, hosting: 'Operations', page: 'Page', intro: (n: string, m: string) => `Here is the summary for ${n} for ${m}.`, h: 'hrs', fbline: (a: number, b: number, c: number) => `${a} new items · ${b} implemented · ${c} open` },
};
const HOSTING_L: Record<string, [string, string]> = { devunox_cloud: ['devunox Cloud (EU)', 'devunox Cloud (EU)'], on_prem: ['On-Premise', 'On-premise'], aws: ['AWS', 'AWS'], azure: ['Microsoft Azure', 'Microsoft Azure'], gcp: ['Google Cloud', 'Google Cloud'], hetzner: ['Hetzner', 'Hetzner'], other: ['Andere Cloud', 'Other cloud'] };

export async function renderClientReport(env: Env, companyId: string, period: string, lang: 'de' | 'en') {
  const t = RL[lang];
  const co = await env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(companyId).first<any>();
  if (!co) throw new Error('Kunde nicht gefunden');
  const from = `${period}-01`;
  const to = `${addMonths(period, 1)}-01`;
  const q = (sql: string, ...a: unknown[]) => env.DB.prepare(sql).bind(...a);
  const [sys, rel, done, open, fbNew, fbDone, mins, subs] = (await env.DB.batch([
    q(`SELECT s.*, (SELECT ROUND(100.0*AVG(ok),2) FROM system_checks k WHERE k.system_id = s.id AND k.at >= ? AND k.at < ?) AS up FROM systems s WHERE s.company_id = ? AND s.status != 'ended' ORDER BY s.name`, from, to, companyId),
    q(`SELECT r.*, s.name AS system_name FROM releases r LEFT JOIN systems s ON s.id = r.system_id WHERE r.company_id = ? AND r.released_at >= ? AND r.released_at < ? ORDER BY r.released_at`, companyId, from, to),
    q(`SELECT title FROM tasks WHERE company_id = ? AND status = 'done' AND completed_at >= ? AND completed_at < ? AND source != 'ops' ORDER BY completed_at`, companyId, from, to),
    q(`SELECT title, status, due_at FROM tasks WHERE company_id = ? AND status != 'done' AND source != 'ops' ORDER BY due_at IS NULL, due_at, sort LIMIT 25`, companyId),
    q(`SELECT COUNT(*) AS n FROM tasks WHERE company_id = ? AND source = 'review' AND created_at >= ? AND created_at < ?`, companyId, from, to),
    q(`SELECT COUNT(*) AS n FROM tasks WHERE company_id = ? AND source = 'review' AND status = 'done' AND completed_at >= ? AND completed_at < ?`, companyId, from, to),
    q(`SELECT COALESCE(SUM(minutes),0) AS m, COALESCE(SUM(CASE WHEN billable = 1 THEN minutes ELSE 0 END),0) AS b FROM time_entries WHERE company_id = ? AND date >= ? AND date < ?`, companyId, from, to),
    q(`SELECT SUM(included_hours) AS h FROM subscriptions WHERE company_id = ? AND status = 'active'`, companyId),
  ])).map((r) => r.results as any[]);
  const fbOpen = open.filter((x: any) => true).length;
  const s = await getSettings(env.DB);
  const monthName = new Date(from + 'T12:00:00Z').toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', { month: 'long', year: 'numeric' });

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${t.doc} ${monthName} – ${co.name}`);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedLogo(pdf);
  const W = 595.28, H = 841.89, M = 56, CW = W - 2 * M;
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const text = (str: string, x: number, yy: number, o: { size?: number; f?: PDFFont; color?: any; right?: boolean } = {}) => {
    const size = o.size ?? 10, f = o.f ?? font, c2 = clean(str);
    page.drawText(c2, { x: o.right ? x - f.widthOfTextAtSize(c2, size) : x, y: yy, size, font: f, color: o.color ?? DARK });
  };
  const newPage = () => { page = pdf.addPage([W, H]); pages.push(page); drawBrandHeader(page, logo, W, H, M, 140); y = H - 100; };
  const ensure = (h: number) => { if (y - h < 70) newPage(); };
  const heading = (h: string) => { ensure(40); y -= 10; text(h, M, y, { size: 13, f: bold }); page.drawRectangle({ x: M, y: y - 7, width: 26, height: 2.5, color: ORANGE }); y -= 24; };
  const para = (str: string, size = 10, color = DARK) => { for (const l of wrap(str, font, size, CW)) { ensure(14); text(l, M, y, { size, color }); y -= size + 4; } };
  const bullet = (str: string, right?: string) => {
    const lines = wrap(str, font, 10, CW - (right ? 140 : 16));
    ensure(lines.length * 14 + 2);
    page.drawCircle({ x: M + 3, y: y + 3.5, size: 2, color: ORANGE });
    lines.forEach((l, i) => text(l, M + 12, y - i * 14));
    if (right) text(right, M + CW, y, { size: 9, color: GREY, right: true });
    y -= lines.length * 14 + 2;
  };

  newPage();
  text(`${t.doc} ${monthName}`, M, y, { size: 22, f: bold });
  y -= 22;
  text([co.name, co.customer_no ? `${t.cust} ${co.customer_no}` : ''].filter(Boolean).join(' · '), M, y, { size: 11, color: GREY });
  y -= 26;
  para(t.intro(co.name, monthName));

  heading(t.sys);
  if (!sys.length) para(t.none, 10, GREY);
  for (const x of sys as any[]) {
    ensure(42);
    page.drawRectangle({ x: M - 6, y: y - 22, width: CW + 12, height: 36, color: SOFT });
    text(x.name, M + 4, y, { size: 11, f: bold });
    text(`${(HOSTING_L[x.hosting] || [x.hosting, x.hosting])[lang === 'de' ? 0 : 1]}${x.version ? ` · ${t.ver} ${x.version}` : ''}${x.prod_url ? ` · ${x.prod_url}` : ''}`, M + 4, y - 14, { size: 8.5, color: GREY });
    text(x.up !== null && x.up !== undefined ? `${t.avail} ${String(x.up).replace('.', lang === 'de' ? ',' : '.')} %` : '–', M + CW - 4, y - 6, { size: 11, f: bold, color: x.up !== null && x.up < 99 ? ORANGE : DARK, right: true });
    y -= 46;
  }
  heading(t.rel);
  if (!rel.length) para(t.none, 10, GREY);
  for (const r of rel as any[]) {
    bullet(`${r.system_name || ''} ${r.version}${r.title ? ` – ${r.title}` : ''}`, r.released_at);
    if (r.notes) { for (const l of wrap(r.notes, font, 9, CW - 16)) { ensure(12); text(l, M + 12, y, { size: 9, color: GREY }); y -= 12; } y -= 4; }
  }
  heading(t.fb);
  para(t.fbline((fbNew[0] as any)?.n || 0, (fbDone[0] as any)?.n || 0, (open as any[]).length));
  heading(t.done);
  if (!done.length) para(t.none, 10, GREY);
  for (const d of done as any[]) bullet(d.title);
  heading(t.open);
  if (!fbOpen) para(t.none, 10, GREY);
  for (const o of open as any[]) bullet(o.title, t.status[o.status] || o.status);
  heading(t.hours);
  const m = (mins[0] as any) || { m: 0, b: 0 };
  const incl = Number((subs[0] as any)?.h) || 0;
  const nf = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: 1 });
  ensure(40);
  text(`${t.used}: ${nf.format(m.m / 60)} ${t.h}`, M, y, { size: 11, f: bold });
  if (incl) text(`${t.incl}: ${nf.format(incl)} ${t.h}`, M + 200, y, { size: 11 });
  y -= 14;
  if (incl) {
    const pct = Math.min(1, m.m / 60 / incl);
    page.drawRectangle({ x: M, y: y - 6, width: CW, height: 8, color: LINE });
    page.drawRectangle({ x: M, y: y - 6, width: CW * pct, height: 8, color: m.m / 60 > incl ? rgb(0.88, 0.2, 0.31) : ORANGE });
    y -= 22;
  }
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 50 }, end: { x: W - M, y: 50 }, thickness: 0.5, color: LINE });
    p.drawText(clean([s.company_legal || s.company_name, s.company_website, s.company_email].filter(Boolean).join(' · ')), { x: M, y: 36, size: 7.5, font, color: GREY });
    const pg = `${t.page} ${i + 1}/${pages.length}`;
    p.drawText(pg, { x: W - M - font.widthOfTextAtSize(pg, 7.5), y: 36, size: 7.5, font, color: GREY });
  });
  const bytes = await pdf.save();
  const filename = `${co.customer_no ? co.customer_no + '_' : ''}${lang === 'de' ? 'Monatsbericht' : 'Monthly_report'}_${period}.pdf`;
  return { bytes, filename, company: co };
}

async function createReport(env: Env, companyId: string, period: string, lang: 'de' | 'en', userId?: string) {
  const r = await renderClientReport(env, companyId, period, lang);
  const docId = await storeDocument(env, { company_id: companyId, folder: '/Berichte/', name: r.filename, data: r.bytes, mime: 'application/pdf', source: 'report', userId });
  await env.DB.prepare(`INSERT INTO client_reports (id, company_id, period, lang, document_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT(company_id, period, lang) DO UPDATE SET document_id = excluded.document_id, created_at = datetime('now')`).bind(uid(), companyId, period, lang, docId).run();
  return env.DB.prepare('SELECT * FROM client_reports WHERE company_id = ? AND period = ? AND lang = ?').bind(companyId, period, lang).first<any>();
}

clientRoutes.get('/reports', async (c) => {
  const company = c.req.query('company_id');
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, co.name AS company_name, d.name AS file_name FROM client_reports r LEFT JOIN companies co ON co.id = r.company_id LEFT JOIN documents d ON d.id = r.document_id ${company ? 'WHERE r.company_id = ?' : ''} ORDER BY r.period DESC, co.name LIMIT 300`,
  ).bind(...(company ? [company] : [])).all();
  return c.json(results);
});
clientRoutes.post('/reports', async (c) => {
  const b = await c.req.json<{ company_id: string; period?: string; lang?: string }>();
  const period = /^\d{4}-\d{2}$/.test(b.period || '') ? b.period! : addMonths(monthKey(today(c.env)), -1);
  return c.json(await createReport(c.env, b.company_id, period, b.lang === 'en' ? 'en' : 'de', c.get('user').id));
});
clientRoutes.get('/reports/preview', async (c) => {
  const period = c.req.query('period') || addMonths(monthKey(today(c.env)), -1);
  const r = await renderClientReport(c.env, c.req.query('company_id') || '', period, c.req.query('lang') === 'en' ? 'en' : 'de');
  return new Response(r.bytes.slice().buffer as ArrayBuffer, { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(r.filename)}` } });
});
clientRoutes.post('/reports/:id/send', async (c) => {
  const rep = await c.env.DB.prepare('SELECT r.*, co.name AS company_name FROM client_reports r LEFT JOIN companies co ON co.id = r.company_id WHERE r.id = ?').bind(c.req.param('id')).first<any>();
  if (!rep) return c.json({ error: 'not found' }, 404);
  const b = await c.req.json<{ to?: string; subject?: string; body?: string }>().catch(() => ({}) as any);
  const contact = await c.env.DB.prepare(`SELECT email, first_name, last_name, salutation FROM contacts WHERE company_id = ? AND email IS NOT NULL AND email != '' ORDER BY created_at LIMIT 1`).bind(rep.company_id).first<any>();
  const to = b.to || contact?.email;
  if (!to) return c.json({ error: 'Kein Ansprechpartner mit E-Mail beim Kunden.' }, 400);
  const doc = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(rep.document_id).first<any>();
  const obj = doc ? await c.env.DOCS.get(doc.r2_key) : null;
  if (!obj) return c.json({ error: 'Bericht-PDF nicht gefunden – bitte neu erzeugen.' }, 400);
  const user = c.get('user');
  const token = await getAccessToken(c.env, user.id);
  const s = await getSettings(c.env.DB);
  const en = rep.lang === 'en';
  const month = new Date(rep.period + '-01T12:00:00Z').toLocaleDateString(en ? 'en-GB' : 'de-DE', { month: 'long', year: 'numeric' });
  const subject = b.subject || (en ? `Monthly report ${month} – ${rep.company_name}` : `Monatsbericht ${month} – ${rep.company_name}`);
  const body = b.body || (en ? `Hello${contact?.first_name ? ' ' + contact.first_name : ''},\n\nplease find attached the monthly report for ${month}: availability, completed items, open items and effort.\n\nBest regards\n${s.ai_signature || user.name}` : `Hallo${contact?.first_name ? ' ' + contact.first_name : ''},\n\nanbei der Monatsbericht für ${month}: Verfügbarkeit, erledigte und offene Punkte sowie der Aufwand.\n\nViele Grüße\n${s.ai_signature || user.name}`);
  await sendMail(token, { from: await senderEmail(c.env, user.id), fromName: user.name || s.company_name, to, subject, text: body, html: textToHtml(body), attachments: [{ filename: doc.name, mimeType: 'application/pdf', data: new Uint8Array(await obj.arrayBuffer()) }] });
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE client_reports SET sent_at = datetime('now'), sent_to = ? WHERE id = ?`).bind(to, rep.id),
    c.env.DB.prepare(`INSERT INTO activities (id, type, subject, body, company_id, done) VALUES (?, 'email', ?, ?, ?, 1)`).bind(uid(), subject, `An ${to}`, rep.company_id),
  ]);
  return c.json({ ok: true, to });
});

// ================================================================ Team
clientRoutes.get('/team', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.created_at, u.password_temp, (SELECT COUNT(*) FROM companies co WHERE co.owner_id = u.id) AS n_clients,
       (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.status != 'done') AS n_tasks FROM users u ORDER BY u.created_at`,
  ).all();
  return c.json({ users: results, me: c.get('user').id, admin: await isAdmin(c) });
});
clientRoutes.post('/team', adminOnly, async (c) => {
  const b = await c.req.json<{ email: string; name?: string; role?: string }>();
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.json({ error: 'Bitte eine gültige E-Mail angeben.' }, 400);
  if (await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) return c.json({ error: 'Diese E-Mail hat schon einen Zugang.' }, 400);
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const temp = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => alphabet[x % alphabet.length]).join('');
  await c.env.DB.prepare('INSERT INTO users (id, email, name, role, password_hash, password_temp, password_expires_at) VALUES (?, ?, ?, ?, ?, 1, ?)').bind(uid(), email, b.name || null, b.role === 'admin' ? 'admin' : 'member', await hashPassword(temp), Date.now() + 7 * 86400000).run();
  return c.json({ email, temp_password: temp, login_url: `${new URL(c.req.url).origin}/` });
});
clientRoutes.put('/team/:id', adminOnly, async (c) => {
  const b = await c.req.json<{ role?: string; name?: string }>();
  if (b.role && c.req.param('id') === c.get('user').id && b.role !== 'admin') return c.json({ error: 'Du kannst dir selbst die Admin-Rolle nicht entziehen.' }, 400);
  await updateRow(c.env.DB, 'users', c.req.param('id'), pick(b, ['role', 'name']), false);
  return c.json({ ok: true });
});
clientRoutes.delete('/team/:id', adminOnly, async (c) => {
  if (c.req.param('id') === c.get('user').id) return c.json({ error: 'Du kannst dich nicht selbst entfernen.' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(c.req.param('id')),
    c.env.DB.prepare('UPDATE companies SET owner_id = NULL WHERE owner_id = ?').bind(c.req.param('id')),
    c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(c.req.param('id')),
  ]);
  return c.json({ ok: true });
});

// ================================================================ Betrieb (Cron)
/** Alle 15 Minuten: Überwachung. Einmal täglich: Abrechnung, Fristen, Kontingente, Monatsberichte. */
export async function runOps(env: Env) {
  if (!(await clientsReady(env))) return;
  const { results: mon } = await env.DB.prepare(`SELECT * FROM systems WHERE monitor = 1 AND prod_url IS NOT NULL AND prod_url != '' AND status IN ('live','maintenance') LIMIT 60`).all<any>();
  for (let i = 0; i < mon.length; i += 6) await Promise.all(mon.slice(i, i + 6).map((s) => checkSystem(env, s).catch(() => null)));

  const t = today(env);
  const last = await env.DB.prepare(`SELECT value FROM settings WHERE key = 'ops_daily'`).first<{ value: string }>();
  if (last?.value === t) return;
  await env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('ops_daily', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(t).run();

  await generatePeriods(env);
  const soon = addDays(t, 30);
  const q = (sql: string, ...a: unknown[]) => env.DB.prepare(sql).bind(...a).all<any>().then((r) => r.results);
  for (const s of await q(`SELECT s.*, co.name AS cn FROM systems s LEFT JOIN companies co ON co.id = s.company_id WHERE s.status != 'ended'`)) {
    if (s.domain_expires && s.domain_expires <= soon) await opsTask(env, { key: `domain:${s.id}:${s.domain_expires}`, title: `Domain verlängern: ${s.domain || s.name} (${s.cn || ''}) – läuft ab ${s.domain_expires}`, company_id: s.company_id, priority: 'high', due: addDays(s.domain_expires, -7) });
    if (s.ssl_expires && s.ssl_expires <= addDays(t, 14)) await opsTask(env, { key: `ssl:${s.id}:${s.ssl_expires}`, title: `SSL-Zertifikat prüfen: ${s.name} (${s.cn || ''}) – läuft ab ${s.ssl_expires}`, company_id: s.company_id, priority: 'high', due: s.ssl_expires });
  }
  for (const l of await q(`SELECT l.*, co.name AS cn FROM licenses l LEFT JOIN companies co ON co.id = l.company_id WHERE l.status = 'active' AND l.valid_until IS NOT NULL AND l.valid_until <= ?`, soon))
    await opsTask(env, { key: `lic:${l.id}:${l.valid_until}`, title: `Lizenz verlängern: ${l.cn || 'Kunde'} – ${l.edition}, gültig bis ${l.valid_until}`, company_id: l.company_id, due: addDays(l.valid_until, -7) });
  for (const k of await q(`SELECT k.*, co.name AS cn FROM contracts k LEFT JOIN companies co ON co.id = k.company_id WHERE k.status != 'ended' AND k.end_date IS NOT NULL`)) {
    const nd = noticeDeadline(k);
    if (nd && nd >= t && nd <= addDays(t, 45)) await opsTask(env, { key: `notice:${k.id}:${nd}`, title: `Kündigungsfrist: ${k.title} (${k.cn || ''}) endet am ${nd}`, description: k.auto_renew ? `Verlängert sich sonst automatisch um ${k.renew_months} Monate.` : 'Vertrag endet ohne Verlängerung.', company_id: k.company_id, priority: 'high', due: addDays(nd, -7) });
  }
  for (const s of await q(`SELECT su.*, co.name AS cn FROM subscriptions su LEFT JOIN companies co ON co.id = su.company_id WHERE su.status = 'active' AND su.included_hours > 0`)) {
    const used = await hoursThisMonth(env, s.company_id, monthKey(t));
    if (used >= s.included_hours * 0.8) await opsTask(env, { key: `hours:${s.id}:${monthKey(t)}:${used > s.included_hours ? 'over' : '80'}`, title: used > s.included_hours ? `Stundenkontingent überschritten: ${s.cn} (${used.toFixed(1)} / ${s.included_hours} h)` : `Stundenkontingent zu 80 % verbraucht: ${s.cn} (${used.toFixed(1)} / ${s.included_hours} h)`, description: used > s.included_hours && s.overage_rate ? `Mehrstunden abrechenbar zu ${s.overage_rate} €/h.` : undefined, company_id: s.company_id });
  }
  // Monatsberichte am 1. als Entwurf (nur für Kunden mit System oder Abo)
  const settings = await getSettings(env.DB);
  if (settings.report_auto === '1' && t.slice(8, 10) === '01') {
    const prev = addMonths(monthKey(t), -1);
    for (const co of await q(`SELECT DISTINCT co.id, co.name FROM companies co WHERE co.id IN (SELECT company_id FROM systems WHERE status != 'ended') OR co.id IN (SELECT company_id FROM subscriptions WHERE status = 'active')`)) {
      const ct = await env.DB.prepare(`SELECT language FROM contacts WHERE company_id = ? ORDER BY created_at LIMIT 1`).bind(co.id).first<any>();
      try {
        await createReport(env, co.id, prev, ct?.language === 'en' ? 'en' : 'de');
        await opsTask(env, { key: `report:${co.id}:${prev}`, title: `Monatsbericht ${prev} prüfen und senden: ${co.name}`, company_id: co.id });
      } catch (e) {
        console.error('Monatsbericht', co.name, e);
      }
    }
  }
}
