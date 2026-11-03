import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { Field, PageHead, Spinner, useAction, useLoad } from '../components';
import { PasswordForm, type Me } from '../main';
import { TeamCard } from './Cockpit';

const DAYS = [['1', 'Mo'], ['2', 'Di'], ['3', 'Mi'], ['4', 'Do'], ['5', 'Fr'], ['6', 'Sa'], ['7', 'So']];

export function Settings({ me }: { me: Me }) {
  const [s] = useLoad<Record<string, string>>('/settings');
  const [v, setV] = useState<Record<string, string> | null>(null);
  const [log] = useLoad<any[]>('/agent-log');
  const { busy, run } = useAction();
  useEffect(() => { if (s) setV(s); }, [s]);
  if (!v) return <Spinner />;
  const f = (k: string, label: string, opts: { area?: boolean; span?: number; hint?: string; ph?: string } = {}) => (
    <Field label={label} span={opts.span} hint={opts.hint}>
      {opts.area ? <textarea rows={4} value={v[k] || ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} /> : <input value={v[k] || ''} placeholder={opts.ph} onChange={(e) => setV({ ...v, [k]: e.target.value })} />}
    </Field>
  );
  const save = () => run('s', async () => setV(await api.put('/settings', v)), 'Einstellungen gespeichert');
  const days = (v.send_days || '').split(',').filter(Boolean);
  const scopes = me.scopes || '';
  const has = (x: string) => scopes.includes(x);

  return (
    <>
      <PageHead title="Einstellungen" actions={me.role === 'member' ? <span className="badge grey">Nur Admins können Einstellungen ändern</span> : <button className="btn primary" disabled={!!busy} onClick={save}>Speichern</button>} />
      <div className="grid side">
        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Firmendaten (Briefkopf, Angebots-PDF, Stempel)</h2><a className="btn sm ghost" href="#/pdf">Unterschrift & Stempel →</a></div>
            <div className="form c3">
              {f('company_name', 'Firmenname (Logo-Text)')}
              {f('company_legal', 'Rechtlicher Name', { span: 2, ph: 'Devunox Solutions sp. z o.o.' })}
              {f('company_street', 'Straße', { span: 2 })}
              {f('company_zip', 'PLZ')}
              {f('company_city', 'Ort')}
              {f('company_country', 'Land (ISO)', { hint: 'bestimmt Steuer-Vorschlag' })}
              {f('company_vat_id', 'USt-IdNr. / NIP')}
              {f('company_register', 'Register (KRS / HRB)')}
              {f('company_managing_director', 'Geschäftsführer', { span: 2 })}
              {f('company_email', 'E-Mail')}
              {f('company_phone', 'Telefon')}
              {f('company_website', 'Website')}
              {f('bank_name', 'Bank')}
              {f('bank_iban', 'IBAN')}
              {f('bank_bic', 'BIC')}
            </div>
          </div>
          <div className="card">
            <h2 style={{ marginBottom: 14 }}>Angebote</h2>
            <div className="form c3">
              {f('quote_prefix', 'Nummernkreis-Präfix', { hint: 'z. B. AN → AN-2026-0001' })}
              {f('quote_valid_days', 'Gültigkeit (Tage)')}
              {f('default_tax_rate', 'Standard-MwSt. %', { hint: 'Polen 23, Deutschland 19' })}
              {f('quote_intro_de', 'Einleitung Deutsch', { area: true, span: 3 })}
              {f('quote_outro_de', 'Schlusstext Deutsch', { area: true, span: 3 })}
              {f('quote_intro_en', 'Einleitung Englisch', { area: true, span: 3 })}
              {f('quote_outro_en', 'Schlusstext Englisch', { area: true, span: 3 })}
              {f('note_none_de', 'Steuerhinweis „Ohne MwSt.“ (DE)', { span: 3 })}
              {f('note_none_en', 'Steuerhinweis „Ohne MwSt.“ (EN)', { span: 3 })}
            </div>
          </div>
          <div className="card">
            <h2 style={{ marginBottom: 14 }}>Technische Angebote (Excel → Angebot)</h2>
            <div className="form c3">
              {f('day_rate', 'Tagessatz', { hint: 'Standard für neue Angebote' })}
              {f('day_rate_currency', 'Währung')}
              {f('pm_pct', 'PM & QS Aufschlag %')}
              {f('tech_profile', 'Leistungs- und Technologieprofil für die KI', { area: true, span: 3, hint: 'Was wir entwickeln und womit. Die KI richtet Lösungen und Aufwände danach aus.' })}
            </div>
          </div>
          <div className="card">
            <h2 style={{ marginBottom: 14 }}>KI-Agent</h2>
            <div className="form">
              {f('ai_company_profile', 'Firmenprofil für die KI', { area: true, span: 2, hint: 'Wer wir sind, was wir anbieten, Alleinstellungsmerkmale. Der Agent erfindet nichts darüber hinaus.' })}
              {f('ai_signature', 'E-Mail-Signatur', { area: true, span: 2 })}
              <Field label="Versandtage" span={2}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {DAYS.map(([n, l]) => (
                    <label key={n} className="check">
                      <input type="checkbox" checked={days.includes(n)} onChange={(e) => setV({ ...v, send_days: (e.target.checked ? [...days, n] : days.filter((d) => d !== n)).sort().join(',') })} /> {l}
                    </label>
                  ))}
                </div>
              </Field>
              {f('send_hour_from', 'Versand ab (Uhr)')}
              {f('send_hour_to', 'Versand bis (Uhr)')}
            </div>
          </div>
          <div className="card">
            <h2 style={{ marginBottom: 14 }}>Kundenmanagement</h2>
            <div className="form c3">
              {f('internal_hour_cost', 'Interne Kosten je Stunde (€)', { hint: 'für die Marge je Kunde im Cockpit' })}
              {f('health_contact_days', 'Hinweis ohne Kontakt nach (Tagen)')}
              <Field label="Monatsberichte">
                <select value={v.report_auto || '1'} onChange={(e) => setV({ ...v, report_auto: e.target.value })}>
                  <option value="1">am 1. automatisch als Entwurf</option>
                  <option value="0">nur manuell</option>
                </select>
              </Field>
            </div>
          </div>
        </div>
        <div className="stack">
          <TeamCard />
          <div className="card">
            <h2 style={{ marginBottom: 12 }}>Google / Gmail</h2>
            <dl className="dl">
              <dt>Login</dt><dd>{me.email}</dd>
              <dt>Gmail-Konto</dt><dd>{me.google_email ? <b>{me.google_email}</b> : 'nicht verbunden'}</dd>
              <dt>Gmail senden</dt><dd>{has('gmail.send') ? '✓' : '–'}</dd>
              <dt>Gmail lesen</dt><dd>{has('gmail.readonly') ? '✓' : '–'}</dd>
              <dt>Kalender</dt><dd>{has('calendar.events') ? '✓' : '–'}</dd>
              <dt>Drive</dt><dd>{has('drive.file') ? '✓' : '–'}{v.drive_folder_id && <> · <a href={`https://drive.google.com/drive/folders/${v.drive_folder_id}`} target="_blank" rel="noreferrer">Ordner</a></>}</dd>
            </dl>
            <p className="muted" style={{ fontSize: 12.5, margin: '10px 0 0' }}>Mails an Kunden, Kalender und Drive laufen über dieses Gmail-Konto. Es kann ein anderes Konto als dein Login sein.</p>
            <a className="btn sm" style={{ marginTop: 12 }} href="/auth/login?connect=1">{me.google ? 'Anderes Gmail-Konto verbinden' : 'Gmail-Konto verbinden'}</a>
          </div>
          {me.has_password && (
            <div className="card">
              <h2 style={{ marginBottom: 12 }}>Passwort ändern</h2>
              <PasswordForm needCurrent onDone={() => alert('Passwort geändert. Andere Sitzungen wurden abgemeldet.')} />
            </div>
          )}
          <div className="card">
            <h2 style={{ marginBottom: 12 }}>Kundenportal</h2>
            <dl className="dl">
              <dt>Status</dt><dd>{(me as any).portal ? '✓ im CRM eingebaut' : me.review ? '✓ verbunden (separate App)' : 'nicht eingerichtet'}</dd>
              <dt>Adresse</dt><dd>{me.review_url ? <a href={me.review_url} target="_blank" rel="noreferrer">{me.review_url.replace('https://', '')}</a> : '–'}</dd>
            </dl>
            <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>Kunden melden sich mit eigenem Login an und geben Feedback direkt in ihrer App. Jeder Punkt wird automatisch zur Aufgabe beim Kunden; Statuswechsel gehen zurück ins Portal. Zugänge verwaltest du auf der Firmenseite unter „Kundenportal“.</p>
          </div>
          <div className="card">
            <h2 style={{ marginBottom: 12 }}>KI</h2>
            <dl className="dl">
              <dt>Status</dt><dd>{me.ai ? '✓ aktiv' : 'ANTHROPIC_API_KEY fehlt'}</dd>
              <dt>Modell</dt><dd>{me.model}</dd>
            </dl>
          </div>
          <div className="card">
            <h2 style={{ marginBottom: 12 }}>Agent-Protokoll</h2>
            {!log ? <Spinner /> : log.length === 0 ? <div className="muted">Noch keine Einträge.</div> : log.slice(0, 25).map((l) => (
              <div key={l.id} style={{ fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
                <span className={`badge ${l.level === 'error' ? 'red' : l.level === 'warn' ? 'amber' : 'grey'}`}>{l.level}</span> {l.message}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
