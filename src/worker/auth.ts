import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { AppEnv, Env, User, encrypt, uid, setSettings } from './util';

const baseUrl = (c: any) => (c.env.APP_URL || new URL(c.req.url).origin).replace(/\/$/, '');
import { GOOGLE_SCOPES } from './google';

const SESSION_DAYS = 30;

function isAllowed(env: Env, email: string): boolean {
  const list = (env.ALLOWED_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const e = email.toLowerCase();
  return list.some((a) => (a.startsWith('@') ? e.endsWith(a) : e === a));
}

async function createSession(c: any, userId: string) {
  const id = uid() + uid().replace(/-/g, '');
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(id, userId, Date.now() + SESSION_DAYS * 86400_000)
    .run();
  setCookie(c, 'sid', id, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  });
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.get('/login', (c) => {
  const state = uid();
  setCookie(c, 'oauth_state', state, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 600 });
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${baseUrl(c)}/auth/callback`,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return c.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
});

authRoutes.get('/callback', async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state || state !== getCookie(c, 'oauth_state')) return c.text('Ungültige Anmeldung. Bitte erneut versuchen.', 400);
  deleteCookie(c, 'oauth_state', { path: '/' });

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${baseUrl(c)}/auth/callback`,
      grant_type: 'authorization_code',
    }),
  });
  const tok = (await tokenRes.json()) as any;
  if (!tokenRes.ok) return c.text('Google-Anmeldung fehlgeschlagen: ' + (tok.error_description || tok.error), 400);

  const info = (await (
    await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${tok.access_token}` } })
  ).json()) as any;
  if (!info.email || !info.email_verified) return c.text('E-Mail konnte nicht bestätigt werden.', 400);
  if (!isAllowed(c.env, info.email)) return c.text(`Kein Zugang für ${info.email}. Bitte beim Administrator freischalten lassen.`, 403);

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(info.email).first<{ id: string }>();
  const id = existing?.id || uid();
  const accessEnc = await encrypt(c.env.ENCRYPTION_KEY, tok.access_token);
  const refreshEnc = tok.refresh_token ? await encrypt(c.env.ENCRYPTION_KEY, tok.refresh_token) : null;
  if (existing) {
    await c.env.DB.prepare(
      `UPDATE users SET name = ?, picture = ?, access_token_enc = ?, access_expires_at = ?, scopes = ?,
       refresh_token_enc = COALESCE(?, refresh_token_enc) WHERE id = ?`,
    )
      .bind(info.name, info.picture, accessEnc, Date.now() + tok.expires_in * 1000, tok.scope, refreshEnc, id)
      .run();
  } else {
    await c.env.DB.prepare(
      'INSERT INTO users (id, email, name, picture, access_token_enc, access_expires_at, scopes, refresh_token_enc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(id, info.email, info.name, info.picture, accessEnc, Date.now() + tok.expires_in * 1000, tok.scope, refreshEnc)
      .run();
  }
  await setSettings(c.env.DB, { app_url: baseUrl(c) });
  await createSession(c, id);
  return c.redirect('/');
});

// Nur für lokale Entwicklung (DEV_AUTH=1 in .dev.vars)
authRoutes.get('/dev-login', async (c) => {
  if (c.env.DEV_AUTH !== '1') return c.notFound();
  const email = 'dev@devunox.local';
  let u = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
  if (!u) {
    u = { id: uid() };
    await c.env.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(u.id, email, 'Hüseyin Yigit (Dev)').run();
  }
  await createSession(c, u.id);
  return c.redirect('/');
});

authRoutes.get('/logout', async (c) => {
  const sid = getCookie(c, 'sid');
  if (sid) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
  deleteCookie(c, 'sid', { path: '/' });
  return c.redirect('/');
});

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const sid = getCookie(c, 'sid');
  if (!sid) return c.json({ error: 'unauthenticated' }, 401);
  const row = await c.env.DB.prepare(
    'SELECT u.id, u.email, u.name, u.picture, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?',
  )
    .bind(sid)
    .first<User & { expires_at: number }>();
  if (!row || row.expires_at < Date.now()) return c.json({ error: 'unauthenticated' }, 401);
  c.set('user', { id: row.id, email: row.email, name: row.name, picture: row.picture });
  await next();
});
