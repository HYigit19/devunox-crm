-- Anmeldung mit E-Mail + Passwort (Einmal-Passwort mit Pflichtwechsel)
-- und separates Gmail-Konto für den Versand an Kunden.

ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_temp INTEGER NOT NULL DEFAULT 0;   -- 1 = Einmal-Passwort, muss beim ersten Login geändert werden
ALTER TABLE users ADD COLUMN password_expires_at INTEGER;               -- Ablauf des Einmal-Passworts (ms)
ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until INTEGER;
ALTER TABLE users ADD COLUMN google_email TEXT;                          -- verbundenes Gmail-Konto (Absender für Kundenmails)
