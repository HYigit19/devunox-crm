import React, { useState } from 'react';
import { api } from '../api';
import { Field, Modal, fmtDateTime, useAction, useForm, useLoad, Empty, Spinner } from '../components';

const ICONS: Record<string, string> = { note: '✎', call: '☏', meeting: '◷', task: '☐', email: '✉', agent: '✦', system: '•' };
const TYPE_LABEL: Record<string, string> = { note: 'Notiz', call: 'Anruf', meeting: 'Termin', task: 'Aufgabe', email: 'E-Mail', agent: 'KI-Agent', system: 'System' };

export function Activities({ filter, companyId, contactId, dealId }: { filter: string; companyId?: string; contactId?: string; dealId?: string }) {
  const [list, reload] = useLoad<any[]>(`/activities?${filter}`);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const { run } = useAction();

  const toggle = (a: any) => run('t', async () => {
    await api.put(`/activities/${a.id}`, { done: a.done ? 0 : 1 });
    reload();
  });

  return (
    <div className="card">
      <div className="card-head">
        <h2>Aktivitäten</h2>
        <button className="btn sm" onClick={() => setAdding(true)}>
          + Eintrag
        </button>
      </div>
      {!list ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Empty title="Noch keine Aktivitäten" text="Notizen, Anrufe, Aufgaben und gesendete Mails erscheinen hier." />
      ) : (
        <div className="timeline">
          {list.map((a) => (
            <div className="tl-item" key={a.id}>
              <div className={`tl-dot ${a.type} ${a.type === 'task' && a.done ? 'done' : ''}`} onClick={() => a.type === 'task' && toggle(a)} style={{ cursor: a.type === 'task' ? 'pointer' : undefined }} title={a.type === 'task' ? 'Erledigt umschalten' : ''}>
                {a.type === 'task' && a.done ? '✓' : ICONS[a.type] || '•'}
              </div>
              <div className="tl-body">
                <div className="tl-title" style={{ textDecoration: a.type === 'task' && a.done ? 'line-through' : undefined }}>
                  {a.subject || TYPE_LABEL[a.type]}
                </div>
                <div className="tl-meta">
                  {TYPE_LABEL[a.type]} · {fmtDateTime(a.created_at)}
                  {a.due_at && ` · fällig ${fmtDateTime(a.due_at)}`}
                  {a.calendar_event_id && ' · im Kalender'}
                </div>
                {a.body && (
                  <div className={`tl-text ${open === a.id ? 'open' : ''}`} onClick={() => setOpen(open === a.id ? null : a.id)}>
                    {a.body}
                  </div>
                )}
              </div>
              <button
                className="icon-btn"
                title="Löschen"
                onClick={() =>
                  confirm('Eintrag löschen?') &&
                  run('d', async () => {
                    await api.del(`/activities/${a.id}`);
                    reload();
                  })
                }
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      )}
      {adding && <AddActivity onClose={() => setAdding(false)} onSaved={reload} companyId={companyId} contactId={contactId} dealId={dealId} />}
    </div>
  );
}

export function AddActivity({ onClose, onSaved, companyId, contactId, dealId }: { onClose: () => void; onSaved: () => void; companyId?: string; contactId?: string; dealId?: string }) {
  const { v, set } = useForm({ type: 'note', subject: '', body: '', due_at: '', add_to_calendar: 0, invite_contact: 0, duration_min: '30' });
  const { busy, run } = useAction();
  const withDate = v.type === 'task' || v.type === 'meeting' || v.type === 'call';
  const save = () =>
    run(
      'save',
      async () => {
        const r = await api.post('/activities', {
          ...v,
          due_at: v.due_at || null,
          done: v.type === 'task' || v.type === 'meeting' ? 0 : 1,
          company_id: companyId || null,
          contact_id: contactId || null,
          deal_id: dealId || null,
        });
        onSaved();
        onClose();
        return r;
      },
      v.add_to_calendar ? 'Gespeichert und im Google Kalender eingetragen' : 'Gespeichert',
    );
  return (
    <Modal
      title="Neuer Eintrag"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn primary" disabled={!!busy} onClick={save}>Speichern</button>
        </>
      }
    >
      <div className="form">
        <Field label="Art">
          <select value={v.type} onChange={set('type')}>
            <option value="note">Notiz</option>
            <option value="call">Anruf</option>
            <option value="meeting">Termin</option>
            <option value="task">Aufgabe / Follow-up</option>
          </select>
        </Field>
        {withDate ? (
          <Field label="Datum & Uhrzeit">
            <input type="datetime-local" value={v.due_at} onChange={set('due_at')} />
          </Field>
        ) : (
          <div />
        )}
        <Field label="Betreff" span={2}>
          <input value={v.subject} onChange={set('subject')} autoFocus />
        </Field>
        <Field label="Details" span={2}>
          <textarea value={v.body} onChange={set('body')} rows={4} />
        </Field>
        {withDate && v.due_at && (
          <div className="full stack" style={{ gap: 6 }}>
            <label className="check">
              <input type="checkbox" checked={!!v.add_to_calendar} onChange={set('add_to_calendar')} /> In Google Kalender eintragen
            </label>
            {!!v.add_to_calendar && contactId && (
              <label className="check">
                <input type="checkbox" checked={!!v.invite_contact} onChange={set('invite_contact')} /> Kontakt als Teilnehmer einladen
              </label>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** E-Mail an Kontakt schreiben, optional mit KI-Entwurf */
export function ComposeMail({ contact, onClose, onSent }: { contact: any; onClose: () => void; onSent: () => void }) {
  const { v, set, setV } = useForm({ subject: '', body: '', cc: '', purpose: '' });
  const { busy, run } = useAction();
  const ai = () =>
    run('ai', async () => {
      const r = await api.post(`/contacts/${contact.id}/ai-email`, { purpose: v.purpose, language: contact.language });
      setV((o) => ({ ...o, subject: r.subject, body: r.body }));
    });
  const send = () =>
    run(
      'send',
      async () => {
        await api.post(`/contacts/${contact.id}/send-email`, { subject: v.subject, body: v.body, cc: v.cc || undefined });
        onSent();
        onClose();
      },
      'E-Mail über Gmail gesendet',
    );
  return (
    <Modal
      wide
      title={`E-Mail an ${[contact.first_name, contact.last_name].filter(Boolean).join(' ')}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn primary" disabled={!!busy || !v.subject || !v.body} onClick={send}>
            {busy === 'send' ? 'Sende…' : 'Über Gmail senden'}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="ai-box">
          <Field label="✦ KI-Entwurf – worum geht es?">
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={v.purpose} onChange={set('purpose')} placeholder="z. B. Nachfassen zum Angebot, Termin für Kickoff vorschlagen…" />
              <button className="btn ai" disabled={!!busy || !v.purpose} onClick={ai}>
                {busy === 'ai' ? 'Schreibe…' : 'Entwurf'}
              </button>
            </div>
          </Field>
        </div>
        <div className="form">
          <Field label="An">
            <input value={contact.email || ''} disabled />
          </Field>
          <Field label="CC">
            <input value={v.cc} onChange={set('cc')} />
          </Field>
          <Field label="Betreff" span={2}>
            <input value={v.subject} onChange={set('subject')} />
          </Field>
          <Field label="Nachricht" span={2}>
            <textarea value={v.body} onChange={set('body')} rows={12} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

export function GmailHistory({ contactId, enabled }: { contactId: string; enabled: boolean }) {
  const [list, , loading, err] = useLoad<any[]>(enabled ? `/contacts/${contactId}/emails` : null);
  if (!enabled) return <Empty title="Google nicht verbunden" text="Melde dich mit Google an, um den Gmail-Verlauf zu sehen." />;
  if (loading) return <Spinner />;
  if (err) return <div className="muted">Fehler: {err}</div>;
  if (!list?.length) return <Empty title="Kein E-Mail-Verlauf" text="In deinem Gmail gibt es noch keine Mails mit diesem Kontakt." />;
  return (
    <div className="timeline">
      {list.map((m) => (
        <div className="tl-item" key={m.id}>
          <div className="tl-dot email">{m.direction === 'in' ? '↘' : '↗'}</div>
          <div className="tl-body">
            <div className="tl-title">
              <a href={`https://mail.google.com/mail/u/0/#all/${m.threadId}`} target="_blank" rel="noreferrer">
                {m.subject || '(kein Betreff)'}
              </a>
            </div>
            <div className="tl-meta">
              {m.direction === 'in' ? 'Empfangen' : 'Gesendet'} · {fmtDateTime(m.date)}
            </div>
            <div className="tl-text">{m.snippet}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
