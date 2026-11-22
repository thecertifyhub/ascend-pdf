// roadmap-intake: public API behind the roadmap request form (ascendleadershipgroup.ca/roadmap-request/).
// No secret: anyone can call it, so it only ever creates a pending resume upload and one roadmap request.
// POST {"action":"slot", "filename", "size"}   -> {upload_id, signed_url}: the page PUTs the resume there (PDF or .docx, 10 MB)
// POST {"action":"read", "upload_id"}          -> {first_name, last_name, email, phone} read from the resume (pre-fill)
// POST {"action":"submit", "upload_id", ...}   -> creates the roadmap_requests row (status received) and starts the generator
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";
import { unzipSync, strFromU8 } from "npm:fflate@0.8.2";

const URL_ = Deno.env.get("SUPABASE_URL")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(URL_, SERVICE);
const BUCKET = "roadmap-resumes";
const MAX = 10 * 1024 * 1024;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
const FAMILIES = ["specialist", "supervisor", "planner", "reliability_engineer", "manager", "asset_management"];
const UPLOAD = /^pending\/[0-9a-f-]{36}\.(pdf|docx)$/;
const clean = (v: unknown, n = 200) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

/** Pricing region from the target location: US, Africa, otherwise Canada (editable on the review page). */
function region(loc: string): "CA" | "US" | "AF" {
  const p = loc.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/\b(usa|u\.s\.|united states|etats-unis|etats unis|texas|california|florida|ohio|georgia|michigan|illinois|pennsylvania|new york|arizona|louisiana|carolina|virginia|alabama|indiana|tennessee|kentucky|wisconsin|minnesota|missouri|colorado|nevada|utah|oregon|washington state|new jersey|massachusetts|oklahoma|kansas|iowa|nebraska|wyoming|montana|idaho|alaska|arkansas|mississippi)\b/.test(p)) return "US";
  if (/\b(afrique|africa|congo|rdc|drc|kinshasa|lubumbashi|kolwezi|cameroun|cameroon|cote d'ivoire|ivory coast|abidjan|senegal|dakar|nigeria|lagos|ghana|accra|kenya|nairobi|south africa|afrique du sud|maroc|morocco|algerie|algeria|tunisie|tunisia|egypte|egypt|gabon|benin|togo|burkina|mali|niger|guinee|guinea|tchad|chad|rwanda|burundi|tanzanie|tanzania|zambie|zambia|zimbabwe|mozambique|angola|namibie|namibia|botswana|ethiopie|ethiopia|ouganda|uganda|madagascar|mauritanie|mauritania)\b/.test(p)) return "AF";
  return "CA";
}

async function textOf(path: string): Promise<string> {
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error("resume not found");
  const bytes = new Uint8Array(await data.arrayBuffer());
  let text = "";
  if (bytes[0] === 0x25 && bytes[1] === 0x50) {
    const r = await extractText(await getDocumentProxy(bytes), { mergePages: true });
    text = String(r.text || "");
  } else if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const xml = strFromU8(unzipSync(bytes)["word/document.xml"] || new Uint8Array());
    text = xml.replace(/<w:tab\/>/g, "\t").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&quot;/g, '"');
  }
  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** Name, email and phone from the top of the resume. A scanned resume gives no text: the lead types them. */
async function contact(text: string) {
  const email = (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) ?? [""])[0];
  const phone = (text.match(/(\+?\d[\d ().-]{8,}\d)/) ?? [""])[0].trim();
  const out = { first_name: "", last_name: "", email, phone };
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key || text.length < 50) return out;
  const errs: string[] = [];
  for (const model of ["claude-haiku-5-5", "claude-sonnet-5-5"]) {   // the fast model first; the next one if it is unavailable
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 200,
          system: "You read the top of a resume and return only JSON: {\"first_name\":\"\",\"last_name\":\"\",\"email\":\"\",\"phone\":\"\"}. Use the resume owner's details exactly as written, with normal capitalization (Jean-Pierre, not JEAN-PIERRE). Empty string when absent. No other text.",
          messages: [{ role: "user", content: text.slice(0, 2500) }] }),
      });
      const j = await r.json();
      if (!r.ok) { errs.push(`${model}: ${String(j?.error?.message ?? r.status).slice(0, 120)}`); continue; }
      const m = String(j?.content?.[0]?.text ?? "").match(/\{[\s\S]*\}/);
      if (m) {
        const c = JSON.parse(m[0]);
        out.first_name = clean(c.first_name, 60); out.last_name = clean(c.last_name, 60);
        out.email = clean(c.email, 120) || email; out.phone = clean(c.phone, 40) || phone;
      }
      break;
    } catch (e) { errs.push(`${model}: ${String(e).slice(0, 120)}`); }   // pre-fill is a convenience: the form works without it
  }
  if (errs.length) (out as any)._err = errs;
  return out;
}

Deno.serve(async (r) => {
  if (r.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (r.method !== "POST") return json({ error: "method" }, 405);
  const b = await r.json().catch(() => ({}));
  if (clean(b.website)) return json({ ok: true });   // invisible anti-robot field: a person never fills it

  if (b.action === "slot") {
    const ext = String(b.filename ?? "").toLowerCase().match(/\.(pdf|docx)$/)?.[1];
    if (!ext) return json({ error: "type" }, 400);
    if (!(Number(b.size) > 0) || Number(b.size) > MAX) return json({ error: "size" }, 400);
    const path = `pending/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) return json({ error: "storage" }, 500);
    return json({ upload_id: path, signed_url: data.signedUrl });
  }

  if (b.action === "read") {
    if (!UPLOAD.test(b.upload_id ?? "")) return json({ error: "upload" }, 400);
    try { return json(await contact(await textOf(b.upload_id))); }
    catch (_) { return json({ first_name: "", last_name: "", email: "", phone: "" }); }
  }

  if (b.action === "submit") {
    const lang = b.lang === "FR" ? "FR" : "EN";
    const f = {
      first_name: clean(b.first_name, 60), last_name: clean(b.last_name, 60), email: clean(b.email, 120).toLowerCase(),
      phone: clean(b.phone, 40), target_family: String(b.target_family ?? ""), target_title: clean(b.target_title, 120),
      target_industry: clean(b.target_industry, 120), target_location: clean(b.target_location, 120), note: clean(b.note, 600),
    };
    const missing = ["first_name", "last_name", "email", "target_industry", "target_location"].filter((k) => !(f as any)[k]);
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(f.email)) missing.push("email");
    if (f.target_family !== "other" && !FAMILIES.includes(f.target_family)) missing.push("target_family");
    if (f.target_family === "other" && !f.target_title) missing.push("target_title");
    if (typeof b.in_mr !== "boolean") missing.push("in_mr");
    if (b.consent !== true) missing.push("consent");
    if (!UPLOAD.test(b.upload_id ?? "")) missing.push("resume");
    if (missing.length) return json({ error: "missing", fields: [...new Set(missing)] }, 400);

    const folder = b.upload_id.split("/")[0], name = b.upload_id.split("/")[1];
    const { data: ls } = await sb.storage.from(BUCKET).list(folder, { search: name });
    if (!(ls ?? []).some((o: any) => o.name === name)) return json({ error: "missing", fields: ["resume"] }, 400);

    // one request per email per 30 days (test runs excluded)
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const { count } = await sb.from("roadmap_requests").select("id", { count: "exact", head: true })
      .ilike("email", f.email).neq("source", "test").gte("created_at", since);
    if ((count ?? 0) > 0) return json({ error: "duplicate" }, 409);

    // source from the link: ?va=<code> (a VA's unit) or ?src=<code> (a channel); unknown or switched off -> direct
    const code = clean(b.va || b.src, 40).toLowerCase();
    let source = "direct";
    if (code) {
      const { data: s } = await sb.from("roadmap_sources").select("code,active").eq("code", code).maybeSingle();
      if (s?.active) source = s.code;
    }

    const now = new Date().toISOString();
    const { data: row, error } = await sb.from("roadmap_requests").insert({
      ...f, language: lang, source, region: region(f.target_location), in_mr: b.in_mr,
      target_role: f.target_family, target_family: f.target_family === "other" ? null : f.target_family,
      target_title: f.target_title || null, note: f.note || null, phone: f.phone || null,
      consent_at: now, resume_path: b.upload_id, status: "received",
    }).select("id").single();
    if (error) return json({ error: "save" }, 500);

    // the generator drafts the roadmap for Christian's review (status received -> generating -> to_review).
    // A test submission (?src=test) checks the form end to end without spending a generation.
    if (source === "test") return json({ ok: true, test: true });
    // @ts-ignore EdgeRuntime is provided by the Supabase runtime
    EdgeRuntime.waitUntil(fetch(URL_ + "/functions/v1/roadmap-generate", { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + SERVICE }, body: JSON.stringify({ request_id: row.id }) })
      .then((x) => x.text()).catch(() => null));
    return json({ ok: true });
  }
  return json({ error: "action" }, 400);
});
