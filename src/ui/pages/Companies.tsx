import React, { useState } from 'react';
import { api } from '../api';
import { Badge, COUNTRIES, Empty, Field, Modal, PageHead, QUOTE_STATUS, Spinner, confirmDel, fmtDate, fmtMoney, fullName, go, stageLabel, useAction, useForm, useLoad } from '../components';
import { Activities } from './shared';
import { ContactForm } from './Contacts';
import { DealForm } from './Pipeline';
import { TaskBoard } from './Tasks';
import { DocBrowser } from './Documents';
import { ProjectCards, ProjectForm } from './Projects';
import { TimeEntries, fmtHours } from './Time';
import { TaskDrawer } from './Tasks';

export function CompanyForm({ initial, onClose, onSaved }: { initial?: any; onClose: () => void; onSaved: (c: any) => void }) {
  const { v, set } = useForm({
    name: '', website: '', industry: '', size: '', street: '', zip: '', city: '', country: 'DE', vat_id: '', phone: '', email: '', tags: '', notes: '',
    ...(initial || {}),
  });
  const { busy, run } = useAction();
  const save = () =>
    run('s', async () => {
      const r = initial?.id ? await api.put(`/companies/${initial.id}`, v) : await api.post('/companies', v);
      onSaved(r);
      onClose();
    }, 'Gespeichert');
  return (
    <Modal
      wide
      title={initial?.id ? 'Firma bearbeiten' : 'Neue Firma'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn primary" disabled={!!busy || !v.name} onClick={save}>Speichern</button>
        </>
      }
    >
      <div className="form c3">
        <Field label="Firmenname *" span={2}><input value={v.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Branche"><input value={v.industry || ''} onChange={set('industry')} /></Field>
        <Field label="Website"><input value={v.website || ''} onChange={set('website')} placeholder="www.firma.de" /></Field>
        <Field label="Größe"><input value={v.size || ''} onChange={set('size')} placeholder="z. B. 500–1000 MA" /></Field>
        <Field label="USt-IdNr. / NIP"><input value={v.vat_id || ''} onChange={set('vat_id')} /></Field>
        <Field label="Straße" span={2}><input value={v.street || ''} onChange={set('street')} /></Field>
        <Field label="PLZ"><input value={v.zip || ''} onChange={set('zip')} /></Field>
        <Field label="Ort"><input value={v.city || ''} onChange={set('city')} /></Field>
        <Field label="Land (ISO)">
          <input list="countries" value={v.country || ''} onChange={set('country')} maxLength={2} />
          <datalist id="countries">{COUNTRIES.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Telefon"><input value={v.phone || ''} onChange={set('phone')} /></Field>
        <Field label="E-Mail (allgemein)"><input value={v.email || ''} onChange={set('email')} /></Field>
        <Field label="Tags" hint="kommagetrennt" span={2}><input value={v.tags || ''} onChange={set('tags')} placeholder="SAP QM, S/4HANA, Pharma" /></Field>
        <Field label="Notizen" span={3}><textarea value={v.notes || ''} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}

export function CompaniesList() {
  const [q, setQ] = useState('');
  const [list, reload] = useLoad<any[]>(`/companies${q ? `?q=${encodeURIComponent(q)}` : ''}`, []);
  const [form, setForm] = useState(false);
  return (
    <>
      <PageHead title="Firmen" sub={list ? `${list.length} Firmen` : ''} actions={<button className="btn primary" onClick={() => setForm(true)}>+ Firma</button>} />
      <div className="toolbar">
        <input className="search" placeholder="Suchen nach Name, Kundennr., Ort, Branche, Tag…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="card flush">
        {!list ? (
          <div style={{ padding: 20 }}><Spinner /></div>
        ) : list.length === 0 ? (
          <Empty title="Noch keine Firmen" text="Lege eine Firma an oder importiere Kontakte per CSV unter „Kontakte“." action={<button className="btn primary" onClick={() => setForm(true)}>+ Firma anlegen</button>} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Kundennr.</th><th>Name</th><th className="hide-m">Branche</th><th>Ort</th><th className="num">Kontakte</th><th className="num">Offene Deals</th><th className="hide-m">Tags</th></tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="click" onClick={() => go(`/companies/${c.id}`)}>
                    <td><span className="cno">{c.customer_no || '–'}</span></td>
                    <td><b>{c.name}</b></td>
                    <td className="hide-m">{c.industry || '–'}</td>
                    <td>{[c.city, c.country].filter(Boolean).join(', ') || '–'}</td>
                    <td className="num">{c.contact_count}</td>
                    <td className="num">{c.open_deals}</td>
                    <td className="hide-m">{(c.tags || '').split(',').filter(Boolean).map((t: string) => <span key={t} className="tag">{t.trim()}</span>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {form && <CompanyForm onClose={() => setForm(false)} onSaved={(c) => go(`/companies/${c.id}`)} />}
    </>
  );
}

export function CompanyDetail({ id }: { id: string }) {
  const [c, reload] = useLoad<any>(`/companies/${id}`);
  const [edit, setEdit] = useState(false);
  const [newContact, setNewContact] = useState(false);
  const [newDeal, setNewDeal] = useState(false);
  const [tab, setTab] = useState<'file' | 'overview' | 'projects' | 'tasks' | 'docs' | 'time'>('file');
  const [newProject, setNewProject] = useState(false);
  const [projects, reloadProjects] = useLoad<any[]>(`/projects?company_id=${id}`);
  const { busy, run } = useAction();
  if (!c) return <Spinner />;

  const research = () => run('r', async () => {
    await api.post(`/companies/${id}/research`);
    reload();
  }, 'Recherche abgeschlossen');
  const newQuote = () => run('q', async () => {
    const q = await api.post('/quotes', { company_id: id, contact_id: c.contacts[0]?.id });
    go(`/quotes/${q.id}`);
  });

  return (
    <>
      <PageHead
        back="#/companies"
        title={<span style={{ display: 'inline-flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>{c.name} {c.customer_no && <span className="cno lg">{c.customer_no}</span>}</span>}
        sub={[c.industry, [c.city, c.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
        actions={
          <>
            <button className="btn" onClick={() => setEdit(true)}>Bearbeiten</button>
            <button className="btn" onClick={() => setNewDeal(true)}>+ Deal</button>
            <button className="btn primary" disabled={!!busy} onClick={newQuote}>+ Angebot</button>
          </>
        }
      />
      <div className="tabs">
        <button className={tab === 'file' ? 'active' : ''} onClick={() => setTab('file')}>Kundenakte</button>
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Kontakte & Angebote</button>
        <button className={tab === 'projects' ? 'active' : ''} onClick={() => setTab('projects')}>Projekte <span className="n">{projects?.length ?? ''}</span></button>
        <button className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}>Aufgaben</button>
        <button className={tab === 'docs' ? 'active' : ''} onClick={() => setTab('docs')}>Dokumente</button>
        <button className={tab === 'time' ? 'active' : ''} onClick={() => setTab('time')}>Zeiten</button>
      </div>
      {tab === 'file' && <CustomerFile id={id} onTab={(t) => setTab(t as any)} />}
      {tab === 'time' && <div className="card"><TimeEntries companyId={id} title={c.name} /></div>}
      {tab === 'projects' && (
        <div className="stack">
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn primary" onClick={() => setNewProject(true)}>+ Projekt</button></div>
          {projects && projects.length ? <ProjectCards list={projects} /> : <div className="card"><Empty title="Keine Projekte" text="Projekte bündeln Aufgaben, Review-Feedback und Dokumente." /></div>}
        </div>
      )}
      {tab === 'tasks' && <TaskBoard filter={`company_id=${id}`} companyId={id} />}
      {tab === 'docs' && <div className="card"><DocBrowser companyId={id} /></div>}
      {tab === 'overview' && <div className="grid side">
        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h2>Ansprechpartner</h2>
              <button className="btn sm" onClick={() => setNewContact(true)}>+ Kontakt</button>
            </div>
            {c.contacts.length === 0 ? (
              <div className="muted">Noch keine Kontakte.</div>
            ) : (
              <table>
                <tbody>
                  {c.contacts.map((p: any) => (
                    <tr key={p.id} className="click" onClick={() => go(`/contacts/${p.id}`)}>
                      <td><b>{fullName(p)}</b><div className="muted" style={{ fontSize: 12 }}>{p.position}</div></td>
                      <td className="hide-m">{p.email}</td>
                      <td>{p.phone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="card">
            <div className="card-head"><h2>Deals & Angebote</h2></div>
            {c.deals.length === 0 && c.quotes.length === 0 && <div className="muted">Noch keine Deals oder Angebote.</div>}
            <table>
              <tbody>
                {c.deals.map((d: any) => (
                  <tr key={d.id} className="click" onClick={() => go('/pipeline')}>
                    <td>Deal: <b>{d.title}</b></td>
                    <td><span className="badge blue">{stageLabel(d.stage)}</span></td>
                    <td className="num">{fmtMoney(d.value, d.currency)}</td>
                  </tr>
                ))}
                {c.quotes.map((q: any) => (
                  <tr key={q.id} className="click" onClick={() => go(`/quotes/${q.id}`)}>
                    <td>{q.number} · {q.title || 'Angebot'} <span className="muted">({fmtDate(q.issue_date)})</span></td>
                    <td><Badge map={QUOTE_STATUS} value={q.status} /></td>
                    <td className="num">{fmtMoney(q.total, q.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Activities filter={`company_id=${id}`} companyId={id} />
        </div>
        <div className="stack">
          <div className="card">
            <h2 style={{ marginBottom: 12 }}>Stammdaten</h2>
            <dl className="dl">
              <dt>Website</dt><dd>{c.website ? <a href={c.website.startsWith('http') ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer">{c.website}</a> : '–'}</dd>
              <dt>Adresse</dt><dd>{[c.street, [c.zip, c.city].filter(Boolean).join(' '), c.country].filter(Boolean).join(', ') || '–'}</dd>
              <dt>USt-IdNr.</dt><dd>{c.vat_id || '–'}</dd>
              <dt>Telefon</dt><dd>{c.phone || '–'}</dd>
              <dt>E-Mail</dt><dd>{c.email || '–'}</dd>
              <dt>Größe</dt><dd>{c.size || '–'}</dd>
              <dt>Tags</dt><dd>{(c.tags || '').split(',').filter(Boolean).map((t: string) => <span key={t} className="tag">{t.trim()}</span>) || '–'}</dd>
            </dl>
            {c.notes && <p className="pre" style={{ marginTop: 14 }}>{c.notes}</p>}
          </div>
          <div className="card ai-box">
            <div className="card-head">
              <h2>✦ KI-Recherche</h2>
              <button className="btn ai sm" disabled={!!busy} onClick={research}>{busy === 'r' ? 'Recherchiere…' : c.research ? 'Aktualisieren' : 'Recherchieren'}</button>
            </div>
            {c.research ? <div className="pre" style={{ fontSize: 13 }}>{c.research}</div> : <div className="muted" style={{ fontSize: 13 }}>Der Agent durchsucht das Web nach Branche, Größe, SAP-Nutzung und aktuellen Anlässen. Die Ergebnisse nutzt er für persönliche Mails.</div>}
          </div>
          <button className="btn danger" onClick={() => confirmDel('Firma') && run('d', async () => { await api.del(`/companies/${id}`); go('/companies'); })}>Firma löschen</button>
        </div>
      </div>}
      {newProject && <ProjectForm initial={{ company_id: id }} onClose={() => setNewProject(false)} onSaved={() => reloadProjects()} />}
      {edit && <CompanyForm initial={c} onClose={() => setEdit(false)} onSaved={reload} />}
      {newContact && <ContactForm initial={{ company_id: id, country: c.country }} onClose={() => setNewContact(false)} onSaved={reload} />}
      {newDeal && <DealForm initial={{ company_id: id, contact_id: c.contacts[0]?.id }} onClose={() => setNewDeal(false)} onSaved={reload} />}
    </>
  );
}

const EV: Record<string, [string, string, string]> = {
  quote: ['Angebot', '◧', 'tint-orange'],
  won: ['Gewonnen', '✓', 'tint-green'],
  lost: ['Verloren', '✕', 'tint-ink'],
  task: ['Aufgabe', '☐', 'tint-ink'],
  feedback: ['Feedback', '◉', 'tint-violet'],
  done: ['Erledigt', '✓', 'tint-green'],
  doc: ['Dokument', '▤', 'tint-rust'],
  time: ['Zeit', '⏱', 'tint-orange'],
  mail: ['E-Mail', '✉', 'tint-ink'],
  note: ['Notiz', '✎', 'tint-ink'],
  project: ['Projekt', '▰', 'tint-ink'],
};
const FILTERS: [string, string, string[]][] = [
  ['all', 'Alles', []],
  ['quote', 'Angebote', ['quote', 'won', 'lost']],
  ['work', 'Arbeit', ['task', 'feedback', 'done', 'project']],
  ['time', 'Zeiten', ['time']],
  ['doc', 'Dokumente', ['doc']],
  ['comm', 'Kommunikation', ['mail', 'note']],
];

/** Kundenakte: alle Angebote, Spezifikationen, Dokumente, Aufgaben, Feedback und Zeiten eines Kunden auf einer Zeitleiste */
function CustomerFile({ id, onTab }: { id: string; onTab: (t: string) => void }) {
  const [d] = useLoad<any>(`/companies/${id}/file`);
  const [f, setF] = useState('all');
  const [open, setOpen] = useState<string | null>(null);
  if (!d) return <Spinner />;
  const st = d.stats;
  const kinds = FILTERS.find((x) => x[0] === f)![2];
  const events = d.events.filter((e: any) => !kinds.length || kinds.includes(e.kind));
  return (
    <div className="grid side">
      <div className="card">
        <div className="card-head">
          <h2>Zeitleiste</h2>
          <div className="seg">{FILTERS.map(([k, l]) => <button key={k} className={f === k ? 'active' : ''} onClick={() => setF(k)}>{l}</button>)}</div>
        </div>
        {events.length === 0 ? <Empty title="Noch nichts passiert" text="Angebote, Dokumente, Aufgaben, Feedback und Zeiten dieses Kunden erscheinen hier chronologisch." /> : (
          <div className="timeline">
            {events.map((e: any, i: number) => {
              const [label, icon, tint] = EV[e.kind] || ['', '•', 'tint-ink'];
              const clickable = e.link || e.ref;
              return (
                <div className="tl-item" key={i} style={{ cursor: clickable ? 'pointer' : undefined }}
                  onClick={() => { if (e.ref) setOpen(e.ref); else if (e.link?.startsWith('#')) window.location.hash = e.link.slice(1); else if (e.link) window.open(e.link, '_blank'); }}>
                  <div className={`tl-dot ${tint}`}>{icon}</div>
                  <div className="tl-body">
                    <div className="tl-title">{e.title}</div>
                    <div className="tl-meta">{label} · {fmtDate(e.at)}{e.detail ? ` · ${e.detail}` : ''}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="stack">
        <div className="card" style={{ background: 'var(--ink)', color: '#fff' }}>
          <div style={{ fontSize: 12, color: '#b9b9c3', letterSpacing: '.08em', textTransform: 'uppercase' }}>Kundennummer</div>
          <div style={{ fontSize: 30, fontWeight: 700, color: 'var(--orange)', letterSpacing: '-.02em' }}>{d.company.customer_no || '–'}</div>
          <div style={{ fontSize: 13, color: '#b9b9c3' }}>Kunde seit {fmtDate(d.company.created_at)}</div>
        </div>
        <div className="grid c2" style={{ gap: 12 }}>
          <div className="card kpi" style={{ padding: 16 }}><div className="label">Umsatz gewonnen</div><div className="value" style={{ fontSize: 20 }}>{fmtMoney(st.won)}</div><div className="meta">{st.quotes} Angebote · {st.open_quotes} offen</div></div>
          <div className="card kpi" style={{ padding: 16, cursor: 'pointer' }} onClick={() => onTab('time')}><div className="label">Erfasste Zeit</div><div className="value" style={{ fontSize: 20 }}>{fmtHours(st.minutes)}</div><div className="meta">{fmtHours(st.billable_minutes)} abrechenbar</div></div>
          <div className="card kpi" style={{ padding: 16, cursor: 'pointer' }} onClick={() => onTab('tasks')}><div className="label">Aufgaben</div><div className="value" style={{ fontSize: 20 }}>{st.tasks_open}</div><div className="meta">offen · {st.tasks_done} erledigt · {st.feedback_open} Feedback</div></div>
          <div className="card kpi" style={{ padding: 16, cursor: 'pointer' }} onClick={() => onTab('docs')}><div className="label">Dokumente</div><div className="value" style={{ fontSize: 20 }}>{st.documents}</div><div className="meta">{st.projects} laufende Projekte</div></div>
        </div>
        {d.time_by_project.length > 0 && (
          <div className="card">
            <h2 style={{ marginBottom: 10 }}>Zeit je Projekt</h2>
            {d.time_by_project.map((r: any) => (
              <div key={r.project} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{r.project}</span><b>{fmtHours(r.minutes)}</b></div>
                <div className="bar" style={{ marginTop: 4 }}><div style={{ width: `${(r.minutes / Math.max(1, st.minutes)) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        )}
      </div>
      {open && <TaskDrawer id={open} onClose={() => setOpen(null)} onChanged={() => {}} />}
    </div>
  );
}
