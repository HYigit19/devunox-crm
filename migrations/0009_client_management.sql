-- Kundenmanagement: Team-Rollen, Releases, Checklisten, Verträge, Zugangsdaten-Tresor, Monatsberichte

ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin';   -- admin | member

-- Releases / Änderungsprotokoll je System
CREATE TABLE releases (
  id TEXT PRIMARY KEY,
  system_id TEXT REFERENCES systems(id) ON DELETE CASCADE,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  released_at TEXT NOT NULL,
  title TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_releases_system ON releases(system_id, released_at);

-- Onboarding-/Offboarding-Checklisten
CREATE TABLE checklists (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'onboarding',      -- onboarding | offboarding | custom
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE checklist_items (
  id TEXT PRIMARY KEY,
  checklist_id TEXT NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  hint TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  done_by TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_checklist_items ON checklist_items(checklist_id, sort);

-- Verträge & Compliance (Rahmenvertrag, AVV, SLA, NDA, Wartungsvertrag …)
CREATE TABLE contracts (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'framework',       -- framework | dpa | sla | nda | maintenance | other
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',         -- draft | sent | signed | ended
  signed_at TEXT,
  start_date TEXT,
  end_date TEXT,
  notice_days INTEGER NOT NULL DEFAULT 90,
  auto_renew INTEGER NOT NULL DEFAULT 1,
  renew_months INTEGER NOT NULL DEFAULT 12,
  document_id TEXT,                             -- Datei in der Ablage
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_contracts_company ON contracts(company_id);

-- Zugangsdaten-Tresor (Passwörter verschlüsselt mit ENCRYPTION_KEY)
CREATE TABLE vault_items (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  system_id TEXT REFERENCES systems(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  url TEXT,
  username TEXT,
  secret_enc TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_vault_company ON vault_items(company_id);
CREATE TABLE vault_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  user_id TEXT,
  user_email TEXT,
  action TEXT NOT NULL,                         -- reveal | create | update | delete
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_vault_log_item ON vault_log(item_id, at);

-- Monatsberichte an Kunden
CREATE TABLE client_reports (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  period TEXT NOT NULL,                         -- JJJJ-MM
  lang TEXT NOT NULL DEFAULT 'de',
  document_id TEXT,
  sent_at TEXT,
  sent_to TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, period, lang)
);
