import { Hono } from 'hono';
import { AppEnv, insertRow, pick, uid, updateRow, getSettings } from './util';
import { eligibility, generateCampaignMail, sendEnrollmentStep, unsubscribeUrl, footer } from './ai';

export const campaignRoutes = new Hono<AppEnv>();

const FIELDS = ['name', 'goal', 'offer', 'audience', 'tone', 'language', 'steps', 'daily_limit', 'research', 'require_consent', 'booking_link'];

export const DEFAULT_STEPS = [
  { delay_days: 0, instruction: 'Erstkontakt: kurzer, persönlicher Einstieg mit konkretem Bezug zum Unternehmen, Nutzen in einem Satz, Frage nach kurzem Austausch (15 Min.).' },
  { delay_days: 4, instruction: 'Follow-up 1: freundlich nachfassen, einen zusätzlichen konkreten Mehrwert oder typisches Problem aus der Praxis nennen.' },
  { delay_days: 7, instruction: 'Follow-up 2 (letzte Mail): kurz und respektvoll abschließen, Tür offen lassen, fragen ob jemand anderes zuständig ist.' },
];

function normSteps(v: unknown): string {
  const arr = typeof v === 'string' ? JSON.parse(v) : v;
  if (!Array.isArray(arr) || !arr.length) throw new Error('Mindestens ein Schritt erforderlich');
  return JSON.stringify(arr.slice(0, 6).map((s: any, i: number) => ({ delay_days: i === 0 ? 0 : Math.max(1, Number(s.delay_days) || 3), instruction: String(s.instruction || '').slice(0, 1000) })));
}

campaignRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT k.*,
      (SELECT COUNT(*) FROM enrollments WHERE campaign_id = k.id) AS enrolled,
      (SELECT COUNT(*) FROM enrollments WHERE campaign_id = k.id AND status = 'active') AS active_count,
      (SELECT COUNT(*) FROM enrollments WHERE campaign_id = k.id AND status = 'replied') AS replied,
      (SELECT COUNT(*) FROM campaign_messages WHERE campaign_id = k.id) AS sent
     FROM campaigns k ORDER BY k.created_at DESC`,
  ).all();
  return c.json(results);
});

campaignRoutes.get('/defaults', (c) => c.json({ steps: DEFAULT_STEPS }));

campaignRoutes.post('/', async (c) => {
  const body = await c.req.json<any>();
  if (!body.name) return c.json({ error: 'Name fehlt' }, 400);
  const id = uid();
  const data = pick(body, FIELDS);
  data.steps = normSteps(body.steps || DEFAULT_STEPS);
  await insertRow(c.env.DB, 'campaigns', { id, ...data, status: 'draft', owner_id: c.get('user').id });
  return c.json(await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first());
});

campaignRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const k = await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first();
  if (!k) return c.json({ error: 'not found' }, 404);
  const [enr, msgs, logs] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT e.*, ct.first_name, ct.last_name, ct.email, ct.consent, co.name AS company_name, co.country
       FROM enrollments e JOIN contacts ct ON ct.id = e.contact_id LEFT JOIN companies co ON co.id = ct.company_id
       WHERE e.campaign_id = ? ORDER BY e.created_at`,
    ).bind(id),
    c.env.DB.prepare(
      `SELECT m.*, ct.first_name, ct.last_name, ct.email FROM campaign_messages m JOIN contacts ct ON ct.id = m.contact_id WHERE m.campaign_id = ? ORDER BY m.sent_at DESC LIMIT 200`,
    ).bind(id),
    c.env.DB.prepare('SELECT * FROM agent_log WHERE campaign_id = ? ORDER BY id DESC LIMIT 50').bind(id),
  ]);
  return c.json({ ...k, enrollments: enr.results, messages: msgs.results, log: logs.results });
});

campaignRoutes.put('/:id', async (c) => {
  const body = await c.req.json<any>();
  const data = pick(body, FIELDS);
  if (body.steps) data.steps = normSteps(body.steps);
  await updateRow(c.env.DB, 'campaigns', c.req.param('id'), data);
  return c.json(await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(c.req.param('id')).first());
});

campaignRoutes.delete('/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM campaigns WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

campaignRoutes.post('/:id/status', async (c) => {
  const { status } = await c.req.json<{ status: string }>();
  if (!['draft', 'active', 'paused', 'done'].includes(status)) return c.json({ error: 'Ungültig' }, 400);
  if (status === 'active') {
    const n = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM enrollments WHERE campaign_id = ? AND status = 'active'`).bind(c.req.param('id')).first<{ n: number }>();
    if (!n?.n) return c.json({ error: 'Keine aktiven Kontakte in der Kampagne.' }, 400);
  }
  await c.env.DB.prepare(`UPDATE campaigns SET status = ?, updated_at = datetime('now') WHERE id = ?`).bind(status, c.req.param('id')).run();
  return c.json({ ok: true });
});

/** Kontakte einschreiben – prüft Einwilligung/Opt-out. */
campaignRoutes.post('/:id/enroll', async (c) => {
  const id = c.req.param('id');
  const { contact_ids } = await c.req.json<{ contact_ids: string[] }>();
  const k = await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first<any>();
  if (!k) return c.json({ error: 'not found' }, 404);
  const added: string[] = [];
  const rejected: { id: string; name: string; reason: string }[] = [];
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < contact_ids.length; i += 50) {
    const chunk = contact_ids.slice(i, i + 50);
    const { results } = await c.env.DB.prepare(
      `SELECT ct.*, co.country AS company_country, co.name AS company_name FROM contacts ct LEFT JOIN companies co ON co.id = ct.company_id
       WHERE ct.id IN (${chunk.map(() => '?').join(',')})`,
    )
      .bind(...chunk)
      .all<any>();
    for (const ct of results) {
      const why = eligibility(k, ct, { country: ct.company_country });
      const name = [ct.first_name, ct.last_name].filter(Boolean).join(' ') || ct.email;
      if (why) {
        rejected.push({ id: ct.id, name, reason: why });
        continue;
      }
      stmts.push(
        c.env.DB.prepare(`INSERT OR IGNORE INTO enrollments (id, campaign_id, contact_id, step, status, next_send_at) VALUES (?, ?, ?, 0, 'active', NULL)`).bind(uid(), id, ct.id),
      );
      added.push(ct.id);
    }
  }
  for (let i = 0; i < stmts.length; i += 80) await c.env.DB.batch(stmts.slice(i, i + 80));
  return c.json({ added: added.length, rejected });
});

campaignRoutes.post('/:id/enrollments/:eid/stop', async (c) => {
  await c.env.DB.prepare(`UPDATE enrollments SET status = 'stopped' WHERE id = ? AND campaign_id = ?`).bind(c.req.param('eid'), c.req.param('id')).run();
  return c.json({ ok: true });
});
campaignRoutes.post('/:id/enrollments/:eid/resume', async (c) => {
  await c.env.DB.prepare(`UPDATE enrollments SET status = 'active', fail_count = 0, error = NULL, next_send_at = NULL WHERE id = ? AND campaign_id = ?`)
    .bind(c.req.param('eid'), c.req.param('id'))
    .run();
  return c.json({ ok: true });
});
campaignRoutes.delete('/:id/enrollments/:eid', async (c) => {
  await c.env.DB.prepare(`DELETE FROM enrollments WHERE id = ? AND campaign_id = ?`).bind(c.req.param('eid'), c.req.param('id')).run();
  return c.json({ ok: true });
});

/** Vorschau: generiert die Mail für einen Kontakt, ohne zu senden. */
campaignRoutes.post('/:id/preview', async (c) => {
  const { contact_id, step } = await c.req.json<{ contact_id: string; step?: number }>();
  const k = await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(c.req.param('id')).first<any>();
  const ct = await c.env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(contact_id).first<any>();
  if (!k || !ct) return c.json({ error: 'not found' }, 404);
  const co = ct.company_id ? await c.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(ct.company_id).first<any>() : null;
  const s = await getSettings(c.env.DB);
  const mail = await generateCampaignMail(c.env, k, ct, co, Number(step) || 0, []);
  return c.json({
    to: ct.email,
    subject: mail.subject,
    body: mail.body.trim() + footer(mail.language, s.ai_signature, await unsubscribeUrl(c.env, ct.id)),
    warning: eligibility(k, ct, co),
  });
});

/** Sofort senden (nächster Schritt) für eine Einschreibung – ignoriert Zeitfenster. */
campaignRoutes.post('/:id/enrollments/:eid/send-now', async (c) => {
  const r = await sendEnrollmentStep(c.env, c.req.param('eid'));
  return c.json(r);
});
