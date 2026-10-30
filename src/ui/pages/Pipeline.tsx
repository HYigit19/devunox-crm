import React, { useState } from 'react';
import { api } from '../api';
import { Field, Modal, PageHead, STAGES, SelectCompany, SelectContact, Spinner, confirmDel, fmtDate, fmtMoney, useAction, useForm, useLoad, go } from '../components';

export function DealForm({ initial, onClose, onSaved }: { initial?: any; onClose: () => void; onSaved: (d: any) => void }) {
  const { v, set, setV } = useForm({
    title: '', company_id: '', contact_id: '', stage: 'lead', value: '', currency: 'EUR', probability: 10, expected_close: '', source: '', notes: '',
    ...(initial || {}),
  });
  const { busy, run } = useAction();
  const save = () =>
    run('s', async () => {
      const body = { ...v, value: Number(v.value) || 0, probability: Number(v.probability) || 0 };
      const r = initial?.id ? await api.put(`/deals/${initial.id}`, body) : await api.post('/deals', body);
      onSaved(r);
      onClose();
    }, 'Gespeichert');
  const createQuote = () =>
    run('q', async () => {
      const q = await api.post('/quotes', { company_id: v.company_id || null, contact_id: v.contact_id || null, deal_id: initial.id, title: v.title, currency: v.currency });
      go(`/quotes/${q.id}`);
    });
  return (
    <Modal
      wide
      title={initial?.id ? 'Deal bearbeiten' : 'Neuer Deal'}
      onClose={onClose}
      footer={
        <>
          {initial?.id && (
            <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => confirmDel('Deal') && run('d', async () => { await api.del(`/deals/${initial.id}`); onSaved(null); onClose(); })}>
              Löschen
            </button>
          )}
          {initial?.id && <button className="btn" disabled={!!busy} onClick={createQuote}>Angebot erstellen</button>}
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn primary" disabled={!!busy || !v.title} onClick={save}>Speichern</button>
        </>
      }
    >
      <div className="form c3">
        <Field label="Titel *" span={3}><input value={v.title} onChange={set('title')} autoFocus placeholder="z. B. SAP QM Rollout S/4HANA" /></Field>
        <Field label="Firma"><SelectCompany value={v.company_id} onChange={(id) => setV((o) => ({ ...o, company_id: id }))} /></Field>
        <Field label="Ansprechpartner" span={2}><SelectContact value={v.contact_id} companyId={v.company_id} onChange={(id) => setV((o) => ({ ...o, contact_id: id }))} /></Field>
        <Field label="Phase">
          <select value={v.stage} onChange={(e) => { const st = STAGES.find((s) => s.id === e.target.value)!; setV((o) => ({ ...o, stage: st.id, probability: st.prob })); }}>
            {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="Wert"><input type="number" value={v.value ?? ''} onChange={set('value')} /></Field>
        <Field label="Währung"><select value={v.currency} onChange={set('currency')}><option>EUR</option><option>USD</option><option>PLN</option><option>CHF</option></select></Field>
        <Field label="Wahrscheinlichkeit %"><input type="number" min={0} max={100} value={v.probability} onChange={set('probability')} /></Field>
        <Field label="Abschluss erwartet"><input type="date" value={v.expected_close || ''} onChange={set('expected_close')} /></Field>
        <Field label="Quelle"><input value={v.source || ''} onChange={set('source')} placeholder="LinkedIn, Empfehlung, KI-Agent…" /></Field>
        <Field label="Notizen" span={3}><textarea value={v.notes || ''} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}

export function Pipeline() {
  const [deals, reload] = useLoad<any[]>('/deals');
  const [edit, setEdit] = useState<any>(null);
  const [over, setOver] = useState<string | null>(null);
  const { run } = useAction();
  if (!deals) return <Spinner />;

  const move = (id: string, stage: string) =>
    run('m', async () => {
      const st = STAGES.find((s) => s.id === stage)!;
      await api.put(`/deals/${id}`, { stage, probability: st.prob });
      reload();
    });
  const open = deals.filter((d) => !['won', 'lost'].includes(d.stage));
  const weighted = open.reduce((a, d) => a + (d.value || 0) * (d.probability || 0) / 100, 0);

  return (
    <>
      <PageHead
        title="Pipeline"
        sub={`${open.length} offene Deals · ${fmtMoney(open.reduce((a, d) => a + (d.value || 0), 0))} gesamt · ${fmtMoney(weighted)} gewichtet`}
        actions={<button className="btn primary" onClick={() => setEdit({})}>+ Deal</button>}
      />
      <div className="board">
        {STAGES.map((s) => {
          const list = deals.filter((d) => d.stage === s.id);
          return (
            <div
              key={s.id}
              className={`col ${over === s.id ? 'over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(s.id); }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData('text/plain'); if (id) move(id, s.id); }}
            >
              <div className="col-head">
                <b>{s.label} · {list.length}</b>
                <span>{fmtMoney(list.reduce((a, d) => a + (d.value || 0), 0))}</span>
              </div>
              {list.map((d) => (
                <div key={d.id} className="deal" draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', d.id)} onClick={() => setEdit(d)}>
                  <div className="deal-title">{d.title}</div>
                  <div className="muted" style={{ fontSize: 12.5 }}>{d.company_name || d.contact_name || '–'}</div>
                  <div className="deal-meta">
                    <span>{fmtMoney(d.value, d.currency)}</span>
                    <span>{d.expected_close ? fmtDate(d.expected_close) : `${d.probability} %`}</span>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <p className="muted" style={{ fontSize: 12.5 }}>Tipp: Deals per Drag & Drop zwischen Phasen verschieben. Am Handy: Deal antippen und Phase wählen.</p>
      {edit && <DealForm initial={edit.id ? edit : undefined} onClose={() => setEdit(null)} onSaved={reload} />}
    </>
  );
}
