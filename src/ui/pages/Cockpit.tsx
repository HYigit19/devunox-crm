import React, { useState } from 'react';
import { api } from '../api';
import { Empty, Field, Modal, PageHead, Spinner, fmtDate, fmtMoney, go, useAction, useLoad, useToast } from '../components';
import { HoursBar } from './Systems';

// Kunden-Cockpit: Health-Score je Kunde, Warnungen, Umsatz/Marge, Stundenkontingente

const LEVEL: Record<string, [string, string]> = { red: ['Kritisch', 'red'], amber: ['Beobachten', 'amber'], green: ['Gut', 'green'] };

export function CockpitPage() {
  const [d, , , err] = useLoad<any>('/clients/cockpit');
  const [filter, setFilter] = useState<'attention' | 'all' | 'mine'>('attention');
  const [me] = useLoad<any>('/me');
  if (err) return <><PageHead title="Kunden-Cockpit" /><div className="card"><Empty title="Datenbank-Update fehlt" text={err} /></div></>;
  if (!d) return <Spinner />;
  const k = d.kpi;
  const list = d.clients.filter((c: any) => (filter === 'attention' ? c.level !== 'green' : filter === 'mine' ? c.owner_id === me?.id : true));
  return (
    <>
      <PageHead title="Kunden-Cockpit" sub="Welche Kunden brauchen heute Aufmerksamkeit? Ampel aus Systemen, Abrechnung, Aufgaben, Kontingenten, Fristen und Kontakt." />
      <div className="grid k4" style={{ marginBottom: 18 }}>
        <div className="card kpi feature"><div className="label">Wiederkehrender Umsatz (MRR)</div><div className="value">{fmtMoney(k.mrr)}</div><div className="meta">{fmtMoney(k.mrr * 12)} pro Jahr · {k.clients} Kunden</div></div>
        <div className="card kpi"><div className="label">Ampel</div><div className="value" style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}><span style={{ color: 'var(--red)' }}>{k.red}</span><span style={{ color: 'var(--amber)' }}>{k.amber}</span><span style={{ color: 'var(--green)' }}>{k.clients - k.red - k.amber}</span></div><div className="meta">kritisch · beobachten · gut</div></div>
        <div className="card kpi"><div className="label">Systeme</div><div className="value">{k.systems}</div><div className="meta">{k.down ? <span style={{ color: 'var(--red)', fontWeight: 700 }}>{k.down} nicht erreichbar</span> : 'alle erreichbar'}</div></div>
        <div className="card kpi"><div className="label">Offene Abrechnung</div><div className="value">{fmtMoney(k.unpaid)}</div><div className="meta">{k.overdue ? <span style={{ color: 'var(--red)', fontWeight: 700 }}>{fmtMoney(k.overdue)} überfällig</span> : 'nichts überfällig'}</div></div>
      </div>
      <div className="toolbar">
        <div className="seg">
          <button className={filter === 'attention' ? 'active' : ''} onClick={() => setFilter('attention')}>Braucht Aufmerksamkeit ({k.red + k.amber})</button>
          <button className={filter === 'mine' ? 'active' : ''} onClick={() => setFilter('mine')}>Meine Kunden</button>
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Alle</button>
        </div>
        <span className="muted" style={{ fontSize: 12.5 }}>Umsatz {new Date().getFullYear()}: <b style={{ color: 'var(--ink)' }}>{fmtMoney(k.revenue)}</b> · Marge {fmtMoney(k.margin)} (interne Kosten {fmtMoney(d.hour_cost)}/h)</span>
      </div>
      {list.length === 0 ? <div className="card"><Empty title={filter === 'attention' ? 'Alles im grünen Bereich' : 'Keine Kunden'} text={filter === 'attention' ? 'Kein Kunde braucht gerade Aufmerksamkeit.' : 'Kunden erscheinen hier, sobald sie ein System, Abo, Aufgaben oder Umsatz haben.'} /></div> : (
        <div className="cockpit">
          {list.map((c: any) => (
            <button key={c.id} className={`ck-card ${c.level}`} onClick={() => go(`/companies/${c.id}`)}>
              <div className="ck-head">
                <div className={`ck-score ${c.level}`}>{c.score}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <b>{c.name}</b>
                  <div className="muted" style={{ fontSize: 12 }}>{c.customer_no}{c.owner ? ` · Betreuer: ${c.owner}` : ''}</div>
                </div>
                <span className={`badge ${LEVEL[c.level][1]}`}>{LEVEL[c.level][0]}</span>
              </div>
              {c.warns.length > 0 && (
                <ul className="ck-warns">
                  {c.warns.slice(0, 4).map((w: any, i: number) => <li key={i} className={w.level}>{w.text}</li>)}
                  {c.warns.length > 4 && <li className="muted">+ {c.warns.length - 4} weitere</li>}
                </ul>
              )}
              <div className="ck-stats">
                <span><b>{fmtMoney(c.mrr)}</b> MRR</span>
                <span><b>{c.systems}</b> Systeme</span>
                <span><b>{c.open_tasks}</b> offen{c.feedback_open ? ` (${c.feedback_open} Feedback)` : ''}</span>
                <span title="Umsatz minus interne Kosten im laufenden Jahr"><b className={c.margin < 0 ? 'warn-text' : ''}>{c.margin_pct === null ? '–' : `${c.margin_pct} %`}</b> Marge</span>
              </div>
              {c.included_hours > 0 && <HoursBar used={c.hours_month} incl={c.included_hours} />}
              <div className="muted" style={{ fontSize: 11.5 }}>Letzter Kontakt: {c.last_contact ? fmtDate(c.last_contact) : '–'}</div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** Team: Benutzer, Rollen, Einladung (Einstellungen) */
export function TeamCard() {
  const [d, reload, , err] = useLoad<any>('/clients/team');
  const [inv, setInv] = useState(false);
  const [v, setV] = useState({ email: '', name: '', role: 'member' });
  const [created, setCreated] = useState<any>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  if (err) return <div className="card"><h2 style={{ marginBottom: 8 }}>Team</h2><div className="muted" style={{ fontSize: 13 }}>{err}</div></div>;
  if (!d) return <div className="card"><Spinner /></div>;
  const add = () => run('a', async () => { setCreated(await api.post('/clients/team', v)); setInv(false); setV({ email: '', name: '', role: 'member' }); reload(); });
  return (
    <div className="card">
      <div className="card-head"><h2>Team</h2>{d.admin && <button className="btn sm primary" onClick={() => setInv(true)}>+ Person</button>}</div>
      {d.users.map((u: any) => (
        <div key={u.id} className="portal-user">
          <div className="avatar" style={{ width: 32, height: 32, flex: '0 0 32px', fontSize: 13 }}>{(u.name || u.email)[0]}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b style={{ display: 'block' }}>{u.name || u.email}{u.id === d.me && <span className="muted"> (du)</span>}</b>
            <span className="muted" style={{ fontSize: 12 }}>{u.email} · {u.n_clients} Kunden betreut · {u.n_tasks} offene Aufgaben{u.password_temp ? ' · noch nicht angemeldet' : ''}</span>
          </div>
          {d.admin ? (
            <select style={{ width: 'auto' }} value={u.role} disabled={u.id === d.me} onChange={(e) => run('r', async () => { await api.put(`/clients/team/${u.id}`, { role: e.target.value }); reload(); }, 'Rolle geändert')}>
              <option value="admin">Admin</option><option value="member">Mitarbeiter</option>
            </select>
          ) : <span className="badge grey">{u.role === 'admin' ? 'Admin' : 'Mitarbeiter'}</span>}
          {d.admin && u.id !== d.me && <button className="icon-btn" title="Entfernen" onClick={() => confirm(`${u.email} entfernen?`) && run('d', async () => { await api.del(`/clients/team/${u.id}`); reload(); })}>✕</button>}
        </div>
      ))}
      <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>Mitarbeiter arbeiten mit Kunden, Aufgaben und Dokumenten, können aber keine Einstellungen ändern, kein Team verwalten und keine Tresor-Einträge löschen. Den Betreuer eines Kunden setzt du auf der Firmenseite.</p>
      {inv && (
        <Modal title="Person ins Team holen" onClose={() => setInv(false)} footer={<><button className="btn" onClick={() => setInv(false)}>Abbrechen</button><button className="btn primary" disabled={!!busy || !v.email} onClick={add}>Anlegen</button></>}>
          <div className="form">
            <Field label="Name"><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
            <Field label="E-Mail"><input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
            <Field label="Rolle" span={2}><select value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}><option value="member">Mitarbeiter</option><option value="admin">Admin</option></select></Field>
          </div>
        </Modal>
      )}
      {created && (
        <Modal title="Zugang erstellt" onClose={() => setCreated(null)}>
          <p style={{ marginTop: 0 }}>Gib diese Daten persönlich weiter (nicht per unverschlüsselter Mail). Beim ersten Login wird ein eigenes Passwort festgelegt. Das Einmal-Passwort gilt 7 Tage.</p>
          <dl className="dl"><dt>Adresse</dt><dd>{created.login_url}</dd><dt>E-Mail</dt><dd>{created.email}</dd><dt>Einmal-Passwort</dt><dd><code className="secret">{created.temp_password}</code></dd></dl>
          <button className="btn sm" style={{ marginTop: 12 }} onClick={async () => { try { await navigator.clipboard.writeText(`${created.login_url}\n${created.email}\n${created.temp_password}`); toast('Kopiert'); } catch { /* egal */ } }}>Alles kopieren</button>
        </Modal>
      )}
    </div>
  );
}

/** Betreuer eines Kunden setzen (Firmenseite) */
export function OwnerSelect({ company }: { company: any }) {
  const [d] = useLoad<any>('/clients/team');
  const { run } = useAction();
  const [val, setVal] = useState(company.owner_id || '');
  if (!d?.users) return null;
  return (
    <select style={{ width: 'auto' }} value={val} title="Betreuer" onChange={(e) => { const v = e.target.value; setVal(v); run('o', async () => { await api.put(`/companies/${company.id}`, { owner_id: v || null }); }, 'Betreuer gespeichert'); }}>
      <option value="">Betreuer: –</option>
      {d.users.map((u: any) => <option key={u.id} value={u.id}>Betreuer: {u.name || u.email}</option>)}
    </select>
  );
}
