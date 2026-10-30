import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { api } from './api';

// ---------------- Formatierung
export const fmtMoney = (n: number | null | undefined, cur = 'EUR') =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur || 'EUR', maximumFractionDigits: 0 }).format(Number(n) || 0);
export const fmtMoney2 = (n: number | null | undefined, cur = 'EUR') =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur || 'EUR' }).format(Number(n) || 0);
export const fmtDate = (s?: string | null) => {
  if (!s) return '–';
  const d = new Date(s.length === 10 ? s + 'T12:00:00' : s.includes('T') || s.includes('Z') ? s : s.replace(' ', 'T') + 'Z');
  return isNaN(+d) ? s : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
export const fmtDateTime = (s?: string | null) => {
  if (!s) return '–';
  const d = new Date(s.includes('T') || s.includes('Z') ? s : s.replace(' ', 'T') + 'Z');
  return isNaN(+d) ? s : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};
export const fullName = (c: any) => [c?.first_name, c?.last_name].filter(Boolean).join(' ') || c?.email || '–';

export const STAGES: { id: string; label: string; prob: number }[] = [
  { id: 'lead', label: 'Lead', prob: 10 },
  { id: 'qualified', label: 'Qualifiziert', prob: 25 },
  { id: 'proposal', label: 'Angebot', prob: 50 },
  { id: 'negotiation', label: 'Verhandlung', prob: 75 },
  { id: 'won', label: 'Gewonnen', prob: 100 },
  { id: 'lost', label: 'Verloren', prob: 0 },
];
export const stageLabel = (s: string) => STAGES.find((x) => x.id === s)?.label || s;

export const QUOTE_STATUS: Record<string, [string, string]> = {
  draft: ['Entwurf', 'grey'],
  sent: ['Versendet', 'blue'],
  accepted: ['Angenommen', 'green'],
  rejected: ['Abgelehnt', 'red'],
  expired: ['Abgelaufen', 'amber'],
};
export const CONSENT: Record<string, [string, string]> = {
  none: ['Keine Einwilligung', 'grey'],
  consent: ['Einwilligung', 'green'],
  customer: ['Bestandskunde', 'blue'],
  opt_out: ['Abgemeldet', 'red'],
};
export const ENR_STATUS: Record<string, [string, string]> = {
  active: ['Aktiv', 'blue'],
  replied: ['Geantwortet', 'green'],
  completed: ['Abgeschlossen', 'grey'],
  stopped: ['Gestoppt', 'amber'],
  opted_out: ['Abgemeldet', 'red'],
  error: ['Fehler', 'red'],
};
export const CAMPAIGN_STATUS: Record<string, [string, string]> = {
  draft: ['Entwurf', 'grey'],
  active: ['Läuft', 'green'],
  paused: ['Pausiert', 'amber'],
  done: ['Beendet', 'grey'],
};

export const COUNTRIES = ['DE', 'AT', 'CH', 'PL', 'US', 'GB', 'NL', 'BE', 'FR', 'IT', 'ES', 'CZ', 'SE', 'DK', 'AE', 'CA'];

// ---------------- Router
export function useRoute() {
  const [hash, setHash] = useState(window.location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => setHash(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}
export const go = (path: string) => {
  window.location.hash = path;
};

// ---------------- Daten laden
export function useLoad<T>(url: string | null, deps: unknown[] = []): [T | null, () => void, boolean, string | null] {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let off = false;
    setLoading(true);
    api
      .get<T>(url)
      .then((d) => !off && (setData(d), setErr(null)))
      .catch((e) => !off && setErr(e.message))
      .finally(() => !off && setLoading(false));
    return () => {
      off = true;
    };
  }, [url, tick, ...deps]);
  return [data, useCallback(() => setTick((t) => t + 1), []), loading, err];
}

// ---------------- Toasts
type Toast = { id: number; text: string; kind: 'ok' | 'err' };
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'err') => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, text, kind }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === 'err' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {list.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Führt eine Aktion mit Ladezustand + Fehler-Toast aus. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> => {
      setBusy(key);
      try {
        const r = await fn();
        if (okMsg) toast(okMsg);
        return r;
      } catch (e: any) {
        toast(e.message || 'Fehler', 'err');
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );
  return { busy, run };
}

// ---------------- UI-Bausteine
export function Badge({ map, value }: { map: Record<string, [string, string]>; value: string }) {
  const [label, color] = map[value] || [value, 'grey'];
  return <span className={`badge ${color}`}>{label}</span>;
}

export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Schließen">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint, span }: { label: string; children: ReactNode; hint?: string; span?: number }) {
  return (
    <label className="field" style={span ? { gridColumn: `span ${span}` } : undefined}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Empty({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">◎</div>
      <h4>{title}</h4>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function PageHead({ title, sub, actions, back }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: string }) {
  return (
    <div className="page-head">
      <div>
        {back && (
          <a className="back" href={back}>
            ← Zurück
          </a>
        )}
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      <div className="actions">{actions}</div>
    </div>
  );
}

export function Spinner() {
  return <div className="spinner" />;
}

/** Einfaches Formular-State-Hook */
export function useForm<T extends Record<string, any>>(initial: T) {
  const [v, setV] = useState<T>(initial);
  const set = (k: keyof T) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setV((o) => ({ ...o, [k]: e.target.type === 'checkbox' ? ((e.target as HTMLInputElement).checked ? 1 : 0) : e.target.value }));
  return { v, setV, set };
}

export function confirmDel(what: string) {
  return window.confirm(`${what} wirklich löschen?`);
}

export function SelectCompany({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [list] = useLoad<any[]>('/companies');
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">– keine –</option>
      {(list || []).map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

export function SelectContact({ value, onChange, companyId }: { value: string; onChange: (id: string) => void; companyId?: string }) {
  const [list] = useLoad<any[]>('/contacts');
  const filtered = (list || []).filter((c) => !companyId || c.company_id === companyId);
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">– keiner –</option>
      {filtered.map((c) => (
        <option key={c.id} value={c.id}>
          {fullName(c)}
          {c.company_name ? ` · ${c.company_name}` : ''}
        </option>
      ))}
    </select>
  );
}

// ---------------- Hell/Dunkel
export function getTheme(): 'dark' | 'light' {
  try {
    return (localStorage.getItem('dvx_theme') as 'dark' | 'light') || 'dark';
  } catch {
    return 'dark';
  }
}
export function applyTheme(t: 'dark' | 'light') {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem('dvx_theme', t);
  } catch {
    /* egal */
  }
  window.dispatchEvent(new Event('dvx-theme'));
}
export function useTheme(): ['dark' | 'light', () => void] {
  const [t, setT] = useState(getTheme());
  useEffect(() => {
    const on = () => setT(getTheme());
    window.addEventListener('dvx-theme', on);
    return () => window.removeEventListener('dvx-theme', on);
  }, []);
  return [t, () => applyTheme(t === 'dark' ? 'light' : 'dark')];
}
export const logoFor = (t: 'dark' | 'light') => (t === 'dark' ? '/brand/logo-light.png' : '/brand/logo.png');
