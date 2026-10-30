import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { Empty, Field, Modal, PageHead, Spinner, fmtDate, useAction, useLoad, useToast } from '../components';

// ---------------- Laufender Timer (im Browser gemerkt, überlebt Neuladen)
export type Timer = { task_id?: string | null; project_id?: string | null; company_id?: string | null; title: string; start: number };
const KEY = 'dvx_timer';
export function getTimer(): Timer | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}
function setTimer(t: Timer | null) {
  try {
    t ? localStorage.setItem(KEY, JSON.stringify(t)) : localStorage.removeItem(KEY);
  } catch {
    /* Speicher nicht verfügbar */
  }
  window.dispatchEvent(new Event('dvx-timer'));
}
export function startTimer(t: Omit<Timer, 'start'>) {
  setTimer({ ...t, start: Date.now() });
}
export async function stopTimer(description?: string) {
  const t = getTimer();
  if (!t) return null;
  const minutes = Math.max(1, Math.round((Date.now() - t.start) / 60000));
  setTimer(null);
  await api.post('/time', { task_id: t.task_id, project_id: t.project_id, company_id: t.company_id, minutes, description: description || t.title });
  window.dispatchEvent(new Event('dvx-time-saved'));
  return minutes;
}
export function useTimer() {
  const [t, setT] = useState<Timer | null>(getTimer());
  const [, tick] = useState(0);
  useEffect(() => {
    const on = () => setT(getTimer());
    window.addEventListener('dvx-timer', on);
    window.addEventListener('storage', on);
    const iv = setInterval(() => tick((x) => x + 1), 1000);
    return () => {
      window.removeEventListener('dvx-timer', on);
      window.removeEventListener('storage', on);
      clearInterval(iv);
    };
  }, []);
  return t;
}
export const fmtDur = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
export const fmtHours = (min: number) => `${(min / 60).toLocaleString('de-DE', { maximumFractionDigits: 2 })} h`;

/** Kleiner Timer in der Seitenleiste */
export function TimerBadge() {
  const t = useTimer();
  const toast = useToast();
  if (!t) return null;
  return (
    <div className="timer-badge">
      <span className="pulse" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <b>{fmtDur(Date.now() - t.start)}</b>
        <div className="muted" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
      </div>
      <button className="btn sm accent" onClick={async () => { const m = await stopTimer(); if (m) toast(`${fmtHours(m)} erfasst`); }}>Stopp</button>
    </div>
  );
}

/** Zeiten-Liste mit Erfassung – für Aufgabe, Projekt oder Kunde */
export function TimeEntries({ taskId, projectId, companyId, title, compact }: { taskId?: string; projectId?: string; companyId?: string; title?: string; compact?: boolean }) {
  const scope = new URLSearchParams(Object.entries({ task_id: taskId || '', project_id: projectId || '', company_id: companyId || '' }).filter(([, v]) => v)).toString();
  const [data, reload] = useLoad<{ entries: any[]; total_minutes: number; billable_minutes: number }>(`/time?${scope}`);
  const timer = useTimer();
  const [add, setAdd] = useState(false);
  const { run } = useAction();
  const toast = useToast();
  useEffect(() => {
    const on = () => reload();
    window.addEventListener('dvx-time-saved', on);
    return () => window.removeEventListener('dvx-time-saved', on);
  }, [reload]);
  if (!data) return <Spinner />;
  const running = timer && ((taskId && timer.task_id === taskId) || (!taskId && projectId && timer.project_id === projectId && !timer.task_id));
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <b style={{ fontSize: compact ? 15 : 20 }}>{fmtHours(data.total_minutes)}</b> <span className="muted" style={{ fontSize: 12.5 }}>gesamt · {fmtHours(data.billable_minutes)} abrechenbar</span>
        </div>
        {running ? (
          <button className="btn sm accent" onClick={async () => { const m = await stopTimer(); if (m) toast(`${fmtHours(m)} erfasst`); }}>■ Timer stoppen · {fmtDur(Date.now() - timer!.start)}</button>
        ) : (
          <button className="btn sm" onClick={() => { if (timer && !confirm(`Es läuft bereits ein Timer („${timer.title}“). Ersetzen?`)) return; startTimer({ task_id: taskId || null, project_id: projectId || null, company_id: companyId || null, title: title || 'Arbeit' }); }}>▶ Timer starten</button>
        )}
        <button className="btn sm" onClick={() => setAdd(true)}>+ Zeit</button>
        {!compact && <a className="btn sm ghost" href={`/api/time/export.csv?${scope}`}>CSV</a>}
      </div>
      {data.entries.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>Noch keine Zeiten erfasst.</div> : (
        <table style={{ fontSize: 13 }}>
          <tbody>
            {data.entries.slice(0, compact ? 8 : 500).map((e) => (
              <tr key={e.id}>
                <td style={{ whiteSpace: 'nowrap', width: 90 }}>{fmtDate(e.date)}</td>
                <td>{e.description || e.task_title || '–'}{!taskId && e.task_title && e.description !== e.task_title && <div className="muted" style={{ fontSize: 12 }}>{e.task_title}</div>}{!projectId && !taskId && e.project_name && <div className="muted" style={{ fontSize: 12 }}>{e.project_name}</div>}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>{fmtHours(e.minutes)}{!e.billable && <div className="muted" style={{ fontSize: 11 }}>intern</div>}</td>
                <td style={{ width: 30 }}><button className="icon-btn" title="Löschen" onClick={() => confirm('Eintrag löschen?') && run('d', async () => { await api.del(`/time/${e.id}`); reload(); })}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {add && <AddTime taskId={taskId} projectId={projectId} companyId={companyId} title={title} onClose={() => setAdd(false)} onSaved={reload} />}
    </div>
  );
}

function AddTime({ taskId, projectId, companyId, title, onClose, onSaved }: { taskId?: string; projectId?: string; companyId?: string; title?: string; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ date: new Date().toISOString().slice(0, 10), hours: '1', description: title || '', billable: true });
  const { busy, run } = useAction();
  const save = () => run('s', async () => {
    const h = Number(String(v.hours).replace(',', '.'));
    await api.post('/time', { task_id: taskId || null, project_id: projectId || null, company_id: companyId || null, date: v.date, minutes: Math.round(h * 60), description: v.description, billable: v.billable ? 1 : 0 });
    onSaved();
    onClose();
  }, 'Zeit erfasst');
  return (
    <Modal title="Zeit erfassen" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary" disabled={!!busy} onClick={save}>Speichern</button></>}>
      <div className="form">
        <Field label="Datum"><input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
        <Field label="Stunden" hint="z. B. 1,5"><input value={v.hours} onChange={(e) => setV({ ...v, hours: e.target.value })} autoFocus /></Field>
        <Field label="Tätigkeit" span={2}><input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        <label className="check full"><input type="checkbox" checked={v.billable} onChange={(e) => setV({ ...v, billable: e.target.checked })} /> abrechenbar</label>
      </div>
    </Modal>
  );
}

export function TimePage() {
  const [companies] = useLoad<any[]>('/companies');
  const [cid, setCid] = useState('');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const from = month ? `${month}-01` : '';
  const to = month ? `${month}-31` : '';
  const q = new URLSearchParams(Object.entries({ company_id: cid, from, to }).filter(([, v]) => v)).toString();
  const [data] = useLoad<{ entries: any[]; total_minutes: number; billable_minutes: number }>(`/time?${q}`);
  const byCustomer = new Map<string, { name: string; no: string; min: number }>();
  for (const e of data?.entries || []) {
    const k = e.company_id || '-';
    const r = byCustomer.get(k) || { name: e.company_name || 'Ohne Kunde', no: e.customer_no || '', min: 0 };
    r.min += e.minutes;
    byCustomer.set(k, r);
  }
  return (
    <>
      <PageHead title="Zeiten" sub="Jede Arbeit je Kunde, Projekt und Aufgabe – mit Timer oder nachträglich erfasst." actions={<a className="btn" href={`/api/time/export.csv?${q}`}>CSV-Export</a>} />
      <div className="toolbar">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 180 }} />
        <select value={cid} onChange={(e) => setCid(e.target.value)}>
          <option value="">Alle Kunden</option>
          {(companies || []).map((c) => <option key={c.id} value={c.id}>{c.customer_no} · {c.name}</option>)}
        </select>
      </div>
      {!data ? <Spinner /> : (
        <div className="grid side">
          <div className="card flush">
            {data.entries.length === 0 ? <Empty title="Keine Zeiten im Zeitraum" text="Starte in einer Aufgabe den Timer oder erfasse Zeiten nachträglich." /> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Datum</th><th>Kunde</th><th className="hide-m">Projekt / Aufgabe</th><th>Tätigkeit</th><th className="num">Dauer</th></tr></thead>
                  <tbody>
                    {data.entries.map((e) => (
                      <tr key={e.id}>
                        <td>{fmtDate(e.date)}</td>
                        <td>{e.company_name ? <a href={`#/companies/${e.company_id}`}>{e.company_name}</a> : '–'}<div className="muted" style={{ fontSize: 12 }}>{e.customer_no}</div></td>
                        <td className="hide-m">{e.project_name || '–'}<div className="muted" style={{ fontSize: 12 }}>{e.task_title}</div></td>
                        <td>{e.description}</td>
                        <td className="num">{fmtHours(e.minutes)}{!e.billable && <div className="muted" style={{ fontSize: 11 }}>intern</div>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="stack">
            <div className="card kpi"><span className="ico tint-orange">⏱</span><div className="label">Gesamt</div><div className="value">{fmtHours(data.total_minutes)}</div><div className="meta">{fmtHours(data.billable_minutes)} abrechenbar</div></div>
            <div className="card">
              <h2 style={{ marginBottom: 10 }}>Nach Kunde</h2>
              {[...byCustomer.values()].sort((a, b) => b.min - a.min).map((r) => (
                <div key={r.name} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{r.no && <span className="muted">{r.no} · </span>}{r.name}</span><b>{fmtHours(r.min)}</b></div>
                  <div className="bar" style={{ marginTop: 4 }}><div style={{ width: `${(r.min / Math.max(1, data.total_minutes)) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
