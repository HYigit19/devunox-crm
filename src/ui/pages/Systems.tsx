import React, { useState } from 'react';
import { api } from '../api';
import { Empty, Field, Modal, PageHead, SelectCompany, Spinner, confirmDel, fmtDate, fmtDateTime, fmtMoney, fmtMoney2, useAction, useLoad, useToast } from '../components';

// Kundensysteme: Hosting, Abos & Abrechnung, Lizenzen, Releases, Verträge, Checklisten, Tresor, Monatsberichte

export const HOSTING: Record<string, [string, string]> = {
  devunox_cloud: ['devunox Cloud', 'orange'],
  on_prem: ['On-Premise', 'violet'],
  aws: ['AWS', 'amber'],
  azure: ['Azure', 'blue'],
  gcp: ['Google Cloud', 'blue'],
  hetzner: ['Hetzner', 'red'],
  other: ['Andere Cloud', 'grey'],
};
const SYS_STATUS: Record<string, [string, string]> = { setup: ['Aufbau', 'blue'], live: ['Live', 'green'], maintenance: ['Wartung', 'amber'], paused: ['Pausiert', 'grey'], ended: ['Beendet', 'grey'] };
const KIND: Record<string, string> = { website: 'Website', webapp: 'Web-App', portal: 'Kundenportal', dashboard: 'Dashboard', automation: 'KI-Automatisierung', api: 'API / Schnittstelle', other: 'Sonstiges' };
const INTERVAL: Record<string, string> = { month: 'monatlich', quarter: 'quartalsweise', year: 'jährlich' };
const PERIOD_ST: Record<string, [string, string]> = { open: ['Offen', 'amber'], invoiced: ['Gestellt', 'blue'], paid: ['Bezahlt', 'green'] };
const CONTRACT_KIND: Record<string, string> = { framework: 'Rahmenvertrag', dpa: 'AVV / Auftragsverarbeitung', sla: 'SLA', nda: 'NDA', maintenance: 'Wartungsvertrag', other: 'Sonstiges' };
const CONTRACT_ST: Record<string, [string, string]> = { draft: ['Entwurf', 'grey'], sent: ['Versendet', 'blue'], signed: ['Unterschrieben', 'green'], ended: ['Beendet', 'grey'] };
const B = ({ m, v }: { m: Record<string, [string, string]>; v: string }) => <span className={`badge ${m[v]?.[1] || 'grey'}`}>{m[v]?.[0] || v}</span>;
const soon = (d?: string | null, days = 30) => !!d && d <= new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const past = (d?: string | null) => !!d && d < new Date().toISOString().slice(0, 10);

function Setup({ err }: { err: string }) {
  return <div className="card"><Empty title="Datenbank-Update fehlt" text={err} /></div>;
}

// ================================================================ Systeme
export function SystemsList({ companyId }: { companyId?: string }) {
  const [list, reload, , err] = useLoad<any[]>(`/clients/systems${companyId ? `?company_id=${companyId}` : ''}`);
  const [edit, setEdit] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);
  if (err) return <Setup err={err} />;
  return (
    <div className="card flush">
      <div className="card-head"><h2>Systeme & Hosting</h2><button className="btn sm primary" onClick={() => setEdit({ company_id: companyId || '', hosting: 'devunox_cloud', status: 'live', kind: 'webapp', monitor: 1 })}>+ System</button></div>
      {!list ? <div style={{ padding: 20 }}><Spinner /></div> : list.length === 0 ? <Empty title="Noch keine Systeme" text="Lege die Websites und Apps deiner Kunden an – mit Hosting, Adressen, Version, Domain, SSL und Überwachung." /> : (
        <div className="sys-grid">
          {list.map((s) => (
            <button key={s.id} className="sys-card" onClick={() => setOpen(s.id)}>
              <div className="sys-top">
                <span className={`health ${s.monitor ? (s.check_ok === 0 ? 'red' : s.check_ok === 1 ? 'green' : 'grey') : 'grey'}`} title={s.monitor ? (s.check_ok === 0 ? 'nicht erreichbar' : 'erreichbar') : 'nicht überwacht'} />
                <b>{s.name}</b>
                <B m={SYS_STATUS} v={s.status} />
              </div>
              {!companyId && <div className="muted" style={{ fontSize: 12.5 }}>{s.company_name} {s.customer_no && <span className="cno">{s.customer_no}</span>}</div>}
              <div className="sys-tags"><B m={HOSTING} v={s.hosting} /><span className="badge grey">{KIND[s.kind] || s.kind}</span>{s.version && <span className="badge grey">v{String(s.version).replace(/^v/, '')}</span>}</div>
              <div className="sys-facts">
                <span>{s.uptime30 !== null && s.uptime30 !== undefined ? <><b>{String(s.uptime30).replace('.', ',')} %</b> erreichbar (30 T.)</> : s.monitor ? 'noch keine Messung' : 'keine Überwachung'}</span>
                {s.mrr > 0 && <span><b>{fmtMoney(s.mrr)}</b>/Monat</span>}
                {s.n_licenses > 0 && <span>{s.n_licenses} Lizenz(en)</span>}
              </div>
              {(soon(s.domain_expires) || soon(s.ssl_expires, 14)) && <div className="sys-warn">⚠ {soon(s.domain_expires) ? `Domain bis ${fmtDate(s.domain_expires)}` : `SSL bis ${fmtDate(s.ssl_expires)}`}</div>}
              {s.prod_url && <div className="muted sys-url">{s.prod_url.replace(/^https?:\/\//, '')}</div>}
            </button>
          ))}
        </div>
      )}
      {edit && <SystemForm sys={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {open && <SystemDrawer id={open} list={list || []} onClose={() => setOpen(null)} onEdit={(s) => { setOpen(null); setEdit(s); }} onChanged={reload} />}
    </div>
  );
}

function SystemForm({ sys, onClose, onSaved }: { sys: any; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<any>({ ...sys });
  const { busy, run } = useAction();
  const f = (k: string) => (e: any) => setV({ ...v, [k]: e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value });
  const save = () => run('s', async () => { v.id ? await api.put(`/clients/systems/${v.id}`, v) : await api.post('/clients/systems', v); onSaved(); }, 'System gespeichert');
  const del = () => confirmDel('System') && run('d', async () => { await api.del(`/clients/systems/${v.id}`); onSaved(); });
  return (
    <Modal wide title={v.id ? 'System bearbeiten' : 'Neues System'} onClose={onClose} footer={<>{v.id && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={del}>Löschen</button>}<button className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary" disabled={!!busy || !v.name || !v.company_id} onClick={save}>Speichern</button></>}>
      <div className="form c3">
        <Field label="Name" span={2}><input value={v.name || ''} onChange={f('name')} placeholder="z. B. Kundenportal Muster GmbH" /></Field>
        <Field label="Art"><select value={v.kind} onChange={f('kind')}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Kunde" span={2}><SelectCompany value={v.company_id} onChange={(id) => setV({ ...v, company_id: id })} /></Field>
        <Field label="Status"><select value={v.status} onChange={f('status')}>{Object.entries(SYS_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Betrieb / Hosting"><select value={v.hosting} onChange={f('hosting')}>{Object.entries(HOSTING).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Hosting-Details" span={2} hint="Server, Region, Ansprechpartner IT beim Kunden …"><input value={v.hosting_note || ''} onChange={f('hosting_note')} /></Field>
        <Field label="Live-Adresse" span={2}><input value={v.prod_url || ''} onChange={f('prod_url')} placeholder="https://app.kunde.de" /></Field>
        <Field label="Test-Adresse"><input value={v.staging_url || ''} onChange={f('staging_url')} /></Field>
        <Field label="Admin-Adresse"><input value={v.admin_url || ''} onChange={f('admin_url')} /></Field>
        <Field label="Repository"><input value={v.repo_url || ''} onChange={f('repo_url')} placeholder="https://github.com/…" /></Field>
        <Field label="Cloudflare-Worker / Projekt"><input value={v.cf_worker || ''} onChange={f('cf_worker')} /></Field>
        <Field label="Version"><input value={v.version || ''} onChange={f('version')} /></Field>
        <Field label="Technik" span={2}><input value={v.stack || ''} onChange={f('stack')} placeholder="React, Cloudflare Workers, D1, R2" /></Field>
        <Field label="Domain"><input value={v.domain || ''} onChange={f('domain')} placeholder="kunde.de" /></Field>
        <Field label="Domain läuft ab"><input type="date" value={v.domain_expires || ''} onChange={f('domain_expires')} /></Field>
        <Field label="SSL läuft ab" hint="Bei Cloudflare automatisch – leer lassen"><input type="date" value={v.ssl_expires || ''} onChange={f('ssl_expires')} /></Field>
        <Field label="Backup" span={2}><input value={v.backup_info || ''} onChange={f('backup_info')} placeholder="z. B. D1 Time Travel 30 Tage + wöchentlicher Export" /></Field>
        <Field label="Letztes Backup geprüft"><input type="date" value={v.last_backup_at || ''} onChange={f('last_backup_at')} /></Field>
        <Field label="Wartung inkl. (h/Monat)"><input type="number" value={v.maintenance_hours || 0} onChange={f('maintenance_hours')} /></Field>
        <Field label="SLA" span={2}><input value={v.sla || ''} onChange={f('sla')} placeholder="z. B. Reaktion 4 h werktags, Verfügbarkeit 99,5 %" /></Field>
        <Field label="Notizen" span={3}><textarea rows={3} value={v.notes || ''} onChange={f('notes')} /></Field>
        <label className="check full"><input type="checkbox" checked={!!v.monitor} onChange={f('monitor')} /> Erreichbarkeit alle 15 Minuten prüfen – bei Ausfall entsteht sofort eine Aufgabe mit hoher Priorität</label>
      </div>
    </Modal>
  );
}

function SystemDrawer({ id, list, onClose, onEdit, onChanged }: { id: string; list: any[]; onClose: () => void; onEdit: (s: any) => void; onChanged: () => void }) {
  const s = list.find((x) => x.id === id);
  const [checks, reloadChecks] = useLoad<any[]>(`/clients/systems/${id}/checks`);
  const [rels, reloadRels] = useLoad<any[]>(`/clients/releases?system_id=${id}`);
  const [rel, setRel] = useState<any>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  if (!s) return null;
  const check = () => run('c', async () => { const r = await api.post(`/clients/systems/${id}/check`); toast(r.ok ? `Erreichbar · HTTP ${r.status} · ${r.ms} ms` : `Nicht erreichbar: ${r.error || r.status}`, r.ok ? 'ok' : 'err'); reloadChecks(); onChanged(); });
  const addRel = () => run('r', async () => { await api.post('/clients/releases', { ...rel, system_id: id }); setRel(null); reloadRels(); onChanged(); }, 'Release gespeichert');
  const row = (l: string, v: React.ReactNode) => (v ? <><dt>{l}</dt><dd>{v}</dd></> : null);
  const link = (u?: string) => u ? <a href={u} target="_blank" rel="noreferrer">{u.replace(/^https?:\/\//, '')}</a> : null;
  return (
    <Modal wide title={s.name} onClose={onClose} footer={<><button className="btn" onClick={() => onEdit(s)}>Bearbeiten</button><button className="btn" disabled={!!busy || !s.prod_url} onClick={check}>Jetzt prüfen</button><button className="btn primary" onClick={() => setRel({ version: '', title: '', notes: '', released_at: new Date().toISOString().slice(0, 10) })}>+ Release</button></>}>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 22 }}>
        <dl className="dl" style={{ gridTemplateColumns: '120px 1fr' }}>
          {row('Kunde', <a href={`#/companies/${s.company_id}`}>{s.company_name}</a>)}
          {row('Status', <B m={SYS_STATUS} v={s.status} />)}
          {row('Betrieb', <><B m={HOSTING} v={s.hosting} /> {s.hosting_note}</>)}
          {row('Live', link(s.prod_url))}
          {row('Test', link(s.staging_url))}
          {row('Admin', link(s.admin_url))}
          {row('Repository', link(s.repo_url))}
          {row('Cloudflare', s.cf_worker)}
          {row('Version', s.version)}
          {row('Technik', s.stack)}
          {row('Domain', s.domain && <>{s.domain}{s.domain_expires && <span className={past(s.domain_expires) || soon(s.domain_expires) ? 'warn-text' : 'muted'}> · bis {fmtDate(s.domain_expires)}</span>}</>)}
          {row('SSL', s.ssl_expires && <span className={soon(s.ssl_expires, 14) ? 'warn-text' : ''}>bis {fmtDate(s.ssl_expires)}</span>)}
          {row('Backup', s.backup_info && <>{s.backup_info}{s.last_backup_at && <span className="muted"> · geprüft {fmtDate(s.last_backup_at)}</span>}</>)}
          {row('Wartung', s.maintenance_hours ? `${s.maintenance_hours} h/Monat inklusive` : null)}
          {row('SLA', s.sla)}
          {row('Notizen', s.notes && <span className="pre">{s.notes}</span>)}
        </dl>
        <div className="stack">
          <div>
            <h4 style={{ marginBottom: 8 }}>Erreichbarkeit {s.uptime30 != null && <span className="muted">· {String(s.uptime30).replace('.', ',')} % in 30 Tagen</span>}</h4>
            {!s.monitor ? <div className="muted" style={{ fontSize: 13 }}>Überwachung ist aus. Unter „Bearbeiten“ einschalten.</div> : !checks ? <Spinner /> : checks.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>Noch keine Messung – „Jetzt prüfen“ oder 15 Minuten warten.</div> : (
              <>
                <div className="uptime">{[...checks].reverse().map((k, i) => <i key={i} className={k.ok ? 'ok' : 'bad'} title={`${fmtDateTime(k.at)} · ${k.ok ? `HTTP ${k.status} · ${k.ms} ms` : k.error || k.status}`} />)}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Letzte Prüfung {fmtDateTime(checks[0].at)} · {checks[0].ok ? `HTTP ${checks[0].status}, ${checks[0].ms} ms` : `Fehler: ${checks[0].error || checks[0].status}`}</div>
              </>
            )}
          </div>
          <div>
            <h4 style={{ marginBottom: 8 }}>Releases</h4>
            {!rels ? <Spinner /> : rels.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>Noch keine Releases erfasst. Releases erscheinen im Monatsbericht an den Kunden.</div> : (
              <div className="timeline">
                {rels.map((r) => (
                  <div className="tl-item" key={r.id}>
                    <div className="tl-dot tint-orange">↑</div>
                    <div className="tl-body">
                      <div className="tl-title">{r.version}{r.title ? ` – ${r.title}` : ''}</div>
                      <div className="tl-meta">{fmtDate(r.released_at)}</div>
                      {r.notes && <div className="tl-text open">{r.notes}</div>}
                    </div>
                    <button className="icon-btn" title="Löschen" onClick={() => confirmDel('Release') && run('dr', async () => { await api.del(`/clients/releases/${r.id}`); reloadRels(); })}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {rel && (
        <Modal title="Release erfassen" onClose={() => setRel(null)} footer={<><button className="btn" onClick={() => setRel(null)}>Abbrechen</button><button className="btn primary" disabled={!!busy || !rel.version} onClick={addRel}>Speichern</button></>}>
          <div className="form">
            <Field label="Version"><input value={rel.version} onChange={(e) => setRel({ ...rel, version: e.target.value })} placeholder="1.4.0" /></Field>
            <Field label="Datum"><input type="date" value={rel.released_at} onChange={(e) => setRel({ ...rel, released_at: e.target.value })} /></Field>
            <Field label="Titel" span={2}><input value={rel.title} onChange={(e) => setRel({ ...rel, title: e.target.value })} placeholder="z. B. Neues Dashboard" /></Field>
            <Field label="Was ist neu? (für den Kunden verständlich)" span={2}><textarea rows={4} value={rel.notes} onChange={(e) => setRel({ ...rel, notes: e.target.value })} /></Field>
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>Die Version des Systems wird automatisch aktualisiert.</p>
        </Modal>
      )}
    </Modal>
  );
}

// ================================================================ Abos & Abrechnung
export function SubscriptionsList({ companyId }: { companyId?: string }) {
  const [list, reload, , err] = useLoad<any[]>(`/clients/subscriptions${companyId ? `?company_id=${companyId}` : ''}`);
  const [edit, setEdit] = useState<any>(null);
  if (err) return <Setup err={err} />;
  const mrr = (list || []).reduce((a, s) => a + s.mrr, 0);
  return (
    <div className="card flush">
      <div className="card-head"><h2>Abos & Wartungsverträge</h2><div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{mrr > 0 && <span className="muted"><b style={{ color: 'var(--ink)' }}>{fmtMoney(mrr)}</b> / Monat</span>}<button className="btn sm primary" onClick={() => setEdit({ company_id: companyId || '', interval: 'month', currency: 'EUR', status: 'active', billing_day: 1, notice_days: 30, start_date: new Date().toISOString().slice(0, 10), amount: '', included_hours: 0, overage_rate: 0 })}>+ Abo</button></div></div>
      {!list ? <div style={{ padding: 20 }}><Spinner /></div> : list.length === 0 ? <Empty title="Keine Abos" text="Monatliche Gebühren für Hosting, Wartung oder SaaS – die Abrechnung wird automatisch fällig gestellt." /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Abo</th>{!companyId && <th>Kunde</th>}<th className="hide-m">Rhythmus</th><th className="num">Betrag</th><th className="hide-m">Stunden diesen Monat</th><th>Status</th></tr></thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id} className="click" onClick={() => setEdit(s)}>
                <td><b>{s.name}</b>{s.system_name && <div className="muted" style={{ fontSize: 12 }}>{s.system_name}</div>}</td>
                {!companyId && <td>{s.company_name}</td>}
                <td className="hide-m">{INTERVAL[s.interval]} · ab {fmtDate(s.start_date)}{s.end_date && <> · bis {fmtDate(s.end_date)}</>}</td>
                <td className="num"><b>{fmtMoney2(s.amount, s.currency)}</b></td>
                <td className="hide-m">{s.included_hours > 0 ? <HoursBar used={s.hours_used} incl={s.included_hours} /> : <span className="muted">–</span>}</td>
                <td>{s.status === 'active' ? <span className="badge green">Aktiv</span> : s.status === 'paused' ? <span className="badge amber">Pausiert</span> : <span className="badge grey">Gekündigt</span>}{s.open_periods > 0 && <span className="badge amber" style={{ marginLeft: 4 }}>{s.open_periods} offen</span>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {edit && <SubForm sub={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

export function HoursBar({ used, incl }: { used: number; incl: number }) {
  const pct = incl ? Math.min(100, (used / incl) * 100) : 0;
  return (
    <div style={{ minWidth: 130 }}>
      <div className="bar" style={{ height: 6 }}><div style={{ width: `${pct}%`, background: used > incl ? 'var(--red)' : pct >= 80 ? 'var(--amber)' : undefined }} /></div>
      <span className="muted" style={{ fontSize: 11.5 }}>{used.toFixed(1).replace('.', ',')} / {incl} h{used > incl ? ' · überschritten' : ''}</span>
    </div>
  );
}

function SubForm({ sub, onClose, onSaved }: { sub: any; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<any>({ ...sub });
  const [systems] = useLoad<any[]>(v.company_id ? `/clients/systems?company_id=${v.company_id}` : null, [v.company_id]);
  const { busy, run } = useAction();
  const f = (k: string) => (e: any) => setV({ ...v, [k]: e.target.value });
  const save = () => run('s', async () => { const b = { ...v, amount: Number(v.amount) || 0, included_hours: Number(v.included_hours) || 0, overage_rate: Number(v.overage_rate) || 0, notice_days: Number(v.notice_days) || 0, billing_day: Number(v.billing_day) || 1 }; v.id ? await api.put(`/clients/subscriptions/${v.id}`, b) : await api.post('/clients/subscriptions', b); onSaved(); }, 'Abo gespeichert');
  const del = () => confirmDel('Abo') && run('d', async () => { await api.del(`/clients/subscriptions/${v.id}`); onSaved(); });
  return (
    <Modal wide title={v.id ? 'Abo bearbeiten' : 'Neues Abo'} onClose={onClose} footer={<>{v.id && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={del}>Löschen</button>}<button className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary" disabled={!!busy || !v.name || !v.company_id} onClick={save}>Speichern</button></>}>
      <div className="form c3">
        <Field label="Bezeichnung" span={2}><input value={v.name || ''} onChange={f('name')} placeholder="Hosting & Wartung Business" /></Field>
        <Field label="Status"><select value={v.status} onChange={f('status')}><option value="active">Aktiv</option><option value="paused">Pausiert</option><option value="cancelled">Gekündigt</option></select></Field>
        <Field label="Kunde" span={2}><SelectCompany value={v.company_id} onChange={(id) => setV({ ...v, company_id: id, system_id: '' })} /></Field>
        <Field label="System"><select value={v.system_id || ''} onChange={f('system_id')}><option value="">– alle –</option>{(systems || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Betrag netto"><input type="number" value={v.amount} onChange={f('amount')} /></Field>
        <Field label="Währung"><select value={v.currency} onChange={f('currency')}><option>EUR</option><option>USD</option><option>CHF</option><option>PLN</option></select></Field>
        <Field label="Rhythmus"><select value={v.interval} onChange={f('interval')}>{Object.entries(INTERVAL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Beginn"><input type="date" value={v.start_date || ''} onChange={f('start_date')} /></Field>
        <Field label="Ende (gekündigt zum)"><input type="date" value={v.end_date || ''} onChange={f('end_date')} /></Field>
        <Field label="Rechnung am (Tag)"><input type="number" min={1} max={28} value={v.billing_day} onChange={f('billing_day')} /></Field>
        <Field label="Inklusive Stunden / Monat" hint="Zeiterfassung wird dagegen gezählt"><input type="number" step="0.5" value={v.included_hours} onChange={f('included_hours')} /></Field>
        <Field label="Stundensatz darüber"><input type="number" value={v.overage_rate} onChange={f('overage_rate')} /></Field>
        <Field label="Kündigungsfrist (Tage)"><input type="number" value={v.notice_days} onChange={f('notice_days')} /></Field>
        <Field label="Leistungsumfang" span={3}><textarea rows={3} value={v.includes || ''} onChange={f('includes')} placeholder="Hosting in der EU, Backups, Updates, Monitoring, 4 h Support/Monat" /></Field>
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>Am Rechnungstag entsteht automatisch ein Abrechnungszeitraum und eine Aufgabe „Rechnung stellen“.</p>
    </Modal>
  );
}

export function PeriodsList({ companyId }: { companyId?: string }) {
  const [st, setSt] = useState('unpaid');
  const [list, reload, , err] = useLoad<any[]>(`/clients/periods?status=${st}${companyId ? `&company_id=${companyId}` : ''}`);
  const { busy, run } = useAction();
  if (err) return <Setup err={err} />;
  const set = (p: any, status: string) => run('p' + p.id, async () => {
    const invoice_no = status === 'invoiced' && !p.invoice_no ? prompt('Rechnungsnummer (optional)', '') : undefined;
    await api.put(`/clients/periods/${p.id}`, { status, ...(invoice_no !== undefined && invoice_no !== null ? { invoice_no } : {}) });
    reload();
  });
  const sum = (list || []).reduce((a, p) => a + p.amount, 0);
  return (
    <div className="card flush">
      <div className="card-head">
        <h2>Abrechnung</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {st === 'unpaid' && sum > 0 && <span className="muted">offen: <b style={{ color: 'var(--ink)' }}>{fmtMoney(sum)}</b></span>}
          <div className="seg">{[['unpaid', 'Offen'], ['paid', 'Bezahlt'], ['', 'Alle']].map(([k, l]) => <button key={k} className={st === k ? 'active' : ''} onClick={() => setSt(k)}>{l}</button>)}</div>
          <button className="btn sm ghost" disabled={!!busy} onClick={() => run('run', async () => { const r = await api.post('/clients/periods/run'); reload(); return r; }, 'Fällige Zeiträume geprüft')}>Jetzt prüfen</button>
        </div>
      </div>
      {!list ? <div style={{ padding: 20 }}><Spinner /></div> : list.length === 0 ? <Empty title={st === 'unpaid' ? 'Nichts offen' : 'Keine Einträge'} text="Zeiträume entstehen automatisch aus den Abos." /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Zeitraum</th>{!companyId && <th>Kunde</th>}<th className="hide-m">Abo</th><th className="num">Betrag</th><th className="hide-m">Fällig</th><th>Status</th><th /></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td><b>{p.period}</b></td>
                {!companyId && <td>{p.company_name}</td>}
                <td className="hide-m">{p.sub_name}</td>
                <td className="num">{fmtMoney2(p.amount, p.currency)}</td>
                <td className="hide-m"><span className={p.overdue ? 'warn-text' : ''}>{fmtDate(p.due_date)}</span></td>
                <td><B m={PERIOD_ST} v={p.status} />{p.invoice_no && <div className="muted" style={{ fontSize: 11.5 }}>{p.invoice_no}</div>}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  {p.status === 'open' && <button className="btn sm" disabled={!!busy} onClick={() => set(p, 'invoiced')}>Gestellt</button>}
                  {p.status !== 'paid' && <button className="btn sm primary" style={{ marginLeft: 4 }} disabled={!!busy} onClick={() => set(p, 'paid')}>Bezahlt</button>}
                  {p.status === 'paid' && <button className="btn sm ghost" disabled={!!busy} onClick={() => set(p, 'open')}>Zurücksetzen</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}

// ================================================================ Lizenzen
export function LicensesList({ companyId }: { companyId?: string }) {
  const [list, reload, , err] = useLoad<any[]>(`/clients/licenses${companyId ? `?company_id=${companyId}` : ''}`);
  const [edit, setEdit] = useState<any>(null);
  const [pub, setPub] = useState<any>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  if (err) return <Setup err={err} />;
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast('Lizenzschlüssel kopiert'); } catch { prompt('Kopieren:', t); } };
  return (
    <div className="card flush">
      <div className="card-head"><h2>Lizenzen (On-Premise & Fremd-Cloud)</h2><div style={{ display: 'flex', gap: 8 }}><button className="btn sm ghost" onClick={() => run('pk', async () => setPub(await api.get('/clients/licenses-public-key')))}>Prüfschlüssel</button><button className="btn sm primary" onClick={() => setEdit({ company_id: companyId || '', edition: 'Business', seats: 10, modules: '', valid_from: new Date().toISOString().slice(0, 10), valid_until: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10), status: 'active' })}>+ Lizenz</button></div></div>
      {!list ? <div style={{ padding: 20 }}><Spinner /></div> : list.length === 0 ? <Empty title="Keine Lizenzen" text="Für Kunden, die eure Software auf eigenen Servern oder in einer anderen Cloud betreiben: signierter Lizenzschlüssel mit Laufzeit, Nutzerzahl und Modulen." /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Lizenz</th>{!companyId && <th>Kunde</th>}<th className="hide-m">Nutzer · Module</th><th>Gültig bis</th><th /></tr></thead>
          <tbody>
            {list.map((l) => (
              <tr key={l.id}>
                <td className="click" onClick={() => setEdit(l)}><b>{l.edition}</b>{l.system_name && <div className="muted" style={{ fontSize: 12 }}>{l.system_name}{l.hosting ? ` · ${HOSTING[l.hosting]?.[0]}` : ''}</div>}</td>
                {!companyId && <td>{l.company_name}</td>}
                <td className="hide-m">{l.seats ? `${l.seats} Nutzer` : 'unbegrenzt'}{l.modules && <div className="muted" style={{ fontSize: 12 }}>{l.modules}</div>}</td>
                <td>{l.status === 'revoked' ? <span className="badge red">Widerrufen</span> : l.valid_until ? <span className={past(l.valid_until) ? 'badge red' : soon(l.valid_until) ? 'badge amber' : 'badge green'}>{fmtDate(l.valid_until)}</span> : <span className="badge green">unbefristet</span>}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn sm" onClick={() => copy(l.license_key)}>Schlüssel kopieren</button>
                  <button className="btn sm ghost" style={{ marginLeft: 4 }} disabled={!!busy} onClick={() => run('rn' + l.id, async () => { await api.post(`/clients/licenses/${l.id}/renew`); reload(); }, 'Um 12 Monate verlängert und neu signiert')}>+12 Monate</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {edit && <LicenseForm lic={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {pub && (
        <Modal title="Prüfschlüssel für eure Software" onClose={() => setPub(null)}>
          <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>Diesen öffentlichen Schlüssel in die ausgelieferte Software einbauen. Sie prüft damit den Lizenzschlüssel offline – ohne Verbindung zu devunox.</p>
          <Field label="Öffentlicher Schlüssel (Ed25519, base64url)"><input readOnly value={pub.public_key} onFocus={(e) => e.target.select()} /></Field>
          <p className="muted" style={{ fontSize: 12.5 }}>Format: {pub.format}</p>
        </Modal>
      )}
    </div>
  );
}

function LicenseForm({ lic, onClose, onSaved }: { lic: any; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<any>({ ...lic });
  const [systems] = useLoad<any[]>(v.company_id ? `/clients/systems?company_id=${v.company_id}` : null, [v.company_id]);
  const { busy, run } = useAction();
  const f = (k: string) => (e: any) => setV({ ...v, [k]: e.target.value });
  const save = () => run('s', async () => { const b = { ...v, seats: Number(v.seats) || 0 }; v.id ? await api.put(`/clients/licenses/${v.id}`, b) : await api.post('/clients/licenses', b); onSaved(); }, 'Lizenz gespeichert und signiert');
  const del = () => confirmDel('Lizenz') && run('d', async () => { await api.del(`/clients/licenses/${v.id}`); onSaved(); });
  return (
    <Modal wide title={v.id ? 'Lizenz bearbeiten' : 'Neue Lizenz'} onClose={onClose} footer={<>{v.id && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={del}>Löschen</button>}<button className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary" disabled={!!busy || !v.company_id} onClick={save}>Speichern & signieren</button></>}>
      <div className="form c3">
        <Field label="Kunde" span={2}><SelectCompany value={v.company_id} onChange={(id) => setV({ ...v, company_id: id, system_id: '' })} /></Field>
        <Field label="System"><select value={v.system_id || ''} onChange={f('system_id')}><option value="">–</option>{(systems || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Edition"><input value={v.edition} onChange={f('edition')} /></Field>
        <Field label="Nutzer (0 = unbegrenzt)"><input type="number" value={v.seats} onChange={f('seats')} /></Field>
        <Field label="Status"><select value={v.status} onChange={f('status')}><option value="active">Aktiv</option><option value="revoked">Widerrufen</option></select></Field>
        <Field label="Gültig ab"><input type="date" value={v.valid_from || ''} onChange={f('valid_from')} /></Field>
        <Field label="Gültig bis"><input type="date" value={v.valid_until || ''} onChange={f('valid_until')} /></Field>
        <Field label="Module (kommagetrennt)"><input value={v.modules || ''} onChange={f('modules')} placeholder="crm, dms, portal" /></Field>
        <Field label="Notizen" span={3}><textarea rows={2} value={v.notes || ''} onChange={f('notes')} /></Field>
        {v.license_key && <Field label="Lizenzschlüssel" span={3}><textarea rows={3} readOnly value={v.license_key} onFocus={(e) => e.target.select()} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }} /></Field>}
      </div>
    </Modal>
  );
}

// ================================================================ Verträge & Compliance
export function ContractsList({ companyId }: { companyId?: string }) {
  const [list, reload, , err] = useLoad<any[]>(`/clients/contracts${companyId ? `?company_id=${companyId}` : ''}`);
  const [edit, setEdit] = useState<any>(null);
  if (err) return <Setup err={err} />;
  return (
    <div className="card flush">
      <div className="card-head"><h2>Verträge & Compliance</h2><button className="btn sm primary" onClick={() => setEdit({ company_id: companyId || '', kind: 'framework', title: '', status: 'draft', notice_days: 90, auto_renew: 1, renew_months: 12 })}>+ Vertrag</button></div>
      {!list ? <div style={{ padding: 20 }}><Spinner /></div> : list.length === 0 ? <Empty title="Keine Verträge" text="Rahmenvertrag, AVV, SLA, NDA – mit Laufzeit, Kündigungsfrist und Erinnerung vor dem Stichtag." /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Vertrag</th>{!companyId && <th>Kunde</th>}<th>Status</th><th className="hide-m">Laufzeit</th><th>Kündigen bis</th></tr></thead>
          <tbody>
            {list.map((k) => (
              <tr key={k.id} className="click" onClick={() => setEdit(k)}>
                <td><b>{k.title}</b><div className="muted" style={{ fontSize: 12 }}>{CONTRACT_KIND[k.kind]}{k.document_name ? ` · 📎 ${k.document_name}` : ''}</div></td>
                {!companyId && <td>{k.company_name}</td>}
                <td><B m={CONTRACT_ST} v={k.status} /></td>
                <td className="hide-m">{!k.start_date && !k.end_date ? 'unbefristet' : `${k.start_date ? fmtDate(k.start_date) : '…'} – ${k.end_date ? fmtDate(k.end_date) : 'unbefristet'}`}{k.auto_renew && k.end_date ? <div className="muted" style={{ fontSize: 11.5 }}>verlängert sich um {k.renew_months} Mon.</div> : null}</td>
                <td>{k.notice_deadline ? <span className={past(k.notice_deadline) ? 'muted' : soon(k.notice_deadline, 45) ? 'badge amber' : ''}>{fmtDate(k.notice_deadline)}</span> : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {edit && <ContractForm k={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function ContractForm({ k, onClose, onSaved }: { k: any; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<any>({ ...k });
  const [docs] = useLoad<{ files: any[] }>(v.company_id ? `/documents?company_id=${v.company_id}` : null, [v.company_id]);
  const { busy, run } = useAction();
  const f = (key: string) => (e: any) => setV({ ...v, [key]: e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value });
  const save = () => run('s', async () => { const b = { ...v, notice_days: Number(v.notice_days) || 0, renew_months: Number(v.renew_months) || 12, title: v.title || CONTRACT_KIND[v.kind] }; v.id ? await api.put(`/clients/contracts/${v.id}`, b) : await api.post('/clients/contracts', b); onSaved(); }, 'Vertrag gespeichert');
  const del = () => confirmDel('Vertrag') && run('d', async () => { await api.del(`/clients/contracts/${v.id}`); onSaved(); });
  return (
    <Modal wide title={v.id ? 'Vertrag bearbeiten' : 'Neuer Vertrag'} onClose={onClose} footer={<>{v.id && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={del}>Löschen</button>}<button className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary" disabled={!!busy || !v.company_id} onClick={save}>Speichern</button></>}>
      <div className="form c3">
        <Field label="Art"><select value={v.kind} onChange={f('kind')}>{Object.entries(CONTRACT_KIND).map(([key, l]) => <option key={key} value={key}>{l}</option>)}</select></Field>
        <Field label="Titel" span={2}><input value={v.title || ''} onChange={f('title')} placeholder={CONTRACT_KIND[v.kind]} /></Field>
        <Field label="Kunde" span={2}><SelectCompany value={v.company_id} onChange={(id) => setV({ ...v, company_id: id, document_id: '' })} /></Field>
        <Field label="Status"><select value={v.status} onChange={f('status')}>{Object.entries(CONTRACT_ST).map(([key, [l]]) => <option key={key} value={key}>{l}</option>)}</select></Field>
        <Field label="Unterschrieben am"><input type="date" value={v.signed_at || ''} onChange={f('signed_at')} /></Field>
        <Field label="Beginn"><input type="date" value={v.start_date || ''} onChange={f('start_date')} /></Field>
        <Field label="Ende / nächster Stichtag"><input type="date" value={v.end_date || ''} onChange={f('end_date')} /></Field>
        <Field label="Kündigungsfrist (Tage)"><input type="number" value={v.notice_days} onChange={f('notice_days')} /></Field>
        <Field label="Verlängerung (Monate)"><input type="number" value={v.renew_months} onChange={f('renew_months')} /></Field>
        <label className="check" style={{ alignSelf: 'end', paddingBottom: 10 }}><input type="checkbox" checked={!!v.auto_renew} onChange={f('auto_renew')} /> verlängert sich automatisch</label>
        <Field label="Dokument aus der Ablage" span={3}>
          <select value={v.document_id || ''} onChange={f('document_id')}><option value="">– keines –</option>{(docs?.files || []).map((d) => <option key={d.id} value={d.id}>{d.folder}{d.name}</option>)}</select>
        </Field>
        <Field label="Notizen" span={3}><textarea rows={2} value={v.notes || ''} onChange={f('notes')} /></Field>
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>45 Tage vor Ablauf der Kündigungsfrist entsteht eine Aufgabe – so verpasst du keinen Stichtag.</p>
    </Modal>
  );
}

// ================================================================ Checklisten
export function Checklists({ companyId }: { companyId: string }) {
  const [list, reload, , err] = useLoad<any[]>(`/clients/checklists?company_id=${companyId}`);
  const [neu, setNeu] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  if (err) return <Setup err={err} />;
  const create = (kind: string) => run('c', async () => { await api.post('/clients/checklists', { company_id: companyId, kind }); reload(); });
  const toggle = (it: any) => run('t', async () => { await api.put(`/clients/checklist-items/${it.id}`, { done: !it.done }); reload(); });
  return (
    <div className="card">
      <div className="card-head"><h2>Onboarding & Offboarding</h2><div style={{ display: 'flex', gap: 6 }}><button className="btn sm" disabled={!!busy} onClick={() => create('onboarding')}>+ Onboarding</button><button className="btn sm" disabled={!!busy} onClick={() => create('offboarding')}>+ Offboarding</button></div></div>
      {!list ? <Spinner /> : list.length === 0 ? <Empty title="Keine Checkliste" text="Startet mit einer Vorlage: alles, was bei einem neuen oder scheidenden Kunden erledigt sein muss." /> : list.map((cl) => {
        const done = cl.items.filter((i: any) => i.done).length;
        return (
          <div key={cl.id} className="checklist">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <b>{cl.title}</b>
              <span className="muted" style={{ fontSize: 12.5 }}>{done}/{cl.items.length} erledigt <button className="icon-btn" title="Checkliste löschen" onClick={() => confirmDel('Checkliste') && run('d', async () => { await api.del(`/clients/checklists/${cl.id}`); reload(); })}>✕</button></span>
            </div>
            <div className="bar" style={{ margin: '8px 0 10px' }}><div style={{ width: `${cl.items.length ? (done / cl.items.length) * 100 : 0}%` }} /></div>
            {cl.items.map((it: any) => (
              <label key={it.id} className={`check-item ${it.done ? 'done' : ''}`}>
                <input type="checkbox" checked={!!it.done} onChange={() => toggle(it)} />
                <span>{it.label}{it.hint && <span className="muted"> · {it.hint}</span>}{!!it.done && it.done_at && <span className="muted" style={{ fontSize: 11.5 }}> · {fmtDate(it.done_at)}{it.done_by ? ` · ${it.done_by}` : ''}</span>}</span>
              </label>
            ))}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <input placeholder="Punkt hinzufügen" value={neu[cl.id] || ''} onChange={(e) => setNeu({ ...neu, [cl.id]: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && neu[cl.id]) run('a', async () => { await api.post(`/clients/checklists/${cl.id}/items`, { label: neu[cl.id] }); setNeu({ ...neu, [cl.id]: '' }); reload(); }); }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ================================================================ Zugangsdaten-Tresor
export function VaultList({ companyId }: { companyId?: string }) {
  const [list, reload, , err] = useLoad<any[]>(`/clients/vault${companyId ? `?company_id=${companyId}` : ''}`);
  const [edit, setEdit] = useState<any>(null);
  const [shown, setShown] = useState<Record<string, string>>({});
  const [log, setLog] = useState<any[] | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  if (err) return <Setup err={err} />;
  const reveal = (v: any) => run('r' + v.id, async () => {
    const r = await api.post(`/clients/vault/${v.id}/reveal`);
    setShown({ ...shown, [v.id]: r.secret });
    setTimeout(() => setShown((s) => { const n = { ...s }; delete n[v.id]; return n; }), 30000);
  });
  const copy = (v: any) => run('c' + v.id, async () => {
    const r = await api.post(`/clients/vault/${v.id}/reveal`);
    try { await navigator.clipboard.writeText(r.secret); toast('Passwort kopiert – Zugriff protokolliert'); } catch { prompt('Kopieren:', r.secret); }
  });
  return (
    <div className="card flush">
      <div className="card-head"><h2>🔒 Zugangsdaten-Tresor</h2><button className="btn sm primary" onClick={() => setEdit({ company_id: companyId || '', label: '', url: '', username: '', secret: '', notes: '' })}>+ Zugang</button></div>
      {!list ? <div style={{ padding: 20 }}><Spinner /></div> : list.length === 0 ? <Empty title="Tresor ist leer" text="Hosting-, DNS-, Admin- und API-Zugänge eurer Kunden – verschlüsselt gespeichert, jeder Zugriff wird protokolliert." /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Zugang</th>{!companyId && <th>Kunde</th>}<th className="hide-m">Benutzer</th><th>Passwort</th><th /></tr></thead>
          <tbody>
            {list.map((v) => (
              <tr key={v.id}>
                <td><b>{v.label}</b>{v.url && <div><a href={v.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>{v.url.replace(/^https?:\/\//, '')}</a></div>}{v.system_name && <div className="muted" style={{ fontSize: 12 }}>{v.system_name}</div>}</td>
                {!companyId && <td>{v.company_name}</td>}
                <td className="hide-m"><code>{v.username || '–'}</code></td>
                <td>{v.has_secret ? (shown[v.id] !== undefined ? <code className="secret">{shown[v.id]}</code> : <span className="muted">••••••••</span>) : '–'}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  {v.has_secret ? <><button className="btn sm" disabled={!!busy} onClick={() => reveal(v)}>Anzeigen</button><button className="btn sm" style={{ marginLeft: 4 }} disabled={!!busy} onClick={() => copy(v)}>Kopieren</button></> : null}
                  <button className="icon-btn" title="Bearbeiten" onClick={() => setEdit({ ...v, secret: undefined })}>✎</button>
                  <button className="icon-btn" title="Zugriffsprotokoll" onClick={() => run('l', async () => setLog(await api.get(`/clients/vault/${v.id}/log`)))}>🕘</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <p className="muted" style={{ fontSize: 12, padding: '0 22px 16px', margin: 0 }}>Passwörter sind mit dem Schlüssel ENCRYPTION_KEY verschlüsselt. Angezeigte Passwörter verschwinden nach 30 Sekunden.</p>
      {edit && <VaultForm v0={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {log && (
        <Modal title="Zugriffsprotokoll" onClose={() => setLog(null)}>
          {log.length === 0 ? <div className="muted">Keine Einträge.</div> : log.map((l) => <div key={l.id} style={{ fontSize: 13, padding: '5px 0', borderBottom: '1px solid var(--line)' }}><b>{({ reveal: 'Angezeigt/kopiert', create: 'Angelegt', update: 'Geändert', delete: 'Gelöscht' } as any)[l.action] || l.action}</b> · {l.user_email} · {fmtDateTime(l.at)}</div>)}
        </Modal>
      )}
    </div>
  );
}

function VaultForm({ v0, onClose, onSaved }: { v0: any; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<any>({ ...v0 });
  const [systems] = useLoad<any[]>(v.company_id ? `/clients/systems?company_id=${v.company_id}` : null, [v.company_id]);
  const { busy, run } = useAction();
  const f = (k: string) => (e: any) => setV({ ...v, [k]: e.target.value });
  const save = () => run('s', async () => { const b = { ...v }; if (v.id && !v.secret) delete b.secret; v.id ? await api.put(`/clients/vault/${v.id}`, b) : await api.post('/clients/vault', b); onSaved(); }, 'Zugang gespeichert');
  const del = () => confirmDel('Zugang') && run('d', async () => { await api.del(`/clients/vault/${v.id}`); onSaved(); });
  const gen = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!#%+-='; setV({ ...v, secret: [...crypto.getRandomValues(new Uint8Array(20))].map((x) => a[x % a.length]).join('') }); };
  return (
    <Modal title={v.id ? 'Zugang bearbeiten' : 'Neuer Zugang'} onClose={onClose} footer={<>{v.id && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={del}>Löschen</button>}<button className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary" disabled={!!busy || !v.label} onClick={save}>Speichern</button></>}>
      <div className="form">
        <Field label="Bezeichnung" span={2}><input value={v.label} onChange={f('label')} placeholder="z. B. Cloudflare-Konto Kunde, WordPress-Admin" /></Field>
        <Field label="Kunde"><SelectCompany value={v.company_id} onChange={(id) => setV({ ...v, company_id: id })} /></Field>
        <Field label="System"><select value={v.system_id || ''} onChange={f('system_id')}><option value="">–</option>{(systems || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Adresse" span={2}><input value={v.url || ''} onChange={f('url')} placeholder="https://…" /></Field>
        <Field label="Benutzer"><input value={v.username || ''} onChange={f('username')} autoComplete="off" /></Field>
        <Field label={v.id ? 'Neues Passwort (leer = unverändert)' : 'Passwort'}><div style={{ display: 'flex', gap: 6 }}><input type="text" value={v.secret || ''} onChange={f('secret')} autoComplete="new-password" /><button type="button" className="btn sm" onClick={gen}>Erzeugen</button></div></Field>
        <Field label="Notizen" span={2}><textarea rows={2} value={v.notes || ''} onChange={f('notes')} placeholder="2FA, Wiederherstellungscodes – keine Passwörter hier eintragen" /></Field>
      </div>
    </Modal>
  );
}

// ================================================================ Monatsberichte
export function ReportsList({ companyId }: { companyId?: string }) {
  const [list, reload, , err] = useLoad<any[]>(`/clients/reports${companyId ? `?company_id=${companyId}` : ''}`);
  const prev = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
  const [v, setV] = useState({ company_id: companyId || '', period: prev, lang: 'de' });
  const { busy, run } = useAction();
  if (err) return <Setup err={err} />;
  const create = () => run('c', async () => { await api.post('/clients/reports', v); reload(); }, 'Monatsbericht erstellt und in der Ablage unter „Berichte“ gespeichert');
  const send = (r: any) => confirm(`Monatsbericht ${r.period} an den Ansprechpartner von ${r.company_name} senden?`) && run('s' + r.id, async () => { const x = await api.post(`/clients/reports/${r.id}/send`); reload(); return x; }, 'Per Gmail gesendet');
  return (
    <div className="card flush">
      <div className="card-head"><h2>Monatsberichte</h2></div>
      <div className="report-new">
        {!companyId && <SelectCompany value={v.company_id} onChange={(id) => setV({ ...v, company_id: id })} />}
        <input type="month" value={v.period} onChange={(e) => setV({ ...v, period: e.target.value })} style={{ width: 160 }} />
        <div className="seg"><button className={v.lang === 'de' ? 'active' : ''} onClick={() => setV({ ...v, lang: 'de' })}>DE</button><button className={v.lang === 'en' ? 'active' : ''} onClick={() => setV({ ...v, lang: 'en' })}>EN</button></div>
        <a className={`btn sm ${!v.company_id ? 'disabled' : ''}`} href={v.company_id ? `/api/clients/reports/preview?company_id=${v.company_id}&period=${v.period}&lang=${v.lang}` : undefined} target="_blank" rel="noreferrer">Vorschau</a>
        <button className="btn sm primary" disabled={!!busy || !v.company_id} onClick={create}>Erstellen & ablegen</button>
      </div>
      {!list ? <div style={{ padding: 20 }}><Spinner /></div> : list.length === 0 ? <Empty title="Noch keine Berichte" text="Am 1. jedes Monats entsteht für jeden Kunden mit System oder Abo automatisch ein Entwurf – mit Verfügbarkeit, Releases, erledigten und offenen Punkten und Stunden." /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Monat</th>{!companyId && <th>Kunde</th>}<th>Sprache</th><th>Versendet</th><th /></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td><b>{r.period}</b></td>
                {!companyId && <td>{r.company_name}</td>}
                <td>{r.lang.toUpperCase()}</td>
                <td>{r.sent_at ? <span className="badge green">{fmtDate(r.sent_at)} · {r.sent_to}</span> : <span className="badge amber">Entwurf</span>}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  {r.document_id && <a className="btn sm" href={`/api/documents/${r.document_id}/file`} target="_blank" rel="noreferrer">PDF</a>}
                  <button className="btn sm primary" style={{ marginLeft: 4 }} disabled={!!busy} onClick={() => send(r)}>{r.sent_at ? 'Erneut senden' : 'Senden'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}

// ================================================================ Zusammenstellungen
export function CompanySystems({ companyId }: { companyId: string }) {
  return (
    <div className="stack">
      <SystemsList companyId={companyId} />
      <SubscriptionsList companyId={companyId} />
      <PeriodsList companyId={companyId} />
      <LicensesList companyId={companyId} />
    </div>
  );
}

export function CompanyContracts({ companyId }: { companyId: string }) {
  return (
    <div className="stack">
      <div className="grid c2" style={{ alignItems: 'start' }}>
        <ContractsList companyId={companyId} />
        <Checklists companyId={companyId} />
      </div>
      <ReportsList companyId={companyId} />
      <VaultList companyId={companyId} />
    </div>
  );
}

export function SystemsPage() {
  const [tab, setTab] = useState<'systems' | 'billing' | 'licenses' | 'contracts' | 'reports' | 'vault'>(() => (new URLSearchParams(window.location.hash.split('?')[1] || '').get('tab') as any) || 'systems');
  const T: [typeof tab, string][] = [['systems', 'Systeme'], ['billing', 'Abos & Abrechnung'], ['licenses', 'Lizenzen'], ['contracts', 'Verträge'], ['reports', 'Monatsberichte'], ['vault', 'Tresor']];
  return (
    <>
      <PageHead title="Kundensysteme" sub="Alles, was ihr für Kunden betreibt: Hosting, Abos, Wartung, Lizenzen, Verträge und Zugänge – über alle Kunden hinweg." />
      <div className="tabs">{T.map(([k, l]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'systems' && <SystemsList />}
      {tab === 'billing' && <div className="stack"><PeriodsList /><SubscriptionsList /></div>}
      {tab === 'licenses' && <LicensesList />}
      {tab === 'contracts' && <ContractsList />}
      {tab === 'reports' && <ReportsList />}
      {tab === 'vault' && <VaultList />}
    </>
  );
}
