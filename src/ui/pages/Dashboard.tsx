import React from 'react';
import { api } from '../api';
import { PageHead, Spinner, STAGES, fmtDateTime, fmtMoney, go, useAction, useLoad } from '../components';
import type { Me } from '../main';

const ICON: Record<string, string> = { note: '✎', call: '☏', meeting: '◷', task: '☐', email: '✉', agent: '✦', system: '•' };

export function Dashboard({ me }: { me: Me }) {
  const [d, reload] = useLoad<any>('/dashboard');
  const [events] = useLoad<any>(me.google ? '/calendar/upcoming' : null);
  const { run } = useAction();
  if (!d) return <Spinner />;
  const rate = d.quoteRate.won + d.quoteRate.lost ? Math.round((d.quoteRate.won / (d.quoteRate.won + d.quoteRate.lost)) * 100) : null;
  const replyRate = d.agent.contacted ? Math.round((d.agent.replied / d.agent.contacted) * 100) : 0;
  const hour = new Date().getHours();
  const maxStage = Math.max(1, ...d.stages.filter((s: any) => !['won', 'lost'].includes(s.stage)).map((s: any) => s.sum));

  return (
    <>
      <PageHead
        title={`${hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend'}, ${(me.name || '').split(' ')[0] || 'Hüseyin'}`}
        sub="Dein Vertrieb auf einen Blick."
        actions={
          <>
            <button className="btn" onClick={() => go('/contacts')}>Kontakte</button>
            <button className="btn primary" onClick={() => run('n', async () => { const q = await api.post('/quotes', {}); go(`/quotes/${q.id}`); })}>+ Angebot</button>
          </>
        }
      />
      <div className="grid k4">
        <div className="card kpi"><div className="label">Pipeline (gewichtet)</div><div className="value">{fmtMoney(d.pipeline.weighted)}</div><div className="meta">{d.pipeline.n} offene Deals · {fmtMoney(d.pipeline.total)} gesamt</div></div>
        <div className="card kpi"><div className="label">Offene Angebote</div><div className="value">{fmtMoney(d.quotesOpen.sum)}</div><div className="meta">{d.quotesOpen.n} versendet, warten auf Antwort</div></div>
        <div className="card kpi"><div className="label">Gewonnen {new Date().getFullYear()}</div><div className="value">{fmtMoney(d.quotesWon.sum)}</div><div className="meta">{d.quotesWon.n} Angebote · Quote {rate === null ? '–' : `${rate} %`}</div></div>
        <div className="card kpi"><div className="label">KI-Agent</div><div className="value">{d.agent.week} <span style={{ fontSize: 14, fontWeight: 500 }} className="muted">Mails/7 Tage</span></div><div className="meta">{d.agent.replied} Antworten · {replyRate} % · {d.agent.active} Kampagnen aktiv</div></div>
      </div>

      <div className="grid side" style={{ marginTop: 16 }}>
        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Aufgaben & Follow-ups</h2><span className="muted">{d.tasks.length} offen</span></div>
            {d.tasks.length === 0 ? <div className="muted">Keine offenen Aufgaben. 🎉</div> : (
              <div className="timeline">
                {d.tasks.map((t: any) => {
                  const overdue = t.due_at && new Date(t.due_at.replace(' ', 'T')) < new Date();
                  return (
                    <div className="tl-item" key={t.id}>
                      <div className="tl-dot task" style={{ cursor: 'pointer' }} title="Erledigt" onClick={() => run('t', async () => { await api.put(`/activities/${t.id}`, { done: 1 }); reload(); }, 'Erledigt')}>☐</div>
                      <div className="tl-body">
                        <div className="tl-title">{t.subject || 'Aufgabe'}</div>
                        <div className="tl-meta">
                          {t.contact_id ? <a href={`#/contacts/${t.contact_id}`}>{t.contact_name}</a> : t.company_name}
                          {t.due_at && <span style={{ color: overdue ? 'var(--red)' : undefined }}> · fällig {fmtDateTime(t.due_at)}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="card">
            <div className="card-head"><h2>Pipeline nach Phase</h2><a href="#/pipeline">Öffnen →</a></div>
            {STAGES.filter((s) => !['won', 'lost'].includes(s.id)).map((s) => {
              const row = d.stages.find((x: any) => x.stage === s.id) || { n: 0, sum: 0 };
              return (
                <div key={s.id} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}><span>{s.label} · {row.n}</span><b>{fmtMoney(row.sum)}</b></div>
                  <div className="bar"><div style={{ width: `${(row.sum / maxStage) * 100}%` }} /></div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Nächste Termine</h2><span className="muted" style={{ fontSize: 12 }}>Google Kalender</span></div>
            {!me.google ? <div className="muted">Google nicht verbunden.</div> : !events ? <Spinner /> : events.error ? <div className="muted">{events.error}</div> : events.length === 0 ? <div className="muted">Keine anstehenden Termine.</div> : (
              events.map((e: any) => (
                <a key={e.id} href={e.link} target="_blank" rel="noreferrer" style={{ display: 'block', padding: '7px 0', borderBottom: '1px solid #f0f2f6', color: 'inherit' }}>
                  <div style={{ fontWeight: 600 }}>{e.summary}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{e.start?.length > 10 ? fmtDateTime(e.start) : e.start}</div>
                </a>
              ))
            )}
          </div>
          <div className="card">
            <div className="card-head"><h2>Letzte Aktivitäten</h2></div>
            {d.recent.length === 0 ? <div className="muted">Noch nichts passiert.</div> : d.recent.map((a: any) => (
              <div key={a.id} style={{ display: 'flex', gap: 10, padding: '6px 0', fontSize: 13 }}>
                <span>{ICON[a.type] || '•'}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.subject}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{a.contact_name || a.company_name} · {fmtDateTime(a.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
