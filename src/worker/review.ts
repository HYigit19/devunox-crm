// Anbindung an devunox Review (project.review.devunox.ai)
// Review → CRM: signierter Webhook POST /hooks/review – neues Feedback wird Aufgabe, Antworten/Status werden übernommen.
// CRM → Review: Statusänderung einer Review-Aufgabe wird an Review zurückgemeldet (POST /api/integrations/crm/status).
import { Hono } from 'hono';
import { AppEnv, Env, uid } from './util';

const enc = new TextEncoder();

async function sign(secret: string, ts: string, body: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}.${body}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function verifySignature(secret: string, ts: string | undefined, sig: string | undefined, body: string) {
  if (!secret || !ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  return safeEqual(await sign(secret, ts, body), sig);
}

// Status-Zuordnung
const FROM_REVIEW: Record<string, string> = { offen: 'todo', in_arbeit: 'doing', pruefen: 'review', erledigt: 'done', abgelehnt: 'done' };
const TO_REVIEW: Record<string, string> = { todo: 'offen', doing: 'in_arbeit', review: 'pruefen', done: 'pruefen' };
const PRIO: Record<string, string> = { hoch: 'high', mittel: 'medium', niedrig: 'low' };
const CAT_DE: Record<string, string> = { fehler: 'Fehler', design: 'Design', funktion: 'Funktion', text: 'Text', idee: 'Idee' };
const REVIEW_STATUS_DE: Record<string, string> = { offen: 'Offen', in_arbeit: 'In Arbeit', pruefen: 'Bitte prüfen', erledigt: 'Erledigt (vom Kunden abgenommen)', abgelehnt: 'Wird nicht umgesetzt' };

type ReviewEvent = {
  event: 'item.created' | 'item.comment' | 'item.status' | 'ping';
  project: { id: number; slug: string; name: string; app_url?: string; hub_url?: string };
  client?: { id: number; name: string };
  item?: { id: number; no: number; kind: string; title: string; body?: string; category?: string; priority?: string; status: string; page_url?: string; internal?: boolean; link?: string };
  author?: { name: string; email?: string; role: string };
  comment?: string;
  status?: { from: string; to: string; note?: string };
};

async function ensureProject(env: Env, ev: ReviewEvent) {
  const slug = ev.project.slug.toLowerCase();
  let p = await env.DB.prepare('SELECT * FROM projects WHERE review_slug = ?').bind(slug).first<any>();
  if (p) return p;
  // Firma über den Kundennamen zuordnen oder anlegen
  let companyId: string | null = null;
  if (ev.client?.name) {
    const co = await env.DB.prepare('SELECT id FROM companies WHERE LOWER(name) = LOWER(?)').bind(ev.client.name.trim()).first<any>();
    companyId = co?.id || null;
    if (!companyId) {
      companyId = uid();
      await env.DB.prepare(`INSERT INTO companies (id, name, tags) VALUES (?, ?, 'Review-Kunde')`).bind(companyId, ev.client.name.trim()).run();
    }
  }
  const id = uid();
  await env.DB.prepare(`INSERT INTO projects (id, name, company_id, status, review_slug, review_url, app_url) VALUES (?, ?, ?, 'active', ?, ?, ?)`)
    .bind(id, ev.project.name, companyId, slug, ev.project.hub_url || null, ev.project.app_url || null)
    .run();
  return env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<any>();
}

async function note(env: Env, task: any, subject: string, body?: string | null, type = 'note') {
  await env.DB.prepare(`INSERT INTO activities (id, type, subject, body, task_id, project_id, company_id, done) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`)
    .bind(uid(), type, subject, body || null, task.id, task.project_id, task.company_id)
    .run();
}

export const reviewHook = new Hono<AppEnv>();

reviewHook.post('/review', async (c) => {
  const raw = await c.req.text();
  const ok = await verifySignature(c.env.REVIEW_WEBHOOK_SECRET || '', c.req.header('x-devunox-timestamp'), c.req.header('x-devunox-signature'), raw);
  if (!ok) return c.json({ error: 'Ungültige Signatur' }, 401);
  const ev = JSON.parse(raw) as ReviewEvent;
  if (ev.event === 'ping') return c.json({ ok: true, pong: true });
  if (!ev.project?.slug || !ev.item) return c.json({ error: 'Ungültige Nachricht' }, 400);
  const it = ev.item;
  if (it.internal) return c.json({ ok: true, skipped: 'intern' });
  const project = await ensureProject(c.env, ev);
  const extId = `review:${it.id}`;
  let task = await c.env.DB.prepare('SELECT * FROM tasks WHERE external_id = ?').bind(extId).first<any>();

  if (!task) {
    // Auch Antworten/Status zu älteren Punkten legen die Aufgabe nach
    const id = uid();
    const desc = [
      it.body && it.body !== it.title ? it.body : '',
      it.page_url ? `Seite: ${it.page_url}` : '',
      ev.author ? `Von: ${ev.author.name}${ev.author.role === 'client' ? ' (Kunde)' : ''}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    await c.env.DB.prepare(
      `INSERT INTO tasks (id, title, description, status, priority, category, project_id, company_id, source, external_id, external_url, external_status, unread, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'review', ?, ?, ?, 1, ?)`,
    )
      .bind(
        id, `#${it.no} ${it.title}`.slice(0, 200), desc || null, FROM_REVIEW[it.status] || 'todo', PRIO[it.priority || ''] || 'medium',
        CAT_DE[it.category || ''] || it.category || null, project.id, project.company_id, extId, it.link || null, it.status, -Date.now() / 1000,
      )
      .run();
    task = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<any>();
    await note(c.env, task, ev.event === 'item.created' ? 'Feedback aus devunox Review' : 'Aus devunox Review übernommen', null, 'system');
    if (ev.event === 'item.created') return c.json({ ok: true, task_id: id });
  }

  if (ev.event === 'item.comment') {
    await note(c.env, task, `Antwort von ${ev.author?.name || 'Kunde'}`, ev.comment || '(Anhang)', 'email');
    await c.env.DB.prepare(`UPDATE tasks SET unread = 1, updated_at = datetime('now') WHERE id = ?`).bind(task.id).run();
  } else if (ev.event === 'item.status' && ev.status) {
    const to = FROM_REVIEW[ev.status.to] || task.status;
    await c.env.DB.prepare(
      `UPDATE tasks SET status = ?, external_status = ?, unread = 1, completed_at = CASE WHEN ? = 'done' THEN datetime('now') ELSE NULL END, updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(to, ev.status.to, to, task.id)
      .run();
    const reopened = ev.status.to === 'offen' && ['pruefen', 'erledigt'].includes(ev.status.from);
    await note(
      c.env,
      task,
      reopened ? `${ev.author?.name || 'Kunde'}: Noch nicht in Ordnung` : `Review-Status: ${REVIEW_STATUS_DE[ev.status.to] || ev.status.to}`,
      ev.status.note || null,
      'system',
    );
  } else if (ev.event === 'item.created') {
    // Doppelte Zustellung – nichts tun
  }
  return c.json({ ok: true, task_id: task.id });
});

/** Meldet eine Statusänderung aus dem CRM an devunox Review. */
export async function pushTaskStatusToReview(env: Env, task: any, status: string, noteText?: string): Promise<string> {
  if (!env.REVIEW_URL || !env.REVIEW_WEBHOOK_SECRET) return 'nicht konfiguriert';
  const itemId = Number(String(task.external_id).replace('review:', ''));
  const target = TO_REVIEW[status];
  if (!itemId || !target) return 'übersprungen';
  if (target === task.external_status) return 'unverändert';
  const body = JSON.stringify({ item_id: itemId, status: target, note: noteText || '' });
  const ts = String(Math.floor(Date.now() / 1000));
  const res = await fetch(`${env.REVIEW_URL.replace(/\/$/, '')}/api/integrations/crm/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-devunox-timestamp': ts, 'x-devunox-signature': await sign(env.REVIEW_WEBHOOK_SECRET, ts, body) },
    body,
  });
  if (!res.ok) throw new Error(`Review antwortet ${res.status}`);
  await env.DB.prepare('UPDATE tasks SET external_status = ? WHERE id = ?').bind(target, task.id).run();
  return target;
}

export { sign as signPayload };
