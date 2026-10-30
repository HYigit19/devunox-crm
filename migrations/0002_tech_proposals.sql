-- Technische Angebote (aus Excel-Anforderungen per KI erstellt)
CREATE TABLE tech_proposals (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL UNIQUE REFERENCES quotes(id) ON DELETE CASCADE,
  source_file TEXT,
  drive_file_id TEXT,
  data TEXT NOT NULL,          -- JSON: Ausgangslage, Lösung, Anforderungsmatrix, Phasen, Annahmen …
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
