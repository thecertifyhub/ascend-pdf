// roadmap-review: API for Christian's review page, plus GET /app.js (the page script).
// Auth: a signed-in Supabase user whose email is in roadmap_admins. verify_jwt is off because the
// script itself is fetched without a token; every API action checks the user.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { APP_JS } from "./app.ts";
import { nameAuto } from "./names.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(URL_, SERVICE);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const TITLES: Record<string, string[]> = {
  EN: ["", "Leadership depth", "Reliability-driven decision-making", "Business impact of actions", "Systems thinking", "Operational complexity management", "Cross-functional influence", "Strategic maintenance ownership", "Executive communication"],
  FR: ["", "Profondeur du leadership", "Prise de décision basée sur l'analyse de fiabilité", "Impact business des actions", "Vision système", "Gestion de la complexité opérationnelle", "Influence transversale", "Maîtrise stratégique de la maintenance", "Communication exécutive"],
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const now = () => new Date().toISOString();

function tidy(doc: any, lang: string) {
  (doc?.gaps || []).forEach((g: any) => { g.n = Number(g.n); g.title = TITLES[lang][g.n] || g.title; });
  (doc?.pillars || []).forEach((p: any) => { p.score = Number(p.score); p.status = p.score >= 8 ? "green" : p.score >= 6 ? "yellow" : "red"; });
  if (doc?.name_voice) doc.name_voice.use = doc.name_voice.use === true || doc.name_voice.use === "true";
  return doc;
}

function b64(u: Uint8Array) {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

Deno.serve(async (r) => {
  if (r.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const u = new URL(r.url);
  if (r.method === "GET" && u.pathname.endsWith("/app.js")) {
    return new Response(APP_JS, { headers: { ...CORS, "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-cache" } });
  }
  if (r.method !== "POST") return json({ error: "POST only" }, 405);

  const token = (r.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: ud } = await sb.auth.getUser(token);
  const email = ud?.user?.email?.toLowerCase();
  if (!email) return json({ error: "Please sign in." }, 401);
  const { data: adm } = await sb.from("roadmap_admins").select("email").eq("email", email).maybeSingle();
  if (!adm) return json({ error: "This account is not a roadmap admin." }, 403);

  const body = await r.json().catch(() => ({}));
  const a = body.action;

  if (a === "list") {
    let q = sb.from("roadmap_requests").select("id,first_name,last_name,language,source,status,target_family,target_title,created_at").order("created_at", { ascending: false }).limit(200);
    if (body.status && body.status !== "all") q = q.eq("status", body.status);
    const { data: items, error } = await q;
    if (error) return json({ error: error.message }, 500);
    const ids = (items || []).map((i: any) => i.id);
    const { data: drafts } = ids.length ? await sb.from("roadmap_drafts").select("request_id,flags").in("request_id", ids) : { data: [] };
    const fm = new Map((drafts || []).map((d: any) => [d.request_id, d.flags || []]));
    const { data: settings } = await sb.from("roadmap_machine_settings").select("review_mode,clean_streak").eq("id", 1).single();
    return json({ settings, items: (items || []).map((i: any) => {
      const f: any[] = (fm.get(i.id) as any[]) || [];
      return { ...i, red: f.filter((x) => x.red).length, flags: f.filter((x) => !x.red).length };
    }) });
  }

  const id = body.id;
  if (!id) return json({ error: "id required" }, 400);
  const { data: req } = await sb.from("roadmap_requests").select("*").eq("id", id).single();
  if (!req) return json({ error: "request not found" }, 404);
  const lang = req.language === "FR" ? "FR" : "EN";

  // ---- delivery: deck links, video upload, personal page link
  const DELIVERY = ["ready_to_export", "video_ready", "sent"];
  if (a === "delivery") {
    if (!DELIVERY.includes(req.status)) return json({ error: "Not built yet." }, 409);
    const { data: files } = await sb.from("roadmap_files").select("kind,path").eq("request_id", id);
    const links: Record<string, string> = {};
    for (const f of files || []) {
      if (!f.path) continue;
      const { data: su } = await sb.storage.from("roadmap-decks").createSignedUrl(f.path, 60 * 60 * 24, { download: true });
      if (su) links[f.kind] = su.signedUrl;
    }
    const { data: ms } = await sb.from("roadmap_machine_settings").select("page_base,booking_url_en,booking_url_fr").eq("id", 1).single();
    return json({ links, video_path: req.video_path, video_at: req.video_at,
      page_url: req.video_path ? (ms?.page_base || "") + "?id=" + req.token : null,
      booking_url: lang === "FR" ? ms?.booking_url_fr : ms?.booking_url_en });
  }
  if (a === "video_slot") {
    if (!DELIVERY.includes(req.status)) return json({ error: "Not built yet." }, 409);
    const path = `${id}/roadmap_${Date.now()}.mp4`;
    const { data: up, error } = await sb.storage.from("roadmap-videos").createSignedUploadUrl(path);
    if (error) return json({ error: error.message }, 500);
    return json({ path, token: up.token });
  }
  if (a === "video_done") {
    const path = String(body.path || "");
    if (!path.startsWith(id + "/")) return json({ error: "bad path" }, 400);
    const { data: ls } = await sb.storage.from("roadmap-videos").list(id, { search: path.split("/")[1] });
    const obj = (ls || []).find((o: any) => `${id}/${o.name}` === path);
    if (!obj) return json({ error: "The video did not arrive. Try again." }, 400);
    const old = req.video_path;
    await sb.from("roadmap_requests").update({ video_path: path, video_at: now(),
      status: req.status === "ready_to_export" ? "video_ready" : req.status, updated_at: now() }).eq("id", id);
    if (old && old !== path) await sb.storage.from("roadmap-videos").remove([old]);
    const { data: ms } = await sb.from("roadmap_machine_settings").select("page_base").eq("id", 1).single();
    return json({ message: "Video uploaded.", page_url: (ms?.page_base || "") + "?id=" + req.token,
      size_mb: Math.round((obj.metadata?.size || 0) / 1048576) });
  }

  if (a === "get") {
    const { data: draft } = await sb.from("roadmap_drafts").select("*").eq("request_id", id).maybeSingle();
    return json({ request: req, draft, name_auto: nameAuto(req.first_name, lang) });
  }

  if (a === "preview_name") {
    // the first sentence of slide 1 with the name, in the roadmap voice (about 60 characters)
    const say = String(body.say || "").trim().slice(0, 40);
    if (!say) return json({ error: "Type the name to say." }, 400);
    const key = Deno.env.get("ELEVENLABS_API_KEY");
    if (!key) return json({ error: "ELEVENLABS_API_KEY secret is not set" }, 500);
    const { data: s } = await sb.from("roadmap_machine_settings").select("roadmap_voice_id,roadmap_voice_id_fr,tts_model,tts_stability").eq("id", 1).single();
    const voice = lang === "FR" ? s?.roadmap_voice_id_fr : s?.roadmap_voice_id;
    const text = lang === "FR" ? `Bonjour ${say}, et merci de prendre le temps de regarder cette feuille de route.`
      : `Hello ${say}, and thank you for taking the time to look at this roadmap.`;
    const t = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
      method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: s?.tts_model ?? "eleven_v3", voice_settings: { stability: Number(s?.tts_stability ?? 1.0) } }),
    });
    if (!t.ok) return json({ error: `ElevenLabs ${t.status}: ${(await t.text()).slice(0, 200)}` }, 502);
    return json({ audio: b64(new Uint8Array(await t.arrayBuffer())), text });
  }

  // ---- rewrite one gap card after the reviewer picks another dimension (Claude, same rules as the generator)
  if (a === "rewrite_gap") {
    const i = Number(body.i), n = Number(body.n);
    if (!(i >= 0 && i <= 2) || !(n >= 1 && n <= 8)) return json({ error: "bad gap" }, 400);
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ANTHROPIC_API_KEY secret is not set" }, 500);
    const doc = body.doc || {};
    const { data: s } = await sb.from("roadmap_machine_settings").select("generator_model").eq("id", 1).single();
    const others = (doc.gaps || []).filter((_: any, k: number) => k !== i).map((g: any) => TITLES[lang][Number(g.n)] + ": " + (g.text || ""));
    const system = [
      "You write one gap card for a free career roadmap in maintenance and reliability. Return JSON only: {\"text\", \"evidence\", \"sentence\"}.",
      `Language: ${lang === "FR" ? "French, vous form, full accents, French number format (500 $)" : "English"}. Speak to the lead directly. Never use the lead's name.`,
      `The gap dimension is: "${TITLES[lang][n]}".`,
      "text: exactly two sentences, 40 words maximum in total, each sentence under 30 words. Sentence 1 names a real strength from the resume. Sentence 2 says what the target role expects in this dimension that is not shown yet.",
      "evidence: one short line quoting or citing the resume facts you used (reviewer only, English).",
      "sentence: one spoken sentence for the narration of this gap, under 30 words, natural when read aloud.",
      "Rules: only facts from the resume; no numbers that are not in the resume; explain any acronym in parentheses the first time; no em dashes;",
      "never write 'resume shows', 'your resume', 'your profile', 'appears to', 'seems to', 'votre CV', 'semble'; do not repeat the other two gaps.",
    ].join("\n");
    const user = JSON.stringify({ target_role: doc.target?.target_role_label || req.target_title || req.target_family, current_title: doc.today?.current_title,
      pillar_scores: (doc.pillars || []).map((p: any) => ({ name: p.name, score: p.score })), other_gaps: others, resume_text: String(req.resume_text || "").slice(0, 15000) });
    const r2 = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: s?.generator_model || "claude-opus-5-5", max_tokens: 1200, system, messages: [{ role: "user", content: user }] }) });
    const jj = await r2.json();
    if (!r2.ok) return json({ error: "Claude: " + (jj?.error?.message || r2.status) }, 502);
    const raw = (jj.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    try {
      const o = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
      return json({ text: String(o.text || "").replace(/\u2014/g, ","), evidence: String(o.evidence || ""), sentence: String(o.sentence || "").replace(/\u2014/g, ","), title: TITLES[lang][n] });
    } catch { return json({ error: "Could not read the rewrite. Try again." }, 502); }
  }

  const changes: any[] = Array.isArray(body.changes) ? body.changes : [];
  const logEdits = async () => {
    if (!changes.length) return;
    await sb.from("roadmap_edits").insert(changes.map((c) => ({
      request_id: id, field: String(c.field).slice(0, 200), before: c.before ?? null, after: c.after ?? null,
      reason: body.reason || null, generator_version: req.generator_version, edited_by: email,
    })));
  };
  const saveDoc = async () => {
    if (body.doc && changes.length) await sb.from("roadmap_drafts").update({ json_approved: tidy(body.doc, lang) }).eq("request_id", id);
  };
  // the name switch is a delivery choice, not a correction of the generator: it never resets the clean streak
  const corrections = changes.filter((c) => !String(c.field).startsWith("name_voice"));

  if (a === "save") {
    await logEdits(); await saveDoc();
    return json({ message: changes.length ? `Saved ${changes.length} change(s).` : "No changes to save." });
  }

  if (a === "approve") {
    await logEdits();
    const { data: draft } = await sb.from("roadmap_drafts").select("json_generated,json_approved,flags").eq("request_id", id).single();
    const finalDoc = tidy(changes.length ? body.doc : (draft?.json_approved || draft?.json_generated), lang);
    await sb.from("roadmap_drafts").update({ json_approved: finalDoc, approved_at: now() }).eq("request_id", id);
    const { count: editCount } = await sb.from("roadmap_edits").select("id", { count: "exact", head: true }).eq("request_id", id).not("field", "like", "name_voice%");
    const red = (draft?.flags || []).some((f: any) => f.red);
    const clean = !red && !editCount && !corrections.length;
    const { data: s } = await sb.from("roadmap_machine_settings").select("clean_streak,review_mode").eq("id", 1).single();
    const streak = clean ? (s?.clean_streak || 0) + 1 : 0;
    const mode = streak >= 20 ? "sample" : (s?.review_mode === "sample" && !clean ? "all" : s?.review_mode || "all");
    await sb.from("roadmap_machine_settings").update({ clean_streak: streak, review_mode: mode }).eq("id", 1);
    await sb.from("roadmap_requests").update({ status: "approved", reviewed_at: now(), updated_at: now() }).eq("id", id);
    return json({ message: clean ? `Approved. Clean streak ${streak} of 20.` : "Approved. Corrections logged; clean streak reset." });
  }

  if (a === "regenerate") {
    await logEdits();
    const note = String(body.note || "").trim();
    const newNote = note ? [req.note, "Reviewer instruction: " + note].filter(Boolean).join("\n") : req.note;
    await sb.from("roadmap_requests").update({ status: "received", attempts: 0, error: null, note: newNote, review_note: note || req.review_note, updated_at: now() }).eq("id", id);
    await sb.from("roadmap_drafts").update({ json_approved: null }).eq("request_id", id);
    const gen = await fetch(URL_ + "/functions/v1/roadmap-generate", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + SERVICE }, body: JSON.stringify({ request_id: id }) });
    return json({ message: gen.ok ? "Regenerating. Back on the list in about 2 minutes." : "Queued, but the generator did not answer: " + gen.status });
  }

  if (a === "hold" || a === "not_fit") {
    await logEdits(); await saveDoc();
    await sb.from("roadmap_requests").update({ status: a, review_note: body.note || req.review_note, reviewed_at: now(), updated_at: now() }).eq("id", id);
    return json({ message: a === "hold" ? "On hold." : "Marked not a fit." });
  }

  return json({ error: "unknown action" }, 400);
});
