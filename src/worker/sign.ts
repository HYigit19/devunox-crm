import { Hono } from 'hono';
import { AppEnv, Env } from './util';

// Digitale Unterschrift und Firmenstempel.
// Eigene Bilder liegen in R2 unter _sign/<art>.png, sonst gelten die mitgelieferten Standardbilder (public/brand/sign).

export const signRoutes = new Hono<AppEnv>();
const KINDS = ['signature', 'stamp'] as const;
type Kind = (typeof KINDS)[number];
const isKind = (k: string): k is Kind => (KINDS as readonly string[]).includes(k);
const key = (k: Kind) => `_sign/${k}.png`;

async function defaultAsset(env: Env, k: Kind): Promise<Uint8Array | null> {
  const res = await env.ASSETS.fetch(new Request(`https://assets.local/brand/sign/${k}.png`));
  return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
}

export async function loadSignAsset(env: Env, k: Kind): Promise<Uint8Array | null> {
  const obj = await env.DOCS.get(key(k));
  if (obj) return new Uint8Array(await obj.arrayBuffer());
  return defaultAsset(env, k);
}

signRoutes.get('/:kind', async (c) => {
  const k = c.req.param('kind');
  if (!isKind(k)) return c.json({ error: 'Unbekannt' }, 404);
  const obj = await c.env.DOCS.get(key(k));
  const bytes = obj ? new Uint8Array(await obj.arrayBuffer()) : await defaultAsset(c.env, k);
  if (!bytes) return c.json({ error: 'Bild fehlt' }, 404);
  return new Response(bytes.slice().buffer as ArrayBuffer, { headers: { 'content-type': 'image/png', 'cache-control': 'no-store', 'x-sign-source': obj ? 'custom' : 'default' } });
});

signRoutes.put('/:kind', async (c) => {
  const k = c.req.param('kind');
  if (!isKind(k)) return c.json({ error: 'Unbekannt' }, 404);
  const buf = new Uint8Array(await c.req.arrayBuffer());
  if (buf.byteLength > 3 * 1024 * 1024) return c.json({ error: 'Bild ist größer als 3 MB.' }, 400);
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (!png) return c.json({ error: 'Bitte ein PNG-Bild verwenden (am besten mit transparentem Hintergrund).' }, 400);
  await c.env.DOCS.put(key(k), buf, { httpMetadata: { contentType: 'image/png' } });
  return c.json({ ok: true });
});

signRoutes.delete('/:kind', async (c) => {
  const k = c.req.param('kind');
  if (!isKind(k)) return c.json({ error: 'Unbekannt' }, 404);
  await c.env.DOCS.delete(key(k));
  return c.json({ ok: true });
});
