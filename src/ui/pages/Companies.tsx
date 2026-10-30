import React, { useState } from 'react';
import { api } from '../api';
import { Badge, COUNTRIES, Empty, Field, Modal, PageHead, QUOTE_STATUS, Spinner, confirmDel, fmtDate, fmtMoney, fullName, go, stageLabel, useAction, useForm, useLoad } from '../components';
import { Activities } from './shared';
import { ContactForm } from './Contacts';
import { DealForm } from './Pipeline';

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
        <input className="search" placeholder="Suchen nach Name, Ort, Branche, Tag…" value={q} onChange={(e) => setQ(e.target.value)} />
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
                <tr><th>Name</th><th className="hide-m">Branche</th><th>Ort</th><th className="num">Kontakte</th><th className="num">Offene Deals</th><th className="hide-m">Tags</th></tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id} className="click" onClick={() => go(`/companies/${c.id}`)}>
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
        title={c.name}
        sub={[c.industry, [c.city, c.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
        actions={
          <>
            <button className="btn" onClick={() => setEdit(true)}>Bearbeiten</button>
            <button className="btn" onClick={() => setNewDeal(true)}>+ Deal</button>
            <button className="btn primary" disabled={!!busy} onClick={newQuote}>+ Angebot</button>
          </>
        }
      />
      <div className="grid side">
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
      </div>
      {edit && <CompanyForm initial={c} onClose={() => setEdit(false)} onSaved={reload} />}
      {newContact && <ContactForm initial={{ company_id: id, country: c.country }} onClose={() => setNewContact(false)} onSaved={reload} />}
      {newDeal && <DealForm initial={{ company_id: id, contact_id: c.contacts[0]?.id }} onClose={() => setNewDeal(false)} onSaved={reload} />}
    </>
  );
}
