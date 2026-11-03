// Kundenportal (ehemals devunox Review) im selben Worker wie das CRM.
// - Eigene Datenbank (RDB = devunox-review-db) und eigener Dateispeicher (RFILES) – alle bisherigen Daten bleiben unverändert.
// - Welche Oberfläche ausgeliefert wird, entscheidet der Hostname: CRM-Adresse → CRM, jede andere Adresse → Kundenportal.
//   So können Kunden später eigene Domains bekommen (einfach als weitere Custom Domain an diesen Worker hängen).
import reviewApp from './review-app/index.js';
import { Env, hmac, signKey } from './util';

export function portalEnabled(env: Env) {
  return !!env.RDB;
}

/** CRM-Hosts: crm.devunox.ai (CRM_HOSTS), *.workers.dev, localhost. Alles andere ist Kundenportal. */
export function isPortalHost(env: Env, req: Request) {
  if (!portalEnabled(env)) return false;
  // lokal schreibt wrangler dev die URL auf die Route um – dann zählt der Host-Header
  const host = env.DEV_AUTH === '1' ? (req.headers.get('x-dev-host') || req.headers.get('host') || '').split(':')[0] : new URL(req.url).hostname;
  const h = host.toLowerCase();
  const crm = (env.CRM_HOSTS || 'crm.devunox.ai').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (crm.includes(h) || h.endsWith('.workers.dev') || h === 'localhost') return false;
  if (h === '127.0.0.1') return env.DEV_AUTH === '1'; // lokal: 127.0.0.1 = Portal, localhost = CRM
  return true;
}

/** Gemeinsames internes Geheimnis für die signierte Übergabe CRM ⇄ Portal (ohne Konfiguration) */
export async function internalSecret(env: Env) {
  return env.REVIEW_WEBHOOK_SECRET || (await hmac(signKey(env), 'devunox-review-intern'));
}

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

/** Statische Dateien des Portals liegen im CRM-Build unter /review/ (Schriften teilen sich beide unter /fonts/). */
function portalAssets(env: Env) {
  return {
    async fetch(req: Request) {
      const u = new URL(req.url);
      let p = u.pathname;
      if (p === '/' || p === '') p = '/index.html';
      const target = p.startsWith('/fonts/') ? p : `/review${p}`;
      let res = await env.ASSETS.fetch(new Request(new URL(target, u.origin).toString(), { method: req.method, headers: req.headers }));
      const isHtml = (res.headers.get('content-type') || '').includes('text/html');
      // Unbekannte Pfade → Portal-Startseite (das Portal nutzt Hash-Routen)
      if (res.status === 404 || (isHtml && p !== '/index.html')) {
        res = await env.ASSETS.fetch(new Request(new URL('/review/index.html', u.origin).toString(), { method: 'GET' }));
        p = '/index.html';
      }
      const out = new Response(res.body, res);
      if (p === '/index.html') for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
      if (p === '/widget.js' || p.startsWith('/vendor/')) {
        out.headers.set('Access-Control-Allow-Origin', '*');
        out.headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
        out.headers.set('Cache-Control', p === '/widget.js' ? 'public, max-age=300' : 'public, max-age=86400');
      }
      return out;
    },
  };
}

type Dispatch = (env: Env, payload: any) => Promise<unknown>;
let dispatcher: Dispatch | null = null;
/** Wird von review.ts gesetzt: Ereignisse aus dem Portal landen direkt als Aufgaben im CRM. */
export function setPortalDispatch(fn: Dispatch) {
  dispatcher = fn;
}

export async function portalEnv(env: Env) {
  return {
    ...env,
    DB: env.RDB,
    FILES: env.RFILES,
    ASSETS: portalAssets(env),
    CRM_DISPATCH: dispatcher ? (payload: any) => dispatcher!(env, payload) : undefined,
    CRM_WEBHOOK_SECRET: await internalSecret(env),
    CRM_WEBHOOK_URL: '',
  };
}

const noopCtx = { waitUntil: (p: Promise<unknown>) => void p.catch(() => {}), passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

/** Anfrage an das Portal (öffentlich über den Host oder intern aus dem CRM) */
export async function portalFetch(env: Env, req: Request, ctx?: ExecutionContext): Promise<Response> {
  return (reviewApp as any).fetch(req, await portalEnv(env), ctx || noopCtx);
}

/** Interner, signierter Aufruf eines Portal-Endpunkts aus dem CRM (ersetzt die frühere HTTP-Verbindung) */
export async function portalCall(env: Env, path: string, body: unknown, ctx?: ExecutionContext) {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const secret = await internalSecret(env);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${raw}`)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const origin = (env.REVIEW_URL || 'https://project.review.devunox.ai').replace(/\/$/, '');
  return portalFetch(env, new Request(origin + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-devunox-timestamp': ts, 'x-devunox-signature': sig }, body: raw }), ctx);
}
