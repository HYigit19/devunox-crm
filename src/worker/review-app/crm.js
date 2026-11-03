// Anbindung an das devunox CRM.
// Review → CRM: neues Feedback, Antworten des Kunden und Statuswechsel gehen per signiertem Webhook an das CRM
//               und erscheinen dort als Aufgabe im passenden Projekt (Projekt-Kürzel = slug).
// CRM → Review: das CRM meldet Statusänderungen über POST /api/integrations/crm/status zurück.
// Signatur: Header X-Devunox-Timestamp (Unix-Sekunden) + X-Devunox-Signature = HMAC-SHA256(secret, `${ts}.${body}`) als Hex.

const enc = new TextEncoder();

async function sign(secret, ts, body) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${ts}.${body}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function verifyCrmSignature(env, request, body) {
  const secret = env.CRM_WEBHOOK_SECRET;
  const ts = request.headers.get("X-Devunox-Timestamp");
  const sig = request.headers.get("X-Devunox-Signature");
  if (!secret || !ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  return safeEqual(await sign(secret, ts, body), sig);
}

/** Baut die Nachricht für das CRM. */
export async function crmPayload(ctx, event, project, item, extra = {}) {
  const c = await ctx.env.DB.prepare("SELECT id, name, customer_no FROM clients WHERE id = ?").bind(project.client_id).first();
  const origin = ctx.url.origin;
  return {
    event,
    project: { id: project.id, slug: project.slug, name: project.name, app_url: project.app_url || "", hub_url: `${origin}/#/p/${project.slug}` },
    client: c ? { id: c.id, name: c.name, customer_no: c.customer_no || null } : null,
    item: {
      id: item.id, no: item.no, kind: item.kind, title: item.title, body: item.body, category: item.category, priority: item.priority,
      status: item.status, page_url: item.page_url, internal: !!item.internal, link: `${origin}/#/p/${project.slug}/i/${item.id}`,
    },
    author: ctx.user ? { name: ctx.user.name, email: ctx.user.email, role: ctx.user.role } : null,
    ...extra,
  };
}

/** Sendet ein Ereignis im Hintergrund an das CRM (nur wenn konfiguriert). Interne Punkte werden nie gesendet. */
export function sendToCrm(ctx, payloadPromise) {
  const { env } = ctx;
  // Im devunox CRM eingebaut: direkt im selben Worker übergeben (kein HTTP, kein Secret nötig)
  if (env.CRM_DISPATCH) {
    ctx.exec.waitUntil(
      (async () => {
        try {
          const payload = await payloadPromise;
          if (payload.item && payload.item.internal) return;
          await env.CRM_DISPATCH(payload);
        } catch (e) {
          console.log("CRM-Übergabe fehlgeschlagen:", e && e.message);
        }
      })()
    );
    return;
  }
  if (!env.CRM_WEBHOOK_URL || !env.CRM_WEBHOOK_SECRET) return;
  ctx.exec.waitUntil(
    (async () => {
      try {
        const payload = await payloadPromise;
        if (payload.item && payload.item.internal) return;
        const body = JSON.stringify(payload);
        const ts = String(Math.floor(Date.now() / 1000));
        const res = await fetch(env.CRM_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Devunox-Timestamp": ts, "X-Devunox-Signature": await sign(env.CRM_WEBHOOK_SECRET, ts, body) },
          body,
        });
        if (!res.ok) console.log("CRM-Webhook:", res.status, await res.text());
      } catch (e) {
        console.log("CRM-Webhook fehlgeschlagen:", e && e.message);
      }
    })()
  );
}
