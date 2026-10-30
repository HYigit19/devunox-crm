export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_URL?: string;           // optional – sonst automatisch aus der Login-URL
  ALLOWED_EMAILS: string;      // kommagetrennt, z. B. "yigit@devunox-consulting.com,@devunox-consulting.com"
  AI_MODEL?: string;           // Standard: claude-sonnet-5-5
  TIMEZONE?: string;           // Standard: Europe/Berlin
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_BASE_URL?: string; // optional, z. B. für ein AI Gateway
  ENCRYPTION_KEY: string;      // beliebiger langer Zufallsstring
  DEV_AUTH?: string;
  DOCS: R2Bucket;               // Dokumentenablage (R2, EU)
  REVIEW_URL?: string;          // z. B. https://project.review.devunox.ai
  REVIEW_WEBHOOK_SECRET?: string; // gemeinsames Geheimnis mit devunox Review           // nur lokal: "1" erlaubt Login ohne Google
}

export type User = { id: string; email: string; name: string | null; picture: string | null };
export type AppEnv = { Bindings: Env; Variables: { user: User } };

export const uid = () => crypto.randomUUID();

export const nowIso = () => new Date().toISOString();

export function todayIso(tz = 'Europe/Berlin'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function addDays(dateIso: string, days: number): string {
  const d = new Date(dateIso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const EU_COUNTRIES = [
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE',
  'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
];

/** Länder, in denen E-Mail-Werbung grundsätzlich eine vorherige Einwilligung braucht (auch B2B). */
export const CONSENT_COUNTRIES = [...EU_COUNTRIES, 'CH', 'NO', 'LI', 'IS', 'GB'];

export function suggestTaxMode(sellerCountry: string, buyerCountry?: string | null): string {
  const s = (sellerCountry || 'PL').toUpperCase();
  const b = (buyerCountry || s).toUpperCase();
  if (b === s) return 'standard';
  if (EU_COUNTRIES.includes(s) && EU_COUNTRIES.includes(b)) return 'reverse_charge';
  return 'non_eu';
}

// ---------- Krypto ----------
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export const toBase64 = b64;
export const fromBase64 = unb64;
export function toBase64Url(data: string | Uint8Array): string {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  return b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromBase64Url(s: string): string {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  return dec.decode(unb64(pad + '==='.slice((pad.length + 3) % 4)));
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encrypt(secret: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), enc.encode(plain));
  return b64(iv) + '.' + b64(ct);
}

export async function decrypt(secret: string, data: string): Promise<string> {
  const [iv, ct] = data.split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) as Uint8Array<ArrayBuffer> }, await aesKey(secret), unb64(ct));
  return dec.decode(pt);
}

export async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return toBase64Url(new Uint8Array(sig)).slice(0, 32);
}

// ---------- Einstellungen ----------
export const DEFAULT_SETTINGS: Record<string, string> = {
  company_name: 'Devunox Solutions',
  company_legal: '',
  company_street: '',
  company_zip: '',
  company_city: '',
  company_country: 'PL',
  company_vat_id: '',
  company_register: '',
  company_managing_director: 'Hüseyin Yigit',
  company_email: 'yigit@devunox-consulting.com',
  company_phone: '+49 6142 330 60 55',
  company_website: 'www.devunox-consulting.com',
  bank_name: '',
  bank_iban: '',
  bank_bic: '',
  default_tax_rate: '23',
  payment_terms_days: '14',
  quote_valid_days: '30',
  quote_prefix: 'AN',
  quote_intro_de: 'Sehr geehrte Damen und Herren,\n\nvielen Dank für Ihr Interesse. Gerne unterbreiten wir Ihnen folgendes Angebot:',
  quote_outro_de: 'Wir freuen uns auf die Zusammenarbeit. Bei Fragen stehen wir Ihnen jederzeit zur Verfügung.\n\nMit freundlichen Grüßen\nHüseyin Yigit',
  quote_intro_en: 'Dear Sir or Madam,\n\nThank you for your interest. We are pleased to submit the following proposal:',
  quote_outro_en: 'We look forward to working with you. Please do not hesitate to contact us with any questions.\n\nBest regards\nHüseyin Yigit',
  note_none_de: '',
  note_none_en: '',
  ai_company_profile: 'Devunox Solutions ist ein SAP-Beratungshaus mit Schwerpunkt SAP QM (Quality Management) und S/4HANA. Wir stellen kurzfristig erfahrene Nearshore-Consultants aus Osteuropa, begleitet von deutschen Projektmanagern – zu einem festen Pauschalpreis statt Tagessätzen.',
  ai_signature: 'Hüseyin Yigit\nCEO & Senior SAP QM Consultant\nDevunox Solutions\n+49 6142 330 60 55\nwww.devunox-consulting.com',
  tech_profile: 'devunoxAI (Marke der Devunox Solutions) entwickelt individuelle Software: Websites, Web-Apps, Kundenportale, Dashboards und KI-Automatisierungen (z. B. KI-Assistenten, Dokumentenverarbeitung, E-Mail-Automatisierung mit Claude). Bevorzugter Stack: React/TypeScript, Cloudflare Workers, D1-Datenbank, R2-Speicher (EU), Anbindungen per REST-API (Google Workspace, Microsoft 365, SAP, CRM-/ERP-Systeme). Vorgehen agil in 1–2-wöchigen Iterationen mit Demo, Tests und Übergabe inkl. Dokumentation.',
  day_rate: '960',
  day_rate_currency: 'EUR',
  pm_pct: '15',
  send_days: '1,2,3,4,5',
  send_hour_from: '8',
  send_hour_to: '17',
  drive_folder_id: '',
  app_url: '',
  drive_quotes_folder_id: '',
};

export async function getSettings(db: D1Database): Promise<Record<string, string>> {
  const { results } = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const s = { ...DEFAULT_SETTINGS };
  for (const r of results) s[r.key] = r.value ?? '';
  return s;
}

export async function setSettings(db: D1Database, values: Record<string, string>) {
  const stmts = Object.entries(values).map(([k, v]) =>
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, String(v ?? '')),
  );
  if (stmts.length) await db.batch(stmts);
}

export async function nextNumber(db: D1Database, name: string, prefix: string, year: number): Promise<string> {
  const row = await db
    .prepare('INSERT INTO counters (name, year, value) VALUES (?, ?, 1) ON CONFLICT(name, year) DO UPDATE SET value = value + 1 RETURNING value')
    .bind(name, year)
    .first<{ value: number }>();
  return `${prefix}-${year}-${String(row!.value).padStart(4, '0')}`;
}

export async function log(db: D1Database, message: string, level = 'info', campaignId: string | null = null) {
  try {
    await db.prepare('INSERT INTO agent_log (level, message, campaign_id) VALUES (?, ?, ?)').bind(level, message.slice(0, 2000), campaignId).run();
  } catch {
    /* ignore */
  }
}

/** Baut ein UPDATE aus erlaubten Feldern. */
export function pick<T extends Record<string, unknown>>(body: T, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) if (f in body) out[f] = body[f] === '' ? null : body[f];
  return out;
}

export async function insertRow(db: D1Database, table: string, data: Record<string, unknown>) {
  const keys = Object.keys(data);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  await db.prepare(sql).bind(...keys.map((k) => data[k] ?? null)).run();
}

export async function updateRow(db: D1Database, table: string, id: string, data: Record<string, unknown>, touch = true) {
  const keys = Object.keys(data);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`);
  if (touch) sets.push(`updated_at = datetime('now')`);
  await db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).bind(...keys.map((k) => data[k] ?? null), id).run();
}
