import React, { useState } from 'react';
import { api } from '../api';
import { Empty, Field, Modal, PageHead, SelectCompany, SelectContact, Spinner, confirmDel, fmtDate, fmtMoney, go, useAction, useLoad, useToast } from '../components';
import { TaskBoard } from './Tasks';
import { DocBrowser } from './Documents';
import { TimeEntries } from './Time';
import type { Me } from '../main';

export const PROJECT_STATUS: Record<string, [string, string]> = {
  planning: ['In Planung', 'grey'],
  active: ['Aktiv', 'orange'],
  paused: ['Pausiert', 'amber'],
  done: ['Abgeschlossen', 'green'],
};

export function ProjectForm({ initial, onClose, onSaved }: { initial?: any; onClose: () => void; onSaved: (p: any) => void }) {
  const [v, setV] = useState<any>({ name: '', company_id: '', contact_id: '', status: 'active', description: '', start_date: '', end_date: '', review_slug: '', app_url: '', ...(initial || {}) });
  const { busy, run } = useAction();
  const set = (k: string) => (e: any) => setV({ ...v, [k]: e.target.value });
  const save = () => run('s', async () => {
    const r = initial?.id ? await api.put(`/projects/${initial.id}`, v) : await api.post('/projects', v);
    onSaved(r);
    onClose();
  }, 'Projekt gespeichert');
  return (
    <Modal wide title={initial?.id ? 'Projekt bearbeiten' : 'Neues Projekt'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary" disabled={!v.name || !!busy} onClick={save}>Speichern</button></>}>
      <div className="form c3">
        <Field label="Projektname *" span={2}><input autoFocus value={v.name} onChange={set('name')} placeholder="z. B. Kundenportal Müller Immobilien" /></Field>
        <Field label="Status">
          <select value={v.status} onChange={set('status')}>{Object.entries(PROJECT_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        <Field label="Kunde"><SelectCompany value={v.company_id} onChange={(id) => setV({ ...v, company_id: id })} /></Field>
        <Field label="Ansprechpartner" span={2}><SelectContact value={v.contact_id} companyId={v.company_id} onChange={(id) => setV({ ...v, contact_id: id })} /></Field>
        <Field label="Start"><input type="date" value={v.start_date || ''} onChange={set('start_date')} /></Field>
        <Field label="Ende (geplant)"><input type="date" value={v.end_date || ''} onChange={set('end_date')} /></Field>
        <Field label="App-Adresse"><input value={v.app_url || ''} onChange={set('app_url')} placeholder="https://…" /></Field>
        <Field label="devunox Review: Projekt-Kürzel" span={3} hint="Das Kürzel aus devunox Review (z. B. „geoauftrag“). Feedback zu diesem Projekt landet dann automatisch hier als Aufgabe. Wird bei neuem Feedback auch automatisch angelegt.">
          <input value={v.review_slug || ''} onChange={set('review_slug')} placeholder="geoauftrag" />
        </Field>
        <Field label="Beschreibung" span={3}><textarea rows={3} value={v.description || ''} onChange={set('description')} /></Field>
      </div>
    </Modal>
  );
}

export function ProjectCards({ list }: { list: any[] }) {
  return (
    <div className="proj-grid">
      {list.map((p) => {
        const pct = p.n_tasks ? Math.round((p.n_done / p.n_tasks) * 100) : 0;
        return (
          <div key={p.id} className="proj" onClick={() => go(`/projects/${p.id}`)}>
            <div className="proj-top">
              <div className={`proj-ico ${p.status === 'done' ? 'done' : ''}`}>{p.name.slice(0, 1).toUpperCase()}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</h3>
                <div className="muted" style={{ fontSize: 13 }}>{p.company_name || 'ohne Kunde'}</div>
              </div>
              <span className={`badge ${PROJECT_STATUS[p.status]?.[1] || 'grey'}`}>{PROJECT_STATUS[p.status]?.[0] || p.status}</span>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 5 }}><span className="muted">Fortschritt</span><b>{pct} %</b></div>
              <div className="bar"><div style={{ width: `${pct}%` }} /></div>
            </div>
            <div className="proj-stats">
              <span><b>{p.n_tasks - p.n_done}</b> offen</span>
              {p.n_feedback > 0 && <span><b>{p.n_feedback}</b> Feedback</span>}
              {p.n_unread > 0 && <span className="badge orange">{p.n_unread} neu</span>}
              <span><b>{p.n_docs}</b> Dokumente</span>
              {p.review_slug && <span className="badge violet">Review</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ProjectsList() {
  const [list, reload] = useLoad<any[]>('/projects');
  const [form, setForm] = useState(false);
  const [status, setStatus] = useState('open');
  const filtered = (list || []).filter((p) => (status === 'open' ? p.status !== 'done' : status === 'all' ? true : p.status === status));
  return (
    <>
      <PageHead
        title="Projekte"
        sub="Umsetzung je Kunde: Aufgaben, Feedback aus devunox Review und Dokumente."
        actions={<>
          <div className="seg">
            {[['open', 'Laufend'], ['done', 'Abgeschlossen'], ['all', 'Alle']].map(([k, l]) => <button key={k} className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>{l}</button>)}
          </div>
          <button className="btn primary" onClick={() => setForm(true)}>+ Projekt</button>
        </>}
      />
      {!list ? <Spinner /> : filtered.length === 0 ? (
        <div className="card"><Empty title="Noch keine Projekte" text="Lege ein Projekt an – oder erstelle es direkt aus einem angenommenen Angebot. Feedback aus devunox Review legt Projekte automatisch an." action={<button className="btn primary" onClick={() => setForm(true)}>+ Projekt</button>} /></div>
      ) : <ProjectCards list={filtered} />}
      {form && <ProjectForm onClose={() => setForm(false)} onSaved={(p) => { reload(); go(`/projects/${p.id}`); }} />}
    </>
  );
}

export function ProjectDetail({ id, me }: { id: string; me: Me }) {
  const [p, reload] = useLoad<any>(`/projects/${id}`);
  const [tab, setTab] = useState<'tasks' | 'docs' | 'time' | 'info'>('tasks');
  const [edit, setEdit] = useState(false);
  const [connect, setConnect] = useState(false);
  const [report, setReport] = useState(false);
  const { run } = useAction();
  void me;
  if (!p) return <Spinner />;
  return (
    <>
      <PageHead
        back="#/projects"
        title={<span style={{ display: 'inline-flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>{p.name} <span className={`badge ${PROJECT_STATUS[p.status]?.[1]}`}>{PROJECT_STATUS[p.status]?.[0]}</span></span>}
        sub={<>{p.customer_no && <span className="cno" style={{ marginRight: 8 }}>{p.customer_no}</span>}{p.company_name ? <a href={`#/companies/${p.company_id}`}>{p.company_name}</a> : 'ohne Kunde'}{p.quote_number && <> · Angebot <a href={`#/quotes/${p.quote_id}`}>{p.quote_number}</a></>}</>}
        actions={<>
          {p.review_url ? <a className="btn" href={p.review_url} target="_blank" rel="noreferrer">devunox Review ↗</a> : <button className="btn accent" onClick={() => setConnect(true)}>In devunox Review anlegen</button>}
          <button className="btn" onClick={() => setReport(true)}>Statusbericht</button>
          {p.app_url && <a className="btn" href={p.app_url} target="_blank" rel="noreferrer">App öffnen ↗</a>}
          <button className="btn" onClick={() => setEdit(true)}>Bearbeiten</button>
        </>}
      />
      <div className="tabs">
        <button className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}>Aufgaben</button>
        <button className={tab === 'docs' ? 'active' : ''} onClick={() => setTab('docs')}>Dokumente</button>
        <button className={tab === 'time' ? 'active' : ''} onClick={() => setTab('time')}>Zeiten</button>
        <button className={tab === 'info' ? 'active' : ''} onClick={() => setTab('info')}>Details</button>
      </div>
      {tab === 'time' && <div className="card"><TimeEntries projectId={id} companyId={p.company_id || undefined} title={p.name} /></div>}
      {tab === 'tasks' && (
        <>
          {!p.review_slug && <div className="legal" style={{ marginBottom: 14, background: 'var(--violet-soft)', color: 'var(--violet)' }}>Tipp: Mit „In devunox Review anlegen“ bekommt der Kunde einen Feedback-Zugang – sein Feedback landet dann automatisch hier als Aufgabe.</div>}
          <TaskBoard filter={`project_id=${id}`} projectId={id} companyId={p.company_id} showProject={false} />
        </>
      )}
      {tab === 'docs' && <div className="card"><DocBrowser projectId={id} companyId={p.company_id || undefined} /></div>}
      {tab === 'info' && (
        <div className="grid c2">
          <div className="card">
            <h2 style={{ marginBottom: 12 }}>Projekt</h2>
            <dl className="dl">
              <dt>Kunde</dt><dd>{p.company_name || '–'}</dd>
              <dt>Ansprechpartner</dt><dd>{p.contact_name || '–'}</dd>
              <dt>Zeitraum</dt><dd>{p.start_date ? fmtDate(p.start_date) : '–'} – {p.end_date ? fmtDate(p.end_date) : 'offen'}</dd>
              <dt>Angebot</dt><dd>{p.quote_number ? <a href={`#/quotes/${p.quote_id}`}>{p.quote_number} · {fmtMoney(p.quote_total, p.quote_currency)}</a> : '–'}</dd>
              <dt>Review</dt><dd>{p.review_slug ? <code>{p.review_slug}</code> : 'nicht verbunden'}</dd>
            </dl>
            {p.description && <p className="pre" style={{ marginTop: 14 }}>{p.description}</p>}
          </div>
          <div className="card">
            <h2 style={{ marginBottom: 12 }}>Aktionen</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {p.status !== 'done' && <button className="btn" onClick={() => run('d', async () => { await api.put(`/projects/${id}`, { status: 'done' }); reload(); }, 'Projekt abgeschlossen')}>Projekt abschließen</button>}
              {p.status === 'done' && <button className="btn" onClick={() => run('a', async () => { await api.put(`/projects/${id}`, { status: 'active' }); reload(); })}>Wieder öffnen</button>}
              <button className="btn danger" onClick={() => confirmDel('Projekt (Aufgaben bleiben erhalten)') && run('x', async () => { await api.del(`/projects/${id}`); go('/projects'); })}>Projekt löschen</button>
            </div>
          </div>
        </div>
      )}
      {edit && <ProjectForm initial={p} onClose={() => setEdit(false)} onSaved={reload} />}
      {connect && <ReviewConnect project={p} onClose={() => setConnect(false)} onDone={reload} />}
      {report && <ReportDialog project={p} onClose={() => setReport(false)} />}
    </>
  );
}

function ReportDialog({ project, onClose }: { project: any; onClose: () => void }) {
  const [lang, setLang] = useState('de');
  const [days, setDays] = useState('30');
  const [archive, setArchive] = useState(true);
  const url = `/api/projects/${project.id}/report?lang=${lang}&days=${days}${archive ? '&archive=1' : ''}`;
  return (
    <Modal title="Projektstatusbericht (PDF)" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Schließen</button><a className="btn primary" href={url} target="_blank" rel="noreferrer" onClick={() => setTimeout(onClose, 300)}>PDF erstellen</a></>}>
      <div className="form">
        <Field label="Sprache"><select value={lang} onChange={(e) => setLang(e.target.value)}><option value="de">Deutsch</option><option value="en">Englisch</option></select></Field>
        <Field label="Zeitraum"><select value={days} onChange={(e) => setDays(e.target.value)}><option value="7">letzte 7 Tage</option><option value="14">letzte 14 Tage</option><option value="30">letzte 30 Tage</option><option value="90">letzte 90 Tage</option></select></Field>
        <label className="check full"><input type="checkbox" checked={archive} onChange={(e) => setArchive(e.target.checked)} /> In der Kundenakte unter „Berichte“ ablegen</label>
        <p className="muted full" style={{ fontSize: 13, margin: 0 }}>Enthält Fortschritt, erledigte und offene Aufgaben, Kunden-Feedback und erfasste Zeiten – zum Weiterleiten an den Kunden.</p>
      </div>
    </Modal>
  );
}

function ReviewConnect({ project, onClose, onDone }: { project: any; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState<any>({ contact_id: project.contact_id || '', app_url: project.app_url || '', repo_url: '' });
  const [result, setResult] = useState<any>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  const go2 = () => run('c', async () => { const r = await api.post(`/projects/${project.id}/review-connect`, v); setResult(r); onDone(); }, 'Projekt in devunox Review angelegt');
  const inviteText = (r: any) => {
    const en = r.contact?.language === 'en';
    return en
      ? `Hello ${r.contact?.name || ''},\n\nyou can now give feedback on "${project.name}" directly in the app – just set a pin where something should change.\n\nPlease set your password here (link valid for 14 days):\n${r.invite_url}\n\nAfterwards you will find the project at:\n${r.hub_url}\n\nBest regards`
      : `Guten Tag ${r.contact?.name || ''},\n\nab sofort können Sie uns zu „${project.name}“ direkt in der App Feedback geben – einfach an der passenden Stelle einen Pin setzen.\n\nBitte legen Sie hier Ihr Passwort fest (Link 14 Tage gültig):\n${r.invite_url}\n\nDanach finden Sie das Projekt unter:\n${r.hub_url}\n\nViele Grüße`;
  };
  const sendInvite = () => run('m', async () => {
    const en = result.contact?.language === 'en';
    await api.post(`/contacts/${result.contact.id}/send-email`, { subject: en ? `Feedback access: ${project.name}` : `Ihr Feedback-Zugang: ${project.name}`, body: inviteText(result) });
  }, 'Einladung per Gmail gesendet');
  return (
    <Modal title="In devunox Review anlegen" onClose={onClose} footer={result ? <button className="btn primary" onClick={onClose}>Fertig</button> : <><button className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary" disabled={!!busy} onClick={go2}>{busy ? 'Lege an…' : 'Anlegen'}</button></>}>
      {!result ? (
        <div className="form">
          <p className="muted full" style={{ margin: 0, fontSize: 13 }}>Legt in devunox Review den Kunden {project.customer_no ? `(${project.customer_no}) ` : ''}mit Feedback-Zugang und dieses Projekt an. Feedback des Kunden erscheint danach automatisch hier als Aufgabe.</p>
          <Field label="Ansprechpartner (bekommt den Zugang)" span={2}><SelectContact value={v.contact_id} companyId={project.company_id} onChange={(id) => setV({ ...v, contact_id: id })} /></Field>
          <Field label="Adresse der App (mit Widget)" span={2}><input value={v.app_url} onChange={(e) => setV({ ...v, app_url: e.target.value })} placeholder="https://…" /></Field>
          <Field label="GitHub-Repo (optional)" span={2}><input value={v.repo_url} onChange={(e) => setV({ ...v, repo_url: e.target.value })} placeholder="https://github.com/HYigit19/…" /></Field>
        </div>
      ) : (
        <div className="stack">
          <div>Projekt <b>{result.project.slug}</b> ist angelegt{result.client.customer_no ? <> · Kunde <span className="cno">{result.client.customer_no}</span></> : null}.</div>
          {result.invite_url ? (
            <>
              <Field label="Einladungslink für den Kunden (14 Tage gültig)"><input readOnly value={result.invite_url} onFocus={(e) => e.target.select()} /></Field>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn" onClick={() => { navigator.clipboard?.writeText(result.invite_url); toast('Link kopiert'); }}>Link kopieren</button>
                {result.contact?.email && <button className="btn primary" disabled={!!busy} onClick={sendInvite}>Einladung per Gmail an {result.contact.email}</button>}
              </div>
            </>
          ) : (
            <div className="muted" style={{ fontSize: 13 }}>{result.contact_has_access ? 'Der Kunde hat bereits einen Zugang zu devunox Review – das neue Projekt ist dort sofort sichtbar.' : 'Kein Kundenzugang angelegt (kein Ansprechpartner mit E-Mail gewählt). Den Zugang kannst du später in devunox Review vergeben.'}</div>
          )}
        </div>
      )}
    </Modal>
  );
}
