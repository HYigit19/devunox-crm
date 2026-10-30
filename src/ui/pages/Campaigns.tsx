import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { Badge, CAMPAIGN_STATUS, ENR_STATUS, Empty, Field, Modal, PageHead, Spinner, confirmDel, fmtDateTime, fullName, go, useAction, useLoad } from '../components';
import type { Me } from '../main';

type Step = { delay_days: number; instruction: string };

function CampaignForm({ initial, onClose, onSaved }: { initial?: any; onClose: () => void; onSaved: (k: any) => void }) {
  const [defaults] = useLoad<{ steps: Step[] }>('/campaigns/defaults');
  const [v, setV] = useState<any>(null);
  useEffect(() => {
    if (initial) setV({ ...initial, steps: typeof initial.steps === 'string' ? JSON.parse(initial.steps) : initial.steps });
    else if (defaults)
      setV({
        name: '', goal: 'Kurzes Erstgespräch (15 Min.) vereinbaren', offer: '', audience: '', tone: 'professionell, direkt, freundlich, auf Augenhöhe',
        language: 'auto', steps: defaults.steps, daily_limit: 20, research: 1, require_consent: 1, booking_link: '',
      });
  }, [defaults, initial]);
  const { busy, run } = useAction();
  if (!v) return null;
  const set = (k: string) => (e: any) => setV({ ...v, [k]: e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value });
  const setStep = (i: number, k: keyof Step, val: any) => setV({ ...v, steps: v.steps.map((s: Step, idx: number) => (idx === i ? { ...s, [k]: val } : s)) });
  const save = () => run('s', async () => {
    const body = { ...v, daily_limit: Number(v.daily_limit) || 20 };
    const r = initial?.id ? await api.put(`/campaigns/${initial.id}`, body) : await api.post('/campaigns', body);
    onSaved(r);
    onClose();
  }, 'Kampagne gespeichert');

  return (
    <Modal
      wide
      title={initial?.id ? 'Kampagne bearbeiten' : 'Neue KI-Kampagne'}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary" disabled={!v.name || !!busy} onClick={save}>Speichern</button></>}
    >
      <div className="stack">
        <div className="form">
          <Field label="Name *" span={2}><input value={v.name} onChange={set('name')} autoFocus placeholder="z. B. SAP QM S/4-Migration – Pharma DACH" /></Field>
          <Field label="Ziel der Ansprache" span={2}><input value={v.goal || ''} onChange={set('goal')} /></Field>
          <Field label="Was bieten wir an?" span={2} hint="Konkret: Leistung, Nutzen, Preismodell. Der Agent nutzt nur, was hier und im Firmenprofil steht.">
            <textarea rows={3} value={v.offer || ''} onChange={set('offer')} placeholder="SAP QM Migration nach S/4HANA zum Festpreis, erfahrene Nearshore-Berater mit deutschem PM, Start innerhalb von 2 Wochen…" />
          </Field>
          <Field label="Zielgruppe / Kontext" span={2}><input value={v.audience || ''} onChange={set('audience')} placeholder="Qualitätsleiter und SAP-Verantwortliche in Pharma- und Medizintechnik-Unternehmen" /></Field>
          <Field label="Tonalität"><input value={v.tone || ''} onChange={set('tone')} /></Field>
          <Field label="Sprache">
            <select value={v.language} onChange={set('language')}>
              <option value="auto">Automatisch (DACH = Deutsch, sonst Englisch)</option>
              <option value="de">Immer Deutsch</option>
              <option value="en">Immer Englisch</option>
            </select>
          </Field>
          <Field label="Terminbuchungslink (optional)"><input value={v.booking_link || ''} onChange={set('booking_link')} placeholder="https://calendar.app.google/…" /></Field>
          <Field label="Max. Mails pro Tag"><input type="number" min={1} max={200} value={v.daily_limit} onChange={set('daily_limit')} /></Field>
          <label className="check full"><input type="checkbox" checked={!!v.research} onChange={set('research')} /> Vor der ersten Mail Firma im Web recherchieren (bessere Personalisierung, etwas langsamer)</label>
          <label className="check full"><input type="checkbox" checked={!!v.require_consent} onChange={set('require_consent')} /> Rechtsschutz: Kontakte in EU/DACH/UK nur mit Einwilligung oder als Bestandskunde anschreiben</label>
        </div>
        {!v.require_consent && <div className="legal">⚠ Ohne Rechtsschutz schreibt der Agent auch Kontakte in DACH/EU ohne Einwilligung an. In Deutschland (UWG § 7) und Polen ist E-Mail-Werbung ohne vorherige Einwilligung in der Regel auch an Firmen unzulässig – Abmahnrisiko.</div>}
        <div>
          <h4 style={{ marginBottom: 10 }}>Sequenz ({v.steps.length} Mails)</h4>
          <div className="steps">
            {v.steps.map((s: Step, i: number) => (
              <div className="step" key={i}>
                <div className="step-head">
                  <b>Mail {i + 1}</b>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {i > 0 && <><span className="muted" style={{ fontSize: 13 }}>nach</span><input type="number" min={1} style={{ width: 64 }} value={s.delay_days} onChange={(e) => setStep(i, 'delay_days', Number(e.target.value))} /><span className="muted" style={{ fontSize: 13 }}>Tagen</span></>}
                    {v.steps.length > 1 && <button className="icon-btn" onClick={() => setV({ ...v, steps: v.steps.filter((_: any, idx: number) => idx !== i) })}>✕</button>}
                  </div>
                </div>
                <textarea rows={2} value={s.instruction} onChange={(e) => setStep(i, 'instruction', e.target.value)} />
              </div>
            ))}
          </div>
          {v.steps.length < 6 && <button className="btn sm" onClick={() => setV({ ...v, steps: [...v.steps, { delay_days: 5, instruction: 'Follow-up: kurz nachfassen.' }] })}>+ Schritt</button>}
          <p className="muted" style={{ fontSize: 12.5 }}>Follow-ups gehen im selben E-Mail-Verlauf raus und stoppen automatisch, sobald der Kontakt antwortet.</p>
        </div>
      </div>
    </Modal>
  );
}

export function CampaignsList({ me }: { me: Me }) {
  const [list, reload] = useLoad<any[]>('/campaigns');
  const [form, setForm] = useState(false);
  return (
    <>
      <PageHead
        title="KI-Agent"
        sub="Automatische, personalisierte Ansprache über dein Gmail – mit Follow-ups, Antwort-Erkennung und Abmeldelink."
        actions={<button className="btn primary" onClick={() => setForm(true)}>+ Kampagne</button>}
      />
      {!me.ai && <div className="legal" style={{ marginBottom: 16 }}>Der KI-Agent ist noch nicht aktiv: In Cloudflare fehlt das Secret <b>ANTHROPIC_API_KEY</b>.</div>}
      <div className="card flush">
        {!list ? <div style={{ padding: 20 }}><Spinner /></div> : list.length === 0 ? (
          <Empty
            title="Noch keine Kampagnen"
            text="Lege eine Kampagne an, beschreibe dein Angebot und füge Kontakte hinzu. Der Agent schreibt jede Mail individuell und versendet sie werktags im Zeitfenster."
            action={<button className="btn primary" onClick={() => setForm(true)}>+ Kampagne</button>}
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Kampagne</th><th>Status</th><th className="num">Kontakte</th><th className="num">Gesendet</th><th className="num">Antworten</th><th className="num hide-m">Antwortquote</th></tr></thead>
              <tbody>
                {list.map((k) => (
                  <tr key={k.id} className="click" onClick={() => go(`/campaigns/${k.id}`)}>
                    <td><b>{k.name}</b><div className="muted" style={{ fontSize: 12 }}>{k.goal}</div></td>
                    <td><Badge map={CAMPAIGN_STATUS} value={k.status} /></td>
                    <td className="num">{k.enrolled}</td>
                    <td className="num">{k.sent}</td>
                    <td className="num">{k.replied}</td>
                    <td className="num hide-m">{k.enrolled ? Math.round((k.replied / k.enrolled) * 100) : 0} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {form && <CampaignForm onClose={() => setForm(false)} onSaved={(k) => go(`/campaigns/${k.id}`)} />}
    </>
  );
}

function AddContacts({ campaignId, onClose, onDone }: { campaignId: string; onClose: () => void; onDone: () => void }) {
  const [tag, setTag] = useState('');
  const [tags] = useLoad<string[]>('/tags');
  const [list] = useLoad<any[]>(`/contacts${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<any>(null);
  const { busy, run } = useAction();
  const usable = (list || []).filter((c) => c.email && c.consent !== 'opt_out');
  const add = () => run('a', async () => { const r = await api.post(`/campaigns/${campaignId}/enroll`, { contact_ids: [...sel] }); setResult(r); onDone(); });
  return (
    <Modal wide title="Kontakte hinzufügen" onClose={onClose} footer={result ? <button className="btn primary" onClick={onClose}>Fertig</button> : <button className="btn primary" disabled={!sel.size || !!busy} onClick={add}>{sel.size} hinzufügen</button>}>
      {result ? (
        <div className="stack">
          <div><b>{result.added}</b> Kontakte hinzugefügt.</div>
          {result.rejected.length > 0 && <div className="legal"><b>{result.rejected.length} nicht hinzugefügt:</b><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{result.rejected.slice(0, 20).map((r: any) => <li key={r.id}>{r.name}: {r.reason}</li>)}</ul></div>}
        </div>
      ) : (
        <div className="stack">
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <select style={{ width: 'auto' }} value={tag} onChange={(e) => { setTag(e.target.value); setSel(new Set()); }}>
              <option value="">Alle Kontakte</option>
              {(tags || []).map((t) => <option key={t}>{t}</option>)}
            </select>
            <button className="btn sm" onClick={() => setSel(new Set(usable.map((c) => c.id)))}>Alle {usable.length} wählen</button>
            <button className="btn sm ghost" onClick={() => setSel(new Set())}>Auswahl leeren</button>
          </div>
          <div className="table-wrap" style={{ maxHeight: 380, overflow: 'auto' }}>
            <table>
              <tbody>
                {usable.map((c) => (
                  <tr key={c.id} className="click" onClick={() => setSel((s) => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })}>
                    <td style={{ width: 30 }}><input type="checkbox" readOnly checked={sel.has(c.id)} /></td>
                    <td><b>{fullName(c)}</b> <span className="muted">{c.position}</span></td>
                    <td>{c.company_name}</td>
                    <td>{c.country || c.company_country}</td>
                    <td>{c.consent === 'none' ? <span className="badge grey">ohne Einwilligung</span> : c.consent === 'consent' ? <span className="badge green">Einwilligung</span> : <span className="badge blue">Kunde</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Preview({ campaignId, enrollments, onClose }: { campaignId: string; enrollments: any[]; onClose: () => void }) {
  const [cid, setCid] = useState(enrollments[0]?.contact_id || '');
  const [step, setStep] = useState(0);
  const [mail, setMail] = useState<any>(null);
  const { busy, run } = useAction();
  const gen = () => run('p', async () => setMail(await api.post(`/campaigns/${campaignId}/preview`, { contact_id: cid, step })));
  return (
    <Modal wide title="Vorschau – so schreibt der Agent" onClose={onClose}>
      <div className="stack">
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <select style={{ width: 'auto' }} value={cid} onChange={(e) => setCid(e.target.value)}>
            {enrollments.map((e) => <option key={e.contact_id} value={e.contact_id}>{fullName(e)} · {e.company_name}</option>)}
          </select>
          <select style={{ width: 'auto' }} value={step} onChange={(e) => setStep(Number(e.target.value))}>
            {[0, 1, 2, 3, 4, 5].map((i) => <option key={i} value={i}>Mail {i + 1}</option>)}
          </select>
          <button className="btn ai" disabled={!cid || !!busy} onClick={gen}>{busy ? 'Schreibe…' : 'Vorschau erzeugen'}</button>
        </div>
        {mail && (
          <>
            {mail.warning && <div className="legal">Hinweis: {mail.warning}</div>}
            <div><span className="muted">An:</span> {mail.to}<br /><span className="muted">Betreff:</span> <b>{mail.subject}</b></div>
            <div className="mail-preview">{mail.body}</div>
            <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Es wird nichts gesendet. Jede echte Mail wird beim Versand neu und individuell geschrieben.</p>
          </>
        )}
      </div>
    </Modal>
  );
}

export function CampaignDetail({ id, me }: { id: string; me: Me }) {
  const [k, reload] = useLoad<any>(`/campaigns/${id}`);
  const [edit, setEdit] = useState(false);
  const [add, setAdd] = useState(false);
  const [preview, setPreview] = useState(false);
  const [tab, setTab] = useState<'contacts' | 'mails' | 'log'>('contacts');
  const [openMsg, setOpenMsg] = useState<string | null>(null);
  const { busy, run } = useAction();
  if (!k) return <Spinner />;
  const steps: Step[] = JSON.parse(k.steps);
  const count = (s: string) => k.enrollments.filter((e: any) => e.status === s).length;
  const status = (s: string) => run('st', async () => { await api.post(`/campaigns/${id}/status`, { status: s }); reload(); }, s === 'active' ? 'Kampagne gestartet – der Agent sendet werktags im Versandfenster' : 'Status geändert');
  const enrAction = (eid: string, action: string, msg?: string) => run(eid, async () => {
    if (action === 'delete') await api.del(`/campaigns/${id}/enrollments/${eid}`);
    else await api.post(`/campaigns/${id}/enrollments/${eid}/${action}`);
    reload();
  }, msg);

  return (
    <>
      <PageHead
        back="#/campaigns"
        title={<>{k.name} <Badge map={CAMPAIGN_STATUS} value={k.status} /></>}
        sub={k.goal}
        actions={
          <>
            <button className="btn" onClick={() => setEdit(true)}>Bearbeiten</button>
            <button className="btn" disabled={!k.enrollments.length || !me.ai} onClick={() => setPreview(true)}>Vorschau</button>
            <button className="btn" onClick={() => setAdd(true)}>+ Kontakte</button>
            {k.status === 'active' ? (
              <button className="btn" disabled={!!busy} onClick={() => status('paused')}>❚❚ Pausieren</button>
            ) : (
              <button className="btn primary" disabled={!!busy || !count('active') || !me.google || !me.ai} onClick={() => confirm(`Kampagne starten? Der Agent sendet automatisch bis zu ${k.daily_limit} Mails pro Tag über dein Gmail.`) && status('active')}>▶ Starten</button>
            )}
          </>
        }
      />
      <div className="grid k4" style={{ marginBottom: 16 }}>
        <div className="card kpi"><div className="label">Kontakte</div><div className="value">{k.enrollments.length}</div><div className="meta">{count('active')} aktiv in Sequenz</div></div>
        <div className="card kpi"><div className="label">Gesendete Mails</div><div className="value">{k.messages.length}</div><div className="meta">max. {k.daily_limit}/Tag</div></div>
        <div className="card kpi"><div className="label">Antworten</div><div className="value">{count('replied')}</div><div className="meta">{k.enrollments.filter((e: any) => e.reply_class === 'interessiert').length} interessiert</div></div>
        <div className="card kpi"><div className="label">Abgemeldet</div><div className="value">{count('opted_out')}</div><div className="meta">{count('error')} Fehler</div></div>
      </div>
      <div className="grid side">
        <div>
          <div className="tabs">
            <button className={tab === 'contacts' ? 'active' : ''} onClick={() => setTab('contacts')}>Kontakte</button>
            <button className={tab === 'mails' ? 'active' : ''} onClick={() => setTab('mails')}>Gesendete Mails</button>
            <button className={tab === 'log' ? 'active' : ''} onClick={() => setTab('log')}>Protokoll</button>
          </div>
          {tab === 'contacts' && (
            <div className="card flush">
              {k.enrollments.length === 0 ? <Empty title="Noch keine Kontakte" text="Füge Kontakte hinzu – einzeln, per Tag oder aus der Kontaktliste." action={<button className="btn primary" onClick={() => setAdd(true)}>+ Kontakte</button>} /> : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Kontakt</th><th>Status</th><th>Schritt</th><th className="hide-m">Nächste Mail</th><th /></tr></thead>
                    <tbody>
                      {k.enrollments.map((e: any) => (
                        <tr key={e.id}>
                          <td><a href={`#/contacts/${e.contact_id}`}><b>{fullName(e)}</b></a><div className="muted" style={{ fontSize: 12 }}>{e.company_name} {e.country && `· ${e.country}`}</div>
                            {e.reply_snippet && <div style={{ fontSize: 12, marginTop: 4 }}>↩ <i>{e.reply_snippet.slice(0, 120)}</i></div>}
                            {e.error && <div style={{ fontSize: 12, color: 'var(--red)' }}>{e.error}</div>}
                          </td>
                          <td><Badge map={ENR_STATUS} value={e.status} />{e.reply_class && <div className="muted" style={{ fontSize: 12 }}>{e.reply_class.replace('_', ' ')}</div>}</td>
                          <td>{Math.min(e.step, steps.length)}/{steps.length}</td>
                          <td className="hide-m">{e.status === 'active' ? (e.next_send_at ? fmtDateTime(e.next_send_at) : 'beim nächsten Lauf') : '–'}</td>
                          <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                            {e.status === 'active' && <button className="btn sm" disabled={!!busy || !me.google || !me.ai} title="Nächste Mail sofort senden" onClick={() => confirm(`Mail ${e.step + 1} jetzt an ${fullName(e)} senden?`) && enrAction(e.id, 'send-now', 'Mail gesendet')}>{busy === e.id ? '…' : 'Jetzt senden'}</button>}
                            {e.status === 'active' && <button className="btn sm ghost" onClick={() => enrAction(e.id, 'stop')}>Stopp</button>}
                            {['stopped', 'error'].includes(e.status) && <button className="btn sm ghost" onClick={() => enrAction(e.id, 'resume')}>Fortsetzen</button>}
                            <button className="icon-btn" title="Entfernen" onClick={() => confirm('Kontakt aus Kampagne entfernen?') && enrAction(e.id, 'delete')}>✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {tab === 'mails' && (
            <div className="card">
              {k.messages.length === 0 ? <Empty title="Noch keine Mails gesendet" /> : (
                <div className="timeline">
                  {k.messages.map((m: any) => (
                    <div className="tl-item" key={m.id}>
                      <div className="tl-dot agent">✦</div>
                      <div className="tl-body">
                        <div className="tl-title">{m.subject}</div>
                        <div className="tl-meta">an {fullName(m)} ({m.email}) · Mail {m.step + 1} · {fmtDateTime(m.sent_at)}</div>
                        <div className={`tl-text ${openMsg === m.id ? 'open' : ''}`} onClick={() => setOpenMsg(openMsg === m.id ? null : m.id)}>{m.body}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {tab === 'log' && (
            <div className="card">
              {k.log.length === 0 ? <Empty title="Keine Einträge" /> : k.log.map((l: any) => (
                <div key={l.id} style={{ padding: '6px 0', borderBottom: '1px solid #f0f2f6', fontSize: 13 }}>
                  <span className={`badge ${l.level === 'error' ? 'red' : l.level === 'warn' ? 'amber' : 'grey'}`}>{l.level}</span> <span className="muted">{fmtDateTime(l.created_at)}</span> {l.message}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="stack">
          <div className="card">
            <h2 style={{ marginBottom: 10 }}>Angebot & Briefing</h2>
            <dl className="dl">
              <dt>Angebot</dt><dd className="pre">{k.offer || '–'}</dd>
              <dt>Zielgruppe</dt><dd>{k.audience || '–'}</dd>
              <dt>Tonalität</dt><dd>{k.tone}</dd>
              <dt>Sprache</dt><dd>{k.language === 'auto' ? 'automatisch' : k.language === 'de' ? 'Deutsch' : 'Englisch'}</dd>
              <dt>Recherche</dt><dd>{k.research ? 'Ja, vor Mail 1' : 'Nein'}</dd>
              <dt>Rechtsschutz</dt><dd>{k.require_consent ? 'Aktiv (EU nur mit Einwilligung)' : <span style={{ color: 'var(--red)' }}>Aus</span>}</dd>
            </dl>
          </div>
          <div className="card">
            <h2 style={{ marginBottom: 10 }}>Sequenz</h2>
            {steps.map((s, i) => (
              <div key={i} style={{ padding: '6px 0', borderBottom: i < steps.length - 1 ? '1px solid #f0f2f6' : 0 }}>
                <b>Mail {i + 1}</b> <span className="muted">{i === 0 ? 'sofort' : `+${s.delay_days} Tage`}</span>
                <div style={{ fontSize: 13 }}>{s.instruction}</div>
              </div>
            ))}
          </div>
          <div className="card" style={{ fontSize: 13 }}>
            <h4 style={{ marginBottom: 6 }}>So arbeitet der Agent</h4>
            <ul style={{ margin: 0, paddingLeft: 18, color: '#374151' }}>
              <li>prüft alle 15 Min. Antworten und stoppt die Sequenz bei Antwort</li>
              <li>klassifiziert Antworten und legt eine Aufgabe an; bei Interesse auch einen Deal</li>
              <li>sendet nur im Versandfenster (Einstellungen), verteilt über den Tag</li>
              <li>hängt Signatur und Abmeldelink an; Abmeldungen werden sofort gesperrt</li>
            </ul>
          </div>
          <button className="btn danger" onClick={() => confirmDel('Kampagne') && run('d', async () => { await api.del(`/campaigns/${id}`); go('/campaigns'); })}>Kampagne löschen</button>
        </div>
      </div>
      {edit && <CampaignForm initial={k} onClose={() => setEdit(false)} onSaved={reload} />}
      {add && <AddContacts campaignId={id} onClose={() => setAdd(false)} onDone={reload} />}
      {preview && <Preview campaignId={id} enrollments={k.enrollments} onClose={() => setPreview(false)} />}
    </>
  );
}
