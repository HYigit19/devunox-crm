-- Dokumentenmanagement (DMS): Papierkorb, Versionen, Favoriten, Freigabelinks
-- Nur neue Tabellen – die bestehende Tabelle documents bleibt unverändert.

-- Papierkorb: gelöschte Dateien werden hierher verschoben (30 Tage wiederherstellbar)
CREATE TABLE documents_trash (
  id TEXT PRIMARY KEY,
  company_id TEXT,
  project_id TEXT,
  folder TEXT NOT NULL DEFAULT '/',
  name TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  mime TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  tags TEXT,
  source TEXT,
  uploaded_by TEXT,
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_by TEXT
);
CREATE INDEX idx_trash_deleted ON documents_trash(deleted_at);

-- Ältere Fassungen einer Datei (beim Überschreiben oder „Neue Version hochladen“)
CREATE TABLE document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  name TEXT,
  mime TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_versions_doc ON document_versions(document_id, created_at);

-- Favoriten
CREATE TABLE document_stars (
  document_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Freigabelinks für Dateien oder ganze Ordner (nur lesen)
CREATE TABLE document_shares (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  document_id TEXT,              -- Datei-Freigabe
  company_id TEXT,               -- Ordner-Freigabe: Ablage …
  project_id TEXT,
  folder TEXT,                   -- … und Ordnerpfad
  label TEXT,
  password_hash TEXT,
  expires_at TEXT,
  downloads INTEGER NOT NULL DEFAULT 0,
  last_access_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_shares_doc ON document_shares(document_id);
