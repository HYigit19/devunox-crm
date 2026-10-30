-- Devunox CRM – Grundschema

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  picture TEXT,
  refresh_token_enc TEXT,
  access_token_enc TEXT,
  access_expires_at INTEGER,
  scopes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE counters (
  name TEXT NOT NULL,
  year INTEGER NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (name, year)
);

CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  website TEXT,
  industry TEXT,
  size TEXT,
  street TEXT,
  zip TEXT,
  city TEXT,
  country TEXT,           -- ISO-2, z. B. DE, PL, US
  vat_id TEXT,            -- USt-IdNr. / NIP / EIN
  phone TEXT,
  email TEXT,
  tags TEXT,              -- kommagetrennt
  notes TEXT,
  research TEXT,          -- KI-Recherche
  owner_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_companies_name ON companies(name);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  salutation TEXT,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  position TEXT,
  linkedin TEXT,
  language TEXT DEFAULT 'de',
  country TEXT,
  consent TEXT NOT NULL DEFAULT 'none',  -- none | consent | customer | opt_out
  consent_note TEXT,
  tags TEXT,
  notes TEXT,
  owner_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_contacts_company ON contacts(company_id);
CREATE INDEX idx_contacts_email ON contacts(email);

CREATE TABLE deals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  stage TEXT NOT NULL DEFAULT 'lead',   -- lead | qualified | proposal | negotiation | won | lost
  value REAL DEFAULT 0,
  currency TEXT DEFAULT 'EUR',
  probability INTEGER DEFAULT 10,
  expected_close TEXT,
  source TEXT,
  notes TEXT,
  owner_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_deals_stage ON deals(stage);

CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,          -- note | call | meeting | task | email | agent | system
  subject TEXT,
  body TEXT,
  company_id TEXT,
  contact_id TEXT,
  deal_id TEXT,
  quote_id TEXT,
  due_at TEXT,
  done INTEGER DEFAULT 0,
  gmail_thread_id TEXT,
  calendar_event_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_act_contact ON activities(contact_id);
CREATE INDEX idx_act_company ON activities(company_id);
CREATE INDEX idx_act_deal ON activities(deal_id);
CREATE INDEX idx_act_due ON activities(type, done, due_at);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  unit TEXT DEFAULT 'Tag',
  price REAL NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'EUR',
  tax_rate REAL,
  active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE quotes (
  id TEXT PRIMARY KEY,
  number TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | sent | accepted | rejected | expired
  title TEXT,
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id TEXT REFERENCES deals(id) ON DELETE SET NULL,
  language TEXT DEFAULT 'de',
  currency TEXT DEFAULT 'EUR',
  tax_mode TEXT DEFAULT 'standard',      -- standard | reverse_charge | non_eu | none
  issue_date TEXT,
  valid_until TEXT,
  intro TEXT,
  outro TEXT,
  discount_pct REAL DEFAULT 0,
  subtotal REAL DEFAULT 0,
  tax_total REAL DEFAULT 0,
  total REAL DEFAULT 0,
  drive_file_id TEXT,
  sent_at TEXT,
  decided_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE quote_items (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  pos INTEGER NOT NULL,
  product_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  qty REAL NOT NULL DEFAULT 1,
  unit TEXT,
  unit_price REAL NOT NULL DEFAULT 0,
  discount_pct REAL DEFAULT 0,
  tax_rate REAL DEFAULT 0
);
CREATE INDEX idx_qi_quote ON quote_items(quote_id);

-- KI-Agent
CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',   -- draft | active | paused | done
  goal TEXT,                              -- Ziel, z. B. Erstgespräch vereinbaren
  offer TEXT,                             -- Was wird angeboten
  audience TEXT,                          -- Beschreibung der Zielgruppe
  tone TEXT DEFAULT 'professionell, direkt, freundlich',
  language TEXT DEFAULT 'auto',           -- auto | de | en
  steps TEXT NOT NULL,                    -- JSON [{delay_days, instruction}]
  daily_limit INTEGER DEFAULT 20,
  research INTEGER DEFAULT 1,             -- Websuche zur Personalisierung
  require_consent INTEGER DEFAULT 1,      -- DACH/EU nur mit Rechtsgrundlage
  booking_link TEXT,
  owner_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE enrollments (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  step INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',  -- active | replied | completed | stopped | opted_out | error
  next_send_at TEXT,
  gmail_thread_id TEXT,
  last_message_id TEXT,                   -- RFC Message-ID für Threading
  first_subject TEXT,
  last_sent_at TEXT,
  reply_class TEXT,
  reply_snippet TEXT,
  fail_count INTEGER DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (campaign_id, contact_id)
);
CREATE INDEX idx_enr_due ON enrollments(status, next_send_at);

CREATE TABLE campaign_messages (
  id TEXT PRIMARY KEY,
  enrollment_id TEXT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  step INTEGER NOT NULL,
  subject TEXT,
  body TEXT,
  gmail_message_id TEXT,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_cm_campaign ON campaign_messages(campaign_id, sent_at);

CREATE TABLE agent_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT DEFAULT 'info',
  message TEXT,
  campaign_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
