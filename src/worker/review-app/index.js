// Übernommen aus devunox Review (Repo HYigit19/devunox-review) – läuft jetzt im CRM-Worker. Änderungen nur hier pflegen.
// devunox Review – Feedback-Hub für Kunden-Apps
// Worker: API unter /api/*, signierte Dateien unter /f/*, Oberfläche und widget.js als statische Dateien (public/)
import { ensureSchema } from "./schema.js";
import {
  HttpError, json, readJson, str, num, oneOf, isEmail, slugify, safeUrl, nowIso, hmac, sameString,
} from "./util.js";
import {
  login, createSession, currentSession, deleteSession, sessionCookie, clearCookie, throttle,
  hashPassword, checkPasswordRules, verifyCurrentPassword, createToken, useToken,
} from "./auth.js";
import { notifyAdmin } from "./mail.js";
import { crmPayload, sendToCrm, verifyCrmSignature } from "./crm.js";

const STATUSES = ["offen", "in_arbeit", "pruefen", "erledigt", "abgelehnt"];
const CATEGORIES = ["fehler", "design", "funktion", "text", "idee"];
const PRIORITIES = ["hoch", "mittel", "niedrig"];
const MAX_FILE = 25 * 1024 * 1024;
const INLINE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "application/pdf", "text/plain"];

const STATUS_DE = { offen: "Offen", in_arbeit: "In Arbeit", pruefen: "Bitte prüfen", erledigt: "Erledigt", abgelehnt: "Wird nicht umgesetzt" };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

/* ---------------------------------------------------------------- Router */

const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp(`^${pattern}$`), handler, opts });

export default {
  async fetch(request, env, execCtx) {
    const url = new URL(request.url);
    const isApi = url.pathname.startsWith("/api/");
    try {
      if (request.method === "OPTIONS" && isApi) return new Response(null, { status: 204, headers: CORS });
      if (!isApi && !url.pathname.startsWith("/f/")) return env.ASSETS.fetch(request);
      await ensureSchema(env);
      if (url.pathname.startsWith("/f/")) return await serveFile(request, env, url);

      const r = routes.find((x) => x.method === request.method && x.re.test(url.pathname));
      if (!r) throw new HttpError(404, "Nicht gefunden", "not_found");
      const params = url.pathname.match(r.re).slice(1).map(decodeURIComponent);
      const ctx = { request, env, url, params, exec: execCtx, sess: null, user: null };

      if (!r.opts.public) {
        const sess = await currentSession(request, env);
        if (!sess) throw new HttpError(401, "Bitte anmelden.", "auth");
        ctx.sess = sess;
        ctx.user = sess.user;
        if (sess.kind === "bearer" && !r.opts.bearer) throw new HttpError(403, "Nicht erlaubt.", "forbidden");
        if (sess.user.must_change && !r.opts.allowMustChange) throw new HttpError(403, "Bitte zuerst ein eigenes Passwort setzen.", "must_change");
        if (r.opts.admin && sess.user.role !== "admin") throw new HttpError(403, "Nur für devunox.", "forbidden");
      }
      // Cookie-Anfragen, die etwas ändern, nur von der eigenen Seite (Schutz vor fremden Formularen)
      if (request.method !== "GET" && (!ctx.sess || ctx.sess.kind === "cookie")) {
        const origin = request.headers.get("Origin");
        if (origin && origin !== url.origin && !r.opts.crossOrigin) throw new HttpError(403, "Nicht erlaubt.", "origin");
      }
      const res = await r.handler(ctx);
      for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
      return res;
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e && e.stack ? e.stack : e);
      const body = { error: status === 500 ? "Interner Fehler. Bitte erneut versuchen." : e.message, code: e.code || "error" };
      return json(body, status, isApi ? CORS : {});
    }
  },
};

/* ---------------------------------------------------------------- Hilfen */

const publicUser = (u) => u && {
  id: u.id, name: u.name, email: u.email, role: u.role, client_id: u.client_id, lang: u.lang, must_change: !!u.must_change,
  can_approve: u.role === "admin" || u.can_approve === undefined || u.can_approve === null ? true : !!u.can_approve,
};

async function fileSecret(env) {
  const row = await env.DB.prepare("SELECT v FROM meta WHERE k = 'file_secret'").first();
  return row.v;
}

async function signedFileUrl(env, secret, id) {
  // Gültig bis zum Ende der übernächsten vollen Stunde – stabile URLs, damit der Browser cachen kann
  const exp = Math.floor(Date.now() / 3600000) * 3600 + 7200;
  const sig = (await hmac(secret, `${id}.${exp}`)).slice(0, 27);
  return `/f/${id}?e=${exp}&s=${sig}`;
}

async function loadProject(ctx, ref) {
  const { env, user, sess } = ctx;
  const p = /^\d+$/.test(ref)
    ? await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(Number(ref)).first()
    : await env.DB.prepare("SELECT * FROM projects WHERE slug = ?").bind(ref).first();
  if (!p) throw new HttpError(404, "Projekt nicht gefunden.", "not_found");
  if (user.role === "client" && p.client_id !== user.client_id) throw new HttpError(404, "Projekt nicht gefunden.", "not_found");
  if (sess && sess.projectId && sess.projectId !== p.id) throw new HttpError(404, "Projekt nicht gefunden.", "not_found");
  return p;
}

async function loadItem(ctx, id) {
  const it = await ctx.env.DB.prepare("SELECT * FROM items WHERE id = ?").bind(Number(id)).first();
  if (!it) throw new HttpError(404, "Eintrag nicht gefunden.", "not_found");
  const p = await loadProject(ctx, String(it.project_id));
  if (ctx.user.role === "client" && it.internal) throw new HttpError(404, "Eintrag nicht gefunden.", "not_found");
  return { item: it, project: p };
}

const ITEM_SELECT = `
  SELECT i.*, u.name AS author_name, u.role AS author_role,
    (SELECT COUNT(*) FROM comments c WHERE c.item_id = i.id AND c.kind = 'comment') AS n_comments,
    (SELECT COUNT(*) FROM files f WHERE f.item_id = i.id AND f.is_screenshot = 0) AS n_files,
    CASE WHEN i.last_activity_by IS NOT NULL AND i.last_activity_by != ?1
              AND (s.seen_at IS NULL OR s.seen_at < i.last_activity_at) THEN 1 ELSE 0 END AS unread
  FROM items i
  LEFT JOIN users u ON u.id = i.author_id
  LEFT JOIN seen s ON s.item_id = i.id AND s.user_id = ?1`;

async function serializeItems(env, rows) {
  const secret = await fileSecret(env);
  const out = [];
  for (const r of rows) {
    const { ua, ...rest } = r;
    out.push({
      ...rest,
      internal: !!r.internal,
      unread: !!r.unread,
      screenshot_url: r.screenshot_id ? await signedFileUrl(env, secret, r.screenshot_id) : null,
    });
  }
  return out;
}

async function getItemFull(ctx, id) {
  const { env, user } = ctx;
  const row = await env.DB.prepare(`${ITEM_SELECT} WHERE i.id = ?2`).bind(user.id, Number(id)).first();
  const [item] = await serializeItems(env, [row]);
  const comments = (await env.DB.prepare(
    `SELECT c.*, u.name AS author_name, u.role AS author_role FROM comments c LEFT JOIN users u ON u.id = c.author_id
      WHERE c.item_id = ? ORDER BY c.created_at, c.id`
  ).bind(item.id).all()).results.map((c) => ({ ...c, meta: c.meta ? JSON.parse(c.meta) : null }));
  const secret = await fileSecret(env);
  const files = [];
  for (const f of (await env.DB.prepare("SELECT * FROM files WHERE item_id = ? ORDER BY id").bind(item.id).all()).results) {
    const { r2_key, ...rest } = f;
    files.push({ ...rest, is_screenshot: !!f.is_screenshot, url: await signedFileUrl(env, secret, f.id) });
  }
  return { ...item, comments, files };
}

async function touchItem(env, itemId, userId) {
  const t = nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE items SET last_activity_at = ?, last_activity_by = ?, updated_at = ? WHERE id = ?").bind(t, userId, t, itemId),
    env.DB.prepare("INSERT INTO seen (user_id, item_id, seen_at) VALUES (?, ?, ?) ON CONFLICT(user_id, item_id) DO UPDATE SET seen_at = excluded.seen_at").bind(userId, itemId, t),
  ]);
}

function hubLink(ctx, project, itemId) {
  return `${ctx.url.origin}/#/p/${project.slug}${itemId ? `/i/${itemId}` : ""}`;
}

function notifyIfClient(ctx, project, subject, lines) {
  if (ctx.user.role !== "client") return;
  ctx.exec.waitUntil(notifyAdmin(ctx.env, `[${project.name}] ${subject}`, lines.filter(Boolean).join("\n")));
}

function setCookieJson(data, token, days) {
  return json(data, 200, { "Set-Cookie": sessionCookie(token, days) });
}

/* ---------------------------------------------------------------- Anmeldung */

route("GET", "/api/session", async (ctx) => {
  const sess = await currentSession(ctx.request, ctx.env);
  return json({ user: sess ? publicUser(sess.user) : null });
}, { public: true });

route("POST", "/api/login", async (ctx) => {
  const { request, env } = ctx;
  const b = await readJson(request);
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  await throttle(env, `login:${ip}`, 20, 15);
  const u = await login(env, str(b.email, 200), String(b.password || ""));
  if (b.mode === "bearer") {
    // Anmeldung direkt im Widget der Kunden-App
    const p = await env.DB.prepare("SELECT * FROM projects WHERE slug = ?").bind(str(b.project, 60)).first();
    if (!p || (u.role === "client" && p.client_id !== u.client_id)) throw new HttpError(403, "Kein Zugang zu diesem Projekt.", "forbidden");
    if (u.must_change) throw new HttpError(403, "Bitte zuerst im Review-Portal ein eigenes Passwort setzen.", "must_change");
    const token = await createSession(env, u.id, "bearer", 30, p.id);
    return json({ token, user: publicUser(u) });
  }
  const days = b.remember ? 30 : 1;
  const token = await createSession(env, u.id, "cookie", days);
  return setCookieJson({ user: publicUser(u) }, token, b.remember ? days : 0);
}, { public: true, crossOrigin: true });

route("POST", "/api/logout", async (ctx) => {
  const sess = await currentSession(ctx.request, ctx.env);
  if (sess) await deleteSession(ctx.env, sess.tokenHash);
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
}, { public: true, crossOrigin: true });

route("POST", "/api/forgot", async (ctx) => {
  const { request, env, url } = ctx;
  const b = await readJson(request);
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  await throttle(env, `forgot:${ip}`, 5, 30);
  const u = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(str(b.email, 200)).first();
  // Reset-Mail nur für devunox-Konten (Email Routing stellt nur an bestätigte Adressen zu).
  // Kunden bekommen einen neuen Link von uns (Hub → Kunde → „Neuen Zugangslink erzeugen“).
  if (u && u.role === "admin" && u.active && env.EMAIL) {
    const token = await createToken(env, u.id, "reset", 30);
    ctx.exec.waitUntil(notifyAdmin(env, "Passwort zurücksetzen – devunox Review",
      `Hallo ${u.name},\n\nüber diesen Link setzt du ein neues Passwort (30 Minuten gültig):\n${url.origin}/#/link/${token}\n\nFalls du das nicht angefordert hast, ignoriere diese Mail.`));
  }
  return json({ ok: true });
}, { public: true });

route("GET", "/api/link/([A-Za-z0-9_-]+)", async (ctx) => {
  const row = await useToken(ctx.env, ctx.params[0], ["invite", "reset"], false);
  const u = await ctx.env.DB.prepare("SELECT name, email, lang FROM users WHERE id = ?").bind(row.user_id).first();
  return json({ purpose: row.purpose, name: u.name, email: u.email, lang: u.lang });
}, { public: true });

route("POST", "/api/link/accept", async (ctx) => {
  const { env, request } = ctx;
  const b = await readJson(request);
  checkPasswordRules(b.password);
  const row = await useToken(env, str(b.token, 100), ["invite", "reset"], true);
  await env.DB.prepare("UPDATE users SET password_hash = ?, must_change = 0, temp_expires_at = NULL, fails = 0, locked_until = NULL, last_login = ? WHERE id = ?")
    .bind(await hashPassword(b.password), nowIso(), row.user_id).run();
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.user_id).run();
  const u = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(row.user_id).first();
  const token = await createSession(env, u.id, "cookie", 30);
  return setCookieJson({ user: publicUser(u) }, token, 30);
}, { public: true });

route("POST", "/api/handoff/redeem", async (ctx) => {
  const { env, request } = ctx;
  const b = await readJson(request);
  const row = await useToken(env, str(b.token, 100), ["handoff"], true);
  const p = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(row.project_id).first();
  if (!p || p.slug !== str(b.project, 60)) throw new HttpError(400, "Der Link passt nicht zu dieser App.", "bad_token");
  const u = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(row.user_id).first();
  const token = await createSession(env, u.id, "bearer", 30, p.id);
  return json({ token, user: publicUser(u) });
}, { public: true, crossOrigin: true });

route("POST", "/api/password", async (ctx) => {
  const { env, request, user, sess } = ctx;
  const b = await readJson(request);
  if (!(await verifyCurrentPassword(env, user.id, b.current))) throw new HttpError(400, "Das aktuelle Passwort stimmt nicht.", "bad_password");
  checkPasswordRules(b.next);
  if (b.next === b.current) throw new HttpError(400, "Bitte ein neues Passwort wählen.", "same_password");
  await env.DB.prepare("UPDATE users SET password_hash = ?, must_change = 0, temp_expires_at = NULL WHERE id = ?").bind(await hashPassword(b.next), user.id).run();
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").bind(user.id, sess.tokenHash).run();
  return json({ ok: true });
}, { allowMustChange: true });

route("GET", "/api/me", async (ctx) => json({ user: publicUser(ctx.user) }), { bearer: true, allowMustChange: true });

route("PATCH", "/api/me", async (ctx) => {
  const b = await readJson(ctx.request);
  const lang = oneOf(b.lang, ["de", "en"], ctx.user.lang);
  const name = str(b.name, 80) || ctx.user.name;
  await ctx.env.DB.prepare("UPDATE users SET lang = ?, name = ? WHERE id = ?").bind(lang, name, ctx.user.id).run();
  return json({ user: publicUser({ ...ctx.user, lang, name }) });
}, { bearer: true });

/* ---------------------------------------------------------------- Kunden (nur devunox) */

route("GET", "/api/clients", async (ctx) => {
  const rows = (await ctx.env.DB.prepare(
    `SELECT c.*, u.id AS user_id, u.name AS contact_name, u.email AS contact_email, u.lang AS contact_lang,
            u.last_login, (u.password_hash IS NULL) AS invite_pending,
            (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id) AS n_projects
       FROM clients c LEFT JOIN users u ON u.client_id = c.id
      ORDER BY c.name COLLATE NOCASE`
  ).all()).results;
  return json({ clients: rows.map((r) => ({ ...r, active: !!r.active, invite_pending: !!r.invite_pending })) });
}, { admin: true });

route("POST", "/api/clients", async (ctx) => {
  const { env, request, url } = ctx;
  const b = await readJson(request);
  const name = str(b.name, 120);
  const contactName = str(b.contact_name, 80);
  const email = str(b.contact_email, 200).toLowerCase();
  if (!name) throw new HttpError(400, "Bitte den Firmennamen angeben.", "validation");
  if (!contactName) throw new HttpError(400, "Bitte den Namen der Ansprechperson angeben.", "validation");
  if (!isEmail(email)) throw new HttpError(400, "Bitte eine gültige E-Mail-Adresse angeben.", "validation");
  if (await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first()) {
    throw new HttpError(409, "Diese E-Mail-Adresse hat schon einen Zugang.", "exists");
  }
  const t = nowIso();
  const c = await env.DB.prepare("INSERT INTO clients (name, created_at) VALUES (?, ?) RETURNING id").bind(name, t).first();
  const u = await env.DB.prepare(
    "INSERT INTO users (email, name, role, client_id, lang, created_at) VALUES (?, ?, 'client', ?, ?, ?) RETURNING id"
  ).bind(email, contactName, c.id, oneOf(b.lang, ["de", "en"], "de"), t).first();
  const token = await createToken(env, u.id, "invite", 14 * 24 * 60);
  return json({ id: c.id, invite_url: `${url.origin}/#/link/${token}` }, 201);
}, { admin: true });

route("PATCH", "/api/clients/(\\d+)", async (ctx) => {
  const { env, request, params } = ctx;
  const b = await readJson(request);
  const c = await env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(Number(params[0])).first();
  if (!c) throw new HttpError(404, "Kunde nicht gefunden.", "not_found");
  const u = await env.DB.prepare("SELECT * FROM users WHERE client_id = ?").bind(c.id).first();
  const name = b.name !== undefined ? str(b.name, 120) || c.name : c.name;
  const active = b.active !== undefined ? (b.active ? 1 : 0) : c.active;
  const stmts = [env.DB.prepare("UPDATE clients SET name = ?, active = ? WHERE id = ?").bind(name, active, c.id)];
  if (u) {
    const email = b.contact_email !== undefined ? str(b.contact_email, 200).toLowerCase() : u.email;
    if (!isEmail(email)) throw new HttpError(400, "Bitte eine gültige E-Mail-Adresse angeben.", "validation");
    if (email !== u.email && (await env.DB.prepare("SELECT 1 FROM users WHERE email = ? AND id != ?").bind(email, u.id).first())) {
      throw new HttpError(409, "Diese E-Mail-Adresse hat schon einen Zugang.", "exists");
    }
    const contactName = b.contact_name !== undefined ? str(b.contact_name, 80) || u.name : u.name;
    const lang = oneOf(b.lang, ["de", "en"], u.lang);
    stmts.push(env.DB.prepare("UPDATE users SET email = ?, name = ?, lang = ? WHERE id = ?").bind(email, contactName, lang, u.id));
    if (!active) stmts.push(env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(u.id));
  }
  await env.DB.batch(stmts);
  return json({ ok: true });
}, { admin: true });

route("POST", "/api/clients/(\\d+)/link", async (ctx) => {
  const { env, params, url } = ctx;
  const u = await env.DB.prepare("SELECT * FROM users WHERE client_id = ?").bind(Number(params[0])).first();
  if (!u) throw new HttpError(404, "Kunde nicht gefunden.", "not_found");
  const purpose = u.password_hash ? "reset" : "invite";
  const token = await createToken(env, u.id, purpose, purpose === "invite" ? 14 * 24 * 60 : 3 * 24 * 60);
  return json({ url: `${url.origin}/#/link/${token}`, purpose });
}, { admin: true });

/* ---------------------------------------------------------------- Projekte */

route("GET", "/api/projects", async (ctx) => {
  const { env, user } = ctx;
  const isClient = user.role === "client";
  const rows = (await env.DB.prepare(
    `SELECT p.*, c.name AS client_name, c.active AS client_active,
       (SELECT COUNT(*) FROM items i WHERE i.project_id = p.id AND i.status = 'offen' ${isClient ? "AND i.internal = 0" : ""}) AS n_offen,
       (SELECT COUNT(*) FROM items i WHERE i.project_id = p.id AND i.status = 'in_arbeit' ${isClient ? "AND i.internal = 0" : ""}) AS n_in_arbeit,
       (SELECT COUNT(*) FROM items i WHERE i.project_id = p.id AND i.status = 'pruefen' ${isClient ? "AND i.internal = 0" : ""}) AS n_pruefen,
       (SELECT COUNT(*) FROM items i WHERE i.project_id = p.id AND i.status IN ('erledigt','abgelehnt') ${isClient ? "AND i.internal = 0" : ""}) AS n_fertig,
       (SELECT COUNT(*) FROM items i LEFT JOIN seen s ON s.item_id = i.id AND s.user_id = ?1
          WHERE i.project_id = p.id ${isClient ? "AND i.internal = 0" : ""} AND i.last_activity_by IS NOT NULL AND i.last_activity_by != ?1
            AND (s.seen_at IS NULL OR s.seen_at < i.last_activity_at)) AS n_unread,
       (SELECT MAX(i.last_activity_at) FROM items i WHERE i.project_id = p.id ${isClient ? "AND i.internal = 0" : ""}) AS last_activity_at
     FROM projects p JOIN clients c ON c.id = p.client_id
     ${isClient ? "WHERE p.client_id = ?2" : ""}
     ORDER BY COALESCE(last_activity_at, p.updated_at) DESC`
  ).bind(user.id, ...(isClient ? [user.client_id] : [])).all()).results;
  return json({ projects: rows.map((r) => ({ ...r, client_active: !!r.client_active })) });
});

route("POST", "/api/projects", async (ctx) => {
  const { env, request } = ctx;
  const b = await readJson(request);
  const client = await env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(Number(b.client_id)).first();
  if (!client) throw new HttpError(400, "Bitte einen Kunden wählen.", "validation");
  const name = str(b.name, 120);
  if (!name) throw new HttpError(400, "Bitte einen Projektnamen angeben.", "validation");
  let base = slugify(b.slug || name) || "projekt";
  let slug = base;
  for (let n = 2; await env.DB.prepare("SELECT 1 FROM projects WHERE slug = ?").bind(slug).first(); n++) slug = `${base}-${n}`;
  const t = nowIso();
  const p = await env.DB.prepare(
    `INSERT INTO projects (client_id, slug, name, description, app_url, repo_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
  ).bind(client.id, slug, name, str(b.description, 1000), safeUrl(b.app_url), safeUrl(b.repo_url), t, t).first();
  return json({ project: p }, 201);
}, { admin: true });

route("GET", "/api/projects/([a-z0-9-]+)", async (ctx) => {
  const p = await loadProject(ctx, ctx.params[0]);
  const c = await ctx.env.DB.prepare("SELECT name FROM clients WHERE id = ?").bind(p.client_id).first();
  return json({ project: { ...p, client_name: c ? c.name : "" } });
}, { bearer: true });

route("PATCH", "/api/projects/([a-z0-9-]+)", async (ctx) => {
  const { env, request } = ctx;
  const p = await loadProject(ctx, ctx.params[0]);
  const b = await readJson(request);
  const next = {
    name: b.name !== undefined ? str(b.name, 120) || p.name : p.name,
    description: b.description !== undefined ? str(b.description, 1000) : p.description,
    app_url: b.app_url !== undefined ? safeUrl(b.app_url) : p.app_url,
    repo_url: b.repo_url !== undefined ? safeUrl(b.repo_url) : p.repo_url,
    status: b.status !== undefined ? oneOf(b.status, ["aktiv", "abgeschlossen"], p.status) : p.status,
  };
  await env.DB.prepare("UPDATE projects SET name = ?, description = ?, app_url = ?, repo_url = ?, status = ?, updated_at = ? WHERE id = ?")
    .bind(next.name, next.description, next.app_url, next.repo_url, next.status, nowIso(), p.id).run();
  return json({ project: { ...p, ...next } });
}, { admin: true });

// Link „App mit Feedback öffnen“: kurzer Einmal-Token, den das Widget in eine eigene Sitzung tauscht
route("POST", "/api/projects/([a-z0-9-]+)/handoff", async (ctx) => {
  const { env, request, user } = ctx;
  const p = await loadProject(ctx, ctx.params[0]);
  const b = await readJson(request);
  if (!p.app_url) throw new HttpError(400, "Für dieses Projekt ist noch keine App-Adresse hinterlegt.", "no_app_url");
  let target = new URL(p.app_url);
  if (b.item_id) {
    const it = await env.DB.prepare("SELECT * FROM items WHERE id = ? AND project_id = ?").bind(Number(b.item_id), p.id).first();
    if (it && (!it.internal || user.role === "admin")) {
      if (it.page_url) {
        try {
          const pu = new URL(it.page_url);
          if (pu.origin === target.origin) target = pu;
        } catch {}
      }
      target.searchParams.set("dvx_item", String(it.id));
    }
  }
  const token = await createToken(env, user.id, "handoff", 10, p.id);
  target.searchParams.set("dvx_handoff", token);
  return json({ url: target.toString() });
});

/* ---------------------------------------------------------------- devunox CRM */

// Das CRM meldet Statusänderungen zurück (signiert, ohne Sitzung). Löst keinen Webhook zurück aus.
route("POST", "/api/integrations/crm/status", async (ctx) => {
  const { env, request } = ctx;
  const raw = await request.text();
  if (!(await verifyCrmSignature(env, request, raw))) throw new HttpError(401, "Ungültige Signatur.", "auth");
  let b;
  try { b = JSON.parse(raw); } catch { throw new HttpError(400, "Ungültige Nachricht.", "validation"); }
  const item = await env.DB.prepare("SELECT * FROM items WHERE id = ?").bind(Number(b.item_id)).first();
  if (!item) throw new HttpError(404, "Eintrag nicht gefunden.", "not_found");
  const to = oneOf(b.status, ["offen", "in_arbeit", "pruefen", "erledigt", "abgelehnt"], null);
  if (!to) throw new HttpError(400, "Unbekannter Status.", "validation");
  if (to === item.status) return json({ ok: true, unchanged: true });
  const admin = await env.DB.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1").first();
  const t = nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE items SET status = ?, updated_at = ?, last_activity_at = ?, last_activity_by = ? WHERE id = ?").bind(to, t, t, admin ? admin.id : null, item.id),
    env.DB.prepare("INSERT INTO comments (item_id, author_id, kind, body, meta, created_at) VALUES (?, ?, 'status', ?, ?, ?)")
      .bind(item.id, admin ? admin.id : null, str(b.note, 8000), JSON.stringify({ from: item.status, to, via: "crm" }), t),
  ]);
  return json({ ok: true, status: to });
}, { public: true, crossOrigin: true });

// Das CRM legt Kunde (über die Kundennummer), Kundenzugang und Projekt in einem Schritt an.
// Bestehender Kunde mit gleicher Kundennummer wird wiederverwendet; der Einladungslink kommt nur für neue Zugänge zurück.
route("POST", "/api/integrations/crm/project", async (ctx) => {
  const { env, request, url } = ctx;
  const raw = await request.text();
  if (!(await verifyCrmSignature(env, request, raw))) throw new HttpError(401, "Ungültige Signatur.", "auth");
  let b;
  try { b = JSON.parse(raw); } catch { throw new HttpError(400, "Ungültige Nachricht.", "validation"); }
  const customerNo = str(b.customer_no, 40);
  const companyName = str(b.company_name, 120);
  const projectName = str(b.project_name, 120);
  if (!companyName || !projectName) throw new HttpError(400, "Kunde und Projektname fehlen.", "validation");
  const t = nowIso();
  let client = customerNo ? await env.DB.prepare("SELECT * FROM clients WHERE customer_no = ?").bind(customerNo).first() : null;
  if (!client) client = await env.DB.prepare("SELECT * FROM clients WHERE name = ? AND customer_no IS NULL").bind(companyName).first();
  if (!client) {
    client = await env.DB.prepare("INSERT INTO clients (name, customer_no, created_at) VALUES (?, ?, ?) RETURNING *").bind(companyName, customerNo || null, t).first();
  } else if (customerNo && !client.customer_no) {
    await env.DB.prepare("UPDATE clients SET customer_no = ? WHERE id = ?").bind(customerNo, client.id).run();
  }
  // Kundenzugang (genau eine Person je Kunde)
  let invite_url = null;
  let user = await env.DB.prepare("SELECT * FROM users WHERE client_id = ?").bind(client.id).first();
  const email = str(b.contact_email, 200).toLowerCase();
  if (!user && isEmail(email)) {
    const taken = await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first();
    if (!taken) {
      user = await env.DB.prepare("INSERT INTO users (email, name, role, client_id, lang, created_at) VALUES (?, ?, 'client', ?, ?, ?) RETURNING *")
        .bind(email, str(b.contact_name, 80) || companyName, client.id, oneOf(b.lang, ["de", "en"], "de"), t).first();
      invite_url = `${url.origin}/#/link/${await createToken(env, user.id, "invite", 14 * 24 * 60)}`;
    }
  }
  let base = slugify(b.slug || projectName) || "projekt";
  let project = b.slug ? await env.DB.prepare("SELECT * FROM projects WHERE slug = ? AND client_id = ?").bind(base, client.id).first() : null;
  if (!project) {
    let slug = base;
    for (let n = 2; await env.DB.prepare("SELECT 1 FROM projects WHERE slug = ?").bind(slug).first(); n++) slug = `${base}-${n}`;
    project = await env.DB.prepare(
      `INSERT INTO projects (client_id, slug, name, description, app_url, repo_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    ).bind(client.id, slug, projectName, str(b.description, 1000), safeUrl(b.app_url), safeUrl(b.repo_url), t, t).first();
  }
  return json({
    project: { id: project.id, slug: project.slug, name: project.name },
    client: { id: client.id, name: client.name, customer_no: customerNo || client.customer_no || null },
    hub_url: `${url.origin}/#/p/${project.slug}`,
    invite_url,
    contact_has_access: !!user && !invite_url,
  }, 201);
}, { public: true, crossOrigin: true });

/* ---------------------------------------------------------------- Einträge */

route("GET", "/api/projects/([a-z0-9-]+)/items", async (ctx) => {
  const { env, user } = ctx;
  const p = await loadProject(ctx, ctx.params[0]);
  const rows = (await env.DB.prepare(
    `${ITEM_SELECT} WHERE i.project_id = ?2 ${user.role === "client" ? "AND i.internal = 0" : ""} ORDER BY i.sort, i.no DESC`
  ).bind(user.id, p.id).all()).results;
  return json({ items: await serializeItems(env, rows) });
}, { bearer: true });

route("POST", "/api/projects/([a-z0-9-]+)/items", async (ctx) => {
  const { env, request, user } = ctx;
  const p = await loadProject(ctx, ctx.params[0]);
  const b = await readJson(request);
  const isAdmin = user.role === "admin";
  const kind = isAdmin ? oneOf(b.kind, ["feedback", "todo"], "feedback") : "feedback";
  const body = str(b.body, 8000);
  let title = str(b.title, 140);
  if (!title) title = body.split("\n")[0].slice(0, 90);
  if (!title) throw new HttpError(400, "Bitte einen Kommentar schreiben.", "validation");
  const t = nowIso();
  // Laufende Nummer pro Projekt
  const no = (await env.DB.prepare("UPDATE projects SET next_no = next_no + 1, updated_at = ? WHERE id = ? RETURNING next_no - 1 AS no").bind(t, p.id).first()).no;
  const it = await env.DB.prepare(
    `INSERT INTO items (project_id, no, kind, internal, title, body, category, priority, status, author_id, due_date,
       page_url, page_key, page_title, selector, anchor_text, rx, ry, px, py, sx, sy, vw, vh, device, ua, sort,
       created_at, updated_at, last_activity_at, last_activity_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'offen', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).bind(
    p.id, no, kind, isAdmin && b.internal ? 1 : 0, title, body,
    oneOf(b.category, CATEGORIES, kind === "todo" ? "funktion" : "funktion"),
    oneOf(b.priority, PRIORITIES, "mittel"),
    user.id, /^\d{4}-\d{2}-\d{2}$/.test(b.due_date || "") ? b.due_date : null,
    safeUrl(b.page_url), str(b.page_key, 500), str(b.page_title, 200), str(b.selector, 1000), str(b.anchor_text, 120),
    num(b.rx), num(b.ry), num(b.px), num(b.py), num(b.sx), num(b.sy),
    num(b.vw) && Math.round(num(b.vw)), num(b.vh) && Math.round(num(b.vh)),
    oneOf(b.device, ["mobile", "tablet", "desktop"], kind === "todo" ? "" : "desktop"),
    str(request.headers.get("User-Agent"), 300),
    -Date.now() / 1000, t, t, t, user.id
  ).first();
  await env.DB.prepare("INSERT INTO seen (user_id, item_id, seen_at) VALUES (?, ?, ?)").bind(user.id, it.id, t).run();
  notifyIfClient(ctx, p, `Neues Feedback #${no}: ${title}`, [
    `${user.name} hat neues Feedback gegeben.`, "",
    `#${no} ${title}`, body && body !== title ? `\n${body}` : "", "",
    b.page_url ? `Seite: ${safeUrl(b.page_url)}` : "", `Im Review-Portal: ${hubLink(ctx, p, it.id)}`,
  ]);
  const full = await getItemFull(ctx, it.id);
  if (kind === "feedback") sendToCrm(ctx, crmPayload(ctx, "item.created", p, full));
  return json({ item: full }, 201);
}, { bearer: true });

route("GET", "/api/items/(\\d+)", async (ctx) => {
  const { item } = await loadItem(ctx, ctx.params[0]);
  await ctx.env.DB.prepare("INSERT INTO seen (user_id, item_id, seen_at) VALUES (?, ?, ?) ON CONFLICT(user_id, item_id) DO UPDATE SET seen_at = excluded.seen_at")
    .bind(ctx.user.id, item.id, nowIso()).run();
  return json({ item: await getItemFull(ctx, item.id) });
}, { bearer: true });

route("PATCH", "/api/items/(\\d+)", async (ctx) => {
  const { env, request, user } = ctx;
  const { item, project } = await loadItem(ctx, ctx.params[0]);
  const b = await readJson(request);
  const isAdmin = user.role === "admin";
  const isAuthor = item.author_id === user.id;
  const next = { ...item };

  // Inhalt: devunox immer, Kunde nur bei eigenen, noch offenen Punkten
  if (isAdmin || (isAuthor && item.status === "offen")) {
    if (b.title !== undefined) next.title = str(b.title, 140) || item.title;
    if (b.body !== undefined) next.body = str(b.body, 8000);
    if (b.category !== undefined) next.category = oneOf(b.category, CATEGORIES, item.category);
    if (b.priority !== undefined) next.priority = oneOf(b.priority, PRIORITIES, item.priority);
  }
  if (isAdmin) {
    if (b.internal !== undefined) next.internal = b.internal ? 1 : 0;
    if (b.due_date !== undefined) next.due_date = /^\d{4}-\d{2}-\d{2}$/.test(b.due_date || "") ? b.due_date : null;
    if (b.sort !== undefined && num(b.sort) !== null) next.sort = num(b.sort);
  }
  let statusChange = null;
  if (b.status !== undefined && b.status !== item.status) {
    const to = oneOf(b.status, STATUSES, null);
    if (!to) throw new HttpError(400, "Unbekannter Status.", "validation");
    const clientAllowed =
      (item.status === "pruefen" && (to === "erledigt" || to === "offen")) ||
      (["erledigt", "abgelehnt"].includes(item.status) && to === "offen");
    if (!isAdmin && !clientAllowed) throw new HttpError(403, "Diesen Status kann nur devunox setzen.", "forbidden");
    next.status = to;
    statusChange = { from: item.status, to };
  }
  const t = nowIso();
  const stmts = [
    env.DB.prepare(
      "UPDATE items SET title = ?, body = ?, category = ?, priority = ?, internal = ?, due_date = ?, sort = ?, status = ?, updated_at = ? WHERE id = ?"
    ).bind(next.title, next.body, next.category, next.priority, next.internal, next.due_date, next.sort, next.status, t, item.id),
  ];
  const note = str(b.note, 8000);
  if (statusChange) {
    stmts.push(env.DB.prepare("INSERT INTO comments (item_id, author_id, kind, body, meta, created_at) VALUES (?, ?, 'status', ?, ?, ?)")
      .bind(item.id, user.id, note, JSON.stringify(statusChange), t));
  }
  await env.DB.batch(stmts);
  if (statusChange) {
    await touchItem(env, item.id, user.id);
    sendToCrm(ctx, crmPayload(ctx, "item.status", project, { ...item, ...next }, { status: { ...statusChange, note } }));
    notifyIfClient(ctx, project, `#${item.no} ${STATUS_DE[statusChange.to]}: ${item.title}`, [
      `${user.name} hat #${item.no} auf „${STATUS_DE[statusChange.to]}“ gesetzt.`, note ? `\n${note}` : "", "",
      `Im Review-Portal: ${hubLink(ctx, project, item.id)}`,
    ]);
  }
  return json({ item: await getItemFull(ctx, item.id) });
}, { bearer: true });

// Änderungswunsch (Mehraufwand) freigeben oder ablehnen – devunox schlägt Aufwand/Preis im CRM vor
route("POST", "/api/items/(\\d+)/decision", async (ctx) => {
  const { env, request, user } = ctx;
  const { item, project } = await loadItem(ctx, ctx.params[0]);
  if (item.cr_status !== "proposed") throw new HttpError(400, "Hier ist keine Freigabe offen.", "validation");
  if (user.role !== "admin" && user.can_approve === 0) throw new HttpError(403, "Freigaben macht bei Ihnen eine andere Person.", "forbidden");
  const b = await readJson(request);
  const decision = oneOf(b.decision, ["approved", "declined"], null);
  if (!decision) throw new HttpError(400, "Bitte freigeben oder ablehnen.", "validation");
  const note = str(b.note, 4000);
  const t = nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE items SET cr_status = ?, cr_decided_at = ?, cr_decided_by = ?, updated_at = ? WHERE id = ?").bind(decision, t, user.id, t, item.id),
    env.DB.prepare("INSERT INTO comments (item_id, author_id, kind, body, meta, created_at) VALUES (?, ?, 'status', ?, ?, ?)")
      .bind(item.id, user.id, note, JSON.stringify({ from: item.status, to: item.status, cr: decision }), t),
  ]);
  await touchItem(env, item.id, user.id);
  const full = await getItemFull(ctx, item.id);
  sendToCrm(ctx, crmPayload(ctx, "item.cr", project, full, { cr: { decision, days: item.cr_days, amount: item.cr_amount, currency: item.cr_currency, note } }));
  notifyIfClient(ctx, project, `#${item.no} Mehraufwand ${decision === "approved" ? "freigegeben" : "abgelehnt"}: ${item.title}`, [
    `${user.name} hat den Mehraufwand ${decision === "approved" ? "freigegeben" : "abgelehnt"}.`, note ? `\n${note}` : "",
  ]);
  return json({ item: full });
}, { bearer: true });

route("DELETE", "/api/items/(\\d+)", async (ctx) => {
  const { env, user } = ctx;
  const { item } = await loadItem(ctx, ctx.params[0]);
  if (user.role !== "admin") {
    const replies = await env.DB.prepare("SELECT COUNT(*) AS n FROM comments WHERE item_id = ? AND author_id != ?").bind(item.id, user.id).first();
    if (item.author_id !== user.id || item.status !== "offen" || replies.n > 0) {
      throw new HttpError(403, "Löschen geht nur bei eigenen Punkten, solange noch niemand geantwortet hat.", "forbidden");
    }
  }
  const files = (await env.DB.prepare("SELECT r2_key FROM files WHERE item_id = ?").bind(item.id).all()).results;
  if (files.length) await env.FILES.delete(files.map((f) => f.r2_key));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM files WHERE item_id = ?").bind(item.id),
    env.DB.prepare("DELETE FROM comments WHERE item_id = ?").bind(item.id),
    env.DB.prepare("DELETE FROM seen WHERE item_id = ?").bind(item.id),
    env.DB.prepare("DELETE FROM items WHERE id = ?").bind(item.id),
  ]);
  return json({ ok: true });
}, { bearer: true });

route("POST", "/api/items/(\\d+)/comments", async (ctx) => {
  const { env, request, user } = ctx;
  const { item, project } = await loadItem(ctx, ctx.params[0]);
  const b = await readJson(request);
  const body = str(b.body, 8000);
  if (!body && !b.allow_empty) throw new HttpError(400, "Bitte eine Antwort schreiben.", "validation");
  const c = await env.DB.prepare("INSERT INTO comments (item_id, author_id, kind, body, created_at) VALUES (?, ?, 'comment', ?, ?) RETURNING id")
    .bind(item.id, user.id, body, nowIso()).first();
  await touchItem(env, item.id, user.id);
  if (user.role === "client") sendToCrm(ctx, crmPayload(ctx, "item.comment", project, item, { comment: body }));
  notifyIfClient(ctx, project, `Antwort zu #${item.no}: ${item.title}`, [
    `${user.name} hat geantwortet:`, "", body || "(nur Anhang)", "", `Im Review-Portal: ${hubLink(ctx, project, item.id)}`,
  ]);
  return json({ comment_id: c.id, item: await getItemFull(ctx, item.id) }, 201);
}, { bearer: true });

route("POST", "/api/items/(\\d+)/files", async (ctx) => {
  const { env, request, user } = ctx;
  const { item } = await loadItem(ctx, ctx.params[0]);
  let form;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "Upload nicht lesbar.", "bad_upload");
  }
  const files = form.getAll("file").filter((f) => f && typeof f === "object" && "arrayBuffer" in f);
  if (!files.length) throw new HttpError(400, "Keine Datei erhalten.", "bad_upload");
  if (files.length > 10) throw new HttpError(400, "Höchstens 10 Dateien auf einmal.", "bad_upload");
  const isShot = form.get("screenshot") === "1";
  if (isShot && (files.length !== 1 || item.screenshot_id || (item.author_id !== user.id && user.role !== "admin"))) {
    throw new HttpError(400, "Screenshot nicht möglich.", "bad_upload");
  }
  let commentId = form.get("comment_id") ? Number(form.get("comment_id")) : null;
  if (commentId) {
    const c = await env.DB.prepare("SELECT 1 FROM comments WHERE id = ? AND item_id = ? AND author_id = ?").bind(commentId, item.id, user.id).first();
    if (!c) commentId = null;
  }
  for (const f of files) {
    if (f.size > MAX_FILE) throw new HttpError(413, `„${f.name}“ ist größer als 25 MB.`, "too_large");
  }
  const t = nowIso();
  for (const f of files) {
    const key = `p${item.project_id}/i${item.id}/${crypto.randomUUID()}`;
    const mime = str(f.type, 120) || "application/octet-stream";
    const name = str(f.name, 200).replace(/[\\/]/g, "_") || (isShot ? "screenshot.jpg" : "datei");
    await env.FILES.put(key, f.stream(), { httpMetadata: { contentType: mime } });
    const row = await env.DB.prepare(
      "INSERT INTO files (project_id, item_id, comment_id, r2_key, name, mime, size, is_screenshot, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id"
    ).bind(item.project_id, item.id, commentId, key, name, mime, f.size, isShot ? 1 : 0, user.id, t).first();
    if (isShot) await env.DB.prepare("UPDATE items SET screenshot_id = ? WHERE id = ?").bind(row.id, item.id).run();
  }
  if (!isShot) await touchItem(env, item.id, user.id);
  return json({ item: await getItemFull(ctx, item.id) }, 201);
}, { bearer: true });

route("DELETE", "/api/files/(\\d+)", async (ctx) => {
  const { env, user } = ctx;
  const f = await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(Number(ctx.params[0])).first();
  if (!f) throw new HttpError(404, "Datei nicht gefunden.", "not_found");
  await loadItem(ctx, String(f.item_id));
  if (user.role !== "admin" && f.author_id !== user.id) throw new HttpError(403, "Nur eigene Dateien können gelöscht werden.", "forbidden");
  await env.FILES.delete(f.r2_key);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM files WHERE id = ?").bind(f.id),
    env.DB.prepare("UPDATE items SET screenshot_id = NULL WHERE screenshot_id = ?").bind(f.id),
  ]);
  return json({ ok: true });
}, { bearer: true });

/* ---------------------------------------------------------------- Dateien ausliefern */

async function serveFile(request, env, url) {
  const m = url.pathname.match(/^\/f\/(\d+)$/);
  const exp = Number(url.searchParams.get("e"));
  const sig = url.searchParams.get("s") || "";
  if (!m || !exp || exp * 1000 < Date.now()) return new Response("Link abgelaufen", { status: 403 });
  const want = (await hmac(await fileSecret(env), `${m[1]}.${exp}`)).slice(0, 27);
  if (!sameString(want, sig)) return new Response("Nicht erlaubt", { status: 403 });
  const f = await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(Number(m[1])).first();
  if (!f) return new Response("Nicht gefunden", { status: 404 });
  const obj = await env.FILES.get(f.r2_key);
  if (!obj) return new Response("Nicht gefunden", { status: 404 });
  const inline = INLINE_TYPES.includes(f.mime) && url.searchParams.get("dl") !== "1";
  return new Response(obj.body, {
    headers: {
      "Content-Type": inline ? f.mime : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "Content-Length": String(f.size),
      "Cache-Control": "private, max-age=3600",
      // PDFs öffnet der Browser-Viewer nicht in einer Sandbox – für alles andere strikte Sandbox
      ...(f.mime === "application/pdf" && inline ? {} : { "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'" }),
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
