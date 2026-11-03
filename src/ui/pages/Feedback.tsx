import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Empty, Field, Modal, PageHead, Spinner, fmtDateTime, useAction, useLoad, useToast } from '../components';
import { TaskDrawer } from './Tasks';

// Kunden-Feedback (Kundenportal, ehemals devunox Review) – jede Rückmeldung ist zugleich eine Aufgabe beim Kunden.

export const FB_STATUS: Record<string, [string, string]> = {
  offen: ['Offen', 'blue'],
  in_arbeit: ['In Arbeit', 'amber'],
  pruefen: ['Kunde prüft', 'violet'],
  erledigt: ['Abgenommen', 'green'],
  abgelehnt: ['Nicht umgesetzt', 'grey'],
};
const CAT: Record<string, string> = { fehler: 'Fehler', design: 'Design', funktion: 'Funktion', text: 'Text', idee: 'Idee' };
const PRIO: Record<string, [string, string]> = { hoch: ['Hoch', 'red'], mittel: ['Mittel', 'amber'], niedrig: ['Niedrig', 'grey'] };
const DEVICE: Record<string, string> = { mobile: '📱 Handy', tablet: '▭ Tablet', desktop: '🖥 Desktop' };

const sizeLabel = (n: number) => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1).replace('.', ',')} MB`);

/** Screenshot, Verlauf, Antwort und Status zu einem Feedback-Punkt */
export function FeedbackPanel({ item, onChanged, compact }: { item: any; onChanged: (it?: any) => void; compact?: boolean }) {
  const [reply, setReply] = useState('');
  const [zoom, setZoom] = useState(false);
  const fileIn = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  const attachments = item.files.filter((f: any) => !f.is_screenshot);

  const send = () => run('r', async () => { const it = await api.post(`/feedback/item/${item.id}/comments`, { body: reply }); setReply(''); onChanged(it); }, 'Antwort an den Kunden gesendet');
  const status = (s: string, label: string) => run('s' + s, async () => {
    if (!item.task) throw new Error('Zu diesem Punkt gibt es noch keine Aufgabe.');
    await api.put(`/tasks/${item.task.id}`, { status: s, note: reply || undefined });
    if (reply) setReply('');
    onChanged();
    toast(`${label} – an den Kunden gemeldet`);
  });
  const upload = (f?: File) => f && run('f', async () => {
    const fd = new FormData();
    fd.append('file', f);
    const res = await fetch(`/api/feedback/item/${item.id}/files`, { method: 'POST', body: fd });
    const d: any = await res.json();
    if (!res.ok) throw new Error(d.error || 'Upload fehlgeschlagen');
    onChanged(d);
  }, 'Datei an den Kunden gesendet');

  return (
    <div className={`fb-panel ${compact ? 'compact' : ''}`}>
      <div className="fb-main">
        {item.screenshot_url ? (
          <button className="fb-shot" onClick={() => setZoom(true)} title="Vergrößern">
            <img src={item.screenshot_url} alt="Screenshot mit Markierung" />
          </button>
        ) : <div className="fb-shot empty">Kein Screenshot</div>}
        <div className="fb-meta">
          <span className={`badge ${FB_STATUS[item.status]?.[1] || 'grey'}`}>{FB_STATUS[item.status]?.[0] || item.status}</span>
          <span className={`badge ${PRIO[item.priority]?.[1] || 'grey'}`}>{PRIO[item.priority]?.[0] || item.priority}</span>
          <span className="badge grey">{CAT[item.category] || item.category}</span>
          {item.device && <span className="muted">{DEVICE[item.device] || item.device}{item.vw ? ` · ${item.vw}×${item.vh}` : ''}</span>}
        </div>
        {item.page_url && <a className="fb-page" href={item.page_url} target="_blank" rel="noreferrer">↗ {item.page_title || item.page_url}</a>}
        <ChangeRequest item={item} onChanged={onChanged} />
      </div>

      <div className="fb-thread">
        <div className="fb-msg client">
          <div className="fb-who">{item.author_name || 'Kunde'} <span className="muted">· {fmtDateTime(item.created_at)}</span></div>
          <div className="fb-text"><b>{item.title}</b>{item.body && item.body !== item.title && <><br />{item.body}</>}</div>
        </div>
        {item.comments.map((cm: any) =>
          cm.kind === 'status' ? (
            <div key={cm.id} className="fb-status">
              {cm.author_name || 'devunox'} → <b>{cm.meta?.cr ? (cm.meta.cr === 'approved' ? '€ Mehraufwand freigegeben' : '€ Mehraufwand abgelehnt') : FB_STATUS[cm.meta?.to]?.[0] || cm.meta?.to}</b> · {fmtDateTime(cm.created_at)}
              {cm.body && <div className="fb-text">{cm.body}</div>}
            </div>
          ) : (
            <div key={cm.id} className={`fb-msg ${cm.author_role === 'client' ? 'client' : 'us'}`}>
              <div className="fb-who">{cm.author_name || (cm.author_role === 'client' ? 'Kunde' : 'devunox')} <span className="muted">· {fmtDateTime(cm.created_at)}</span></div>
              <div className="fb-text">{cm.body}</div>
            </div>
          ),
        )}
        {attachments.length > 0 && (
          <div className="fb-files">
            {attachments.map((f: any) => <a key={f.id} className="tag" href={f.url} target="_blank" rel="noreferrer">📎 {f.name} <span className="muted">{sizeLabel(f.size)}</span></a>)}
          </div>
        )}
        <div className="fb-reply">
          <textarea rows={compact ? 2 : 3} placeholder="Antwort an den Kunden – erscheint im Kundenportal" value={reply} onChange={(e) => setReply(e.target.value)} />
          <div className="fb-actions">
            <button className="btn sm" onClick={() => fileIn.current?.click()} disabled={!!busy}>📎 Datei</button>
            <input ref={fileIn} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; upload(f); }} />
            <span style={{ flex: 1 }} />
            {item.task && item.status !== 'in_arbeit' && <button className="btn sm" disabled={!!busy} onClick={() => status('doing', 'In Arbeit')}>In Arbeit</button>}
            {item.task && item.status !== 'pruefen' && item.status !== 'erledigt' && <button className="btn sm" disabled={!!busy} onClick={() => status('review', 'Zur Prüfung an den Kunden')}>✓ Umgesetzt – Kunde prüft</button>}
            <button className="btn sm primary" disabled={!reply.trim() || !!busy} onClick={send}>{busy === 'r' ? 'Sende…' : 'Antworten'}</button>
          </div>
          {item.task && <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>Text im Feld geht bei „Umgesetzt“ als Hinweis mit an den Kunden. Der Kunde nimmt im Portal ab – dann ist die Aufgabe erledigt.</div>}
        </div>
      </div>
      {zoom && item.screenshot_url && (
        <div className="modal-bg" onClick={() => setZoom(false)} style={{ cursor: 'zoom-out' }}>
          <img src={item.screenshot_url} alt="" style={{ maxWidth: '96vw', maxHeight: '92vh', borderRadius: 12, boxShadow: 'var(--shadow-l)' }} />
        </div>
      )}
    </div>
  );
}

const CR_LABEL: Record<string, [string, string]> = { proposed: ['Wartet auf Freigabe', 'amber'], approved: ['Freigegeben', 'green'], declined: ['Abgelehnt', 'red'] };

/** Mehraufwand: Aufwand/Preis vorschlagen, Kunde gibt im Portal frei, danach als Angebot übernehmen */
function ChangeRequest({ item, onChanged }: { item: any; onChanged: (it?: any) => void }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState({ days: item.cr_days || '', amount: item.cr_amount || '', note: item.cr_note || '' });
  const [settings] = useLoad<any>('/settings');
  const { busy, run } = useAction();
  const rate = Number(settings?.day_rate) || 0;
  const money = (n: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: item.cr_currency || 'EUR' }).format(n || 0);
  const propose = () => run('p', async () => { const it = await api.post(`/feedback/item/${item.id}/cr`, { days: Number(v.days) || null, amount: Number(v.amount) || null, note: v.note }); setEdit(false); onChanged(it); }, 'Mehraufwand zur Freigabe an den Kunden gesendet');
  const withdraw = () => run('w', async () => onChanged(await api.post(`/feedback/item/${item.id}/cr`, { withdraw: true })), 'Zurückgezogen');
  const toQuote = () => run('q', async () => {
    const t = item.task;
    const q = await api.post('/quotes', {
      company_id: t?.company_id || null, title: `Änderung #${item.no}: ${item.title}`.slice(0, 140), language: 'de',
      items: [{ name: `Änderung #${item.no}: ${item.title}`.slice(0, 200), description: item.body || '', qty: Number(item.cr_days) || 1, unit: Number(item.cr_days) ? 'PT' : 'Pauschal', unit_price: Number(item.cr_days) ? (Number(item.cr_amount) || 0) / Number(item.cr_days) : Number(item.cr_amount) || 0 }],
    });
    await api.post(`/quotes/${q.id}/status`, { status: 'accepted' }).catch(() => {});
    window.open(`#/quotes/${q.id}`, '_self');
  });
  if (!item.cr_status && !edit) return <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setEdit(true)}>€ Mehraufwand zur Freigabe</button>;
  if (edit) return (
    <div className="cr-box">
      <b>Mehraufwand vorschlagen</b>
      <div className="form" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 8 }}>
        <Field label="Aufwand (PT)"><input type="number" step="0.5" value={v.days} onChange={(e) => setV({ ...v, days: e.target.value, amount: rate && e.target.value ? String(Number(e.target.value) * rate) : v.amount })} /></Field>
        <Field label="Preis netto (€)"><input type="number" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
        <Field label="Hinweis für den Kunden (optional)" span={2}><textarea rows={2} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn sm primary" disabled={!!busy || (!v.days && !v.amount)} onClick={propose}>An Kunden senden</button>
        <button className="btn sm ghost" onClick={() => setEdit(false)}>Abbrechen</button>
      </div>
      {rate > 0 && <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>Preis wird aus dem Tagessatz ({money(rate)}) vorgeschlagen.</div>}
    </div>
  );
  return (
    <div className="cr-box">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <b>Mehraufwand</b><span className={`badge ${CR_LABEL[item.cr_status]?.[1]}`}>{CR_LABEL[item.cr_status]?.[0]}</span>
      </div>
      <div style={{ fontSize: 13.5, marginTop: 4 }}>{item.cr_days ? `${String(item.cr_days).replace('.', ',')} PT · ` : ''}<b>{money(item.cr_amount)}</b> netto</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {item.cr_status === 'approved' && <button className="btn sm primary" disabled={!!busy} onClick={toQuote}>Als Angebot (angenommen) übernehmen</button>}
        {item.cr_status !== 'approved' && <button className="btn sm" onClick={() => setEdit(true)}>Ändern</button>}
        {item.cr_status === 'proposed' && <button className="btn sm ghost" disabled={!!busy} onClick={withdraw}>Zurückziehen</button>}
      </div>
    </div>
  );
}

export function FeedbackDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const [it, setIt] = useState<any>(null);
  const [task, setTask] = useState<string | null>(null);
  const load = () => api.get(`/feedback/item/${id}`).then(setIt);
  useEffect(() => { load(); api.post(`/feedback/item/${id}/seen`).then(onChanged).catch(() => {}); }, [id]);
  return (
    <Modal wide title={it ? `#${it.no} · ${it.client_name} · ${it.project_name}` : 'Feedback'} onClose={onClose} footer={it && (
      <>
        <a className="btn ghost" href={it.portal_url} target="_blank" rel="noreferrer" style={{ marginRight: 'auto' }}>Im Kundenportal ↗</a>
        {it.task && <button className="btn" onClick={() => setTask(it.task.id)}>Aufgabe öffnen</button>}
        <button className="btn" onClick={onClose}>Schließen</button>
      </>
    )}>
      {!it ? <Spinner /> : <FeedbackPanel item={it} onChanged={(n) => { n ? setIt(n) : load(); onChanged(); }} />}
      {task && <TaskDrawer id={task} onClose={() => setTask(null)} onChanged={() => { load(); onChanged(); }} />}
    </Modal>
  );
}

export function FeedbackPage() {
  const [status, setStatus] = useState('open');
  const [company, setCompany] = useState('');
  const [list, reload] = useLoad<any[]>(`/feedback?${new URLSearchParams(Object.entries({ status, company_id: company }).filter(([, v]) => v)).toString()}`);
  const [all] = useLoad<any[]>('/feedback');
  const [open, setOpen] = useState<number | null>(() => Number(new URLSearchParams(window.location.hash.split('?')[1] || '').get('open')) || null);
  const clients = [...new Map((all || []).filter((x) => x.company_id).map((x) => [x.company_id, x.company_name])).entries()];
  const count = (f: (x: any) => boolean) => (all || []).filter(f).length;

  return (
    <>
      <PageHead title="Kunden-Feedback" sub="Änderungswünsche deiner Kunden aus dem Kundenportal – jeder Punkt ist automatisch eine Aufgabe beim Kunden." />
      <div className="toolbar">
        <div className="seg">
          {[['open', `Offen (${count((x) => ['offen', 'in_arbeit', 'pruefen'].includes(x.status))})`], ['pruefen', `Kunde prüft (${count((x) => x.status === 'pruefen')})`], ['cr', `Mehraufwand (${count((x) => ['proposed', 'approved'].includes(x.cr_status))})`], ['erledigt', 'Abgenommen'], ['', 'Alle']].map(([k, l]) => (
            <button key={k} className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>{l}</button>
          ))}
        </div>
        <select value={company} onChange={(e) => setCompany(e.target.value)}>
          <option value="">Alle Kunden</option>
          {clients.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </div>
      {!list ? <Spinner /> : list.length === 0 ? (
        <div className="card"><Empty title="Kein Feedback" text="Sobald ein Kunde im Portal oder in seiner App einen Punkt setzt, erscheint er hier – und als Aufgabe beim Kunden." /></div>
      ) : (
        <div className="fb-grid">
          {list.map((x) => (
            <button key={x.id} className="fb-card" onClick={() => setOpen(x.id)}>
              <div className="fb-thumb">{x.screenshot_url ? <img src={x.screenshot_url} alt="" loading="lazy" /> : <span>#{x.no}</span>}{x.unread && <i className="unread" />}</div>
              <div className="fb-body">
                <div className="fb-top"><span className={`badge ${FB_STATUS[x.status]?.[1] || 'grey'}`}>{FB_STATUS[x.status]?.[0]}</span>{x.cr_status && <span className={`badge ${CR_LABEL[x.cr_status]?.[1]}`}>€ {CR_LABEL[x.cr_status]?.[0]}</span>}<span className={`dot prio-${x.priority === 'hoch' ? 'high' : x.priority === 'niedrig' ? 'low' : 'medium'}`} /></div>
                <b>#{x.no} {x.title}</b>
                <span className="muted">{x.company_name} · {x.project_name}</span>
                <span className="muted fb-foot">{CAT[x.category] || x.category}{x.n_comments ? ` · 💬 ${x.n_comments}` : ''}{x.n_files ? ` · 📎 ${x.n_files}` : ''} · {fmtDateTime(x.last_activity_at)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
      {open && <FeedbackDrawer id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  );
}

/** Kundenportal-Zugänge einer Firma (mehrere Personen, Freigaberecht) */
export function PortalAccessCard({ companyId, contacts }: { companyId: string; contacts?: any[] }) {
  const [a, reload] = useLoad<any>(`/feedback/access/${companyId}`);
  const [inv, setInv] = useState(false);
  const [link, setLink] = useState<any>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  if (!a) return <div className="card"><Spinner /></div>;
  const users: any[] = a.users || [];
  const createLink = (body: any = {}) => run('i', async () => { const r = await api.post(`/feedback/access/${companyId}/invite`, body); setLink(r); setInv(false); reload(); });
  const updUser = (id: number, body: any, msg: string) => run('u' + id, async () => { await api.put(`/feedback/access/users/${id}`, body); reload(); }, msg);
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast('Link kopiert'); } catch { prompt('Link kopieren:', t); } };
  const mail = (r: any) => {
    const en = r.lang === 'en';
    const subject = en ? 'Your access to the devunox client portal' : 'Ihr Zugang zum devunox Kundenportal';
    const body = en
      ? `Hello ${r.name},\n\nhere is your personal link to the devunox client portal. You can set your password there and then leave feedback directly in your app:\n\n${r.url}\n\nThe link is valid for 14 days.\n\nBest regards\nHüseyin Yigit`
      : `Hallo ${r.name},\n\nhier ist Ihr persönlicher Link zum devunox Kundenportal. Dort legen Sie Ihr Passwort fest und können danach Feedback direkt in Ihrer App geben:\n\n${r.url}\n\nDer Link ist 14 Tage gültig.\n\nViele Grüße\nHüseyin Yigit`;
    window.location.href = `mailto:${r.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };
  return (
    <div className="card">
      <div className="card-head">
        <h2>Kundenportal-Zugänge</h2>
        <span className={`badge ${users.some((u) => u.active && u.has_password) ? 'green' : users.length ? 'amber' : 'grey'}`}>{users.length ? `${users.length} Person${users.length === 1 ? '' : 'en'}` : 'Kein Zugang'}</span>
      </div>
      {users.length === 0 && <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>Kunden bekommen eigene Logins und sehen nur ihre Projekte. Feedback landet automatisch als Aufgabe hier im CRM.</p>}
      {users.map((u) => (
        <div key={u.id} className="portal-user">
          <div className="avatar" style={{ width: 32, height: 32, flex: '0 0 32px', fontSize: 13 }}>{(u.name || u.email)[0]}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <b style={{ display: 'block' }}>{u.name}</b>
            <span className="muted" style={{ fontSize: 12 }}>{u.email} · {!u.active ? 'gesperrt' : u.has_password ? (u.last_login ? `zuletzt ${fmtDateTime(u.last_login)}` : 'aktiv') : 'eingeladen'}</span>
            <label className="check" style={{ fontSize: 12, marginTop: 4 }}><input type="checkbox" checked={!!u.can_approve} onChange={(e) => updUser(u.id, { can_approve: e.target.checked }, 'Freigaberecht geändert')} /> darf Mehraufwand freigeben</label>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button className="btn sm" disabled={!!busy} onClick={() => createLink({ user_id: u.id })}>{u.has_password ? 'Passwort-Link' : 'Einladung'}</button>
            <button className="btn sm ghost" disabled={!!busy} onClick={() => updUser(u.id, { active: !u.active }, u.active ? 'Zugang gesperrt' : 'Zugang aktiviert')}>{u.active ? 'Sperren' : 'Entsperren'}</button>
          </div>
        </div>
      ))}
      {a.projects?.length > 0 && <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>Projekte im Portal: {a.projects.map((p: any) => `${p.name} (${p.n_items})`).join(' · ')}{a.open ? ` · ${a.open} offen` : ''}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <button className="btn sm primary" onClick={() => setInv(true)}>+ Person einladen</button>
        <a className="btn sm ghost" href={a.portal_url} target="_blank" rel="noreferrer">Portal öffnen ↗</a>
      </div>
      {link && (
        <div className="portal-link">
          <div className="muted" style={{ fontSize: 12.5 }}>{link.purpose === 'invite' ? 'Einladungslink' : 'Link zum Passwort-Setzen'} für {link.email} · 14 Tage gültig</div>
          <code>{link.url}</code>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn sm" onClick={() => copy(link.url)}>Kopieren</button>
            <button className="btn sm primary" onClick={() => mail(link)}>Per Mail senden</button>
          </div>
        </div>
      )}
      {inv && <InviteDialog contacts={(contacts || []).filter((c) => !users.some((u) => u.email === String(c.email || '').toLowerCase()))} onClose={() => setInv(false)} onCreate={createLink} busy={!!busy} />}
    </div>
  );
}

function InviteDialog({ contacts, onClose, onCreate, busy }: { contacts: any[]; onClose: () => void; onCreate: (b: any) => void; busy: boolean }) {
  const withMail = contacts.filter((c) => c.email);
  const [v, setV] = useState({ contact_id: withMail[0]?.id || '', email: '', name: '', lang: 'de', can_approve: true });
  return (
    <Modal title="Person ins Kundenportal einladen" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary" disabled={busy || (!v.contact_id && !v.email)} onClick={() => onCreate(v.contact_id ? { contact_id: v.contact_id, can_approve: v.can_approve } : v)}>Einladen</button></>}>
      <div className="form">
        {withMail.length > 0 && (
          <Field label="Ansprechpartner" span={2}>
            <select value={v.contact_id} onChange={(e) => setV({ ...v, contact_id: e.target.value })}>
              {withMail.map((c) => <option key={c.id} value={c.id}>{[c.first_name, c.last_name].filter(Boolean).join(' ')} · {c.email}</option>)}
              <option value="">Andere Person …</option>
            </select>
          </Field>
        )}
        {!v.contact_id && (
          <>
            <Field label="Name"><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
            <Field label="E-Mail"><input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
            <Field label="Sprache"><select value={v.lang} onChange={(e) => setV({ ...v, lang: e.target.value })}><option value="de">Deutsch</option><option value="en">English</option></select></Field>
          </>
        )}
        <label className="check full"><input type="checkbox" checked={v.can_approve} onChange={(e) => setV({ ...v, can_approve: e.target.checked })} /> darf Mehraufwand freigeben</label>
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>Jede Person hat einen eigenen Login und sieht alle Projekte dieses Kunden. Du bekommst einen Einladungslink zum Kopieren oder Mailen.</p>
    </Modal>
  );
}
