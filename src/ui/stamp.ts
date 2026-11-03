// Firmenstempel als SVG – wird im Browser aus den Firmendaten erzeugt (und für den Standard-Stempel einmalig vorgerendert).
// Bewusst ohne externe Schriften, damit das SVG auch als <img> zuverlässig rendert.

export type StampData = {
  company_name?: string;
  company_legal?: string;
  company_street?: string;
  company_zip?: string;
  company_city?: string;
  company_country?: string;
  company_vat_id?: string;
  company_website?: string;
  company_email?: string;
  company_phone?: string;
};

export const STAMP_INK = '#1d3a8f';
export const STAMP_W = 640;
export const STAMP_H = 300;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function stampSvg(d: StampData, ink: string = STAMP_INK): string {
  const brand = (d.company_name || 'devunox AI').trim();
  const legal = (d.company_legal || '').trim();
  const addr = [d.company_street, [d.company_zip, d.company_city].filter(Boolean).join(' ')].filter((x) => x && String(x).trim()).join(' · ');
  const contact = [d.company_website, d.company_email].filter((x) => x && String(x).trim()).join(' · ');
  const extra = [d.company_phone ? `Tel. ${d.company_phone}` : '', d.company_vat_id ? `USt-IdNr. ${d.company_vat_id}` : ''].filter(Boolean).join(' · ');
  const lines = [legal && legal.toLowerCase() !== brand.toLowerCase() ? legal : '', addr, contact, extra].filter(Boolean);

  // Marke groß, darunter bis zu vier Zeilen – Schriftgröße passt sich der Zeilenzahl an
  const brandSize = lines.length > 3 ? 62 : 70;
  const lineSize = lines.length > 3 ? 21 : 24;
  const gap = lineSize + 9;
  const blockH = brandSize + 14 + lines.length * gap;
  let y = (STAMP_H - blockH) / 2 + brandSize - 6;
  const fit = (text: string, size: number) => {
    // grobe Breitenschätzung (Helvetica ~0.56 em), damit lange Zeilen in den Rahmen passen
    const est = text.length * size * 0.56;
    return est > STAMP_W - 80 ? ` textLength="${STAMP_W - 80}" lengthAdjust="spacingAndGlyphs"` : '';
  };
  let body = `<text x="${STAMP_W / 2}" y="${y}" font-size="${brandSize}" font-weight="800" letter-spacing="-1"${fit(brand, brandSize)}>${esc(brand)}</text>`;
  y += 14;
  body += `<line x1="${STAMP_W / 2 - 150}" x2="${STAMP_W / 2 + 150}" y1="${y}" y2="${y}" stroke="${ink}" stroke-width="3"/>`;
  for (const l of lines) {
    y += gap;
    body += `<text x="${STAMP_W / 2}" y="${y - 6}" font-size="${lineSize}" font-weight="600"${fit(l, lineSize)}>${esc(l)}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${STAMP_W}" height="${STAMP_H}" viewBox="0 0 ${STAMP_W} ${STAMP_H}">
  <defs>
    <filter id="ink" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.035 0.06" numOctaves="2" seed="7" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.1 1.42" result="m"/>
      <feComposite in="SourceGraphic" in2="m" operator="in"/>
    </filter>
  </defs>
  <g filter="url(#ink)" fill="${ink}" font-family="Helvetica, Arial, sans-serif" text-anchor="middle" opacity="0.92">
    <rect x="8" y="8" width="${STAMP_W - 16}" height="${STAMP_H - 16}" rx="26" fill="none" stroke="${ink}" stroke-width="7"/>
    <rect x="22" y="22" width="${STAMP_W - 44}" height="${STAMP_H - 44}" rx="16" fill="none" stroke="${ink}" stroke-width="2.5"/>
    ${body}
  </g>
</svg>`;
}

/** SVG → PNG (im Browser) */
export async function svgToPng(svg: string, w: number, h: number, scale = 2): Promise<Blob> {
  const img = new Image();
  img.decoding = 'async';
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('Stempel konnte nicht gezeichnet werden'));
      img.src = url;
    });
    const c = document.createElement('canvas');
    c.width = w * scale;
    c.height = h * scale;
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG-Export fehlgeschlagen'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
