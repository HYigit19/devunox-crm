import React, { useMemo, useState } from 'react';
import { api } from '../api';
import { Badge, CONSENT, COUNTRIES, ENR_STATUS, Empty, Field, Modal, PageHead, QUOTE_STATUS, SelectCompany, Spinner, confirmDel, fmtDate, fmtMoney, fullName, go, stageLabel, useAction, useForm, useLoad, useToast } from '../components';
import { Activities, ComposeMail, GmailHistory } from './shared';
import type { Me } from '../main';

export function ContactForm({ initial, onClose, onSaved }: { initial?: any; onClose: () => void; onSaved: (c: any) => void }) {
  const { v, set, setV } = useForm({
    company_id: '', salutation: '', first_name: '', last_name: '', email: '', phone: '', position: '', linkedin: '', language: 'de', country: '',
    consent: 'none', consent_note: '', tags: '', notes: '', ...(initial || {}),
  });
  const { busy, run } = useAction();
  const save = () =>
    run('s', async () => {
      const r = initial?.id ? await api.put(`/contacts/${initial.id}`, v) : await api.post('/contacts', v);
      onSaved(r);
      onClose();
    }, 'Gespeichert');
  return (
    <Modal
      wide
      title={initial?.id ? 'Kontakt bearbeiten' : 'Neuer Kontakt'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn primary" disabled={!!busy || (!v.last_name && !v.email)} onClick={save}>Speichern</button>
        </>
      }
    >
      <div className="form c3">
        <Field label="Anrede">
          <select value={v.salutation || ''} onChange={set('salutation')}>
            <option value="">–</option><option>Herr</option><option>Frau</option><option>Mr.</option><option>Ms.</option>
          </select>
        </Field>
        <Field label="Vorname"><input value={v.first_name || ''} onChange={set('first_name')} autoFocus /></Field>
        <Field label="Nachname"><input value={v.last_name || ''} onChange={set('last_name')} /></Field>
        <Field label="Firma" span={2}><SelectCompany value={v.company_id} onChange={(id) => setV((o) => ({ ...o, company_id: id }))} /></Field>
        <Field label="Position"><input value={v.position || ''} onChange={set('position')} placeholder="Head of Quality" /></Field>
        <Field label="E-Mail"><input type="email" value={v.email || ''} onChange={set('email')} /></Field>
        <Field label="Telefon"><input value={v.phone || ''} onChange={set('phone')} /></Field>
        <Field label="LinkedIn"><input value={v.linkedin || ''} onChange={set('linkedin')} /></Field>
        <Field label="Sprache">
          <select value={v.language || 'de'} onChange={set('language')}><option value="de">Deutsch</option><option value="en">Englisch</option></select>
        </Field>
        <Field label="Land (ISO)" hint="leer = Land der Firma">
          <input list="countries2" value={v.country || ''} onChange={set('country')} maxLength={2} />
          <datalist id="countries2">{COUNTRIES.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Tags" hint="kommagetrennt"><input value={v.tags || ''} onChange={set('tags')} /></Field>
        <Field label="E-Mail-Werbung" hint="Rechtsgrundlage für den KI-Agenten">
          <select value={v.consent} onChange={set('consent')}>
            <option value="none">Keine Einwilligung</option>
            <option value="consent">Einwilligung liegt vor</option>
            <option value="customer">Bestandskunde</option>
            <option value="opt_out">Abgemeldet – nie anschreiben</option>
          </select>
        </Field>
        <Field label="Nachweis / Notiz zur Einwilligung" span={2}><input value={v.consent_note || ''} onChange={set('consent_note')} placeholder="z. B. Messe XY 10/2026, Visitenkarte + mündlich" /></Field>
        <Field label="Notizen" span={3}><textarea value={v.notes || ''} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}

// ---------------- CSV-Import
const MAP: Record<string, string[]> = {
  first_name: ['first name', 'firstname', 'vorname', 'first_name', 'given name'],
  last_name: ['last name', 'lastname', 'nachname', 'last_name', 'surname', 'family name'],
  email: ['email', 'e-mail', 'email address', 'e-mail-adresse', 'work email', 'mail'],
  company: ['company', 'company name', 'firma', 'unternehmen', 'organization', 'account name', 'company name for emails'],
  position: ['title', 'job title', 'position', 'titel', 'funktion'],
  linkedin: ['linkedin', 'linkedin url', 'person linkedin url', 'profile url', 'linkedin profile'],
  phone: ['phone', 'telefon', 'mobile', 'work direct phone', 'mobile phone', 'phone number'],
  country: ['country', 'land', 'company country'],
  city: ['city', 'ort', 'stadt', 'company city'],
  website: ['website', 'company website', 'domain', 'webseite'],
  industry: ['industry', 'branche'],
  salutation: ['salutation', 'anrede'],
  tags: ['tags', 'labels'],
};
const COUNTRY_NAMES: Record<string, string> = {
  germany: 'DE', deutschland: 'DE', austria: 'AT', österreich: 'AT', switzerland: 'CH', schweiz: 'CH', poland: 'PL', polen: 'PL', 'united states': 'US',
  usa: 'US', 'united kingdom': 'GB', netherlands: 'NL', france: 'FR', italy: 'IT', spain: 'ES', belgium: 'BE', 'czech republic': 'CZ', czechia: 'CZ', canada: 'CA',
};

export function parseCsv(text: string): string[][] {
  const first = text.split('\n')[0];
  const delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : first.includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapped, setMapped] = useState<string[]>([]);
  const [tags, setTags] = useState('');
  const [consent, setConsent] = useState('none');
  const { busy, run } = useAction();
  const toast = useToast();

  const onFile = async (f: File) => {
    const text = (await f.text()).replace(/^﻿/, '');
    const data = parseCsv(text);
    if (data.length < 2) return toast('Datei enthält keine Daten', 'err');
    const header = data[0].map((h) => h.trim().toLowerCase());
    const idx: Record<string, number> = {};
    for (const [key, names] of Object.entries(MAP)) {
      const i = header.findIndex((h) => names.includes(h));
      if (i >= 0) idx[key] = i;
    }
    if (idx.first_name === undefined && idx.last_name === undefined && idx.email === undefined) {
      const full = header.findIndex((h) => ['name', 'full name', 'vollständiger name'].includes(h));
      if (full >= 0) idx.__full = full;
    }
    setMapped(Object.keys(idx).filter((k) => k !== '__full'));
    setRows(
      data.slice(1).map((r) => {
        const o: Record<string, string> = {};
        for (const [k, i] of Object.entries(idx)) o[k] = (r[i] || '').trim();
        if (o.__full) {
          const parts = o.__full.split(/\s+/);
          o.last_name = parts.pop() || '';
          o.first_name = parts.join(' ');
          delete o.__full;
        }
        if (o.country && o.country.length > 2) o.country = COUNTRY_NAMES[o.country.toLowerCase()] || '';
        return o;
      }),
    );
  };
  const doImport = () =>
    run('i', async () => {
      const r = await api.post('/contacts/import', { rows, tags, consent });
      toast(`${r.created} Kontakte importiert, ${r.companies} Firmen angelegt, ${r.skipped} übersprungen (Duplikate/leer)`);
      onDone();
      onClose();
    });

  return (
    <Modal
      wide
      title="Kontakte importieren (CSV)"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn primary" disabled={!rows.length || !!busy} onClick={doImport}>{rows.length ? `${rows.length} Kontakte importieren` : 'Importieren'}</button>
        </>
      }
    >
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>
          Funktioniert mit Exporten aus LinkedIn Sales Navigator, Apollo.io, Excel (als CSV gespeichert) oder Google Kontakte. Erkannt werden u. a. Vorname, Nachname, E-Mail, Firma, Position, LinkedIn, Land, Telefon. Duplikate (gleiche E-Mail) werden übersprungen.
        </p>
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        {rows.length > 0 && (
          <>
            <div className="muted">Erkannte Spalten: {mapped.map((m) => <span className="tag" key={m}>{m}</span>)}</div>
            <div className="table-wrap" style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 10 }}>
              <table>
                <thead><tr><th>Name</th><th>E-Mail</th><th>Firma</th><th>Position</th><th>Land</th></tr></thead>
                <tbody>
                  {rows.slice(0, 50).map((r, i) => (
                    <tr key={i}><td>{fullName(r)}</td><td>{r.email}</td><td>{r.company}</td><td>{r.position}</td><td>{r.country}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="form">
              <Field label="Tags für alle importierten Kontakte"><input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="z. B. Sales Navigator 10/2026, Pharma" /></Field>
              <Field label="E-Mail-Werbung (Rechtsgrundlage)" hint="Nur „Einwilligung“ wählen, wenn sie für alle nachweisbar vorliegt.">
                <select value={consent} onChange={(e) => setConsent(e.target.value)}>
                  <option value="none">Keine Einwilligung</option>
                  <option value="consent">Einwilligung liegt vor</option>
                  <option value="customer">Bestandskunden</option>
                </select>
              </Field>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function AddToCampaign({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const [list] = useLoad<any[]>('/campaigns');
  const [cid, setCid] = useState('');
  const [result, setResult] = useState<any>(null);
  const { busy, run } = useAction();
  const add = () => run('a', async () => setResult(await api.post(`/campaigns/${cid}/enroll`, { contact_ids: ids })));
  return (
    <Modal
      title={`${ids.length} Kontakte zu KI-Kampagne hinzufügen`}
      onClose={onClose}
      footer={result ? <button className="btn primary" onClick={() => go(`/campaigns/${cid}`)}>Zur Kampagne</button> : <button className="btn primary" disabled={!cid || !!busy} onClick={add}>Hinzufügen</button>}
    >
      {!result ? (
        <Field label="Kampagne">
          <select value={cid} onChange={(e) => setCid(e.target.value)}>
            <option value="">– wählen –</option>
            {(list || []).filter((k) => k.status !== 'done').map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        </Field>
      ) : (
        <div className="stack">
          <div><b>{result.added}</b> Kontakte hinzugefügt.</div>
          {result.rejected.length > 0 && (
            <div className="legal">
              <b>{result.rejected.length} nicht hinzugefügt:</b>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {result.rejected.slice(0, 15).map((r: any) => <li key={r.id}>{r.name}: {r.reason}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export function ContactsList() {
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [consent, setConsent] = useState('');
  const params = new URLSearchParams(Object.entries({ q, tag, consent }).filter(([, v]) => v)).toString();
  const [list, reload] = useLoad<any[]>(`/contacts${params ? '?' + params : ''}`);
  const [tags] = useLoad<string[]>('/tags');
  const [form, setForm] = useState(false);
  const [imp, setImp] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [camp, setCamp] = useState(false);
  const allSel = useMemo(() => !!list?.length && list.every((c) => sel.has(c.id)), [list, sel]);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <>
      <PageHead
        title="Kontakte"
        sub={list ? `${list.length} Kontakte` : ''}
        actions={
          <>
            {sel.size > 0 && <button className="btn ai" onClick={() => setCamp(true)}>✦ {sel.size} zu KI-Kampagne</button>}
            <button className="btn" onClick={() => setImp(true)}>CSV importieren</button>
            <button className="btn primary" onClick={() => setForm(true)}>+ Kontakt</button>
          </>
        }
      />
      <div className="toolbar">
        <input className="search" placeholder="Name, E-Mail, Firma, Position…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select style={{ width: 'auto' }} value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">Alle Tags</option>
          {(tags || []).map((t) => <option key={t}>{t}</option>)}
        </select>
        <select style={{ width: 'auto' }} value={consent} onChange={(e) => setConsent(e.target.value)}>
          <option value="">Alle (Einwilligung)</option>
          {Object.entries(CONSENT).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <div className="card flush">
        {!list ? (
          <div style={{ padding: 20 }}><Spinner /></div>
        ) : list.length === 0 ? (
          <Empty title="Keine Kontakte" text="Lege Kontakte an oder importiere eine CSV aus Sales Navigator / Apollo." action={<button className="btn primary" onClick={() => setImp(true)}>CSV importieren</button>} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 30 }}><input type="checkbox" checked={allSel} onChange={() => setSel(allSel ? new Set() : new Set(list.map((c) => c.id)))} /></th>
                  <th>Name</th><th>Firma</th><th className="hide-m">E-Mail</th><th className="hide-m">Land</th><th>E-Mail-Werbung</th><th className="hide-m">Tags</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="click" onClick={() => go(`/contacts/${c.id}`)}>
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} /></td>
                    <td><b>{fullName(c)}</b><div className="muted" style={{ fontSize: 12 }}>{c.position}</div></td>
                    <td>{c.company_name || '–'}</td>
                    <td className="hide-m">{c.email || '–'}</td>
                    <td className="hide-m">{c.country || c.company_country || '–'}</td>
                    <td><Badge map={CONSENT} value={c.consent} /></td>
                    <td className="hide-m">{(c.tags || '').split(',').filter(Boolean).slice(0, 3).map((t: string) => <span key={t} className="tag">{t.trim()}</span>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {form && <ContactForm onClose={() => setForm(false)} onSaved={(c) => go(`/contacts/${c.id}`)} />}
      {imp && <ImportModal onClose={() => setImp(false)} onDone={reload} />}
      {camp && <AddToCampaign ids={[...sel]} onClose={() => setCamp(false)} />}
    </>
  );
}

export function ContactDetail({ id, me }: { id: string; me: Me }) {
  const [c, reload] = useLoad<any>(`/contacts/${id}`);
  const [edit, setEdit] = useState(false);
  const [mail, setMail] = useState(false);
  const [tab, setTab] = useState<'act' | 'mail'>('act');
  const [actKey, setActKey] = useState(0);
  const { busy, run } = useAction();
  if (!c) return <Spinner />;
  const newQuote = () => run('q', async () => {
    const q = await api.post('/quotes', { company_id: c.company_id, contact_id: id });
    go(`/quotes/${q.id}`);
  });
  return (
    <>
      <PageHead
        back="#/contacts"
        title={fullName(c)}
        sub={<>{[c.position, c.company_name].filter(Boolean).join(' · ')} {c.company_id && <a href={`#/companies/${c.company_id}`}>→ Firma</a>}</>}
        actions={
          <>
            <button className="btn" onClick={() => setEdit(true)}>Bearbeiten</button>
            <button className="btn" disabled={!!busy} onClick={newQuote}>+ Angebot</button>
            <button className="btn primary" disabled={!c.email || c.consent === 'opt_out' || !me.google} onClick={() => setMail(true)}>✉ E-Mail schreiben</button>
          </>
        }
      />
      <div className="grid side">
        <div className="stack">
          <div className="tabs">
            <button className={tab === 'act' ? 'active' : ''} onClick={() => setTab('act')}>Aktivitäten</button>
            <button className={tab === 'mail' ? 'active' : ''} onClick={() => setTab('mail')}>Gmail-Verlauf</button>
          </div>
          {tab === 'act' ? (
            <Activities key={actKey} filter={`contact_id=${id}`} contactId={id} companyId={c.company_id} />
          ) : (
            <div className="card"><GmailHistory contactId={id} enabled={me.google} /></div>
          )}
        </div>
        <div className="stack">
          <div className="card">
            <h2 style={{ marginBottom: 12 }}>Kontakt</h2>
            <dl className="dl">
              <dt>E-Mail</dt><dd>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : '–'}</dd>
              <dt>Telefon</dt><dd>{c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : '–'}</dd>
              <dt>LinkedIn</dt><dd>{c.linkedin ? <a href={c.linkedin} target="_blank" rel="noreferrer">Profil öffnen</a> : '–'}</dd>
              <dt>Sprache</dt><dd>{c.language === 'en' ? 'Englisch' : 'Deutsch'}</dd>
              <dt>Land</dt><dd>{c.country || c.company_country || '–'}</dd>
              <dt>Werbung</dt><dd><Badge map={CONSENT} value={c.consent} />{c.consent_note && <div className="muted" style={{ fontSize: 12 }}>{c.consent_note}</div>}</dd>
              <dt>Tags</dt><dd>{(c.tags || '').split(',').filter(Boolean).map((t: string) => <span key={t} className="tag">{t.trim()}</span>)}</dd>
            </dl>
            {c.notes && <p className="pre" style={{ marginTop: 14 }}>{c.notes}</p>}
          </div>
          {(c.deals.length > 0 || c.quotes.length > 0) && (
            <div className="card">
              <h2 style={{ marginBottom: 10 }}>Deals & Angebote</h2>
              {c.deals.map((d: any) => <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}><span>{d.title}</span><span className="badge blue">{stageLabel(d.stage)}</span></div>)}
              {c.quotes.map((q: any) => (
                <div key={q.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', gap: 8 }}>
                  <a href={`#/quotes/${q.id}`}>{q.number}</a><span>{fmtMoney(q.total, q.currency)}</span><Badge map={QUOTE_STATUS} value={q.status} />
                </div>
              ))}
            </div>
          )}
          {c.enrollments.length > 0 && (
            <div className="card">
              <h2 style={{ marginBottom: 10 }}>KI-Kampagnen</h2>
              {c.enrollments.map((e: any) => (
                <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                  <a href={`#/campaigns/${e.campaign_id}`}>{e.campaign_name}</a><Badge map={ENR_STATUS} value={e.status} />
                </div>
              ))}
            </div>
          )}
          <button className="btn danger" onClick={() => confirmDel('Kontakt') && run('d', async () => { await api.del(`/contacts/${id}`); go('/contacts'); })}>Kontakt löschen</button>
        </div>
      </div>
      {edit && <ContactForm initial={c} onClose={() => setEdit(false)} onSaved={reload} />}
      {mail && <ComposeMail contact={c} onClose={() => setMail(false)} onSent={() => setActKey((k) => k + 1)} />}
    </>
  );
}
