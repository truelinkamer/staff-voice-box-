import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const J = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\//, "");
  const POST = req.method === "POST";
  const body = POST ? await req.json().catch(() => ({})) : {};
  const store = getStore("feedback");

  // Staff: send feedback (anonymous)
  if (path === "submit" && POST) {
    if (body.bot) return J({ ok: true }); // honeypot
    const message = String(body.message || "").trim().slice(0, 1500);
    if (!message) return J({ error: "empty" }, 400);
    const AL = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const code = "SV-" + Array.from(crypto.randomBytes(8), (b) => AL[b % 32]).join("");
    await store.setJSON(code, {
      code, message,
      type: body.type === "suggestion" ? "suggestion" : "complaint",
      area: String(body.area || "").slice(0, 60),
      urgency: ["Low", "Medium", "High"].includes(body.urgency) ? body.urgency : "Medium",
      language: body.language === "ar" ? "ar" : "en",
      createdAt: new Date().toISOString(),
      status: "new", note: "", reply: "", repliedAt: null,
    });
    return J({ code });
  }

  // Staff: check for a management reply using their reference code
  if (path === "reply") {
    const code = (url.searchParams.get("code") || "").trim().toUpperCase();
    const it = /^[A-Z0-9-]{8,12}$/.test(code) ? await store.get(code, { type: "json" }) : null;
    if (!it) return J({ error: "notfound" }, 404);
    return J({ status: it.status, reply: it.reply, repliedAt: it.repliedAt });
  }

  // Management (no password: anyone with the dashboard link can use it)
  if (path.startsWith("admin/")) {
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
