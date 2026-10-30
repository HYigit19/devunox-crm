import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { AppEnv, Env, User, encrypt, uid, setSettings, hashPassword, verifyPassword } from './util';

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

/** Angemeldeter Benutzer aus dem Session-Cookie (oder null). */
async function sessionUser(c: any): Promise<(User & { password_temp: number }) | null> {
  const sid = getCookie(c, 'sid');
  if (!sid) return null;
  const row = await c.env.DB.prepare(
    'SELECT u.id, u.email, u.name, u.picture, u.password_temp, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?',
  )
    .bind(sid)
    .first();
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, email: row.email, name: row.name, picture: row.picture, password_temp: row.password_temp || 0 };
}

// /auth/login            → Anmeldung mit Google (nur ALLOWED_EMAILS)
// /auth/login?connect=1  → angemeldeter Benutzer verbindet ein (beliebiges) Gmail-Konto als Absender
authRoutes.get('/login', async (c) => {
  const connect = c.req.query('connect') === '1';
  if (connect && !(await sessionUser(c))) return c.redirect('/');
  const state = uid();
  setCookie(c, 'oauth_state', state, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 600 });
  setCookie(c, 'oauth_mode', connect ? 'connect' : 'login', { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 600 });
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${baseUrl(c)}/auth/callback`,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: connect ? 'select_account consent' : 'consent',
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
  const mode = getCookie(c, 'oauth_mode');
  deleteCookie(c, 'oauth_mode', { path: '/' });

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

  const accessExp = Date.now() + tok.expires_in * 1000;
  // Gmail-Konto für einen bereits angemeldeten Benutzer verbinden (Absender für Kundenmails)
  if (mode === 'connect') {
    const me = await sessionUser(c);
    if (!me) return c.text('Sitzung abgelaufen. Bitte neu anmelden.', 401);
    await c.env.DB.prepare(
      `UPDATE users SET google_email = ?, access_token_enc = ?, access_expires_at = ?, scopes = ?,
       refresh_token_enc = COALESCE(?, refresh_token_enc) WHERE id = ?`,
    )
      .bind(
        info.email,
        await encrypt(c.env.ENCRYPTION_KEY, tok.access_token),
        accessExp,
        tok.scope,
        tok.refresh_token ? await encrypt(c.env.ENCRYPTION_KEY, tok.refresh_token) : null,
        me.id,
      )
      .run();
    await setSettings(c.env.DB, { app_url: baseUrl(c) });
    return c.redirect('/#/settings');
  }
  if (!isAllowed(c.env, info.email)) return c.text(`Kein Zugang für ${info.email}. Bitte beim Administrator freischalten lassen.`, 403);

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(info.email).first<{ id: string }>();
  const id = existing?.id || uid();
  const accessEnc = await encrypt(c.env.ENCRYPTION_KEY, tok.access_token);
  const refreshEnc = tok.refresh_token ? await encrypt(c.env.ENCRYPTION_KEY, tok.refresh_token) : null;
  if (existing) {
    await c.env.DB.prepare(
      `UPDATE users SET name = ?, picture = ?, google_email = ?, access_token_enc = ?, access_expires_at = ?, scopes = ?,
       refresh_token_enc = COALESCE(?, refresh_token_enc) WHERE id = ?`,
    )
      .bind(info.name, info.picture, info.email, accessEnc, accessExp, tok.scope, refreshEnc, id)
      .run();
  } else {
    await c.env.DB.prepare(
      'INSERT INTO users (id, email, name, picture, google_email, access_token_enc, access_expires_at, scopes, refresh_token_enc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(id, info.email, info.name, info.picture, info.email, accessEnc, accessExp, tok.scope, refreshEnc)
      .run();
  }
  await setSettings(c.env.DB, { app_url: baseUrl(c) });
  await createSession(c, id);
  return c.redirect('/');
});

// ---------- Anmeldung mit E-Mail + Passwort ----------
const MAX_FAILS = 8;
const LOCK_MS = 15 * 60_000;
const MIN_PW = 12;

authRoutes.post('/password-login', async (c) => {
  const { email, password } = await c.req.json<{ email?: string; password?: string }>().catch(() => ({}) as any);
  const fail = (msg = 'E-Mail oder Passwort falsch.') => c.json({ error: msg }, 401);
  if (!email || !password) return fail();
  const u = await c.env.DB.prepare(
    'SELECT id, password_hash, password_temp, password_expires_at, failed_logins, locked_until FROM users WHERE LOWER(email) = LOWER(?)',
  )
    .bind(email.trim())
    .first<any>();
  if (!u?.password_hash) {
    await verifyPassword(password, 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='); // gleiche Laufzeit
    return fail();
  }
  if (u.locked_until && u.locked_until > Date.now()) return fail('Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.');
  if (!(await verifyPassword(password, u.password_hash))) {
    const fails = (u.failed_logins || 0) + 1;
    await c.env.DB.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?')
      .bind(fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? Date.now() + LOCK_MS : null, u.id)
      .run();
    return fail();
  }
  if (u.password_temp && u.password_expires_at && u.password_expires_at < Date.now())
    return fail('Das Einmal-Passwort ist abgelaufen. Bitte ein neues anfordern.');
  await c.env.DB.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').bind(u.id).run();
  await createSession(c, u.id);
  return c.json({ ok: true, must_change_password: !!u.password_temp });
});

authRoutes.post('/password-change', async (c) => {
  const me = await sessionUser(c);
  if (!me) return c.json({ error: 'Nicht angemeldet' }, 401);
  const { current, next } = await c.req.json<{ current?: string; next?: string }>().catch(() => ({}) as any);
  const u = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(me.id).first<any>();
  if (u?.password_hash && !(await verifyPassword(current || '', u.password_hash)))
    return c.json({ error: 'Aktuelles Passwort ist falsch.' }, 400);
  if (!next || next.length < MIN_PW) return c.json({ error: `Das neue Passwort braucht mindestens ${MIN_PW} Zeichen.` }, 400);
  if (next === current) return c.json({ error: 'Bitte ein anderes Passwort als das bisherige wählen.' }, 400);
  const sid = getCookie(c, 'sid');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash = ?, password_temp = 0, password_expires_at = NULL, failed_logins = 0, locked_until = NULL WHERE id = ?')
      .bind(await hashPassword(next), me.id),
    // alle anderen Sitzungen beenden
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').bind(me.id, sid || ''),
  ]);
  return c.json({ ok: true });
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
  const u = await sessionUser(c);
  if (!u) return c.json({ error: 'unauthenticated' }, 401);
  // Mit Einmal-Passwort angemeldet: nur /api/me, bis ein eigenes Passwort gesetzt ist
  if (u.password_temp && !c.req.path.endsWith('/me'))
    return c.json({ error: 'Bitte zuerst ein eigenes Passwort festlegen.', password_change_required: true }, 403);
  c.set('user', { id: u.id, email: u.email, name: u.name, picture: u.picture });
  await next();
});
