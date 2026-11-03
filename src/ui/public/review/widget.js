/*!
 * devunox Review – Feedback-Widget
 * Einbinden in die Kunden-App (vor </body>):
 *   <script src="https://project.review.devunox.ai/widget.js" data-project="PROJEKT-SLUG" defer></script>
 * Für normale Besucher unsichtbar. Es erscheint nur, wenn
 *   – die App über „App mit Feedback öffnen“ im Review-Portal geöffnet wurde (?dvx_handoff=…), oder
 *   – schon eine Feedback-Sitzung in diesem Browser besteht, oder
 *   – die Adresse ?feedback enthält (dann mit Anmeldung).
 */
(() => {
  "use strict";
  if (window.__dvxReview) return;
  window.__dvxReview = true;

  const script = document.currentScript || document.querySelector('script[src*="widget.js"][data-project]');
  if (!script) return;
  const BASE = new URL(script.src, location.href).origin;
  const PROJECT = (script.dataset.project || "").trim();
  if (!PROJECT) return;
  const KEY = "dvx_review_" + PROJECT;
  const PENDING = "dvx_review_open_" + PROJECT;

  /* ------------------------------------------------------------ Texte */
  const T = {
    de: {
      feedback: "Feedback", placePin: "Pin setzen", placeHint: "Tippe oder klicke auf die Stelle, zu der du etwas sagen möchtest.", cancel: "Abbrechen",
      moveHint: "Pin sitzt falsch? Einfach an eine andere Stelle klicken.",
      thisPage: "Diese Seite", all: "Alle", showDone: "Erledigte anzeigen", showPins: "Pins zeigen",
      emptyPage: "Auf dieser Seite gibt es noch kein Feedback. Setze einen Pin an die Stelle, die du ansprechen möchtest.",
      emptyAll: "Noch kein Feedback in diesem Projekt.",
      yourComment: "Was sollen wir ändern?", placeholder: "Zum Beispiel: Der Button ist schwer zu finden, bitte größer und in Blau.",
      category: "Art", priority: "Wichtigkeit", attach: "Datei anhängen", screenshot: "Screenshot mitsenden", send: "Feedback senden", sending: "Wird gesendet …",
      reply: "Antworten", replyPh: "Antwort schreiben …", back: "Zurück", close: "Schließen", logout: "Abmelden",
      login: "Anmelden", email: "E-Mail", password: "Passwort", loginIntro: "Melde dich mit deinem devunox-Review-Zugang an, um Feedback zu geben.",
      approve: "Passt so – erledigt", notYet: "Noch nicht in Ordnung", reopen: "Wieder öffnen", delete: "Löschen",
      notYetPh: "Was fehlt noch?", confirmDelete: "Diesen Punkt wirklich löschen?", status: "Status",
      cat: { fehler: "Fehler", design: "Design", funktion: "Funktion", text: "Text", idee: "Idee" },
      prio: { hoch: "Hoch", mittel: "Mittel", niedrig: "Niedrig" },
      st: { offen: "Offen", in_arbeit: "In Arbeit", pruefen: "Bitte prüfen", erledigt: "Erledigt", abgelehnt: "Wird nicht umgesetzt" },
      pruefenHint: "Wir haben das umgesetzt. Bitte schau es dir an und gib uns Bescheid.",
      otherPage: "Andere Seite", approx: "Stelle ungefähr – die Seite hat sich geändert", openHub: "Im Review-Portal öffnen",
      statusSet: "hat den Status geändert auf", you: "Du", errGeneric: "Das hat nicht geklappt. Bitte erneut versuchen.",
      tooBig: "ist größer als 25 MB.", sessionEnded: "Deine Feedback-Sitzung ist abgelaufen. Bitte öffne die App erneut über das Review-Portal.",
      sent: "Danke! Dein Feedback ist bei uns.", replies: "Antworten", internal: "Intern",
      dev: { mobile: "Handy", tablet: "Tablet", desktop: "PC" },
    },
    en: {
      feedback: "Feedback", placePin: "Add pin", placeHint: "Tap or click the spot you want to comment on.", cancel: "Cancel",
      moveHint: "Wrong spot? Just click somewhere else to move the pin.",
      thisPage: "This page", all: "All", showDone: "Show resolved", showPins: "Show pins",
      emptyPage: "No feedback on this page yet. Add a pin where you want to comment.",
      emptyAll: "No feedback in this project yet.",
      yourComment: "What should we change?", placeholder: "For example: this button is hard to find, please make it bigger and blue.",
      category: "Type", priority: "Priority", attach: "Attach file", screenshot: "Include screenshot", send: "Send feedback", sending: "Sending …",
      reply: "Reply", replyPh: "Write a reply …", back: "Back", close: "Close", logout: "Sign out",
      login: "Sign in", email: "Email", password: "Password", loginIntro: "Sign in with your devunox Review account to give feedback.",
      approve: "Looks good – done", notYet: "Not right yet", reopen: "Reopen", delete: "Delete",
      notYetPh: "What is still missing?", confirmDelete: "Delete this item?", status: "Status",
      cat: { fehler: "Bug", design: "Design", funktion: "Feature", text: "Text", idee: "Idea" },
      prio: { hoch: "High", mittel: "Medium", niedrig: "Low" },
      st: { offen: "Open", in_arbeit: "In progress", pruefen: "Please review", erledigt: "Done", abgelehnt: "Won't do" },
      pruefenHint: "We have made this change. Please take a look and let us know.",
      otherPage: "Other page", approx: "Approximate spot – the page has changed", openHub: "Open in review portal",
      statusSet: "changed the status to", you: "You", errGeneric: "That didn't work. Please try again.",
      tooBig: "is larger than 25 MB.", sessionEnded: "Your feedback session has ended. Please open the app again from the review portal.",
      sent: "Thanks! We've got your feedback.", replies: "Replies", internal: "Internal",
      dev: { mobile: "Phone", tablet: "Tablet", desktop: "Desktop" },
    },
  };
  let lang = (script.dataset.lang || navigator.language || "de").slice(0, 2) === "en" ? "en" : "de";
  const t = (k) => T[lang][k] ?? T.de[k] ?? k;

  /* ------------------------------------------------------------ Zustand */
  const S = {
    token: null, user: null, project: null, items: [],
    open: false, view: "list", tab: "page", showDone: false, showPins: true,
    mode: null, draft: null, current: null, busy: false, error: "", notice: "",
  };
  let host, root, layer, panel, overlay, launcher, dock, toastEl;

  /* ------------------------------------------------------------ Hilfen */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
    sget: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
    sset: (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch {} },
  };
  const pageKey = () => location.pathname + location.hash;
  const device = () => (innerWidth < 640 ? "mobile" : innerWidth < 1024 ? "tablet" : "desktop");
  const isNarrow = () => innerWidth < 640;
  const fmtDate = (iso) => {
    try {
      return new Date(iso).toLocaleString(lang === "de" ? "de-DE" : "en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch { return ""; }
  };
  const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
  const restBody = (it) => {
    const b = String(it.body || "");
    const nl = b.indexOf("\n");
    const first = (nl < 0 ? b : b.slice(0, nl)).trim();
    return first === it.title ? (nl < 0 ? "" : b.slice(nl + 1).trim()) : b;
  };
  const fileUrl = (u) => (u && u.startsWith("/") ? BASE + u : u);

  async function api(path, opts = {}) {
    const headers = {};
    if (S.token) headers.Authorization = "Bearer " + S.token;
    let body = opts.body;
    if (body && !(body instanceof FormData)) { headers["Content-Type"] = "application/json"; body = JSON.stringify(body); }
    const res = await fetch(BASE + path, { method: opts.method || "GET", headers, body, credentials: "omit" });
    let data = {};
    try { data = await res.json(); } catch {}
    if (res.status === 401 && S.token) {
      setToken(null);
      S.user = null;
      toast(t("sessionEnded"));
      teardownSession();
    }
    if (!res.ok) { const e = new Error(data.error || t("errGeneric")); e.status = res.status; throw e; }
    return data;
  }
  function setToken(v) { S.token = v; store.set(KEY, v); }

  /* ------------------------------------------------------------ Start */
  async function boot() {
    const params = new URLSearchParams(location.search);
    const handoff = params.get("dvx_handoff");
    const itemParam = params.get("dvx_item");
    const wantLogin = params.has("feedback");
    if (handoff || itemParam || wantLogin) {
      ["dvx_handoff", "dvx_item", "feedback"].forEach((k) => params.delete(k));
      const q = params.toString();
      try { history.replaceState(history.state, "", location.pathname + (q ? "?" + q : "") + location.hash); } catch {}
    }
    S.token = store.get(KEY);
    if (handoff) {
      try {
        const r = await fetch(BASE + "/api/handoff/redeem", {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "omit",
          body: JSON.stringify({ token: handoff, project: PROJECT }),
        }).then((x) => x.json().then((d) => ({ ok: x.ok, d })));
        if (r.ok) setToken(r.d.token);
      } catch {}
    }
    if (itemParam) store.sset(PENDING, itemParam);
    if (S.token) {
      try {
        S.user = (await api("/api/me")).user;
      } catch { S.user = null; }
    }
    if (S.user) {
      lang = S.user.lang === "en" ? "en" : "de";
      mount();
      await loadAll();
      const pend = store.sget(PENDING);
      if (pend) { store.sset(PENDING, null); openItem(Number(pend), true); }
    } else if (wantLogin) {
      mount();
      S.open = true;
      S.view = "login";
      render();
    }
  }

  async function loadAll() {
    try {
      const [p, it] = await Promise.all([api(`/api/projects/${PROJECT}`), api(`/api/projects/${PROJECT}/items`)]);
      S.project = p.project;
      S.items = it.items;
    } catch (e) { if (e.status !== 401) S.error = e.message; }
    render();
    schedule();
  }
  async function refreshItems() {
    if (!S.user) return;
    try { S.items = (await api(`/api/projects/${PROJECT}/items`)).items; render(true); schedule(); } catch {}
  }

  /* ------------------------------------------------------------ Oberfläche */
  function mount() {
    if (host) return;
    host = document.createElement("dvx-review");
    host.setAttribute("data-dvx-review", "");
    host.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483000;display:block;";
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${STYLE}</style>
      <div class="layer" part="layer"></div>
      <div class="overlay" hidden><div class="hint"><span class="hint-t"></span><button class="btn ghost light" data-act="cancel-place">${esc(t("cancel"))}</button></div></div>
      <div class="dock">
        <button class="pinbtn" data-act="quick-place" title="${esc(t("placePin"))}" aria-label="${esc(t("placePin"))}">${I.pinplus}</button>
        <button class="launcher" data-act="toggle" aria-label="${esc(t("feedback"))}"></button>
      </div>
      <section class="panel" hidden role="dialog" aria-label="${esc(t("feedback"))}"></section>
      <div class="toast" hidden role="status"></div>`;
    document.documentElement.appendChild(host);
    layer = root.querySelector(".layer");
    overlay = root.querySelector(".overlay");
    launcher = root.querySelector(".launcher");
    dock = root.querySelector(".dock");
    panel = root.querySelector(".panel");
    toastEl = root.querySelector(".toast");

    root.addEventListener("click", onClick);
    root.addEventListener("change", onChange);
    root.addEventListener("submit", onSubmit);
    root.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && e.target.matches("textarea")) { const f = e.target.closest("form"); if (f) f.requestSubmit(); } });
    root.addEventListener("dragover", (e) => { if (e.target.closest(".drop")) { e.preventDefault(); e.target.closest(".drop").classList.add("over"); } });
    root.addEventListener("dragleave", (e) => { const d = e.target.closest(".drop"); if (d) d.classList.remove("over"); });
    root.addEventListener("drop", (e) => { const d = e.target.closest(".drop"); if (!d) return; e.preventDefault(); d.classList.remove("over"); addFiles(d.closest("form"), e.dataTransfer.files); });
    root.addEventListener("paste", (e) => {
      const f = e.target.closest && e.target.closest("form");
      if (!f || !f.querySelector(".drop")) return;
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) { e.preventDefault(); addFiles(f, files); }
    });
    overlay.addEventListener("click", onPlace);
    overlay.addEventListener("wheel", forwardWheel, { passive: false });
    const onEsc = (e) => {
      if (e.key !== "Escape") return;
      if (S.mode === "place") cancelPlace();
      else if (S.draft) { S.draft = null; render(); }
    };
    root.addEventListener("keydown", onEsc);
    document.addEventListener("keydown", onEsc);
    for (const type of ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "touchend", "keydown", "keyup", "keypress", "input", "focusin", "focusout", "contextmenu"]) {
      host.addEventListener(type, (e) => e.stopPropagation());
    }

    // Pins nachführen: Scrollen (auch in inneren Bereichen), Größe, Navigation, DOM-Änderungen
    addEventListener("scroll", schedule, true);
    addEventListener("resize", () => { render(true); schedule(); });
    addEventListener("hashchange", () => { render(true); schedule(); });
    addEventListener("popstate", () => { render(true); schedule(); });
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
    setInterval(schedule, 1000);
    setInterval(() => { if (!document.hidden && S.user && !S.draft) refreshItems(); }, 30000);
    addEventListener("focus", () => { if (S.user && !S.draft) refreshItems(); });
    render();
  }

  function teardownSession() {
    S.items = []; S.open = false; S.draft = null;
    if (host) { host.remove(); host = null; }
  }

  const visibleItems = () => S.items.filter((i) => S.showDone || !["erledigt", "abgelehnt"].includes(i.status));
  const pageItems = () => visibleItems().filter((i) => i.page_key === pageKey());

  // passive = nur Zähler, Pins und Rahmen aktualisieren, Panel-Inhalt nicht neu aufbauen
  // (sonst gingen getippte Antworten verloren, z. B. wenn am Handy die Tastatur aufgeht)
  function render(passive) {
    if (!root) return;
    const open = S.items.filter((i) => !["erledigt", "abgelehnt"].includes(i.status)).length;
    const unread = S.items.some((i) => i.unread);
    launcher.innerHTML = `<span class="lbl">${esc(t("feedback"))}</span>${S.user ? `<span class="cnt">${open}</span>` : ""}${unread ? '<span class="dot"></span>' : ""}`;
    dock.hidden = S.mode === "place" || !!S.draft;
    dock.classList.toggle("shift", S.open && !isNarrow());
    root.querySelector(".pinbtn").hidden = !S.user;
    launcher.classList.toggle("on", S.open);
    overlay.hidden = !(S.mode === "place" || S.draft);
    overlay.classList.toggle("drafting", !!S.draft);
    root.querySelector(".hint-t").textContent = S.draft ? t("moveHint") : t("placeHint");
    root.querySelector('.hint [data-act="cancel-place"]').textContent = t("cancel");
    const pb = root.querySelector(".pinbtn");
    pb.title = t("placePin"); pb.setAttribute("aria-label", t("placePin"));
    launcher.setAttribute("aria-label", t("feedback"));
    panel.hidden = !S.open || S.mode === "place";
    panel.classList.toggle("sheet", isNarrow());
    if (!panel.hidden && (!passive || (S.view === "list" && !panel.contains(root.activeElement)))) panel.innerHTML = renderPanel();
    renderPins();
    placeComposer();
  }

  function renderPanel() {
    if (S.view === "login" || !S.user) return renderLogin();
    if (S.view === "compose" && S.draft) return renderComposeHead();
    if (S.view === "item" && S.current) return renderItem(S.current);
    return renderList();
  }

  function head(title, back) {
    return `<header class="ph">
      ${back ? `<button class="icon" data-act="back" aria-label="${esc(t("back"))}">${I.back}</button>` : `<span class="mark">${I.pin}</span>`}
      <div class="pt"><strong>${esc(title)}</strong>${S.project && !back ? `<small>${esc(S.project.name)}</small>` : ""}</div>
      ${S.user && back ? `<button class="icon accent" data-act="place" title="${esc(t("placePin"))}" aria-label="${esc(t("placePin"))}">${I.pinplus}</button>` : ""}
      <button class="icon" data-act="close" aria-label="${esc(t("close"))}">${I.x}</button>
    </header>`;
  }

  function renderLogin() {
    return `${head(t("feedback"))}
      <form class="body pad" data-form="login">
        <p class="muted">${esc(t("loginIntro"))}</p>
        <label class="fld"><span>${esc(t("email"))}</span><input type="email" name="email" autocomplete="username" required></label>
        <label class="fld"><span>${esc(t("password"))}</span><input type="password" name="password" autocomplete="current-password" required></label>
        ${S.error ? `<p class="err">${esc(S.error)}</p>` : ""}
        <button class="btn primary wide" ${S.busy ? "disabled" : ""}>${esc(t("login"))}</button>
      </form>`;
  }

  function listRow(i) {
    const other = i.page_key !== pageKey() && i.page_key;
    return `<li><button class="row" data-act="open" data-id="${i.id}">
      <span class="pinno s-${i.status}">${i.no}</span>
      <span class="rt"><span class="ttl">${esc(i.title)}</span>
        <span class="meta">${esc(t("cat")[i.category] || i.category)} · ${esc(t("st")[i.status])}${i.n_comments ? ` · ${i.n_comments} ${esc(t("replies"))}` : ""}${other ? ` · ${esc(i.page_title || t("otherPage"))}` : ""}${i.internal ? ` · ${esc(t("internal"))}` : ""}</span></span>
      ${i.unread ? '<span class="dot"></span>' : ""}
    </button></li>`;
  }

  function renderList() {
    const list = S.tab === "page" ? pageItems() : visibleItems();
    return `${head(t("feedback"))}
      <div class="tools">
        <div class="seg" role="tablist">
          <button role="tab" aria-selected="${S.tab === "page"}" data-act="tab" data-tab="page">${esc(t("thisPage"))} <b>${pageItems().length}</b></button>
          <button role="tab" aria-selected="${S.tab === "all"}" data-act="tab" data-tab="all">${esc(t("all"))} <b>${visibleItems().length}</b></button>
        </div>
        <button class="btn primary" data-act="place">${I.plus}<span>${esc(t("placePin"))}</span></button>
      </div>
      <div class="body">
        ${list.length ? `<ul class="list">${list.map(listRow).join("")}</ul>` : `<p class="empty">${esc(S.tab === "page" ? t("emptyPage") : t("emptyAll"))}</p>`}
      </div>
      <footer class="pf">
        <label class="chk"><input type="checkbox" data-set="showPins" ${S.showPins ? "checked" : ""}> ${esc(t("showPins"))}</label>
        <label class="chk"><input type="checkbox" data-set="showDone" ${S.showDone ? "checked" : ""}> ${esc(t("showDone"))}</label>
        <span class="sp"></span>
        <span class="who" title="${esc(S.user.email)}">${esc(S.user.name)}</span>
        <button class="link" data-act="logout">${esc(t("logout"))}</button>
      </footer>`;
  }

  function fileChip(f) {
    const img = /^image\//.test(f.mime);
    return `<a class="file ${img ? "img" : ""}" href="${esc(fileUrl(f.url))}" target="_blank" rel="noopener">
      ${img ? `<img src="${esc(fileUrl(f.url))}" alt="" loading="lazy">` : `<span class="fi">${I.file}</span>`}
      <span class="fn">${esc(f.name)}</span><span class="fs">${fmtSize(f.size)}</span></a>`;
  }

  function renderItem(it) {
    const isAdmin = S.user.role === "admin";
    const isAuthor = it.author_id === S.user.id;
    const filesFor = (cid) => it.files.filter((f) => !f.is_screenshot && (f.comment_id || null) === cid);
    const thread = it.comments.map((c) => {
      const who = c.author_id === S.user.id ? t("you") : c.author_name || "";
      if (c.kind === "status") {
        return `<li class="ev"><span class="evd s-${esc(c.meta?.to)}"></span><span><b>${esc(who)}</b> ${esc(t("statusSet"))} <b>${esc(t("st")[c.meta?.to] || "")}</b>${c.body ? `<span class="evn">${esc(c.body)}</span>` : ""}</span><time>${fmtDate(c.created_at)}</time></li>`;
      }
      const fs = filesFor(c.id);
      return `<li class="msg ${c.author_role === "admin" ? "team" : ""}"><div class="mh"><b>${esc(who)}</b><time>${fmtDate(c.created_at)}</time></div>
        ${c.body ? `<p>${esc(c.body)}</p>` : ""}${fs.length ? `<div class="files">${fs.map(fileChip).join("")}</div>` : ""}</li>`;
    }).join("");
    const shot = it.files.find((f) => f.is_screenshot);
    const own = filesFor(null);
    let actions = "";
    if (isAdmin) {
      actions = `<label class="fld inline"><span>${esc(t("status"))}</span><select data-act-change="status">${Object.keys(T.de.st).map((s) => `<option value="${s}" ${s === it.status ? "selected" : ""}>${esc(t("st")[s])}</option>`).join("")}</select></label>`;
    } else if (it.status === "pruefen") {
      actions = `<p class="note">${esc(t("pruefenHint"))}</p><div class="btns"><button class="btn good" data-act="approve">${I.check}<span>${esc(t("approve"))}</span></button><button class="btn" data-act="notyet">${esc(t("notYet"))}</button></div>`;
    } else if (["erledigt", "abgelehnt"].includes(it.status)) {
      actions = `<div class="btns"><button class="btn" data-act="reopen">${esc(t("reopen"))}</button></div>`;
    }
    const canDelete = isAdmin || (isAuthor && it.status === "offen" && !it.comments.some((c) => c.author_id !== S.user.id));
    const other = it.page_key && it.page_key !== pageKey();
    return `${head("#" + it.no, true)}
      <div class="body pad item">
        <div class="chips"><span class="chip s-${it.status}">${esc(t("st")[it.status])}</span><span class="chip">${esc(t("cat")[it.category] || it.category)}</span><span class="chip">${esc(t("prio")[it.priority])}</span>${it.internal ? `<span class="chip">${esc(t("internal"))}</span>` : ""}</div>
        <h3>${esc(it.title)}</h3>
        ${restBody(it) ? `<p class="bd">${esc(restBody(it))}</p>` : ""}
        <p class="by">${esc(it.author_id === S.user.id ? t("you") : it.author_name || "")} · ${fmtDate(it.created_at)}${it.device ? ` · ${esc(t("dev")[it.device] || it.device)}${it.vw ? ` ${it.vw}×${it.vh}` : ""}` : ""}</p>
        ${other ? `<button class="link" data-act="goto" data-id="${it.id}">${I.pin} ${esc(it.page_title || t("otherPage"))}</button>` : ""}
        ${shot ? `<a class="shot" href="${esc(fileUrl(shot.url))}" target="_blank" rel="noopener"><img src="${esc(fileUrl(shot.url))}" alt="Screenshot"></a>` : ""}
        ${own.length ? `<div class="files">${own.map(fileChip).join("")}</div>` : ""}
        ${actions ? `<div class="actions">${actions}</div>` : ""}
        ${S.notYet ? `<form data-form="notyet" class="reply"><textarea name="note" rows="3" placeholder="${esc(t("notYetPh"))}" required></textarea><div class="btns"><button class="btn primary">${esc(t("send"))}</button><button type="button" class="btn ghost" data-act="notyet-cancel">${esc(t("cancel"))}</button></div></form>` : ""}
        ${thread ? `<ul class="thread">${thread}</ul>` : ""}
        <form data-form="reply" class="reply">
          <div class="drop"><textarea name="body" rows="2" placeholder="${esc(t("replyPh"))}"></textarea>
          <div class="att"></div>
          <div class="rb"><label class="icon" title="${esc(t("attach"))}">${I.clip}<input type="file" name="files" multiple hidden></label><span class="sp"></span><button class="btn primary" ${S.busy ? "disabled" : ""}>${esc(t("reply"))}</button></div></div>
        </form>
        ${S.error ? `<p class="err">${esc(S.error)}</p>` : ""}
        <div class="foot"><a class="link" href="${BASE}/#/p/${esc(PROJECT)}/i/${it.id}" target="_blank" rel="noopener">${esc(t("openHub"))}</a>${canDelete ? `<button class="link danger" data-act="delete">${esc(t("delete"))}</button>` : ""}</div>
      </div>`;
  }

  function renderComposeHead() {
    return `${head(t("placePin"), true)}<div class="body pad"><p class="muted">${esc(t("yourComment"))}</p></div>`;
  }

  /* ------------------------------------------------------------ Pins */
  let raf = 0;
  function schedule() { if (!raf && root) raf = requestAnimationFrame(() => { raf = 0; renderPins(); if (S.draft) placeComposer(); }); }

  const clipCache = new WeakMap();
  function overflowClips(el) {
    let v = clipCache.get(el);
    if (!v || v.t < Date.now() - 2000) {
      const s = getComputedStyle(el);
      v = { t: Date.now(), clip: s.overflowX !== "visible" || s.overflowY !== "visible" };
      clipCache.set(el, v);
    }
    return v.clip;
  }
  function visiblePoint(el, x, y) {
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      if (overflowClips(p)) {
        const r = p.getBoundingClientRect();
        if (x < r.left - 1 || x > r.right + 1 || y < r.top - 1 || y > r.bottom + 1) return false;
      }
    }
    return true;
  }
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

  function findAnchor(a) {
    let el = null;
    if (a.selector) { try { el = document.querySelector(a.selector); } catch {} }
    if (el && a.anchor_text) {
      const want = norm(a.anchor_text).slice(0, 30);
      if (want && !norm(el.innerText || el.textContent).includes(want)) {
        // Element an gleicher Stelle hat anderen Inhalt (Liste neu sortiert?) – nach Text suchen
        const tag = el.localName;
        el = [...document.querySelectorAll(tag)].find((c) => norm(c.innerText || c.textContent).startsWith(want)) || null;
      }
    }
    return el;
  }

  function pinPosition(a) {
    const el = findAnchor(a);
    if (el && a.rx != null) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      const x = r.left + a.rx * r.width, y = r.top + a.ry * r.height;
      return visiblePoint(el, x, y) ? { x, y, approx: false } : null;
    }
    if (a.px != null) {
      const x = a.px - scrollX, y = a.py - scrollY;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return null;
      return { x, y, approx: true };
    }
    return null;
  }

  function renderPins() {
    if (!layer) return;
    const want = [];
    if (S.showPins) {
      for (const i of pageItems()) {
        const pos = pinPosition(i);
        if (pos) want.push({ key: "i" + i.id, no: i.no, status: i.status, pos, id: i.id, active: S.current && S.current.id === i.id && S.open, unread: i.unread, title: i.title });
      }
    }
    if (S.draft) {
      const pos = pinPosition(S.draft) || { x: S.draft.cx, y: S.draft.cy };
      want.push({ key: "draft", no: "+", status: "draft", pos, active: true });
    }
    const existing = new Map([...layer.children].map((c) => [c.dataset.key, c]));
    for (const w of want) {
      let el = existing.get(w.key);
      existing.delete(w.key);
      if (!el) {
        el = document.createElement("button");
        el.dataset.key = w.key;
        layer.appendChild(el);
      }
      el.className = `pin s-${w.status}${w.active ? " active" : ""}${w.pos.approx ? " approx" : ""}`;
      el.dataset.act = w.id ? "open" : "";
      if (w.id) el.dataset.id = w.id;
      el.title = w.pos.approx ? `${w.title} – ${t("approx")}` : w.title || "";
      el.innerHTML = `<span>${w.no}</span>${w.unread ? '<i class="dot"></i>' : ""}`;
      el.style.transform = `translate(${Math.round(w.pos.x)}px, ${Math.round(w.pos.y) - 30}px)`;
    }
    for (const el of existing.values()) el.remove();
  }

  /* ------------------------------------------------------------ Pin setzen */
  function startPlace() {
    S.mode = "place";
    S.draft = null;
    S.error = "";
    S.open = false;
    render();
  }

  // Mausrad über dem Overlay an den Bereich darunter weitergeben (auch innere Scrollbereiche)
  function forwardWheel(e) {
    if (e.target.closest && e.target.closest(".hint")) return;
    e.preventDefault();
    host.style.display = "none";
    let el = document.elementFromPoint(e.clientX, e.clientY);
    host.style.display = "block";
    for (; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      const st = getComputedStyle(el);
      if (/(auto|scroll)/.test(st.overflowY + st.overflowX) && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) {
        el.scrollBy(e.deltaX, e.deltaY);
        return;
      }
    }
    window.scrollBy(e.deltaX, e.deltaY);
  }
  function cancelPlace() {
    S.mode = null;
    render();
  }

  function cssPath(el) {
    const okId = (id) => id && !/\d{4,}|[:]/.test(id) && /^[A-Za-z][\w-]*$/.test(id);
    if (okId(el.id) && document.querySelectorAll("#" + CSS.escape(el.id)).length === 1) return "#" + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement && cur !== document.body) {
      let part = cur.localName;
      if (okId(cur.id)) { parts.unshift("#" + CSS.escape(cur.id)); break; }
      for (const a of ["data-testid", "data-id", "data-act", "data-go", "data-view", "data-tab", "name", "aria-label", "role"]) {
        const v = cur.getAttribute(a);
        if (v && v.length < 60) { part += `[${a}="${v.replace(/["\\]/g, "\\$&")}"]`; break; }
      }
      const parent = cur.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.localName === cur.localName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      const sel = parts.join(" > ");
      try { if (parts.length >= 2 && document.querySelectorAll(sel).length === 1) return sel; } catch {}
      cur = parent;
    }
    return parts.join(" > ");
  }

  function onPlace(e) {
    if (e.target.closest(".hint")) return;
    e.preventDefault();
    const x = e.clientX, y = e.clientY;
    overlay.style.display = "none";
    host.style.display = "none";
    let el = document.elementFromPoint(x, y);
    host.style.display = "block";
    overlay.style.display = "";
    if (!el || el === document.documentElement) el = document.body;
    // Sehr kleine Inline-Elemente (Icons) → nächstes sinnvolles Elternelement
    while (el.parentElement && el !== document.body) {
      const r = el.getBoundingClientRect();
      if (r.width >= 12 && r.height >= 12 && !["svg", "path", "use", "g", "i"].includes(el.localName)) break;
      el = el.parentElement;
    }
    const r = el.getBoundingClientRect();
    const anchor = {
      selector: cssPath(el),
      anchor_text: (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
      rx: r.width ? (x - r.left) / r.width : 0, ry: r.height ? (y - r.top) / r.height : 0,
      px: x + scrollX, py: y + scrollY, sx: x / innerWidth, sy: y / innerHeight,
      vw: innerWidth, vh: innerHeight, cx: x, cy: y,
      page_url: location.href, page_key: pageKey(), page_title: document.title,
    };
    S.mode = null;
    // Entwurf offen → nur versetzen, getippter Text bleibt erhalten
    S.draft = S.draft ? { ...S.draft, ...anchor } : { ...anchor, category: "funktion", priority: "mittel", files: [], shot: true };
    S.draft.capture = capture(x, y).catch(() => null);
    S.open = false;
    render();
  }

  function placeComposer() {
    let box = root.querySelector(".composer");
    const d = S.draft;
    if (!d) { if (box) box.remove(); return; }
    if (!box) {
      box = document.createElement("form");
      box.className = "composer";
      box.dataset.form = "create";
      box.innerHTML = `
        <div class="drop">
        <label class="lbl2">${esc(t("yourComment"))}</label>
        <textarea name="body" rows="4" placeholder="${esc(t("placeholder"))}" required></textarea>
        <div class="row2">
          <div class="fld"><span>${esc(t("category"))}</span><div class="pills">${Object.keys(T.de.cat).map((c) => `<label><input type="radio" name="category" value="${c}" ${c === d.category ? "checked" : ""}><span>${esc(t("cat")[c])}</span></label>`).join("")}</div></div>
        </div>
        <div class="row2">
          <label class="fld"><span>${esc(t("priority"))}</span><select name="priority">${Object.keys(T.de.prio).map((p) => `<option value="${p}" ${p === d.priority ? "selected" : ""}>${esc(t("prio")[p])}</option>`).join("")}</select></label>
          <label class="chk"><input type="checkbox" name="shot" checked> ${esc(t("screenshot"))}</label>
        </div>
        <div class="att"></div>
        <p class="err" hidden></p>
        <div class="rb">
          <label class="btn ghost">${I.clip}<span>${esc(t("attach"))}</span><input type="file" name="files" multiple hidden accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,video/*"></label>
          <span class="sp"></span>
          <button type="button" class="btn ghost" data-act="cancel-draft">${esc(t("cancel"))}</button>
          <button class="btn primary">${esc(t("send"))}</button>
        </div></div>`;
      root.appendChild(box);
      setTimeout(() => box.querySelector("textarea").focus({ preventScroll: true }), 30);
    }
    box.classList.toggle("sheet", isNarrow());
    if (!isNarrow()) {
      const pos = pinPosition(d) || { x: d.cx, y: d.cy };
      const w = 340, h = box.offsetHeight || 340;
      let left = pos.x + 22, top = pos.y - 40;
      if (left + w > innerWidth - 12) left = pos.x - w - 22;
      left = Math.max(12, left);
      top = Math.min(Math.max(12, top), innerHeight - h - 12);
      box.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    } else {
      box.style.transform = "";
    }
  }

  function addFiles(form, list) {
    if (!form) return;
    form._files = form._files || [];
    for (const f of list) {
      if (f.size > 25 * 1024 * 1024) { toast(`${f.name} ${t("tooBig")}`); continue; }
      form._files.push(f);
    }
    const att = form.querySelector(".att");
    att.innerHTML = form._files.map((f, i) => `<span class="attf">${I.file}<span>${esc(f.name)}</span><button type="button" data-act="unattach" data-i="${i}" aria-label="x">${I.x}</button></span>`).join("");
  }

  /* ------------------------------------------------------------ Screenshot */
  let libPromise = null;
  function loadLib() {
    if (window.modernScreenshot) return Promise.resolve(window.modernScreenshot);
    if (!libPromise) {
      libPromise = new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = BASE + "/vendor/modern-screenshot.js";
        s.onload = () => res(window.modernScreenshot);
        s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    return libPromise;
  }

  async function capture(mx, my) {
    const lib = await loadLib();
    const vw = innerWidth, vh = innerHeight, sx = scrollX, sy = scrollY;
    const scale = Math.min(window.devicePixelRatio || 1, 1.5);
    const bg = getComputedStyle(document.body).backgroundColor;
    const full = await lib.domToCanvas(document.documentElement, {
      scale,
      backgroundColor: bg && bg !== "rgba(0, 0, 0, 0)" ? bg : "#ffffff",
      filter: (n) => !(n.nodeType === 1 && n.hasAttribute && n.hasAttribute("data-dvx-review")),
      timeout: 8000,
      fetch: { requestInit: { cache: "force-cache" } },
    });
    const c = document.createElement("canvas");
    c.width = Math.round(vw * scale);
    c.height = Math.round(vh * scale);
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(full, Math.round(sx * scale), Math.round(sy * scale), c.width, c.height, 0, 0, c.width, c.height);
    // Markierung an der Pin-Stelle
    const x = mx * scale, y = my * scale, r = 16 * scale;
    g.lineWidth = 4 * scale;
    g.strokeStyle = "rgba(229,55,43,.95)";
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
    g.fillStyle = "rgba(229,55,43,.95)";
    g.beginPath(); g.arc(x, y, 4 * scale, 0, Math.PI * 2); g.fill();
    return await new Promise((res) => c.toBlob(res, "image/jpeg", 0.82));
  }

  /* ------------------------------------------------------------ Aktionen */
  async function openItem(id, scrollTo) {
    S.error = ""; S.notYet = false;
    try {
      S.current = (await api(`/api/items/${id}`)).item;
      const li = S.items.find((x) => x.id === id);
      if (li) li.unread = false;
      S.view = "item";
      S.open = true;
      if (S.current.page_key && S.current.page_key !== pageKey() && scrollTo) return gotoItem(S.current);
      render();
      if (scrollTo) revealPin(S.current);
    } catch (e) { toast(e.message); }
  }

  function revealPin(it) {
    const el = findAnchor(it);
    if (el) { try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch {} }
    else if (it.py != null) scrollTo({ top: it.py - innerHeight / 2, behavior: "smooth" });
    setTimeout(schedule, 400);
  }

  function gotoItem(it) {
    try {
      const u = new URL(it.page_url);
      if (u.origin === location.origin && u.pathname === location.pathname) {
        location.hash = u.hash;
        setTimeout(() => { render(); revealPin(it); }, 250);
        return;
      }
      store.sset(PENDING, String(it.id));
      location.href = u.toString();
    } catch {}
  }

  async function uploadFiles(itemId, files, extra = {}) {
    if (!files || !files.length) return null;
    const fd = new FormData();
    for (const f of files) fd.append("file", f, f.name || "screenshot.jpg");
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    return (await api(`/api/items/${itemId}/files`, { method: "POST", body: fd })).item;
  }

  async function onSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const kind = form.dataset.form;
    if (S.busy) return;
    S.error = "";
    if (kind === "login") {
      S.busy = true; render();
      const fd = new FormData(form);
      try {
        const r = await fetch(BASE + "/api/login", {
          method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: fd.get("email"), password: fd.get("password"), mode: "bearer", project: PROJECT }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || t("errGeneric"));
        setToken(d.token); S.user = d.user; lang = d.user.lang === "en" ? "en" : "de"; S.view = "list";
        S.busy = false;
        await loadAll();
      } catch (err) { S.error = err.message; S.busy = false; render(); }
      return;
    }
    if (kind === "create") {
      const fd = new FormData(form);
      const body = String(fd.get("body") || "").trim();
      if (!body) return;
      const btn = form.querySelector("button.primary");
      btn.disabled = true; btn.textContent = t("sending");
      S.busy = true;
      const d = S.draft;
      try {
        const payload = { ...d, body, category: fd.get("category") || "funktion", priority: fd.get("priority") || "mittel", device: device() };
        delete payload.files; delete payload.capture; delete payload.cx; delete payload.cy; delete payload.shot;
        let item = (await api(`/api/projects/${PROJECT}/items`, { method: "POST", body: payload })).item;
        if (fd.get("shot")) {
          const blob = await d.capture;
          if (blob) { try { item = await uploadFiles(item.id, [new File([blob], `screenshot-${item.no}.jpg`, { type: "image/jpeg" })], { screenshot: "1" }); } catch {} }
        }
        if (form._files && form._files.length) item = await uploadFiles(item.id, form._files);
        S.draft = null; form.remove();
        S.busy = false;
        S.items.unshift(item);
        S.current = item; S.view = "item"; S.open = true;
        toast(t("sent"));
        render();
        refreshItems();
      } catch (err) {
        S.busy = false;
        btn.disabled = false; btn.textContent = t("send");
        const p = form.querySelector(".err"); p.hidden = false; p.textContent = err.message;
      }
      return;
    }
    if (kind === "reply") {
      const fd = new FormData(form);
      const body = String(fd.get("body") || "").trim();
      const files = form._files || [];
      if (!body && !files.length) return;
      S.busy = true;
      form.querySelector("button.primary").disabled = true;
      try {
        const r = await api(`/api/items/${S.current.id}/comments`, { method: "POST", body: { body, allow_empty: !!files.length } });
        S.current = r.item;
        if (files.length) S.current = await uploadFiles(S.current.id, files, { comment_id: String(r.comment_id) });
      } catch (err) { S.error = err.message; }
      S.busy = false;
      render();
      scrollThreadEnd();
      return;
    }
    if (kind === "notyet") {
      const note = String(new FormData(form).get("note") || "").trim();
      await setStatus("offen", note);
      return;
    }
  }

  function scrollThreadEnd() { const b = root.querySelector(".panel .body"); if (b) b.scrollTop = b.scrollHeight; }

  async function setStatus(status, note) {
    try {
      S.current = (await api(`/api/items/${S.current.id}`, { method: "PATCH", body: { status, note } })).item;
      S.notYet = false;
      const li = S.items.findIndex((x) => x.id === S.current.id);
      if (li >= 0) S.items[li] = { ...S.items[li], status: S.current.status };
      render();
    } catch (e) { toast(e.message); }
  }

  async function onClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    if (!act) return;
    if (act === "toggle") {
      S.open = !S.open;
      if (S.open && S.view === "compose") S.view = "list";
      render();
    } else if (act === "close") { S.open = false; render(); }
    else if (act === "back") { S.view = "list"; S.current = null; S.error = ""; render(); }
    else if (act === "tab") { S.tab = b.dataset.tab; render(); }
    else if (act === "place" || act === "quick-place") startPlace();
    else if (act === "cancel-place") { if (S.draft) { S.draft = null; render(); } else cancelPlace(); }
    else if (act === "cancel-draft") { S.draft = null; const c = root.querySelector(".composer"); if (c) c.remove(); render(); }
    else if (act === "open") openItem(Number(b.dataset.id), e.target.closest(".row") != null);
    else if (act === "goto") gotoItem(S.current);
    else if (act === "approve") setStatus("erledigt", "");
    else if (act === "reopen") setStatus("offen", "");
    else if (act === "notyet") { S.notYet = true; render(); const ta = root.querySelector('form[data-form="notyet"] textarea'); if (ta) ta.focus(); }
    else if (act === "notyet-cancel") { S.notYet = false; render(); }
    else if (act === "unattach") {
      const form = b.closest("form");
      form._files.splice(Number(b.dataset.i), 1);
      addFiles(form, []);
    } else if (act === "delete") {
      if (!confirm(t("confirmDelete"))) return;
      try {
        await api(`/api/items/${S.current.id}`, { method: "DELETE" });
        S.items = S.items.filter((x) => x.id !== S.current.id);
        S.current = null; S.view = "list"; render();
      } catch (err) { toast(err.message); }
    } else if (act === "logout") {
      try { await api("/api/logout", { method: "POST" }); } catch {}
      setToken(null); S.user = null;
      teardownSession();
    }
  }

  function onChange(e) {
    const el = e.target;
    if (el.dataset.set) { S[el.dataset.set] = el.checked; render(); return; }
    if (el.dataset.actChange === "status") { setStatus(el.value, ""); return; }
    if (el.type === "file") { addFiles(el.closest("form"), el.files); el.value = ""; }
  }

  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toastEl.hidden = true; }, 3500);
  }

  /* ------------------------------------------------------------ Symbole */
  const svg = (p, w = 18) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const I = {
    pin: svg('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    back: svg('<path d="M15 6l-6 6 6 6"/>'),
    clip: svg('<path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7-7L14 4.5a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/>'),
    file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>', 16),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    pinplus: svg('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><path d="M12 6.5v6M9 9.5h6"/>', 22),
  };

  /* ------------------------------------------------------------ Stil */
  const STYLE = `
  :host{all:initial}
  *{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  [hidden]{display:none!important}
  :host{--ink:#121a2e;--ink2:#566078;--line:#e1e5ee;--wash:#f3f5f9;--paper:#fff;--blue:#2148f5;--blue2:#1736c8;
    --s-offen:#e5372b;--s-in_arbeit:#e08a00;--s-pruefen:#7a4dff;--s-erledigt:#1e9457;--s-abgelehnt:#8a93a6;--s-draft:#2148f5}
  button,input,select,textarea{font:inherit;color:inherit}
  .layer{position:fixed;inset:0;pointer-events:none}
  .pin{position:absolute;left:0;top:0;width:30px;height:30px;margin-left:0;border:0;padding:0;cursor:pointer;pointer-events:auto;
    border-radius:50% 50% 50% 0;background:var(--c);color:#fff;box-shadow:0 2px 6px rgba(18,26,46,.35),0 0 0 2px #fff;
    display:grid;place-items:center;transition:box-shadow .15s}
  .pin span{font:700 12px/1 ui-sans-serif,system-ui,sans-serif;font-variant-numeric:tabular-nums}
  .pin:hover,.pin.active{box-shadow:0 2px 10px rgba(18,26,46,.45),0 0 0 2px #fff,0 0 0 5px color-mix(in srgb,var(--c) 35%,transparent)}
  .pin.approx{opacity:.75;outline:2px dashed #fff;outline-offset:1px}
  .pin .dot{position:absolute;top:-3px;right:-3px}
  .s-offen{--c:var(--s-offen)}.s-in_arbeit{--c:var(--s-in_arbeit)}.s-pruefen{--c:var(--s-pruefen)}.s-erledigt{--c:var(--s-erledigt)}.s-abgelehnt{--c:var(--s-abgelehnt)}.s-draft{--c:var(--s-draft)}
  .dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--blue);box-shadow:0 0 0 2px #fff;flex:none}

  .dock{position:fixed;right:0;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none}
  .dock.shift{right:392px}
  .dock.shift .pinbtn,.dock.shift .launcher{border-radius:12px}
  .pinbtn{pointer-events:auto;border:0;cursor:pointer;width:46px;height:46px;border-radius:12px 0 0 12px;background:var(--s-offen);color:#fff;
    display:grid;place-items:center;box-shadow:-2px 4px 16px rgba(229,55,43,.35)}
  .pinbtn:hover{filter:brightness(1.07)}
  .icon.accent{color:var(--s-offen)}
  .launcher{position:relative;pointer-events:auto;border:0;cursor:pointer;
    background:var(--ink);color:#fff;border-radius:10px 0 0 10px;padding:14px 8px;display:flex;flex-direction:column;align-items:center;gap:8px;
    box-shadow:-2px 4px 16px rgba(18,26,46,.25)}
  .launcher .lbl{writing-mode:vertical-rl;transform:rotate(180deg);font-weight:600;font-size:13px;letter-spacing:.02em}
  .launcher .cnt{background:var(--s-offen);border-radius:999px;min-width:20px;height:20px;padding:0 5px;font:700 11px/20px ui-sans-serif,system-ui,sans-serif;text-align:center}
  .launcher.on{background:var(--blue)}
  .launcher .dot{position:absolute;top:6px;left:6px}

  .overlay{position:fixed;inset:0;pointer-events:auto;cursor:crosshair;background:rgba(33,72,245,.06);outline:3px solid var(--blue);outline-offset:-3px}
  .overlay.drafting{background:transparent;outline:0}
  .hint{position:fixed;left:50%;top:14px;transform:translateX(-50%);display:flex;align-items:center;gap:12px;background:var(--ink);color:#fff;
    padding:8px 8px 8px 16px;border-radius:12px;font-size:14px;box-shadow:0 8px 24px rgba(18,26,46,.3);cursor:default;max-width:calc(100vw - 24px)}

  .panel{position:fixed;right:12px;top:12px;bottom:12px;width:380px;max-width:calc(100vw - 24px);pointer-events:auto;background:var(--paper);color:var(--ink);
    border-radius:16px;box-shadow:0 18px 50px rgba(18,26,46,.28),0 0 0 1px rgba(18,26,46,.06);display:flex;flex-direction:column;overflow:hidden;font-size:14px;line-height:1.45}
  .panel.sheet{left:0;right:0;bottom:0;top:auto;width:auto;max-width:none;height:min(78vh,640px);border-radius:18px 18px 0 0}
  .ph{display:flex;align-items:center;gap:10px;padding:12px 12px 12px 16px;border-bottom:1px solid var(--line)}
  .ph .pt{flex:1;min-width:0;display:flex;flex-direction:column}
  .ph .pt strong{font-size:15px}
  .ph .pt small{color:var(--ink2);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ph .mark{color:var(--s-offen);display:grid}
  .icon{border:0;background:transparent;width:34px;height:34px;border-radius:9px;display:grid;place-items:center;cursor:pointer;color:var(--ink2);flex:none}
  .icon:hover{background:var(--wash);color:var(--ink)}
  .tools{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line)}
  .seg{display:flex;background:var(--wash);border-radius:10px;padding:3px;flex:1}
  .seg button{flex:1;border:0;background:transparent;padding:6px 8px;border-radius:8px;cursor:pointer;font-size:13px;color:var(--ink2);white-space:nowrap}
  .seg button b{font-weight:600;color:var(--ink2);margin-left:2px}
  .seg button[aria-selected=true]{background:#fff;color:var(--ink);box-shadow:0 1px 2px rgba(18,26,46,.12)}
  .body{flex:1;overflow:auto;overscroll-behavior:contain}
  .pad{padding:14px 16px}
  .list{list-style:none;margin:0;padding:6px}
  .row{display:flex;gap:10px;align-items:flex-start;width:100%;border:0;background:transparent;text-align:left;padding:10px;border-radius:10px;cursor:pointer}
  .row:hover{background:var(--wash)}
  .pinno{flex:none;width:24px;height:24px;border-radius:50% 50% 50% 0;background:var(--c);color:#fff;display:grid;place-items:center;font:700 11px/1 ui-sans-serif,system-ui,sans-serif;margin-top:1px}
  .rt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
  .ttl{font-weight:600;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .meta{color:var(--ink2);font-size:12px}
  .row .dot{margin-top:7px}
  .empty{color:var(--ink2);padding:28px 22px;text-align:center}
  .pf{display:flex;align-items:center;gap:12px;padding:10px 14px;border-top:1px solid var(--line);font-size:12px;color:var(--ink2);flex-wrap:wrap}
  .pf .sp,.rb .sp{flex:1}
  .who{font-weight:600;color:var(--ink);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .chk{display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:13px}
  .pf .chk{font-size:12px}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--line);background:#fff;padding:8px 12px;border-radius:10px;cursor:pointer;font-weight:600;font-size:13px;white-space:nowrap}
  .btn:hover{border-color:#c9cfdc}
  .btn.primary{background:var(--blue);border-color:var(--blue);color:#fff}
  .btn.primary:hover{background:var(--blue2)}
  .btn.good{background:var(--s-erledigt);border-color:var(--s-erledigt);color:#fff}
  .btn.ghost{background:transparent;border-color:transparent}
  .btn.ghost:hover{background:var(--wash)}
  .btn.light{color:#fff}.btn.light:hover{background:rgba(255,255,255,.12)}
  .btn.wide{width:100%;padding:11px}
  .btn[disabled]{opacity:.6;cursor:default}
  .link{border:0;background:none;color:var(--blue);cursor:pointer;padding:0;font-size:13px;font-weight:600;text-decoration:none;display:inline-flex;align-items:center;gap:4px}
  .link.danger{color:var(--s-offen)}
  .muted{color:var(--ink2);margin:0 0 12px}
  .err{color:#b4231a;background:#fdeceb;border-radius:8px;padding:8px 10px;margin:8px 0;font-size:13px}
  .fld{display:flex;flex-direction:column;gap:5px;margin-bottom:12px}
  .fld>span,.lbl2{font-size:12px;font-weight:600;color:var(--ink2)}
  .fld.inline{flex-direction:row;align-items:center;gap:10px;margin:0}
  input[type=email],input[type=password],select,textarea{border:1px solid var(--line);border-radius:10px;padding:9px 11px;background:#fff;width:100%;outline:none}
  select{width:auto;padding:7px 10px}
  textarea{resize:vertical;min-height:44px;line-height:1.45}
  input:focus,select:focus,textarea:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(33,72,245,.15)}
  button:focus-visible,.row:focus-visible,a:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
  .item h3{font-size:17px;line-height:1.3;margin:10px 0 6px}
  .item .bd{white-space:pre-wrap;margin:0 0 6px}
  .by{color:var(--ink2);font-size:12px;margin:0 0 10px}
  .chips{display:flex;gap:6px;flex-wrap:wrap}
  .chip{font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px;background:var(--wash);color:var(--ink2)}
  .chip[class*=" s-"]{background:color-mix(in srgb,var(--c) 14%,#fff);color:color-mix(in srgb,var(--c) 80%,#000)}
  .shot{display:block;margin:10px 0;border-radius:10px;overflow:hidden;border:1px solid var(--line)}
  .shot img{display:block;width:100%;height:auto}
  .files{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}
  .file{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:10px;padding:6px 10px 6px 6px;text-decoration:none;color:var(--ink);max-width:100%;font-size:12px}
  .file img{width:40px;height:40px;object-fit:cover;border-radius:6px}
  .file .fi{width:28px;height:28px;display:grid;place-items:center;background:var(--wash);border-radius:6px;color:var(--ink2)}
  .file .fn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px;font-weight:600}
  .file .fs{color:var(--ink2)}
  .actions{background:var(--wash);border-radius:12px;padding:12px;margin:12px 0}
  .actions .note{margin:0 0 10px;font-size:13px}
  .btns{display:flex;gap:8px;flex-wrap:wrap}
  .thread{list-style:none;margin:14px 0 0;padding:0;display:flex;flex-direction:column;gap:10px}
  .msg{border:1px solid var(--line);border-radius:12px;padding:10px 12px}
  .msg.team{background:#f4f6ff;border-color:#dfe5ff}
  .msg p{margin:4px 0 0;white-space:pre-wrap}
  .mh{display:flex;justify-content:space-between;gap:8px;font-size:12px}
  .mh time,.ev time{color:var(--ink2);font-size:11px;white-space:nowrap}
  .ev{display:flex;gap:8px;align-items:baseline;font-size:12px;color:var(--ink2);padding:0 4px}
  .ev>span:nth-child(2){flex:1}
  .ev b{color:var(--ink)}
  .evd{width:8px;height:8px;border-radius:50%;background:var(--c);flex:none;transform:translateY(-1px)}
  .evn{display:block;color:var(--ink);white-space:pre-wrap;margin-top:2px}
  .reply{margin-top:14px}
  .drop{border-radius:12px;transition:background .15s}
  .drop.over{background:#eef2ff;outline:2px dashed var(--blue)}
  .reply .drop{border:1px solid var(--line);padding:6px}
  .reply textarea{border:0;box-shadow:none;padding:6px}
  .rb{display:flex;align-items:center;gap:6px;margin-top:6px}
  .att{display:flex;flex-wrap:wrap;gap:6px}
  .att:not(:empty){margin:6px 0}
  .attf{display:inline-flex;align-items:center;gap:6px;background:var(--wash);border-radius:8px;padding:4px 4px 4px 8px;font-size:12px;max-width:100%}
  .attf span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px}
  .attf button{border:0;background:none;cursor:pointer;display:grid;place-items:center;color:var(--ink2);padding:2px}
  .attf svg{width:14px;height:14px}
  .foot{display:flex;justify-content:space-between;margin-top:16px;padding-top:12px;border-top:1px solid var(--line)}

  .composer{position:fixed;left:0;top:0;width:340px;pointer-events:auto;background:#fff;color:var(--ink);border-radius:14px;padding:14px;
    box-shadow:0 18px 50px rgba(18,26,46,.3),0 0 0 1px rgba(18,26,46,.06);font-size:14px;line-height:1.45}
  .composer.sheet{left:0;right:0;top:auto;bottom:0;width:auto;border-radius:18px 18px 0 0;max-height:80vh;overflow:auto}
  .composer textarea{margin:6px 0 10px}
  .composer .rb{flex-wrap:wrap}
  .composer.sheet .rb .btn.primary{flex:1 1 100%;order:5;padding:11px}
  .composer.sheet{padding-bottom:calc(14px + env(safe-area-inset-bottom,0px))}
  .row2{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
  .row2 .fld{margin-bottom:10px}
  .pills{display:flex;flex-wrap:wrap;gap:6px}
  .pills label{cursor:pointer}
  .pills input{position:absolute;opacity:0;pointer-events:none}
  .pills span{display:inline-block;padding:5px 10px;border:1px solid var(--line);border-radius:999px;font-size:12px;font-weight:600;color:var(--ink2)}
  .pills input:checked+span{background:var(--ink);border-color:var(--ink);color:#fff}
  .pills input:focus-visible+span{outline:2px solid var(--blue);outline-offset:2px}

  .toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--ink);color:#fff;padding:10px 16px;border-radius:12px;font-size:14px;
    pointer-events:none;box-shadow:0 8px 24px rgba(18,26,46,.3);max-width:calc(100vw - 32px)}
  @media (prefers-reduced-motion:reduce){*{transition:none!important}}
  `;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
