import React, { useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { Empty, Field, Modal, PageHead, Spinner, fmtDate, useAction, useLoad, useToast } from '../components';

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1).replace('.', ',')} MB`);

function kind(name: string, mime?: string) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf' || mime === 'application/pdf') return ['pdf', 'PDF'];
  if (/^(png|jpe?g|gif|webp|svg|heic|avif)$/.test(ext) || mime?.startsWith('image/')) return ['img', ext.toUpperCase().slice(0, 4)];
  if (/^(docx?|odt|rtf|txt|md|pptx?|key)$/.test(ext)) return ['doc', ext.toUpperCase().slice(0, 4)];
  if (/^(xlsx?|xlsm|csv|ods|numbers)$/.test(ext)) return ['xls', ext.toUpperCase().slice(0, 4)];
  return ['other', (ext || 'DAT').toUpperCase().slice(0, 4)];
}

type Entry = { file: File; path: string };

/** Ordner-Drop: Dateien rekursiv aus dem Drag-and-Drop einsammeln */
async function collectDropped(dt: DataTransfer): Promise<Entry[]> {
  const out: Entry[] = [];
  const items = [...dt.items].map((i) => (i as any).webkitGetAsEntry?.()).filter(Boolean);
  if (!items.length) return [...dt.files].map((f) => ({ file: f, path: f.name }));
  const walk = async (entry: any, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file: File = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ file, path: prefix + file.name });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch: any[] = [];
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
      } while (batch.length);
    }
  };
  for (const e of items) await walk(e, '');
  return out;
}

export function DocBrowser({ companyId, projectId, compact }: { companyId?: string; projectId?: string; compact?: boolean }) {
  const scope = new URLSearchParams(Object.entries({ company_id: companyId || '', project_id: projectId || '' }).filter(([, v]) => v)).toString();
  const [data, reload] = useLoad<{ files: any[]; folders: string[] }>(`/documents?${scope}`);
  const [folder, setFolder] = useState('/');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [moveDlg, setMoveDlg] = useState<string[] | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const { run } = useAction();

  const subfolders = useMemo(() => {
    if (!data) return [];
    return data.folders.filter((f) => f !== folder && f.startsWith(folder) && f.slice(folder.length).split('/').filter(Boolean).length === 1);
  }, [data, folder]);
  const files = useMemo(() => {
    if (!data) return [];
    if (q) return data.files.filter((f) => (f.name + ' ' + (f.tags || '')).toLowerCase().includes(q.toLowerCase()));
    return data.files.filter((f) => f.folder === folder);
  }, [data, folder, q]);
  const countIn = (path: string) => data?.files.filter((f) => f.folder.startsWith(path)).length || 0;

  const upload = async (entries: Entry[], target = folder) => {
    if (!entries.length) return;
    const total = entries.reduce((a, e) => a + e.file.size, 0);
    // in Paketen hochladen (max. ~40 MB je Anfrage)
    let batch: Entry[] = [], size = 0, done = 0;
    const flush = async () => {
      if (!batch.length) return;
      const fd = new FormData();
      if (companyId) fd.append('company_id', companyId);
      if (projectId) fd.append('project_id', projectId);
      fd.append('folder', target);
      batch.forEach((e) => { fd.append('files', e.file, e.file.name); fd.append('paths', e.path); });
      const res = await fetch('/api/documents/upload', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any).error || `Upload fehlgeschlagen (${res.status})`);
      done += batch.length;
      setProgress(`${done} von ${entries.length} Dateien hochgeladen …`);
      batch = []; size = 0;
    };
    setProgress(`Lade ${entries.length} Datei(en) hoch (${fmtSize(total)}) …`);
    try {
      for (const e of entries) {
        if (size + e.file.size > 40 * 1024 * 1024) await flush();
        batch.push(e); size += e.file.size;
      }
      await flush();
      toast(`${entries.length} Datei(en) hochgeladen`);
    } catch (e: any) {
      toast(e.message, 'err');
    } finally {
      setProgress(null);
      reload();
    }
  };

  const newFolder = () => {
    const name = prompt('Name des neuen Ordners');
    if (!name?.trim()) return;
    run('f', async () => { await api.post('/documents/folders', { company_id: companyId, project_id: projectId, path: folder + name.trim() }); reload(); });
  };
  const renameFolder = (path: string) => {
    const old = path.split('/').filter(Boolean).pop()!;
    const name = prompt('Neuer Ordnername', old);
    if (!name?.trim() || name === old) return;
    const to = path.slice(0, path.length - old.length - 1) + name.trim() + '/';
    run('rf', async () => { await api.post('/documents/folders/rename', { company_id: companyId, project_id: projectId, from: path, to }); reload(); });
  };
  const deleteFolder = (path: string) => {
    const n = countIn(path);
    if (!confirm(`Ordner „${path}“${n ? ` mit ${n} Datei(en)` : ''} löschen?`)) return;
    run('df', async () => { await api.post('/documents/folders/delete', { company_id: companyId, project_id: projectId, path }); reload(); }, 'Ordner gelöscht');
  };
  const renameFile = (f: any) => {
    const name = prompt('Neuer Dateiname', f.name);
    if (!name?.trim() || name === f.name) return;
    run('r', async () => { await api.put(`/documents/${f.id}`, { name }); reload(); });
  };
  const tagFile = (f: any) => {
    const tags = prompt('Tags (kommagetrennt)', f.tags || '');
    if (tags === null) return;
    run('t', async () => { await api.put(`/documents/${f.id}`, { tags }); reload(); });
  };
  const bulk = (action: 'delete' | 'move', ids: string[], target?: string) =>
    run('b', async () => {
      if (action === 'delete' && !confirm(`${ids.length} Datei(en) endgültig löschen?`)) return;
      await api.post('/documents/bulk', { ids, action, folder: target });
      setSel(new Set());
      reload();
    }, action === 'delete' ? 'Gelöscht' : 'Verschoben');

  const crumbs = ['/', ...folder.split('/').filter(Boolean).map((_, i, a) => `/${a.slice(0, i + 1).join('/')}/`)];

  if (!data) return <Spinner />;
  return (
    <div>
      <div className="docs-bar">
        <div className="crumbs">
          {crumbs.map((c, i) => (
            <React.Fragment key={c}>
              {i > 0 && <span className="sep">/</span>}
              <button className={c === folder ? 'cur' : ''} onClick={() => { setFolder(c); setQ(''); setSel(new Set()); }}>{i === 0 ? 'Ablage' : c.split('/').filter(Boolean).pop()}</button>
            </React.Fragment>
          ))}
        </div>
        <input style={{ width: compact ? 160 : 220 }} placeholder="Suchen…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn sm" onClick={newFolder}>+ Ordner</button>
        <button className="btn sm" onClick={() => dirInput.current?.click()}>Ordner hochladen</button>
        <button className="btn sm primary" onClick={() => fileInput.current?.click()}>Hochladen</button>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => { const fl = [...(e.target.files || [])]; e.target.value = ''; upload(fl.map((f) => ({ file: f, path: f.name }))); }} />
        <input ref={dirInput} type="file" multiple hidden {...({ webkitdirectory: '' } as any)} onChange={(e) => { const fl = [...(e.target.files || [])]; e.target.value = ''; upload(fl.map((f) => ({ file: f, path: (f as any).webkitRelativePath || f.name }))); }} />
      </div>
      {sel.size > 0 && (
        <div className="docs-bar" style={{ background: 'var(--orange-soft)', padding: '8px 12px', borderRadius: 12 }}>
          <b style={{ flex: 1 }}>{sel.size} ausgewählt</b>
          <button className="btn sm" onClick={() => setMoveDlg([...sel])}>Verschieben</button>
          <button className="btn sm danger" onClick={() => bulk('delete', [...sel])}>Löschen</button>
          <button className="btn sm ghost" onClick={() => setSel(new Set())}>Abbrechen</button>
        </div>
      )}
      {progress && <div className="upload-progress" style={{ marginBottom: 10 }}><Spinner /> {progress}</div>}
      <div
        className={`docs ${over ? 'over' : ''}`}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }}
        onDrop={async (e) => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); setOver(false); upload(await collectDropped(e.dataTransfer)); }}
      >
        {subfolders.length === 0 && files.length === 0 ? (
          <div style={{ border: '2px dashed var(--line-2)', borderRadius: 14 }}>
            <Empty title={q ? 'Nichts gefunden' : 'Dieser Ordner ist leer'} text={q ? undefined : 'Dateien oder ganze Ordner hierher ziehen – oder „Hochladen“ klicken.'} />
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 34 }}>
                    <input type="checkbox" checked={files.length > 0 && files.every((f) => sel.has(f.id))} onChange={(e) => setSel(e.target.checked ? new Set(files.map((f) => f.id)) : new Set())} />
                  </th>
                  <th>Name</th>
                  {q && <th className="hide-m">Ordner</th>}
                  <th className="hide-m">Tags</th>
                  <th className="num hide-m">Größe</th>
                  <th className="hide-m">Geändert</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {!q && subfolders.map((p) => (
                  <tr
                    key={p}
                    className="click"
                    style={{ background: dropTarget === p ? 'var(--orange-soft)' : undefined }}
                    onClick={() => { setFolder(p); setSel(new Set()); }}
                    onDragOver={(e) => { if (e.dataTransfer.types.includes('text/doc-ids')) { e.preventDefault(); setDropTarget(p); } }}
                    onDragLeave={() => setDropTarget(null)}
                    onDrop={(e) => { const ids = e.dataTransfer.getData('text/doc-ids'); if (ids) { e.preventDefault(); e.stopPropagation(); setDropTarget(null); bulk('move', ids.split(','), p); } }}
                  >
                    <td />
                    <td><div className="fname"><span className="ficon folder">▰</span><b>{p.split('/').filter(Boolean).pop()}</b></div></td>
                    <td className="hide-m" />
                    <td className="num hide-m muted">{countIn(p)} {countIn(p) === 1 ? 'Datei' : 'Dateien'}</td>
                    <td className="hide-m" />
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="row-actions">
                        <button className="icon-btn" title="Umbenennen" onClick={() => renameFolder(p)}>✎</button>
                        <button className="icon-btn" title="Löschen" onClick={() => deleteFolder(p)}>🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {files.map((f) => {
                  const [k, label] = kind(f.name, f.mime);
                  return (
                    <tr
                      key={f.id}
                      className="click"
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/doc-ids', (sel.has(f.id) ? [...sel] : [f.id]).join(','))}
                      onClick={() => window.open(`/api/documents/${f.id}/file`, '_blank')}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={sel.has(f.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n; })} />
                      </td>
                      <td>
                        <div className="fname">
                          <span className={`ficon ${k}`}>{label}</span>
                          <div style={{ minWidth: 0 }}>
                            <b style={{ display: 'block' }}>{f.name}</b>
                            {(f.source === 'quote' || f.source === 'tech') && <span className="muted" style={{ fontSize: 12 }}>automatisch abgelegt</span>}
                            {!projectId && f.project_name && <span className="muted" style={{ fontSize: 12 }}> · Projekt {f.project_name}</span>}
                          </div>
                        </div>
                      </td>
                      {q && <td className="hide-m muted">{f.folder}</td>}
                      <td className="hide-m">{(f.tags || '').split(',').filter(Boolean).map((t: string) => <span key={t} className="tag">{t.trim()}</span>)}</td>
                      <td className="num hide-m">{fmtSize(f.size)}</td>
                      <td className="hide-m">{fmtDate(f.updated_at || f.created_at)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions">
                          <a className="icon-btn" title="Herunterladen" href={`/api/documents/${f.id}/file?download=1`}>⇩</a>
                          <button className="icon-btn" title="Umbenennen" onClick={() => renameFile(f)}>✎</button>
                          <button className="icon-btn" title="Tags" onClick={() => tagFile(f)}>#</button>
                          <button className="icon-btn" title="Verschieben" onClick={() => setMoveDlg([f.id])}>↦</button>
                          <button className="icon-btn" title="Löschen" onClick={() => bulk('delete', [f.id])}>🗑</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {!compact && <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>Tipp: Dateien auf einen Ordner ziehen, um sie zu verschieben. Gespeichert in Cloudflare R2 (EU).</p>}
      {moveDlg && (
        <MoveDialog folders={data.folders} current={folder} onClose={() => setMoveDlg(null)} onMove={(target) => { bulk('move', moveDlg, target); setMoveDlg(null); }} />
      )}
    </div>
  );
}

function MoveDialog({ folders, current, onClose, onMove }: { folders: string[]; current: string; onClose: () => void; onMove: (f: string) => void }) {
  const [t, setT] = useState(current);
  const [neu, setNeu] = useState('');
  return (
    <Modal title="Verschieben nach" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary" onClick={() => onMove(neu ? t + neu.trim() + '/' : t)}>Verschieben</button></>}>
      <div className="form">
        <Field label="Zielordner" span={2}>
          <select value={t} onChange={(e) => setT(e.target.value)}>
            <option value="/">Ablage (oberste Ebene)</option>
            {folders.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="…oder neuer Unterordner darin" span={2}><input value={neu} onChange={(e) => setNeu(e.target.value)} placeholder="optional" /></Field>
      </div>
    </Modal>
  );
}

export function DocumentsPage() {
  const [companies] = useLoad<any[]>('/companies');
  const [cid, setCid] = useState<string>('');
  const [q, setQ] = useState('');
  const list = (companies || []).filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  const current = companies?.find((c) => c.id === cid);
  return (
    <>
      <PageHead title="Dokumente" sub="Ablage je Kunde – Ordner, Drag & Drop, Tags. Versendete Angebote landen automatisch im Ordner „Angebote“." />
      <div className="grid" style={{ gridTemplateColumns: '280px minmax(0,1fr)', alignItems: 'start' }}>
        <div className="card" style={{ padding: 12 }}>
          <input placeholder="Kunde suchen…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />
          <div style={{ maxHeight: '65vh', overflowY: 'auto' }}>
            {!companies ? <Spinner /> : list.length === 0 ? <div className="muted" style={{ padding: 8, fontSize: 13 }}>Keine Kunden.</div> : list.map((c) => (
              <button key={c.id} onClick={() => setCid(c.id)} className="btn ghost" style={{ width: '100%', justifyContent: 'flex-start', background: c.id === cid ? 'var(--ink)' : undefined, color: c.id === cid ? '#fff' : undefined, marginBottom: 2 }}>
                <span className="ficon folder" style={{ width: 26, height: 26, flex: '0 0 26px', fontSize: 12 }}>▰</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="card">
          {current ? (
            <>
              <div className="card-head"><h2>{current.name}</h2><a href={`#/companies/${current.id}`} className="btn sm ghost">Zur Firma →</a></div>
              <DocBrowser key={current.id} companyId={current.id} />
            </>
          ) : (
            <Empty title="Kunde wählen" text="Links einen Kunden auswählen, um seine Ablage zu öffnen." />
          )}
        </div>
      </div>
    </>
  );
}
