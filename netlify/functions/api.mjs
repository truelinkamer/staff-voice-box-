import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

// Optional dashboard password: set ADMIN_PASSWORD in Netlify to turn it on. Leave it unset for an open dashboard.
const PW = process.env.ADMIN_PASSWORD || "";
const J = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const sign = (e) => crypto.createHmac("sha256", PW).update(String(e)).digest("hex");
const eq = (a, b) => { a = Buffer.from(a); b = Buffer.from(b); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const authed = (req) => {
  if (!PW) return true;
  const [e, s] = (req.headers.get("authorization") || "").replace("Bearer ", "").split(".");
  return !!(e && s && +e > Date.now() && eq(s, sign(e)));
};
const clip = (v, n) => String(v || "").trim().slice(0, n);
const AL = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\//, "");
  const POST = req.method === "POST";
  const body = POST ? await req.json().catch(() => ({})) : {};
  const store = getStore({ name: "feedback", consistency: "strong" });

  // Staff or customer: send a message
  if (path === "submit" && POST) {
    if (body.bot) return J({ ok: true }); // honeypot
    const message = clip(body.message, 1500);
    if (!message) return J({ error: "empty" }, 400);
    const customer = body.source === "customer";
    const types = customer ? ["complaint", "suggestion", "feedback"] : ["complaint", "suggestion"];
    const code = (customer ? "CF-" : "SV-") + Array.from(crypto.randomBytes(8), (b) => AL[b % 32]).join("");
    const item = {
      code, message, source: customer ? "customer" : "staff",
      type: types.includes(body.type) ? body.type : "complaint",
      area: clip(body.area, 60),
      urgency: customer ? "" : (["Low", "Medium", "High"].includes(body.urgency) ? body.urgency : "Medium"),
      language: body.language === "ar" ? "ar" : "en",
      createdAt: new Date().toISOString(),
      status: "new", note: "", reply: "", repliedAt: null,
    };
    if (customer) {
      const email = clip(body.email, 120);
      item.contact = {
        name: clip(body.name, 80),
        phone: clip(body.phone, 30).replace(/[^\d+\-() ]/g, ""),
        email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : "",
      };
    }
    await store.setJSON(code, item);
    return J({ code });
  }

  // Tracking code lookup (status and reply only, never contact details)
  if (path === "reply") {
    const code = (url.searchParams.get("code") || "").trim().toUpperCase();
    const it = /^[A-Z0-9-]{8,12}$/.test(code) ? await store.get(code, { type: "json" }) : null;
    if (!it) return J({ error: "notfound" }, 404);
    return J({ status: it.status, reply: it.reply, repliedAt: it.repliedAt });
  }

  // Management
  if (path === "admin/login" && POST) {
    if (!PW) return J({ token: "open" });
    if (eq(String(body.password || ""), PW)) {
      const e = Date.now() + 12 * 3600e3;
      return J({ token: e + "." + sign(e) });
    }
    return J({ error: "bad" }, 401);
  }
  if (path.startsWith("admin/")) {
    if (!authed(req)) return J({ error: "auth" }, 401);
    if (path === "admin/list") {
      const { blobs } = await store.list();
      const items = (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))).filter(Boolean)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return J({ items });
    }
    if (path === "admin/update" && POST) {
      const it = await store.get(String(body.code), { type: "json" });
      if (!it) return J({ error: "notfound" }, 404);
      if (["new", "in_progress", "resolved"].includes(body.status)) it.status = body.status;
      if (typeof body.reply === "string") {
        const r = body.reply.trim().slice(0, 3000);
        if (r !== it.reply) { it.reply = r; it.repliedAt = r ? new Date().toISOString() : null; }
      }
      await store.setJSON(it.code, it);
      return J({ item: it });
    }
    if (path === "admin/delete" && POST) {
      await store.delete(String(body.code));
      return J({ ok: true });
    }
  }
  return J({ error: "not found" }, 404);
};

export const config = { path: "/api/*" };
