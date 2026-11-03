import { Hono } from 'hono';
import { AppEnv, Env, insertRow, pick, uid, updateRow } from './util';
import { getAccessToken, createEvent } from './google';
import { pushTaskStatusToReview, connectProjectToReview } from './review';
import { addVersion, dmsReady, trashDocuments } from './dms';

// ======================================================================= Kunden (Kundennummer + Standardordner)

export const STANDARD_FOLDERS = ['/Anfragen/', '/Angebote/', '/Technische Spezifikationen/', '/Verträge/', '/Korrespondenz/', '/Projekte/', '/Berichte/'];

export async function nextCustomerNo(env: Env): Promise<string> {
  const row = await env.DB.prepare(`INSERT INTO counters (name, year, value) VALUES ('customer', 0, 1) ON CONFLICT(name, year) DO UPDATE SET value = value + 1 RETURNING value`).first<{ value: number }>();
  return `K-${10000 + row!.value}`;
}

/** Legt eine Firma mit fortlaufender Kundennummer und Standardordnern an. */
export async function createCompany(env: Env, data: Record<string, unknown>, userId?: string | null): Promise<{ id: string; customer_no: string }> {
  const id = uid();
  const customer_no = await nextCustomerNo(env);
  await insertRow(env.DB, 'companies', { id, ...data, customer_no, owner_id: userId || null });
  await env.DB.batch(STANDARD_FOLDERS.map((p) => env.DB.prepare('INSERT OR IGNORE INTO folders (id, company_id, project_id, path) VALUES (?, ?, NULL, ?)').bind(uid(), id, p)));
  return { id, customer_no };
}

// ======================================================================= Aufgaben

export const taskRoutes = new Hono<AppEnv>();

const TASK_FIELDS = ['title', 'description', 'status', 'priority', 'category', 'due_at', 'project_id', 'company_id', 'contact_id', 'deal_id', 'quote_id', 'assignee_id', 'sort'];
const TASK_SELECT = `
  SELECT t.*, p.name AS project_name, co.name AS company_name, co.customer_no,
         TRIM(COALESCE(ct.first_name,'') || ' ' || COALESCE(ct.last_name,'')) AS contact_name,
         (SELECT COUNT(*) FROM activities a WHERE a.task_id = t.id) AS n_notes
  FROM tasks t LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN companies co ON co.id = t.company_id LEFT JOIN contacts ct ON ct.id = t.contact_id`;

export async function createTask(env: Env, data: Record<string, unknown>) {
  const id = uid();
  await insertRow(env.DB, 'tasks', { id, sort: -Date.now() / 1000, ...data });
  return id;
}

taskRoutes.get('/', async (c) => {
  const where: string[] = [];
  const args: unknown[] = [];
  for (const k of ['project_id', 'company_id', 'contact_id', 'status', 'source', 'priority']) {
    const v = c.req.query(k);
    if (v) {
      where.push(`t.${k} = ?`);
      args.push(v);
    }
  }
  if (c.req.query('open')) where.push(`t.status != 'done'`);
  const q = c.req.query('q');
  if (q) {
    where.push('(t.title LIKE ? OR t.description LIKE ?)');
    args.push(`%${q}%`, `%${q}%`);
  }
  const { results } = await c.env.DB.prepare(
    `${TASK_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY CASE t.status WHEN 'done' THEN 1 ELSE 0 END, t.sort, t.created_at DESC LIMIT ${Math.min(Number(c.req.query('limit')) || 1000, 2000)}`,
  )
    .bind(...args)
    .all();
  return c.json(results);
});

taskRoutes.post('/', async (c) => {
  const body = await c.req.json<any>();
  if (!body.title) return c.json({ error: 'Titel fehlt' }, 400);
  const user = c.get('user');
  const data = pick(body, TASK_FIELDS);
  // Firma aus Projekt übernehmen
  if (data.project_id && !data.company_id) {
    const p = await c.env.DB.prepare('SELECT company_id FROM projects WHERE id = ?').bind(data.project_id).first<any>();
    data.company_id = p?.company_id || null;
  }
  let calendarId: string | null = null;
  if (body.add_to_calendar && body.due_at) {
    const tz = c.env.TIMEZONE || 'Europe/Berlin';
    const start = body.due_at.length === 16 ? body.due_at + ':00' : body.due_at;
    const end = new Date(new Date(start + 'Z').getTime() + 30 * 60000).toISOString().slice(0, 19);
    const ev = await createEvent(await getAccessToken(c.env, user.id), { summary: body.title, description: body.description || '', start, end, timeZone: tz });
    calendarId = ev.id;
  }
  const id = await createTask(c.env, { ...data, source: 'manual', created_by: user.id, assignee_id: data.assignee_id || user.id, calendar_event_id: calendarId });
  return c.json(await c.env.DB.prepare(`${TASK_SELECT} WHERE t.id = ?`).bind(id).first());
});

taskRoutes.get('/:id', async (c) => {
  const t = await c.env.DB.prepare(`${TASK_SELECT} WHERE t.id = ?`).bind(c.req.param('id')).first<any>();
  if (!t) return c.json({ error: 'not found' }, 404);
  const { results: notes } = await c.env.DB.prepare('SELECT * FROM activities WHERE task_id = ? ORDER BY created_at').bind(t.id).all();
  if (t.unread) await c.env.DB.prepare('UPDATE tasks SET unread = 0 WHERE id = ?').bind(t.id).run();
  return c.json({ ...t, notes });
});

taskRoutes.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<any>();
  const before = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<any>();
  if (!before) return c.json({ error: 'not found' }, 404);
  const data = pick(body, TASK_FIELDS);
  if (data.status && data.status !== before.status) data.completed_at = data.status === 'done' ? new Date().toISOString() : null;
  await updateRow(c.env.DB, 'tasks', id, data);
  let sync: string | null = null;
  if (data.status && data.status !== before.status) {
    await c.env.DB.prepare(`INSERT INTO activities (id, type, subject, body, task_id, project_id, company_id, done, created_by) VALUES (?, 'system', ?, ?, ?, ?, ?, 1, ?)`)
      .bind(uid(), `Status: ${STATUS_DE[data.status as string] || data.status}`, body.note || null, id, before.project_id, before.company_id, c.get('user').id)
      .run();
    if (before.source === 'review' && before.external_id) {
      try {
        sync = await pushTaskStatusToReview(c.env, before, data.status as string, body.note);
      } catch (e: any) {
        sync = 'Fehler: ' + e.message;
      }
    }
  }
  const t = await c.env.DB.prepare(`${TASK_SELECT} WHERE t.id = ?`).bind(id).first();
  return c.json({ ...t, review_sync: sync });
});

taskRoutes.post('/:id/notes', async (c) => {
  const id = c.req.param('id');
  const { body } = await c.req.json<{ body: string }>();
  const t = await c.env.DB.prepare('SELECT project_id, company_id FROM tasks WHERE id = ?').bind(id).first<any>();
  if (!t || !body?.trim()) return c.json({ error: 'Notiz leer' }, 400);
  await c.env.DB.prepare(`INSERT INTO activities (id, type, subject, body, task_id, project_id, company_id, done, created_by) VALUES (?, 'note', 'Notiz', ?, ?, ?, ?, 1, ?)`)
    .bind(uid(), body.trim(), id, t.project_id, t.company_id, c.get('user').id)
    .run();
  return c.json({ ok: true });
});

taskRoutes.delete('/:id', async (c) => {
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM activities WHERE task_id = ?').bind(c.req.param('id')),
    c.env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(c.req.param('id')),
  ]);
  return c.json({ ok: true });
});

export const STATUS_DE: Record<string, string> = { todo: 'Offen', doing: 'In Arbeit', review: 'Beim Kunden zur Prüfung', done: 'Erledigt' };

// ======================================================================= Projekte

export const projectRoutes = new Hono<AppEnv>();
const PROJECT_FIELDS = ['name', 'company_id', 'contact_id', 'quote_id', 'deal_id', 'status', 'description', 'start_date', 'end_date', 'review_slug', 'review_url', 'app_url', 'color'];

projectRoutes.get('/', async (c) => {
  const company = c.req.query('company_id');
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, co.name AS company_name, co.customer_no, q.number AS quote_number,
       (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS n_tasks,
       (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS n_done,
       (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'done' AND t.source = 'review') AS n_feedback,
       (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.unread = 1) AS n_unread,
       (SELECT COUNT(*) FROM documents d WHERE d.project_id = p.id) AS n_docs
     FROM projects p LEFT JOIN companies co ON co.id = p.company_id LEFT JOIN quotes q ON q.id = p.quote_id
     ${company ? 'WHERE p.company_id = ?' : ''}
     ORDER BY CASE p.status WHEN 'done' THEN 1 ELSE 0 END, p.updated_at DESC`,
  )
    .bind(...(company ? [company] : []))
    .all();
  return c.json(results);
});

projectRoutes.post('/', async (c) => {
  const body = await c.req.json<any>();
  const data = pick(body, PROJECT_FIELDS);
  if (body.quote_id && !data.name) {
    const q = await c.env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(body.quote_id).first<any>();
    if (q) Object.assign(data, { name: q.title || `Projekt ${q.number}`, company_id: data.company_id || q.company_id, contact_id: data.contact_id || q.contact_id, deal_id: q.deal_id });
  }
  if (!data.name) return c.json({ error: 'Name fehlt' }, 400);
  if (data.review_slug) data.review_slug = String(data.review_slug).trim().toLowerCase();
  const id = uid();
  await insertRow(c.env.DB, 'projects', { id, status: 'active', ...data, owner_id: c.get('user').id });
  // Aus Angebot: Arbeitspakete des technischen Angebots als Aufgaben übernehmen
  if (body.quote_id && body.tasks_from_quote) {
    const tp = await c.env.DB.prepare('SELECT data FROM tech_proposals WHERE quote_id = ?').bind(body.quote_id).first<any>();
    const items = tp
      ? (JSON.parse(tp.data).requirements || []).map((r: any) => ({ title: `${r.ref} ${r.title}`, description: r.solution, category: r.package }))
      : ((await c.env.DB.prepare('SELECT name, description FROM quote_items WHERE quote_id = ? ORDER BY pos').bind(body.quote_id).all<any>()).results || []).map((i) => ({ title: i.name, description: i.description }));
    const stmts = items.map((it: any, i: number) =>
      c.env.DB.prepare(`INSERT INTO tasks (id, title, description, category, status, priority, project_id, company_id, source, sort, created_by) VALUES (?, ?, ?, ?, 'todo', 'medium', ?, ?, 'system', ?, ?)`).bind(
        uid(), it.title, it.description || null, it.category || null, id, data.company_id || null, i, c.get('user').id,
      ),
    );
    for (let i = 0; i < stmts.length; i += 80) await c.env.DB.batch(stmts.slice(i, i + 80));
  }
  return c.json(await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first());
});

projectRoutes.get('/:id', async (c) => {
  const p = await c.env.DB.prepare(
    `SELECT p.*, co.name AS company_name, co.customer_no, q.number AS quote_number, q.total AS quote_total, q.currency AS quote_currency,
            TRIM(COALESCE(ct.first_name,'') || ' ' || COALESCE(ct.last_name,'')) AS contact_name
     FROM projects p LEFT JOIN companies co ON co.id = p.company_id LEFT JOIN quotes q ON q.id = p.quote_id LEFT JOIN contacts ct ON ct.id = p.contact_id WHERE p.id = ?`,
  )
    .bind(c.req.param('id'))
    .first();
  return p ? c.json(p) : c.json({ error: 'not found' }, 404);
});

projectRoutes.put('/:id', async (c) => {
  const data = pick(await c.req.json(), PROJECT_FIELDS);
  if (data.review_slug) data.review_slug = String(data.review_slug).trim().toLowerCase();
  await updateRow(c.env.DB, 'projects', c.req.param('id'), data);
  return c.json(await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(c.req.param('id')).first());
});

projectRoutes.post('/:id/review-connect', async (c) => {
  const body = await c.req.json<any>().catch(() => ({}));
  try {
    return c.json(await connectProjectToReview(c.env, c.req.param('id'), body));
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

projectRoutes.delete('/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ======================================================================= Dokumentenablage

export const docRoutes = new Hono<AppEnv>();
const MAX_UPLOAD = 95 * 1024 * 1024;

function normFolder(f?: string | null) {
  let p = (f || '/').replace(/\\/g, '/').replace(/\/{2,}/g, '/').trim();
  p = p
    .split('/')
    .map((s) => s.trim().replace(/^\.+$/, ''))
    .filter(Boolean)
    .join('/');
  return p ? `/${p}/` : '/';
}
const safeName = (n: string) => n.replace(/[\\/\u0000-\u001f]/g, '_').trim().slice(0, 200) || 'Datei';

function scope(c: any) {
  const company = c.req.query('company_id') || null;
  const project = c.req.query('project_id') || null;
  return { company, project };
}

/** Speichert eine Datei in der Ablage (auch für Angebots-PDFs). */
export async function storeDocument(
  env: Env,
  o: { company_id: string | null; project_id?: string | null; folder?: string; name: string; data: ArrayBuffer | Uint8Array; mime: string; source?: string; userId?: string },
) {
  const id = uid();
  const key = `${o.company_id || 'allgemein'}/${id}`;
  await env.DOCS.put(key, o.data, { httpMetadata: { contentType: o.mime } });
  const size = o.data instanceof Uint8Array ? o.data.byteLength : (o.data as ArrayBuffer).byteLength;
  const folder = normFolder(o.folder);
  // gleichnamige Datei im selben Ordner ersetzen (z. B. aktualisiertes Angebot)
  const old = await env.DB.prepare(`SELECT id, r2_key, mime, size, uploaded_by FROM documents WHERE COALESCE(company_id,'') = ? AND COALESCE(project_id,'') = ? AND folder = ? AND name = ?`)
    .bind(o.company_id || '', o.project_id || '', folder, o.name)
    .first<any>();
  if (old) {
    // DMS: alte Fassung als Version behalten, Dokument-ID (Tags, Favorit, Freigaben) bleibt gleich
    const kept = await addVersion(env, { ...old, name: o.name }, { r2_key: key, mime: o.mime, size, source: o.source, userId: o.userId });
    if (kept) return kept;
    await env.DOCS.delete(old.r2_key);
    await env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(old.id).run();
  }
  await insertRow(env.DB, 'documents', {
    id, company_id: o.company_id, project_id: o.project_id || null, folder, name: o.name, r2_key: key, mime: o.mime, size, source: o.source || 'upload', uploaded_by: o.userId || null,
  });
  if (folder !== '/') await ensureFolders(env, o.company_id, o.project_id || null, folder);
  return id;
}

async function ensureFolders(env: Env, company: string | null, project: string | null, folder: string) {
  const parts = folder.split('/').filter(Boolean);
  const stmts = parts.map((_, i) =>
    env.DB.prepare('INSERT OR IGNORE INTO folders (id, company_id, project_id, path) VALUES (?, ?, ?, ?)').bind(uid(), company, project, `/${parts.slice(0, i + 1).join('/')}/`),
  );
  if (stmts.length) await env.DB.batch(stmts);
}

docRoutes.get('/', async (c) => {
  const { company, project } = scope(c);
  const general = c.req.query('general') === '1';
  const recent = c.req.query('recent') === '1';
  const starred = c.req.query('starred') === '1';
  const q = c.req.query('q');
  const dms = await dmsReady(c.env);
  const where: string[] = [];
  const args: unknown[] = [];
  if (general) where.push('d.company_id IS NULL AND d.project_id IS NULL');
  if (company) {
    where.push('d.company_id = ?');
    args.push(company);
  }
  if (project) {
    where.push('d.project_id = ?');
    args.push(project);
  }
  if (q) {
    where.push('(d.name LIKE ? OR d.tags LIKE ? OR co.name LIKE ? OR co.customer_no LIKE ?)');
    args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (starred && dms) where.push('d.id IN (SELECT document_id FROM document_stars)');
  const extra = dms
    ? `, (SELECT 1 FROM document_stars st WHERE st.document_id = d.id) AS starred,
         (SELECT COUNT(*) FROM document_versions v WHERE v.document_id = d.id) AS versions,
         (SELECT COUNT(*) FROM document_shares sh WHERE sh.document_id = d.id AND sh.revoked = 0) AS shares`
    : '';
  const { results: files } = await c.env.DB.prepare(
    `SELECT d.id, d.company_id, d.project_id, d.folder, d.name, d.mime, d.size, d.tags, d.source, d.created_at, d.updated_at, co.name AS company_name, co.customer_no, p.name AS project_name${extra}
     FROM documents d LEFT JOIN companies co ON co.id = d.company_id LEFT JOIN projects p ON p.id = d.project_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${recent ? 'COALESCE(d.updated_at, d.created_at) DESC' : 'd.folder, d.name COLLATE NOCASE'} LIMIT ${recent ? 60 : 5000}`,
  )
    .bind(...args)
    .all();
  if (recent || starred) return c.json({ files, folders: [], dms });
  const fw: string[] = [];
  const fa: unknown[] = [];
  if (general) fw.push('company_id IS NULL AND project_id IS NULL');
  if (company) {
    fw.push('company_id = ?');
    fa.push(company);
  }
  if (project) {
    fw.push('project_id = ?');
    fa.push(project);
  }
  const { results: folders } = await c.env.DB.prepare(`SELECT path FROM folders ${fw.length ? 'WHERE ' + fw.join(' AND ') : ''}`).bind(...fa).all<{ path: string }>();
  const all = new Set(folders.map((f) => f.path));
  for (const f of files as any[]) {
    const parts = f.folder.split('/').filter(Boolean);
    parts.forEach((_: string, i: number) => all.add(`/${parts.slice(0, i + 1).join('/')}/`));
  }
  return c.json({ files, folders: [...all].sort(), dms });
});

docRoutes.post('/upload', async (c) => {
  const form = await c.req.formData();
  const company = (form.get('company_id') as string) || null;
  const project = (form.get('project_id') as string) || null;
  let companyId = company;
  if (!companyId && project) companyId = (await c.env.DB.prepare('SELECT company_id FROM projects WHERE id = ?').bind(project).first<any>())?.company_id || null;
  const folder = normFolder(form.get('folder') as string);
  const ids: string[] = [];
  const files = form.getAll('files') as unknown as File[];
  const paths = form.getAll('paths') as string[];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (typeof f === 'string') continue;
    if (f.size > MAX_UPLOAD) return c.json({ error: `${f.name} ist größer als 95 MB.` }, 400);
    // relativer Pfad bei Ordner-Upload (z. B. „Projekt/Pläne/a.pdf“) → Unterordner anlegen
    const rel = paths[i] || '';
    const sub = rel.includes('/') ? rel.split('/').slice(0, -1).join('/') : '';
    ids.push(
      await storeDocument(c.env, {
        company_id: companyId, project_id: project, folder: folder + sub, name: safeName(f.name), data: await f.arrayBuffer(), mime: f.type || 'application/octet-stream', userId: c.get('user').id,
      }),
    );
  }
  return c.json({ uploaded: ids.length });
});

docRoutes.post('/folders', async (c) => {
  const { company_id, project_id, path } = await c.req.json<any>();
  const p = normFolder(path);
  if (p === '/') return c.json({ error: 'Ordnername fehlt' }, 400);
  await ensureFolders(c.env, company_id || null, project_id || null, p);
  return c.json({ path: p });
});

/** Ordner umbenennen/verschieben oder löschen (rekursiv) */
docRoutes.post('/folders/rename', async (c) => {
  const { company_id, project_id, from, to } = await c.req.json<any>();
  const a = normFolder(from), b = normFolder(to);
  if (a === '/' || b === '/') return c.json({ error: 'Ungültig' }, 400);
  const sc = `COALESCE(company_id,'') = ? AND COALESCE(project_id,'') = ?`;
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE documents SET folder = ? || substr(folder, ?) WHERE ${sc} AND folder LIKE ?`).bind(b, a.length + 1, company_id || '', project_id || '', a + '%'),
    c.env.DB.prepare(`UPDATE folders SET path = ? || substr(path, ?) WHERE ${sc} AND path LIKE ?`).bind(b, a.length + 1, company_id || '', project_id || '', a + '%'),
  ]);
  await ensureFolders(c.env, company_id || null, project_id || null, b);
  return c.json({ ok: true });
});

docRoutes.post('/folders/delete', async (c) => {
  const { company_id, project_id, path } = await c.req.json<any>();
  const p = normFolder(path);
  if (p === '/') return c.json({ error: 'Ungültig' }, 400);
  const sc = `COALESCE(company_id,'') = ? AND COALESCE(project_id,'') = ?`;
  const { results } = await c.env.DB.prepare(`SELECT id FROM documents WHERE ${sc} AND folder LIKE ?`).bind(company_id || '', project_id || '', p + '%').all<any>();
  await trashDocuments(c.env, results.map((r) => r.id), c.get('user').id);
  await c.env.DB.prepare(`DELETE FROM folders WHERE ${sc} AND path LIKE ?`).bind(company_id || '', project_id || '', p + '%').run();
  return c.json({ deleted: results.length });
});

docRoutes.put('/:id', async (c) => {
  const body = await c.req.json<any>();
  const data: Record<string, unknown> = {};
  if (body.name) data.name = safeName(body.name);
  if (body.folder !== undefined) data.folder = normFolder(body.folder);
  if (body.tags !== undefined) data.tags = body.tags || null;
  if (body.project_id !== undefined) data.project_id = body.project_id || null;
  await updateRow(c.env.DB, 'documents', c.req.param('id'), data);
  return c.json({ ok: true });
});

docRoutes.post('/bulk', async (c) => {
  const { ids, action, folder, company_id } = await c.req.json<{ ids: string[]; action: 'delete' | 'move'; folder?: string; company_id?: string | null }>();
  if (!ids?.length) return c.json({ ok: true });
  const ph = ids.map(() => '?').join(',');
  if (action === 'delete') {
    await trashDocuments(c.env, ids, c.get('user').id);
  } else if (action === 'move') {
    const target = normFolder(folder);
    if (company_id !== undefined) {
      // in eine andere Ablage verschieben („__general“ = Meine Ablage)
      const co = company_id === '__general' ? null : company_id || null;
      await c.env.DB.prepare(`UPDATE documents SET folder = ?, company_id = ?, project_id = NULL, updated_at = datetime('now') WHERE id IN (${ph})`).bind(target, co, ...ids).run();
      if (target !== '/') await ensureFolders(c.env, co, null, target);
    } else {
      await c.env.DB.prepare(`UPDATE documents SET folder = ?, updated_at = datetime('now') WHERE id IN (${ph})`).bind(target, ...ids).run();
    }
  }
  return c.json({ ok: true });
});

docRoutes.get('/:id/file', async (c) => {
  const d = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(c.req.param('id')).first<any>();
  if (!d) return c.json({ error: 'not found' }, 404);
  const obj = await c.env.DOCS.get(d.r2_key);
  if (!obj) return c.json({ error: 'Datei fehlt im Speicher' }, 404);
  const inline = !c.req.query('download') && /^(image\/|application\/pdf|text\/plain)/.test(d.mime || '');
  return new Response(obj.body, {
    headers: {
      'content-type': d.mime || 'application/octet-stream',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(d.name)}`,
      'content-security-policy': "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=300',
    },
  });
});
