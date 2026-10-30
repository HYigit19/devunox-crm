import React, { useState } from 'react';
import { api } from '../api';
import { Empty, Field, Modal, PageHead, Spinner, confirmDel, fmtMoney2, useAction, useForm, useLoad } from '../components';

function ProductForm({ initial, onClose, onSaved }: { initial?: any; onClose: () => void; onSaved: () => void }) {
  const { v, set } = useForm({ name: '', description: '', unit: 'Tag', price: '', currency: 'EUR', tax_rate: '', active: 1, ...(initial || {}) });
  const { busy, run } = useAction();
  const save = () => run('s', async () => {
    const body = { ...v, price: Number(v.price) || 0, tax_rate: v.tax_rate === '' || v.tax_rate === null ? null : Number(v.tax_rate) };
    initial?.id ? await api.put(`/products/${initial.id}`, body) : await api.post('/products', body);
    onSaved();
    onClose();
  }, 'Gespeichert');
  return (
    <Modal title={initial?.id ? 'Leistung bearbeiten' : 'Neue Leistung'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary" disabled={!v.name || !!busy} onClick={save}>Speichern</button></>}>
      <div className="form">
        <Field label="Bezeichnung *" span={2}><input value={v.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Beschreibung (erscheint im Angebot)" span={2}><textarea value={v.description || ''} onChange={set('description')} /></Field>
        <Field label="Preis (netto)"><input type="number" step="0.01" value={v.price} onChange={set('price')} /></Field>
        <Field label="Einheit"><input value={v.unit || ''} onChange={set('unit')} placeholder="Tag, Stunde, Pauschal, Monat" /></Field>
        <Field label="Währung"><select value={v.currency} onChange={set('currency')}><option>EUR</option><option>USD</option><option>PLN</option><option>CHF</option></select></Field>
        <Field label="MwSt. %" hint="leer = Standard aus Einstellungen"><input type="number" value={v.tax_rate ?? ''} onChange={set('tax_rate')} /></Field>
        <label className="check full"><input type="checkbox" checked={!!v.active} onChange={set('active')} /> Aktiv (im Angebot auswählbar)</label>
      </div>
    </Modal>
  );
}

const STARTER = [
  { name: 'SAP QM Senior Consultant', description: 'Beratung und Umsetzung SAP QM (Prüfplanung, Prüfabwicklung, Qualitätsmeldungen, Zeugnisse)', unit: 'Tag', price: 1100 },
  { name: 'SAP QM Nearshore Consultant', description: 'Erfahrener SAP QM Berater (Osteuropa), remote', unit: 'Tag', price: 650 },
  { name: 'Projektmanagement (DE)', description: 'Deutschsprachige Projektleitung, Steuerung Nearshore-Team, Statusberichte', unit: 'Tag', price: 950 },
  { name: 'SAP QM Projektpaket Pauschal', description: 'SAP QM Implementierung bzw. Migration nach S/4HANA zum Festpreis inkl. Nearshore-Team und deutschem Projektmanager', unit: 'Pauschal', price: 70000 },
  { name: 'SAP QM Support (monatlich)', description: 'Application Management Support SAP QM, Reaktionszeit nach Vereinbarung', unit: 'Monat', price: 2500 },
];

export function Products() {
  const [list, reload] = useLoad<any[]>('/products');
  const [edit, setEdit] = useState<any>(null);
  const { busy, run } = useAction();
  const starter = () => run('st', async () => { for (const p of STARTER) await api.post('/products', { ...p, currency: 'EUR', active: 1 }); reload(); }, 'Beispiel-Leistungen angelegt – Preise bitte anpassen');
  return (
    <>
      <PageHead title="Leistungen" sub="Dein Katalog für schnelle Angebote" actions={<button className="btn primary" onClick={() => setEdit({})}>+ Leistung</button>} />
      <div className="card flush">
        {!list ? <div style={{ padding: 20 }}><Spinner /></div> : list.length === 0 ? (
          <Empty title="Noch keine Leistungen" text="Lege deine Standardleistungen an, z. B. Beratertag, Pauschalpaket, Support." action={<button className="btn" disabled={!!busy} onClick={starter}>SAP QM Beispiel-Katalog anlegen</button>} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Leistung</th><th className="hide-m">Beschreibung</th><th>Einheit</th><th className="num">Preis</th><th /></tr></thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} className="click" onClick={() => setEdit(p)} style={{ opacity: p.active ? 1 : 0.5 }}>
                    <td><b>{p.name}</b></td>
                    <td className="hide-m muted" style={{ maxWidth: 420 }}>{p.description}</td>
                    <td>{p.unit}</td>
                    <td className="num">{fmtMoney2(p.price, p.currency)}</td>
                    <td onClick={(e) => e.stopPropagation()}><button className="icon-btn" onClick={() => confirmDel('Leistung') && run('d', async () => { await api.del(`/products/${p.id}`); reload(); })}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {edit && <ProductForm initial={edit.id ? edit : undefined} onClose={() => setEdit(null)} onSaved={reload} />}
    </>
  );
}
