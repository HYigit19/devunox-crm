import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { Empty, Field, Modal, PageHead, Spinner, fmtDate, useAction, useLoad, useToast } from '../components';
import { STAMP_H, STAMP_W, stampSvg, svgToPng } from '../stamp';

// ======================================================================= Unterschrift & Stempel

type Kind = 'signature' | 'stamp';
type Asset = { url: string; bytes: Uint8Array; w: number; h: number; custom: boolean };
type Assets = { signature: Asset | null; stamp: Asset | null };

async function fetchAsset(kind: Kind): Promise<Asset | null> {
  const res = await fetch(`/api/sign/${kind}`, { cache: 'no-store' });
  if (!res.ok) return null;
  const blob = await res.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const url = URL.createObjectURL(blob);
  const img = new Image();
  await new Promise<void>((r) => { img.onload = () => r(); img.onerror = () => r(); img.src = url; });
  return { url, bytes, w: img.naturalWidth || 1, h: img.naturalHeight || 1, custom: res.headers.get('x-sign-source') === 'custom' };
}

export function useSignAssets(): [Assets | null, () => void] {
  const [a, setA] = useState<Assets | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let off = false;
    Promise.all([fetchAsset('signature'), fetchAsset('stamp')]).then(([signature, stamp]) => !off && setA({ signature, stamp }));
    return () => { off = true; };
  }, [tick]);
  return [a, useCallback(() => setTick((t) => t + 1), [])];
}

async function putAsset(kind: Kind, png: Blob) {
  const res = await fetch(`/api/sign/${kind}`, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: png });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any).error || 'Speichern fehlgeschlagen');
}

/** Beliebiges Bild → PNG, auf den sichtbaren Inhalt zugeschnitten */
async function imageFileToPng(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('Bild konnte nicht gelesen werden')); img.src = url; });
    const max = 1600;
    const f = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * f);
    c.height = Math.round(img.naturalHeight * f);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG-Export fehlgeschlagen'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Vermerk-Texte
export const SIGN_LABEL = { de: 'Digital unterschrieben und gestempelt', en: 'Digitally signed and stamped' };
type Lang = 'de' | 'en' | 'both';
const today = () => new Date().toISOString().slice(0, 10);
function dateFor(lang: 'de' | 'en', iso = today()) {
  const d = new Date(iso + 'T12:00:00');
  return lang === 'de' ? d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
function captionLines(lang: Lang, name: string, place: string) {
  const who = (l: 'de' | 'en') => [name, [place, dateFor(l)].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  if (lang === 'de') return [SIGN_LABEL.de, who('de')];
  if (lang === 'en') return [SIGN_LABEL.en, who('en')];
  return [SIGN_LABEL.de, SIGN_LABEL.en, who('de')];
}

// ======================================================================= Unterschrift zeichnen

function SignaturePad({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ink, setInk] = useState('#1b2a6b');
  const [empty, setEmpty] = useState(true);
  const drawing = useRef<{ x: number; y: number }[] | null>(null);
  const { busy, run } = useAction();

  useEffect(() => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    const dpr = Math.max(2, window.devicePixelRatio || 1);
    c.width = r.width * dpr;
    c.height = r.height * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    drawing.current = [pos(e)];
  };
  const move = (e: React.PointerEvent) => {
    const pts = drawing.current;
    if (!pts) return;
    const p = pos(e);
    pts.push(p);
    const ctx = ref.current!.getContext('2d')!;
    ctx.strokeStyle = ink;
    const n = pts.length;
    const a = pts[n - 3] || pts[0], b = pts[n - 2] || pts[0], cur = pts[n - 1];
    const speed = Math.hypot(cur.x - b.x, cur.y - b.y);
    ctx.lineWidth = Math.max(1.6, 3.4 - speed * 0.08) * (e.pressure && e.pointerType === 'pen' ? 0.6 + e.pressure : 1);
    ctx.beginPath();
    ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2);
    ctx.quadraticCurveTo(b.x, b.y, (b.x + cur.x) / 2, (b.y + cur.y) / 2);
    ctx.stroke();
    setEmpty(false);
  };
  const up = () => { drawing.current = null; };
  const clear = () => {
    const c = ref.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
  };
  const save = () => run('s', async () => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    let x0 = width, y0 = height, x1 = 0, y1 = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 <= x0) throw new Error('Bitte zuerst unterschreiben.');
    const pad = 12;
    const out = document.createElement('canvas');
    out.width = x1 - x0 + pad * 2;
    out.height = y1 - y0 + pad * 2;
    out.getContext('2d')!.drawImage(c, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
    const blob = await new Promise<Blob>((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('Export fehlgeschlagen'))), 'image/png'));
    await putAsset('signature', blob);
    onSaved();
    onClose();
  }, 'Unterschrift gespeichert');

  return (
    <Modal wide title="Unterschrift zeichnen" onClose={onClose} footer={
      <>
        <div className="seg" style={{ marginRight: 'auto' }}>
          <button className={ink === '#1b2a6b' ? 'active' : ''} onClick={() => setInk('#1b2a6b')}>Blau</button>
          <button className={ink === '#111111' ? 'active' : ''} onClick={() => setInk('#111111')}>Schwarz</button>
        </div>
        <button className="btn" onClick={clear}>Leeren</button>
        <button className="btn primary" disabled={empty || !!busy} onClick={save}>{busy ? 'Speichere…' : 'Als Unterschrift speichern'}</button>
      </>
    }>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Mit Finger, Stift oder Maus im Feld unterschreiben. Am Handy am besten quer halten.</p>
      <canvas
        ref={ref}
        className="sig-pad"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
    </Modal>
  );
}

// ======================================================================= PDF-Editor

type El = { id: string; page: number; kind: 'signature' | 'stamp' | 'text' | 'caption'; x: number; y: number; w: number; h: number; text?: string; lang?: Lang };
type PageInfo = { w: number; h: number; rotate: number };

// Helvetica (WinAnsi) kann nicht alle Zeichen – sinnvoll ersetzen
const toAnsi = (s: string) =>
  [...s].map((ch) => {
    const c = ch.charCodeAt(0);
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || '€–—„“”‘’•…'.includes(ch)) return ch;
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return /^[\x20-\x7e]$/.test(base) ? base : ch === 'ı' ? 'i' : '?';
  }).join('');

const uid = () => Math.random().toString(36).slice(2, 10);

export function PdfEditor({ title, load, onSave, onClose }: { title: string; load: () => Promise<ArrayBuffer>; onSave?: (bytes: Uint8Array, name: string) => Promise<void>; onClose: () => void }) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [els, setEls] = useState<El[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>('de');
  const [assets] = useSignAssets();
  const [settings] = useLoad<Record<string, string>>('/settings');
  const scroller = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const toast = useToast();
  const { busy, run } = useAction();

  // PDF laden und mit pdf.js darstellen
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const buf = new Uint8Array(await load());
        if (off) return;
        setBytes(buf);
        const pdfjs = await import('pdfjs-dist');
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const doc = await pdfjs.getDocument({ data: buf.slice() }).promise;
        const infos: PageInfo[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const p = await doc.getPage(i);
          const vp = p.getViewport({ scale: 1 });
          infos.push({ w: vp.width, h: vp.height, rotate: p.rotate });
        }
        if (off) return;
        setPages(infos);
        // nach dem Rendern der Platzhalter zeichnen
        requestAnimationFrame(async () => {
          for (let i = 1; i <= doc.numPages; i++) {
            const canvas = canvasRefs.current[i - 1];
            if (!canvas || off) continue;
            const p = await doc.getPage(i);
            const cssW = canvas.parentElement!.clientWidth;
            const base = p.getViewport({ scale: 1 });
            const dpr = Math.min(2.5, Math.max(1.5, window.devicePixelRatio || 1));
            const vp = p.getViewport({ scale: (cssW / base.width) * dpr });
            canvas.width = vp.width;
            canvas.height = vp.height;
            await p.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp } as any).promise;
          }
        });
      } catch (e: any) {
        setErr(e?.name === 'PasswordException' ? 'Das PDF ist passwortgeschützt und kann nicht bearbeitet werden.' : e.message || 'PDF konnte nicht geöffnet werden.');
      }
    })();
    return () => { off = true; };
  }, []);

  const name = settings?.sign_name || 'Hüseyin Yigit';
  const place = settings?.sign_place || '';

  /** Seite, die gerade am meisten sichtbar ist */
  const currentPage = () => {
    const box = scroller.current?.getBoundingClientRect();
    if (!box) return 0;
    let best = 0, bestVis = -1;
    pageRefs.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vis = Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top);
      if (vis > bestVis) { bestVis = vis; best = i; }
    });
    return best;
  };
  const ratio = (pi: number) => (pages[pi] ? pages[pi].w / pages[pi].h : 0.707);

  const mk = (kind: El['kind'], pi: number, x: number, y: number, wFrac: number, extra: Partial<El> = {}): El => {
    const r = ratio(pi);
    let h = 0.05;
    if (kind === 'signature' && assets?.signature) h = (wFrac * r * assets.signature.h) / assets.signature.w;
    if (kind === 'stamp' && assets?.stamp) h = (wFrac * r * assets.stamp.h) / assets.stamp.w;
    if (kind === 'caption') h = 0.018 * captionLines(extra.lang || lang, name, place).length;
    if (kind === 'text') h = 0.022;
    return { id: uid(), page: pi, kind, x, y, w: wFrac, h, ...extra };
  };
  const add = (list: El[]) => { setEls((l) => [...l, ...list]); setSel(list[list.length - 1]?.id || null); };

  const addSignature = () => { const p = currentPage(); add([mk('signature', p, 0.08, 0.7, 0.3)]); };
  const addStamp = () => { const p = currentPage(); add([mk('stamp', p, 0.5, 0.68, 0.3)]); };
  const addCaption = () => { const p = currentPage(); add([mk('caption', p, 0.08, 0.86, 0.5, { lang })]); };
  const addText = () => { const t = prompt('Text', ''); if (!t) return; const p = currentPage(); add([mk('text', p, 0.1, 0.5, Math.min(0.8, t.length * 0.012 + 0.04), { text: t })]); };
  const addDate = () => { const p = currentPage(); const t = dateFor(lang === 'en' ? 'en' : 'de'); add([mk('text', p, 0.1, 0.5, t.length * 0.012 + 0.03, { text: t })]); };
  const addAll = () => {
    const p = currentPage();
    const s = mk('signature', p, 0.08, 0.72, 0.3);
    const st = mk('stamp', p, 0.46, 0.7, 0.3);
    const cap = mk('caption', p, 0.08, Math.min(0.94, Math.max(s.y + s.h, st.y + st.h) + 0.012), 0.55, { lang });
    add([s, st, cap]);
  };

  const selected = els.find((e) => e.id === sel) || null;
  const upd = (id: string, patch: Partial<El>) => setEls((l) => l.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const remove = (id: string) => { setEls((l) => l.filter((e) => e.id !== id)); setSel(null); };

  // Ziehen & Größe ändern
  const drag = useRef<{ id: string; mode: 'move' | 'size'; sx: number; sy: number; e: El; pw: number; ph: number } | null>(null);
  const startDrag = (e: React.PointerEvent, el: El, mode: 'move' | 'size') => {
    e.stopPropagation();
    e.preventDefault();
    const pr = pageRefs.current[el.page]!.getBoundingClientRect();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { id: el.id, mode, sx: e.clientX, sy: e.clientY, e: el, pw: pr.width, ph: pr.height };
    setSel(el.id);
  };
  const onDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / d.pw, dy = (e.clientY - d.sy) / d.ph;
    if (d.mode === 'move') upd(d.id, { x: Math.min(1 - d.e.w, Math.max(0, d.e.x + dx)), y: Math.min(1 - d.e.h, Math.max(0, d.e.y + dy)) });
    else {
      const w = Math.min(1 - d.e.x, Math.max(0.04, d.e.w + dx));
      upd(d.id, { w, h: (d.e.h * w) / d.e.w });
    }
  };
  const endDrag = () => { drag.current = null; };

  const fileName = () => {
    const base = title.replace(/\.pdf$/i, '');
    return /_(signiert|signed)$/i.test(base) ? `${base}.pdf` : `${base}_signiert.pdf`;
  };

  const build = async (): Promise<Uint8Array> => {
    if (!bytes) throw new Error('PDF nicht geladen');
    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const sig = els.some((e) => e.kind === 'signature') && assets?.signature ? await doc.embedPng(assets.signature.bytes) : null;
    const stp = els.some((e) => e.kind === 'stamp') && assets?.stamp ? await doc.embedPng(assets.stamp.bytes) : null;
    const list = doc.getPages();
    const ink = rgb(0.106, 0.165, 0.42);
    for (const el of els) {
      const p = list[el.page];
      if (!p) continue;
      const cb = p.getCropBox();
      const X = cb.x + el.x * cb.width;
      const Y = cb.y + cb.height - (el.y + el.h) * cb.height;
      const Wd = el.w * cb.width, Hd = el.h * cb.height;
      if (el.kind === 'signature' && sig) p.drawImage(sig, { x: X, y: Y, width: Wd, height: Hd });
      if (el.kind === 'stamp' && stp) p.drawImage(stp, { x: X, y: Y, width: Wd, height: Hd, opacity: 0.95 });
      if (el.kind === 'text' || el.kind === 'caption') {
        const lines = el.kind === 'caption' ? captionLines(el.lang || 'de', name, place) : (el.text || '').split('\n');
        const size = Hd / (lines.length * 1.25);
        lines.forEach((l, i) => {
          const f = el.kind === 'caption' && i < lines.length - 1 ? bold : font;
          p.drawText(toAnsi(l), { x: X, y: Y + Hd - (i + 1) * size * 1.25 + size * 0.28, size, font: f, color: el.kind === 'caption' ? ink : rgb(0.09, 0.08, 0.11) });
        });
      }
    }
    doc.setModificationDate(new Date());
    doc.setProducer('devunox AI · CRM');
    if (els.some((e) => e.kind === 'signature' || e.kind === 'stamp')) doc.setSubject(`${SIGN_LABEL.de} / ${SIGN_LABEL.en} – ${name}, ${today()}`);
    return doc.save();
  };

  const download = () => run('dl', async () => {
    const out = await build();
    const url = URL.createObjectURL(new Blob([out as BlobPart], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
  const save = () => run('sv', async () => {
    const out = await build();
    await onSave!(out, fileName());
    onClose();
  });

  const pageCss = (pi: number) => ({ aspectRatio: `${pages[pi]?.w || 595} / ${pages[pi]?.h || 842}` });

  return (
    <div className="modal-bg pdf-modal-bg">
      <div className="modal pdf-modal">
        <div className="modal-head">
          <div style={{ minWidth: 0 }}>
            <h3 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>PDF bearbeiten</h3>
            <div className="muted" style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Schließen">✕</button>
        </div>
        <div className="pdf-tools">
          <button className="btn sm primary" disabled={!assets || !pages.length} onClick={addAll}>✍ Unterschreiben & stempeln</button>
          <button className="btn sm" disabled={!assets?.signature || !pages.length} onClick={addSignature}>Unterschrift</button>
          <button className="btn sm" disabled={!assets?.stamp || !pages.length} onClick={addStamp}>Stempel</button>
          <button className="btn sm" disabled={!pages.length} onClick={addCaption}>Vermerk</button>
          <button className="btn sm" disabled={!pages.length} onClick={addText}>Text</button>
          <button className="btn sm" disabled={!pages.length} onClick={addDate}>Datum</button>
          <div className="seg lang-switch" title="Sprache des Vermerks">
            {(['de', 'en', 'both'] as Lang[]).map((l) => (
              <button key={l} className={lang === l ? 'active' : ''} onClick={() => { setLang(l); if (selected?.kind === 'caption') upd(selected.id, { lang: l, h: (selected.h / captionLines(selected.lang || 'de', name, place).length) * captionLines(l, name, place).length }); }}>{l === 'both' ? 'DE+EN' : l.toUpperCase()}</button>
            ))}
          </div>
          {selected && (
            <div className="pdf-sel">
              {selected.kind === 'text' && <button className="btn sm ghost" onClick={() => { const t = prompt('Text', selected.text || ''); if (t !== null) upd(selected.id, { text: t }); }}>✎ Text ändern</button>}
              <button className="btn sm danger" onClick={() => remove(selected.id)}>Entfernen</button>
            </div>
          )}
        </div>
        <div className="pdf-pages" ref={scroller} onPointerMove={onDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onPointerDown={() => setSel(null)}>
          {err ? <Empty title="PDF lässt sich nicht öffnen" text={err} /> : !pages.length ? <div style={{ padding: 40, display: 'grid', placeItems: 'center' }}><Spinner /></div> : pages.map((pg, pi) => (
            <div key={pi} className="pdf-page" ref={(r) => { pageRefs.current[pi] = r; }} style={pageCss(pi)}>
              <canvas ref={(r) => { canvasRefs.current[pi] = r; }} />
              {pg.rotate ? <div className="pdf-warn">Gedrehte Seite – Position bitte nach dem Speichern prüfen</div> : null}
              {els.filter((e) => e.page === pi).map((e) => (
                <div
                  key={e.id}
                  className={`pdf-el ${e.kind} ${sel === e.id ? 'on' : ''}`}
                  style={{ left: `${e.x * 100}%`, top: `${e.y * 100}%`, width: `${e.w * 100}%`, height: `${e.h * 100}%` }}
                  onPointerDown={(ev) => startDrag(ev, e, 'move')}
                >
                  {e.kind === 'signature' && assets?.signature && <img src={assets.signature.url} alt="Unterschrift" draggable={false} />}
                  {e.kind === 'stamp' && assets?.stamp && <img src={assets.stamp.url} alt="Stempel" draggable={false} />}
                  {(e.kind === 'text' || e.kind === 'caption') && <ElText el={e} lines={e.kind === 'caption' ? captionLines(e.lang || 'de', name, place) : (e.text || '').split('\n')} pageRef={pageRefs.current[pi]} />}
                  {sel === e.id && <span className="pdf-handle" onPointerDown={(ev) => startDrag(ev, e, 'size')} />}
                </div>
              ))}
              <span className="pdf-pno">{pi + 1}/{pages.length}</span>
            </div>
          ))}
        </div>
        <div className="modal-foot">
          <span className="muted" style={{ marginRight: 'auto', fontSize: 12.5 }}>{els.length ? `${els.length} Element(e) – ziehen zum Verschieben, Ecke zum Vergrößern` : 'Tippe oben auf „Unterschreiben & stempeln“. Es wird auf der sichtbaren Seite platziert.'}</span>
          <button className="btn" disabled={!!busy || !els.length} onClick={download}>{busy === 'dl' ? 'Erzeuge…' : 'Herunterladen'}</button>
          {onSave && <button className="btn primary" disabled={!!busy || !els.length} onClick={save}>{busy === 'sv' ? 'Speichere…' : 'In Ablage speichern'}</button>}
        </div>
      </div>
    </div>
  );
}

function ElText({ el, lines, pageRef }: { el: El; lines: string[]; pageRef: HTMLDivElement | null }) {
  const [ph, setPh] = useState(pageRef?.clientHeight || 0);
  useEffect(() => {
    if (!pageRef) return;
    const ro = new ResizeObserver(() => setPh(pageRef.clientHeight));
    ro.observe(pageRef);
    return () => ro.disconnect();
  }, [pageRef]);
  const size = (el.h * ph) / (lines.length * 1.25);
  return (
    <div style={{ fontSize: size, lineHeight: 1.25, fontFamily: 'Helvetica, Arial, sans-serif', color: el.kind === 'caption' ? '#1b2a6b' : '#16151d', whiteSpace: 'nowrap' }}>
      {lines.map((l, i) => <div key={i} style={{ fontWeight: el.kind === 'caption' && i < lines.length - 1 ? 700 : 400 }}>{l}</div>)}
    </div>
  );
}

// ======================================================================= Seite „PDF bearbeiten“

export function PdfPage() {
  const [assets, reloadAssets] = useSignAssets();
  const [settings] = useLoad<Record<string, string>>('/settings');
  const [companies] = useLoad<any[]>('/companies');
  const [docs, reloadDocs] = useLoad<{ files: any[] }>('/documents');
  const [v, setV] = useState<Record<string, string>>({});
  const [pad, setPad] = useState(false);
  const [target, setTarget] = useState('');
  const [open, setOpen] = useState<{ title: string; load: () => Promise<ArrayBuffer>; doc?: any } | null>(null);
  const [over, setOver] = useState(false);
  const fileIn = useRef<HTMLInputElement>(null);
  const sigIn = useRef<HTMLInputElement>(null);
  const stampIn = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const { busy, run } = useAction();

  useEffect(() => { if (settings) setV({ sign_name: settings.sign_name || '', sign_role: settings.sign_role || '', sign_place: settings.sign_place || '' }); }, [settings]);

  const recent = useMemo(() => (docs?.files || []).filter((f) => /pdf$/i.test(f.name) || f.mime === 'application/pdf').sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at))).slice(0, 12), [docs]);

  const openFile = (f: File) => {
    if (!/pdf$/i.test(f.name) && f.type !== 'application/pdf') return toast('Bitte eine PDF-Datei wählen.', 'err');
    setOpen({ title: f.name, load: () => f.arrayBuffer() });
  };

  const regenStamp = () => run('st', async () => {
    const s = await api.get<Record<string, string>>('/settings');
    await putAsset('stamp', await svgToPng(stampSvg(s), STAMP_W, STAMP_H, 2));
    reloadAssets();
  }, 'Stempel aus den Firmendaten neu erzeugt');
  const uploadAsset = (kind: Kind, f?: File) => f && run('up' + kind, async () => { await putAsset(kind, await imageFileToPng(f)); reloadAssets(); }, kind === 'stamp' ? 'Stempel gespeichert' : 'Unterschrift gespeichert');
  const reset = (kind: Kind) => run('rs' + kind, async () => { await api.del(`/sign/${kind}`); reloadAssets(); }, 'Standard wiederhergestellt');
  const saveSigner = () => run('sg', async () => { await api.put('/settings', v); }, 'Gespeichert');

  const saveTo = async (bytes: Uint8Array, name: string, doc?: any) => {
    const fd = new FormData();
    const cid = doc ? doc.company_id || '' : target;
    if (cid) fd.append('company_id', cid);
    if (doc?.project_id) fd.append('project_id', doc.project_id);
    fd.append('folder', doc ? doc.folder : '/Unterschrieben/');
    fd.append('files', new File([bytes as BlobPart], name, { type: 'application/pdf' }), name);
    fd.append('paths', name);
    const res = await fetch('/api/documents/upload', { method: 'POST', body: fd });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any).error || 'Speichern fehlgeschlagen');
    const where = doc ? `${doc.company_name || 'Meine Ablage'} · ${doc.folder}` : `${companies?.find((c) => c.id === target)?.name || 'Meine Ablage'} · /Unterschrieben/`;
    toast(`„${name}“ gespeichert in ${where}`);
    reloadDocs();
  };

  const AssetCard = ({ kind, label }: { kind: Kind; label: string }) => {
    const a = assets?.[kind];
    return (
      <div className="card">
        <div className="card-head">
          <h2>{label}</h2>
          {a && <span className={`badge ${a.custom ? 'green' : 'grey'}`}>{a.custom ? 'Eigene' : 'Standard'}</span>}
        </div>
        <div className="asset-box">{!assets ? <Spinner /> : a ? <img src={a.url} alt={label} /> : <span className="muted">Kein Bild</span>}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {kind === 'signature' ? <button className="btn sm primary" onClick={() => setPad(true)}>✍ Neu zeichnen</button> : <button className="btn sm primary" disabled={!!busy} onClick={regenStamp}>{busy === 'st' ? 'Erzeuge…' : 'Aus Firmendaten erzeugen'}</button>}
          <button className="btn sm" onClick={() => (kind === 'signature' ? sigIn : stampIn).current?.click()}>Bild hochladen</button>
          {a?.custom && <button className="btn sm ghost" onClick={() => reset(kind)}>Standard</button>}
        </div>
      </div>
    );
  };

  return (
    <>
      <PageHead title="PDF bearbeiten" sub="PDFs unterschreiben, stempeln und beschriften – mit deiner digitalen Unterschrift und dem Firmenstempel." />
      <div className="grid c2" style={{ marginBottom: 18 }}>
        <div
          className={`card drop pdf-drop ${over ? 'over' : ''}`}
          onClick={() => fileIn.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) openFile(f); }}
        >
          <span className="empty-icon" style={{ margin: 0 }}>✍</span>
          <b style={{ fontSize: 16 }}>PDF öffnen und unterschreiben</b>
          <span className="muted" style={{ fontSize: 13 }}>Datei hierher ziehen oder tippen, um sie auszuwählen</span>
          <input ref={fileIn} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) openFile(f); }} />
        </div>
        <div className="card">
          <h2 style={{ marginBottom: 12 }}>Speichern unter</h2>
          <Field label="Ablage für neue PDFs" hint="Unterschriebene Dateien landen im Ordner „Unterschrieben“.">
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Meine Ablage (ohne Kunde)</option>
              {(companies || []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.customer_no ? ` · ${c.customer_no}` : ''}</option>)}
            </select>
          </Field>
          <div className="sign-labels">
            <span className="badge orange">DE · {SIGN_LABEL.de}</span>
            <span className="badge violet">EN · {SIGN_LABEL.en}</span>
          </div>
        </div>
      </div>

      <div className="grid c3" style={{ marginBottom: 18 }}>
        <AssetCard kind="signature" label="Digitale Unterschrift" />
        <AssetCard kind="stamp" label="Firmenstempel" />
        <div className="card">
          <h2 style={{ marginBottom: 12 }}>Vermerk & Unterzeichner</h2>
          <div className="form" style={{ gridTemplateColumns: '1fr' }}>
            <Field label="Name"><input value={v.sign_name || ''} onChange={(e) => setV({ ...v, sign_name: e.target.value })} /></Field>
            <Field label="Funktion"><input value={v.sign_role || ''} onChange={(e) => setV({ ...v, sign_role: e.target.value })} placeholder="CEO · devunox AI" /></Field>
            <Field label="Ort (optional)"><input value={v.sign_place || ''} onChange={(e) => setV({ ...v, sign_place: e.target.value })} placeholder="z. B. Frankfurt am Main" /></Field>
          </div>
          <div className="sign-preview">
            {captionLines('both', v.sign_name || '', v.sign_place || '').map((l, i, a) => <div key={i} style={{ fontWeight: i < a.length - 1 ? 700 : 400 }}>{l}</div>)}
          </div>
          <button className="btn sm primary" style={{ marginTop: 12 }} disabled={!!busy} onClick={saveSigner}>Speichern</button>
        </div>
      </div>
      <input ref={sigIn} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; uploadAsset('signature', f); }} />
      <input ref={stampIn} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; uploadAsset('stamp', f); }} />

      <div className="card flush">
        <div className="card-head"><h2>PDFs aus der Ablage</h2><a className="btn sm ghost" href="#/documents">Zur Ablage →</a></div>
        {!docs ? <div style={{ padding: 20 }}><Spinner /></div> : recent.length === 0 ? <Empty title="Noch keine PDFs in der Ablage" text="Öffne oben ein PDF von deinem Gerät." /> : (
          <div className="table-wrap">
            <table>
              <tbody>
                {recent.map((f) => (
                  <tr key={f.id} className="click" onClick={() => setOpen({ title: f.name, doc: f, load: () => fetch(`/api/documents/${f.id}/file`).then((r) => { if (!r.ok) throw new Error('PDF konnte nicht geladen werden'); return r.arrayBuffer(); }) })}>
                    <td><div className="fname"><span className="ficon pdf">PDF</span><div style={{ minWidth: 0 }}><b style={{ display: 'block' }}>{f.name}</b><span className="muted" style={{ fontSize: 12 }}>{f.company_name || 'Meine Ablage'} · {f.folder}</span></div></div></td>
                    <td className="hide-m muted">{fmtDate(f.updated_at || f.created_at)}</td>
                    <td className="num"><span className="btn sm">✍ Unterschreiben</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
        Hinweis: Unterschrift und Stempel werden als Bild ins PDF gesetzt (einfache elektronische Signatur). Für Verträge, die gesetzlich Schriftform oder eine qualifizierte elektronische Signatur verlangen, reicht das nicht.
      </p>

      {pad && <SignaturePad onClose={() => setPad(false)} onSaved={reloadAssets} />}
      {open && <PdfEditor title={open.title} load={open.load} onClose={() => setOpen(null)} onSave={(b, n) => saveTo(b, n, open.doc)} />}
    </>
  );
}
