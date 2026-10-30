-- Kundennummern (K-10001 …), Zeiterfassung, Review-Verknüpfung je Kunde

ALTER TABLE companies ADD COLUMN customer_no TEXT;
ALTER TABLE companies ADD COLUMN review_client_id INTEGER;

-- bestehende Firmen in Anlage-Reihenfolge nummerieren
UPDATE companies SET customer_no = 'K-' || (10000 + (
  SELECT COUNT(*) FROM companies c2
  WHERE c2.created_at < companies.created_at OR (c2.created_at = companies.created_at AND c2.id <= companies.id)
));
CREATE UNIQUE INDEX idx_companies_customer_no ON companies(customer_no);
INSERT INTO counters (name, year, value) SELECT 'customer', 0, COUNT(*) FROM companies WHERE true
  ON CONFLICT(name, year) DO UPDATE SET value = excluded.value;

CREATE TABLE time_entries (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  user_id TEXT,
  date TEXT NOT NULL,                 -- JJJJ-MM-TT
  minutes INTEGER NOT NULL,
  description TEXT,
  billable INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_time_company ON time_entries(company_id, date);
CREATE INDEX idx_time_project ON time_entries(project_id, date);
CREATE INDEX idx_time_task ON time_entries(task_id);
