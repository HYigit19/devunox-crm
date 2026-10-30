import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
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

export type Me = { id: string; email: string; name: string; picture?: string; google: boolean; ai: boolean; model: string; scopes: string };

const NAV = [
  { path: '/', label: 'Übersicht', icon: 'M3 12l9-8 9 8M5 10v10h14V10' },
  { path: '/pipeline', label: 'Pipeline', icon: 'M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v5h-4z' },
  { path: '/companies', label: 'Firmen', icon: 'M4 21V5l8-2v18M12 9l8 2v10M8 9h.01M8 13h.01M8 17h.01M16 15h.01M16 18h.01' },
  { path: '/contacts', label: 'Kontakte', icon: 'M16 19c0-2.2-1.8-4-4-4s-4 1.8-4 4M12 12a3 3 0 100-6 3 3 0 000 6zM20 19c0-1.7-1-3-2.5-3.6M17 6.5a2.5 2.5 0 010 5' },
  { path: '/quotes', label: 'Angebote', icon: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6' },
  { path: '/import', label: 'Excel → Angebot', icon: 'M4 4h16v16H4zM4 9h16M9 4v16M13 13l3 3m0-3l-3 3' },
  { path: '/campaigns', label: 'KI-Agent', icon: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z' },
  { path: '/products', label: 'Leistungen', icon: 'M4 7l8-4 8 4-8 4zM4 7v10l8 4 8-4V7M12 11v10' },
  { path: '/settings', label: 'Einstellungen', icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-2.9-1.2l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00-1.2-2.9H3a2 2 0 110-4h.1a1.7 1.7 0 001.2-2.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 002.9-1.2V3a2 2 0 114 0v.1a1.7 1.7 0 002.9 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 001.2 2.9H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z' },
];

function Icon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function Login() {
  return (
    <div className="login">
      <div className="login-card">
        <div className="logo big">
          <span className="logo-mark">D</span> Devunox <b>CRM</b>
        </div>
        <p>Angebote, Kunden und KI-gestützte Ansprache – an einem Ort.</p>
        <a className="btn primary lg" href="/auth/login">
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
          </svg>
          Mit Google Workspace anmelden
        </a>
        <small>Zugriff nur für freigeschaltete Devunox-Konten.</small>
      </div>
    </div>
  );
}

function App() {
  const route = useRoute();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    api.get<Me>('/me').then(setMe).catch(() => setMe(null));
    const off = () => setMe(null);
    window.addEventListener('unauthenticated', off);
    return () => window.removeEventListener('unauthenticated', off);
  }, []);
  useEffect(() => setMenu(false), [route]);

  if (me === undefined)
    return (
      <div className="center-screen">
        <Spinner />
      </div>
    );
  if (me === null) return <Login />;

  const seg = route.split('/').filter(Boolean);
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
        <div className="logo">
          <span className="logo-mark">D</span> Devunox <b>CRM</b>
        </div>
        <nav>
          {NAV.map((n) => (
            <a key={n.path} href={'#' + n.path} className={active === n.path ? 'active' : ''}>
              <Icon d={n.icon} />
              {n.label}
            </a>
          ))}
        </nav>
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
          <span className="logo">
            <span className="logo-mark">D</span> Devunox <b>CRM</b>
          </span>
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
