import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Empty, Field, Modal, PageHead, Spinner, confirmDel, fmtDate, fmtDateTime, go, useAction, useLoad, useToast } from '../components';
import { TimeEntries } from './Time';

export const TASK_STATUS: { id: string; label: string; color: string }[] = [
  { id: 'todo', label: 'Offen', color: '#9a9aa5' },
  { id: 'doing', label: 'In Arbeit', color: '#FF5A1F' },
  { id: 'review', label: 'Beim Kunden', color: '#6b4de6' },
  { id: 'done', label: 'Erledigt', color: '#12805c' },
];
export const PRIO_LABEL: Record<string, string> = { high: 'Hoch', medium: 'Mittel', low: 'Niedrig' };
const SOURCE: Record<string, [string, string]> = { review: ['Review', 'violet'], agent: ['KI-Agent', 'orange'], system: ['Angebot', 'grey'] };

function dueInfo(due?: string | null) {
  if (!due) return null;
  const d = new Date(due.length === 10 ? due + 'T23:59:00' : due.replace(' ', 'T'));
  const overdue = d.getTime() < Date.now();
  return { text: fmtDate(due), overdue };
}

export function TaskCard({ t, onOpen, showProject = true }: { t: any; onOpen: () => void; showProject?: boolean }) {
  const due = dueInfo(t.due_at);
  return (
    <div className="deal" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)} onClick={onOpen}>
      {!!t.unread && <span className="unread" title="Neue Reaktion des Kunden" />}
      <div className="deal-title" style={{ paddingRight: t.unread ? 14 : 0 }}>{t.title}</div>
      {showProject && (t.project_name || t.company_name) && <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>{t.project_name || t.company_name}</div>}
      <div className="deal-meta">
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className={`dot prio-${t.priority}`} title={`Priorität: ${PRIO_LABEL[t.priority]}`} />
          {SOURCE[t.source] && <span className={`badge ${SOURCE[t.source][1]}`} style={{ padding: '1px 7px', fontSize: 11 }}>{SOURCE[t.source][0]}</span>}
          {t.category && <span className="tag" style={{ margin: 0 }}>{t.category}</span>}
        </span>
        {due && <span style={{ color: due.overdue && t.status !== 'done' ? 'var(--red)' : undefined, fontWeight: due.overdue ? 600 : 400 }}>{due.text}</span>}
      </div>
    </div>
  );
}

/** Kanban-Board mit Aufgaben – optional gefiltert (Projekt, Firma) */
export function TaskBoard({ filter = '', projectId, companyId, showProject = true, reloadKey = 0 }: { filter?: string; projectId?: string; companyId?: string; showProject?: boolean; reloadKey?: number }) {
  const [list, reload] = useLoad<any[]>(`/tasks${filter ? '?' + filter : ''}`, [reloadKey]);
  const [over, setOver] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [create, setCreate] = useState<string | null>(null);
  const toast = useToast();
  const { run } = useAction();
  if (!list) return <Spinner />;
  const move = (id: string, status: string) =>
    run('m', async () => {
      const t = list.find((x) => x.id === id);
      if (!t || t.status === status) return;
      const r = await api.put(`/tasks/${id}`, { status });
      if (t.source === 'review' && r.review_sync && !String(r.review_sync).startsWith('Fehler')) toast(`An devunox Review gemeldet: ${r.review_sync}`);
      if (String(r.review_sync || '').startsWith('Fehler')) toast(`Review nicht aktualisiert – ${r.review_sync}`, 'err');
      reload();
    });
  return (
    <>
      <div className="board b4">
        {TASK_STATUS.map((s) => {
          const items = list.filter((t) => t.status === s.id);
          return (
            <div
              key={s.id}
              className={`col ${over === s.id ? 'over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(s.id); }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/plain'); if (id) move(id, s.id); }}
            >
              <div className="col-head">
                <b><span className="dot" style={{ background: s.color }} />{s.label} · {items.length}</b>
                {s.id !== 'done' && <button className="icon-btn" title="Aufgabe anlegen" onClick={() => setCreate(s.id)}>＋</button>}
              </div>
              {items.slice(0, s.id === 'done' ? 30 : 500).map((t) => <TaskCard key={t.id} t={t} onOpen={() => setOpen(t.id)} showProject={showProject} />)}
              {s.id === 'done' && items.length > 30 && <div className="muted" style={{ fontSize: 12, textAlign: 'center' }}>+ {items.length - 30} weitere</div>}
            </div>
          );
        })}
      </div>
      {open && <TaskDrawer id={open} onClose={() => setOpen(null)} onChanged={reload} />}
      {create && <NewTask status={create} projectId={projectId} companyId={companyId} onClose={() => setCreate(null)} onSaved={reload} />}
    </>
  );
}

export function NewTask({ status = 'todo', projectId, companyId, contactId, onClose, onSaved }: { status?: string; projectId?: string; companyId?: string; contactId?: string; onClose: () => void; onSaved: () => void }) {
  const [projects] = useLoad<any[]>('/projects');
  const [v, setV] = useState({ title: '', description: '', priority: 'medium', due_at: '', project_id: projectId || '', add_to_calendar: false });
  const { busy, run } = useAction();
  const save = () =>
    run('s', async () => {
      await api.post('/tasks', { ...v, status, due_at: v.due_at || null, project_id: v.project_id || null, company_id: companyId || null, contact_id: contactId || null });
      onSaved();
      onClose();
    }, v.add_to_calendar ? 'Aufgabe angelegt und im Google Kalender eingetragen' : 'Aufgabe angelegt');
  return (
    <Modal title="Neue Aufgabe" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary" disabled={!v.title || !!busy} onClick={save}>Anlegen</button></>}>
      <div className="form">
        <Field label="Aufgabe *" span={2}><input autoFocus value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && v.title && save()} /></Field>
        <Field label="Beschreibung" span={2}><textarea rows={3} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        <Field label="Projekt">
          <select value={v.project_id} onChange={(e) => setV({ ...v, project_id: e.target.value })}>
            <option value="">– kein Projekt –</option>
            {(projects || []).filter((p) => !companyId || p.company_id === companyId).map((p) => <option key={p.id} value={p.id}>{p.name}{p.company_name ? ` · ${p.company_name}` : ''}</option>)}
          </select>
        </Field>
        <Field label="Priorität">
          <select value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}>
            <option value="high">Hoch</option><option value="medium">Mittel</option><option value="low">Niedrig</option>
          </select>
        </Field>
        <Field label="Fällig"><input type="datetime-local" value={v.due_at} onChange={(e) => setV({ ...v, due_at: e.target.value })} /></Field>
        <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 10 }}>
          {v.due_at && <label className="check"><input type="checkbox" checked={v.add_to_calendar} onChange={(e) => setV({ ...v, add_to_calendar: e.target.checked })} /> Im Google Kalender eintragen</label>}
        </div>
      </div>
    </Modal>
  );
}

export function TaskDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [t, setT] = useState<any>(null);
  const [projects] = useLoad<any[]>('/projects');
  const [noteText, setNoteText] = useState('');
  const [dirty, setDirty] = useState(false);
  const { busy, run } = useAction();
  const toast = useToast();
  const load = () => api.get(`/tasks/${id}`).then((d) => { setT(d); setDirty(false); });
  useEffect(() => { load(); }, [id]);
  if (!t) return <Modal title="Aufgabe" onClose={onClose}><Spinner /></Modal>;
  const upd = (k: string, val: any) => { setT({ ...t, [k]: val }); setDirty(true); };
  const save = () => run('s', async () => {
    await api.put(`/tasks/${id}`, { title: t.title, description: t.description, priority: t.priority, due_at: t.due_at || null, project_id: t.project_id || null });
    await load();
    onChanged();
  }, 'Gespeichert');
  const setStatus = (status: string) => run('st', async () => {
    const r = await api.put(`/tasks/${id}`, { status, note: noteText || undefined });
    if (t.source === 'review') {
      if (String(r.review_sync || '').startsWith('Fehler')) toast(`Review nicht aktualisiert – ${r.review_sync}`, 'err');
      else if (r.review_sync && !['unverändert', 'übersprungen'].includes(r.review_sync)) toast('Status an devunox Review gemeldet' + (noteText ? ' (inkl. Notiz für den Kunden)' : ''));
    }
    setNoteText('');
    await load();
    onChanged();
  });
  const addNote = () => run('n', async () => { await api.post(`/tasks/${id}/notes`, { body: noteText }); setNoteText(''); await load(); onChanged(); });
  const del = () => confirmDel('Aufgabe') && run('d', async () => { await api.del(`/tasks/${id}`); onChanged(); onClose(); });

  return (
    <Modal wide title="Aufgabe" onClose={onClose} footer={
      <>
        <button className="btn danger" style={{ marginRight: 'auto' }} onClick={del}>Löschen</button>
        {dirty && <button className="btn primary" disabled={!!busy} onClick={save}>Änderungen speichern</button>}
        <button className="btn" onClick={onClose}>Schließen</button>
      </>
    }>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 250px', gap: 22 }}>
        <div className="stack">
          <input style={{ fontSize: 18, fontWeight: 700, border: 0, padding: '4px 0', boxShadow: 'none' }} value={t.title} onChange={(e) => upd('title', e.target.value)} />
          <textarea rows={5} placeholder="Beschreibung" value={t.description || ''} onChange={(e) => upd('description', e.target.value)} />
          <div className="card" style={{ background: '#fafafb', boxShadow: 'none', border: '1px solid var(--line)', padding: 14 }}>
            <h4 style={{ marginBottom: 8 }}>Zeit</h4>
            <TimeEntries taskId={id} projectId={t.project_id || undefined} companyId={t.company_id || undefined} title={t.title} compact />
          </div>
          <div>
            <h4 style={{ marginBottom: 8 }}>Verlauf</h4>
            {t.notes.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>Noch keine Einträge.</div> : (
              <div className="timeline">
                {t.notes.map((n: any) => (
                  <div className="tl-item" key={n.id}>
                    <div className={`tl-dot ${n.type}`}>{n.type === 'email' ? '↩' : n.type === 'note' ? '✎' : '•'}</div>
                    <div className="tl-body">
                      <div className="tl-title" style={{ fontSize: 13.5 }}>{n.subject}</div>
                      <div className="tl-meta">{fmtDateTime(n.created_at)}</div>
                      {n.body && <div className="tl-text open">{n.body}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input placeholder={t.source === 'review' ? 'Notiz (wird beim nächsten Statuswechsel auch an den Kunden gesendet)' : 'Notiz hinzufügen'} value={noteText} onChange={(e) => setNoteText(e.target.value)} />
              <button className="btn" disabled={!noteText || !!busy} onClick={addNote}>Notiz</button>
            </div>
          </div>
        </div>
        <div className="stack">
          <div>
            <div className="field-label" style={{ marginBottom: 6 }}>Status</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {TASK_STATUS.map((s) => (
                <button key={s.id} className={`btn sm ${t.status === s.id ? 'primary' : ''}`} style={{ justifyContent: 'flex-start' }} disabled={!!busy} onClick={() => setStatus(s.id)}>
                  <span className="dot" style={{ background: s.color }} /> {s.label}
                </button>
              ))}
            </div>
            {t.source === 'review' && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>„Beim Kunden“ und „Erledigt“ setzen den Punkt in devunox Review auf „Bitte prüfen“. Der Kunde nimmt dort ab.</div>}
          </div>
          <Field label="Priorität">
            <select value={t.priority} onChange={(e) => upd('priority', e.target.value)}>
              <option value="high">Hoch</option><option value="medium">Mittel</option><option value="low">Niedrig</option>
            </select>
          </Field>
          <Field label="Fällig"><input type="datetime-local" value={(t.due_at || '').replace(' ', 'T').slice(0, 16)} onChange={(e) => upd('due_at', e.target.value)} /></Field>
          <Field label="Projekt">
            <select value={t.project_id || ''} onChange={(e) => upd('project_id', e.target.value)}>
              <option value="">– kein Projekt –</option>
              {(projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <dl className="dl" style={{ gridTemplateColumns: '80px 1fr', fontSize: 13 }}>
            {t.company_name && <><dt>Firma</dt><dd><a href={`#/companies/${t.company_id}`} onClick={onClose}>{t.company_name}</a></dd></>}
            {t.contact_name && <><dt>Kontakt</dt><dd>{t.contact_name}</dd></>}
            <dt>Quelle</dt><dd>{SOURCE[t.source]?.[0] || 'Manuell'}</dd>
            {t.external_status && <><dt>Review</dt><dd>{t.external_status}</dd></>}
            <dt>Angelegt</dt><dd>{fmtDate(t.created_at)}</dd>
          </dl>
          {t.external_url && <a className="btn sm" href={t.external_url} target="_blank" rel="noreferrer">In devunox Review öffnen ↗</a>}
          {t.project_id && <button className="btn sm ghost" onClick={() => { onClose(); go(`/projects/${t.project_id}`); }}>Zum Projekt →</button>}
        </div>
      </div>
    </Modal>
  );
}

export function TasksPage() {
  const [projects] = useLoad<any[]>('/projects');
  const [deep, setDeep] = useState<string | null>(() => new URLSearchParams(window.location.hash.split('?')[1] || '').get('open'));
  const [view, setView] = useState<'board' | 'list'>('board');
  const [project, setProject] = useState('');
  const [source, setSource] = useState('');
  const [prio, setPrio] = useState('');
  const [q, setQ] = useState('');
  const [key, setKey] = useState(0);
  const [create, setCreate] = useState(false);
  const filter = new URLSearchParams(Object.entries({ project_id: project, source, priority: prio, q }).filter(([, v]) => v)).toString();
  return (
    <>
      <PageHead
        title="Aufgaben"
        sub="Alle To-dos – eigene, aus Angeboten, vom KI-Agenten und Kunden-Feedback aus devunox Review."
        actions={<>
          <div className="seg"><button className={view === 'board' ? 'active' : ''} onClick={() => setView('board')}>Board</button><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>Liste</button></div>
          <button className="btn primary" onClick={() => setCreate(true)}>+ Aufgabe</button>
        </>}
      />
      <div className="toolbar">
        <input className="search" placeholder="Aufgaben durchsuchen…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">Alle Projekte</option>
          {(projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Alle Quellen</option><option value="review">devunox Review</option><option value="manual">Manuell</option><option value="agent">KI-Agent</option><option value="system">Aus Angebot</option>
        </select>
        <select value={prio} onChange={(e) => setPrio(e.target.value)}>
          <option value="">Alle Prioritäten</option><option value="high">Hoch</option><option value="medium">Mittel</option><option value="low">Niedrig</option>
        </select>
      </div>
      {view === 'board' ? <TaskBoard filter={filter} reloadKey={key} projectId={project || undefined} /> : <TaskList filter={filter} reloadKey={key} />}
      {create && <NewTask projectId={project || undefined} onClose={() => setCreate(false)} onSaved={() => setKey((k) => k + 1)} />}
      {deep && <TaskDrawer id={deep} onClose={() => { setDeep(null); window.location.hash = '/tasks'; }} onChanged={() => setKey((k) => k + 1)} />}
    </>
  );
}

export function TaskList({ filter, reloadKey = 0 }: { filter: string; reloadKey?: number }) {
  const [list, reload] = useLoad<any[]>(`/tasks${filter ? '?' + filter : ''}`, [reloadKey]);
  const [open, setOpen] = useState<string | null>(null);
  const { run } = useAction();
  const sorted = useMemo(() => list || [], [list]);
  if (!list) return <Spinner />;
  if (!list.length) return <div className="card"><Empty title="Keine Aufgaben" text="Hier erscheinen eigene Aufgaben und Feedback aus devunox Review." /></div>;
  return (
    <div className="card flush">
      <div className="table-wrap">
        <table>
          <thead><tr><th style={{ width: 36 }} /><th>Aufgabe</th><th className="hide-m">Projekt / Firma</th><th>Status</th><th className="hide-m">Priorität</th><th>Fällig</th></tr></thead>
          <tbody>
            {sorted.map((t) => {
              const due = dueInfo(t.due_at);
              const st = TASK_STATUS.find((s) => s.id === t.status)!;
              return (
                <tr key={t.id} className="click" onClick={() => setOpen(t.id)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={t.status === 'done'} onChange={() => run('t', async () => { await api.put(`/tasks/${t.id}`, { status: t.status === 'done' ? 'todo' : 'done' }); reload(); })} />
                  </td>
                  <td>
                    <b style={{ textDecoration: t.status === 'done' ? 'line-through' : undefined }}>{t.title}</b>
                    {!!t.unread && <span className="badge orange" style={{ marginLeft: 8 }}>neu</span>}
                    {SOURCE[t.source] && <span className={`badge ${SOURCE[t.source][1]}`} style={{ marginLeft: 8 }}>{SOURCE[t.source][0]}</span>}
                  </td>
                  <td className="hide-m">{t.project_name || t.company_name || '–'}</td>
                  <td><span className="badge grey"><span className="dot" style={{ background: st.color }} />{st.label}</span></td>
                  <td className="hide-m"><span className={`dot prio-${t.priority}`} /> {PRIO_LABEL[t.priority]}</td>
                  <td style={{ color: due?.overdue && t.status !== 'done' ? 'var(--red)' : undefined }}>{due?.text || '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {open && <TaskDrawer id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}
