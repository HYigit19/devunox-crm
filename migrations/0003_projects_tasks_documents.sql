-- Projekte je Kunde, Aufgaben (To-dos), Dokumentenablage

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  quote_id TEXT REFERENCES quotes(id) ON DELETE SET NULL,
  deal_id TEXT REFERENCES deals(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active',     -- planning | active | paused | done
  description TEXT,
  start_date TEXT,
  end_date TEXT,
  review_slug TEXT UNIQUE,                    -- Projekt-Kürzel in devunox Review
  review_url TEXT,
  app_url TEXT,
  color TEXT,
  owner_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_projects_company ON projects(company_id);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo',        -- todo | doing | review | done
  priority TEXT NOT NULL DEFAULT 'medium',    -- high | medium | low
  category TEXT,                              -- z. B. fehler, design, funktion (aus Review)
  due_at TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id TEXT,
  quote_id TEXT,
  assignee_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual',      -- manual | review | agent | system
  external_id TEXT UNIQUE,                    -- z. B. review:123
  external_url TEXT,
  external_status TEXT,
  calendar_event_id TEXT,
  unread INTEGER NOT NULL DEFAULT 0,          -- neue Kundenreaktion aus Review
  sort REAL NOT NULL DEFAULT 0,
  created_by TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tasks_status ON tasks(status, due_at);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_company ON tasks(company_id);

ALTER TABLE activities ADD COLUMN task_id TEXT;
ALTER TABLE activities ADD COLUMN project_id TEXT;

-- bisherige Aufgaben aus der Aktivitätenliste übernehmen
INSERT INTO tasks (id, title, description, status, due_at, company_id, contact_id, deal_id, quote_id, source, calendar_event_id, created_by, created_at, completed_at)
  SELECT id, COALESCE(subject, 'Aufgabe'), body, CASE WHEN done = 1 THEN 'done' ELSE 'todo' END, due_at, company_id, contact_id, deal_id, quote_id,
         'manual', calendar_event_id, created_by, created_at, CASE WHEN done = 1 THEN created_at END
  FROM activities WHERE type = 'task';
DELETE FROM activities WHERE type = 'task';

-- Dokumentenablage (Dateien in R2, EU)
CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,                          -- z. B. /Verträge/2026/
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_folders_unique ON folders(COALESCE(company_id, ''), COALESCE(project_id, ''), path);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  folder TEXT NOT NULL DEFAULT '/',
  name TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  mime TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  tags TEXT,
  source TEXT DEFAULT 'upload',                -- upload | quote | tech | review
  uploaded_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_documents_company ON documents(company_id, folder);
CREATE INDEX idx_documents_project ON documents(project_id);
