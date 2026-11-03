import React, { useState } from 'react';
import { api } from '../api';
import { Spinner, STAGES, fmtDate, fmtDateTime, fmtMoney, go, useAction, useLoad } from '../components';
import { ICONS, Icon } from '../icons';
import type { Me } from '../main';
import { NewTask, TaskDrawer, TASK_STATUS } from './Tasks';
import { NewQuoteDialog } from './Quotes';

const STAGE_COLORS: Record<string, string> = { lead: '#3d7bff', qualified: '#8b6cff', proposal: '#ff5a1f', negotiation: '#ff3d7f', won: '#2bd9a0', lost: '#5b5970' };

function Donut({ parts, total, label }: { parts: { value: number; color: string }[]; total: string; label: string }) {
  const sum = parts.reduce((a, p) => a + p.value, 0) || 1;
  const R = 64, C = 2 * Math.PI * R;
  let off = 0;
  return (
    <svg width="180" height="180" viewBox="0 0 180 180">
      <defs>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <circle cx="90" cy="90" r={R} fill="none" stroke="var(--chip-2)" strokeWidth="16" />
      <g filter="url(#glow)">
        {parts.filter((p) => p.value > 0).map((p, i) => {
          const len = (p.value / sum) * C;
          const el = <circle key={i} cx="90" cy="90" r={R} fill="none" stroke={p.color} strokeWidth="16" strokeDasharray={`${Math.max(len - 6, 0.1)} ${C}`} strokeDashoffset={-off} transform="rotate(-90 90 90)" strokeLinecap="round" />;
          off += len;
          return el;
        })}
      </g>
      <text x="90" y="88" textAnchor="middle" fontSize="28" fontWeight="700" fill="var(--ink)">{total}</text>
      <text x="90" y="108" textAnchor="middle" fontSize="11.5" fill="var(--muted)">{label}</text>
    </svg>
  );
}

function MonthCalendar({ items, onOpen }: { items: any[]; onOpen: (id: string) => void }) {
  const [offset, setOffset] = useState(0);
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const byDay = new Map<string, any[]>();
  for (const t of items) {
    const k = String(t.due_at).slice(0, 10);
    byDay.set(k, [...(byDay.get(k) || []), t]);
  }
  const today = key(now);
  const rows = days.slice(35).every((d) => d.getMonth() !== first.getMonth()) ? days.slice(0, 35) : days;
  return (
    <div className="card">
      <div className="card-head">
        <h2>{first.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</h2>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="icon-btn" onClick={() => setOffset(offset - 1)}>‹</button>
          <button className="btn sm ghost" onClick={() => setOffset(0)}>Heute</button>
          <button className="icon-btn" onClick={() => setOffset(offset + 1)}>›</button>
        </div>
      </div>
      <div className="cal">
        {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => <div key={d} className="dow">{d}</div>)}
        {rows.map((d) => {
          const k = key(d);
          const ev = byDay.get(k) || [];
          return (
            <div key={k} className={`day ${d.getMonth() !== first.getMonth() ? 'out' : ''} ${k === today ? 'today' : ''}`}>
              <span className="n">{d.getDate()}</span>
              {ev.slice(0, 2).map((t) => <span key={t.id} className={`ev ${t.status === 'done' ? 'done' : ''}`} title={t.title} onClick={() => onOpen(t.id)} style={{ cursor: 'pointer' }}>{t.title}</span>)}
              {ev.length > 2 && <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>+{ev.length - 2}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Dashboard({ me }: { me: Me }) {
  const [d, reload] = useLoad<any>('/dashboard');
  const [events] = useLoad<any>(me.google ? '/calendar/upcoming' : null);
  const [open, setOpen] = useState<string | null>(null);
  const [newTask, setNewTask] = useState(false);
  const [newQuote, setNewQuote] = useState(false);
  const { run } = useAction();
  if (!d) return <Spinner />;
  const rate = d.quoteRate.won + d.quoteRate.lost ? Math.round((d.quoteRate.won / (d.quoteRate.won + d.quoteRate.lost)) * 100) : null;
  const hour = new Date().getHours();
  const openStages = STAGES.filter((s) => !['won', 'lost'].includes(s.id));
  const stageRows = openStages.map((s) => ({ ...s, ...(d.stages.find((x: any) => x.stage === s.id) || { n: 0, sum: 0 }) }));
  const ts = (st: string) => d.taskStats.find((x: any) => x.status === st) || { n: 0, review: 0, unread: 0 };
  const openTasks = ['todo', 'doing', 'review'].reduce((a, s) => a + ts(s).n, 0);
  const feedbackOpen = ['todo', 'doing', 'review'].reduce((a, s) => a + (ts(s).review || 0), 0);
  const unread = d.taskStats.reduce((a: number, x: any) => a + (x.unread || 0), 0);

  return (
    <>
      <div className="hero" style={{ marginBottom: 18 }}>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <h1>{hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend'}, {(me.name || '').split(' ')[0] || 'Hüseyin'}</h1>
          <div className="sub">
            {openTasks} {openTasks === 1 ? 'offene Aufgabe' : 'offene Aufgaben'}{feedbackOpen ? ` · ${feedbackOpen} aus Kunden-Feedback` : ''}{unread ? ` · ${unread} ${unread === 1 ? 'neue Reaktion' : 'neue Reaktionen'}` : ''} · {d.quotesOpen.n} {d.quotesOpen.n === 1 ? 'Angebot wartet' : 'Angebote warten'} auf Antwort
          </div>
        </div>
        <div className="hero-bars"><i style={{ width: 96, background: 'linear-gradient(90deg,#ff5a1f,#ff3d7f)', boxShadow: '0 0 18px rgba(255,90,31,.7)' }} /><i style={{ width: 62, background: '#f4f3fa' }} /><i style={{ width: 78, background: 'linear-gradient(90deg,#953a1b,#ff5a1f)' }} /></div>
      </div>

      <div className="quick">
        <button onClick={() => setNewQuote(true)}>
          <span className="ico tint-orange"><Icon d={ICONS.quote} /></span><div><b>Angebot erstellen</b><span>DE / EN, leer oder mit KI</span></div>
        </button>
        <button onClick={() => go('/import')}>
          <span className="ico tint-rust"><Icon d={ICONS.excel} /></span><div><b>Excel → Angebot</b><span>technisch + kaufmännisch</span></div>
        </button>
        <button onClick={() => setNewTask(true)}>
          <span className="ico tint-green"><Icon d={ICONS.tasks} /></span><div><b>Aufgabe anlegen</b><span>mit Projekt & Termin</span></div>
        </button>
        <button onClick={() => go('/pdf')}>
          <span className="ico tint-violet"><Icon d={ICONS.sign} /></span><div><b>PDF unterschreiben</b><span>Unterschrift & Stempel</span></div>
        </button>
      </div>

      <div className="grid k4" style={{ marginBottom: 18 }}>
        <div className="card kpi feature"><span className="ico tint-orange"><Icon d={ICONS.pipeline} /></span><div className="label">Pipeline gewichtet</div><div className="value">{fmtMoney(d.pipeline.weighted)}</div><div className="meta">{d.pipeline.n} Deals · {fmtMoney(d.pipeline.total)} gesamt</div></div>
        <div className="card kpi"><span className="ico tint-violet"><Icon d={ICONS.quote} /></span><div className="label">Offene Angebote</div><div className="value">{fmtMoney(d.quotesOpen.sum)}</div><div className="meta">{d.quotesOpen.n} versendet</div></div>
        <div className="card kpi"><span className="ico tint-green"><Icon d="M5 13l4 4L19 7" /></span><div className="label">Gewonnen {new Date().getFullYear()}</div><div className="value">{fmtMoney(d.quotesWon.sum)}</div><div className="meta">{d.quotesWon.n} Angebote · Quote {rate === null ? '–' : `${rate} %`}</div></div>
        <div className="card kpi"><span className="ico tint-rust"><Icon d={ICONS.agent} /></span><div className="label">KI-Agent (7 Tage)</div><div className="value">{d.agent.week}</div><div className="meta">Mails · {d.agent.replied} Antworten · {d.agent.active} Kampagnen</div></div>
      </div>

      <div className="grid dash">
        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Pipeline</h2><a className="btn sm ghost" href="#/pipeline">Öffnen →</a></div>
            <div className="donut-wrap">
              <Donut parts={stageRows.map((s) => ({ value: s.sum, color: STAGE_COLORS[s.id] }))} total={String(d.pipeline.n)} label="offene Deals" />
              <div className="legend">
                {stageRows.map((s) => (
                  <div key={s.id}><span className="dot" style={{ background: STAGE_COLORS[s.id], width: 11, height: 11 }} />{s.label} <span className="muted">· {s.n}</span><b>{fmtMoney(s.sum)}</b></div>
                ))}
              </div>
            </div>
          </div>
          <MonthCalendar items={d.due} onOpen={setOpen} />
          {d.projects.length > 0 && (
            <div className="card">
              <div className="card-head"><h2>Laufende Projekte</h2><a className="btn sm ghost" href="#/projects">Alle →</a></div>
              {d.projects.map((p: any) => {
                const pct = p.n_tasks ? Math.round((p.n_done / p.n_tasks) * 100) : 0;
                return (
                  <div key={p.id} style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '9px 0', cursor: 'pointer' }} onClick={() => go(`/projects/${p.id}`)}>
                    <div className="proj-ico" style={{ width: 36, height: 36, flex: '0 0 36px', fontSize: 14 }}>{p.name[0]}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</b><span className="muted" style={{ fontSize: 12.5 }}>{p.n_done}/{p.n_tasks}</span></div>
                      <div className="bar" style={{ marginTop: 6 }}><div style={{ width: `${pct}%` }} /></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Meine Aufgaben</h2><a className="btn sm ghost" href="#/tasks">Alle →</a></div>
            {d.tasks.length === 0 ? <div className="muted">Keine offenen Aufgaben.</div> : (
              <div className="timeline">
                {d.tasks.map((t: any) => {
                  const st = TASK_STATUS.find((s) => s.id === t.status)!;
                  const overdue = t.due_at && new Date(t.due_at.replace(' ', 'T')) < new Date();
                  return (
                    <div className="tl-item" key={t.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(t.id)}>
                      <div className="tl-dot" style={{ background: t.source === 'review' ? 'var(--violet-soft)' : 'var(--chip-2)', color: t.source === 'review' ? 'var(--violet)' : 'var(--ink-2)', cursor: 'pointer' }}
                        title="Erledigt" onClick={(e) => { e.stopPropagation(); run('t', async () => { await api.put(`/tasks/${t.id}`, { status: 'done' }); reload(); }, 'Erledigt'); }}>
                        {t.source === 'review' ? '◉' : '☐'}
                      </div>
                      <div className="tl-body">
                        <div className="tl-title" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{t.title}{!!t.unread && <span className="dot" style={{ background: 'var(--orange)' }} />}</div>
                        <div className="tl-meta">
                          <span className="dot" style={{ background: st.color, width: 7, height: 7 }} /> {st.label}
                          {(t.project_name || t.company_name) && ` · ${t.project_name || t.company_name}`}
                          {t.due_at && <span style={{ color: overdue ? 'var(--red)' : undefined }}> · {fmtDateTime(t.due_at)}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="card">
            <div className="card-head"><h2>Neue Dokumente</h2><a className="btn sm ghost" href="#/documents">Ablage →</a></div>
            {d.docs.length === 0 ? <div className="muted">Noch keine Dokumente.</div> : d.docs.map((f: any) => (
              <a key={f.id} href={`/api/documents/${f.id}/file`} target="_blank" rel="noreferrer" style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 0', textDecoration: 'none' }}>
                <span className={`ficon ${/pdf/.test(f.mime || '') ? 'pdf' : /image/.test(f.mime || '') ? 'img' : 'other'}`}>{(f.name.split('.').pop() || '').toUpperCase().slice(0, 4)}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{f.company_name} · {fmtDate(f.created_at)}</div>
                </div>
              </a>
            ))}
          </div>
          <div className="card">
            <div className="card-head"><h2>Termine</h2><span className="muted">Google Kalender</span></div>
            {!me.google ? <div className="muted">Google nicht verbunden.</div> : !events ? <Spinner /> : events.error ? <div className="muted">{events.error}</div> : events.length === 0 ? <div className="muted">Keine anstehenden Termine.</div> : (
              events.map((e: any) => (
                <a key={e.id} href={e.link} target="_blank" rel="noreferrer" style={{ display: 'block', padding: '7px 0', borderBottom: '1px solid var(--line)', textDecoration: 'none' }}>
                  <div style={{ fontWeight: 600 }}>{e.summary}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{e.start?.length > 10 ? fmtDateTime(e.start) : e.start}</div>
                </a>
              ))
            )}
          </div>
        </div>
      </div>
      {open && <TaskDrawer id={open} onClose={() => setOpen(null)} onChanged={reload} />}
      {newTask && <NewTask onClose={() => setNewTask(false)} onSaved={reload} />}
      {newQuote && <NewQuoteDialog onClose={() => setNewQuote(false)} />}
    </>
  );
}
