// Anmeldung und Sitzungen
// - Passwörter: PBKDF2-SHA256, 100 000 Runden (Maximum in Workers), 16 Byte Salz
// - Hub: Sitzung im HttpOnly-Cookie (SameSite=Lax) + Origin-Prüfung bei Änderungen
// - Widget in der Kunden-App: Bearer-Token (läuft auf fremder Domain, Cookies wären dort Drittanbieter-Cookies)
// - In D1 liegt immer nur der SHA-256 eines Tokens
import { HttpError, b64url, fromB64url, nowIso, randomToken, sha256 } from "./util.js";

export const COOKIE = "dvx_s";
const ITER = 100000;
const MAX_FAILS = 5;
const LOCK_MIN = 15;
export const MIN_PASSWORD = 10;

const enc = new TextEncoder();

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${ITER}$${b64url(salt)}$${b64url(await pbkdf2(password, salt, ITER))}`;
}

async function verifyPassword(password, stored) {
  const [alg, iter, salt, hash] = String(stored || "").split("$");
  if (alg !== "pbkdf2-sha256" || !salt || !hash) {
    await pbkdf2(password, new Uint8Array(16), ITER); // gleiche Laufzeit
    return false;
  }
  const calc = await pbkdf2(password, fromB64url(salt), Number(iter));
  const want = fromB64url(hash);
  if (calc.length !== want.length) return false;
  let d = 0;
  for (let i = 0; i < calc.length; i++) d |= calc[i] ^ want[i];
  return d === 0;
}

export function checkPasswordRules(pw) {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD) {
    throw new HttpError(400, `Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.`, "weak_password");
  }
  if (pw.length > 200) throw new HttpError(400, "Das Passwort ist zu lang.", "weak_password");
}

function readCookie(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export function sessionCookie(token, days) {
  const maxAge = days ? `; Max-Age=${days * 86400}` : "";
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax${maxAge}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export async function createSession(env, userId, kind, days, projectId = null) {
  const token = randomToken(32);
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, kind, project_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(await sha256(token), userId, kind, projectId, nowIso(days * 86400000), nowIso())
    .run();
  return token;
}

// Liefert { user, kind, projectId, tokenHash } oder null
export async function currentSession(request, env) {
  const auth = request.headers.get("Authorization") || "";
  let token = null;
  let kind = null;
  if (auth.startsWith("Bearer ")) {
    token = auth.slice(7).trim();
    kind = "bearer";
  } else {
    token = readCookie(request, COOKIE);
    kind = "cookie";
  }
  if (!token || token.length > 100) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT s.kind AS s_kind, s.project_id AS s_project, s.expires_at AS s_exp, u.*
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`
  )
    .bind(tokenHash)
    .first();
  if (!row || row.s_kind !== kind || row.s_exp < nowIso() || !row.active) return null;
  if (row.role === "client") {
    const c = await env.DB.prepare("SELECT active FROM clients WHERE id = ?").bind(row.client_id).first();
    if (!c || !c.active) return null;
  }
  const { s_kind, s_project, s_exp, password_hash, ...user } = row;
  return { user, kind, projectId: s_project, tokenHash };
}

export async function deleteSession(env, tokenHash) {
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
}

// Bremse je Schlüssel (z. B. IP): max n Versuche pro Fenster
export async function throttle(env, key, max, windowMin) {
  const now = nowIso();
  const row = await env.DB.prepare("SELECT n, reset_at FROM throttle WHERE k = ?").bind(key).first();
  if (!row || row.reset_at < now) {
    await env.DB.prepare("INSERT INTO throttle (k, n, reset_at) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = 1, reset_at = excluded.reset_at")
      .bind(key, nowIso(windowMin * 60000))
      .run();
    return;
  }
  if (row.n >= max) throw new HttpError(429, "Zu viele Versuche. Bitte in ein paar Minuten erneut versuchen.", "throttled");
  await env.DB.prepare("UPDATE throttle SET n = n + 1 WHERE k = ?").bind(key).run();
}

export async function login(env, email, password) {
  const generic = new HttpError(401, "E-Mail oder Passwort stimmt nicht.", "bad_login");
  const u = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(String(email || "").trim()).first();
  if (!u) {
    await verifyPassword(password || "", null);
    throw generic;
  }
  if (u.locked_until && u.locked_until > nowIso()) {
    throw new HttpError(423, `Zu viele Fehlversuche. Das Konto ist bis ${new Date(u.locked_until).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })} Uhr gesperrt.`, "locked");
  }
  const ok = u.password_hash && (await verifyPassword(String(password || ""), u.password_hash));
  if (!ok) {
    const fails = u.fails + 1;
    const lock = fails >= MAX_FAILS ? nowIso(LOCK_MIN * 60000) : null;
    await env.DB.prepare("UPDATE users SET fails = ?, locked_until = ? WHERE id = ?").bind(lock ? 0 : fails, lock, u.id).run();
    throw generic;
  }
  if (!u.active) throw new HttpError(403, "Dieser Zugang ist deaktiviert.", "inactive");
  if (u.role === "client") {
    const c = await env.DB.prepare("SELECT active FROM clients WHERE id = ?").bind(u.client_id).first();
    if (!c || !c.active) throw new HttpError(403, "Dieser Zugang ist deaktiviert.", "inactive");
  }
  if (u.must_change && u.temp_expires_at && u.temp_expires_at < nowIso()) {
    throw new HttpError(401, "Das Einmalpasswort ist abgelaufen.", "temp_expired");
  }
  await env.DB.prepare("UPDATE users SET fails = 0, locked_until = NULL, last_login = ? WHERE id = ?").bind(nowIso(), u.id).run();
  return u;
}

export async function verifyCurrentPassword(env, userId, password) {
  const u = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(userId).first();
  return !!(u && u.password_hash && (await verifyPassword(String(password || ""), u.password_hash)));
}

// Einmal-Token (Einladung, Reset, Übergabe an die App)
export async function createToken(env, userId, purpose, minutes, projectId = null) {
  const token = randomToken(24);
  if (purpose !== "handoff") {
    await env.DB.prepare("DELETE FROM tokens WHERE user_id = ? AND purpose IN ('invite','reset') AND used_at IS NULL").bind(userId).run();
  }
  await env.DB.prepare(
    "INSERT INTO tokens (token_hash, user_id, purpose, project_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(await sha256(token), userId, purpose, projectId, nowIso(minutes * 60000), nowIso())
    .run();
  return token;
}

export async function useToken(env, token, purposes, consume = true) {
  if (!token || typeof token !== "string" || token.length > 100) throw new HttpError(400, "Der Link ist ungültig.", "bad_token");
  const h = await sha256(token);
  const row = await env.DB.prepare("SELECT * FROM tokens WHERE token_hash = ?").bind(h).first();
  if (!row || !purposes.includes(row.purpose) || row.used_at) throw new HttpError(400, "Der Link ist ungültig oder wurde schon benutzt.", "bad_token");
  if (row.expires_at < nowIso()) throw new HttpError(400, "Der Link ist abgelaufen.", "token_expired");
  if (consume) await env.DB.prepare("UPDATE tokens SET used_at = ? WHERE token_hash = ?").bind(nowIso(), h).run();
  return row;
}
