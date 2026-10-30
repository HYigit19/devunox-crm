import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { ICONS as I, Icon } from './icons';
import { api } from './api';
import { ToastProvider, useRoute, Spinner } from './components';
import { Dashboard } from './pages/Dashboard';
import { CompaniesList, CompanyDetail } from './pages/Companies';
import { ContactsList, ContactDetail } from './pages/Contacts';
import { Pipeline } from './pages/Pipeline';
import { QuotesList, QuoteEditor } from './pages/Quotes';
import { CampaignsList, CampaignDetail } from './pages/Campaigns';
import { Products } from './pages/Products';
import { Settings } from './pages/Settings';
import { ExcelImport } from './pages/ExcelImport';
import { TasksPage } from './pages/Tasks';
import { ProjectsList, ProjectDetail } from './pages/Projects';
import { DocumentsPage } from './pages/Documents';
import { TimePage, TimerBadge } from './pages/Time';

export type Me = { id: string; email: string; name: string; picture?: string; google: boolean; ai: boolean; review: boolean; review_url: string; model: string; scopes: string };

const NAV: { group: string; items: { path: string; label: string; icon: string; badge?: 'tasks' }[] }[] = [
  { group: '', items: [{ path: '/', label: 'Übersicht', icon: I.home }] },
  {
    group: 'Vertrieb',
    items: [
      { path: '/pipeline', label: 'Pipeline', icon: I.pipeline },
      { path: '/companies', label: 'Firmen', icon: I.company },
      { path: '/contacts', label: 'Kontakte', icon: I.contacts },
      { path: '/quotes', label: 'Angebote', icon: I.quote },
      { path: '/import', label: 'Excel → Angebot', icon: I.excel },
      { path: '/campaigns', label: 'KI-Agent', icon: I.agent },
    ],
  },
  {
    group: 'Umsetzung',
    items: [
      { path: '/projects', label: 'Projekte', icon: I.project },
      { path: '/tasks', label: 'Aufgaben', icon: I.tasks, badge: 'tasks' },
      { path: '/documents', label: 'Dokumente', icon: I.docs },
      { path: '/time', label: 'Zeiten', icon: I.time },
    ],
  },
  {
    group: 'System',
    items: [
      { path: '/products', label: 'Leistungen', icon: I.box },
      { path: '/settings', label: 'Einstellungen', icon: I.settings },
    ],
  },
];

function Login() {
  return (
    <div className="login">
      <div className="login-art">
        <div className="bars">
          <i style={{ width: 300, background: '#FF5A1F' }} />
          <i style={{ width: 200, background: '#F4F4F6' }} />
          <i style={{ width: 245, background: '#953A1B' }} />
        </div>
        <h2>Angebote, Kunden, Projekte und Aufgaben – in einem Werkzeug.</h2>
        <p>Mit KI-Angeboten aus Excel, Dokumentenablage je Kunde und Feedback direkt aus devunox Review.</p>
      </div>
      <div className="login-side">
        <div className="login-card">
          <img src="/brand/logo.png" alt="devunox AI" />
          <div>
            <h1 style={{ fontSize: 24 }}>Willkommen zurück</h1>
            <p style={{ marginTop: 6 }}>Melde dich mit deinem Google-Workspace-Konto an.</p>
          </div>
          <a className="btn primary lg" href="/auth/login">
            <svg width="18" height="18" viewBox="0 0 48 48">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
            </svg>
            Mit Google anmelden
          </a>
          <small>Zugriff nur für freigeschaltete devunox-Konten.</small>
        </div>
      </div>
    </div>
  );
}

function SearchBox() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const ref = React.useRef<HTMLInputElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => {
    if (q.trim().length < 2) return setRes([]);
    const tm = setTimeout(() => api.get<any[]>(`/search?q=${encodeURIComponent(q.trim())}`).then((r) => { setRes(r); setSel(0); }).catch(() => {}), 180);
    return () => clearTimeout(tm);
  }, [q]);
  const pick = (r: any) => {
    setOpen(false);
    setQ('');
    if (r.href.startsWith('#')) window.location.hash = r.href.slice(1);
    else window.open(r.href, '_blank');
  };
  return (
    <div className="searchbox">
      <Icon d={I.search} size={16} />
      <input
        ref={ref}
        placeholder="Suchen … (Strg+K)"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(x + 1, res.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(x - 1, 0)); }
          if (e.key === 'Enter' && res[sel]) pick(res[sel]);
          if (e.key === 'Escape') { setOpen(false); (e.target as HTMLInputElement).blur(); }
        }}
      />
      {open && q.trim().length >= 2 && (
        <div className="search-res">
          {res.length === 0 ? <div className="muted" style={{ padding: 12, fontSize: 13 }}>Nichts gefunden.</div> : res.map((r, i) => (
            <button key={r.type + r.id} className={i === sel ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)}>
              <span className="badge grey" style={{ fontSize: 10.5, padding: '1px 7px' }}>{r.type}</span>
              <span style={{ minWidth: 0 }}><b>{r.title}</b>{r.sub && <span className="muted"> · {r.sub}</span>}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function App() {
  const route = useRoute();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [menu, setMenu] = useState(false);
  const [counts, setCounts] = useState({ unread: 0 });

  useEffect(() => {
    api.get<Me>('/me').then(setMe).catch(() => setMe(null));
    const off = () => setMe(null);
    window.addEventListener('unauthenticated', off);
    return () => window.removeEventListener('unauthenticated', off);
  }, []);
  useEffect(() => setMenu(false), [route]);
  useEffect(() => {
    if (!me) return;
    api.get<any[]>('/tasks?open=1&limit=500').then((l) => setCounts({ unread: l.filter((t) => t.unread).length })).catch(() => {});
  }, [me, route]);

  if (me === undefined)
    return (
      <div className="center-screen">
        <Spinner />
      </div>
    );
  if (me === null) return <Login />;

  const seg = route.split('?')[0].split('/').filter(Boolean);
  let page: React.ReactNode;
  switch (seg[0]) {
    case undefined:
      page = <Dashboard me={me} />;
      break;
    case 'pipeline':
      page = <Pipeline />;
      break;
    case 'companies':
      page = seg[1] ? <CompanyDetail id={seg[1]} /> : <CompaniesList />;
      break;
    case 'contacts':
      page = seg[1] ? <ContactDetail id={seg[1]} me={me} /> : <ContactsList />;
      break;
    case 'quotes':
      page = seg[1] ? <QuoteEditor id={seg[1]} me={me} /> : <QuotesList />;
      break;
    case 'campaigns':
      page = seg[1] ? <CampaignDetail id={seg[1]} me={me} /> : <CampaignsList me={me} />;
      break;
    case 'import':
      page = <ExcelImport me={me} />;
      break;
    case 'projects':
      page = seg[1] ? <ProjectDetail id={seg[1]} me={me} /> : <ProjectsList />;
      break;
    case 'tasks':
      page = <TasksPage />;
      break;
    case 'documents':
      page = <DocumentsPage />;
      break;
    case 'time':
      page = <TimePage />;
      break;
    case 'products':
      page = <Products />;
      break;
    case 'settings':
      page = <Settings me={me} />;
      break;
    default:
      page = <div className="card">Seite nicht gefunden.</div>;
  }
  const active = '/' + (seg[0] || '');

  return (
    <div className="layout">
      <aside className={`sidebar ${menu ? 'open' : ''}`}>
        <a className="brand" href="#/">
          <img src="/brand/logo.png" alt="devunox AI" />
          <span>CRM · Angebote · Projekte</span>
        </a>
        <SearchBox />
        <TimerBadge />
        {NAV.map((g) => (
          <div key={g.group}>
            {g.group && <div className="nav-label">{g.group}</div>}
            <nav>
              {g.items.map((n) => (
                <a key={n.path} href={'#' + n.path} className={active === n.path ? 'active' : ''}>
                  <Icon d={n.icon} />
                  {n.label}
                  {n.badge === 'tasks' && counts.unread > 0 && <span className="count">{counts.unread}</span>}
                </a>
              ))}
            </nav>
          </div>
        ))}
        <div className="spacer" />
        <div className="me">
          {me.picture ? <img src={me.picture} alt="" referrerPolicy="no-referrer" /> : <div className="avatar">{(me.name || me.email)[0]}</div>}
          <div>
            <div className="me-name">{me.name || me.email}</div>
            <a href="/auth/logout">Abmelden</a>
          </div>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <button className="icon-btn" onClick={() => setMenu(!menu)} aria-label="Menü">
            ☰
          </button>
          <img src="/brand/logo.png" alt="devunox AI" />
        </div>
        {!me.google && (
          <div className="banner warn">
            Google ist nicht verbunden – Mail-Versand, Kalender und Drive sind deaktiviert. <a href="/auth/login">Jetzt verbinden</a>
          </div>
        )}
        <main className="content">{page}</main>
      </div>
      {menu && <div className="scrim" onClick={() => setMenu(false)} />}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <ToastProvider>
    <App />
  </ToastProvider>,
);
