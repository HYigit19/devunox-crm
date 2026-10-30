import { Env, decrypt, encrypt, toBase64, toBase64Url, getSettings, setSettings } from './util';

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.file',
];

export class GoogleError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
  }
}

/** Liefert ein gültiges Access-Token für den Benutzer (erneuert es bei Bedarf). */
export async function getAccessToken(env: Env, userId: string): Promise<string> {
  const u = await env.DB.prepare('SELECT refresh_token_enc, access_token_enc, access_expires_at FROM users WHERE id = ?')
    .bind(userId)
    .first<{ refresh_token_enc: string | null; access_token_enc: string | null; access_expires_at: number | null }>();
  if (!u) throw new GoogleError('Benutzer nicht gefunden', 401);
  if (u.access_token_enc && u.access_expires_at && u.access_expires_at > Date.now() + 60_000) {
    return decrypt(env.ENCRYPTION_KEY, u.access_token_enc);
  }
  if (!u.refresh_token_enc) throw new GoogleError('Google ist nicht verbunden. Bitte neu anmelden.', 401);
  const refresh = await decrypt(env.ENCRYPTION_KEY, u.refresh_token_enc);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !data.access_token) throw new GoogleError('Google-Token konnte nicht erneuert werden: ' + (data.error || res.status), 401);
  await env.DB.prepare('UPDATE users SET access_token_enc = ?, access_expires_at = ? WHERE id = ?')
    .bind(await encrypt(env.ENCRYPTION_KEY, data.access_token), Date.now() + (data.expires_in || 3600) * 1000, userId)
    .run();
  return data.access_token;
}

/** Absenderadresse = verbundenes Gmail-Konto (falls abweichend vom Login), sonst Login-E-Mail. */
export async function senderEmail(env: Env, userId: string): Promise<string> {
  const u = await env.DB.prepare('SELECT COALESCE(google_email, email) AS e FROM users WHERE id = ?').bind(userId).first<{ e: string }>();
  if (!u) throw new GoogleError('Benutzer nicht gefunden', 401);
  return u.e;
}

async function gfetch<T = any>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  if (!res.ok) {
    const txt = await res.text();
    throw new GoogleError(`Google API ${res.status}: ${txt.slice(0, 300)}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---------------- Gmail ----------------

function encodeHeader(v: string): string {
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${toBase64(new TextEncoder().encode(v))}?=`;
}

function wrap76(s: string): string {
  return s.replace(/.{1,76}/g, '$&\r\n').trim();
}

export type MailAttachment = { filename: string; mimeType: string; data: Uint8Array };
export type Mail = {
  from: string;
  fromName?: string;
  to: string;
  cc?: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: MailAttachment[];
  inReplyTo?: string;
  threadId?: string;
  headers?: Record<string, string>;
};

export function buildMime(m: Mail): string {
  const boundary = 'dvx_' + crypto.randomUUID().replace(/-/g, '');
  const alt = 'dvxalt_' + crypto.randomUUID().replace(/-/g, '');
  const lines: string[] = [];
  lines.push(`From: ${m.fromName ? `${encodeHeader(m.fromName)} <${m.from}>` : m.from}`);
  lines.push(`To: ${m.to}`);
  if (m.cc) lines.push(`Cc: ${m.cc}`);
  lines.push(`Subject: ${encodeHeader(m.subject)}`);
  lines.push('MIME-Version: 1.0');
  if (m.inReplyTo) {
    lines.push(`In-Reply-To: ${m.inReplyTo}`);
    lines.push(`References: ${m.inReplyTo}`);
  }
  for (const [k, v] of Object.entries(m.headers || {})) lines.push(`${k}: ${v}`);
  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  lines.push('');
  lines.push(`--${boundary}`);
  lines.push(`Content-Type: multipart/alternative; boundary="${alt}"`);
  lines.push('');
  lines.push(`--${alt}`);
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('Content-Transfer-Encoding: base64');
  lines.push('');
  lines.push(wrap76(toBase64(new TextEncoder().encode(m.text))));
  if (m.html) {
    lines.push(`--${alt}`);
    lines.push('Content-Type: text/html; charset="UTF-8"');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(wrap76(toBase64(new TextEncoder().encode(m.html))));
  }
  lines.push(`--${alt}--`);
  for (const a of m.attachments || []) {
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: ${a.mimeType}; name="${a.filename}"`);
    lines.push(`Content-Disposition: attachment; filename="${a.filename}"`);
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(wrap76(toBase64(a.data)));
  }
  lines.push(`--${boundary}--`);
  return lines.join('\r\n');
}

export function textToHtml(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const linked = esc.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2937">${linked.replace(/\n/g, '<br>')}</div>`;
}

export async function sendMail(token: string, m: Mail): Promise<{ id: string; threadId: string; messageIdHeader?: string }> {
  const raw = toBase64Url(new TextEncoder().encode(buildMime(m)));
  const sent = await gfetch<{ id: string; threadId: string }>(token, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ raw, threadId: m.threadId }),
  });
  // RFC Message-ID für spätere Antworten im selben Thread holen
  let messageIdHeader: string | undefined;
  try {
    const meta = await gfetch<any>(
      token,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${sent.id}?format=metadata&metadataHeaders=Message-ID`,
    );
    messageIdHeader = meta.payload?.headers?.find((h: any) => h.name.toLowerCase() === 'message-id')?.value;
  } catch {
    /* nicht kritisch */
  }
  return { ...sent, messageIdHeader };
}

export type GmailSummary = { id: string; threadId: string; subject: string; from: string; to: string; date: string; snippet: string; direction: 'in' | 'out' };

export async function listMailsWith(token: string, email: string, max = 20): Promise<GmailSummary[]> {
  const q = encodeURIComponent(`from:${email} OR to:${email} OR cc:${email}`);
  const list = await gfetch<{ messages?: { id: string }[] }>(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=${max}`);
  const ids = (list.messages || []).map((m) => m.id);
  const msgs = await Promise.all(
    ids.map((id) =>
      gfetch<any>(
        token,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`,
      ).catch(() => null),
    ),
  );
  return msgs.filter(Boolean).map((m: any) => {
    const h = (n: string) => m.payload?.headers?.find((x: any) => x.name.toLowerCase() === n)?.value || '';
    const from = h('from');
    return {
      id: m.id,
      threadId: m.threadId,
      subject: h('subject'),
      from,
      to: h('to'),
      date: new Date(Number(m.internalDate)).toISOString(),
      snippet: decodeEntities(m.snippet || ''),
      direction: from.toLowerCase().includes(email.toLowerCase()) ? 'in' : 'out',
    };
  });
}

function decodeEntities(s: string) {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function extractPlain(payload: any): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    const s = payload.body.data.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  for (const p of payload.parts || []) {
    const t = extractPlain(p);
    if (t) return t;
  }
  return '';
}

/** Prüft einen Thread auf Antworten von einer bestimmten Adresse nach einem Zeitpunkt. */
export async function findReply(token: string, threadId: string, fromEmail: string, afterMs: number): Promise<{ text: string; snippet: string; bounce?: boolean } | null> {
  const t = await gfetch<any>(token, `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`);
  for (const m of t.messages || []) {
    if (Number(m.internalDate) <= afterMs) continue;
    const from = m.payload?.headers?.find((x: any) => x.name.toLowerCase() === 'from')?.value || '';
    if (/mailer-daemon|postmaster/i.test(from)) return { text: '', snippet: decodeEntities(m.snippet || ''), bounce: true };
    if (from.toLowerCase().includes(fromEmail.toLowerCase())) {
      const text = extractPlain(m.payload) || m.snippet || '';
      // zitierten Teil abschneiden
      const cut = text.split(/\n(?:Am .* schrieb|On .* wrote|-----Original|>)/)[0];
      return { text: cut.slice(0, 4000), snippet: decodeEntities(m.snippet || '') };
    }
  }
  return null;
}

// ---------------- Kalender ----------------

export async function createEvent(
  token: string,
  ev: { summary: string; description?: string; start: string; end: string; timeZone: string; attendees?: string[] },
): Promise<{ id: string; htmlLink: string }> {
  return gfetch(token, 'https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      summary: ev.summary,
      description: ev.description,
      start: { dateTime: ev.start, timeZone: ev.timeZone },
      end: { dateTime: ev.end, timeZone: ev.timeZone },
      attendees: ev.attendees?.map((email) => ({ email })),
      reminders: { useDefault: true },
    }),
  });
}

export async function upcomingEvents(token: string, max = 8) {
  const now = new Date().toISOString();
  const data = await gfetch<any>(
    token,
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(now)}&maxResults=${max}&singleEvents=true&orderBy=startTime`,
  );
  return (data.items || []).map((e: any) => ({
    id: e.id,
    summary: e.summary || '(ohne Titel)',
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    link: e.htmlLink,
  }));
}

// ---------------- Drive ----------------

async function ensureFolder(token: string, name: string, parent?: string): Promise<string> {
  const f = await gfetch<{ id: string }>(token, 'https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: parent ? [parent] : undefined }),
  });
  return f.id;
}

async function folderExists(token: string, id: string): Promise<boolean> {
  if (!id) return false;
  try {
    const f = await gfetch<any>(token, `https://www.googleapis.com/drive/v3/files/${id}?fields=id,trashed`);
    return !f.trashed;
  } catch {
    return false;
  }
}

export async function driveQuotesFolder(env: Env, token: string): Promise<string> {
  const s = await getSettings(env.DB);
  let root = s.drive_folder_id;
  let quotes = s.drive_quotes_folder_id;
  if (!(await folderExists(token, root))) {
    root = await ensureFolder(token, 'Devunox CRM');
    quotes = '';
  }
  if (!(await folderExists(token, quotes))) quotes = await ensureFolder(token, 'Angebote', root);
  await setSettings(env.DB, { drive_folder_id: root, drive_quotes_folder_id: quotes });
  return quotes;
}

export async function uploadToDrive(token: string, folderId: string, filename: string, data: Uint8Array, existingId?: string | null) {
  const boundary = 'dvx' + crypto.randomUUID().replace(/-/g, '');
  const meta = existingId ? { name: filename } : { name: filename, parents: [folderId] };
  const head = new TextEncoder().encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
  );
  const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + data.length + tail.length);
  body.set(head, 0);
  body.set(data, head.length);
  body.set(tail, head.length + data.length);
  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart&fields=id,webViewLink`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink';
  return gfetch<{ id: string; webViewLink: string }>(token, url, {
    method: existingId ? 'PATCH' : 'POST',
    headers: { 'content-type': `multipart/related; boundary=${boundary}` },
    body,
  });
}
