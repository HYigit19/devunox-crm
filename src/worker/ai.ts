import { Env, CONSENT_COUNTRIES, getSettings, hmac, log, uid } from './util';
import { getAccessToken, sendMail, findReply, textToHtml } from './google';



type ClaudeOpts = { system: string; prompt: string; maxTokens?: number; webSearch?: number };

export async function askClaude(env: Env, o: ClaudeOpts): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY ist nicht gesetzt.');
  const body: any = {
    model: env.AI_MODEL || 'claude-sonnet-5-5',
    max_tokens: o.maxTokens ?? 1500,
    system: o.system,
    messages: [{ role: 'user', content: o.prompt }],
  };
  if (o.webSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: o.webSearch }];
  const res = await fetch(`${env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as any;
  if (!res.ok) throw new Error('KI-Fehler: ' + (data?.error?.message || res.status));
  return (data.content || [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')
    .trim();
}

export function parseJson<T = any>(s: string): T {
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('KI-Antwort enthielt kein JSON');
  return JSON.parse(s.slice(start, end + 1));
}

// ---------------------------------------------------------------- Hilfsfunktionen für die App

export async function researchCompany(env: Env, company: { name: string; website?: string | null; country?: string | null }) {
  return askClaude(env, {
    system:
      'Du bist ein B2B-Rechercheassistent für ein SAP-Beratungshaus. Recherchiere knapp und faktenbasiert. Erfinde nichts; wenn etwas unklar ist, schreibe "unbekannt". Antworte auf Deutsch in kurzen Stichpunkten.',
    prompt: `Recherchiere das Unternehmen "${company.name}"${company.website ? ` (Website: ${company.website})` : ''}${company.country ? `, Land: ${company.country}` : ''}.
Liefere:
- Branche & Geschäftsmodell (1–2 Sätze)
- Größe (Mitarbeiter/Umsatz, falls öffentlich)
- Standorte
- Hinweise auf SAP-Nutzung (SAP ECC / S/4HANA, Qualitätsmanagement, Stellenanzeigen mit SAP-Bezug)
- Aktuelle Anlässe (Neuigkeiten, Wachstum, Zertifizierungen, Rückrufe, neue Werke)
- Möglicher Gesprächsaufhänger für SAP QM / S/4HANA-Beratung
- Quellen (URLs)`,
    maxTokens: 1500,
    webSearch: 4,
  });
}

export async function draftQuote(env: Env, input: { request: string; products: any[]; language: string; currency: string; customer?: string }) {
  const s = await getSettings(env.DB);
  const text = await askClaude(env, {
    system: `Du erstellst Angebotsentwürfe für ${s.company_name}. Profil: ${s.ai_company_profile}
Antworte ausschließlich mit JSON im Format:
{"language": "de"|"en", "title": string, "intro": string, "outro": string, "items": [{"name": string, "description": string, "qty": number, "unit": string, "unit_price": number, "product_id": string|null}]}
Regeln: Bestimme "language" aus der Sprache der Projektbeschreibung (Englisch geschrieben → "en", Deutsch → "de") und schreibe ALLE Texte in dieser Sprache. Nutze wenn passend Artikel aus dem Katalog (product_id + Preis übernehmen). Preise in ${input.currency}.
Schreibe "SAP QM" immer ohne Bindestrich. Beschreibungen konkret und knapp (Leistungsumfang, Ergebnisse). Keine erfundenen Rabatte.`,
    prompt: `Kunde: ${input.customer || 'unbekannt'}
Anfrage / Notizen: ${input.request}

Artikelkatalog (JSON): ${JSON.stringify(input.products.map((p) => ({ id: p.id, name: p.name, description: p.description, unit: p.unit, price: p.price, currency: p.currency })))}`,
    maxTokens: 2500,
  });
  return parseJson(text);
}

export async function draftEmail(env: Env, input: { contact: any; company: any; purpose: string; language: string; quote?: any }) {
  const s = await getSettings(env.DB);
  const text = await askClaude(env, {
    system: `Du schreibst geschäftliche E-Mails im Namen von ${s.company_name}. Profil: ${s.ai_company_profile}
Antworte nur mit JSON: {"subject": string, "body": string}. Der body ist reiner Text ohne Signatur (die wird automatisch angehängt).
Sprache: ${input.language === 'en' ? 'Englisch' : 'Deutsch (Sie-Form)'}. Kurz, konkret, keine Floskeln, keine erfundenen Fakten.`,
    prompt: `Empfänger: ${JSON.stringify(slimContact(input.contact, input.company))}
${input.quote ? `Bezug: Angebot ${input.quote.number} "${input.quote.title || ''}" über ${input.quote.total} ${input.quote.currency}` : ''}
Anliegen: ${input.purpose}`,
    maxTokens: 1200,
  });
  return parseJson<{ subject: string; body: string }>(text);
}

function slimContact(contact: any, company: any) {
  return {
    anrede: contact?.salutation,
    vorname: contact?.first_name,
    nachname: contact?.last_name,
    position: contact?.position,
    firma: company?.name,
    branche: company?.industry,
    land: company?.country || contact?.country,
    website: company?.website,
    notizen: [contact?.notes, company?.notes].filter(Boolean).join(' | ').slice(0, 1500),
    recherche: company?.research?.slice(0, 2500),
  };
}

// ---------------------------------------------------------------- KI-Agent (Kampagnen)

export type Step = { delay_days: number; instruction: string };

export function contactLanguage(campaignLang: string, contact: any, company: any): 'de' | 'en' {
  if (campaignLang === 'de' || campaignLang === 'en') return campaignLang;
  if (contact?.language === 'en' || contact?.language === 'de') return contact.language;
  const c = (company?.country || contact?.country || '').toUpperCase();
  return ['DE', 'AT', 'CH', 'LI'].includes(c) ? 'de' : 'en';
}

/** Darf dieser Kontakt in dieser Kampagne angeschrieben werden? */
export function eligibility(campaign: any, contact: any, company: any): string | null {
  if (!contact?.email) return 'keine E-Mail-Adresse';
  if (contact.consent === 'opt_out') return 'hat sich abgemeldet';
  const country = (company?.country || contact?.country || '').toUpperCase();
  if (campaign.require_consent) {
    const needsConsent = !country || CONSENT_COUNTRIES.includes(country);
    if (needsConsent && !['consent', 'customer'].includes(contact.consent))
      return country ? `keine Einwilligung (Land ${country} verlangt Einwilligung)` : 'Land unbekannt und keine Einwilligung';
  }
  return null;
}

export async function generateCampaignMail(env: Env, campaign: any, contact: any, company: any, stepIdx: number, history: { subject: string; body: string }[]) {
  const s = await getSettings(env.DB);
  const steps: Step[] = JSON.parse(campaign.steps);
  const step = steps[stepIdx];
  const lang = contactLanguage(campaign.language, contact, company);
  const research = campaign.research && !company?.research && company?.name && stepIdx === 0;
  const text = await askClaude(env, {
    system: `Du bist ein erfahrener B2B-Vertriebsmitarbeiter von ${s.company_name} und schreibst eine persönliche E-Mail an genau eine Person.
Über uns: ${s.ai_company_profile}
Kampagnenziel: ${campaign.goal || 'Erstgespräch vereinbaren'}
Angebot: ${campaign.offer || ''}
Zielgruppe: ${campaign.audience || ''}
Tonalität: ${campaign.tone || 'professionell, direkt, freundlich'}
${campaign.booking_link ? `Terminbuchungslink (darf genau einmal genannt werden): ${campaign.booking_link}` : ''}

Regeln:
- Sprache: ${lang === 'de' ? 'Deutsch, Sie-Form, korrekte Anrede (z. B. "Guten Tag Herr Müller,")' : 'English, natural business tone ("Hi Sarah,")'}.
- Maximal ${stepIdx === 0 ? 130 : 90} Wörter. Reiner Text, keine Markdown-Formatierung, keine Aufzählungszeichen.
- Erfinde keine Fakten über den Empfänger, keine Referenzkunden, keine Zahlen, die nicht oben stehen. Persönlicher Bezug nur aus den gegebenen Daten oder der Recherche.
- Eine klare, leicht zu beantwortende Frage als Abschluss.
- Keine Signatur, kein Abmeldehinweis – beides wird automatisch angehängt.
- Schreibe "SAP QM" immer ohne Bindestrich.
- Betreff: kurz (max. 6 Wörter), kein Clickbait, keine Großbuchstaben-Wörter.${stepIdx > 0 ? '\n- Dies ist ein Follow-up im selben E-Mail-Verlauf; wiederhole nicht die erste Mail, beziehe dich kurz darauf.' : ''}
Antworte zum Schluss ausschließlich mit JSON: {"subject": string, "body": string}`,
    prompt: `Schritt ${stepIdx + 1} von ${steps.length}: ${step.instruction}

Empfänger: ${JSON.stringify(slimContact(contact, company))}
${history.length ? `Bisher gesendet:\n${history.map((h, i) => `--- Mail ${i + 1}: ${h.subject}\n${h.body}`).join('\n')}` : ''}
${research ? 'Recherchiere vorher kurz (Website/News) für einen konkreten, zutreffenden Aufhänger.' : ''}`,
    maxTokens: 2000,
    webSearch: research ? 3 : 0,
  });
  const out = parseJson<{ subject: string; body: string }>(text);
  return { ...out, language: lang };
}

export async function classifyReply(env: Env, text: string) {
  try {
    const out = await askClaude(env, {
      system:
        'Klassifiziere die Antwort auf eine Vertriebs-E-Mail. Antworte nur mit JSON: {"category": "interessiert"|"spaeter"|"kein_interesse"|"abmelden"|"abwesend"|"falsche_person"|"sonstiges", "summary": string (max 25 Wörter, Deutsch)}',
      prompt: text.slice(0, 3000),
      maxTokens: 300,
    });
    return parseJson<{ category: string; summary: string }>(out);
  } catch {
    return { category: 'sonstiges', summary: text.slice(0, 140) };
  }
}

export async function unsubscribeUrl(env: Env, contactId: string) {
  const base = (env.APP_URL || (await getSettings(env.DB)).app_url || '').replace(/\/$/, '');
  return `${base}/u/${contactId}.${await hmac(env.ENCRYPTION_KEY, contactId)}`;
}

export function footer(lang: 'de' | 'en', signature: string, unsub: string) {
  return lang === 'de'
    ? `\n\n${signature}\n\n—\nSie möchten keine weiteren Nachrichten von uns? Eine kurze Antwort genügt oder hier abmelden: ${unsub}`
    : `\n\n${signature}\n\n—\nPrefer not to hear from us again? Just reply, or unsubscribe here: ${unsub}`;
}

function inSendWindow(s: Record<string, string>, tz: string): boolean {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(new Date());
  const wd = parts.find((p) => p.type === 'weekday')!.value;
  const hour = Number(parts.find((p) => p.type === 'hour')!.value) % 24;
  const dayNum = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[wd as 'Mon']!;
  const days = (s.send_days || '1,2,3,4,5').split(',').map(Number);
  return days.includes(dayNum) && hour >= Number(s.send_hour_from || 8) && hour < Number(s.send_hour_to || 17);
}

/** Nächster Versandzeitpunkt: + Tage, Wochenenden überspringen, leicht gestreut. */
export function nextSendAt(days: number): string {
  const d = new Date(Date.now() + days * 86400_000);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCMinutes(d.getUTCMinutes() + Math.floor(Math.random() * 90));
  return d.toISOString();
}

/** Prüft Antworten auf laufende Kampagnen. */
async function checkReplies(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT e.*, c.email, c.first_name, c.last_name, c.company_id, k.owner_id, k.name AS campaign_name
     FROM enrollments e JOIN contacts c ON c.id = e.contact_id JOIN campaigns k ON k.id = e.campaign_id
     WHERE e.status = 'active' AND e.gmail_thread_id IS NOT NULL AND e.last_sent_at > datetime('now', '-30 days')
     LIMIT 60`,
  ).all<any>();
  const tokens = new Map<string, string>();
  for (const e of results) {
    try {
      if (!tokens.has(e.owner_id)) tokens.set(e.owner_id, await getAccessToken(env, e.owner_id));
      const reply = await findReply(tokens.get(e.owner_id)!, e.gmail_thread_id, e.email, new Date(e.last_sent_at.replace(' ', 'T') + 'Z').getTime());
      if (!reply) continue;
      if (reply.bounce) {
        await env.DB.prepare(`UPDATE enrollments SET status = 'error', error = ? WHERE id = ?`).bind('Unzustellbar (Bounce): ' + reply.snippet.slice(0, 200), e.id).run();
        await log(env.DB, `Unzustellbar: ${e.email}`, 'warn', e.campaign_id);
        continue;
      }
      const cls = await classifyReply(env, reply.text || reply.snippet);
      const optOut = cls.category === 'abmelden';
      const away = cls.category === 'abwesend';
      if (away) continue; // Abwesenheitsnotiz: Sequenz läuft weiter
      await env.DB.batch([
        env.DB.prepare('UPDATE enrollments SET status = ?, reply_class = ?, reply_snippet = ? WHERE id = ?').bind(
          optOut ? 'opted_out' : 'replied',
          cls.category,
          (reply.snippet || '').slice(0, 500),
          e.id,
        ),
        env.DB.prepare(
          `INSERT INTO tasks (id, title, description, status, priority, contact_id, company_id, source, due_at, unread, created_by, assignee_id)
           VALUES (?, ?, ?, 'todo', ?, ?, ?, 'agent', datetime('now'), 1, ?, ?)`,
        ).bind(
          uid(),
          `Antwort von ${[e.first_name, e.last_name].filter(Boolean).join(' ')} (${cls.category.replace('_', ' ')})`,
          `Kampagne: ${e.campaign_name}\n\n${cls.summary}\n\n${reply.text.slice(0, 1500)}`,
          cls.category === 'interessiert' ? 'high' : 'medium',
          e.contact_id,
          e.company_id,
          e.owner_id,
          e.owner_id,
        ),
        ...(optOut ? [env.DB.prepare(`UPDATE contacts SET consent = 'opt_out', consent_note = 'Per Antwort abgemeldet' WHERE id = ?`).bind(e.contact_id)] : []),
      ]);
      if (cls.category === 'interessiert') {
        const deal = await env.DB.prepare(`SELECT id FROM deals WHERE contact_id = ? AND stage NOT IN ('won','lost')`).bind(e.contact_id).first();
        if (!deal)
          await env.DB.prepare(
            `INSERT INTO deals (id, title, company_id, contact_id, stage, probability, source, owner_id) VALUES (?, ?, ?, ?, 'qualified', 30, ?, ?)`,
          )
            .bind(uid(), `Lead aus Kampagne: ${e.campaign_name}`, e.company_id, e.contact_id, 'KI-Agent', e.owner_id)
            .run();
      }
      await log(env.DB, `Antwort erkannt (${cls.category}) von ${e.email}`, 'info', e.campaign_id);
    } catch (err: any) {
      await log(env.DB, `Antwortprüfung fehlgeschlagen für ${e.email}: ${err.message}`, 'warn', e.campaign_id);
    }
  }
}

/** Sendet eine Kampagnen-Mail für eine Einschreibung. */
export async function sendEnrollmentStep(env: Env, enrollmentId: string, opts: { ignoreLimits?: boolean } = {}) {
  const e = await env.DB.prepare('SELECT * FROM enrollments WHERE id = ?').bind(enrollmentId).first<any>();
  if (!e || e.status !== 'active') return { skipped: 'nicht aktiv' };
  const campaign = await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(e.campaign_id).first<any>();
  const contact = await env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(e.contact_id).first<any>();
  const company = contact?.company_id ? await env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(contact.company_id).first<any>() : null;
  const why = eligibility(campaign, contact, company);
  if (why) {
    await env.DB.prepare(`UPDATE enrollments SET status = ?, error = ? WHERE id = ?`).bind(contact?.consent === 'opt_out' ? 'opted_out' : 'stopped', why, e.id).run();
    return { skipped: why };
  }
  const steps: Step[] = JSON.parse(campaign.steps);
  const { results: history } = await env.DB.prepare('SELECT subject, body FROM campaign_messages WHERE enrollment_id = ? ORDER BY step').bind(e.id).all<any>();
  const s = await getSettings(env.DB);

  const mail = await generateCampaignMail(env, campaign, contact, company, e.step, history);
  const unsub = await unsubscribeUrl(env, contact.id);
  const body = mail.body.trim() + footer(mail.language, s.ai_signature, unsub);
  const subject = e.step > 0 && e.first_subject ? (/^re:/i.test(e.first_subject) ? e.first_subject : `Re: ${e.first_subject}`) : mail.subject;

  const owner = await env.DB.prepare('SELECT COALESCE(google_email, email) AS email, name FROM users WHERE id = ?').bind(campaign.owner_id).first<any>();
  const token = await getAccessToken(env, campaign.owner_id);
  const sent = await sendMail(token, {
    from: owner.email,
    fromName: owner.name || s.company_name,
    to: contact.email,
    subject,
    text: body,
    html: textToHtml(body),
    threadId: e.step > 0 ? e.gmail_thread_id : undefined,
    inReplyTo: e.step > 0 ? e.last_message_id : undefined,
    headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  });

  const nextStep = e.step + 1;
  const done = nextStep >= steps.length;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO campaign_messages (id, enrollment_id, campaign_id, contact_id, step, subject, body, gmail_message_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(
      uid(), e.id, campaign.id, contact.id, e.step, subject, mail.body, sent.id,
    ),
    env.DB.prepare(
      `UPDATE enrollments SET step = ?, status = ?, next_send_at = ?, gmail_thread_id = ?, last_message_id = COALESCE(?, last_message_id),
       first_subject = COALESCE(first_subject, ?), last_sent_at = datetime('now'), fail_count = 0, error = NULL WHERE id = ?`,
    ).bind(nextStep, done ? 'completed' : 'active', done ? null : nextSendAt(steps[nextStep].delay_days), sent.threadId, sent.messageIdHeader || null, subject, e.id),
    env.DB.prepare(
      `INSERT INTO activities (id, type, subject, body, contact_id, company_id, done, gmail_thread_id, created_by) VALUES (?, 'agent', ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(uid(), `KI-Agent: ${subject}`, `Kampagne „${campaign.name}“, Schritt ${e.step + 1}\n\n${mail.body}`, contact.id, contact.company_id, sent.threadId, campaign.owner_id),
  ]);
  // Recherche-Ergebnis nicht verloren gehen lassen: nichts weiter nötig, Mail ist protokolliert
  return { sent: true, subject };
}

/** Wird vom Cron (alle 15 Min.) aufgerufen. */
export async function runAgent(env: Env) {
  await checkReplies(env);
  const s = await getSettings(env.DB);
  const tz = env.TIMEZONE || 'Europe/Berlin';
  if (!inSendWindow(s, tz)) return;

  const { results: campaigns } = await env.DB.prepare(`SELECT * FROM campaigns WHERE status = 'active'`).all<any>();
  let budget = 12; // max. Mails pro Lauf über alle Kampagnen
  for (const k of campaigns) {
    if (budget <= 0) break;
    const sentToday = await env.DB.prepare(`SELECT COUNT(*) AS n FROM campaign_messages WHERE campaign_id = ? AND sent_at >= datetime('now', 'start of day')`)
      .bind(k.id)
      .first<{ n: number }>();
    const left = Math.min((k.daily_limit || 20) - (sentToday?.n || 0), Math.ceil((k.daily_limit || 20) / 8), budget);
    if (left <= 0) continue;
    const { results: due } = await env.DB.prepare(
      `SELECT id FROM enrollments WHERE campaign_id = ? AND status = 'active' AND (next_send_at IS NULL OR next_send_at <= ?) ORDER BY step DESC, created_at LIMIT ?`,
    )
      .bind(k.id, new Date().toISOString(), left)
      .all<{ id: string }>();
    for (const d of due) {
      try {
        const r = await sendEnrollmentStep(env, d.id);
        if ((r as any).sent) budget--;
      } catch (err: any) {
        await env.DB.prepare(
          `UPDATE enrollments SET fail_count = fail_count + 1, error = ?, status = CASE WHEN fail_count >= 2 THEN 'error' ELSE status END,
           next_send_at = ? WHERE id = ?`,
        )
          .bind(String(err.message).slice(0, 500), new Date(Date.now() + 3600_000).toISOString(), d.id)
          .run();
        await log(env.DB, `Versand fehlgeschlagen: ${err.message}`, 'error', k.id);
      }
    }
    // Kampagne fertig?
    const open = await env.DB.prepare(`SELECT COUNT(*) AS n FROM enrollments WHERE campaign_id = ? AND status = 'active'`).bind(k.id).first<{ n: number }>();
    const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM enrollments WHERE campaign_id = ?`).bind(k.id).first<{ n: number }>();
    if (total!.n > 0 && open!.n === 0) await env.DB.prepare(`UPDATE campaigns SET status = 'done' WHERE id = ?`).bind(k.id).run();
  }
}
