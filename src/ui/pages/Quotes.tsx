import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Badge, Empty, Field, Modal, PageHead, QUOTE_STATUS, SelectCompany, SelectContact, Spinner, confirmDel, fmtDate, fmtMoney, fmtMoney2, go, useAction, useLoad, useToast } from '../components';
import type { Me } from '../main';
import { useSignAssets, SIGN_LABEL } from './PdfSign';

export function QuotesList() {
  const [status, setStatus] = useState('');
  const [list] = useLoad<any[]>(`/quotes${status ? `?status=${status}` : ''}`);
  const [neu, setNeu] = useState(false);
  const create = () => setNeu(true);
  const sum = (s: string) => (list || []).filter((q) => q.status === s).reduce((a, q) => a + q.total, 0);
  return (
    <>
      <PageHead title="Angebote" sub={list ? `${list.length} Angebote` : ''} actions={<><button className="btn" onClick={() => go('/import')}>✦ Aus Excel erstellen</button><button className="btn accent" onClick={create}>+ Angebot erstellen</button></>} />
      {neu && <NewQuoteDialog onClose={() => setNeu(false)} />}
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


// ---------------- Sprache DE/EN

const UNIT_EN: Record<string, string> = { tag: 'Day', tage: 'Days', pt: 'PD', personentag: 'Person-day', personentage: 'Person-days', stunde: 'Hour', stunden: 'Hours', 'std.': 'hrs', std: 'hrs', monat: 'Month', monate: 'Months', woche: 'Week', wochen: 'Weeks', pauschal: 'Lump sum', pauschale: 'Lump sum', 'stück': 'Pc.', stk: 'Pc.', 'stk.': 'Pc.', lizenz: 'License', jahr: 'Year', jahre: 'Years' };
const UNIT_DE: Record<string, string> = { day: 'Tag', days: 'Tage', pd: 'PT', 'person-day': 'Personentag', 'person-days': 'Personentage', hour: 'Stunde', hours: 'Stunden', hrs: 'Std.', month: 'Monat', months: 'Monate', week: 'Woche', weeks: 'Wochen', 'lump sum': 'Pauschal', 'pc.': 'Stk.', license: 'Lizenz', year: 'Jahr', years: 'Jahre' };
export const translateUnit = (u: string, to: 'de' | 'en') => {
  const k = (u || '').trim().toLowerCase();
  return (to === 'en' ? UNIT_EN[k] : UNIT_DE[k]) || u;
};

export function LangSwitch({ value, onChange, disabled, big }: { value: string; onChange: (l: 'de' | 'en') => void; disabled?: boolean; big?: boolean }) {
  return (
    <div className={`seg lang-switch ${big ? 'big' : ''}`} role="group" aria-label="Sprache des Angebots">
      <button type="button" className={value === 'de' ? 'active' : ''} disabled={disabled} onClick={() => value !== 'de' && onChange('de')}>🇩🇪 DE</button>
      <button type="button" className={value === 'en' ? 'active' : ''} disabled={disabled} onClick={() => value !== 'en' && onChange('en')}>🇬🇧 EN</button>
    </div>
  );
}

/** Dialog „Angebot erstellen“: Kunde, Sprache, Titel – dann direkt in den Editor */
export function NewQuoteDialog({ onClose, companyId, contactId }: { onClose: () => void; companyId?: string; contactId?: string }) {
  const [v, setV] = useState({ company_id: companyId || '', contact_id: contactId || '', language: 'de' as 'de' | 'en', title: '', currency: 'EUR' });
  const [companies] = useLoad<any[]>('/companies');
  const [touchedLang, setTouchedLang] = useState(false);
  const { busy, run } = useAction();
  useEffect(() => {
    // Sprache aus dem Land des Kunden vorschlagen (DACH → Deutsch), solange nicht selbst gewählt
    if (touchedLang || !v.company_id) return;
    const c = companies?.find((x) => x.id === v.company_id);
    if (c?.country) setV((o) => ({ ...o, language: ['DE', 'AT', 'CH', 'LI'].includes(String(c.country).toUpperCase()) ? 'de' : 'en' }));
  }, [v.company_id, companies]);
  const create = () => run('n', async () => {
    const q = await api.post('/quotes', { ...v, company_id: v.company_id || null, contact_id: v.contact_id || null, title: v.title || null });
    onClose();
    go(`/quotes/${q.id}`);
  });
  return (
    <Modal title="Angebot erstellen" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary" disabled={!!busy} onClick={create}>{busy ? 'Erstelle…' : 'Angebot erstellen'}</button></>}>
      <div className="form">
        <Field label="Sprache des Angebots" span={2}>
          <div className="lang-cards">
            <button type="button" className={v.language === 'de' ? 'on' : ''} onClick={() => { setTouchedLang(true); setV({ ...v, language: 'de' }); }}><b>🇩🇪 Deutsch</b><span>„Angebot“, deutsche Texte</span></button>
            <button type="button" className={v.language === 'en' ? 'on' : ''} onClick={() => { setTouchedLang(true); setV({ ...v, language: 'en' }); }}><b>🇬🇧 English</b><span>“Proposal”, English texts</span></button>
          </div>
        </Field>
        <Field label="Kunde" span={2}><SelectCompany value={v.company_id} onChange={(id) => setV({ ...v, company_id: id, contact_id: '' })} /></Field>
        <Field label="Ansprechpartner" span={2}><SelectContact value={v.contact_id} companyId={v.company_id} onChange={(id) => setV({ ...v, contact_id: id })} /></Field>
        <Field label="Titel / Betreff"><input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder={v.language === 'en' ? 'Website relaunch' : 'Website-Relaunch'} /></Field>
        <Field label="Währung"><select value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })}><option>EUR</option><option>USD</option><option>PLN</option><option>CHF</option></select></Field>
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>Logo, Firmendaten, Unterschrift und Stempel kommen automatisch ins PDF. Die Sprache lässt sich im Angebot jederzeit mit einem Klick umstellen.</p>
    </Modal>
  );
}

/** Live-Vorschau des Briefkopfs wie im PDF */
function Letterhead({ q, settings, assets }: { q: any; settings: any; assets: any }) {
  const en = q.language === 'en';
  const s = settings || {};
  const seller = [s.company_street, [s.company_zip, s.company_city].filter(Boolean).join(' '), s.company_phone ? `Tel. ${s.company_phone}` : '', s.company_email, s.company_website].filter(Boolean);
  const missing = !s.company_street || !s.company_city || !s.company_vat_id;
  return (
    <div className="letterhead">
      <div className="lh-bar" />
      <div className="lh-top">
        <img src="/brand/logo.png" alt="devunox AI" />
        <div className="lh-seller"><b>{s.company_legal || s.company_name}</b>{seller.map((l: string) => <div key={l}>{l}</div>)}</div>
      </div>
      <div className="lh-mid">
        <div><b>{q.company_name || (en ? 'Customer' : 'Kunde')}</b>{q.contact_name && <div>{q.contact_name}</div>}</div>
        <div className="lh-meta">
          {q.customer_no && <div>{en ? 'Customer no.' : 'Kundennr.'} <b>{q.customer_no}</b></div>}
          <div>{en ? 'Proposal no.' : 'Angebotsnr.'} <b>{q.number}</b></div>
          <div>{en ? 'Date' : 'Datum'} <b>{en ? q.issue_date : fmtDate(q.issue_date)}</b></div>
        </div>
      </div>
      <div className="lh-title">{en ? 'Proposal' : 'Angebot'} {q.number}</div>
      {q.signed !== 0 && assets && (
        <>
          <div className="lh-sign">
            {assets.signature && <img src={assets.signature.url} alt="" />}
            {assets.stamp && <img src={assets.stamp.url} alt="" />}
          </div>
          <div className="lh-cap">{en ? SIGN_LABEL.en : SIGN_LABEL.de}</div>
        </>
      )}
      {missing && <div className="lh-missing" style={{ marginTop: 10 }}>Tipp: Adresse und USt-IdNr. fehlen noch in den Firmendaten.</div>}
    </div>
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
  const [assets] = useSignAssets();
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
      const r = await api.post('/quotes/ai-draft', { request: aiText, currency: q.currency, customer: q.company_name });
      const lang = r.language === 'en' || r.language === 'de' ? r.language : q.language;
      setQ((o: any) => ({ ...o, language: lang, title: r.title || o.title, intro: r.intro || settings?.[`quote_intro_${lang}`] || o.intro, outro: r.outro || settings?.[`quote_outro_${lang}`] || o.outro }));
      if (lang !== q.language) toast(lang === 'en' ? 'Projektbeschreibung ist Englisch – Angebot auf Englisch umgestellt' : 'Projektbeschreibung ist Deutsch – Angebot auf Deutsch umgestellt');
      setItems((r.items || []).map((i: any) => ({ name: i.name, description: i.description || '', qty: i.qty || 1, unit: i.unit || '', unit_price: i.unit_price || 0, discount_pct: 0, tax_rate: defRate, product_id: i.product_id || null })));
      setDirty(true);
    }, 'KI-Entwurf eingefügt – bitte prüfen und speichern');

  /** Sprache mit einem Klick umstellen: Standardtexte und Einheiten werden mit übersetzt */
  const switchLang = (lang: 'de' | 'en') => {
    const from = q.language === 'en' ? 'en' : 'de';
    const isDefault = (k: 'intro' | 'outro') => !q[k] || q[k].trim() === (settings?.[`quote_${k}_${from}`] || '').trim();
    let replace = isDefault('intro') && isDefault('outro');
    if (!replace) replace = window.confirm(lang === 'en' ? 'Einleitung und Schlusstext durch die englischen Standardtexte ersetzen?\n\n„Abbrechen“ behält deine eigenen Texte.' : 'Einleitung und Schlusstext durch die deutschen Standardtexte ersetzen?\n\n„Abbrechen“ behält deine eigenen Texte.');
    setQ((o: any) => ({ ...o, language: lang, ...(replace ? { intro: settings?.[`quote_intro_${lang}`] ?? o.intro, outro: settings?.[`quote_outro_${lang}`] ?? o.outro } : {}) }));
    setItems((l) => l.map((it) => ({ ...it, unit: translateUnit(it.unit, lang) })));
    setDirty(true);
    toast(lang === 'en' ? 'Angebot auf Englisch umgestellt – PDF heißt jetzt „Proposal“' : 'Angebot auf Deutsch umgestellt');
  };

  const setStatus = (status: string) => run('st', async () => { if (dirty) await save(true); setQ(await api.post(`/quotes/${id}/status`, { status })); }, 'Status aktualisiert');
  const toDrive = () => run('dr', async () => { if (dirty) await save(true); const r = await api.post(`/quotes/${id}/drive`); window.open(r.link, '_blank'); }, 'In Google Drive gespeichert');
  const pdf = () => run('pdf', async () => { if (dirty) await save(true); window.open(`/api/quotes/${id}/pdf`, '_blank'); });
  const dup = () => run('dup', async () => { const r = await api.post(`/quotes/${id}/duplicate`); go(`/quotes/${r.id}`); }, 'Kopie erstellt');

  return (
    <>
      <PageHead
        back="#/quotes"
        title={<>{q.number} <Badge map={QUOTE_STATUS} value={q.status} /></>}
        sub={q.company_name ? <>{q.customer_no && <span className="cno" style={{ marginRight: 8 }}>{q.customer_no}</span>}<a href={`#/companies/${q.company_id}`}>{q.company_name}</a></> : 'Kein Kunde gewählt'}
        actions={
          <>
            <LangSwitch value={q.language} onChange={switchLang} disabled={locked} big />
            {dirty && <button className="btn primary" disabled={!!busy} onClick={() => run('s', () => save())}>Speichern</button>}
            <button className="btn" disabled={!!busy} onClick={pdf}>PDF ansehen</button>
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
            <div className="card-head"><h2>Briefkopf & Unterschrift</h2><a className="btn sm ghost" href="#/settings">Firmendaten →</a></div>
            <Letterhead q={q} settings={settings} assets={assets} />
            <label className="check" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={q.signed !== 0} disabled={locked} onChange={(e) => upd('signed', e.target.checked ? 1 : 0)} />
              Digital unterschreiben und stempeln ({q.language === 'en' ? 'EN' : 'DE'})
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button className="btn sm" disabled={!!busy} onClick={pdf}>PDF-Vorschau</button>
              <a className="btn sm ghost" href="#/pdf">Unterschrift & Stempel ändern</a>
            </div>
          </div>
          <TechCard quoteId={id} currency={q.currency} onRecalc={load} />
          <div className="card">
            <h2 style={{ marginBottom: 12 }}>Kunde & Konditionen</h2>
            <div className="form" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <Field label="Firma" span={2}><SelectCompany value={q.company_id} onChange={(v) => upd('company_id', v || null)} /></Field>
              <Field label="Ansprechpartner" span={2}><SelectContact value={q.contact_id} companyId={q.company_id} onChange={(v) => upd('contact_id', v || null)} /></Field>
              <Field label="Datum"><input type="date" value={q.issue_date || ''} onChange={(e) => upd('issue_date', e.target.value)} disabled={locked} /></Field>
              <Field label="Gültig bis"><input type="date" value={q.valid_until || ''} onChange={(e) => upd('valid_until', e.target.value)} disabled={locked} /></Field>
              <Field label="Sprache"><LangSwitch value={q.language} onChange={switchLang} disabled={locked} /></Field>
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
          <div className="card">
            <h2 style={{ marginBottom: 10 }}>Weiter</h2>
            <div style={{ display: 'grid', gap: 8 }}>
              <button className="btn" disabled={!!busy || !q.company_id} onClick={() => run('pr', async () => {
                if (dirty) await save(true);
                const p = await api.post('/projects', { quote_id: id, tasks_from_quote: true });
                go(`/projects/${p.id}`);
              }, 'Projekt mit Aufgaben aus dem Angebot angelegt')}>Projekt + Aufgaben anlegen</button>
              <button className="btn" disabled={!!busy || !q.company_id} onClick={() => run('ar', async () => { if (dirty) await save(true); await api.post(`/quotes/${id}/archive`); }, 'PDF in der Kundenablage unter „Angebote“ gespeichert')}>PDF in Kundenablage speichern</button>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>Beim Versand per Gmail werden die PDFs automatisch in der Ablage des Kunden gespeichert.</p>
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
  const [tech, setTech] = useState(true);
  const { busy, run } = useAction();
  useEffect(() => { api.get(`/quotes/${id}/mail-draft`).then((d) => setM({ ...d, cc: '' })); }, [id]);
  const send = () => run('s', async () => { await api.post(`/quotes/${id}/send`, { ...m, saveToDrive: drive, includeTech: tech }); onSent(); onClose(); }, 'Angebot per Gmail versendet');
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
          {m.hasTech && <label className="check full"><input type="checkbox" checked={tech} onChange={(e) => setTech(e.target.checked)} /> Technische Spezifikation als zweites PDF anhängen</label>}
          <label className="check full"><input type="checkbox" checked={drive} onChange={(e) => setDrive(e.target.checked)} /> PDF zusätzlich in Google Drive ablegen (Ordner „Devunox CRM/Angebote“)</label>
        </div>
      )}
    </Modal>
  );
}

// ---------------- Technisches Angebot

const FIT_LABEL: Record<string, string> = { standard: 'Standard', config: 'Anpassung', custom: 'Neuentwicklung' };

function effort(d: any) {
  const pk = (d.packages || []).map((p: any) => ({ ...p, days: d.requirements.filter((r: any) => r.package === p.name).reduce((a: number, r: any) => a + (Number(r.effort_days) || 0), 0) + (Number(p.extra_days) || 0) }));
  const orphan = d.requirements.filter((r: any) => !(d.packages || []).some((p: any) => p.name === r.package)).reduce((a: number, r: any) => a + (Number(r.effort_days) || 0), 0);
  const dev = pk.reduce((a: number, p: any) => a + p.days, 0) + orphan;
  const pm = Math.round(dev * (Number(d.pm_pct) || 0) / 100 * 2) / 2;
  return { pk, dev, pm, total: dev + pm };
}

function TechCard({ quoteId, currency, onRecalc }: { quoteId: string; currency: string; onRecalc: () => void }) {
  const [tp, reload] = useLoad<any>(`/quotes/${quoteId}/tech`);
  const [edit, setEdit] = useState(false);
  if (!tp) return null;
  const d = tp.data;
  const e = effort(d);
  const count = (f: string) => d.requirements.filter((r: any) => r.fit === f).length;
  return (
    <div className="card ai-box">
      <div className="card-head"><h2>✦ Technische Spezifikation</h2></div>
      <div style={{ fontSize: 13.5 }}>
        <b>{d.requirements.length}</b> Anforderungen · <b>{e.total}</b> PT gesamt ({e.dev} Entwicklung + {e.pm} PM)
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
          <span className="fit standard">{count('standard')} Standard</span>
          <span className="fit config">{count('config')} Anpassung</span>
          <span className="fit custom">{count('custom')} Neuentwicklung</span>
        </div>
        <div className="muted" style={{ fontSize: 12.5 }}>Tagessatz {fmtMoney2(d.day_rate, currency)} · {tp.source_file ? `aus „${tp.source_file}“` : ''}</div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <a className="btn sm" href={`/api/quotes/${quoteId}/tech/pdf`} target="_blank" rel="noreferrer">PDF ansehen</a>
        <button className="btn sm" onClick={() => setEdit(true)}>Bearbeiten</button>
      </div>
      {edit && <TechEditor quoteId={quoteId} tp={tp} onClose={() => setEdit(false)} onSaved={(recalc) => { reload(); if (recalc) onRecalc(); }} />}
    </div>
  );
}

function TechEditor({ quoteId, tp, onClose, onSaved }: { quoteId: string; tp: any; onClose: () => void; onSaved: (recalc: boolean) => void }) {
  const [d, setD] = useState<any>(JSON.parse(JSON.stringify(tp.data)));
  const [tab, setTab] = useState<'req' | 'text' | 'plan'>('req');
  const { busy, run } = useAction();
  const e = effort(d);
  const setReq = (i: number, k: string, v: any) => setD({ ...d, requirements: d.requirements.map((r: any, j: number) => (j === i ? { ...r, [k]: v } : r)) });
  const setList = (k: string, v: string) => setD({ ...d, [k]: v.split('\n').map((x) => x.trim()).filter(Boolean) });
  const save = (recalc: boolean) => run('s', async () => {
    const data = { ...d, requirements: d.requirements.map((r: any) => ({ ...r, effort_days: Number(r.effort_days) || 0 })), packages: d.packages.map((p: any) => ({ ...p, extra_days: Number(p.extra_days) || 0 })), pm_pct: Number(d.pm_pct) || 0, day_rate: Number(d.day_rate) || 0 };
    await api.put(`/quotes/${quoteId}/tech`, { data, recalc });
    onSaved(recalc);
    onClose();
  }, recalc ? 'Gespeichert – Angebotspositionen neu berechnet' : 'Technisches Angebot gespeichert');
  return (
    <Modal wide title="Technische Spezifikation bearbeiten" onClose={onClose} footer={
      <>
        <span className="muted" style={{ marginRight: 'auto', fontSize: 13 }}>{e.dev} PT + {e.pm} PT PM = <b>{e.total} PT</b></span>
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn" disabled={!!busy} onClick={() => save(false)}>Nur speichern</button>
        <button className="btn primary" disabled={!!busy} onClick={() => save(true)}>Speichern & Preise neu berechnen</button>
      </>
    }>
      <div className="tabs">
        <button className={tab === 'req' ? 'active' : ''} onClick={() => setTab('req')}>Anforderungen ({d.requirements.length})</button>
        <button className={tab === 'text' ? 'active' : ''} onClick={() => setTab('text')}>Texte</button>
        <button className={tab === 'plan' ? 'active' : ''} onClick={() => setTab('plan')}>Pakete, Plan & Annahmen</button>
      </div>
      {tab === 'req' && (
        <div className="table-wrap">
          <table className="matrix">
            <thead><tr><th>Nr.</th><th>Anforderung</th><th>Bewertung</th><th>Lösung</th><th>PT</th><th>Paket</th></tr></thead>
            <tbody>
              {d.requirements.map((r: any, i: number) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{r.ref}</td>
                  <td style={{ minWidth: 160, fontSize: 13 }}><b>{r.title}</b>{r.priority && <div className="muted">{r.priority}</div>}</td>
                  <td><select value={r.fit} onChange={(ev) => setReq(i, 'fit', ev.target.value)}>{Object.entries(FIT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                  <td style={{ minWidth: 240 }}><textarea value={r.solution} onChange={(ev) => setReq(i, 'solution', ev.target.value)} /></td>
                  <td style={{ width: 70 }}><input type="number" step="0.5" value={r.effort_days} onChange={(ev) => setReq(i, 'effort_days', ev.target.value)} /></td>
                  <td><select value={r.package} onChange={(ev) => setReq(i, 'package', ev.target.value)}>{d.packages.map((p: any) => <option key={p.name}>{p.name}</option>)}</select></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'text' && (
        <div className="form">
          <Field label="Titel" span={2}><input value={d.title || ''} onChange={(ev) => setD({ ...d, title: ev.target.value })} /></Field>
          <Field label="Ausgangslage" span={2}><textarea rows={4} value={d.summary || ''} onChange={(ev) => setD({ ...d, summary: ev.target.value })} /></Field>
          <Field label="Ziele (eine pro Zeile)" span={2}><textarea rows={3} value={(d.objectives || []).join('\n')} onChange={(ev) => setList('objectives', ev.target.value)} /></Field>
          <Field label="Lösungsansatz" span={2}><textarea rows={5} value={d.solution || ''} onChange={(ev) => setD({ ...d, solution: ev.target.value })} /></Field>
          <Field label="Architektur" span={2}><textarea rows={3} value={d.architecture || ''} onChange={(ev) => setD({ ...d, architecture: ev.target.value })} /></Field>
          <Field label="Technologie (Bereich: Technologie, eine pro Zeile)" span={2}>
            <textarea rows={4} value={(d.tech_stack || []).map((x: any) => `${x.area}: ${x.technology}`).join('\n')} onChange={(ev) => setD({ ...d, tech_stack: ev.target.value.split('\n').filter((l) => l.trim()).map((l) => { const [a, ...rest] = l.split(':'); return { area: a.trim(), technology: rest.join(':').trim() }; }) })} />
          </Field>
        </div>
      )}
      {tab === 'plan' && (
        <div className="stack">
          <div className="form">
            <Field label="Tagessatz"><input type="number" value={d.day_rate} onChange={(ev) => setD({ ...d, day_rate: ev.target.value })} /></Field>
            <Field label="PM & QS Aufschlag %"><input type="number" value={d.pm_pct} onChange={(ev) => setD({ ...d, pm_pct: ev.target.value })} /></Field>
          </div>
          <table style={{ fontSize: 13 }}>
            <thead><tr><th>Arbeitspaket</th><th>Beschreibung</th><th className="num">Zusatz-PT</th><th className="num">Summe PT</th></tr></thead>
            <tbody>
              {d.packages.map((p: any, i: number) => (
                <tr key={i}>
                  <td style={{ minWidth: 150 }}><input value={p.name} onChange={(ev) => { const old = p.name; const name = ev.target.value; setD({ ...d, packages: d.packages.map((x: any, j: number) => (j === i ? { ...x, name } : x)), requirements: d.requirements.map((r: any) => (r.package === old ? { ...r, package: name } : r)) }); }} /></td>
                  <td><input value={p.description || ''} onChange={(ev) => setD({ ...d, packages: d.packages.map((x: any, j: number) => (j === i ? { ...x, description: ev.target.value } : x)) })} /></td>
                  <td style={{ width: 90 }}><input type="number" step="0.5" value={p.extra_days || 0} onChange={(ev) => setD({ ...d, packages: d.packages.map((x: any, j: number) => (j === i ? { ...x, extra_days: ev.target.value } : x)) })} /></td>
                  <td className="num">{e.pk[i]?.days}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="form">
            <Field label="Projektphasen (Name | Wochen | Ergebnisse, eine pro Zeile)" span={2}>
              <textarea rows={4} value={(d.phases || []).map((x: any) => `${x.name} | ${x.weeks} | ${x.deliverables || ''}`).join('\n')} onChange={(ev) => setD({ ...d, phases: ev.target.value.split('\n').filter((l) => l.trim()).map((l) => { const [name, weeks, deliverables] = l.split('|').map((x) => x.trim()); return { name, weeks: Number(weeks) || 0, deliverables }; }) })} />
            </Field>
            <Field label="Annahmen (eine pro Zeile)" span={2}><textarea rows={4} value={(d.assumptions || []).join('\n')} onChange={(ev) => setList('assumptions', ev.target.value)} /></Field>
            <Field label="Nicht im Umfang (eine pro Zeile)" span={2}><textarea rows={3} value={(d.exclusions || []).join('\n')} onChange={(ev) => setList('exclusions', ev.target.value)} /></Field>
            <Field label="Offene Fragen (eine pro Zeile)" span={2}><textarea rows={3} value={(d.open_questions || []).join('\n')} onChange={(ev) => setList('open_questions', ev.target.value)} /></Field>
          </div>
        </div>
      )}
    </Modal>
  );
}
