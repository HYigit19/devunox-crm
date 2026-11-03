// Benachrichtigung per E-Mail an uns (devunox), über Cloudflare Email Routing (send_email-Binding).
// Email Routing stellt nur an bestätigte Adressen zu – daher nur Mails an ADMIN_NOTIFY, nicht an Kunden.
// Ohne EMAIL-Binding passiert einfach nichts.
import { EmailMessage } from "cloudflare:email";

const b64 = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const wrap = (s) => s.replace(/.{1,76}/g, "$&\r\n");
const hdr = (s) => (/^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const oneLine = (s) => String(s || "").replace(/[\r\n]+/g, " ").trim();

export async function notifyAdmin(env, subject, text) {
  if (!env.EMAIL || !env.ADMIN_NOTIFY) return;
  const from = env.MAIL_FROM || "review@devunox.ai";
  const to = env.ADMIN_NOTIFY;
  const raw = [
    `From: ${hdr("devunox Review")} <${from}>`,
    `To: <${to}>`,
    `Subject: ${hdr(oneLine(subject).slice(0, 180))}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${from.split("@")[1]}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(b64(text)),
  ].join("\r\n");
  try {
    await env.EMAIL.send(new EmailMessage(from, to, raw));
  } catch (e) {
    console.log("Mail nicht gesendet:", e && e.message);
  }
}
