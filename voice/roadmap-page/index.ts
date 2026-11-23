// roadmap-page: public API behind the lead's personal roadmap page (ascendleadershipgroup.ca/roadmap/?id=<token>).
// GET  ?t=<token>                       -> what the page shows (first name, language, role, video, thumbnail and PDF links, booking link)
// POST {"t": "<token>", "event": "..."} -> records a viewing event in roadmap_views
// The token (36 random characters, roadmap_requests.token) is the only key: no list, no search, nothing else exposed.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const EVENTS = new Set(["open", "play", "25", "50", "75", "90", "100", "pdf", "book_click"]);
const LINK_S = 60 * 60 * 6;   // video and PDF links last 6 hours; the page asks again on every visit

async function byToken(t: string) {
  if (!/^[A-Za-z0-9-]{20,64}$/.test(t ?? "")) return null;
  const { data } = await sb.from("roadmap_requests")
    .select("id,first_name,language,status,video_path,target_role").eq("token", t).maybeSingle();
  if (!data || !["video_ready", "sent"].includes(data.status) || !data.video_path) return null;
  return data;
}

Deno.serve(async (r) => {
  if (r.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const u = new URL(r.url);

  if (r.method === "GET") {
    const q = await byToken(u.searchParams.get("t") ?? "");
    if (!q) return json({ error: "not_found" }, 404);
    const lang = q.language === "FR" ? "FR" : "EN";
    const [{ data: d }, { data: f }, { data: s }, { data: th }] = await Promise.all([
      sb.from("roadmap_drafts").select("json_approved").eq("request_id", q.id).maybeSingle(),
      sb.from("roadmap_files").select("path").eq("request_id", q.id).eq("kind", "pdf").maybeSingle(),
      sb.from("roadmap_machine_settings").select("booking_url_en,booking_url_fr").eq("id", 1).single(),
      sb.from("roadmap_files").select("path").eq("request_id", q.id).eq("kind", "poster").maybeSingle(),
    ]);
    const doc = d?.json_approved ?? {};
    const role = String(doc.script_vars?.target_role ?? doc.target?.target_role_label ?? q.target_role ?? "").trim();
    const video = await sb.storage.from("roadmap-videos").createSignedUrl(q.video_path, LINK_S);
    const poster = th?.path ? await sb.storage.from("roadmap-decks").createSignedUrl(th.path, LINK_S) : null;   // slide 1
    const pdf = f?.path ? await sb.storage.from("roadmap-decks").createSignedUrl(f.path, LINK_S, { download: true }) : null;
    await sb.from("roadmap_views").insert({ request_id: q.id, event: "open" });
    return json({
      first_name: String(q.first_name ?? "").trim().split(/\s+/)[0],
      lang, role,
      video_url: video.data?.signedUrl ?? null,
      pdf_url: pdf?.data?.signedUrl ?? null,
      poster_url: poster?.data?.signedUrl ?? null,
      booking_url: (lang === "FR" ? s?.booking_url_fr : s?.booking_url_en) ?? null,
    });
  }

  if (r.method === "POST") {
    const b = await r.json().catch(() => ({}));
    const q = await byToken(b.t);
    if (!q) return json({ error: "not_found" }, 404);
    const ev = String(b.event ?? "");
    if (!EVENTS.has(ev)) return json({ error: "bad_event" }, 400);
    // one row per event per 10 minutes (a replay or a refresh does not inflate the counts); every booking click counts
    if (ev !== "book_click") {
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { count } = await sb.from("roadmap_views").select("id", { count: "exact", head: true })
        .eq("request_id", q.id).eq("event", ev).gte("at", since);
      if ((count ?? 0) > 0) return json({ ok: true, dup: true });
    }
    await sb.from("roadmap_views").insert({ request_id: q.id, event: ev });
    return json({ ok: true });
  }
  return json({ error: "method" }, 405);
});
