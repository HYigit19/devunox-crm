import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { Empty, Field, Modal, PageHead, Spinner, fmtDate, fmtDateTime, useAction, useLoad, useToast } from '../components';
import { PdfEditor } from './PdfSign';
import { pdfjs, pdfThumb } from '../pdfjs';

// Dokumentenmanagement (DMS): Ablage je Kunde/Projekt + „Meine Ablage“, Raster/Liste, Vorschau, Versionen,
// Favoriten, Freigabelinks, Papierkorb, ZIP-Download, Kopieren/Verschieben zwischen Ablagen.

export const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1).replace('.', ',')} MB` : `${(n / 1073741824).toFixed(2).replace('.', ',')} GB`);

export function kind(name: string, mime?: string) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf' || mime === 'application/pdf') return ['pdf', 'PDF'];
  if (/^(png|jpe?g|gif|webp|svg|heic|avif)$/.test(ext) || mime?.startsWith('image/')) return ['img', ext.toUpperCase().slice(0, 4)];
  if (/^(docx?|odt|rtf|txt|md|pptx?|key)$/.test(ext)) return ['doc', ext.toUpperCase().slice(0, 4)];
  if (/^(xlsx?|xlsm|csv|ods|numbers)$/.test(ext)) return ['xls', ext.toUpperCase().slice(0, 4)];
  return ['other', (ext || 'DAT').toUpperCase().slice(0, 4)];
}
const fileUrl = (id: string, dl = false) => `/api/documents/${id}/file${dl ? '?download=1' : ''}`;

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

/** Mehrere Dateien als ZIP herunterladen (im Browser gepackt) */
async function downloadZip(files: { id: string; name: string; path: string }[], zipName: string, onProgress?: (t: string) => void) {
  const { zip } = await import('fflate');
  const data: Record<string, Uint8Array> = {};
  let i = 0;
  for (const f of files) {
    onProgress?.(`Packe ${++i} von ${files.length} …`);
    const r = await fetch(fileUrl(f.id, true));
    if (!r.ok) continue;
    let p = f.path.replace(/^\/+/, '');
    while (data[p]) p = p.replace(/(\.[^.]+)?$/, (e) => ` (2)${e}`);
    data[p] = new Uint8Array(await r.arrayBuffer());
  }
  const out: Uint8Array = await new Promise((res, rej) => zip(data, { level: 0 }, (err, d) => (err ? rej(err) : res(d))));
  const url = URL.createObjectURL(new Blob([out as BlobPart], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = zipName.endsWith('.zip') ? zipName : `${zipName}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Kleines Aktionsmenü (⋯) */
function Menu({ items }: { items: ([string, () => void, boolean?] | null)[] }) {
  const [pos, setPos] = useState<React.CSSProperties | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const list = items.filter(Boolean) as [string, () => void, boolean?][];
  useEffect(() => {
    if (!pos) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setPos(null); };
    const close = () => setPos(null);
    document.addEventListener('mousedown', h);
    window.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('mousedown', h); window.removeEventListener('scroll', close, true); };
  }, [pos]);
  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (pos) return setPos(null);
    const r = e.currentTarget.getBoundingClientRect();
    const h = list.length * 36 + 14;
    const up = r.bottom + h > window.innerHeight - 8;
    setPos({ position: 'fixed', right: Math.max(8, window.innerWidth - r.right), ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) });
  };
  return (
    <div className="menu" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button className="icon-btn" aria-label="Aktionen" onClick={toggle}>⋯</button>
      {pos && (
        <div className="menu-list" style={pos}>
          {list.map(([l, fn, danger]) => <button key={l} className={danger ? 'danger' : ''} onClick={() => { setPos(null); fn(); }}>{l}</button>)}
        </div>
      )}
    </div>
  );
}

/** Vorschaubild für das Raster */
function Thumb({ f }: { f: any }) {
  const [k, label] = kind(f.name, f.mime);
  const [src, setSrc] = useState<string | null>(k === 'img' ? fileUrl(f.id) : null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (k !== 'pdf' || !ref.current) return;
    let off = false;
    const io = new IntersectionObserver((e) => {
      if (e[0].isIntersecting) { io.disconnect(); pdfThumb(`${fileUrl(f.id)}?v=${encodeURIComponent(f.updated_at || '')}`, 320).then((u) => !off && u && setSrc(u)); }
    });
    io.observe(ref.current);
    return () => { off = true; io.disconnect(); };
  }, [f.id, f.updated_at]);
  return <div className="thumb" ref={ref}>{src ? <img src={src} alt="" loading="lazy" /> : <span className={`ficon ${k}`} style={{ width: 48, height: 48, fontSize: 12 }}>{label}</span>}</div>;
}

// ======================================================================= Ablage (Ordner einer Ablage)

export function DocBrowser({ companyId, projectId, compact, general }: { companyId?: string; projectId?: string; compact?: boolean; general?: boolean }) {
  const scope = new URLSearchParams(Object.entries({ company_id: companyId || '', project_id: projectId || '', general: general ? '1' : '' }).filter(([, v]) => v)).toString();
  const [data, reload] = useLoad<{ files: any[]; folders: string[]; dms?: boolean }>(`/documents?${scope}`);
  const [folder, setFolder] = useState('/');
  const [q, setQ] = useState('');
  const [view, setView] = useState<'list' | 'grid'>(() => (localStorage.getItem('dvx_docview') as any) || 'list');
  const [sort, setSort] = useState<'name' | 'date' | 'size'>('name');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [moveDlg, setMoveDlg] = useState<{ ids: string[]; copy?: boolean } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [share, setShare] = useState<{ doc?: any; folder?: string } | null>(null);
  const [editPdf, setEditPdf] = useState<any>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);
  const versionInput = useRef<HTMLInputElement>(null);
  const versionFor = useRef<any>(null);
  const toast = useToast();
  const { run } = useAction();
  const dms = data?.dms !== false;
  useEffect(() => { try { localStorage.setItem('dvx_docview', view); } catch { /* egal */ } }, [view]);

  const subfolders = useMemo(() => {
    if (!data) return [];
    return data.folders.filter((f) => f !== folder && f.startsWith(folder) && f.slice(folder.length).split('/').filter(Boolean).length === 1);
  }, [data, folder]);
  const files = useMemo(() => {
    if (!data) return [];
    const list = q ? data.files.filter((f) => (f.name + ' ' + (f.tags || '')).toLowerCase().includes(q.toLowerCase())) : data.files.filter((f) => f.folder === folder);
    const by = sort === 'date' ? (a: any, b: any) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)) : sort === 'size' ? (a: any, b: any) => b.size - a.size : (a: any, b: any) => a.name.localeCompare(b.name, 'de', { numeric: true });
    return [...list].sort(by);
  }, [data, folder, q, sort]);
  const countIn = (path: string) => data?.files.filter((f) => f.folder.startsWith(path)).length || 0;
  const base = { company_id: companyId, project_id: projectId };

  const upload = async (entries: Entry[], target = folder) => {
    if (!entries.length) return;
    const total = entries.reduce((a, e) => a + e.file.size, 0);
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
      toast(`${entries.length} Datei(en) hochgeladen${dms ? ' – gleichnamige Dateien wurden als neue Version gespeichert' : ''}`);
    } catch (e: any) {
      toast(e.message, 'err');
    } finally {
      setProgress(null);
      reload();
    }
  };
  const uploadVersion = (f: File) => run('v', async () => {
    const fd = new FormData();
    fd.append('file', f);
    const res = await fetch(`/api/documents/${versionFor.current.id}/version`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any).error || 'Upload fehlgeschlagen');
    reload();
  }, 'Neue Version gespeichert – die alte bleibt unter „Versionen“ erhalten');

  const newFolder = () => {
    const name = prompt('Name des neuen Ordners');
    if (!name?.trim()) return;
    run('f', async () => { await api.post('/documents/folders', { ...base, path: folder + name.trim() }); reload(); });
  };
  const renameFolder = (path: string) => {
    const old = path.split('/').filter(Boolean).pop()!;
    const name = prompt('Neuer Ordnername', old);
    if (!name?.trim() || name === old) return;
    const to = path.slice(0, path.length - old.length - 1) + name.trim() + '/';
    run('rf', async () => { await api.post('/documents/folders/rename', { ...base, from: path, to }); reload(); });
  };
  const deleteFolder = (path: string) => {
    const n = countIn(path);
    if (!confirm(`Ordner „${path}“${n ? ` mit ${n} Datei(en)` : ''} löschen?${dms ? ' Die Dateien landen im Papierkorb.' : ''}`)) return;
    run('df', async () => { await api.post('/documents/folders/delete', { ...base, path }); reload(); }, dms ? 'In den Papierkorb verschoben' : 'Ordner gelöscht');
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
  const star = (ids: string[], on: boolean) => run('st', async () => { await api.post('/documents/star', { ids, on }); reload(); });
  const bulk = (action: 'delete' | 'move', ids: string[], target?: string, company?: string) =>
    run('b', async () => {
      if (action === 'delete' && !confirm(dms ? `${ids.length} Datei(en) in den Papierkorb verschieben? (30 Tage wiederherstellbar)` : `${ids.length} Datei(en) endgültig löschen?`)) return;
      await api.post('/documents/bulk', { ids, action, folder: target, ...(company !== undefined ? { company_id: company } : {}) });
      setSel(new Set());
      reload();
    }, action === 'delete' ? (dms ? 'In den Papierkorb verschoben' : 'Gelöscht') : 'Verschoben');
  const copyTo = (ids: string[], target: string, company?: string) => run('cp', async () => {
    for (const id of ids) await api.post(`/documents/${id}/copy`, { folder: target, ...(company !== undefined ? { company_id: company } : {}) });
    setSel(new Set());
    reload();
  }, 'Kopiert');
  const zipFiles = (list: any[], name: string, root = folder) => run('z', async () => {
    await downloadZip(list.map((f) => ({ id: f.id, name: f.name, path: (f.folder.startsWith(root) ? f.folder.slice(root.length) : f.folder.replace(/^\//, '')) + f.name })), name, setProgress);
    setProgress(null);
  });

  const fileMenu = (f: any): ([string, () => void, boolean?] | null)[] => [
    ['Vorschau', () => setPreview(f)],
    ['Herunterladen', () => window.open(fileUrl(f.id, true), '_self')],
    dms ? ['Freigabelink erstellen', () => setShare({ doc: f })] : null,
    kind(f.name, f.mime)[0] === 'pdf' ? ['PDF bearbeiten / unterschreiben', () => setEditPdf(f)] : null,
    dms ? ['Neue Version hochladen', () => { versionFor.current = f; versionInput.current?.click(); }] : null,
    dms ? [f.starred ? 'Aus Favoriten entfernen' : 'Zu Favoriten', () => star([f.id], !f.starred)] : null,
    ['Umbenennen', () => renameFile(f)],
    ['Tags', () => tagFile(f)],
    ['Verschieben', () => setMoveDlg({ ids: [f.id] })],
    dms ? ['Kopieren', () => setMoveDlg({ ids: [f.id], copy: true })] : null,
    ['Löschen', () => bulk('delete', [f.id]), true],
  ];

  const crumbs = ['/', ...folder.split('/').filter(Boolean).map((_, i, a) => `/${a.slice(0, i + 1).join('/')}/`)];
  const openFolder = (p: string) => { setFolder(p); setSel(new Set()); setQ(''); };
  const selectedFiles = files.filter((f) => sel.has(f.id));

  if (!data) return <Spinner />;
  return (
    <div>
      <div className="docs-bar">
        <div className="crumbs">
          {crumbs.map((c, i) => (
            <React.Fragment key={c}>
              {i > 0 && <span className="sep">/</span>}
              <button className={c === folder ? 'cur' : ''} onClick={() => openFolder(c)}>{i === 0 ? 'Ablage' : c.split('/').filter(Boolean).pop()}</button>
            </React.Fragment>
          ))}
        </div>
        <input style={{ width: compact ? 160 : 200 }} placeholder="Suchen…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value as any)} title="Sortierung">
          <option value="name">Name</option><option value="date">Neueste</option><option value="size">Größe</option>
        </select>
        <div className="seg" title="Ansicht"><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>☰</button><button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}>▦</button></div>
        <button className="btn sm" onClick={newFolder}>+ Ordner</button>
        <button className="btn sm hide-m" onClick={() => dirInput.current?.click()}>Ordner hochladen</button>
        <button className="btn sm primary" onClick={() => fileInput.current?.click()}>Hochladen</button>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => { const fl = [...(e.target.files || [])]; e.target.value = ''; upload(fl.map((f) => ({ file: f, path: f.name }))); }} />
        <input ref={dirInput} type="file" multiple hidden {...({ webkitdirectory: '' } as any)} onChange={(e) => { const fl = [...(e.target.files || [])]; e.target.value = ''; upload(fl.map((f) => ({ file: f, path: (f as any).webkitRelativePath || f.name }))); }} />
        <input ref={versionInput} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadVersion(f); }} />
      </div>
      {sel.size > 0 && (
        <div className="docs-bar sel-bar">
          <b style={{ flex: 1 }}>{sel.size} ausgewählt</b>
          <button className="btn sm" onClick={() => zipFiles(selectedFiles, `Auswahl_${new Date().toISOString().slice(0, 10)}`)}>⇩ ZIP</button>
          {dms && <button className="btn sm" onClick={() => star([...sel], true)}>★ Favorit</button>}
          <button className="btn sm" onClick={() => setMoveDlg({ ids: [...sel] })}>Verschieben</button>
          {dms && <button className="btn sm" onClick={() => setMoveDlg({ ids: [...sel], copy: true })}>Kopieren</button>}
          <button className="btn sm danger" onClick={() => bulk('delete', [...sel])}>Löschen</button>
          <button className="btn sm ghost" onClick={() => setSel(new Set())}>✕</button>
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
            <Empty title={q ? 'Nichts gefunden' : 'Dieser Ordner ist leer'} text={q ? undefined : 'Dateien oder ganze Ordner hierher ziehen – oder „Hochladen“ tippen.'} />
          </div>
        ) : view === 'grid' ? (
          <div className="fgrid">
            {!q && subfolders.map((p) => (
              <div key={p} className={`ftile folder ${dropTarget === p ? 'drop' : ''}`} onClick={() => openFolder(p)}
                onDragOver={(e) => { if (e.dataTransfer.types.includes('text/doc-ids')) { e.preventDefault(); setDropTarget(p); } }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(e) => { const ids = e.dataTransfer.getData('text/doc-ids'); if (ids) { e.preventDefault(); e.stopPropagation(); setDropTarget(null); bulk('move', ids.split(','), p); } }}>
                <div className="thumb"><span className="ficon folder" style={{ width: 52, height: 52, fontSize: 22 }}>▰</span></div>
                <div className="ftile-name"><b>{p.split('/').filter(Boolean).pop()}</b><span className="muted">{countIn(p)} Dateien</span></div>
                <Menu items={[['Öffnen', () => openFolder(p)], ['Als ZIP herunterladen', () => zipFiles(data.files.filter((f) => f.folder.startsWith(p)), p.split('/').filter(Boolean).pop()!, p)], dms ? ['Ordner freigeben', () => setShare({ folder: p })] : null, ['Umbenennen', () => renameFolder(p)], ['Löschen', () => deleteFolder(p), true]]} />
              </div>
            ))}
            {files.map((f) => (
              <div key={f.id} className={`ftile ${sel.has(f.id) ? 'sel' : ''}`} draggable onDragStart={(e) => e.dataTransfer.setData('text/doc-ids', (sel.has(f.id) ? [...sel] : [f.id]).join(','))} onClick={() => setPreview(f)}>
                <Thumb f={f} />
                <input type="checkbox" className="ftile-check" checked={sel.has(f.id)} onClick={(e) => e.stopPropagation()} onChange={() => setSel((s) => { const n = new Set(s); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n; })} />
                {f.starred ? <span className="ftile-star">★</span> : null}
                <div className="ftile-name"><b title={f.name}>{f.name}</b><span className="muted">{fmtSize(f.size)} · {fmtDate(f.updated_at || f.created_at)}{f.versions ? ` · v${f.versions + 1}` : ''}</span></div>
                <Menu items={fileMenu(f)} />
              </div>
            ))}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 34 }}><input type="checkbox" checked={files.length > 0 && files.every((f) => sel.has(f.id))} onChange={(e) => setSel(e.target.checked ? new Set(files.map((f) => f.id)) : new Set())} /></th>
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
                  <tr key={p} className="click" style={{ background: dropTarget === p ? 'var(--orange-soft)' : undefined }} onClick={() => openFolder(p)}
                    onDragOver={(e) => { if (e.dataTransfer.types.includes('text/doc-ids')) { e.preventDefault(); setDropTarget(p); } }}
                    onDragLeave={() => setDropTarget(null)}
                    onDrop={(e) => { const ids = e.dataTransfer.getData('text/doc-ids'); if (ids) { e.preventDefault(); e.stopPropagation(); setDropTarget(null); bulk('move', ids.split(','), p); } }}>
                    <td />
                    <td><div className="fname"><span className="ficon folder">▰</span><b>{p.split('/').filter(Boolean).pop()}</b></div></td>
                    <td className="hide-m" />
                    <td className="num hide-m muted">{countIn(p)} {countIn(p) === 1 ? 'Datei' : 'Dateien'}</td>
                    <td className="hide-m" />
                    <td onClick={(e) => e.stopPropagation()}><div className="row-actions"><Menu items={[['Als ZIP herunterladen', () => zipFiles(data.files.filter((f) => f.folder.startsWith(p)), p.split('/').filter(Boolean).pop()!, p)], dms ? ['Ordner freigeben', () => setShare({ folder: p })] : null, ['Umbenennen', () => renameFolder(p)], ['Löschen', () => deleteFolder(p), true]]} /></div></td>
                  </tr>
                ))}
                {files.map((f) => {
                  const [k, label] = kind(f.name, f.mime);
                  return (
                    <tr key={f.id} className="click" draggable onDragStart={(e) => e.dataTransfer.setData('text/doc-ids', (sel.has(f.id) ? [...sel] : [f.id]).join(','))} onClick={() => setPreview(f)}>
                      <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(f.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n; })} /></td>
                      <td>
                        <div className="fname">
                          <span className={`ficon ${k}`}>{label}</span>
                          <div style={{ minWidth: 0 }}>
                            <b style={{ display: 'block' }}>{f.starred ? <span className="star-on">★ </span> : null}{f.name}</b>
                            <span className="muted" style={{ fontSize: 12 }}>
                              {[f.source === 'quote' || f.source === 'tech' ? 'automatisch abgelegt' : f.source === 'report' ? 'Monatsbericht' : '', !projectId && f.project_name ? `Projekt ${f.project_name}` : '', f.versions ? `${f.versions + 1} Versionen` : '', f.shares ? '🔗 geteilt' : ''].filter(Boolean).join(' · ')}
                            </span>
                          </div>
                        </div>
                      </td>
                      {q && <td className="hide-m muted">{f.folder}</td>}
                      <td className="hide-m">{(f.tags || '').split(',').filter(Boolean).map((t: string) => <span key={t} className="tag">{t.trim()}</span>)}</td>
                      <td className="num hide-m">{fmtSize(f.size)}</td>
                      <td className="hide-m">{fmtDate(f.updated_at || f.created_at)}</td>
                      <td onClick={(e) => e.stopPropagation()}><div className="row-actions">{dms && <button className={`icon-btn ${f.starred ? 'star-on' : ''}`} title="Favorit" onClick={() => star([f.id], !f.starred)}>{f.starred ? '★' : '☆'}</button>}<Menu items={fileMenu(f)} /></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {!compact && <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>Tipp: Dateien auf einen Ordner ziehen, um sie zu verschieben. Gleichnamige Dateien werden als neue Version gespeichert. Speicher: Cloudflare R2 (EU).</p>}
      {moveDlg && <MoveDialog copy={moveDlg.copy} current={{ folder, companyId, general }} onClose={() => setMoveDlg(null)} onDone={(target, company) => { moveDlg.copy ? copyTo(moveDlg.ids, target, company) : bulk('move', moveDlg.ids, target, company); setMoveDlg(null); }} />}
      {preview && <FilePreview doc={preview} list={files} onClose={() => setPreview(null)} onChanged={reload} onShare={(d) => setShare({ doc: d })} onEditPdf={(d) => { setPreview(null); setEditPdf(d); }} />}
      {share && <ShareDialog doc={share.doc} folder={share.folder} scope={{ company_id: companyId || null, project_id: projectId || null }} onClose={() => { setShare(null); reload(); }} />}
      {editPdf && (
        <PdfEditor
          title={editPdf.name}
          load={() => fetch(fileUrl(editPdf.id)).then((r) => { if (!r.ok) throw new Error('PDF konnte nicht geladen werden'); return r.arrayBuffer(); })}
          onClose={() => setEditPdf(null)}
          onSave={async (bytes, name) => {
            const fd = new FormData();
            if (companyId) fd.append('company_id', companyId);
            if (projectId) fd.append('project_id', projectId);
            fd.append('folder', editPdf.folder || folder);
            fd.append('files', new File([bytes as BlobPart], name, { type: 'application/pdf' }), name);
            fd.append('paths', name);
            const res = await fetch('/api/documents/upload', { method: 'POST', body: fd });
            if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any).error || 'Speichern fehlgeschlagen');
            toast(`„${name}“ in der Ablage gespeichert`);
            reload();
          }}
        />
      )}
    </div>
  );
}

// ======================================================================= Verschieben / Kopieren (auch in andere Ablagen)

function MoveDialog({ current, copy, onClose, onDone }: { current: { folder: string; companyId?: string; general?: boolean }; copy?: boolean; onClose: () => void; onDone: (folder: string, company?: string) => void }) {
  const [companies] = useLoad<any[]>('/companies');
  const here = current.general ? '__general' : current.companyId || '';
  const [target, setTarget] = useState(here);
  const [data] = useLoad<{ folders: string[] }>(target ? `/documents?${target === '__general' ? 'general=1' : `company_id=${target}`}` : null, [target]);
  const [t, setT] = useState(current.folder);
  const [neu, setNeu] = useState('');
  const folders = data?.folders || [];
  return (
    <Modal title={copy ? 'Kopieren nach' : 'Verschieben nach'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Abbrechen</button><button className="btn primary" disabled={!target} onClick={() => onDone(neu ? t + neu.trim() + '/' : t, target !== here ? target : undefined)}>{copy ? 'Kopieren' : 'Verschieben'}</button></>}>
      <div className="form">
        <Field label="Ablage" span={2}>
          <select value={target} onChange={(e) => { setTarget(e.target.value); setT('/'); }}>
            <option value="__general">Meine Ablage</option>
            {(companies || []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.customer_no ? ` · ${c.customer_no}` : ''}</option>)}
          </select>
        </Field>
        <Field label="Ordner" span={2}>
          <select value={t} onChange={(e) => setT(e.target.value)}>
            <option value="/">oberste Ebene</option>
            {folders.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="…oder neuer Unterordner darin" span={2}><input value={neu} onChange={(e) => setNeu(e.target.value)} placeholder="optional" /></Field>
      </div>
      {target !== here && !copy && <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>Beim Verschieben in eine andere Ablage wird die Projekt-Zuordnung entfernt.</p>}
    </Modal>
  );
}

// ======================================================================= Vorschau mit Versionen und Freigaben

function PdfPreview({ url }: { url: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const m = await pdfjs();
        const doc = await m.getDocument({ data: await (await fetch(url)).arrayBuffer() }).promise;
        const box = ref.current!;
        box.innerHTML = '';
        for (let i = 1; i <= Math.min(doc.numPages, 30) && !off; i++) {
          const p = await doc.getPage(i);
          const w = box.clientWidth || 600;
          const vp = p.getViewport({ scale: (w / p.getViewport({ scale: 1 }).width) * Math.min(2, window.devicePixelRatio || 1) });
          const c = document.createElement('canvas');
          c.width = vp.width;
          c.height = vp.height;
          box.appendChild(c);
          await p.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport: vp } as any).promise;
        }
      } catch {
        setErr('Vorschau nicht möglich – bitte herunterladen.');
      }
    })();
    return () => { off = true; };
  }, [url]);
  return err ? <div className="muted" style={{ padding: 30, textAlign: 'center' }}>{err}</div> : <div className="pdf-preview" ref={ref}><Spinner /></div>;
}

function FilePreview({ doc, list, onClose, onChanged, onShare, onEditPdf }: { doc: any; list: any[]; onClose: () => void; onChanged: () => void; onShare: (d: any) => void; onEditPdf: (d: any) => void }) {
  const [cur, setCur] = useState(doc);
  const [k] = kind(cur.name, cur.mime);
  const [versions, reloadV] = useLoad<any[]>(cur.versions !== undefined ? `/documents/${cur.id}/versions` : null, [cur.id]);
  const [shares] = useLoad<any[]>(cur.versions !== undefined ? `/documents/shares?document_id=${cur.id}` : null, [cur.id]);
  const [text, setText] = useState<string | null>(null);
  const { busy, run } = useAction();
  const idx = list.findIndex((x) => x.id === cur.id);
  useEffect(() => {
    setText(null);
    if (/\.(txt|md|csv|json|log)$/i.test(cur.name) && cur.size < 400000) fetch(fileUrl(cur.id)).then((r) => r.text()).then(setText).catch(() => {});
  }, [cur.id]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && idx < list.length - 1) setCur(list[idx + 1]);
      if (e.key === 'ArrowLeft' && idx > 0) setCur(list[idx - 1]);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [idx, list]);
  const restore = (v: any) => confirm('Diese Version wiederherstellen? Die aktuelle Fassung bleibt als Version erhalten.') && run('rv', async () => { await api.post(`/documents/${cur.id}/versions/${v.id}/restore`); reloadV(); onChanged(); }, 'Version wiederhergestellt');
  const url = fileUrl(cur.id) + `?v=${encodeURIComponent(cur.updated_at || '')}`;
  return (
    <div className="modal-bg pdf-modal-bg">
      <div className="modal pdf-modal preview-modal">
        <div className="modal-head">
          <div style={{ minWidth: 0 }}>
            <h3 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cur.name}</h3>
            <div className="muted" style={{ fontSize: 12.5 }}>{fmtSize(cur.size)} · {cur.folder} · geändert {fmtDate(cur.updated_at || cur.created_at)}</div>
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button className="icon-btn" disabled={idx <= 0} onClick={() => setCur(list[idx - 1])} title="Vorherige">‹</button>
            <button className="icon-btn" disabled={idx < 0 || idx >= list.length - 1} onClick={() => setCur(list[idx + 1])} title="Nächste">›</button>
            <button className="icon-btn" onClick={onClose} aria-label="Schließen">✕</button>
          </div>
        </div>
        <div className="preview-body">
          <div className="preview-main">
            {k === 'pdf' ? <PdfPreview url={fileUrl(cur.id)} key={cur.id + cur.updated_at} /> : k === 'img' ? <img src={url} alt="" className="preview-img" /> : text !== null ? <pre className="preview-text">{text}</pre> : (
              <div className="preview-none"><span className={`ficon ${k}`} style={{ width: 64, height: 64, fontSize: 15 }}>{kind(cur.name, cur.mime)[1]}</span><p className="muted">Für diesen Dateityp gibt es keine Vorschau.</p><a className="btn primary" href={fileUrl(cur.id, true)}>Herunterladen</a></div>
            )}
          </div>
          <aside className="preview-side">
            <div style={{ display: 'grid', gap: 6 }}>
              <a className="btn primary" href={fileUrl(cur.id, true)}>⇩ Herunterladen</a>
              {cur.versions !== undefined && <button className="btn" onClick={() => onShare(cur)}>🔗 Freigabelink</button>}
              {k === 'pdf' && <button className="btn" onClick={() => onEditPdf(cur)}>✍ Bearbeiten / unterschreiben</button>}
            </div>
            <dl className="dl" style={{ gridTemplateColumns: '84px 1fr', fontSize: 12.5, marginTop: 14 }}>
              <dt>Ablage</dt><dd>{cur.company_name || 'Meine Ablage'}</dd>
              <dt>Ordner</dt><dd>{cur.folder}</dd>
              {cur.project_name && <><dt>Projekt</dt><dd>{cur.project_name}</dd></>}
              <dt>Erstellt</dt><dd>{fmtDateTime(cur.created_at)}</dd>
              {cur.tags && <><dt>Tags</dt><dd>{cur.tags}</dd></>}
            </dl>
            {versions && (
              <div style={{ marginTop: 14 }}>
                <h4 style={{ marginBottom: 6 }}>Versionen</h4>
                <div className="ver-row cur"><b>Aktuell</b><span className="muted">{fmtDateTime(cur.updated_at || cur.created_at)} · {fmtSize(cur.size)}</span></div>
                {versions.length === 0 ? <div className="muted" style={{ fontSize: 12.5 }}>Noch keine älteren Versionen.</div> : versions.map((v, i) => (
                  <div key={v.id} className="ver-row">
                    <b>Version {versions.length - i}</b>
                    <span className="muted">{fmtDateTime(v.created_at)} · {fmtSize(v.size)}{v.user_name ? ` · ${v.user_name}` : ''}</span>
                    <span style={{ display: 'flex', gap: 4 }}><a className="btn sm ghost" href={`/api/documents/versions/${v.id}/file`}>⇩</a><button className="btn sm ghost" disabled={!!busy} onClick={() => restore(v)}>Wiederherstellen</button></span>
                  </div>
                ))}
              </div>
            )}
            {shares && shares.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <h4 style={{ marginBottom: 6 }}>Freigaben</h4>
                {shares.map((s) => <div key={s.id} className="muted" style={{ fontSize: 12.5 }}>🔗 {s.expires_at ? `bis ${fmtDate(s.expires_at)}` : 'ohne Ablauf'}{s.protected ? ' · Passwort' : ''} · {s.downloads} Downloads</div>)}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

// ======================================================================= Freigabelinks

function ShareDialog({ doc, folder, scope, onClose }: { doc?: any; folder?: string; scope: { company_id: string | null; project_id: string | null }; onClose: () => void }) {
  const [v, setV] = useState({ expires_days: 14, password: '', label: '' });
  const [link, setLink] = useState<any>(null);
  const [existing, reload] = useLoad<any[]>(doc ? `/documents/shares?document_id=${doc.id}` : '/documents/shares');
  const { busy, run } = useAction();
  const toast = useToast();
  const list = (existing || []).filter((s) => (doc ? s.document_id === doc.id : !s.document_id && s.folder === folder && (s.company_id || null) === scope.company_id));
  const create = () => run('c', async () => {
    const r = await api.post('/documents/shares', doc ? { document_id: doc.id, ...v } : { ...scope, folder, ...v });
    setLink(r);
    reload();
    try { await navigator.clipboard.writeText(r.url); toast('Link erstellt und kopiert'); } catch { /* egal */ }
  });
  const copy = async (u: string) => { try { await navigator.clipboard.writeText(u); toast('Link kopiert'); } catch { prompt('Link kopieren:', u); } };
  return (
    <Modal title={doc ? `„${doc.name}“ freigeben` : `Ordner „${folder}“ freigeben`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Schließen</button><button className="btn primary" disabled={!!busy} onClick={create}>Link erstellen</button></>}>
      <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>Jeder mit dem Link kann {doc ? 'die Datei ansehen und herunterladen' : 'die Dateien in diesem Ordner herunterladen'} – ohne Login. Nur lesen, jederzeit widerrufbar.</p>
      <div className="form">
        <Field label="Gültig"><select value={v.expires_days} onChange={(e) => setV({ ...v, expires_days: Number(e.target.value) })}><option value={1}>1 Tag</option><option value={7}>7 Tage</option><option value={14}>14 Tage</option><option value={30}>30 Tage</option><option value={90}>90 Tage</option><option value={0}>ohne Ablauf</option></select></Field>
        <Field label="Passwort (optional)"><input value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} placeholder="mind. 4 Zeichen" autoComplete="new-password" /></Field>
        <Field label="Hinweis für den Empfänger (optional)" span={2}><input value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} placeholder="z. B. Unterlagen zum Kick-off" /></Field>
      </div>
      {link && <div className="portal-link"><div className="muted" style={{ fontSize: 12.5 }}>Neuer Link{link.expires_at ? ` · gültig bis ${fmtDate(link.expires_at)}` : ''}</div><code>{link.url}</code><button className="btn sm" style={{ marginTop: 8 }} onClick={() => copy(link.url)}>Kopieren</button></div>}
      {list.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <h4 style={{ marginBottom: 6 }}>Aktive Links</h4>
          {list.map((s) => (
            <div key={s.id} className="share-row">
              <span className="muted" style={{ flex: 1, fontSize: 12.5 }}>{s.expired ? 'abgelaufen' : s.expires_at ? `bis ${fmtDate(s.expires_at)}` : 'ohne Ablauf'}{s.protected ? ' · 🔒' : ''} · {s.downloads} Downloads{s.last_access_at ? ` · zuletzt ${fmtDateTime(s.last_access_at)}` : ''}</span>
              <button className="btn sm" onClick={() => copy(s.url)}>Kopieren</button>
              <button className="btn sm ghost danger" onClick={() => run('r', async () => { await api.post(`/documents/shares/${s.id}/revoke`); reload(); }, 'Link widerrufen')}>Widerrufen</button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ======================================================================= Zuletzt, Favoriten, Geteilt, Papierkorb

function FlatList({ mode }: { mode: 'recent' | 'starred' }) {
  const [data, reload] = useLoad<{ files: any[] }>(`/documents?${mode}=1`);
  const [preview, setPreview] = useState<any>(null);
  const [share, setShare] = useState<any>(null);
  const { run } = useAction();
  const files = data?.files || [];
  return (
    <>
      <div className="card-head"><h2>{mode === 'recent' ? 'Zuletzt geändert' : 'Favoriten'}</h2></div>
      {!data ? <Spinner /> : files.length === 0 ? <Empty title={mode === 'recent' ? 'Noch keine Dateien' : 'Keine Favoriten'} text={mode === 'starred' ? 'Markiere wichtige Dateien mit ☆ – sie erscheinen dann hier.' : undefined} /> : (
        <div className="table-wrap"><table><tbody>
          {files.map((f) => {
            const [k, label] = kind(f.name, f.mime);
            return (
              <tr key={f.id} className="click" onClick={() => setPreview(f)}>
                <td><div className="fname"><span className={`ficon ${k}`}>{label}</span><div style={{ minWidth: 0 }}><b style={{ display: 'block' }}>{f.name}</b><span className="muted" style={{ fontSize: 12 }}>{f.company_name || 'Meine Ablage'} · {f.folder}</span></div></div></td>
                <td className="hide-m muted">{fmtDateTime(f.updated_at || f.created_at)}</td>
                <td className="num" onClick={(e) => e.stopPropagation()}><button className={`icon-btn ${f.starred ? 'star-on' : ''}`} onClick={() => run('s', async () => { await api.post('/documents/star', { ids: [f.id], on: !f.starred }); reload(); })}>{f.starred ? '★' : '☆'}</button></td>
              </tr>
            );
          })}
        </tbody></table></div>
      )}
      {preview && <FilePreview doc={preview} list={files} onClose={() => setPreview(null)} onChanged={reload} onShare={(d) => setShare(d)} onEditPdf={() => {}} />}
      {share && <ShareDialog doc={share} scope={{ company_id: share.company_id, project_id: share.project_id }} onClose={() => setShare(null)} />}
    </>
  );
}

function SharedList() {
  const [list, reload, , err] = useLoad<any[]>('/documents/shares');
  const { run } = useAction();
  const toast = useToast();
  if (err) return <Empty title="Noch nicht verfügbar" text={err} />;
  return (
    <>
      <div className="card-head"><h2>Geteilte Links</h2></div>
      {!list ? <Spinner /> : list.length === 0 ? <Empty title="Keine aktiven Freigaben" text="Über ⋯ → „Freigabelink erstellen“ teilst du Dateien oder Ordner sicher mit Kunden und Partnern." /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Freigabe</th><th className="hide-m">Gültig</th><th className="hide-m num">Downloads</th><th /></tr></thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td><b>{s.document_id ? s.doc_name : `Ordner ${s.folder}`}</b><div className="muted" style={{ fontSize: 12 }}>{s.company_name || 'Meine Ablage'}{s.protected ? ' · 🔒 Passwort' : ''}{s.label ? ` · ${s.label}` : ''}</div></td>
                <td className="hide-m">{s.expired ? <span className="badge red">abgelaufen</span> : s.expires_at ? fmtDate(s.expires_at) : 'ohne Ablauf'}</td>
                <td className="hide-m num">{s.downloads}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn sm" onClick={async () => { try { await navigator.clipboard.writeText(s.url); toast('Link kopiert'); } catch { prompt('Link:', s.url); } }}>Kopieren</button>
                  <button className="btn sm ghost danger" style={{ marginLeft: 4 }} onClick={() => run('r', async () => { await api.post(`/documents/shares/${s.id}/revoke`); reload(); }, 'Widerrufen')}>Widerrufen</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </>
  );
}

function TrashList() {
  const [list, reload, , err] = useLoad<any[]>('/documents/trash');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const { busy, run } = useAction();
  if (err) return <Empty title="Noch nicht verfügbar" text={err} />;
  const restore = (ids: string[]) => run('r', async () => { await api.post('/documents/trash/restore', { ids }); setSel(new Set()); reload(); }, 'Wiederhergestellt');
  const purge = (ids?: string[]) => confirm(ids ? `${ids.length} Datei(en) endgültig löschen?` : 'Papierkorb endgültig leeren? Das kann nicht rückgängig gemacht werden.') && run('p', async () => { await api.post('/documents/trash/purge', ids ? { ids } : { all: true }); setSel(new Set()); reload(); }, 'Endgültig gelöscht');
  return (
    <>
      <div className="card-head">
        <h2>Papierkorb</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          {sel.size > 0 && <><button className="btn sm" disabled={!!busy} onClick={() => restore([...sel])}>Wiederherstellen ({sel.size})</button><button className="btn sm danger" disabled={!!busy} onClick={() => purge([...sel])}>Endgültig löschen</button></>}
          {list && list.length > 0 && sel.size === 0 && <button className="btn sm danger" disabled={!!busy} onClick={() => purge()}>Papierkorb leeren</button>}
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginTop: -6 }}>Gelöschte Dateien bleiben 30 Tage hier und werden danach automatisch endgültig gelöscht.</p>
      {!list ? <Spinner /> : list.length === 0 ? <Empty title="Papierkorb ist leer" /> : (
        <div className="table-wrap"><table>
          <thead><tr><th style={{ width: 34 }}><input type="checkbox" checked={list.length > 0 && list.every((f) => sel.has(f.id))} onChange={(e) => setSel(e.target.checked ? new Set(list.map((f) => f.id)) : new Set())} /></th><th>Datei</th><th className="hide-m">Gelöscht</th><th className="hide-m">Noch</th><th /></tr></thead>
          <tbody>
            {list.map((f) => {
              const [k, label] = kind(f.name, f.mime);
              return (
                <tr key={f.id}>
                  <td><input type="checkbox" checked={sel.has(f.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n; })} /></td>
                  <td><div className="fname"><span className={`ficon ${k}`}>{label}</span><div style={{ minWidth: 0 }}><b style={{ display: 'block' }}>{f.name}</b><span className="muted" style={{ fontSize: 12 }}>{f.company_name || 'Meine Ablage'} · {f.folder} · {fmtSize(f.size)}</span></div></div></td>
                  <td className="hide-m">{fmtDateTime(f.deleted_at)}</td>
                  <td className="hide-m">{Math.max(0, f.days_left)} Tage</td>
                  <td className="num"><button className="btn sm" disabled={!!busy} onClick={() => restore([f.id])}>Wiederherstellen</button></td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
    </>
  );
}

function StorageCard() {
  const [s] = useLoad<any>('/documents/stats');
  if (!s?.files) return null;
  const K: Record<string, string> = { pdf: 'PDF', img: 'Bilder', xls: 'Tabellen', doc: 'Dokumente', other: 'Sonstige' };
  const total = s.files.size + (s.trash?.size || 0) + (s.versions?.size || 0);
  return (
    <div className="storage">
      <div className="nav-label" style={{ padding: '10px 6px 6px' }}>Speicher</div>
      <b>{fmtSize(total)}</b> <span className="muted" style={{ fontSize: 12 }}>· {s.files.n} Dateien</span>
      <div className="storage-bar">{s.kinds.map((k: any) => <i key={k.kind} className={`ficon ${k.kind}`} style={{ width: `${total ? (k.size / total) * 100 : 0}%` }} title={`${K[k.kind]}: ${fmtSize(k.size)}`} />)}</div>
      <div className="muted" style={{ fontSize: 11.5 }}>Versionen {fmtSize(s.versions?.size || 0)} · Papierkorb {fmtSize(s.trash?.size || 0)}</div>
    </div>
  );
}

// ======================================================================= Seite „Dokumente“

type Area = { kind: 'scope'; id: string } | { kind: 'recent' | 'starred' | 'shared' | 'trash' };

export function DocumentsPage() {
  const [companies] = useLoad<any[]>('/companies');
  const [area, setArea] = useState<Area>({ kind: 'scope', id: '__general' });
  const [q, setQ] = useState('');
  const browser = useRef<HTMLDivElement>(null);
  const list = (companies || []).filter((c) => (c.name + ' ' + (c.customer_no || '')).toLowerCase().includes(q.toLowerCase()));
  const cid = area.kind === 'scope' ? area.id : '';
  const current = companies?.find((c) => c.id === cid);
  const pick = (a: Area) => {
    setArea(a);
    if (window.innerWidth < 860) setTimeout(() => browser.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  const on = (a: Area) => area.kind === a.kind && (a.kind !== 'scope' || (area as any).id === (a as any).id);
  const itemStyle = (active: boolean): React.CSSProperties => ({ width: '100%', justifyContent: 'flex-start', background: active ? 'var(--grad-1)' : undefined, color: active ? '#fff' : undefined, boxShadow: active ? 'var(--glow-1)' : undefined, marginBottom: 3 });
  const nav = (a: Area, icon: string, label: string, sub?: string) => (
    <button onClick={() => pick(a)} className="btn ghost" style={itemStyle(on(a))}>
      <span className="dms-ico">{icon}</span>
      <span style={{ textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}{sub && <span style={{ display: 'block', fontSize: 11, opacity: 0.6, fontWeight: 500 }}>{sub}</span>}</span>
    </button>
  );
  return (
    <>
      <PageHead title="Dokumente" sub="Dokumentenmanagement für alle Kunden: Ordner, Versionen, Vorschau, Freigabelinks, Favoriten und Papierkorb. PDFs direkt bearbeiten und unterschreiben." />
      <div className="grid docs-layout">
        <div className="card" style={{ padding: 12 }}>
          {nav({ kind: 'scope', id: '__general' }, '★', 'Meine Ablage', 'ohne Kundenbezug')}
          {nav({ kind: 'recent' }, '🕘', 'Zuletzt geändert')}
          {nav({ kind: 'starred' }, '☆', 'Favoriten')}
          {nav({ kind: 'shared' }, '🔗', 'Geteilt')}
          {nav({ kind: 'trash' }, '🗑', 'Papierkorb')}
          <div className="nav-label" style={{ padding: '12px 6px 6px' }}>Kunden</div>
          <input placeholder="Kunde oder Kundennr. …" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />
          <div className="cust-list">
            {!companies ? <Spinner /> : list.length === 0 ? <div className="muted" style={{ padding: 8, fontSize: 13 }}>{q ? 'Kein Kunde gefunden.' : 'Noch keine Kunden – lege unter „Firmen“ einen an.'}</div> : list.map((c) => (
              <React.Fragment key={c.id}>{nav({ kind: 'scope', id: c.id }, '▰', c.name, c.customer_no)}</React.Fragment>
            ))}
          </div>
          <StorageCard />
        </div>
        <div className="card" ref={browser} style={{ scrollMarginTop: 70 }}>
          {area.kind === 'recent' || area.kind === 'starred' ? <FlatList key={area.kind} mode={area.kind} />
            : area.kind === 'shared' ? <SharedList />
            : area.kind === 'trash' ? <TrashList />
            : cid === '__general' ? (
              <>
                <div className="card-head"><h2>Meine Ablage</h2><span className="muted">Verträge, Vorlagen, Handbuch, eigene Unterlagen</span></div>
                <DocBrowser key="general" general />
              </>
            ) : current ? (
              <>
                <div className="card-head"><h2>{current.name} <span className="cno">{current.customer_no}</span></h2><a href={`#/companies/${current.id}`} className="btn sm ghost">Zur Firma →</a></div>
                <DocBrowser key={current.id} companyId={current.id} />
              </>
            ) : <Empty title="Ablage wählen" text="Wähle links eine Ablage." />}
        </div>
      </div>
    </>
  );
}
