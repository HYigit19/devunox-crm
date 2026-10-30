import { Hono } from 'hono';
import { AppEnv, Env, addDays, getSettings, nextNumber, round2, suggestTaxMode, todayIso, uid } from './util';
import { askClaude, parseJson } from './ai';
import { TechProposal, TechRequirement, packageEffort, renderTechPdf } from './techpdf';
import { computeTotals } from './quotes';

export const rfqRoutes = new Hono<AppEnv>();
export const techRoutes = new Hono<AppEnv>();

const MAX_INPUT = 150_000;

export type RfqCustomer = {
  company: { name: string; website?: string; country?: string; industry?: string; city?: string };
  contact?: { salutation?: string; first_name?: string; last_name?: string; email?: string; phone?: string; position?: string };
  project_title?: string;
  description?: string;
  language?: 'de' | 'en';
  requirements: { ref: string; title: string; description?: string; priority?: string | null; category?: string }[];
};

// ---------------------------------------------------------------- 1) Excel analysieren

rfqRoutes.post('/analyze', async (c) => {
  const { text, filename, hints } = await c.req.json<{ text: string; filename?: string; hints?: string }>();
  if (!text?.trim()) return c.json({ error: 'Die Datei enthält keine lesbaren Daten.' }, 400);
  const input = text.length > MAX_INPUT ? text.slice(0, MAX_INPUT) + '\n[… gekürzt]' : text;
  const out = await askClaude(c.env, {
    system: `Du analysierst Excel-Dateien mit Kundenanfragen bzw. Anforderungslisten für ein Software-Unternehmen (Websites, Web-Apps, Portale, Dashboards, KI-Automatisierungen).
Die Datei kann zwei Formen haben – erkenne selbst, welche vorliegt:
A) EIN Kunde/Projekt: Anforderungsliste, Lastenheft oder Ausschreibung – meist eine Anforderung pro Zeile, evtl. mit Kopfbereich zu Kunde/Projekt.
B) MEHRERE Kunden: jede Zeile (oder jeder Block / jedes Tabellenblatt) beschreibt einen Kunden mit Beschreibung und Wünschen in Freitext.

Für jeden Kunden extrahierst du:
- company: name, website, country (ISO-2), industry, city – nur was in der Datei steht. Fehlt der Name, nimm den Dateinamen ohne Endung.
- contact: salutation, first_name, last_name, email, phone, position – nur falls vorhanden.
- project_title: kurzer Projekttitel.
- description: Ausgangslage in 2–4 Sätzen, nur aus der Datei abgeleitet.
- language: "de" oder "en" – die Sprache, in der der Kunde schreibt.
- requirements: ALLE Anforderungen als einzelne, prüfbare Punkte: ref (vorhandene ID übernehmen, sonst A-01, A-02 …), title (kurz), description (vollständig, sinngemäß), priority ("muss"/"soll"/"kann" oder vorhandene Angabe, sonst null), category.
  Bei Form B zerlegst du den Freitext jedes Kunden in einzelne Anforderungen.
Erfinde keine Anforderungen und lasse keine weg. Überschriften- oder Leerzeilen ignorieren.
Antworte ausschließlich mit JSON: {"mode": "single"|"multi", "customers": [ … ], "notes": string (Auffälligkeiten, max. 2 Sätze, Deutsch)}`,
    prompt: `Dateiname: ${filename || 'unbekannt'}
${hints ? `Hinweise des Nutzers: ${hints}\n` : ''}
Inhalt (Tabellenblätter als TSV, Zeilennummern vorangestellt):
${input}`,
    maxTokens: 16000,
  });
  const data = parseJson<{ mode: string; customers: RfqCustomer[]; notes?: string }>(out);
  data.customers = (data.customers || []).filter((x) => x?.company?.name && Array.isArray(x.requirements));
  return c.json(data);
});

// ---------------------------------------------------------------- 2) Angebote erzeugen

type GenOptions = { language?: 'de' | 'en' | 'auto'; currency?: string; day_rate?: number; pm_pct?: number; hints?: string; source_file?: string };

async function generateTechProposal(env: Env, cu: RfqCustomer, lang: 'de' | 'en', hints?: string): Promise<TechProposal> {
  const s = await getSettings(env.DB);
  const out = await askClaude(env, {
    system: `Du bist Lösungsarchitekt bei ${s.company_name} und erstellst ein technisches Angebot.
Unser Profil: ${s.tech_profile}

Bewerte JEDE Anforderung (gleiche ref, gleiche Reihenfolge, keine auslassen):
- fit: "standard" = mit vorhandenen Bausteinen / Standardfunktionen abgedeckt; "config" = Anpassung/Konfiguration bestehender Komponenten oder Dienste; "custom" = individuelle Neuentwicklung.
- solution: 1–3 Sätze, konkret und technisch (womit und wie umgesetzt).
- effort_days: realistischer Aufwand in Personentagen (Schritte von 0,5), inkl. Entwicklung und Test dieser Anforderung.
- package: Zuordnung zu einem von 3–7 Arbeitspaketen (z. B. Konzeption & UX-Design, Frontend, Backend & Datenbank, Schnittstellen, KI-Funktionen, Test & Go-live).
Arbeitspakete dürfen extra_days für Aufwand ohne einzelne Anforderung haben (Setup, Design, Deployment, Schulung, Dokumentation).
Projektmanagement NICHT einrechnen – wird separat aufgeschlagen.
Sei ehrlich: Unklare Punkte als open_questions, Annahmen als assumptions, nicht Enthaltenes als exclusions. Keine erfundenen Referenzen oder Zertifikate.
Sprache: ${lang === 'en' ? 'Englisch' : 'Deutsch (Sie-Form)'}.

Antworte ausschließlich mit JSON:
{"title": string, "summary": string (Ausgangslage, 3–5 Sätze), "objectives": string[], "solution": string (Lösungsansatz, 1–2 Absätze), "architecture": string,
 "tech_stack": [{"area": string, "technology": string}],
 "packages": [{"name": string, "description": string, "extra_days": number}],
 "requirements": [{"ref": string, "title": string, "priority": string|null, "fit": "standard"|"config"|"custom", "solution": string, "effort_days": number, "package": string}],
 "phases": [{"name": string, "weeks": number, "deliverables": string}],
 "assumptions": string[], "exclusions": string[], "open_questions": string[],
 "offer_intro": string (2–3 Sätze Einleitung für das kaufmännische Angebot, ohne Anrede-Zeile)}`,
    prompt: `Kunde: ${JSON.stringify(cu.company)}
Projekt: ${cu.project_title || ''}
Ausgangslage laut Kunde: ${cu.description || ''}
${hints ? `Hinweise vom Vertrieb: ${hints}\n` : ''}
Anforderungen (JSON):
${JSON.stringify(cu.requirements)}`,
    maxTokens: 16000,
  });
  const p = parseJson<TechProposal>(out);
  p.language = lang;
  // Vollständigkeit sicherstellen: jede Anforderung genau einmal, in Originalreihenfolge
  const byRef = new Map((p.requirements || []).map((r) => [String(r.ref).trim(), r]));
  const missing: string[] = [];
  p.requirements = cu.requirements.map((orig) => {
    const r = byRef.get(String(orig.ref).trim());
    if (!r) missing.push(orig.ref);
    return {
      ref: orig.ref,
      title: r?.title || orig.title,
      description: orig.description,
      priority: orig.priority ?? r?.priority ?? null,
      fit: (['standard', 'config', 'custom'].includes(r?.fit as string) ? r!.fit : 'custom') as TechRequirement['fit'],
      solution: r?.solution || (lang === 'en' ? 'To be clarified in the kick-off.' : 'Wird im Kick-off geklärt.'),
      effort_days: Math.max(0, Math.round((Number(r?.effort_days) || 0) * 2) / 2),
      package: r?.package || p.packages?.[0]?.name || '',
    };
  });
  if (missing.length) (p.open_questions ||= []).push((lang === 'en' ? 'Effort not yet estimated for: ' : 'Aufwand noch nicht geschätzt für: ') + missing.join(', '));
  p.packages = (p.packages || []).map((x) => ({ ...x, extra_days: Math.max(0, Number(x.extra_days) || 0) }));
  return p;
}

/** Positionen des einfachen Angebots aus dem technischen Angebot ableiten. */
export function itemsFromProposal(p: TechProposal, dayRate: number, pmPct: number, taxRate: number, lang: 'de' | 'en') {
  const eff = packageEffort(p, pmPct);
  const unit = lang === 'en' ? 'Days' : 'PT';
  const items = eff.rows
    .filter((r) => r.days > 0)
    .map((r) => ({
      name: r.name,
      description: [r.description, r.refs.length ? (lang === 'en' ? `Requirements: ${r.refs.join(', ')}` : `Anforderungen: ${r.refs.join(', ')}`) : ''].filter(Boolean).join('\n'),
      qty: r.days,
      unit,
      unit_price: dayRate,
      discount_pct: 0,
      tax_rate: taxRate,
    }));
  if (eff.pm > 0)
    items.push({
      name: lang === 'en' ? 'Project management & quality assurance' : 'Projektmanagement & Qualitätssicherung',
      description: lang === 'en' ? `${pmPct} % of development effort – coordination, status meetings, testing, acceptance` : `${pmPct} % des Entwicklungsaufwands – Steuerung, Abstimmungen, Tests, Abnahme`,
      qty: eff.pm,
      unit,
      unit_price: dayRate,
      discount_pct: 0,
      tax_rate: taxRate,
    });
  return items;
}

async function upsertCustomer(env: Env, cu: RfqCustomer, userId: string) {
  const name = cu.company.name.trim();
  let company = await env.DB.prepare('SELECT * FROM companies WHERE LOWER(name) = LOWER(?)').bind(name).first<any>();
  if (!company) {
    const id = uid();
    await env.DB.prepare('INSERT INTO companies (id, name, website, industry, city, country, owner_id, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, name, cu.company.website || null, cu.company.industry || null, cu.company.city || null, (cu.company.country || '').toUpperCase().slice(0, 2) || null, userId, 'Excel-Anfrage')
      .run();
    company = await env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(id).first<any>();
  }
  let contact: any = null;
  const ct = cu.contact || {};
  if (ct.email) contact = await env.DB.prepare('SELECT * FROM contacts WHERE LOWER(email) = LOWER(?)').bind(ct.email).first<any>();
  if (!contact && (ct.last_name || ct.email)) {
    const id = uid();
    await env.DB.prepare(
      'INSERT INTO contacts (id, company_id, salutation, first_name, last_name, email, phone, position, language, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(id, company.id, ct.salutation || null, ct.first_name || null, ct.last_name || null, ct.email || null, ct.phone || null, ct.position || null, cu.language || 'de', userId)
      .run();
    contact = { id };
  }
  return { company, contactId: contact?.id || null };
}

function greeting(cu: RfqCustomer, lang: 'de' | 'en') {
  const c = cu.contact || {};
  if (lang === 'en') return c.last_name ? `Dear ${[c.first_name, c.last_name].filter(Boolean).join(' ')},` : 'Dear Sir or Madam,';
  if (c.last_name && /^(herr|frau)$/i.test(c.salutation || '')) return `Sehr ${/^frau$/i.test(c.salutation!) ? 'geehrte Frau' : 'geehrter Herr'} ${c.last_name},`;
  return 'Sehr geehrte Damen und Herren,';
}

rfqRoutes.post('/generate', async (c) => {
  const { customer: cu, options = {} } = await c.req.json<{ customer: RfqCustomer; options: GenOptions }>();
  if (!cu?.company?.name || !cu.requirements?.length) return c.json({ error: 'Kunde oder Anforderungen fehlen' }, 400);
  const s = await getSettings(c.env.DB);
  const user = c.get('user');
  const lang: 'de' | 'en' = options.language === 'de' || options.language === 'en' ? options.language : cu.language === 'en' ? 'en' : 'de';
  const dayRate = Number(options.day_rate) || Number(s.day_rate) || 960;
  const pmPct = options.pm_pct === undefined ? Number(s.pm_pct) || 0 : Number(options.pm_pct);
  const currency = options.currency || s.day_rate_currency || 'EUR';

  const proposal = await generateTechProposal(c.env, cu, lang, options.hints);
  const { company, contactId } = await upsertCustomer(c.env, cu, user.id);
  const taxMode = suggestTaxMode(s.company_country, company.country);
  const taxRate = taxMode === 'standard' ? Number(s.default_tax_rate) || 0 : 0;
  const items = itemsFromProposal(proposal, dayRate, pmPct, taxRate, lang);
  const totals = computeTotals(items, 0, taxMode);

  const issue = todayIso(c.env.TIMEZONE);
  const quoteId = uid();
  const dealId = uid();
  const number = await nextNumber(c.env.DB, 'quote', s.quote_prefix || 'AN', Number(issue.slice(0, 4)));
  const intro = `${greeting(cu, lang)}\n\n${proposal.offer_intro || (lang === 'en' ? 'Thank you for your enquiry. Please find our proposal below.' : 'vielen Dank für Ihre Anfrage. Gerne unterbreiten wir Ihnen folgendes Angebot:')}\n\n${
    lang === 'en' ? 'Details of the solution, the assessment of each requirement and the project plan are set out in the enclosed technical proposal.' : 'Details zur Lösung, die Bewertung jeder Anforderung und den Projektplan finden Sie im beiliegenden technischen Angebot.'
  }`;
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(`INSERT INTO deals (id, title, company_id, contact_id, stage, value, currency, probability, source, owner_id) VALUES (?, ?, ?, ?, 'proposal', ?, ?, 50, 'Excel-Anfrage', ?)`).bind(
      dealId, proposal.title || cu.project_title || 'Projekt', company.id, contactId, totals.net, currency, user.id,
    ),
    c.env.DB.prepare(
      `INSERT INTO quotes (id, number, status, title, company_id, contact_id, deal_id, language, currency, tax_mode, issue_date, valid_until, intro, outro, subtotal, tax_total, total, created_by)
       VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      quoteId, number, proposal.title || cu.project_title || null, company.id, contactId, dealId, lang, currency, taxMode, issue,
      addDays(issue, Number(s.quote_valid_days) || 30), intro, s[`quote_outro_${lang}`] || '', totals.subtotal, totals.tax_total, totals.total, user.id,
    ),
    ...items.map((it, i) =>
      c.env.DB.prepare('INSERT INTO quote_items (id, quote_id, pos, name, description, qty, unit, unit_price, discount_pct, tax_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)').bind(
        uid(), quoteId, i + 1, it.name, it.description, it.qty, it.unit, it.unit_price, it.tax_rate,
      ),
    ),
    c.env.DB.prepare('INSERT INTO tech_proposals (id, quote_id, source_file, data) VALUES (?, ?, ?, ?)').bind(uid(), quoteId, options.source_file || null, JSON.stringify({ ...proposal, pm_pct: pmPct, day_rate: dayRate })),
    c.env.DB.prepare(`INSERT INTO activities (id, type, subject, body, company_id, contact_id, deal_id, quote_id, done, created_by) VALUES (?, 'system', ?, ?, ?, ?, ?, ?, 1, ?)`).bind(
      uid(), `Angebot ${number} + technisches Angebot aus Excel erstellt`, `${cu.requirements.length} Anforderungen${options.source_file ? ` aus „${options.source_file}“` : ''}`, company.id, contactId, dealId, quoteId, user.id,
    ),
  ];
  await c.env.DB.batch(stmts);
  const eff = packageEffort(proposal, pmPct);
  return c.json({ quote_id: quoteId, number, company: company.name, total: totals.total, net: totals.net, currency, days: eff.total, requirements: proposal.requirements.length });
});

// ---------------------------------------------------------------- 3) Technisches Angebot ansehen/bearbeiten

export async function loadTech(env: Env, quoteId: string) {
  const row = await env.DB.prepare('SELECT * FROM tech_proposals WHERE quote_id = ?').bind(quoteId).first<any>();
  return row ? { ...row, data: JSON.parse(row.data) as TechProposal & { pm_pct: number; day_rate: number } } : null;
}

export async function buildTechPdf(env: Env, quoteId: string) {
  const tp = await loadTech(env, quoteId);
  if (!tp) return null;
  const q = await env.DB.prepare('SELECT q.*, co.name AS company_name FROM quotes q LEFT JOIN companies co ON co.id = q.company_id WHERE q.id = ?').bind(quoteId).first<any>();
  const s = await getSettings(env.DB);
  const lang: 'de' | 'en' = q.language === 'en' ? 'en' : 'de';
  const bytes = await renderTechPdf({ p: tp.data, lang, quoteNumber: q.number, date: q.issue_date, customer: q.company_name || '', seller: s, pmPct: tp.data.pm_pct ?? Number(s.pm_pct) });
  const safe = (q.company_name || 'Kunde').replace(/[^\w\-äöüÄÖÜß ]+/g, '').trim().replace(/\s+/g, '_');
  return { bytes, filename: `${lang === 'en' ? 'Technical_Proposal' : 'Technisches_Angebot'}_${q.number}_${safe}.pdf` };
}

techRoutes.get('/:id/tech', async (c) => {
  const tp = await loadTech(c.env, c.req.param('id'));
  return tp ? c.json(tp) : c.json(null);
});

techRoutes.put('/:id/tech', async (c) => {
  const id = c.req.param('id');
  const { data, recalc } = await c.req.json<{ data: any; recalc?: boolean }>();
  const tp = await loadTech(c.env, id);
  if (!tp) return c.json({ error: 'Kein technisches Angebot vorhanden' }, 404);
  const merged = { ...tp.data, ...data };
  await c.env.DB.prepare(`UPDATE tech_proposals SET data = ?, updated_at = datetime('now') WHERE quote_id = ?`).bind(JSON.stringify(merged), id).run();
  if (recalc) {
    const q = await c.env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first<any>();
    const s = await getSettings(c.env.DB);
    const lang: 'de' | 'en' = q.language === 'en' ? 'en' : 'de';
    const taxRate = q.tax_mode === 'standard' ? Number(s.default_tax_rate) || 0 : 0;
    const items = itemsFromProposal(merged, Number(merged.day_rate) || Number(s.day_rate), Number(merged.pm_pct ?? s.pm_pct), taxRate, lang);
    const t = computeTotals(items, q.discount_pct, q.tax_mode);
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM quote_items WHERE quote_id = ?').bind(id),
      ...items.map((it, i) =>
        c.env.DB.prepare('INSERT INTO quote_items (id, quote_id, pos, name, description, qty, unit, unit_price, discount_pct, tax_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)').bind(
          uid(), id, i + 1, it.name, it.description, it.qty, it.unit, it.unit_price, it.tax_rate,
        ),
      ),
      c.env.DB.prepare(`UPDATE quotes SET subtotal = ?, tax_total = ?, total = ?, updated_at = datetime('now') WHERE id = ?`).bind(t.subtotal, t.tax_total, t.total, id),
      ...(q.deal_id ? [c.env.DB.prepare('UPDATE deals SET value = ? WHERE id = ?').bind(round2(t.net), q.deal_id)] : []),
    ]);
  }
  return c.json(await loadTech(c.env, id));
});

techRoutes.get('/:id/tech/pdf', async (c) => {
  const r = await buildTechPdf(c.env, c.req.param('id'));
  if (!r) return c.json({ error: 'Kein technisches Angebot' }, 404);
  return new Response(r.bytes as unknown as BodyInit, {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `${c.req.query('download') ? 'attachment' : 'inline'}; filename="${r.filename}"` },
  });
});
