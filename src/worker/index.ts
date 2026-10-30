import { Hono } from 'hono';
import { AppEnv, Env, getSettings, setSettings, hmac, DEFAULT_SETTINGS } from './util';
import { authRoutes, requireAuth } from './auth';
import { crmRoutes } from './crm';
import { quoteRoutes } from './quotes';
import { campaignRoutes } from './campaigns';
import { rfqRoutes, techRoutes } from './rfq';
import { taskRoutes, projectRoutes, docRoutes } from './work';
import { reviewHook } from './review';
import { runAgent } from './ai';
import { getAccessToken, upcomingEvents, GoogleError } from './google';

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  console.error(err);
  const status = err instanceof GoogleError && err.status === 401 ? 401 : 500;
  return c.json({ error: err.message || 'Serverfehler', google: err instanceof GoogleError }, status === 401 ? 400 : status);
});

app.route('/auth', authRoutes);
app.route('/hooks', reviewHook);

// ---------- Öffentliche Abmeldung (List-Unsubscribe, One-Click) ----------
async function unsubscribe(env: Env, token: string) {
  const [id, sig] = token.split('.');
  if (!id || !sig || sig !== (await hmac(env.ENCRYPTION_KEY, id))) return false;
  await env.DB.batch([
    env.DB.prepare(`UPDATE contacts SET consent = 'opt_out', consent_note = 'Über Abmeldelink abgemeldet', updated_at = datetime('now') WHERE id = ?`).bind(id),
    env.DB.prepare(`UPDATE enrollments SET status = 'opted_out' WHERE contact_id = ? AND status = 'active'`).bind(id),
  ]);
  return true;
}
const page = (body: string) =>
  `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Abmeldung</title>
  <style>body{font-family:system-ui,sans-serif;background:#f6f8fc;display:grid;place-items:center;min-height:100vh;margin:0;color:#1f2937}
  .c{background:#fff;padding:40px;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.06);max-width:440px;text-align:center}
  button{background:#1d4ed8;color:#fff;border:0;border-radius:10px;padding:12px 22px;font-size:15px;cursor:pointer}</style></head>
  <body><div class="c">${body}</div></body></html>`;
// GET zeigt nur eine Bestätigung (Link-Scanner in Firmen-Postfächern rufen Links automatisch auf).
app.get('/u/:token', (c) =>
  c.html(page(`<h2>Abmelden?</h2><p>Möchten Sie keine weiteren E-Mails von uns erhalten?<br><em>Unsubscribe from further emails?</em></p>
  <form method="post"><button type="submit">Abmelden / Unsubscribe</button></form>`)),
);
// POST: Bestätigung und One-Click-Abmeldung (RFC 8058) aus Gmail/Outlook.
app.post('/u/:token', async (c) =>
  c.html(
    page(
      (await unsubscribe(c.env, c.req.param('token')))
        ? '<h2>Sie wurden abgemeldet</h2><p>Sie erhalten keine weiteren Nachrichten mehr von uns.<br><br><em>You have been unsubscribed.</em></p>'
        : '<h2>Link ungültig</h2><p>Bitte antworten Sie einfach auf die E-Mail.</p>',
    ),
  ),
);

// ---------- API ----------
const api = new Hono<AppEnv>();
api.use('*', requireAuth);

api.get('/me', async (c) => {
  const u = await c.env.DB.prepare('SELECT scopes, refresh_token_enc IS NOT NULL AS google FROM users WHERE id = ?').bind(c.get('user').id).first<any>();
  return c.json({ ...c.get('user'), google: !!u?.google, scopes: u?.scopes || '', ai: !!c.env.ANTHROPIC_API_KEY, model: c.env.AI_MODEL || 'claude-sonnet-5-5' });
});

api.get('/settings', async (c) => c.json(await getSettings(c.env.DB)));
api.put('/settings', async (c) => {
  const body = await c.req.json<Record<string, string>>();
  const allowed = Object.fromEntries(Object.entries(body).filter(([k]) => k in DEFAULT_SETTINGS));
  await setSettings(c.env.DB, allowed);
  return c.json(await getSettings(c.env.DB));
});

api.get('/dashboard', async (c) => {
  const db = c.env.DB;
  const [pipe, quotesOpen, quotesWon, quoteRate, tasks, agent, recent, stages, taskStats, projects, docs, due] = await db.batch([
    db.prepare(`SELECT COALESCE(SUM(value),0) AS total, COALESCE(SUM(value * probability / 100.0),0) AS weighted, COUNT(*) AS n FROM deals WHERE stage NOT IN ('won','lost')`),
    db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS sum FROM quotes WHERE status = 'sent'`),
    db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS sum FROM quotes WHERE status = 'accepted' AND decided_at >= date('now','start of year')`),
    db.prepare(`SELECT SUM(status = 'accepted') AS won, SUM(status = 'rejected') AS lost FROM quotes`),
    db.prepare(
      `SELECT t.*, co.name AS company_name, p.name AS project_name FROM tasks t LEFT JOIN companies co ON co.id = t.company_id LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.status != 'done' ORDER BY t.unread DESC, t.due_at IS NULL, t.due_at, t.sort LIMIT 10`,
    ),
    db.prepare(
      `SELECT (SELECT COUNT(*) FROM campaign_messages WHERE sent_at >= datetime('now','start of day')) AS today,
              (SELECT COUNT(*) FROM campaign_messages WHERE sent_at >= datetime('now','-7 days')) AS week,
              (SELECT COUNT(*) FROM enrollments WHERE status = 'replied') AS replied,
              (SELECT COUNT(DISTINCT enrollment_id) FROM campaign_messages) AS contacted,
              (SELECT COUNT(*) FROM campaigns WHERE status = 'active') AS active`,
    ),
    db.prepare(
      `SELECT a.id, a.type, a.subject, a.created_at, a.contact_id, a.company_id, co.name AS company_name,
              TRIM(COALESCE(ct.first_name,'') || ' ' || COALESCE(ct.last_name,'')) AS contact_name
       FROM activities a LEFT JOIN companies co ON co.id = a.company_id LEFT JOIN contacts ct ON ct.id = a.contact_id
       ORDER BY a.created_at DESC LIMIT 10`,
    ),
    db.prepare(`SELECT stage, COUNT(*) AS n, COALESCE(SUM(value),0) AS sum FROM deals GROUP BY stage`),
    db.prepare(`SELECT status, COUNT(*) AS n, SUM(source = 'review') AS review, SUM(unread) AS unread FROM tasks GROUP BY status`),
    db.prepare(
      `SELECT p.id, p.name, p.status, co.name AS company_name,
         (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS n_tasks,
         (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS n_done
       FROM projects p LEFT JOIN companies co ON co.id = p.company_id WHERE p.status != 'done' ORDER BY p.updated_at DESC LIMIT 5`,
    ),
    db.prepare(
      `SELECT d.id, d.name, d.mime, d.size, d.created_at, d.company_id, co.name AS company_name FROM documents d LEFT JOIN companies co ON co.id = d.company_id ORDER BY d.created_at DESC LIMIT 6`,
    ),
    db.prepare(`SELECT id, title, due_at, status FROM tasks WHERE due_at IS NOT NULL AND due_at >= date('now','start of month','-7 days') AND due_at < date('now','start of month','+2 months')`),
  ]);
  return c.json({
    pipeline: pipe.results[0],
    quotesOpen: quotesOpen.results[0],
    quotesWon: quotesWon.results[0],
    quoteRate: quoteRate.results[0],
    tasks: tasks.results,
    agent: agent.results[0],
    recent: recent.results,
    stages: stages.results,
    taskStats: taskStats.results,
    projects: projects.results,
    docs: docs.results,
    due: due.results,
  });
});

api.get('/calendar/upcoming', async (c) => {
  try {
    const token = await getAccessToken(c.env, c.get('user').id);
    return c.json(await upcomingEvents(token, 6));
  } catch (e: any) {
    return c.json({ error: e.message, events: [] });
  }
});

api.get('/agent-log', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM agent_log ORDER BY id DESC LIMIT 100').all();
  return c.json(results);
});

api.get('/tags', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT tags FROM contacts WHERE tags IS NOT NULL AND tags != ''`).all<{ tags: string }>();
  const set = new Set<string>();
  for (const r of results) r.tags.split(',').map((t) => t.trim()).filter(Boolean).forEach((t) => set.add(t));
  return c.json([...set].sort());
});

api.route('/', crmRoutes);
api.route('/quotes', techRoutes);
api.route('/quotes', quoteRoutes);
api.route('/rfq', rfqRoutes);
api.route('/tasks', taskRoutes);
api.route('/projects', projectRoutes);
api.route('/documents', docRoutes);
api.route('/campaigns', campaignRoutes);

app.route('/api', api);

app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runAgent(env));
  },
} satisfies ExportedHandler<Env>;
