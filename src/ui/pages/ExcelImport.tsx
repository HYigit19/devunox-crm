import React, { useRef, useState } from 'react';
import readXlsxFile from 'read-excel-file/browser';
import { api } from '../api';
import { Field, PageHead, Spinner, fmtMoney, go, useLoad, useToast } from '../components';
import { parseCsv } from './Contacts';
import type { Me } from '../main';

type Sheet = { name: string; rows: string[][] };
type Customer = {
  company: { name: string; website?: string; country?: string; industry?: string; city?: string };
  contact?: { salutation?: string; first_name?: string; last_name?: string; email?: string; position?: string };
  project_title?: string;
  description?: string;
  language?: 'de' | 'en';
  requirements: { ref: string; title: string; description?: string; priority?: string | null; category?: string }[];
};
type Result = { quote_id: string; number: string; company: string; company_id: string; customer_no?: string; language?: string; total: number; net: number; currency: string; days: number; requirements: number };

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).replace(/\s+/g, ' ').trim();
};

function sheetsToText(sheets: Sheet[]) {
  return sheets
    .map((s) => {
      const lines = s.rows
        .map((r, i) => ({ i, cells: r.map((c) => c.replace(/\t/g, ' ')) }))
        .filter((r) => r.cells.some((c) => c))
        .map((r) => {
          const cells = [...r.cells];
          while (cells.length && !cells[cells.length - 1]) cells.pop();
          return `R${r.i + 1}\t${cells.join('\t')}`;
        });
      return `### Tabellenblatt: ${s.name}\n${lines.join('\n')}`;
    })
    .join('\n\n');
}

export function ExcelImport({ me }: { me: Me }) {
  const [settings] = useLoad<Record<string, string>>('/settings');
  const [file, setFile] = useState<string>('');
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [opts, setOpts] = useState<{ language: string; currency: string; day_rate: string; pm_pct: string; hints: string } | null>(null);
  const [phase, setPhase] = useState<'upload' | 'analyzing' | 'review' | 'generating' | 'done'>('upload');
  const [analysis, setAnalysis] = useState<{ mode: string; customers: Customer[]; notes?: string } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<number | null>(0);
  const [progress, setProgress] = useState<Record<number, { state: 'wait' | 'run' | 'ok' | 'err'; result?: Result; error?: string }>>({});
  const [drag, setDrag] = useState(false);
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);

  if (settings && !opts) setOpts({ language: 'auto', currency: settings.day_rate_currency || 'EUR', day_rate: settings.day_rate || '960', pm_pct: settings.pm_pct || '15', hints: '' });

  const onFile = async (f: File) => {
    try {
      const ext = f.name.split('.').pop()?.toLowerCase();
      let sh: Sheet[];
      if (ext === 'csv' || ext === 'txt') sh = [{ name: f.name, rows: parseCsv((await f.text()).replace(/^﻿/, '')) }];
      else if (ext === 'xlsx' || ext === 'xlsm') {
        const all = await readXlsxFile(f);
        sh = all.map((s: any) => ({ name: s.sheet, rows: (s.data as unknown[][]).map((r) => r.map(cellText)) }));
      } else {
        toast('Bitte als .xlsx oder .csv speichern (altes .xls-Format wird nicht unterstützt).', 'err');
        return;
      }
      sh = sh.filter((s) => s.rows.some((r) => r.some((c) => c)));
      if (!sh.length) return toast('Die Datei ist leer.', 'err');
      setFile(f.name);
      setRawFile(f);
      setSheets(sh);
      setAnalysis(null);
      setPhase('upload');
    } catch (e: any) {
      toast('Datei konnte nicht gelesen werden: ' + e.message, 'err');
    }
  };

  const analyze = async () => {
    if (!sheets) return;
    setPhase('analyzing');
    try {
      const r = await api.post('/rfq/analyze', { text: sheetsToText(sheets), filename: file, hints: opts?.hints });
      if (!r.customers?.length) throw new Error('Die KI hat keine Kunden bzw. Anforderungen erkannt. Prüfe die Datei oder gib unten einen Hinweis.');
      setAnalysis(r);
      setSelected(new Set(r.customers.map((_: any, i: number) => i)));
      setOpen(0);
      setPhase('review');
    } catch (e: any) {
      toast(e.message, 'err');
      setPhase('upload');
    }
  };

  const generate = async () => {
    if (!analysis || !opts) return;
    setPhase('generating');
    const idx = [...selected].sort((a, b) => a - b);
    setProgress(Object.fromEntries(idx.map((i) => [i, { state: 'wait' }])));
    for (const i of idx) {
      setProgress((p) => ({ ...p, [i]: { state: 'run' } }));
      try {
        const result = await api.post<Result>('/rfq/generate', {
          customer: analysis.customers[i],
          options: { language: opts.language, currency: opts.currency, day_rate: Number(opts.day_rate), pm_pct: Number(opts.pm_pct), hints: opts.hints, source_file: file },
        });
        // Original-Excel in der Kundenakte unter „Anfragen“ ablegen
        if (rawFile && (result as any).company_id) {
          const fd = new FormData();
          fd.append('company_id', (result as any).company_id);
          fd.append('folder', '/Anfragen/');
          fd.append('files', rawFile, rawFile.name);
          fd.append('paths', rawFile.name);
          fetch('/api/documents/upload', { method: 'POST', body: fd }).catch(() => {});
        }
        setProgress((p) => ({ ...p, [i]: { state: 'ok', result } }));
      } catch (e: any) {
        setProgress((p) => ({ ...p, [i]: { state: 'err', error: e.message } }));
      }
    }
    setPhase('done');
  };

  const reset = () => {
    setFile('');
    setSheets(null);
    setAnalysis(null);
    setProgress({});
    setPhase('upload');
    if (input.current) input.current.value = '';
  };

  if (!opts) return <Spinner />;
  const setO = (k: keyof typeof opts) => (e: React.ChangeEvent<any>) => setOpts({ ...opts, [k]: e.target.value });
  const preview = sheets?.[0]?.rows.filter((r) => r.some((c) => c)).slice(0, 8) || [];
  const cols = Math.min(8, Math.max(0, ...preview.map((r) => r.length)));
  const totalReqs = analysis ? [...selected].reduce((a, i) => a + analysis.customers[i].requirements.length, 0) : 0;

  return (
    <>
      <PageHead
        title="✦ Angebote aus Excel"
        sub="Die KI liest Kundenanfragen oder Anforderungslisten und erstellt je Kunde ein Angebot und eine technische Spezifikation."
        actions={sheets && <button className="btn" onClick={reset}>Neue Datei</button>}
      />
      {!me.ai && <div className="legal" style={{ marginBottom: 16 }}>Die KI ist noch nicht aktiv: In Cloudflare fehlt das Secret <b>ANTHROPIC_API_KEY</b>.</div>}

      <div className="grid side">
        <div className="stack">
          {/* Schritt 1 */}
          <div className="card">
            <div className="card-head"><h2>1 · Excel-Datei</h2>{file && <span className="badge blue">{file}</span>}</div>
            <div
              className={`drop ${drag ? 'over' : ''}`}
              onClick={() => input.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
            >
              <div style={{ fontSize: 30 }}>⇪</div>
              <b>Excel hier ablegen oder klicken</b>
              <span className="muted">.xlsx oder .csv · ein Kunde mit Anforderungsliste oder eine Liste mehrerer Kunden</span>
              <input ref={input} type="file" accept=".xlsx,.xlsm,.csv" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </div>
            {sheets && (
              <div style={{ marginTop: 14 }}>
                <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
                  {sheets.length} Tabellenblatt{sheets.length > 1 ? 'er' : ''} · {sheets.reduce((a, s) => a + s.rows.filter((r) => r.some((c) => c)).length, 0)} Zeilen · Vorschau „{sheets[0].name}“:
                </div>
                <div className="table-wrap" style={{ border: '1px solid var(--line)', borderRadius: 10, maxHeight: 260, overflow: 'auto' }}>
                  <table style={{ fontSize: 12.5 }}>
                    <tbody>
                      {preview.map((r, i) => (
                        <tr key={i}>
                          {Array.from({ length: cols }).map((_, j) => (
                            <td key={j} style={{ maxWidth: 240, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: i === 0 ? 600 : 400 }}>{r[j]}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Schritt 2 */}
          {phase === 'analyzing' && (
            <div className="card" style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <Spinner /> <div><b>KI liest die Datei …</b><div className="muted" style={{ fontSize: 13 }}>Kunden und Anforderungen werden erkannt. Das dauert meist 20–60 Sekunden.</div></div>
            </div>
          )}
          {analysis && phase !== 'analyzing' && (
            <div className="card">
              <div className="card-head">
                <h2>2 · Erkannt: {analysis.customers.length} {analysis.customers.length === 1 ? 'Kunde' : 'Kunden'}</h2>
                <span className="badge grey">{analysis.mode === 'multi' ? 'Kundenliste' : 'Anforderungsliste'}</span>
              </div>
              {analysis.notes && <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>{analysis.notes}</div>}
              {analysis.customers.map((cu, i) => {
                const pr = progress[i];
                return (
                  <div key={i} className="rfq-cust">
                    <div className="rfq-head" onClick={() => setOpen(open === i ? null : i)}>
                      {phase === 'review' && (
                        <input type="checkbox" checked={selected.has(i)} onClick={(e) => e.stopPropagation()} onChange={() => setSelected((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <b>{cu.company.name}</b>
                        <span className="muted"> · {cu.project_title || 'Projekt'} · {cu.requirements.length} Anforderungen{cu.company.country ? ` · ${cu.company.country}` : ''}</span>
                        {cu.contact?.last_name && <div className="muted" style={{ fontSize: 12.5 }}>Kontakt: {[cu.contact.salutation, cu.contact.first_name, cu.contact.last_name].filter(Boolean).join(' ')}{cu.contact.email ? ` · ${cu.contact.email}` : ''}</div>}
                      </div>
                      {pr?.state === 'wait' && <span className="badge grey">wartet</span>}
                      {pr?.state === 'run' && <span className="badge blue">erstelle …</span>}
                      {pr?.state === 'err' && <span className="badge red" title={pr.error}>Fehler</span>}
                      {pr?.state === 'ok' && <span className="badge green">fertig</span>}
                      <span className="muted">{open === i ? '▴' : '▾'}</span>
                    </div>
                    {pr?.state === 'ok' && pr.result && (
                      <div className="rfq-done">
                        <span>{pr.result.customer_no && <span className="cno" style={{ marginRight: 8 }}>{pr.result.customer_no}</span>}<b>{pr.result.number}</b> · {fmtMoney(pr.result.total, pr.result.currency)} · {pr.result.days} PT · {pr.result.language === 'en' ? 'Englisch' : 'Deutsch'}</span>
                        <span style={{ display: 'flex', gap: 8 }}>
                          <a className="btn sm" href={`/api/quotes/${pr.result.quote_id}/tech/pdf`} target="_blank" rel="noreferrer">Technische Spezifikation</a>
                          <a className="btn sm" href={`/api/quotes/${pr.result.quote_id}/pdf`} target="_blank" rel="noreferrer">Angebot</a>
                          <button className="btn sm primary" onClick={() => go(`/quotes/${pr.result!.quote_id}`)}>Öffnen</button>
                        </span>
                      </div>
                    )}
                    {pr?.state === 'err' && <div style={{ color: 'var(--red)', fontSize: 13, padding: '0 0 10px 28px' }}>{pr.error}</div>}
                    {open === i && (
                      <div style={{ padding: '0 0 12px' }}>
                        {cu.description && <p style={{ margin: '0 0 10px', fontSize: 13.5 }}>{cu.description}</p>}
                        <div className="table-wrap">
                          <table style={{ fontSize: 13 }}>
                            <thead><tr><th>Nr.</th><th>Anforderung</th><th>Priorität</th></tr></thead>
                            <tbody>
                              {cu.requirements.map((r, j) => (
                                <tr key={j}>
                                  <td style={{ whiteSpace: 'nowrap' }}>{r.ref}</td>
                                  <td><b>{r.title}</b>{r.description && r.description !== r.title && <div className="muted">{r.description}</div>}</td>
                                  <td>{r.priority || '–'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Einstellungen */}
        <div className="stack">
          <div className="card">
            <h2 style={{ marginBottom: 12 }}>Kalkulation</h2>
            <div className="form" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <Field label="Tagessatz"><input type="number" value={opts.day_rate} onChange={setO('day_rate')} /></Field>
              <Field label="Währung"><select value={opts.currency} onChange={setO('currency')}><option>EUR</option><option>USD</option><option>CHF</option><option>PLN</option></select></Field>
              <Field label="PM & QS Aufschlag %"><input type="number" value={opts.pm_pct} onChange={setO('pm_pct')} /></Field>
              <Field label="Sprache">
                <select value={opts.language} onChange={setO('language')}>
                  <option value="auto">automatisch (aus der Beschreibung)</option><option value="de">Deutsch</option><option value="en">Englisch</option>
                </select>
              </Field>
              <Field label="Hinweise für die KI (optional)" span={2}>
                <textarea rows={3} value={opts.hints} onChange={setO('hints')} placeholder="z. B. Hosting auf Cloudflare, Login über Microsoft 365, MVP zuerst, Budget ca. 30.000 €" />
              </Field>
            </div>
          </div>
          {phase === 'upload' && (
            <button className="btn ai lg" disabled={!sheets || !me.ai} onClick={analyze}>✦ Mit KI analysieren</button>
          )}
          {phase === 'review' && analysis && (
            <button className="btn ai lg" disabled={!selected.size} onClick={generate}>
              ✦ {selected.size} {selected.size === 1 ? 'Angebot' : 'Angebote'} erstellen ({totalReqs} Anforderungen)
            </button>
          )}
          {phase === 'generating' && (
            <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Spinner /><div style={{ fontSize: 13 }}>Erstelle technische Spezifikation und Angebot je Kunde (ca. 1–2 Minuten pro Kunde). Fenster bitte offen lassen.</div>
            </div>
          )}
          {phase === 'done' && (
            <div className="card" style={{ fontSize: 13.5 }}>
              <b>Fertig.</b> Die Angebote liegen als Entwurf unter „Angebote“. Kunden (mit Kundennummer), Kontakte und Deals sind angelegt, PDFs und die Excel liegen in der Kundenakte. Bitte prüfen und dann per Gmail senden – die technische Spezifikation wird automatisch mit angehängt.
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}><button className="btn sm" onClick={() => go('/quotes')}>Zu den Angeboten</button><button className="btn sm" onClick={reset}>Weitere Datei</button></div>
            </div>
          )}
          <div className="card" style={{ fontSize: 13 }}>
            <h4 style={{ marginBottom: 6 }}>Was entsteht je Kunde</h4>
            <ul style={{ margin: 0, paddingLeft: 18, color: '#374151' }}>
              <li><b>Technische Spezifikation (PDF):</b> Ausgangslage, Lösungsansatz, Technologie, jede Anforderung mit Fit/Gap, Lösung und Aufwand in PT, Projektplan, Annahmen, Abgrenzungen, offene Fragen</li>
              <li><b>Angebot:</b> Arbeitspakete × Tagessatz plus PM & QS – im Editor anpassbar</li>
              <li>Firma, Kontakt und Deal im CRM</li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
