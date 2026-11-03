/* devunox Review – Portal für devunox und Kunden
   Routen (Hash): #/login, #/link/<token>, #/forgot, #/, #/p/<slug>, #/p/<slug>/i/<id>, #/p/<slug>/einstellungen, #/kunden, #/konto */
(() => {
  "use strict";

  /* ------------------------------------------------------------ Texte */
  const TX = {
    de: {
      appName: "Review", login: "Anmelden", email: "E-Mail", password: "Passwort", remember: "Angemeldet bleiben", forgot: "Passwort vergessen?",
      loginTitle: "Willkommen zurück", loginSub: "Melde dich an, um Feedback zu deinen Projekten zu sehen und zu geben.",
      artTitle: "Feedback genau dort, wo es hingehört.", artText: "Kunden setzen Pins direkt in der laufenden App, hängen Bilder und Dokumente an und sehen, wann ihre Punkte umgesetzt sind.",
      forgotTitle: "Passwort zurücksetzen", forgotSub: "Für devunox-Konten schicken wir einen Link per E-Mail. Als Kunde bekommst du einen neuen Zugangslink von deinem Ansprechpartner bei devunox.",
      forgotSend: "Link anfordern", forgotDone: "Wenn das Konto existiert, ist der Link unterwegs. Bitte prüfe dein Postfach.", backToLogin: "Zurück zur Anmeldung",
      linkInvite: "Zugang einrichten", linkReset: "Neues Passwort setzen", linkSub: "Lege dein Passwort fest (mindestens 10 Zeichen). Danach bist du direkt angemeldet.",
      newPassword: "Neues Passwort", repeatPassword: "Passwort wiederholen", savePassword: "Passwort speichern", mismatch: "Die Passwörter stimmen nicht überein.",
      mustTitle: "Eigenes Passwort festlegen", mustSub: "Du bist mit einem Einmalpasswort angemeldet. Lege jetzt dein eigenes Passwort fest.", currentPassword: "Aktuelles Passwort",
      projects: "Projekte", clients: "Kunden", account: "Konto", logout: "Abmelden", menu: "Menü",
      projectsSubAdmin: "Alle Kundenprojekte mit offenem Feedback.", projectsSubClient: "Deine Projekte bei devunox.",
      newProject: "Neues Projekt", newClient: "Neuer Kunde", noProjectsTitle: "Noch keine Projekte", noProjectsAdmin: "Lege zuerst einen Kunden an und dann ein Projekt mit der Adresse der App.", noProjectsClient: "Sobald devunox dein Projekt freigeschaltet hat, erscheint es hier.",
      lastActivity: "Zuletzt aktiv", unreadN: "neu",
      board: "Board", list: "Liste", settings: "Einstellungen", openApp: "App öffnen und kommentieren", repo: "Repository", newTask: "Aufgabe",
      search: "Suchen", allCats: "Alle Arten", allKinds: "Feedback und Aufgaben", onlyFeedback: "Nur Feedback", onlyTasks: "Nur Aufgaben",
      emptyCol: "Nichts hier", emptyList: "Keine Einträge für diese Filter.",
      noFeedbackTitle: "Noch kein Feedback", noFeedbackClient: "Öffne die App, tippe rechts auf „Feedback“ und setze einen Pin an die Stelle, zu der du etwas sagen möchtest.", noFeedbackAdmin: "Öffne die App mit Feedback oder lege eine Aufgabe an.",
      st: { offen: "Offen", in_arbeit: "In Arbeit", pruefen: "Bitte prüfen", erledigt: "Erledigt", abgelehnt: "Wird nicht umgesetzt" },
      col: { offen: "Offen", in_arbeit: "In Arbeit", pruefen: "Bitte prüfen", erledigt: "Erledigt" },
      cat: { fehler: "Fehler", design: "Design", funktion: "Funktion", text: "Text", idee: "Idee" },
      prio: { hoch: "Hoch", mittel: "Mittel", niedrig: "Niedrig" },
      kind: { feedback: "Feedback", todo: "Aufgabe" },
      th: { no: "Nr.", title: "Titel", status: "Status", cat: "Art", prio: "Wichtigkeit", author: "Von", page: "Seite", act: "Aktivität" },
      status: "Status", category: "Art", priority: "Wichtigkeit", internal: "Nur intern (Kunde sieht das nicht)", due: "Fällig am", title: "Titel", description: "Beschreibung",
      viewInApp: "In der App ansehen", page: "Seite", device: "Gerät", created: "Erstellt", by: "von", you: "Du",
      crTitle: "Mehraufwand – bitte freigeben", crHint: "Dieser Wunsch geht über den vereinbarten Umfang hinaus. Wir setzen ihn um, sobald du freigibst.", crDays: "Aufwand", crAmount: "Preis (netto)", crApprove: "Freigeben", crDecline: "Ablehnen", crApproved: "Mehraufwand freigegeben", crDeclined: "Mehraufwand abgelehnt", crNoRight: "Die Freigabe erfolgt bei euch durch eine berechtigte Person.", crDays1: "Personentage",
      pruefenHint: "Wir haben das umgesetzt. Bitte prüfe es in der App und gib uns Bescheid.", approve: "Passt so – erledigt", notYet: "Noch nicht in Ordnung", reopen: "Wieder öffnen",
      notYetPh: "Was fehlt noch?", sendNote: "Zurück an devunox", statusSet: "hat den Status geändert auf",
      replyPh: "Antwort schreiben … (Dateien hierher ziehen oder einfügen)", reply: "Antworten", attach: "Datei anhängen", delete: "Löschen", confirmDelete: "Diesen Eintrag mit allen Antworten und Dateien löschen?",
      close: "Schließen", cancel: "Abbrechen", save: "Speichern", saved: "Gespeichert", create: "Anlegen", copy: "Kopieren", copied: "Kopiert",
      taskTitle: "Neue Aufgabe", taskSub: "Eigene To-dos für dieses Projekt. Intern markierte Aufgaben sieht der Kunde nicht.",
      clientTitle: "Neuer Kunde", clientSub: "Pro Kunde kommentiert eine Person. Sie bekommt einen Einladungslink und sieht nur die Projekte dieses Kunden.",
      company: "Firma", contactName: "Ansprechperson", contactEmail: "E-Mail der Ansprechperson", language: "Sprache", firstProject: "Erstes Projekt (optional)",
      projectName: "Projektname", appUrl: "Adresse der App", appUrlHint: "Die deployte Demo, z. B. https://geoauftrag.pages.dev", repoUrl: "GitHub-Repository",
      projectTitle: "Neues Projekt", projectSub: "Ein Projekt ist eine App eines Kunden. Danach bekommst du den Code-Schnipsel für die App.", client: "Kunde", chooseClient: "Kunde wählen",
      inviteTitle: "Einladungslink", inviteSub: "Schicke diesen Link an die Ansprechperson. Damit legt sie ihr Passwort fest. Der Link ist 14 Tage gültig und funktioniert nur einmal.",
      resetTitle: "Neuer Zugangslink", resetSub: "Mit diesem Link setzt die Ansprechperson ein neues Passwort. Er ist 3 Tage gültig und funktioniert nur einmal.",
      embedTitle: "Widget in die App einbauen", embedSub: "Diese Zeile kommt in die index.html der App, direkt vor </body>. Normale Besucher sehen nichts – das Widget erscheint nur mit Feedback-Zugang.",
      newLink: "Zugangslink erzeugen", deactivate: "Zugang sperren", activate: "Zugang freigeben", invited: "Eingeladen", active: "Aktiv", inactive: "Gesperrt", never: "noch nie",
      lastLogin: "Letzte Anmeldung", projectsN: "Projekte", edit: "Bearbeiten", editClient: "Kunde bearbeiten",
      projectSettings: "Projekt", projectStatus: "Projektstatus", stActive: "Aktiv", stDone: "Abgeschlossen", access: "Zugang des Kunden",
      accountTitle: "Konto", profile: "Profil", name: "Name", changePassword: "Passwort ändern", passwordChanged: "Passwort geändert.",
      noAppUrl: "Für dieses Projekt fehlt noch die Adresse der App (Einstellungen).", errGeneric: "Das hat nicht geklappt. Bitte erneut versuchen.",
      tooBig: "ist größer als 25 MB.", devices: { mobile: "Handy", tablet: "Tablet", desktop: "PC" }, approx: "Ausschnitt um den Pin", screenshot: "Screenshot",
      teamName: "devunox", taskBadge: "Aufgabe", internalBadge: "Intern", clientsSub: "Firmen und ihre Ansprechperson für Feedback.",
      noClients: "Noch keine Kunden angelegt.", files: "Dateien",
    },
    en: {
      appName: "Review", login: "Sign in", email: "Email", password: "Password", remember: "Keep me signed in", forgot: "Forgot password?",
      loginTitle: "Welcome back", loginSub: "Sign in to see and give feedback on your projects.",
      artTitle: "Feedback right where it belongs.", artText: "Clients drop pins straight into the running app, attach images and documents, and see when their points are done.",
      forgotTitle: "Reset password", forgotSub: "For devunox accounts we email you a link. As a client, your devunox contact will send you a new access link.",
      forgotSend: "Send link", forgotDone: "If the account exists, the link is on its way. Please check your inbox.", backToLogin: "Back to sign in",
      linkInvite: "Set up your access", linkReset: "Set a new password", linkSub: "Choose your password (at least 10 characters). You'll be signed in right after.",
      newPassword: "New password", repeatPassword: "Repeat password", savePassword: "Save password", mismatch: "The passwords don't match.",
      mustTitle: "Choose your own password", mustSub: "You signed in with a one-time password. Please choose your own password now.", currentPassword: "Current password",
      projects: "Projects", clients: "Clients", account: "Account", logout: "Sign out", menu: "Menu",
      projectsSubAdmin: "All client projects with open feedback.", projectsSubClient: "Your projects with devunox.",
      newProject: "New project", newClient: "New client", noProjectsTitle: "No projects yet", noProjectsAdmin: "Add a client first, then a project with the app's address.", noProjectsClient: "Your project will appear here once devunox has set it up.",
      lastActivity: "Last activity", unreadN: "new",
      board: "Board", list: "List", settings: "Settings", openApp: "Open app and comment", repo: "Repository", newTask: "Task",
      search: "Search", allCats: "All types", allKinds: "Feedback and tasks", onlyFeedback: "Feedback only", onlyTasks: "Tasks only",
      emptyCol: "Nothing here", emptyList: "No entries for these filters.",
      noFeedbackTitle: "No feedback yet", noFeedbackClient: "Open the app, tap “Feedback” on the right and drop a pin where you want to comment.", noFeedbackAdmin: "Open the app with feedback or add a task.",
      st: { offen: "Open", in_arbeit: "In progress", pruefen: "Please review", erledigt: "Done", abgelehnt: "Won't do" },
      col: { offen: "Open", in_arbeit: "In progress", pruefen: "Please review", erledigt: "Done" },
      cat: { fehler: "Bug", design: "Design", funktion: "Feature", text: "Text", idee: "Idea" },
      prio: { hoch: "High", mittel: "Medium", niedrig: "Low" },
      kind: { feedback: "Feedback", todo: "Task" },
      th: { no: "No.", title: "Title", status: "Status", cat: "Type", prio: "Priority", author: "By", page: "Page", act: "Activity" },
      status: "Status", category: "Type", priority: "Priority", internal: "Internal only (client won't see it)", due: "Due", title: "Title", description: "Description",
      viewInApp: "View in app", page: "Page", device: "Device", created: "Created", by: "by", you: "You",
      crTitle: "Additional effort – please approve", crHint: "This request goes beyond the agreed scope. We'll implement it once you approve.", crDays: "Effort", crAmount: "Price (net)", crApprove: "Approve", crDecline: "Decline", crApproved: "Additional effort approved", crDeclined: "Additional effort declined", crNoRight: "Approval is given by an authorised person on your side.", crDays1: "person-days",
      pruefenHint: "We've made this change. Please check it in the app and let us know.", approve: "Looks good – done", notYet: "Not right yet", reopen: "Reopen",
      notYetPh: "What is still missing?", sendNote: "Send back to devunox", statusSet: "changed the status to",
      replyPh: "Write a reply … (drop or paste files here)", reply: "Reply", attach: "Attach file", delete: "Delete", confirmDelete: "Delete this entry with all replies and files?",
      close: "Close", cancel: "Cancel", save: "Save", saved: "Saved", create: "Create", copy: "Copy", copied: "Copied",
      taskTitle: "New task", taskSub: "Your own to-dos for this project. Tasks marked internal are hidden from the client.",
      clientTitle: "New client", clientSub: "One person comments per client. They get an invite link and only see this client's projects.",
      company: "Company", contactName: "Contact person", contactEmail: "Contact email", language: "Language", firstProject: "First project (optional)",
      projectName: "Project name", appUrl: "App address", appUrlHint: "The deployed demo, e.g. https://geoauftrag.pages.dev", repoUrl: "GitHub repository",
      projectTitle: "New project", projectSub: "A project is one app for a client. You'll get the code snippet for the app afterwards.", client: "Client", chooseClient: "Choose client",
      inviteTitle: "Invite link", inviteSub: "Send this link to the contact person to set their password. It's valid for 14 days and works once.",
      resetTitle: "New access link", resetSub: "With this link the contact sets a new password. It's valid for 3 days and works once.",
      embedTitle: "Add the widget to the app", embedSub: "Put this line in the app's index.html right before </body>. Regular visitors see nothing – the widget only appears with feedback access.",
      newLink: "Create access link", deactivate: "Block access", activate: "Allow access", invited: "Invited", active: "Active", inactive: "Blocked", never: "never",
      lastLogin: "Last sign-in", projectsN: "Projects", edit: "Edit", editClient: "Edit client",
      projectSettings: "Project", projectStatus: "Project status", stActive: "Active", stDone: "Completed", access: "Client access",
      accountTitle: "Account", profile: "Profile", name: "Name", changePassword: "Change password", passwordChanged: "Password changed.",
      noAppUrl: "This project has no app address yet (Settings).", errGeneric: "That didn't work. Please try again.",
      tooBig: "is larger than 25 MB.", devices: { mobile: "Phone", tablet: "Tablet", desktop: "Desktop" }, approx: "Area around the pin", screenshot: "Screenshot",
      teamName: "devunox", taskBadge: "Task", internalBadge: "Internal", clientsSub: "Companies and their feedback contact.",
      noClients: "No clients yet.", files: "Files",
    },
  };
  let lang = (() => { try { return localStorage.getItem("dvx_lang") || (navigator.language || "de").slice(0, 2); } catch { return "de"; } })() === "en" ? "en" : "de";
  const t = (k) => TX[lang][k] ?? TX.de[k] ?? k;
  const tt = (group, k) => (TX[lang][group] || {})[k] ?? k;

  /* ------------------------------------------------------------ Zustand & Hilfen */
  const S = { user: null, projects: [], clients: null, project: null, items: [], item: null, view: "board", f: { q: "", cat: "", kind: "" }, busy: false, notYet: false };
  const app = document.getElementById("app");
  const modal = document.getElementById("modal");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const initials = (n) => String(n || "?").split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase();
  const fmt = (iso, withTime = true) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleString(lang === "de" ? "de-DE" : "en-GB", withTime ? { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit", year: "numeric" });
    } catch { return ""; }
  };
  const ago = (iso) => {
    if (!iso) return "";
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
    if (s < 60) return rtf.format(0, "minute");
    if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
    if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
    if (s < 86400 * 30) return rtf.format(-Math.round(s / 86400), "day");
    return fmt(iso, false);
  };
  const size = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
  const isAdmin = () => S.user && S.user.role === "admin";
  // Titel = erste Zeile der Beschreibung → im Detail nur den Rest zeigen
  const restBody = (it) => {
    const b = String(it.body || "");
    const nl = b.indexOf("\n");
    const first = (nl < 0 ? b : b.slice(0, nl)).trim();
    return first === it.title ? (nl < 0 ? "" : b.slice(nl + 1).trim()) : b;
  };

  async function api(path, opts = {}) {
    const headers = {};
    let body = opts.body;
    if (body && !(body instanceof FormData)) { headers["Content-Type"] = "application/json"; body = JSON.stringify(body); }
    const res = await fetch(path, { method: opts.method || "GET", headers, body, credentials: "same-origin" });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      if (res.status === 401 && !opts.quiet401) { S.user = null; go("#/login"); }
      if (data.code === "must_change" && S.user) { S.user.must_change = true; route(); }
      const e = new Error(data.error || t("errGeneric"));
      e.status = res.status; e.code = data.code;
      throw e;
    }
    return data;
  }

  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.hidden = true), 3200);
  }
  const go = (h) => { if (location.hash === h) route(); else location.hash = h; };

  const svg = (p, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const I = {
    grid: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
    users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>'),
    user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    ext: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
    git: svg('<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 8.5v7M18 10.5c0 4-6 3-10.5 6"/>'),
    msg: svg('<path d="M4 5h16v11H9l-5 4z"/>', 14),
    clip: svg('<path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7-7L14 4.5a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/>'),
    file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.8-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15.5H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.8-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.8 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.8H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5.9z"/>'),
    task: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    flag: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>', 14),
  };

  /* ------------------------------------------------------------ Router */
  async function boot() {
    try { S.user = (await api("/api/session", { quiet401: true })).user; } catch {}
    if (S.user) setLang(S.user.lang, false);
    window.addEventListener("hashchange", route);
    route();
  }

  function setLang(l, persist = true) {
    lang = l === "en" ? "en" : "de";
    document.documentElement.lang = lang;
    try { localStorage.setItem("dvx_lang", lang); } catch {}
    if (persist && S.user) api("/api/me", { method: "PATCH", body: { lang } }).catch(() => {});
  }

  async function route() {
    const h = location.hash.replace(/^#/, "") || "/";
    const parts = h.split("/").filter(Boolean);
    closeModal();
    if (parts[0] === "link" && parts[1]) return pageLink(parts[1]);
    if (parts[0] === "forgot") return pageForgot();
    if (!S.user) return pageLogin();
    if (S.user.must_change) return pageMustChange();
    if (parts[0] === "login") return go("#/");
    if (parts[0] === "kunden" && isAdmin()) return pageClients();
    if (parts[0] === "konto") return pageAccount();
    if (parts[0] === "p" && parts[1]) return pageProject(parts[1], parts[2], parts[3]);
    return pageProjects();
  }

  /* ------------------------------------------------------------ Anmelden */
  function authLayout(inner) {
    // Kleiner Korrekturabzug mit Pins als Motiv
    app.innerHTML = `<div class="auth">
      <section class="auth-art" aria-hidden="true">
        <span class="brand"><span class="logo"></span>devunox <b>${esc(t("appName"))}</b></span>
        <div>
          <div class="proof">
            <i class="bar"></i><i style="width:72%"></i><i style="width:55%"></i>
            <div class="row" style="gap:12px;margin-top:18px"><i class="card grow"></i><i class="card grow"></i><i class="card grow"></i></div>
            <i style="width:64%;margin-top:18px"></i><i style="width:38%"></i>
            <span class="pin s-offen" style="left:46%;top:13%">1</span>
            <span class="pin s-pruefen" style="left:71%;top:52%">2</span>
            <span class="pin s-erledigt" style="left:18%;top:78%">3</span>
          </div>
          <h1>${esc(t("artTitle"))}</h1>
          <p>${esc(t("artText"))}</p>
        </div>
        <div class="row small muted">${langSwitch()}</div>
      </section>
      <section class="auth-form"><div class="auth-box">${inner}</div></section>
    </div>`;
  }
  const langSwitch = () => `<div class="seg" role="group" aria-label="Sprache / Language"><button data-act="lang" data-lang="de" class="${lang === "de" ? "on" : ""}">DE</button><button data-act="lang" data-lang="en" class="${lang === "en" ? "on" : ""}">EN</button></div>`;

  function pageLogin() {
    authLayout(`
      <h2>${esc(t("loginTitle"))}</h2><p class="muted">${esc(t("loginSub"))}</p>
      <form data-form="login">
        <div class="err" hidden></div>
        <label class="field"><span>${esc(t("email"))}</span><input type="email" name="email" autocomplete="username" required autofocus></label>
        <label class="field"><span>${esc(t("password"))}</span><input type="password" name="password" autocomplete="current-password" required></label>
        <div class="row" style="justify-content:space-between;margin:-2px 0 18px"><label class="check small"><input type="checkbox" name="remember" checked> ${esc(t("remember"))}</label><a href="#/forgot" class="small">${esc(t("forgot"))}</a></div>
        <button class="btn primary wide">${esc(t("login"))}</button>
      </form>`);
  }

  function pageForgot() {
    authLayout(`
      <h2>${esc(t("forgotTitle"))}</h2><p class="muted">${esc(t("forgotSub"))}</p>
      <form data-form="forgot">
        <label class="field"><span>${esc(t("email"))}</span><input type="email" name="email" required autofocus></label>
        <button class="btn primary wide">${esc(t("forgotSend"))}</button>
        <p class="small" style="margin-top:16px"><a href="#/login">${esc(t("backToLogin"))}</a></p>
      </form>`);
  }

  async function pageLink(token) {
    authLayout(`<p class="muted">…</p>`);
    try {
      const info = await api(`/api/link/${encodeURIComponent(token)}`, { quiet401: true });
      if (!S.user) setLang(info.lang, false);
      authLayout(`
        <h2>${esc(info.purpose === "invite" ? t("linkInvite") : t("linkReset"))}</h2>
        <p class="muted">${esc(info.name)} · ${esc(info.email)}<br>${esc(t("linkSub"))}</p>
        <form data-form="link" data-token="${esc(token)}">
          <div class="err" hidden></div>
          <input type="email" name="email" value="${esc(info.email)}" autocomplete="username" hidden>
          <label class="field"><span>${esc(t("newPassword"))}</span><input type="password" name="password" minlength="10" autocomplete="new-password" required autofocus></label>
          <label class="field"><span>${esc(t("repeatPassword"))}</span><input type="password" name="password2" minlength="10" autocomplete="new-password" required></label>
          <button class="btn primary wide">${esc(t("savePassword"))}</button>
        </form>`);
    } catch (e) {
      authLayout(`<h2>${esc(t("linkReset"))}</h2><div class="err">${esc(e.message)}</div><p class="small"><a href="#/login">${esc(t("backToLogin"))}</a></p>`);
    }
  }

  function pageMustChange() {
    authLayout(`
      <h2>${esc(t("mustTitle"))}</h2><p class="muted">${esc(t("mustSub"))}</p>
      <form data-form="password" data-must="1">
        <div class="err" hidden></div>
        <label class="field"><span>${esc(t("currentPassword"))}</span><input type="password" name="current" autocomplete="current-password" required></label>
        <label class="field"><span>${esc(t("newPassword"))}</span><input type="password" name="next" minlength="10" autocomplete="new-password" required></label>
        <label class="field"><span>${esc(t("repeatPassword"))}</span><input type="password" name="next2" minlength="10" autocomplete="new-password" required></label>
        <button class="btn primary wide">${esc(t("savePassword"))}</button>
      </form>`);
  }

  /* ------------------------------------------------------------ Rahmen */
  function shell(active, inner) {
    const unread = (p) => p.n_unread ? `<span class="dot" title="${p.n_unread} ${esc(t("unreadN"))}"></span>` : `<span class="n">${p.n_offen + p.n_in_arbeit + p.n_pruefen || ""}</span>`;
    app.innerHTML = `<div class="shell">
      <aside class="side">
        <a class="brand" href="#/"><span class="logo"></span>devunox <b>${esc(t("appName"))}</b></a>
        <nav class="nav">
          <a href="#/" class="${active === "projects" ? "on" : ""}">${I.grid}${esc(t("projects"))}</a>
          ${isAdmin() ? `<a href="#/kunden" class="${active === "clients" ? "on" : ""}">${I.users}${esc(t("clients"))}</a>` : ""}
          <a href="#/konto" class="${active === "account" ? "on" : ""}">${I.user}${esc(t("account"))}</a>
        </nav>
        <div class="projects nav">
          ${S.projects.length ? `<h4>${esc(t("projects"))}</h4>` : ""}
          ${S.projects.map((p) => `<a href="#/p/${esc(p.slug)}" class="${S.project && S.project.slug === p.slug && active === "project" ? "on" : ""}"><span class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</span>${unread(p)}</a>`).join("")}
        </div>
        <div class="me"><span class="avatar ${isAdmin() ? "team" : ""}">${esc(initials(S.user.name))}</span><span class="grow" style="overflow:hidden"><b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(S.user.name)}</b><button class="btn ghost small" style="padding:0;height:auto" data-act="logout">${esc(t("logout"))}</button></span></div>
      </aside>
      <div>
        <div class="topbar"><button class="iconbtn" data-act="menu" aria-label="${esc(t("menu"))}">${I.menu}</button><a class="brand" href="#/"><span class="logo"></span>devunox <b>${esc(t("appName"))}</b></a></div>
        <main class="main" id="main">${inner}</main>
      </div>
    </div>`;
  }

  async function loadProjects() {
    S.projects = (await api("/api/projects")).projects;
  }

  /* ------------------------------------------------------------ Projekte */
  async function pageProjects() {
    S.project = null;
    try { await loadProjects(); } catch { return; }
    if (!isAdmin() && S.projects.length === 1) return go(`#/p/${S.projects[0].slug}`);
    const card = (p) => {
      const total = p.n_offen + p.n_in_arbeit + p.n_pruefen + p.n_fertig;
      const seg = (n, s) => (n ? `<span class="s-${s}" style="flex:${n}"></span>` : "");
      return `<a class="pcard" href="#/p/${esc(p.slug)}">
        <div><div class="client">${esc(p.client_name)}${p.status === "abgeschlossen" ? ` · ${esc(t("stDone"))}` : ""}</div><h3>${esc(p.name)}</h3></div>
        <div class="stack">${total ? seg(p.n_offen, "offen") + seg(p.n_in_arbeit, "in_arbeit") + seg(p.n_pruefen, "pruefen") + seg(p.n_fertig, "erledigt") : ""}</div>
        <div class="legend"><span class="s-offen"><b>${p.n_offen}</b>${esc(tt("st", "offen"))}</span><span class="s-in_arbeit"><b>${p.n_in_arbeit}</b>${esc(tt("st", "in_arbeit"))}</span><span class="s-pruefen"><b>${p.n_pruefen}</b>${esc(tt("st", "pruefen"))}</span><span class="s-erledigt"><b>${p.n_fertig}</b>${esc(tt("st", "erledigt"))}</span></div>
        <div class="foot">${p.n_unread ? `<span class="dot"></span><b style="color:var(--blue)">${p.n_unread} ${esc(t("unreadN"))}</b>` : ""}<span class="grow"></span>${p.last_activity_at ? `${esc(t("lastActivity"))} ${esc(ago(p.last_activity_at))}` : ""}</div>
      </a>`;
    };
    shell("projects", `
      <div class="pagehead"><div><h1>${esc(t("projects"))}</h1><div class="sub">${esc(isAdmin() ? t("projectsSubAdmin") : t("projectsSubClient"))}</div></div>
        ${isAdmin() ? `<div class="acts"><button class="btn" data-act="new-client">${I.plus}${esc(t("newClient"))}</button><button class="btn primary" data-act="new-project">${I.plus}${esc(t("newProject"))}</button></div>` : ""}</div>
      ${S.projects.length ? `<div class="cards">${S.projects.map(card).join("")}</div>` :
        `<div class="empty"><h3>${esc(t("noProjectsTitle"))}</h3><p>${esc(isAdmin() ? t("noProjectsAdmin") : t("noProjectsClient"))}</p>${isAdmin() ? `<button class="btn primary" data-act="new-client">${I.plus}${esc(t("newClient"))}</button>` : ""}</div>`}`);
  }

  /* ------------------------------------------------------------ Projekt */
  async function pageProject(slug, sub, subId) {
    try {
      if (!S.projects.length || !S.projects.some((p) => p.slug === slug)) await loadProjects();
      if (!S.project || S.project.slug !== slug || !sub) {
        const [p, it] = await Promise.all([api(`/api/projects/${slug}`), api(`/api/projects/${slug}/items`)]);
        S.project = p.project;
        S.items = it.items;
      }
    } catch (e) {
      shell("project", `<div class="empty"><h3>${esc(e.message)}</h3><a class="btn" href="#/">${esc(t("projects"))}</a></div>`);
      return;
    }
    const tab = sub === "einstellungen" && isAdmin() ? "settings" : "board";
    const p = S.project;
    shell("project", `
      <div class="pagehead">
        <div class="grow"><div class="sub" style="margin:0 0 4px">${esc(p.client_name)}</div><h1>${esc(p.name)}</h1></div>
        <div class="acts">
          ${isAdmin() && p.repo_url ? `<a class="btn" href="${esc(p.repo_url)}" target="_blank" rel="noopener">${I.git}<span class="hide-m">${esc(t("repo"))}</span></a>` : ""}
          ${isAdmin() ? `<button class="btn" data-act="new-task">${I.plus}${esc(t("newTask"))}</button>` : ""}
          <button class="btn primary" data-act="open-app">${I.ext}${esc(t("openApp"))}</button>
        </div>
      </div>
      ${isAdmin() ? `<nav class="tabs"><a href="#/p/${esc(p.slug)}" class="${tab === "board" ? "on" : ""}">${esc(t("board"))}</a><a href="#/p/${esc(p.slug)}/einstellungen" class="${tab === "settings" ? "on" : ""}">${esc(t("settings"))}</a></nav>` : ""}
      <div id="pbody"></div>`);
    if (tab === "settings") return renderSettings();
    renderBoard();
    if (sub === "i" && subId) openItem(Number(subId));
    else closeDrawer();
  }

  function filtered() {
    const q = S.f.q.trim().toLowerCase();
    return S.items.filter((i) =>
      (!S.f.cat || i.category === S.f.cat) &&
      (!S.f.kind || i.kind === S.f.kind) &&
      (!q || `#${i.no} ${i.title} ${i.body} ${i.author_name || ""} ${i.page_title}`.toLowerCase().includes(q)));
  }

  function renderBoard() {
    const el = document.getElementById("pbody");
    if (!el) return;
    if (!S.items.length) {
      el.innerHTML = `<div class="empty"><h3>${esc(t("noFeedbackTitle"))}</h3><p>${esc(isAdmin() ? t("noFeedbackAdmin") : t("noFeedbackClient"))}</p><button class="btn primary" data-act="open-app">${I.ext}${esc(t("openApp"))}</button></div>`;
      return;
    }
    const items = filtered();
    const filters = `<div class="filters">
      <input type="search" placeholder="${esc(t("search"))}" value="${esc(S.f.q)}" data-filter="q" aria-label="${esc(t("search"))}">
      <select data-filter="cat" aria-label="${esc(t("category"))}"><option value="">${esc(t("allCats"))}</option>${Object.keys(TX.de.cat).map((c) => `<option value="${c}" ${S.f.cat === c ? "selected" : ""}>${esc(tt("cat", c))}</option>`).join("")}</select>
      ${isAdmin() ? `<select data-filter="kind" aria-label="Typ"><option value="">${esc(t("allKinds"))}</option><option value="feedback" ${S.f.kind === "feedback" ? "selected" : ""}>${esc(t("onlyFeedback"))}</option><option value="todo" ${S.f.kind === "todo" ? "selected" : ""}>${esc(t("onlyTasks"))}</option></select>` : ""}
      <span class="grow"></span>
      <div class="seg" role="group"><button data-act="view" data-view="board" class="${S.view === "board" ? "on" : ""}">${esc(t("board"))}</button><button data-act="view" data-view="list" class="${S.view === "list" ? "on" : ""}">${esc(t("list"))}</button></div>
    </div>`;
    if (S.view === "list") {
      el.innerHTML = filters + (items.length ? `<div class="table"><table>
        <thead><tr><th>${esc(tt("th", "no"))}</th><th>${esc(tt("th", "title"))}</th><th>${esc(tt("th", "status"))}</th><th class="hide-m">${esc(tt("th", "cat"))}</th><th class="hide-m">${esc(tt("th", "prio"))}</th><th class="hide-m">${esc(tt("th", "author"))}</th><th class="hide-m">${esc(tt("th", "act"))}</th></tr></thead>
        <tbody>${items.map((i) => `<tr data-act="open" data-id="${i.id}" tabindex="0">
          <td class="nowrap">${i.kind === "todo" ? `<span class="todo-mark" style="display:inline-grid">${I.task}</span>` : `<span class="pin s-${i.status}">${i.no}</span>`}</td>
          <td><span class="t">${esc(i.title)}</span> ${i.unread ? '<span class="dot"></span>' : ""} ${i.internal ? `<span class="chip">${esc(t("internalBadge"))}</span>` : ""}</td>
          <td class="nowrap"><span class="chip st s-${i.status}">${esc(tt("st", i.status))}</span></td>
          <td class="hide-m">${esc(tt("cat", i.category))}</td><td class="hide-m">${esc(tt("prio", i.priority))}</td>
          <td class="hide-m">${esc(i.author_name || "")}</td><td class="hide-m nowrap muted">${esc(ago(i.last_activity_at))}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">${esc(t("emptyList"))}</div>`);
      return;
    }
    const cols = ["offen", "in_arbeit", "pruefen", "erledigt"];
    const inCol = (c) => items.filter((i) => (c === "erledigt" ? ["erledigt", "abgelehnt"].includes(i.status) : i.status === c));
    el.innerHTML = filters + `<div class="board">${cols.map((c) => {
      const list = inCol(c);
      return `<section class="col s-${c}" data-col="${c}"><div class="colhead">${esc(tt("col", c))} <span class="n">${list.length}</span></div>
        <div class="colitems">${list.length ? list.map(cardHtml).join("") : `<div class="colempty">${esc(t("emptyCol"))}</div>`}</div></section>`;
    }).join("")}</div>`;
  }

  function cardHtml(i) {
    const crop = i.screenshot_url && i.sx != null
      ? `<div class="crop" style="background-image:url('${esc(i.screenshot_url)}');background-size:230% auto;background-position:${(i.sx * 100).toFixed(1)}% ${(i.sy * 100).toFixed(1)}%" role="img" aria-label="${esc(t("approx"))}"><span class="pin s-${i.status}" style="left:min(${(i.sx * 100).toFixed(1)}%, calc(100% - 30px));top:max(${(i.sy * 100).toFixed(1)}%, 30px)">${i.no}</span></div>`
      : "";
    const mark = i.kind === "todo" ? `<span class="todo-mark" title="${esc(t("taskBadge"))}">${I.task}</span>` : `<span class="pin s-${i.status}">${i.no}</span>`;
    return `<button class="card" data-act="open" data-id="${i.id}" ${isAdmin() ? 'draggable="true"' : ""}>
      ${crop}
      <div class="cb">
        <div class="ct">${mark}<span class="ttl">${esc(i.title)}</span></div>
        <div class="meta">
          <span class="chip">${esc(tt("cat", i.category))}</span>
          ${i.priority === "hoch" ? `<span class="chip hot">${I.flag}${esc(tt("prio", "hoch"))}</span>` : ""}
          ${i.status === "abgelehnt" ? `<span class="chip st s-abgelehnt">${esc(tt("st", "abgelehnt"))}</span>` : ""}
          ${i.internal ? `<span class="chip">${esc(t("internalBadge"))}</span>` : ""}
          ${i.due_date ? `<span class="m">${esc(fmt(i.due_date, false))}</span>` : ""}
          <span class="sp"></span>
          ${i.n_comments ? `<span class="m">${I.msg}${i.n_comments}</span>` : ""}
          ${i.n_files ? `<span class="m">${I.clip.replace('width="18" height="18"', 'width="14" height="14"')}${i.n_files}</span>` : ""}
          ${i.unread ? '<span class="dot" title="neu"></span>' : ""}
        </div>
      </div>
    </button>`;
  }

  /* ------------------------------------------------------------ Detail */
  async function openItem(id) {
    try {
      S.item = (await api(`/api/items/${id}`)).item;
      S.notYet = false;
      const li = S.items.find((x) => x.id === id);
      if (li && li.unread) { li.unread = false; const p = S.projects.find((x) => x.id === S.project.id); if (p && p.n_unread) p.n_unread--; }
      renderDrawer();
    } catch (e) { toast(e.message); go(`#/p/${S.project.slug}`); }
  }

  function closeDrawer() {
    document.querySelectorAll(".drawer, .drawer-back").forEach((n) => n.remove());
    S.item = null;
  }

  function fileHtml(f, canDel) {
    const img = /^image\//.test(f.mime);
    return `<span class="file">${img ? `<a href="${esc(f.url)}" target="_blank" rel="noopener"><img src="${esc(f.url)}" alt=""></a>` : `<span class="fi">${I.file}</span>`}
      <a href="${esc(f.url)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;min-width:0"><span class="fn" style="display:block">${esc(f.name)}</span><span class="fs">${size(f.size)}</span></a>
      ${canDel ? `<button class="x" data-act="del-file" data-id="${f.id}" aria-label="${esc(t("delete"))}">${I.x}</button>` : ""}</span>`;
  }

  function renderDrawer() {
    const it = S.item;
    if (!it) return;
    const admin = isAdmin();
    const me = S.user.id;
    const who = (id, name) => (id === me ? t("you") : name || "");
    const shot = it.files.find((f) => f.is_screenshot);
    const ownFiles = it.files.filter((f) => !f.is_screenshot && !f.comment_id);
    const thread = it.comments.map((c) => {
      if (c.kind === "status" && c.meta && c.meta.cr) {
        return `<li class="ev s-${c.meta.cr === "approved" ? "erledigt" : "offen"}"><span class="d"></span><span><b>${esc(who(c.author_id, c.author_name))}</b> · ${esc(t(c.meta.cr === "approved" ? "crApproved" : "crDeclined"))}${c.body ? `<span class="note">${esc(c.body)}</span>` : ""}</span><time>${esc(fmt(c.created_at))}</time></li>`;
      }
      if (c.kind === "status") {
        const to = c.meta && c.meta.to;
        return `<li class="ev s-${esc(to)}"><span class="d"></span><span><b>${esc(who(c.author_id, c.author_name))}</b> ${esc(t("statusSet"))} <b>${esc(tt("st", to))}</b>${c.body ? `<span class="note">${esc(c.body)}</span>` : ""}</span><time>${esc(fmt(c.created_at))}</time></li>`;
      }
      const files = it.files.filter((f) => f.comment_id === c.id);
      return `<li class="msg ${c.author_role === "admin" ? "team" : ""}"><span class="avatar ${c.author_role === "admin" ? "team" : ""}">${esc(initials(c.author_name))}</span>
        <div class="bubble"><div class="mh"><b>${esc(who(c.author_id, c.author_name))}</b><time>${esc(fmt(c.created_at))}</time></div>${c.body ? `<p>${esc(c.body)}</p>` : ""}
        ${files.length ? `<div class="files">${files.map((f) => fileHtml(f, admin || f.author_id === me)).join("")}</div>` : ""}</div></li>`;
    }).join("");

    let actions = "";
    if (admin) {
      actions = `<div class="ctl">
        <label class="field"><span>${esc(t("status"))}</span><select data-patch="status">${Object.keys(TX.de.st).map((s) => `<option value="${s}" ${s === it.status ? "selected" : ""}>${esc(tt("st", s))}</option>`).join("")}</select></label>
        <label class="field"><span>${esc(t("category"))}</span><select data-patch="category">${Object.keys(TX.de.cat).map((s) => `<option value="${s}" ${s === it.category ? "selected" : ""}>${esc(tt("cat", s))}</option>`).join("")}</select></label>
        <label class="field"><span>${esc(t("priority"))}</span><select data-patch="priority">${Object.keys(TX.de.prio).map((s) => `<option value="${s}" ${s === it.priority ? "selected" : ""}>${esc(tt("prio", s))}</option>`).join("")}</select></label>
        <label class="field"><span>${esc(t("due"))}</span><input type="date" data-patch="due_date" value="${esc(it.due_date || "")}"></label>
      </div><label class="check small"><input type="checkbox" data-patch="internal" ${it.internal ? "checked" : ""}> ${esc(t("internal"))}</label>`;
    } else if (it.status === "pruefen") {
      actions = `<div class="box"><p>${esc(t("pruefenHint"))}</p><div class="row wrap"><button class="btn good" data-act="status" data-to="erledigt">${I.check}${esc(t("approve"))}</button><button class="btn" data-act="notyet">${esc(t("notYet"))}</button></div>
        ${S.notYet ? `<form data-form="notyet" style="margin-top:12px"><textarea name="note" rows="3" placeholder="${esc(t("notYetPh"))}" required></textarea><div class="row" style="margin-top:8px"><button class="btn primary">${esc(t("sendNote"))}</button><button type="button" class="btn ghost" data-act="notyet-cancel">${esc(t("cancel"))}</button></div></form>` : ""}</div>`;
    } else if (["erledigt", "abgelehnt"].includes(it.status)) {
      actions = `<div class="row" style="margin:14px 0"><button class="btn" data-act="status" data-to="offen">${esc(t("reopen"))}</button></div>`;
    }
    if (it.cr_status) {
      const money = it.cr_amount != null ? new Intl.NumberFormat(S.lang === "en" ? "en-GB" : "de-DE", { style: "currency", currency: it.cr_currency || "EUR" }).format(it.cr_amount) : "";
      const facts = `<dl class="facts">${it.cr_days != null ? `<dt>${esc(t("crDays"))}</dt><dd>${esc(String(it.cr_days).replace(".", S.lang === "en" ? "." : ","))} ${esc(t("crDays1"))}</dd>` : ""}${money ? `<dt>${esc(t("crAmount"))}</dt><dd><b>${esc(money)}</b></dd>` : ""}</dl>${it.cr_note ? `<p class="small">${esc(it.cr_note)}</p>` : ""}`;
      const canDecide = !admin && S.user.can_approve !== false;
      const box = it.cr_status === "proposed"
        ? `<div class="box"><p><b>${esc(t("crTitle"))}</b><br><span class="small">${esc(t("crHint"))}</span></p>${facts}${canDecide ? `<div class="row wrap"><button class="btn good" data-act="cr" data-to="approved">${I.check}${esc(t("crApprove"))}</button><button class="btn" data-act="cr" data-to="declined">${esc(t("crDecline"))}</button></div>` : `<p class="small muted">${esc(admin ? "Wartet auf Freigabe durch den Kunden." : t("crNoRight"))}</p>`}</div>`
        : `<div class="box"><p><b>${esc(t(it.cr_status === "approved" ? "crApproved" : "crDeclined"))}</b></p>${facts}</div>`;
      actions = box + actions;
    }
    const canDelete = admin || (it.author_id === me && it.status === "offen" && !it.comments.some((c) => c.author_id !== me));
    const mark = it.kind === "todo" ? `<span class="todo-mark" style="width:30px;height:30px">${I.task}</span>` : `<span class="pin s-${it.status}">${it.no}</span>`;
    const shotHtml = shot ? `<a class="shot" href="${esc(shot.url)}" target="_blank" rel="noopener"><img src="${esc(shot.url)}" alt="${esc(t("screenshot"))}"></a>` : "";
    const facts = it.kind === "feedback" && (it.page_url || it.device) ? `<dl class="facts">
        ${it.page_url ? `<dt>${esc(t("page"))}</dt><dd>${esc(it.page_title || "")} <span class="muted">${esc(it.page_key || "")}</span></dd>` : ""}
        ${it.device ? `<dt>${esc(t("device"))}</dt><dd>${esc(tt("devices", it.device))}${it.vw ? ` · ${it.vw}×${it.vh}` : ""}</dd>` : ""}
        <dt>${esc(t("created"))}</dt><dd>${esc(fmt(it.created_at))} ${esc(t("by"))} ${esc(who(it.author_id, it.author_name))}</dd></dl>` : `<p class="small muted">${esc(t("created"))} ${esc(fmt(it.created_at))} ${esc(t("by"))} ${esc(who(it.author_id, it.author_name))}</p>`;

    let d = document.querySelector(".drawer");
    if (!d) {
      document.body.insertAdjacentHTML("beforeend", `<div class="drawer-back" data-act="close-drawer"></div><aside class="drawer" role="dialog" aria-modal="true"></aside>`);
      d = document.querySelector(".drawer");
    }
    const draft = d.querySelector('form[data-form="reply"] textarea');
    const draftText = draft ? draft.value : "";
    d.innerHTML = `
      <div class="dh">${mark}<span class="grow">${esc(tt("kind", it.kind))} #${it.no}</span>
        ${it.kind === "feedback" && it.page_url ? `<button class="btn small" data-act="open-app" data-item="${it.id}">${I.ext}${esc(t("viewInApp"))}</button>` : ""}
        <button class="iconbtn" data-act="close-drawer" aria-label="${esc(t("close"))}">${I.x}</button></div>
      <div class="db">
        <div class="row wrap"><span class="chip st s-${it.status}">${esc(tt("st", it.status))}</span><span class="chip">${esc(tt("cat", it.category))}</span>${it.priority === "hoch" ? `<span class="chip hot">${esc(tt("prio", "hoch"))}</span>` : `<span class="chip">${esc(tt("prio", it.priority))}</span>`}${it.internal ? `<span class="chip">${esc(t("internalBadge"))}</span>` : ""}</div>
        <h2>${esc(it.title)}</h2>
        ${restBody(it) ? `<p class="body">${esc(restBody(it))}</p>` : ""}
        ${shotHtml}
        ${ownFiles.length ? `<div class="files">${ownFiles.map((f) => fileHtml(f, admin || f.author_id === me)).join("")}</div>` : ""}
        ${facts}
        ${actions}
        ${thread ? `<ul class="thread">${thread}</ul>` : ""}
        <form data-form="reply" class="composer">
          <textarea name="body" rows="3" placeholder="${esc(t("replyPh"))}">${esc(draftText)}</textarea>
          <div class="atts"></div>
          <div class="bar"><label class="iconbtn" title="${esc(t("attach"))}">${I.clip}<input type="file" name="files" multiple hidden></label><span class="grow"></span><button class="btn primary">${esc(t("reply"))}</button></div>
        </form>
        ${canDelete ? `<div style="margin-top:22px;text-align:right"><button class="btn ghost small danger" data-act="delete-item">${esc(t("delete"))}</button></div>` : ""}
      </div>`;
  }

  async function patchItem(body) {
    try {
      S.item = (await api(`/api/items/${S.item.id}`, { method: "PATCH", body })).item;
      syncListItem(S.item);
      renderDrawer();
      renderBoard();
    } catch (e) { toast(e.message); }
  }
  function syncListItem(full) {
    const i = S.items.findIndex((x) => x.id === full.id);
    const { comments, files, ...rest } = full;
    rest.n_comments = comments.filter((c) => c.kind === "comment").length;
    rest.n_files = files.filter((f) => !f.is_screenshot).length;
    if (i >= 0) S.items[i] = { ...S.items[i], ...rest, unread: false };
    else S.items.unshift({ ...rest, unread: false });
  }

  /* ------------------------------------------------------------ Einstellungen */
  async function renderSettings() {
    const el = document.getElementById("pbody");
    const p = S.project;
    if (!S.clients) { try { S.clients = (await api("/api/clients")).clients; } catch { S.clients = []; } }
    const c = S.clients.find((x) => x.id === p.client_id);
    const snippet = `<script src="${location.origin}/widget.js" data-project="${p.slug}" defer></script>`;
    el.innerHTML = `
      <section class="panel"><h2>${esc(t("embedTitle"))}</h2><p>${esc(t("embedSub"))}</p>
        <div class="copy"><code>${esc(snippet)}</code><button class="btn" data-act="copy" data-text="${esc(snippet)}">${esc(t("copy"))}</button></div></section>
      <section class="panel"><h2>${esc(t("projectSettings"))}</h2><p></p>
        <form data-form="project-edit">
          <label class="field"><span>${esc(t("projectName"))}</span><input type="text" name="name" value="${esc(p.name)}" required></label>
          <label class="field"><span>${esc(t("appUrl"))}</span><input type="url" name="app_url" value="${esc(p.app_url)}" placeholder="https://"><small>${esc(t("appUrlHint"))}</small></label>
          <label class="field"><span>${esc(t("repoUrl"))}</span><input type="url" name="repo_url" value="${esc(p.repo_url)}" placeholder="https://github.com/HYigit19/…"></label>
          <label class="field"><span>${esc(t("description"))}</span><textarea name="description" rows="3">${esc(p.description)}</textarea></label>
          <label class="field" style="max-width:260px"><span>${esc(t("projectStatus"))}</span><select name="status"><option value="aktiv" ${p.status === "aktiv" ? "selected" : ""}>${esc(t("stActive"))}</option><option value="abgeschlossen" ${p.status === "abgeschlossen" ? "selected" : ""}>${esc(t("stDone"))}</option></select></label>
          <button class="btn primary">${esc(t("save"))}</button>
        </form></section>
      ${c ? `<section class="panel"><h2>${esc(t("access"))}</h2><p>${esc(c.name)} · ${esc(c.contact_name)} · ${esc(c.contact_email)}</p>
        <div class="row wrap">${clientBadge(c)}<span class="small muted">${esc(t("lastLogin"))}: ${esc(c.last_login ? fmt(c.last_login) : t("never"))}</span><span class="grow"></span>
        <button class="btn" data-act="client-link" data-id="${c.id}">${esc(t("newLink"))}</button></div></section>` : ""}`;
  }
  const clientBadge = (c) => !c.active ? `<span class="badge off">${esc(t("inactive"))}</span>` : c.invite_pending ? `<span class="badge wait">${esc(t("invited"))}</span>` : `<span class="badge ok">${esc(t("active"))}</span>`;

  /* ------------------------------------------------------------ Kunden */
  async function pageClients() {
    S.project = null;
    try { await loadProjects(); S.clients = (await api("/api/clients")).clients; } catch { return; }
    shell("clients", `
      <div class="pagehead"><div><h1>${esc(t("clients"))}</h1><div class="sub">${esc(t("clientsSub"))}</div></div><div class="acts"><button class="btn primary" data-act="new-client">${I.plus}${esc(t("newClient"))}</button></div></div>
      ${S.clients.length ? `<div class="table"><table><thead><tr><th>${esc(t("company"))}</th><th>${esc(t("contactName"))}</th><th class="hide-m">${esc(t("projectsN"))}</th><th>${esc(t("status"))}</th><th class="hide-m">${esc(t("lastLogin"))}</th><th></th></tr></thead>
      <tbody>${S.clients.map((c) => `<tr data-act="edit-client" data-id="${c.id}">
        <td class="t">${esc(c.name)}${c.customer_no ? `<div class="small muted">${esc(c.customer_no)}</div>` : ""}</td><td>${esc(c.contact_name || "")}<div class="small muted">${esc(c.contact_email || "")}</div></td>
        <td class="hide-m">${c.n_projects}</td><td>${clientBadge(c)}</td><td class="hide-m small muted">${esc(c.last_login ? ago(c.last_login) : t("never"))}</td>
        <td class="nowrap" style="text-align:right"><button class="btn small" data-act="client-link" data-id="${c.id}">${esc(t("newLink"))}</button></td></tr>`).join("")}</tbody></table></div>`
        : `<div class="empty"><h3>${esc(t("noClients"))}</h3><button class="btn primary" data-act="new-client">${I.plus}${esc(t("newClient"))}</button></div>`}`);
  }

  /* ------------------------------------------------------------ Konto */
  async function pageAccount() {
    S.project = null;
    try { await loadProjects(); } catch { return; }
    shell("account", `
      <div class="pagehead"><div><h1>${esc(t("accountTitle"))}</h1><div class="sub">${esc(S.user.email)}</div></div></div>
      <section class="panel"><h2>${esc(t("profile"))}</h2><p></p>
        <form data-form="profile"><label class="field" style="max-width:360px"><span>${esc(t("name"))}</span><input type="text" name="name" value="${esc(S.user.name)}" required></label>
        <label class="field" style="max-width:200px"><span>${esc(t("language"))}</span><select name="lang"><option value="de" ${lang === "de" ? "selected" : ""}>Deutsch</option><option value="en" ${lang === "en" ? "selected" : ""}>English</option></select></label>
        <button class="btn primary">${esc(t("save"))}</button></form></section>
      <section class="panel"><h2>${esc(t("changePassword"))}</h2><p></p>
        <form data-form="password" style="max-width:360px"><div class="err" hidden></div>
          <label class="field"><span>${esc(t("currentPassword"))}</span><input type="password" name="current" autocomplete="current-password" required></label>
          <label class="field"><span>${esc(t("newPassword"))}</span><input type="password" name="next" minlength="10" autocomplete="new-password" required></label>
          <label class="field"><span>${esc(t("repeatPassword"))}</span><input type="password" name="next2" minlength="10" autocomplete="new-password" required></label>
          <button class="btn primary">${esc(t("changePassword"))}</button></form></section>`);
  }

  /* ------------------------------------------------------------ Dialoge */
  function openModal(html) {
    modal.innerHTML = `<div class="dlg">${html}</div>`;
    if (!modal.open) modal.showModal();
    const f = modal.querySelector("input:not([type=hidden]),select,textarea");
    if (f) f.focus();
  }
  function closeModal() { if (modal.open) modal.close(); }

  function dlgClient(c) {
    const edit = !!c;
    openModal(`<h2>${esc(edit ? t("editClient") : t("clientTitle"))}</h2><p>${esc(t("clientSub"))}</p>
      <form data-form="${edit ? "client-edit" : "client-new"}" ${edit ? `data-id="${c.id}"` : ""}>
        <div class="err" hidden></div>
        <label class="field"><span>${esc(t("company"))}</span><input type="text" name="name" value="${esc(c ? c.name : "")}" required></label>
        <div class="grid2">
          <label class="field"><span>${esc(t("contactName"))}</span><input type="text" name="contact_name" value="${esc(c ? c.contact_name : "")}" required></label>
          <label class="field"><span>${esc(t("contactEmail"))}</span><input type="email" name="contact_email" value="${esc(c ? c.contact_email : "")}" required></label>
        </div>
        <label class="field" style="max-width:200px"><span>${esc(t("language"))}</span><select name="lang"><option value="de" ${!c || c.contact_lang !== "en" ? "selected" : ""}>Deutsch</option><option value="en" ${c && c.contact_lang === "en" ? "selected" : ""}>English</option></select></label>
        ${edit ? `<label class="check small" style="margin-bottom:12px"><input type="checkbox" name="active" ${c.active ? "checked" : ""}> ${esc(t("active"))}</label>` : `
        <fieldset><legend>${esc(t("firstProject"))}</legend>
          <label class="field"><span>${esc(t("projectName"))}</span><input type="text" name="project_name"></label>
          <label class="field"><span>${esc(t("appUrl"))}</span><input type="url" name="app_url" placeholder="https://"><small>${esc(t("appUrlHint"))}</small></label>
          <label class="field"><span>${esc(t("repoUrl"))}</span><input type="url" name="repo_url" placeholder="https://github.com/HYigit19/…"></label>
        </fieldset>`}
        <div class="acts"><button type="button" class="btn ghost" data-act="close-modal">${esc(t("cancel"))}</button><button class="btn primary">${esc(edit ? t("save") : t("create"))}</button></div>
      </form>`);
  }

  async function dlgProject() {
    if (!S.clients) { try { S.clients = (await api("/api/clients")).clients; } catch { S.clients = []; } }
    if (!S.clients.length) return dlgClient();
    openModal(`<h2>${esc(t("projectTitle"))}</h2><p>${esc(t("projectSub"))}</p>
      <form data-form="project-new"><div class="err" hidden></div>
        <label class="field"><span>${esc(t("client"))}</span><select name="client_id" required><option value="">${esc(t("chooseClient"))}</option>${S.clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>
        <label class="field"><span>${esc(t("projectName"))}</span><input type="text" name="name" required></label>
        <label class="field"><span>${esc(t("appUrl"))}</span><input type="url" name="app_url" placeholder="https://"><small>${esc(t("appUrlHint"))}</small></label>
        <label class="field"><span>${esc(t("repoUrl"))}</span><input type="url" name="repo_url" placeholder="https://github.com/HYigit19/…"></label>
        <div class="acts"><button type="button" class="btn ghost" data-act="close-modal">${esc(t("cancel"))}</button><button class="btn primary">${esc(t("create"))}</button></div>
      </form>`);
  }

  function dlgTask() {
    openModal(`<h2>${esc(t("taskTitle"))}</h2><p>${esc(t("taskSub"))}</p>
      <form data-form="task-new"><div class="err" hidden></div>
        <label class="field"><span>${esc(t("title"))}</span><input type="text" name="title" required></label>
        <label class="field"><span>${esc(t("description"))}</span><textarea name="body" rows="4"></textarea></label>
        <div class="grid2">
          <label class="field"><span>${esc(t("priority"))}</span><select name="priority">${Object.keys(TX.de.prio).map((s) => `<option value="${s}" ${s === "mittel" ? "selected" : ""}>${esc(tt("prio", s))}</option>`).join("")}</select></label>
          <label class="field"><span>${esc(t("due"))}</span><input type="date" name="due_date"></label>
        </div>
        <label class="check small"><input type="checkbox" name="internal" checked> ${esc(t("internal"))}</label>
        <div class="acts"><button type="button" class="btn ghost" data-act="close-modal">${esc(t("cancel"))}</button><button class="btn primary">${esc(t("create"))}</button></div>
      </form>`);
  }

  function dlgLink(url, purpose, slug) {
    const snippet = slug ? `<script src="${location.origin}/widget.js" data-project="${slug}" defer></script>` : "";
    openModal(`<h2>${esc(purpose === "reset" ? t("resetTitle") : t("inviteTitle"))}</h2><p>${esc(purpose === "reset" ? t("resetSub") : t("inviteSub"))}</p>
      <div class="copy"><code>${esc(url)}</code><button class="btn" data-act="copy" data-text="${esc(url)}">${esc(t("copy"))}</button></div>
      ${snippet ? `<h2 style="margin-top:8px">${esc(t("embedTitle"))}</h2><p class="small muted" style="margin:4px 0 12px">${esc(t("embedSub"))}</p><div class="copy"><code>${esc(snippet)}</code><button class="btn" data-act="copy" data-text="${esc(snippet)}">${esc(t("copy"))}</button></div>` : ""}
      <div class="acts"><button class="btn primary" data-act="close-modal">${esc(t("close"))}</button></div>`);
  }

  /* ------------------------------------------------------------ Formulare */
  function showErr(form, msg) {
    const e = form.querySelector(".err");
    if (e) { e.textContent = msg; e.hidden = false; } else toast(msg);
  }

  document.addEventListener("submit", async (ev) => {
    const form = ev.target;
    const kind = form.dataset.form;
    if (!kind) return;
    ev.preventDefault();
    const fd = new FormData(form);
    const v = (k) => String(fd.get(k) || "").trim();
    const btn = form.querySelector("button.primary, button:not([type=button])");
    if (btn) btn.disabled = true;
    try {
      if (kind === "login") {
        const r = await api("/api/login", { method: "POST", body: { email: v("email"), password: fd.get("password"), remember: !!fd.get("remember") }, quiet401: true });
        S.user = r.user; setLang(S.user.lang, false);
        if (!location.hash || location.hash.startsWith("#/login") || location.hash === "#/") go("#/"); else route();
      } else if (kind === "forgot") {
        await api("/api/forgot", { method: "POST", body: { email: v("email") } });
        form.innerHTML = `<p>${esc(t("forgotDone"))}</p><p class="small"><a href="#/login">${esc(t("backToLogin"))}</a></p>`;
      } else if (kind === "link") {
        if (fd.get("password") !== fd.get("password2")) throw new Error(t("mismatch"));
        const r = await api("/api/link/accept", { method: "POST", body: { token: form.dataset.token, password: fd.get("password") } });
        S.user = r.user; setLang(S.user.lang, false); go("#/");
      } else if (kind === "password") {
        if (fd.get("next") !== fd.get("next2")) throw new Error(t("mismatch"));
        await api("/api/password", { method: "POST", body: { current: fd.get("current"), next: fd.get("next") } });
        toast(t("passwordChanged"));
        if (form.dataset.must) { S.user.must_change = false; go("#/"); route(); } else form.reset();
      } else if (kind === "profile") {
        const r = await api("/api/me", { method: "PATCH", body: { name: v("name"), lang: v("lang") } });
        S.user = r.user; setLang(S.user.lang, false); toast(t("saved")); route();
      } else if (kind === "client-new") {
        const r = await api("/api/clients", { method: "POST", body: { name: v("name"), contact_name: v("contact_name"), contact_email: v("contact_email"), lang: v("lang") } });
        let slug = null;
        if (v("project_name")) {
          const p = await api("/api/projects", { method: "POST", body: { client_id: r.id, name: v("project_name"), app_url: v("app_url"), repo_url: v("repo_url") } });
          slug = p.project.slug;
        }
        S.clients = null;
        await loadProjects().catch(() => {});
        dlgLink(r.invite_url, "invite", slug);
        if (location.hash.startsWith("#/kunden")) pageClients(); else if (!S.project) pageProjects();
        return;
      } else if (kind === "client-edit") {
        await api(`/api/clients/${form.dataset.id}`, { method: "PATCH", body: { name: v("name"), contact_name: v("contact_name"), contact_email: v("contact_email"), lang: v("lang"), active: !!fd.get("active") } });
        closeModal(); S.clients = null; toast(t("saved")); pageClients();
      } else if (kind === "project-new") {
        const p = await api("/api/projects", { method: "POST", body: { client_id: Number(v("client_id")), name: v("name"), app_url: v("app_url"), repo_url: v("repo_url") } });
        closeModal(); S.projects = []; S.project = null; go(`#/p/${p.project.slug}/einstellungen`);
      } else if (kind === "project-edit") {
        const r = await api(`/api/projects/${S.project.slug}`, { method: "PATCH", body: { name: v("name"), app_url: v("app_url"), repo_url: v("repo_url"), description: v("description"), status: v("status") } });
        S.project = { ...S.project, ...r.project }; toast(t("saved")); await loadProjects(); pageProject(S.project.slug, "einstellungen");
      } else if (kind === "task-new") {
        const r = await api(`/api/projects/${S.project.slug}/items`, { method: "POST", body: { kind: "todo", title: v("title"), body: v("body"), priority: v("priority"), due_date: v("due_date"), internal: !!fd.get("internal") } });
        closeModal(); syncListItem(r.item); renderBoard();
      } else if (kind === "notyet") {
        S.notYet = false; await patchItem({ status: "offen", note: v("note") });
      } else if (kind === "reply") {
        const body = v("body");
        const files = form._files || [];
        if (!body && !files.length) { if (btn) btn.disabled = false; return; }
        const r = await api(`/api/items/${S.item.id}/comments`, { method: "POST", body: { body, allow_empty: !!files.length } });
        S.item = r.item;
        if (files.length) S.item = await upload(S.item.id, files, r.comment_id);
        form.querySelector("textarea").value = "";
        form._files = [];
        syncListItem(S.item); renderDrawer(); renderBoard();
        const db = document.querySelector(".db"); if (db) db.scrollTop = db.scrollHeight;
      }
    } catch (e) {
      showErr(form, e.message);
    } finally {
      if (btn && document.contains(btn)) btn.disabled = false;
    }
  });

  async function upload(itemId, files, commentId) {
    const fd = new FormData();
    for (const f of files) fd.append("file", f, f.name);
    if (commentId) fd.append("comment_id", String(commentId));
    return (await api(`/api/items/${itemId}/files`, { method: "POST", body: fd })).item;
  }

  function addFiles(form, list) {
    form._files = form._files || [];
    for (const f of list) {
      if (f.size > 25 * 1024 * 1024) { toast(`${f.name} ${t("tooBig")}`); continue; }
      form._files.push(f);
    }
    form.querySelector(".atts").innerHTML = form._files.map((f, i) => `<span class="att">${I.file}<span>${esc(f.name)}</span><button type="button" data-act="unattach" data-i="${i}" aria-label="${esc(t("delete"))}">${I.x}</button></span>`).join("");
  }

  /* ------------------------------------------------------------ Klicks & Eingaben */
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    if (b.tagName === "A" && !["copy"].includes(act)) return;
    if (act === "lang") { setLang(b.dataset.lang); route(); }
    else if (act === "logout") { await api("/api/logout", { method: "POST" }).catch(() => {}); S.user = null; S.projects = []; S.project = null; S.clients = null; go("#/login"); }
    else if (act === "menu") { document.querySelector(".shell").classList.toggle("menu"); }
    else if (act === "new-client") dlgClient();
    else if (act === "new-project") dlgProject();
    else if (act === "new-task") dlgTask();
    else if (act === "close-modal") closeModal();
    else if (act === "edit-client") { if (ev.target.closest("button")) return; dlgClient(S.clients.find((c) => c.id === Number(b.dataset.id))); }
    else if (act === "client-link") {
      try { const r = await api(`/api/clients/${b.dataset.id}/link`, { method: "POST" }); S.clients = null; dlgLink(r.url, r.purpose); } catch (e) { toast(e.message); }
    } else if (act === "copy") {
      try { await navigator.clipboard.writeText(b.dataset.text); b.textContent = t("copied"); setTimeout(() => (b.textContent = t("copy")), 1600); } catch { toast(b.dataset.text); }
    } else if (act === "open-app") {
      if (!S.project.app_url) { toast(t("noAppUrl")); return; }
      // Fenster sofort öffnen (sonst blockiert der Browser das Pop-up), Adresse danach setzen
      const w = window.open("about:blank", "_blank");
      try {
        const r = await api(`/api/projects/${S.project.slug}/handoff`, { method: "POST", body: { item_id: b.dataset.item ? Number(b.dataset.item) : undefined } });
        if (w) { w.opener = null; w.location.href = r.url; } else location.href = r.url;
      } catch (e) { if (w) w.close(); toast(e.message); }
    } else if (act === "view") { S.view = b.dataset.view; renderBoard(); }
    else if (act === "open") { go(`#/p/${S.project.slug}/i/${b.dataset.id}`); }
    else if (act === "close-drawer") { go(`#/p/${S.project.slug}`); }
    else if (act === "status") patchItem({ status: b.dataset.to });
    else if (act === "cr") {
      try {
        S.item = (await api(`/api/items/${S.item.id}/decision`, { method: "POST", body: { decision: b.dataset.to } })).item;
        syncListItem(S.item); renderDrawer(); renderBoard();
        toast(t(b.dataset.to === "approved" ? "crApproved" : "crDeclined"));
      } catch (e) { toast(e.message); }
    }
    else if (act === "notyet") { S.notYet = true; renderDrawer(); const ta = document.querySelector('form[data-form="notyet"] textarea'); if (ta) ta.focus(); }
    else if (act === "notyet-cancel") { S.notYet = false; renderDrawer(); }
    else if (act === "unattach") { const f = b.closest("form"); f._files.splice(Number(b.dataset.i), 1); addFiles(f, []); }
    else if (act === "del-file") {
      try { await api(`/api/files/${b.dataset.id}`, { method: "DELETE" }); S.item = (await api(`/api/items/${S.item.id}`)).item; syncListItem(S.item); renderDrawer(); renderBoard(); } catch (e) { toast(e.message); }
    } else if (act === "delete-item") {
      if (!confirm(t("confirmDelete"))) return;
      try { await api(`/api/items/${S.item.id}`, { method: "DELETE" }); S.items = S.items.filter((x) => x.id !== S.item.id); go(`#/p/${S.project.slug}`); renderBoard(); } catch (e) { toast(e.message); }
    }
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && S.item && !modal.open) go(`#/p/${S.project.slug}`);
    if (ev.key === "Enter" && ev.target.matches("tr[data-act=open]")) ev.target.click();
    if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey) && ev.target.matches("textarea")) { const f = ev.target.closest("form"); if (f) f.requestSubmit(); }
  });

  document.addEventListener("change", (ev) => {
    const el = ev.target;
    if (el.dataset.patch && S.item) {
      const k = el.dataset.patch;
      patchItem({ [k]: el.type === "checkbox" ? el.checked : el.value });
    } else if (el.dataset.filter === "cat" || el.dataset.filter === "kind") {
      S.f[el.dataset.filter] = el.value; renderBoard();
    } else if (el.type === "file" && el.closest("form")) {
      addFiles(el.closest("form"), el.files); el.value = "";
    }
  });
  document.addEventListener("input", (ev) => {
    if (ev.target.dataset.filter === "q") {
      S.f.q = ev.target.value;
      clearTimeout(S.qt);
      S.qt = setTimeout(() => { renderBoard(); const i = document.querySelector('[data-filter="q"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 180);
    }
  });

  // Dateien in die Antwort ziehen oder einfügen
  document.addEventListener("dragover", (ev) => {
    const c = ev.target.closest && ev.target.closest(".composer");
    if (c && ev.dataTransfer && [...ev.dataTransfer.types].includes("Files")) { ev.preventDefault(); c.classList.add("over"); }
  });
  document.addEventListener("dragleave", (ev) => { const c = ev.target.closest && ev.target.closest(".composer"); if (c) c.classList.remove("over"); });
  document.addEventListener("drop", (ev) => {
    const c = ev.target.closest && ev.target.closest(".composer");
    if (c && ev.dataTransfer.files.length) { ev.preventDefault(); c.classList.remove("over"); addFiles(c, ev.dataTransfer.files); }
  });
  document.addEventListener("paste", (ev) => {
    const c = ev.target.closest && ev.target.closest(".composer");
    const files = [...((ev.clipboardData && ev.clipboardData.files) || [])];
    if (c && files.length) { ev.preventDefault(); addFiles(c, files); }
  });

  // Board: Karten per Ziehen in eine andere Spalte (nur devunox)
  let dragId = null;
  document.addEventListener("dragstart", (ev) => {
    const card = ev.target.closest && ev.target.closest(".card[draggable=true]");
    if (!card) return;
    dragId = Number(card.dataset.id);
    card.classList.add("dragging");
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("text/plain", String(dragId));
  });
  document.addEventListener("dragend", () => { dragId = null; document.querySelectorAll(".dragging,.col.over").forEach((n) => n.classList.remove("dragging", "over")); });
  document.addEventListener("dragover", (ev) => {
    const col = dragId && ev.target.closest && ev.target.closest(".col");
    if (col) { ev.preventDefault(); document.querySelectorAll(".col.over").forEach((n) => n !== col && n.classList.remove("over")); col.classList.add("over"); }
  });
  document.addEventListener("drop", async (ev) => {
    const col = dragId && ev.target.closest && ev.target.closest(".col");
    if (!col) return;
    ev.preventDefault();
    const id = dragId;
    dragId = null;
    col.classList.remove("over");
    const it = S.items.find((x) => x.id === id);
    const to = col.dataset.col;
    if (!it || it.status === to || (to === "erledigt" && it.status === "abgelehnt")) return;
    it.status = to;
    renderBoard();
    try {
      const r = await api(`/api/items/${id}`, { method: "PATCH", body: { status: to } });
      syncListItem(r.item); renderBoard();
    } catch (e) { toast(e.message); }
  });

  // Regelmäßig aktualisieren, solange das Board offen ist
  setInterval(async () => {
    if (document.hidden || !S.user || !S.project || modal.open) return;
    try {
      const r = await api(`/api/projects/${S.project.slug}/items`);
      S.items = r.items;
      if (!document.querySelector(".filters input:focus")) renderBoard();
    } catch {}
  }, 30000);

  boot();
})();
