-- Angebote: digitale Unterschrift & Firmenstempel im PDF (Standard: an)
ALTER TABLE quotes ADD COLUMN signed INTEGER NOT NULL DEFAULT 1;
