import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Badge, Empty, Field, Modal, PageHead, QUOTE_STATUS, SelectCompany, SelectContact, Spinner, confirmDel, fmtDate, fmtMoney, fmtMoney2, go, useAction, useLoad, useToast } from '../components';
import type { Me } from '../main';

export function QuotesList() {
  const [status, setStatus] = useState('');
  const [list] = useLoad<any[]>(`/quotes${status ? `?status=${status}` : ''}`);
  const { busy, run } = useAction();
  const create = () => run('n', async () => { const q = await api.post('/quotes', {}); go(`/quotes/${q.id}`); });
  const sum = (s: string) => (list || []).filter((q) => q.status === s).reduce((a, q) => a + q.total, 0);
  return (
    <>
      <PageHead title="Angebote" sub={list ? `${list.length} Angebote` : ''} actions={<button className="btn primary" disabled={!!busy} onClick={create}>+ Angebot</button>} />
      {!status && list && list.length > 0 && (
        <div className="grid k4" style={{ marginBottom: 16 }}>
          {(['draft', 'sent', 'accepted', 'rejected'] as const).map((s) => (
            <div className="card kpi" key={s} style={{ cursor: 'pointer' }} onClick={() => setStatus(s)}>
              <div className="label">{QUOTE_STATUS[s][0]}</div>
              <div className="value">{fmtMoney(sum(s))}</div>
              <div className="meta">{list.filter((q) => q.status === s).length} Angebote</div>
            </div>
          ))}
        </div>
      )}
      <div className="toolbar">
        <select style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Alle Status</option>
          {Object.entries(QUOTE_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <div className="card flush">
        {!list ? (
          <div style={{ padding: 20 }}><Spinner /></div>
        ) : list.length === 0 ? (
          <Empty title="Keine Angebote" text="Erstelle dein erstes Angebot – auf Wunsch mit KI-Entwurf." action={<button className="btn primary" onClick={create}>+ Angebot</button>} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nr.</th><th>Kunde</th><th className="hide-m">Titel</th><th className="hide-m">Datum</th><th className="hide-m">Gültig bis</th><th>Status</th><th className="num">Betrag</th></tr></thead>
              <tbody>
                {list.map((q) => (
                  <tr key={q.id} className="click" onClick={() => go(`/quotes/${q.id}`)}>
                    <td><b>{q.number}</b></td>
                    <td>{q.company_name || q.contact_name || '–'}</td>
                    <td className="hide-m">{q.title || '–'}</td>
                    <td className="hide-m">{fmtDate(q.issue_date)}</td>
                    <td className="hide-m">{fmtDate(q.valid_until)}</td>
                    <td><Badge map={QUOTE_STATUS} value={q.status} /></td>
                    <td className="num"><b>{fmtMoney2(q.total, q.currency)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

type Item = { name: string; description: string; qty: number | string; unit: string; unit_price: number | string; discount_pct: number | string; tax_rate: number | string; product_id?: string | null };

function totals(items: Item[], discountPct: number, taxMode: string) {
  const lines = items.map((i) => ({ net: (Number(i.qty) || 0) * (Number(i.unit_price) || 0) * (1 - (Number(i.discount_pct) || 0) / 100), rate: Number(i.tax_rate) || 0 }));
  const subtotal = lines.reduce((a, l) => a + l.net, 0);
  const discount = (subtotal * (Number(discountPct) || 0)) / 100;
  const net = subtotal - discount;
  const f = subtotal ? net / subtotal : 1;
  const by = new Map<number, number>();
  if (taxMode === 'standard') lines.forEach((l) => l.rate > 0 && by.set(l.rate, (by.get(l.rate) || 0) + (l.net * f * l.rate) / 100));
  const tax = [...by.values()].reduce((a, b) => a + b, 0);
  return { subtotal, discount, net, taxes: [...by.entries()], total: net + tax };
}

const TAX_MODES: Record<string, string> = {
  standard: 'Mit MwSt. (Inland)',
  reverse_charge: 'Reverse Charge (EU-Firmenkunde)',
  non_eu: 'Nicht steuerbar (Kunde außerhalb EU)',
  none: 'Ohne MwSt. (eigener Hinweis)',
};

export function QuoteEditor({ id, me }: { id: string; me: Me }) {
  const [q, setQ] = useState<any>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [dirty, setDirty] = useState(false);
  const [products] = useLoad<any[]>('/products');
  const [settings] = useLoad<any>('/settings');
  const [aiText, setAiText] = useState('');
  const [send, setSend] = useState(false);
  const { busy, run } = useAction();
  const toast = useToast();

  const load = () => api.get(`/quotes/${id}`).then((d) => { setQ(d); setItems(d.items.map((i: any) => ({ ...i, description: i.description || '' }))); setDirty(false); });
  useEffect(() => { load().catch((e) => toast(e.message, 'err')); }, [id]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const t = useMemo(() => (q ? totals(items, q.discount_pct, q.tax_mode) : null), [items, q?.discount_pct, q?.tax_mode]);
  if (!q || !t) return <Spinner />;
  const locked = q.status === 'accepted' || q.status === 'rejected';
  const defRate = Number(settings?.default_tax_rate ?? 23);

  const upd = (k: string, val: any) => { setQ((o: any) => ({ ...o, [k]: val })); setDirty(true); };
  const updItem = (i: number, k: keyof Item, val: any) => { setItems((l) => l.map((it, idx) => (idx === i ? { ...it, [k]: val } : it))); setDirty(true); };
  const addItem = (p?: any) => {
    setItems((l) => [...l, p ? { name: p.name, description: p.description || '', qty: 1, unit: p.unit || '', unit_price: p.price, discount_pct: 0, tax_rate: p.tax_rate ?? defRate, product_id: p.id } : { name: '', description: '', qty: 1, unit: 'Tag', unit_price: 0, discount_pct: 0, tax_rate: defRate }]);
    setDirty(true);
  };
  const moveItem = (i: number, dir: -1 | 1) => setItems((l) => { const n = [...l]; const j = i + dir; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j], n[i]]; setDirty(true); return n; });

  const save = async (silent = false) => {
    const body = { ...q, items: items.map((i) => ({ ...i, qty: Number(i.qty) || 0, unit_price: Number(i.unit_price) || 0, discount_pct: Number(i.discount_pct) || 0, tax_rate: Number(i.tax_rate) || 0 })), discount_pct: Number(q.discount_pct) || 0 };
    const r = await api.put(`/quotes/${id}`, body);
    setQ(r);
    setItems(r.items.map((i: any) => ({ ...i, description: i.description || '' })));
    setDirty(false);
    if (!silent) toast('Angebot gespeichert');
    return r;
  };

  const aiDraft = () =>
    run('ai', async () => {
      const r = await api.post('/quotes/ai-draft', { request: aiText, language: q.language, currency: q.currency, customer: q.company_name });
      setQ((o: any) => ({ ...o, title: r.title || o.title, intro: r.intro || o.intro, outro: r.outro || o.outro }));
      setItems((r.items || []).map((i: any) => ({ name: i.name, description: i.description || '', qty: i.qty || 1, unit: i.unit || '', unit_price: i.unit_price || 0, discount_pct: 0, tax_rate: defRate, product_id: i.product_id || null })));
      setDirty(true);
    }, 'KI-Entwurf eingefügt – bitte prüfen und speichern');

  const setStatus = (status: string) => run('st', async () => { if (dirty) await save(true); setQ(await api.post(`/quotes/${id}/status`, { status })); }, 'Status aktualisiert');
  const toDrive = () => run('dr', async () => { if (dirty) await save(true); const r = await api.post(`/quotes/${id}/drive`); window.open(r.link, '_blank'); }, 'In Google Drive gespeichert');
  const pdf = () => run('pdf', async () => { if (dirty) await save(true); window.open(`/api/quotes/${id}/pdf`, '_blank'); });
  const dup = () => run('dup', async () => { const r = await api.post(`/quotes/${id}/duplicate`); go(`/quotes/${r.id}`); }, 'Kopie erstellt');

  return (
    <>
      <PageHead
        back="#/quotes"
        title={<>{q.number} <Badge map={QUOTE_STATUS} value={q.status} /></>}
        sub={q.company_name ? <a href={`#/companies/${q.company_id}`}>{q.company_name}</a> : 'Kein Kunde gewählt'}
        actions={
          <>
            {dirty && <button className="btn primary" disabled={!!busy} onClick={() => run('s', () => save())}>Speichern</button>}
            <button className="btn" disabled={!!busy} onClick={pdf}>PDF</button>
            <button className="btn" disabled={!!busy || !me.google} onClick={toDrive}>{busy === 'dr' ? 'Speichere…' : 'In Drive'}</button>
            <button className="btn primary" disabled={!!busy || !me.google || !items.length} onClick={async () => { if (dirty) await run('s', () => save(true)); setSend(true); }}>✉ Per Gmail senden</button>
          </>
        }
      />
      <div className="grid side">
        <div className="stack">
          {!locked && (
            <div className="ai-box">
              <Field label="✦ Angebot mit KI entwerfen – beschreibe kurz das Projekt">
                <textarea rows={2} value={aiText} onChange={(e) => setAiText(e.target.value)} placeholder="z. B. SAP QM Einführung in S/4HANA für 2 Werke, 3 Monate, 1 Senior-Berater + PM, Pauschalpreis 70.000 €" />
              </Field>
              <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn ai" disabled={!aiText || !!busy || !me.ai} onClick={aiDraft}>{busy === 'ai' ? 'Erstelle Entwurf…' : 'Entwurf erstellen'}</button>
              </div>
            </div>
          )}
          <div className="card">
            <div className="form">
              <Field label="Titel / Betreff" span={2}><input value={q.title || ''} onChange={(e) => upd('title', e.target.value)} disabled={locked} placeholder="SAP QM Migration nach S/4HANA" /></Field>
              <Field label="Einleitung" span={2}><textarea rows={4} value={q.intro || ''} onChange={(e) => upd('intro', e.target.value)} disabled={locked} /></Field>
            </div>
          </div>
          <div className="card">
            <div className="card-head" style={{ flexWrap: 'wrap' }}>
              <h2>Positionen</h2>
              {!locked && (
                <div style={{ display: 'flex', gap: 8 }}>
                  {products && products.length > 0 && (
                    <select style={{ width: 'auto' }} value="" onChange={(e) => { const p = products.find((x) => x.id === e.target.value); if (p) addItem(p); }}>
                      <option value="">+ Aus Leistungskatalog…</option>
                      {products.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name} ({fmtMoney(p.price, p.currency)}/{p.unit})</option>)}
                    </select>
                  )}
                  <button className="btn sm" onClick={() => addItem()}>+ Position</button>
                </div>
              )}
            </div>
            <div className="table-wrap">
              <table className="items">
                <thead>
                  <tr><th>#</th><th>Leistung</th><th className="num">Menge</th><th>Einheit</th><th className="num">Preis</th><th className="num">Rab. %</th>{q.tax_mode === 'standard' && <th className="num">MwSt %</th>}<th className="num">Summe</th><th /></tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i}>
                      <td style={{ paddingTop: 12 }}>{i + 1}</td>
                      <td style={{ minWidth: 220 }}>
                        <input value={it.name} onChange={(e) => updItem(i, 'name', e.target.value)} placeholder="Bezeichnung" disabled={locked} />
                        <textarea value={it.description} onChange={(e) => updItem(i, 'description', e.target.value)} placeholder="Beschreibung (optional)" disabled={locked} />
                      </td>
                      <td className="w-qty" data-l="Menge"><input type="number" step="0.5" value={it.qty} onChange={(e) => updItem(i, 'qty', e.target.value)} disabled={locked} /></td>
                      <td className="w-unit" data-l="Einheit"><input value={it.unit || ''} onChange={(e) => updItem(i, 'unit', e.target.value)} disabled={locked} /></td>
                      <td className="w-price" data-l="Preis"><input type="number" step="0.01" value={it.unit_price} onChange={(e) => updItem(i, 'unit_price', e.target.value)} disabled={locked} /></td>
                      <td className="w-pct" data-l="Rabatt %"><input type="number" value={it.discount_pct} onChange={(e) => updItem(i, 'discount_pct', e.target.value)} disabled={locked} /></td>
                      {q.tax_mode === 'standard' && <td className="w-pct" data-l="MwSt %"><input type="number" value={it.tax_rate} onChange={(e) => updItem(i, 'tax_rate', e.target.value)} disabled={locked} /></td>}
                      <td className="num item-sum" data-l="Summe" style={{ paddingTop: 12, whiteSpace: 'nowrap' }}>{fmtMoney2((Number(it.qty) || 0) * (Number(it.unit_price) || 0) * (1 - (Number(it.discount_pct) || 0) / 100), q.currency)}</td>
                      <td className="item-act" style={{ whiteSpace: 'nowrap' }}>
                        {!locked && (
                          <>
                            <button className="icon-btn" title="Nach oben" onClick={() => moveItem(i, -1)}>↑</button>
                            <button className="icon-btn" title="Entfernen" onClick={() => { setItems((l) => l.filter((_, idx) => idx !== i)); setDirty(true); }}>✕</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {items.length === 0 && <div className="muted" style={{ padding: '12px 0' }}>Noch keine Positionen. Füge eine Position hinzu oder nutze den KI-Entwurf.</div>}
            <div className="totals" style={{ marginTop: 16 }}>
              {t.discount > 0 && <div><span>Zwischensumme</span><span>{fmtMoney2(t.subtotal, q.currency)}</span></div>}
              {t.discount > 0 && <div><span>Rabatt {q.discount_pct} %</span><span>−{fmtMoney2(t.discount, q.currency)}</span></div>}
              <div><span>Netto</span><span>{fmtMoney2(t.net, q.currency)}</span></div>
              {t.taxes.map(([r, a]) => <div key={r}><span>MwSt. {r} %</span><span>{fmtMoney2(a, q.currency)}</span></div>)}
              {q.tax_mode !== 'standard' && <div className="muted"><span>{TAX_MODES[q.tax_mode]}</span><span>0,00</span></div>}
              <div className="grand"><span>Gesamt</span><span>{fmtMoney2(t.total, q.currency)}</span></div>
            </div>
          </div>
          <div className="card">
            <Field label="Schlusstext"><textarea rows={4} value={q.outro || ''} onChange={(e) => upd('outro', e.target.value)} disabled={locked} /></Field>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <h2 style={{ marginBottom: 12 }}>Kunde & Konditionen</h2>
            <div className="form" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <Field label="Firma" span={2}><SelectCompany value={q.company_id} onChange={(v) => upd('company_id', v || null)} /></Field>
              <Field label="Ansprechpartner" span={2}><SelectContact value={q.contact_id} companyId={q.company_id} onChange={(v) => upd('contact_id', v || null)} /></Field>
              <Field label="Datum"><input type="date" value={q.issue_date || ''} onChange={(e) => upd('issue_date', e.target.value)} disabled={locked} /></Field>
              <Field label="Gültig bis"><input type="date" value={q.valid_until || ''} onChange={(e) => upd('valid_until', e.target.value)} disabled={locked} /></Field>
              <Field label="Sprache">
                <select value={q.language} disabled={locked} onChange={(e) => {
                  const lang = e.target.value;
                  setQ((o: any) => ({ ...o, language: lang, intro: settings?.[`quote_intro_${lang}`] ?? o.intro, outro: settings?.[`quote_outro_${lang}`] ?? o.outro }));
                  setDirty(true);
                }}>
                  <option value="de">Deutsch</option><option value="en">Englisch</option>
                </select>
              </Field>
              <Field label="Währung"><select value={q.currency} onChange={(e) => upd('currency', e.target.value)} disabled={locked}><option>EUR</option><option>USD</option><option>PLN</option><option>CHF</option></select></Field>
              <Field label="Steuer" span={2}>
                <select value={q.tax_mode} onChange={(e) => upd('tax_mode', e.target.value)} disabled={locked}>
                  {Object.entries(TAX_MODES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </Field>
              <Field label="Gesamtrabatt %"><input type="number" value={q.discount_pct || 0} onChange={(e) => upd('discount_pct', e.target.value)} disabled={locked} /></Field>
            </div>
          </div>
          <div className="card">
            <h2 style={{ marginBottom: 12 }}>Status</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {q.status !== 'accepted' && <button className="btn sm" style={{ color: 'var(--green)' }} onClick={() => setStatus('accepted')}>✓ Angenommen</button>}
              {q.status !== 'rejected' && <button className="btn sm" style={{ color: 'var(--red)' }} onClick={() => setStatus('rejected')}>✕ Abgelehnt</button>}
              {q.status !== 'sent' && q.status !== 'draft' && <button className="btn sm" onClick={() => setStatus('sent')}>Wieder öffnen</button>}
              {q.status === 'draft' && <button className="btn sm" onClick={() => setStatus('sent')}>Als versendet markieren</button>}
            </div>
            <dl className="dl" style={{ marginTop: 14 }}>
              <dt>Versendet</dt><dd>{q.sent_at ? fmtDate(q.sent_at) : '–'}</dd>
              <dt>Google Drive</dt><dd>{q.drive_file_id ? <a href={`https://drive.google.com/file/d/${q.drive_file_id}/view`} target="_blank" rel="noreferrer">PDF öffnen</a> : '–'}</dd>
            </dl>
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>„Angenommen“ setzt einen verknüpften Deal automatisch auf „Gewonnen“.</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={dup}>Duplizieren</button>
            <button className="btn danger" onClick={() => confirmDel('Angebot') && run('d', async () => { await api.del(`/quotes/${id}`); go('/quotes'); })}>Löschen</button>
          </div>
        </div>
      </div>
      {send && <SendQuote id={id} onClose={() => setSend(false)} onSent={load} />}
    </>
  );
}

function SendQuote({ id, onClose, onSent }: { id: string; onClose: () => void; onSent: () => void }) {
  const [m, setM] = useState<any>(null);
  const [drive, setDrive] = useState(true);
  const { busy, run } = useAction();
  useEffect(() => { api.get(`/quotes/${id}/mail-draft`).then((d) => setM({ ...d, cc: '' })); }, [id]);
  const send = () => run('s', async () => { await api.post(`/quotes/${id}/send`, { ...m, saveToDrive: drive }); onSent(); onClose(); }, 'Angebot per Gmail versendet');
  return (
    <Modal
      wide
      title="Angebot per Gmail senden"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn primary" disabled={!m?.to || !!busy} onClick={send}>{busy ? 'Sende…' : 'Senden'}</button>
        </>
      }
    >
      {!m ? <Spinner /> : (
        <div className="form">
          <Field label="An"><input value={m.to} onChange={(e) => setM({ ...m, to: e.target.value })} /></Field>
          <Field label="CC"><input value={m.cc} onChange={(e) => setM({ ...m, cc: e.target.value })} /></Field>
          <Field label="Betreff" span={2}><input value={m.subject} onChange={(e) => setM({ ...m, subject: e.target.value })} /></Field>
          <Field label="Nachricht" span={2}><textarea rows={12} value={m.body} onChange={(e) => setM({ ...m, body: e.target.value })} /></Field>
          <div className="full muted" style={{ fontSize: 13 }}>📎 Das Angebot wird als PDF angehängt.</div>
          <label className="check full"><input type="checkbox" checked={drive} onChange={(e) => setDrive(e.target.checked)} /> PDF zusätzlich in Google Drive ablegen (Ordner „Devunox CRM/Angebote“)</label>
        </div>
      )}
    </Modal>
  );
}
