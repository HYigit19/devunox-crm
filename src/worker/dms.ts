import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { AppEnv, Env, hashPassword, hmac, signKey, insertRow, toBase64Url, uid, verifyPassword } from './util';

// ======================================================================= Dokumentenmanagement (DMS)
// Papierkorb, Versionen, Favoriten, Freigabelinks, Kopieren, Speicherübersicht.
// Alles nutzt eigene Tabellen (Migration 0007). Fehlen sie noch, arbeitet die Ablage wie bisher weiter.

let ready: boolean | null = null;
let checkedAt = 0;
export async function dmsReady(env: Env): Promise<boolean> {
  if (ready || Date.now() - checkedAt < 60_000) return !!ready;
  checkedAt = Date.now();
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('documents_trash','document_versions','document_stars','document_shares')`).first<{ n: number }>();
  ready = (r?.n || 0) === 4;
  return ready;
}
const NOT_READY = 'Für diese Funktion fehlt das Datenbank-Update 0007 (npx wrangler d1 migrations apply DB --remote).';

const DOC_COLS = 'id, company_id, project_id, folder, name, r2_key, mime, size, tags, source, uploaded_by, created_at, updated_at';

/** Dateien in den Papierkorb verschieben (R2-Objekte bleiben erhalten). Ohne DMS-Tabellen: endgültig löschen. */
export async function trashDocuments(env: Env, ids: string[], userId?: string | null) {
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    const ph = part.map(() => '?').join(',');
    if (await dmsReady(env)) {
      await env.DB.batch([
        env.DB.prepare(`INSERT OR REPLACE INTO documents_trash (${DOC_COLS}, deleted_by) SELECT ${DOC_COLS}, ? FROM documents WHERE id IN (${ph})`).bind(userId || null, ...part),
        env.DB.prepare(`DELETE FROM documents WHERE id IN (${ph})`).bind(...part),
      ]);
    } else {
      const { results } = await env.DB.prepare(`SELECT r2_key FROM documents WHERE id IN (${ph})`).bind(...part).all<any>();
      if (results.length) await env.DOCS.delete(results.map((r) => r.r2_key));
      await env.DB.prepare(`DELETE FROM documents WHERE id IN (${ph})`).bind(...part).run();
    }
  }
}

/** Endgültig löschen: Papierkorb-Einträge inkl. aller Versionen, Favoriten und Freigaben */
async function purge(env: Env, ids: string[]) {
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    const ph = part.map(() => '?').join(',');
    const [t, v] = await env.DB.batch([
      env.DB.prepare(`SELECT r2_key FROM documents_trash WHERE id IN (${ph})`).bind(...part),
      env.DB.prepare(`SELECT r2_key FROM document_versions WHERE document_id IN (${ph})`).bind(...part),
    ]);
    const keys = [...(t.results as any[]), ...(v.results as any[])].map((r) => r.r2_key);
    for (let k = 0; k < keys.length; k += 900) await env.DOCS.delete(keys.slice(k, k + 900));
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM documents_trash WHERE id IN (${ph})`).bind(...part),
      env.DB.prepare(`DELETE FROM document_versions WHERE document_id IN (${ph})`).bind(...part),
      env.DB.prepare(`DELETE FROM document_stars WHERE document_id IN (${ph})`).bind(...part),
      env.DB.prepare(`DELETE FROM document_shares WHERE document_id IN (${ph})`).bind(...part),
    ]);
  }
}

/** Cron: Papierkorb nach 30 Tagen leeren */
export async function purgeOldTrash(env: Env) {
  if (!(await dmsReady(env))) return;
  const { results } = await env.DB.prepare(`SELECT id FROM documents_trash WHERE deleted_at < datetime('now','-30 days') LIMIT 500`).all<{ id: string }>();
  if (results.length) await purge(env, results.map((r) => r.id));
}

/** Gleichnamige Datei ersetzen und die alte Fassung als Version behalten. Gibt die Dokument-ID zurück oder null (kein DMS). */
export async function addVersion(env: Env, old: { id: string; r2_key: string; name: string; mime?: string; size?: number; uploaded_by?: string }, nu: { r2_key: string; mime: string; size: number; source?: string; userId?: string | null }) {
  if (!(await dmsReady(env))) return null;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO document_versions (id, document_id, r2_key, name, mime, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(uid(), old.id, old.r2_key, old.name, old.mime || null, old.size || 0, old.uploaded_by || null),
    env.DB.prepare(`UPDATE documents SET r2_key = ?, mime = ?, size = ?, source = COALESCE(?, source), uploaded_by = ?, updated_at = datetime('now') WHERE id = ?`).bind(nu.r2_key, nu.mime, nu.size, nu.source || null, nu.userId || null, old.id),
  ]);
  return old.id;
}

export const dmsRoutes = new Hono<AppEnv>();

// Die DMS-Endpunkte setzen die neuen Tabellen voraus
dmsRoutes.use('*', async (c, next) => {
  const p = new URL(c.req.url).pathname;
  const needs = /\/documents\/(trash|shares|star|stats|versions)|\/documents\/[^/]+\/(versions|version|copy)/.test(p);
  if (needs && !(await dmsReady(c.env))) return c.json({ error: NOT_READY, dms: false }, 409);
  return next();
});

dmsRoutes.get('/stats', async (c) => {
  const [all, kinds, trash, vers] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS size FROM documents'),
    c.env.DB.prepare(
      `SELECT CASE WHEN mime = 'application/pdf' OR lower(name) LIKE '%.pdf' THEN 'pdf'
                   WHEN mime LIKE 'image/%' THEN 'img'
                   WHEN lower(name) LIKE '%.xls%' OR lower(name) LIKE '%.csv' THEN 'xls'
                   WHEN lower(name) LIKE '%.doc%' OR lower(name) LIKE '%.ppt%' OR lower(name) LIKE '%.txt' THEN 'doc'
                   ELSE 'other' END AS kind, COUNT(*) AS n, COALESCE(SUM(size),0) AS size
       FROM documents GROUP BY kind ORDER BY size DESC`,
    ),
    c.env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS size FROM documents_trash'),
    c.env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS size FROM document_versions'),
  ]);
  return c.json({ files: all.results[0], kinds: kinds.results, trash: trash.results[0], versions: vers.results[0] });
});

// ---------- Favoriten
dmsRoutes.post('/star', async (c) => {
  const { ids, on } = await c.req.json<{ ids: string[]; on: boolean }>();
  if (!ids?.length) return c.json({ ok: true });
  await c.env.DB.batch(ids.map((id) => (on ? c.env.DB.prepare('INSERT OR IGNORE INTO document_stars (document_id) VALUES (?)').bind(id) : c.env.DB.prepare('DELETE FROM document_stars WHERE document_id = ?').bind(id))));
  return c.json({ ok: true });
});

// ---------- Papierkorb
dmsRoutes.get('/trash', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.folder, t.mime, t.size, t.deleted_at, t.company_id, t.project_id, co.name AS company_name, co.customer_no, p.name AS project_name,
            CAST(julianday(t.deleted_at, '+30 days') - julianday('now') AS INTEGER) AS days_left
     FROM documents_trash t LEFT JOIN companies co ON co.id = t.company_id LEFT JOIN projects p ON p.id = t.project_id ORDER BY t.deleted_at DESC LIMIT 2000`,
  ).all();
  return c.json(results);
});

dmsRoutes.post('/trash/restore', async (c) => {
  const { ids } = await c.req.json<{ ids: string[] }>();
  let n = 0;
  for (const id of ids || []) {
    const t = await c.env.DB.prepare(`SELECT ${DOC_COLS} FROM documents_trash WHERE id = ?`).bind(id).first<any>();
    if (!t) continue;
    // Firma/Projekt gelöscht? → in „Meine Ablage“ wiederherstellen
    const co = t.company_id ? await c.env.DB.prepare('SELECT id FROM companies WHERE id = ?').bind(t.company_id).first() : null;
    const pr = t.project_id ? await c.env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(t.project_id).first() : null;
    const company = co ? t.company_id : null;
    const project = pr ? t.project_id : null;
    let name = t.name;
    const clash = await c.env.DB.prepare(`SELECT id FROM documents WHERE COALESCE(company_id,'') = ? AND COALESCE(project_id,'') = ? AND folder = ? AND name = ?`).bind(company || '', project || '', t.folder, name).first();
    if (clash) name = name.replace(/(\.[^.]+)?$/, (ext: string) => ` (wiederhergestellt)${ext}`);
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO documents (${DOC_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`).bind(t.id, company, project, t.folder, name, t.r2_key, t.mime, t.size, t.tags, t.source, t.uploaded_by, t.created_at),
      c.env.DB.prepare('DELETE FROM documents_trash WHERE id = ?').bind(id),
    ]);
    n++;
  }
  return c.json({ restored: n });
});

dmsRoutes.post('/trash/purge', async (c) => {
  const { ids, all } = await c.req.json<{ ids?: string[]; all?: boolean }>();
  const list = all ? ((await c.env.DB.prepare('SELECT id FROM documents_trash').all<{ id: string }>()).results.map((r) => r.id)) : ids || [];
  await purge(c.env, list);
  return c.json({ purged: list.length });
});

// ---------- Versionen
dmsRoutes.get('/:id/versions', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT v.*, u.name AS user_name FROM document_versions v LEFT JOIN users u ON u.id = v.uploaded_by WHERE v.document_id = ? ORDER BY v.created_at DESC').bind(c.req.param('id')).all();
  return c.json(results);
});

dmsRoutes.get('/versions/:vid/file', async (c) => {
  const v = await c.env.DB.prepare('SELECT v.*, d.name AS doc_name FROM document_versions v LEFT JOIN documents d ON d.id = v.document_id WHERE v.id = ?').bind(c.req.param('vid')).first<any>();
  if (!v) return c.json({ error: 'not found' }, 404);
  const obj = await c.env.DOCS.get(v.r2_key);
  if (!obj) return c.json({ error: 'Datei fehlt im Speicher' }, 404);
  const name = (v.doc_name || v.name || 'Datei').replace(/(\.[^.]+)?$/, (ext: string) => `_Version_${String(v.created_at).slice(0, 10)}${ext}`);
  return new Response(obj.body, { headers: { 'content-type': v.mime || 'application/octet-stream', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'x-content-type-options': 'nosniff' } });
});

dmsRoutes.post('/:id/versions/:vid/restore', async (c) => {
  const d = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(c.req.param('id')).first<any>();
  const v = await c.env.DB.prepare('SELECT * FROM document_versions WHERE id = ? AND document_id = ?').bind(c.req.param('vid'), c.req.param('id')).first<any>();
  if (!d || !v) return c.json({ error: 'not found' }, 404);
  // aktuelle Fassung wird zur Version, die gewählte Version wird aktuell
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO document_versions (id, document_id, r2_key, name, mime, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(uid(), d.id, d.r2_key, d.name, d.mime, d.size, d.uploaded_by),
    c.env.DB.prepare(`UPDATE documents SET r2_key = ?, mime = ?, size = ?, uploaded_by = ?, updated_at = datetime('now') WHERE id = ?`).bind(v.r2_key, v.mime || d.mime, v.size, c.get('user').id, d.id),
    c.env.DB.prepare('DELETE FROM document_versions WHERE id = ?').bind(v.id),
  ]);
  return c.json({ ok: true });
});

dmsRoutes.post('/versions/:vid/delete', async (c) => {
  const v = await c.env.DB.prepare('SELECT * FROM document_versions WHERE id = ?').bind(c.req.param('vid')).first<any>();
  if (!v) return c.json({ ok: true });
  await c.env.DOCS.delete(v.r2_key);
  await c.env.DB.prepare('DELETE FROM document_versions WHERE id = ?').bind(v.id).run();
  return c.json({ ok: true });
});

/** Neue Version einer bestehenden Datei hochladen */
dmsRoutes.post('/:id/version', async (c) => {
  const d = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(c.req.param('id')).first<any>();
  if (!d) return c.json({ error: 'not found' }, 404);
  const form = await c.req.formData();
  const f = form.get('file') as unknown as File;
  if (!f || typeof f === 'string') return c.json({ error: 'Keine Datei' }, 400);
  if (f.size > 95 * 1024 * 1024) return c.json({ error: 'Datei ist größer als 95 MB.' }, 400);
  const key = `${d.company_id || 'allgemein'}/${uid()}`;
  await c.env.DOCS.put(key, await f.arrayBuffer(), { httpMetadata: { contentType: f.type || d.mime || 'application/octet-stream' } });
  await addVersion(c.env, d, { r2_key: key, mime: f.type || d.mime || 'application/octet-stream', size: f.size, userId: c.get('user').id });
  return c.json({ ok: true });
});

// ---------- Kopieren (auch in eine andere Ablage)
dmsRoutes.post('/:id/copy', async (c) => {
  const d = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(c.req.param('id')).first<any>();
  if (!d) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{ folder?: string; company_id?: string | null }>().catch(() => ({}) as any);
  const company = body.company_id === undefined ? d.company_id : body.company_id === '__general' ? null : body.company_id || null;
  const project = company === d.company_id ? d.project_id : null;
  const folder = body.folder || d.folder;
  const obj = await c.env.DOCS.get(d.r2_key);
  if (!obj) return c.json({ error: 'Datei fehlt im Speicher' }, 404);
  const id = uid();
  const key = `${company || 'allgemein'}/${id}`;
  await c.env.DOCS.put(key, await obj.arrayBuffer(), { httpMetadata: { contentType: d.mime || 'application/octet-stream' } });
  let name = d.name;
  const clash = await c.env.DB.prepare(`SELECT id FROM documents WHERE COALESCE(company_id,'') = ? AND COALESCE(project_id,'') = ? AND folder = ? AND name = ?`).bind(company || '', project || '', folder, name).first();
  if (clash) name = name.replace(/(\.[^.]+)?$/, (ext: string) => ` (Kopie)${ext}`);
  await insertRow(c.env.DB, 'documents', { id, company_id: company, project_id: project, folder, name, r2_key: key, mime: d.mime, size: d.size, tags: d.tags, source: 'upload', uploaded_by: c.get('user').id });
  return c.json({ id });
});

// ---------- Freigabelinks
const newToken = () => toBase64Url(crypto.getRandomValues(new Uint8Array(18)));
const origin = (c: any) => (c.env.APP_URL || new URL(c.req.url).origin).replace(/\/$/, '');

dmsRoutes.get('/shares', async (c) => {
  const doc = c.req.query('document_id');
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.token, s.document_id, s.company_id, s.folder, s.label, s.expires_at, s.downloads, s.last_access_at, s.created_at, s.password_hash IS NOT NULL AS protected,
            d.name AS doc_name, d.mime AS doc_mime, co.name AS company_name, co.customer_no
     FROM document_shares s LEFT JOIN documents d ON d.id = s.document_id LEFT JOIN companies co ON co.id = COALESCE(d.company_id, s.company_id)
     WHERE s.revoked = 0 ${doc ? 'AND s.document_id = ?' : ''} AND (s.document_id IS NULL OR d.id IS NOT NULL) ORDER BY s.created_at DESC LIMIT 500`,
  ).bind(...(doc ? [doc] : [])).all<any>();
  const base = origin(c);
  return c.json(results.map((r) => ({ ...r, url: `${base}/s/${r.token}`, expired: !!(r.expires_at && r.expires_at < new Date().toISOString().replace('T', ' ').slice(0, 19)) })));
});

dmsRoutes.post('/shares', async (c) => {
  const b = await c.req.json<{ document_id?: string; company_id?: string | null; project_id?: string | null; folder?: string; expires_days?: number; password?: string; label?: string }>();
  if (!b.document_id && !b.folder) return c.json({ error: 'Datei oder Ordner fehlt' }, 400);
  if (b.document_id && !(await c.env.DB.prepare('SELECT id FROM documents WHERE id = ?').bind(b.document_id).first())) return c.json({ error: 'Datei nicht gefunden' }, 404);
  const token = newToken();
  const days = Number(b.expires_days) || 0;
  const expires = days > 0 ? new Date(Date.now() + days * 86400000).toISOString().replace('T', ' ').slice(0, 19) : null;
  if (b.password && b.password.length < 4) return c.json({ error: 'Passwort mit mindestens 4 Zeichen wählen' }, 400);
  await insertRow(c.env.DB, 'document_shares', {
    id: uid(), token, document_id: b.document_id || null, company_id: b.document_id ? null : b.company_id || null, project_id: b.document_id ? null : b.project_id || null,
    folder: b.document_id ? null : b.folder, label: b.label || null, password_hash: b.password ? await hashPassword(b.password) : null, expires_at: expires, created_by: c.get('user').id,
  });
  return c.json({ token, url: `${origin(c)}/s/${token}`, expires_at: expires });
});

dmsRoutes.post('/shares/:id/revoke', async (c) => {
  await c.env.DB.prepare('UPDATE document_shares SET revoked = 1 WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ======================================================================= Öffentliche Freigabe-Seiten (/s/:token)

export const shareRoutes = new Hono<AppEnv>();

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1).replace('.', ',')} MB`);
const page = (title: string, body: string) => `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} · devunox AI</title><link rel="icon" href="/brand/mark.svg">
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;background:#f5f4f9;color:#16151d;min-height:100vh}
.bar{height:6px;background:linear-gradient(90deg,#ff5a1f 0 26%,#953a1b 26% 38%,#141417 38%)}
.wrap{max-width:820px;margin:0 auto;padding:28px 18px 60px}
header{display:flex;justify-content:space-between;align-items:center;margin-bottom:26px}header img{width:150px}
.card{background:#fff;border:1px solid #ebeaf2;border-radius:20px;box-shadow:0 8px 24px rgba(20,20,40,.05);padding:24px}
h1{font-size:22px;margin:0 0 6px;letter-spacing:-.02em;word-break:break-word}.muted{color:#74728a;font-size:14px}
.btn{display:inline-flex;align-items:center;gap:8px;border:0;border-radius:12px;padding:12px 20px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none;background:#f2f1f7;color:#16151d}
.btn.p{background:linear-gradient(135deg,#ff5a1f,#ff3d7f);color:#fff;box-shadow:0 6px 18px rgba(255,90,31,.25)}
.row{display:flex;gap:12px;align-items:center;padding:12px 4px;border-bottom:1px solid #ebeaf2;text-decoration:none;color:inherit}.row:last-child{border-bottom:0}
.ic{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;color:#fff;font-size:10px;font-weight:700;flex:0 0 38px;background:linear-gradient(135deg,#3d7bff,#7c5cff)}
.ic.f{background:linear-gradient(135deg,#ffb547,#ff7a3d);font-size:15px}.ic.pdf{background:linear-gradient(135deg,#ff5470,#ff3d7f)}
.grow{flex:1;min-width:0}.grow b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
input{font:inherit;border:1px solid #dcdbe6;border-radius:12px;padding:12px 14px;width:100%;margin:14px 0}
.prev{margin-top:18px;border-radius:14px;overflow:hidden;border:1px solid #ebeaf2;background:#f2f1f7}.prev iframe{width:100%;height:70vh;border:0;display:block}.prev img{max-width:100%;display:block;margin:0 auto}
.crumbs{font-size:14px;margin-bottom:10px}.crumbs a{color:#ff5a1f;text-decoration:none}
footer{margin-top:22px;font-size:12px;color:#74728a;text-align:center}footer a{color:inherit}
</style></head><body><div class="bar"></div><div class="wrap"><header><img src="/brand/logo.png" alt="devunox AI"><span class="muted">Sichere Freigabe · Secure share</span></header>${body}
<footer>Bereitgestellt über devunox AI · <a href="https://www.devunox.ai">www.devunox.ai</a></footer></div></body></html>`;

const kindIcon = (name: string, mime?: string) => (/pdf$/i.test(name) || mime === 'application/pdf' ? ['pdf', 'PDF'] : [(name.split('.').pop() || 'DAT').toUpperCase().slice(0, 4), (name.split('.').pop() || 'DAT').toUpperCase().slice(0, 4)]);

async function loadShare(c: any): Promise<{ s?: any; err?: string }> {
  const env = c.env as Env;
  const s: any = await env.DB.prepare('SELECT * FROM document_shares WHERE token = ? AND revoked = 0').bind(c.req.param('token')).first();
  if (!s) return { err: 'Dieser Link ist ungültig oder wurde zurückgezogen. / This link is invalid or has been revoked.' };
  if (s.expires_at && s.expires_at < new Date().toISOString().replace('T', ' ').slice(0, 19)) return { err: 'Dieser Link ist abgelaufen. / This link has expired.' };
  return { s };
}
const cookieName = (token: string) => `dvx_s_${token.slice(0, 12)}`;
async function unlocked(c: any, s: any) {
  if (!s.password_hash) return true;
  const v = getCookie(c, cookieName(s.token));
  return !!v && v === (await hmac(signKey(c.env), `share:${s.token}:${s.password_hash.slice(-16)}`));
}
const lockPage = (c: any, wrong = false) =>
  c.html(page('Geschützte Freigabe', `<div class="card"><h1>Passwort erforderlich</h1><div class="muted">Diese Freigabe ist geschützt. / This share is password protected.</div>
  <form method="post"><input type="password" name="password" placeholder="Passwort / Password" autofocus required>${wrong ? '<div style="color:#e0344f;font-size:14px;margin:-6px 0 12px">Falsches Passwort. / Wrong password.</div>' : ''}<button class="btn p" type="submit">Öffnen / Open</button></form></div>`), wrong ? 401 : 200);

/** Datei-Antwort für Freigaben */
async function serveDoc(c: any, s: any, d: any, download: boolean) {
  const env = c.env as Env;
  const obj = await env.DOCS.get(d.r2_key);
  if (!obj) return c.text('Datei fehlt', 404);
  if (download) await env.DB.prepare(`UPDATE document_shares SET downloads = downloads + 1, last_access_at = datetime('now') WHERE id = ?`).bind(s.id).run();
  const inline = !download && /^(image\/|application\/pdf)/.test(d.mime || '');
  return new Response(obj.body, {
    headers: {
      'content-type': d.mime || 'application/octet-stream',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(d.name)}`,
      'content-security-policy': "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex',
    },
  });
}

const normSub = (p?: string | null) => {
  const parts = String(p || '').split('/').map((x) => x.trim()).filter((x) => x && x !== '.' && x !== '..');
  return parts.length ? `/${parts.join('/')}/` : '/';
};

shareRoutes.post('/:token', async (c) => {
  if (!(await dmsReady(c.env))) return c.text('Nicht verfügbar', 404);
  const { s, err } = await loadShare(c);
  if (!s) return c.html(page('Link ungültig', `<div class="card"><h1>Link nicht verfügbar</h1><div class="muted">${esc(err)}</div></div>`), 404);
  const form = await c.req.formData();
  if (!(await verifyPassword(String(form.get('password') || ''), s.password_hash))) return lockPage(c, true);
  setCookie(c, cookieName(s.token), await hmac(signKey(c.env), `share:${s.token}:${s.password_hash.slice(-16)}`), { path: `/s/${s.token}`, httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 86400 });
  return c.redirect(`/s/${s.token}`, 303);
});

shareRoutes.get('/:token', async (c) => {
  if (!(await dmsReady(c.env))) return c.text('Nicht verfügbar', 404);
  const { s, err } = await loadShare(c);
  if (!s) return c.html(page('Link ungültig', `<div class="card"><h1>Link nicht verfügbar</h1><div class="muted">${esc(err)}</div></div>`), 404);
  if (!(await unlocked(c, s))) return lockPage(c);
  await c.env.DB.prepare(`UPDATE document_shares SET last_access_at = datetime('now') WHERE id = ?`).bind(s.id).run();
  const until = s.expires_at ? `<div class="muted" style="margin-top:4px">Verfügbar bis / available until ${esc(s.expires_at.slice(0, 10))}</div>` : '';

  if (s.document_id) {
    const d = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(s.document_id).first<any>();
    if (!d) return c.html(page('Nicht gefunden', '<div class="card"><h1>Datei nicht mehr verfügbar</h1><div class="muted">File no longer available.</div></div>'), 404);
    const [k, l] = kindIcon(d.name, d.mime);
    const canView = /^(image\/|application\/pdf)/.test(d.mime || '');
    const prev = d.mime?.startsWith('image/') ? `<div class="prev"><img src="/s/${esc(s.token)}/file" alt=""></div>` : '';
    return c.html(page(d.name, `<div class="card"><div class="row" style="border:0;padding:0 0 16px"><span class="ic ${k === 'pdf' ? 'pdf' : ''}">${esc(l)}</span><div class="grow"><h1>${esc(d.name)}</h1><div class="muted">${fmtSize(d.size)}${s.label ? ' · ' + esc(s.label) : ''}</div>${until}</div></div>
      <a class="btn p" href="/s/${esc(s.token)}/file?dl=1">⇩ Herunterladen / Download</a> ${canView ? `<a class="btn" href="/s/${esc(s.token)}/file" target="_blank" rel="noopener">Ansehen / View</a>` : ''}${prev}</div>`));
  }

  // Ordner-Freigabe
  const base = normSub(s.folder);
  const sub = normSub(base + (c.req.query('p') || ''));
  if (!sub.startsWith(base)) return c.redirect(`/s/${s.token}`);
  const scopeSql = `COALESCE(company_id,'') = ? AND COALESCE(project_id,'') = ?`;
  const { results: files } = await c.env.DB.prepare(`SELECT id, name, mime, size, folder FROM documents WHERE ${scopeSql} AND folder LIKE ? ORDER BY name COLLATE NOCASE`).bind(s.company_id || '', s.project_id || '', sub + '%').all<any>();
  const here = files.filter((f) => f.folder === sub);
  const subs = [...new Set(files.filter((f) => f.folder !== sub).map((f) => f.folder.slice(sub.length).split('/')[0]))].sort();
  const rel = sub.slice(base.length);
  const parts = rel.split('/').filter(Boolean);
  const root = base.split('/').filter(Boolean).pop() || 'Freigabe';
  const crumbs = [`<a href="/s/${esc(s.token)}">${esc(root)}</a>`, ...parts.map((p, i) => `<a href="/s/${esc(s.token)}?p=${encodeURIComponent(parts.slice(0, i + 1).join('/'))}">${esc(p)}</a>`)].join(' / ');
  const rows = [
    ...subs.map((n) => `<a class="row" href="/s/${esc(s.token)}?p=${encodeURIComponent([...parts, n].join('/'))}"><span class="ic f">▰</span><div class="grow"><b>${esc(n)}</b><span class="muted">Ordner</span></div></a>`),
    ...here.map((f) => { const [k, l] = kindIcon(f.name, f.mime); return `<a class="row" href="/s/${esc(s.token)}/f/${esc(f.id)}?dl=1"><span class="ic ${k === 'pdf' ? 'pdf' : ''}">${esc(l)}</span><div class="grow"><b>${esc(f.name)}</b><span class="muted">${fmtSize(f.size)}</span></div><span class="muted">⇩</span></a>`; }),
  ].join('');
  return c.html(page(root, `<div class="card"><h1>${esc(s.label || root)}</h1><div class="muted">${files.length} Datei(en) · ${fmtSize(files.reduce((a, f) => a + f.size, 0))}</div>${until}<div class="crumbs" style="margin-top:14px">${crumbs}</div>${rows || '<div class="muted" style="padding:16px 0">Dieser Ordner ist leer. / This folder is empty.</div>'}</div>`));
});

shareRoutes.get('/:token/file', async (c) => {
  if (!(await dmsReady(c.env))) return c.text('Nicht verfügbar', 404);
  const { s } = await loadShare(c);
  if (!s || !s.document_id) return c.text('Nicht verfügbar', 404);
  if (!(await unlocked(c, s))) return c.redirect(`/s/${s.token}`);
  const d = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(s.document_id).first<any>();
  if (!d) return c.text('Nicht verfügbar', 404);
  return serveDoc(c, s, d, !!c.req.query('dl'));
});

shareRoutes.get('/:token/f/:id', async (c) => {
  if (!(await dmsReady(c.env))) return c.text('Nicht verfügbar', 404);
  const { s } = await loadShare(c);
  if (!s || s.document_id) return c.text('Nicht verfügbar', 404);
  if (!(await unlocked(c, s))) return c.redirect(`/s/${s.token}`);
  const d = await c.env.DB.prepare(`SELECT * FROM documents WHERE id = ? AND COALESCE(company_id,'') = ? AND COALESCE(project_id,'') = ? AND folder LIKE ?`).bind(c.req.param('id'), s.company_id || '', s.project_id || '', normSub(s.folder) + '%').first<any>();
  if (!d) return c.text('Nicht verfügbar', 404);
  return serveDoc(c, s, d, !!c.req.query('dl'));
});
