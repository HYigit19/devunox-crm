// Datenbankschema. Wird beim ersten Aufruf je Worker-Instanz geprüft und bei Bedarf angelegt,
// damit nach einem Deployment kein manueller Migrationsschritt nötig ist.
// Neue Änderungen: SCHEMA_VERSION erhöhen und Anweisungen unten in MIGRATIONS ergänzen.

export const SCHEMA_VERSION = 3;

const V1 = [
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,

  // Kunde (Mandant). Pro Kunde genau eine kommentierende Person (users.client_id).
  `CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','client')),
    client_id INTEGER REFERENCES clients(id),
    password_hash TEXT,
    must_change INTEGER NOT NULL DEFAULT 0,
    temp_expires_at TEXT,
    lang TEXT NOT NULL DEFAULT 'de',
    active INTEGER NOT NULL DEFAULT 1,
    fails INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    last_login TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_one_per_client ON users(client_id) WHERE client_id IS NOT NULL`,

  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,              -- cookie (Hub) | bearer (Widget)
    project_id INTEGER,              -- Widget-Sitzung gilt nur für ein Projekt
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,

  // Einmal-Links: Einladung, Passwort zurücksetzen, App-Übergabe (Hub → App mit Widget)
  `CREATE TABLE IF NOT EXISTS tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('invite','reset','handoff')),
    project_id INTEGER,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS throttle (k TEXT PRIMARY KEY, n INTEGER NOT NULL, reset_at TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    app_url TEXT NOT NULL DEFAULT '',
    repo_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'aktiv',
    next_no INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // Feedback-Punkte (vom Kunden, mit Pin) und Aufgaben (von uns, optional intern)
  `CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    no INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('feedback','todo')),
    internal INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'funktion',
    priority TEXT NOT NULL DEFAULT 'mittel',
    status TEXT NOT NULL DEFAULT 'offen',
    author_id INTEGER REFERENCES users(id),
    due_date TEXT,
    page_url TEXT NOT NULL DEFAULT '',
    page_key TEXT NOT NULL DEFAULT '',
    page_title TEXT NOT NULL DEFAULT '',
    selector TEXT NOT NULL DEFAULT '',
    anchor_text TEXT NOT NULL DEFAULT '',
    rx REAL, ry REAL,                -- Position im Element (0..1)
    px REAL, py REAL,                -- Position im Dokument (Pixel), Ersatz wenn das Element fehlt
    sx REAL, sy REAL,                -- Position im sichtbaren Ausschnitt (0..1), für den Screenshot
    vw INTEGER, vh INTEGER,
    device TEXT NOT NULL DEFAULT '',
    ua TEXT NOT NULL DEFAULT '',
    screenshot_id INTEGER,
    sort REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_activity_at TEXT NOT NULL,
    last_activity_by INTEGER,
    UNIQUE (project_id, no)
  )`,
  `CREATE INDEX IF NOT EXISTS items_project ON items(project_id, status)`,

  `CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    author_id INTEGER REFERENCES users(id),
    kind TEXT NOT NULL DEFAULT 'comment',   -- comment | status
    body TEXT NOT NULL DEFAULT '',
    meta TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS comments_item ON comments(item_id)`,

  `CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
    comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
    r2_key TEXT NOT NULL,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    is_screenshot INTEGER NOT NULL DEFAULT 0,
    author_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS files_item ON files(item_id)`,

  `CREATE TABLE IF NOT EXISTS seen (
    user_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    seen_at TEXT NOT NULL,
    PRIMARY KEY (user_id, item_id)
  )`,
];

// V2: Kundennummer aus dem devunox CRM (K-10001 …) für die eindeutige Zuordnung
const V2 = [
  `ALTER TABLE clients ADD COLUMN customer_no TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS clients_customer_no ON clients(customer_no) WHERE customer_no IS NOT NULL`,
];

// V3 (im devunox CRM): mehrere Personen je Kunde, Freigabe von Änderungswünschen (Mehraufwand)
const V3 = [
  `DROP INDEX IF EXISTS users_one_per_client`,
  `ALTER TABLE users ADD COLUMN can_approve INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE items ADD COLUMN cr_status TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE items ADD COLUMN cr_days REAL`,
  `ALTER TABLE items ADD COLUMN cr_amount REAL`,
  `ALTER TABLE items ADD COLUMN cr_currency TEXT`,
  `ALTER TABLE items ADD COLUMN cr_note TEXT`,
  `ALTER TABLE items ADD COLUMN cr_decided_at TEXT`,
  `ALTER TABLE items ADD COLUMN cr_decided_by INTEGER`,
];

const MIGRATIONS = { 1: V1, 2: V2, 3: V3 };

let ready = null;

export function ensureSchema(env) {
  if (!ready) ready = migrate(env).catch((e) => { ready = null; throw e; });
  return ready;
}

async function migrate(env) {
  let current = 0;
  try {
    const row = await env.DB.prepare("SELECT v FROM meta WHERE k = 'schema_version'").first();
    current = row ? Number(row.v) : 0;
  } catch {
    current = 0;
  }
  if (current >= SCHEMA_VERSION) return;
  for (let v = current + 1; v <= SCHEMA_VERSION; v++) {
    await env.DB.batch(MIGRATIONS[v].map((s) => env.DB.prepare(s)));
  }
  const secret = await env.DB.prepare("SELECT v FROM meta WHERE k = 'file_secret'").first();
  const stmts = [
    env.DB.prepare("INSERT INTO meta (k, v) VALUES ('schema_version', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(String(SCHEMA_VERSION)),
  ];
  if (!secret) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const v = btoa(String.fromCharCode(...bytes));
    stmts.push(env.DB.prepare("INSERT INTO meta (k, v) VALUES ('file_secret', ?)").bind(v));
  }
  await env.DB.batch(stmts);
}

// Für die Einrichtung per SQL (README): alle Anweisungen als Text
export const SCHEMA_SQL = V1.map((s) => s + ";").join("\n");
