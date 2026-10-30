# devunox AI · CRM

Angebote, CRM, Projekte, Aufgaben, Dokumentenablage und KI-Vertriebsagent – im devunox-AI-Design.
Läuft auf Cloudflare (Worker + D1 + R2 EU) und nutzt Google Workspace und Claude. Adresse: **https://crm.devunox.ai**

**Funktionen**

- **CRM:** Firmen, Kontakte, Deal-Pipeline (Kanban), Aktivitäten
- **Projekte je Kunde:** Aufgaben-Board, Dokumente, Verknüpfung mit Angebot und devunox Review. Projekte lassen sich mit einem Klick aus einem Angebot anlegen; dabei werden die Anforderungen des technischen Angebots als Aufgaben übernommen.
- **Aufgaben (To-dos):** Board und Liste mit vier Spalten: Offen, In Arbeit, Beim Kunden, Erledigt.
  - Mit Priorität, Fälligkeit (optional im Google Kalender), Notizen und Verlauf.
  - Quellen: manuell, aus Angeboten, KI-Agent (Antworten auf Kampagnen) und devunox Review (Kunden-Feedback).
- **Dokumentenablage (wie Dropbox):** je Kunde und Projekt.
  - Ordner anlegen, Dateien oder ganze Ordner per Drag & Drop hochladen.
  - Verschieben (auch per Ziehen auf einen Ordner), Umbenennen, Tags, Suche, Mehrfachauswahl, Vorschau und Download.
  - Speicher: Cloudflare R2 mit Jurisdiktion EU.
  - Versendete Angebots-PDFs werden automatisch im Ordner „Angebote“ des Kunden abgelegt.
- **CSV-Import** von Kontakten (LinkedIn Sales Navigator, Apollo.io, Excel)
- **Angebote:** Positionen, Leistungskatalog, Rabatte, DE/EN, EUR/USD/PLN/CHF
  - Steuer-Varianten: Inland, Reverse Charge, Nicht-EU, ohne MwSt.
  - PDF-Erzeugung mit fortlaufender Nummer (AN-2026-0001)
  - Erstentwurf per KI
- **Excel → Angebot (KI):** Excel-Datei hochladen (eine Anforderungsliste eines Kunden oder eine Liste mehrerer Kunden).
  - Die KI erkennt Kunden, Kontakte und Anforderungen und erstellt je Kunde zwei Dokumente:
    - ein **technisches Angebot** (PDF): Ausgangslage, Lösungsansatz, Technologie, Fit/Gap-Bewertung und Aufwand in Personentagen je Anforderung, Arbeitspakete, Projektplan, Annahmen, Abgrenzungen, offene Fragen
    - ein **einfaches Angebot**: Arbeitspakete × Tagessatz plus Aufschlag für Projektmanagement und Qualitätssicherung
  - Firma, Kontakt und Deal werden automatisch angelegt.
  - Die Bewertungen sind editierbar. Mit „Preise neu berechnen“ übernimmt das Angebot die geänderten Aufwände.
  - Beim Gmail-Versand gehen beide PDFs mit.
- **Gmail:** Angebote mit PDF-Anhang senden, E-Mails an Kontakte schreiben (auf Wunsch mit KI-Entwurf), Gmail-Verlauf pro Kontakt
- **Google Kalender:** Termine und Follow-ups eintragen, Kontakt einladen, nächste Termine auf der Übersicht
- **Google Drive:** Angebots-PDFs im Ordner „Devunox CRM/Angebote“ ablegen
- **KI-Agent:** Kampagnen mit bis zu 6 Mails pro Sequenz
  - Jede Mail wird mit Claude individuell geschrieben, vor der ersten Mail optional mit Webrecherche zur Firma
  - Versand automatisch alle 15 Minuten im eingestellten Versandfenster
  - Follow-ups gehen im selben Gmail-Thread raus
  - Antworten werden erkannt und klassifiziert; der Agent legt dazu eine Aufgabe an, bei Interesse auch einen Deal
  - Bounces werden erkannt, Abmeldelink nach RFC 8058 (One-Click)
  - Rechtsschutz: Kontakte in EU/DACH/UK werden nur mit Einwilligung oder als Bestandskunde angeschrieben

## devunox Review ↔ CRM

So funktioniert die Verbindung:
- Gibt ein Kunde in **devunox Review** (project.review.devunox.ai) Feedback, entsteht im CRM automatisch eine **Aufgabe** im passenden Projekt.
  - Das Projekt wird über das Review-Kürzel zugeordnet und bei Bedarf samt Firma angelegt.
  - Priorität und Kategorie werden übernommen.
- Antwortet der Kunde in Review, landet die Antwort im Verlauf der Aufgabe und die Aufgabe wird als „neu“ markiert.
- Öffnet der Kunde einen Punkt wieder, springt die Aufgabe zurück auf „Offen“, mit seiner Begründung.
- Statuswechsel im CRM gehen an Review zurück:
  - „In Arbeit“ → In Arbeit
  - „Beim Kunden“ oder „Erledigt“ → **Bitte prüfen**. Eine Notiz geht dabei als Kommentar an den Kunden.
  - Nimmt der Kunde in Review ab, wird die Aufgabe im CRM erledigt.
- Interne Review-Aufgaben werden nicht übertragen.
- Beide Seiten prüfen eine HMAC-Signatur mit gemeinsamem Geheimnis. Nachrichten, die älter als 5 Minuten sind, werden abgewiesen.

**Einrichtung:** Einen langen Zufallswert als Secret in **beide** Worker eintragen:
- im CRM-Worker als `REVIEW_WEBHOOK_SECRET`
- im Review-Worker als `CRM_WEBHOOK_SECRET`

Die Adressen stehen schon in den `wrangler.jsonc`:
- `REVIEW_URL` im CRM
- `CRM_WEBHOOK_URL` = `https://crm.devunox.ai/hooks/review` in Review

Solange kein Secret gesetzt ist, passiert nichts.

## Einrichtung (einmalig, ca. 30 Minuten)

### 1. Cloudflare-Datenbank – bereits erledigt

Die D1-Datenbank `devunox-crm` (Region Westeuropa) ist angelegt, alle Migrationen (0001–0003) sind eingespielt.
Den R2-Speicher `devunox-crm-dokumente` (EU) legt das erste Deployment automatisch an. Falls das Build-Log einen Fehler dazu zeigt: Im Dashboard unter **R2 → Create bucket** den Namen `devunox-crm-dokumente` eintragen, *Location → Specify jurisdiction → EU* wählen und dann neu deployen.
Die Adresse `crm.devunox.ai` richtet das Deployment ebenfalls ein (`routes` in `wrangler.jsonc`), weil devunox.ai im selben Cloudflare-Konto liegt. Ihre ID steht schon in `wrangler.jsonc`.

### 2. Code auf GitHub und mit Cloudflare verbinden

1. Lege auf GitHub ein privates Repo `devunox-crm` an und lade diesen Ordner hoch.
2. Im Cloudflare-Dashboard: **Workers & Pages → Create → Import a repository** und `devunox-crm` wählen.
   - Build command: leer lassen. `wrangler deploy` baut die Oberfläche selbst über `build.command`.
   - Deploy command: `npx wrangler deploy`
3. Nach dem ersten Deploy bekommst du eine Adresse wie `https://devunox-crm.<dein-name>.workers.dev`.
   Optional kannst du unter **Settings → Domains & Routes** eine eigene Domain hinzufügen, z. B. `crm.devunox.ai`.

### 3. Google Cloud (für Login, Gmail, Kalender, Drive)

1. Öffne <https://console.cloud.google.com>, am besten mit deinem Workspace-Konto, und lege ein neues Projekt „Devunox CRM“ an.
2. Unter **APIs & Dienste → Bibliothek** diese drei APIs aktivieren: **Gmail API**, **Google Calendar API** und **Google Drive API**.
3. Unter **OAuth-Zustimmungsbildschirm** als Nutzertyp **Intern** wählen. Das geht nur mit Google Workspace und braucht keine Google-Prüfung.
4. Unter **Anmeldedaten → Anmeldedaten erstellen → OAuth-Client-ID** den Typ **Webanwendung** wählen.
   - Autorisierte Weiterleitungs-URI: `https://crm.devunox.ai/auth/callback`
   - Wenn du eine eigene Domain nutzt, trägst du deren Callback-URL zusätzlich ein.
5. Notiere Client-ID und Clientschlüssel.

### 4. Claude-API-Schlüssel

Erstelle unter <https://console.anthropic.com> → **API Keys** einen neuen Schlüssel.

### 5. Secrets in Cloudflare eintragen

Im Worker unter **Settings → Variables and Secrets** diese Werte anlegen:

| Name | Typ | Wert |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Secret | aus Schritt 3 |
| `GOOGLE_CLIENT_SECRET` | Secret | aus Schritt 3 |
| `ANTHROPIC_API_KEY` | Secret | aus Schritt 4 |
| `ENCRYPTION_KEY` | Secret | langer Zufallstext (mind. 40 Zeichen); danach nie mehr ändern |
| `REVIEW_WEBHOOK_SECRET` | Secret | langer Zufallstext – derselbe Wert als `CRM_WEBHOOK_SECRET` im Review-Worker |
| `ALLOWED_EMAILS` | Variable | steht schon in `wrangler.jsonc`: `yigit@devunox-consulting.com`. Weitere Adressen kommagetrennt, `@devunox-consulting.com` erlaubt die ganze Domain |

Optional sind `AI_MODEL` (Standard `claude-sonnet-5-5`), `TIMEZONE` (Standard `Europe/Berlin`) und `APP_URL` (wird sonst automatisch erkannt).

### 6. Loslegen

1. Öffne die App-Adresse und klicke auf **Mit Google Workspace anmelden**. Alle Berechtigungen bestätigen.
2. **Einstellungen:** Firmendaten (rechtlicher Name, Adresse, NIP/USt-IdNr., KRS, Bank), Standard-MwSt., Texte, KI-Firmenprofil und Signatur eintragen.
3. **Einstellungen → Technische Angebote:** Tagessatz, PM-Aufschlag und das Leistungs- und Technologieprofil prüfen. Danach richtet die KI Lösungen und Aufwände aus.
4. **Leistungen:** Den Beispielkatalog anlegen und die Preise anpassen.
5. **Kontakte:** Eine CSV aus Sales Navigator oder Apollo importieren.
6. **KI-Agent:** Eine Kampagne anlegen und Kontakte hinzufügen.
   - Über **Vorschau** prüfen, wie die Mails klingen.
   - Für einen Test **Jetzt senden** an dich selbst schicken (dafür einen Kontakt mit deiner eigenen Adresse anlegen).
   - Danach **Starten**.

## Wichtig für den KI-Agenten

- **Recht:** In Deutschland (UWG § 7) und Polen ist E-Mail-Werbung ohne vorherige Einwilligung in der Regel auch an Firmen unzulässig. Die App lässt EU/DACH/UK-Kontakte deshalb nur mit dem Status „Einwilligung“ oder „Bestandskunde“ zu.
  - In den USA ist Kaltakquise per Mail mit Absenderangaben und Abmeldelink erlaubt (CAN-SPAM). Beides hängt der Agent an.
  - Das ist keine Rechtsberatung. Lass das Vorgehen im Zweifel kurz anwaltlich prüfen.
- **Zustellbarkeit:**
  - SPF, DKIM und DMARC für die Absender-Domain einrichten (Google Admin → Gmail → E-Mail authentifizieren).
  - Mit 10–20 Mails pro Tag anfangen und langsam steigern.
  - Für größere Kaltakquise lieber eine eigene Absender-Domain nutzen (z. B. `devunox-team.com`), damit die Hauptdomain geschützt bleibt.
- **Kosten:** Pro Mail fällt ein Claude-Aufruf an, mit Webrecherche etwas mehr. Bei 20 Mails am Tag sind das wenige Euro im Monat.

## Lokal entwickeln

```bash
npm install
npm run db:local            # lokale Datenbank anlegen
cp .dev.vars.example .dev.vars
npm run dev                 # http://localhost:8787 → /auth/dev-login (Login ohne Google)
```

Später neue Tabellen oder Spalten als `migrations/0002_….sql` anlegen und mit `npm run deploy` ausrollen. Das Skript spielt die Migrationen vor dem Deploy ein.

## Aufbau

```
src/worker/   API (Hono) – auth, crm, quotes, rfq (Excel→Angebot), work (Aufgaben, Projekte, Ablage), review (Webhook), campaigns, ai, google, pdf
src/ui/       Oberfläche (React + Vite)
migrations/   Datenbankschema (D1)
```
