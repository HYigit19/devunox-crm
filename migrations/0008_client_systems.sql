-- Kundensysteme: Hosting, Abos & Abrechnung, Wartung & Überwachung, Lizenzen (On-Premise)

CREATE TABLE systems (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'webapp',          -- website | webapp | portal | dashboard | automation | api | other
  hosting TEXT NOT NULL DEFAULT 'devunox_cloud', -- devunox_cloud | on_prem | aws | azure | gcp | hetzner | other
  hosting_note TEXT,                             -- z. B. Server, Region, Ansprechpartner IT
  status TEXT NOT NULL DEFAULT 'live',           -- setup | live | maintenance | paused | ended
  prod_url TEXT,
  staging_url TEXT,
  admin_url TEXT,
  repo_url TEXT,
  cf_worker TEXT,                                -- Cloudflare-Worker / Pages-Projekt
  version TEXT,
  stack TEXT,
  domain TEXT,
  domain_expires TEXT,
  ssl_expires TEXT,
  backup_info TEXT,
  last_backup_at TEXT,
  last_update_at TEXT,
  maintenance_hours REAL NOT NULL DEFAULT 0,     -- inklusive Wartungsstunden pro Monat
  sla TEXT,
  monitor INTEGER NOT NULL DEFAULT 0,            -- Erreichbarkeit alle 15 Minuten prüfen
  check_ok INTEGER,
  check_status INTEGER,
  check_ms INTEGER,
  check_error TEXT,
  check_at TEXT,
  down_since TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_systems_company ON systems(company_id);

CREATE TABLE system_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  system_id TEXT NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
  ok INTEGER NOT NULL,
  status INTEGER,
  ms INTEGER,
  error TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_checks_system ON system_checks(system_id, at);

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  system_id TEXT REFERENCES systems(id) ON DELETE SET NULL,
  name TEXT NOT NULL,                            -- z. B. „Hosting & Wartung Business“
  amount REAL NOT NULL DEFAULT 0,                -- netto je Abrechnungszeitraum
  currency TEXT NOT NULL DEFAULT 'EUR',
  interval TEXT NOT NULL DEFAULT 'month',        -- month | quarter | year
  start_date TEXT NOT NULL,
  end_date TEXT,                                 -- gekündigt zum
  notice_days INTEGER NOT NULL DEFAULT 30,
  billing_day INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',         -- active | paused | cancelled
  includes TEXT,                                 -- Leistungsumfang
  included_hours REAL NOT NULL DEFAULT 0,        -- inklusive Wartungs-/Supportstunden je Monat
  overage_rate REAL NOT NULL DEFAULT 0,          -- Stundensatz für Stunden über dem Kontingent
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_subs_company ON subscriptions(company_id);

-- Abrechnungszeiträume: werden automatisch angelegt, wenn ein Zeitraum fällig wird
CREATE TABLE subscription_periods (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  company_id TEXT,
  period TEXT NOT NULL,                          -- JJJJ-MM (Beginn des Zeitraums)
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',           -- open | invoiced | paid
  invoice_no TEXT,
  invoiced_at TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (subscription_id, period)
);
CREATE INDEX idx_periods_status ON subscription_periods(status, due_date);

CREATE TABLE licenses (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  system_id TEXT REFERENCES systems(id) ON DELETE SET NULL,
  edition TEXT NOT NULL DEFAULT 'Business',
  seats INTEGER NOT NULL DEFAULT 0,              -- 0 = unbegrenzt
  modules TEXT,                                  -- kommagetrennt
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  license_key TEXT,
  status TEXT NOT NULL DEFAULT 'active',         -- active | revoked
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_licenses_company ON licenses(company_id);

-- Signaturschlüssel für Lizenzen (Ed25519). Der private Schlüssel liegt verschlüsselt (ENCRYPTION_KEY).
CREATE TABLE license_signing (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  private_jwk_enc TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
