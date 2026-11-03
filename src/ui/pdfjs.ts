// pdf.js nur bei Bedarf laden (Vorschau, Vorschaubilder, PDF-Editor)
let lib: Promise<typeof import('pdfjs-dist')> | null = null;
export function pdfjs() {
  if (!lib)
    lib = (async () => {
      const m = await import('pdfjs-dist');
      m.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      return m;
    })();
  return lib;
}

/** Erste Seite eines PDFs als Bild (Data-URL) – für Vorschaubilder, mit Cache */
const thumbs = new Map<string, Promise<string | null>>();
let running = 0;
const queue: (() => void)[] = [];
const slot = () => new Promise<void>((r) => { if (running < 3) { running++; r(); } else queue.push(() => { running++; r(); }); });
const free = () => { running--; queue.shift()?.(); };
export function pdfThumb(url: string, width = 320): Promise<string | null> {
  if (!thumbs.has(url))
    thumbs.set(url, (async () => {
      await slot();
      try {
        const m = await pdfjs();
        const buf = await (await fetch(url)).arrayBuffer();
        const doc = await m.getDocument({ data: buf }).promise;
        const p = await doc.getPage(1);
        const base = p.getViewport({ scale: 1 });
        const vp = p.getViewport({ scale: width / base.width });
        const c = document.createElement('canvas');
        c.width = vp.width;
        c.height = vp.height;
        await p.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport: vp } as any).promise;
        (doc as any).destroy?.();
        return c.toDataURL('image/jpeg', 0.8);
      } catch {
        return null;
      } finally {
        free();
      }
    })());
  return thumbs.get(url)!;
}
