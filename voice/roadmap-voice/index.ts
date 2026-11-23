// roadmap-voice: narration for the Free Roadmap Machine.
// Every call carries {"secret": <pr_settings.engine_secret>}.
// POST {"request_id": "<uuid>"}   voice one approved roadmap (status approved -> voicing -> voiced; the voiced status
//                                  triggers the deck build on Render)
// POST {"action": "standard", "lang": "EN"|"FR"}   (re)record the standard slides (7 to 9, 11 to 17) for a language
// POST {"action": "voices"}        list the account's ElevenLabs voices (id, name, language) for choosing the roadmap voice
//
// How a roadmap is voiced: the personalized slides (1 to 6, 10) are filled from the approved JSON and the script templates
// (roadmap_script_templates, click markers [[n]] where reveal n starts). Slides 1 to 6 are generated in one ElevenLabs
// request (one continuous read), slide 10 in another. Each piece is force-aligned, cut into one MP3 per slide at the
// middle of the pause between slides, and each reveal's time is read from the aligned word after its marker. Standard
// slides are recorded once per language and template version and reused. The result is a manifest per lead: for every
// deck slide (1 to 17), a signed URL of its clip, its length and its reveal times, read by the build service.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { personalTexts, standardTexts, markers, plan, type Lang, type SlideText } from "https://raw.githubusercontent.com/thecertifyhub/ascend-pdf/4939f9ff7934f6d1cd07ceb1f090185b17f11dda/voice/roadmap-voice/fill.ts";
import { frameList, slice, FRAME_S } from "./mp3.ts";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const EL = "https://api.elevenlabs.io";
const BUCKET = "roadmap-audio";
const LEAD_S = 0.15;          // a reveal starts just before its word
const SAME_WORD_GAP_S = 0.6;  // reveals that share a word are staggered
const norm = (s: string) => (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’‘]/g, "'").replace(/[^a-z0-9']+/g, "");

async function settings() {
  const { data } = await sb.from("roadmap_machine_settings").select("*").eq("id", 1).single();
  return data;
}
function key() {
  const k = Deno.env.get("ELEVENLABS_API_KEY");
  if (!k) throw new Error("ELEVENLABS_API_KEY secret is not set");
  return k;
}
async function templates(lang: Lang) {
  const { data, error } = await sb.from("roadmap_script_templates").select("key,text,version").eq("language", lang);
  if (error) throw new Error("templates: " + error.message);
  const v = Math.max(...(data ?? []).map((r: any) => r.version));
  const T: Record<string, string> = {};
  for (const r of data ?? []) if (r.version === v) T[r.key] = r.text;
  if (!T.s01) throw new Error(`no script templates for ${lang}`);
  return { T, version: v };
}

async function tts(text: string, voice: string, s: any): Promise<Uint8Array> {
  const r = await fetch(`${EL}/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: "POST", headers: { "xi-api-key": key(), "Content-Type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: s.tts_model ?? "eleven_v3", voice_settings: { stability: Number(s.tts_stability ?? 1.0) } }),
  });
  if (!r.ok) throw new Error(`ElevenLabs TTS ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return new Uint8Array(await r.arrayBuffer());
}
async function align(mp3: Uint8Array, text: string) {
  const form = new FormData();
  form.append("file", new Blob([mp3], { type: "audio/mpeg" }), "piece.mp3");
  form.append("text", text);
  const r = await fetch(`${EL}/v1/forced-alignment`, { method: "POST", headers: { "xi-api-key": key() }, body: form });
  if (!r.ok) throw new Error(`ElevenLabs alignment ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  return (j.words ?? []).filter((w: any) => (w.text ?? "").trim() !== "") as { text: string; start: number; end: number }[];
}

type Clip = { slide: number; bytes: Uint8Array; ms: number; clicks: number[]; text: string };

/** Voice a piece made of consecutive slides; cut it into one clip per slide. */
async function voicePiece(slides: SlideText[], voice: string, s: any, log: any[]): Promise<Clip[]> {
  const parsed = slides.map((x) => ({ slide: x.slide, ...markers(x.text) }));
  const text = parsed.map((p) => p.clean).join("\n\n");
  const mp3 = await tts(text, voice, s);
  const words = await align(mp3, text);
  const mine = parsed.flatMap((p, k) => p.words.map((w, i) => ({ k, i, w })));
  // map my words to aligned words: same count -> by index; otherwise greedy by normalized text
  const at: { start: number; end: number }[] = new Array(mine.length);
  if (words.length === mine.length) mine.forEach((_, j) => (at[j] = words[j]));
  else {
    let q = 0;
    for (let j = 0; j < mine.length; j++) {
      const t = norm(mine[j].w); let hit = -1;
      for (let z = q; z < Math.min(words.length, q + 6); z++) if (norm(words[z].text) === t) { hit = z; break; }
      if (hit < 0) hit = Math.min(q, words.length - 1);
      at[j] = words[hit]; q = hit + 1;
    }
  }
  log.push({ step: "piece", slides: slides.map((x) => x.slide), chars: text.length, bytes: mp3.length, words: words.length, mine: mine.length });
  const fr = frameList(mp3);
  const total = fr.length * FRAME_S;
  // slide k occupies my words [first[k], first[k+1])
  const first: number[] = []; let n = 0;
  for (const p of parsed) { first.push(n); n += p.words.length; }
  const cut: number[] = [0];
  for (let k = 1; k < parsed.length; k++) {
    const a = at[first[k] - 1], b = at[first[k]];
    cut.push(Math.max(cut[k - 1], (a.end + b.start) / 2));
  }
  cut.push(total);
  const clips: Clip[] = [];
  for (let k = 0; k < parsed.length; k++) {
    const f0 = Math.round(cut[k] / FRAME_S), f1 = Math.round(cut[k + 1] / FRAME_S);
    const bytes = slice(mp3, fr, f0, f1);
    const t0 = f0 * FRAME_S, ms = Math.round((f1 - f0) * FRAME_S * 1000);
    const p = parsed[k], nw = p.words.length;
    const byN = new Map<number, number>(); const used = new Map<number, number>();
    for (const m of [...p.marks].sort((x, y) => x.n - y.n)) {
      let t: number;
      if (m.word >= nw) t = at[first[k] + nw - 1].end - t0;
      else t = at[first[k] + m.word].start - LEAD_S - t0;
      const c = used.get(m.word) ?? 0; used.set(m.word, c + 1);
      byN.set(m.n, Math.max(0, Math.round((t + c * SAME_WORD_GAP_S) * 1000)));
    }
    const maxN = Math.max(0, ...byN.keys());
    const clicks: number[] = []; let last = 0;
    for (let c = 1; c <= maxN; c++) { last = byN.get(c) ?? last; clicks.push(last); }
    clips.push({ slide: p.slide, bytes, ms, clicks, text: p.clean });
  }
  return clips;
}

async function store(path: string, bytes: Uint8Array) {
  const { error } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: "audio/mpeg", upsert: true });
  if (error) throw new Error("storage: " + error.message);
}
async function sign(path: string) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 30);
  if (error) throw new Error("sign: " + error.message);
  return data.signedUrl;
}

/** Standard clips for a language at the current template version. Recorded once; when a template text changes or the
 *  language's voice or the ElevenLabs model changes, only the slides concerned are recorded again (credits). force = record all ten. */
async function standard(lang: Lang, s: any, log: any[], force = false) {
  const { T, version } = await templates(lang);
  const { data: have } = await sb.from("roadmap_audio").select("slide,path,ms,clicks,text,voice_id,tts_model").is("request_id", null).eq("language", lang).eq("version", version);
  const voice = lang === "FR" ? s.roadmap_voice_id_fr : s.roadmap_voice_id;
  if (!voice) throw new Error(`no roadmap voice set for ${lang} (roadmap_machine_settings)`);
  const model = s.tts_model ?? "eleven_v3";
  const st = standardTexts(T);
  const byslide = new Map((have ?? []).map((r: any) => [r.slide, r]));
  const todo = force || (have ?? []).length !== st.length ? st
    : st.filter((x) => byslide.get(x.slide)?.text !== markers(x.text).clean || byslide.get(x.slide)?.voice_id !== voice
      || byslide.get(x.slide)?.tts_model !== model);
  if (!todo.length) return have!;
  // one ElevenLabs request per run of consecutive slides (7-9, 11-17), only for the slides to record
  const runs: SlideText[][] = [];
  for (const x of todo) {
    const last = runs[runs.length - 1];
    if (last && STANDARD_RUN(last[last.length - 1].slide) === STANDARD_RUN(x.slide)) last.push(x); else runs.push([x]);
  }
  const clips: any[] = [];
  for (const r of runs) clips.push(...await voicePiece(r, voice, s, log));
  log.push({ step: "standard", lang, version, recorded: clips.map((c) => c.slide) });
  const rows = [];
  for (const c of clips) {
    const path = `standard/${lang}/v${version}/s${String(c.slide).padStart(2, "0")}.mp3`;
    await store(path, c.bytes);
    rows.push({ request_id: null, language: lang, version, slide: c.slide, path, ms: c.ms, clicks: c.clicks, text: c.text, bytes: c.bytes.length, voice_id: voice, tts_model: model });
  }
  await sb.from("roadmap_audio").delete().is("request_id", null).eq("language", lang).eq("version", version).in("slide", rows.map((r) => r.slide));
  const { error } = await sb.from("roadmap_audio").insert(rows);
  if (error) throw new Error("roadmap_audio: " + error.message);
  const { data: all } = await sb.from("roadmap_audio").select("slide,path,ms,clicks,text").is("request_id", null).eq("language", lang).eq("version", version);
  return all!;
}
const STANDARD_RUN = (n: number) => (n <= 9 ? 0 : 1);

async function voiceRequest(id: string) {
  const log: any[] = [];
  const { data: r } = await sb.from("roadmap_requests").select("*").eq("id", id).single();
  if (!r || !["approved", "voicing", "error"].includes(r.status)) return;
  await sb.from("roadmap_requests").update({ status: "voicing", error: null, updated_at: new Date().toISOString() }).eq("id", id);
  try {
    const s = await settings();
    const lang: Lang = r.language === "FR" ? "FR" : "EN";
    const { data: d } = await sb.from("roadmap_drafts").select("json_approved").eq("request_id", id).single();
    const doc = d?.json_approved;
    if (!doc) throw new Error("no approved roadmap");
    const std = await standard(lang, s, log);
    const { T, version } = await templates(lang);
    const voice = lang === "FR" ? s.roadmap_voice_id_fr : s.roadmap_voice_id;
    const pt = personalTexts(doc, r, T, lang);
    // pieces: slides 1-6, then slide 10 (+ slide 15 when the roadmap has a payback line)
    const clips = [...await voicePiece(pt.filter((x) => x.slide <= 6), voice, s, log),
      ...await voicePiece(pt.filter((x) => x.slide === 10 || x.slide === 15), voice, s, log)];
    await sb.from("roadmap_audio").delete().eq("request_id", id);
    const rows = [];
    for (const c of clips) {
      const path = `${id}/s${String(c.slide).padStart(2, "0")}.mp3`;
      await store(path, c.bytes);
      rows.push({ request_id: id, language: lang, version, slide: c.slide, path, ms: c.ms, clicks: c.clicks, text: c.text, bytes: c.bytes.length, voice_id: voice, tts_model: s.tts_model ?? "eleven_v3" });
    }
    const { error } = await sb.from("roadmap_audio").insert(rows);
    if (error) throw new Error("roadmap_audio: " + error.message);
    const mine = new Set(rows.map((x) => x.slide));   // a personal clip replaces the standard one (slide 15)
    const all = [...rows, ...std.filter((x: any) => !mine.has(x.slide))].sort((a: any, b: any) => a.slide - b.slide);
    const manifest = [];
    for (const a of all) manifest.push({ slide: a.slide, url: await sign(a.path), ms: a.ms, clicks: a.clicks });
    const { drop } = plan(doc);
    await sb.from("roadmap_requests").update({ status: "voiced", voice_manifest: { slides: manifest, dropped: drop, version, log },
      updated_at: new Date().toISOString() }).eq("id", id);
  } catch (e) {
    log.push({ step: "exception", error: String((e as Error)?.message ?? e) });
    await sb.from("roadmap_requests").update({ status: "error", error: "voice: " + String((e as Error)?.message ?? e),
      voice_manifest: { log }, updated_at: new Date().toISOString() }).eq("id", id);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const body = await req.json().catch(() => ({}));
  // only the database (trigger) and Claude's SQL calls know the engine secret: nothing here can be run from outside
  const { data: ps } = await sb.from("pr_settings").select("engine_secret").eq("id", 1).single();
  if (!body.secret || body.secret !== ps?.engine_secret) return new Response("unauthorized", { status: 401 });
  if (body.action === "voices") {
    const r = await fetch(`${EL}/v2/voices?page_size=100`, { headers: { "xi-api-key": key() } });
    const j = await r.json();
    const vs = (j.voices ?? []).map((v: any) => ({ id: v.voice_id, name: v.name, category: v.category,
      language: v.labels?.language ?? v.verified_languages?.map((x: any) => x.language).join("/") ?? null, accent: v.labels?.accent ?? null }));
    return new Response(JSON.stringify({ status: r.status, voices: vs }), { headers: { "Content-Type": "application/json" } });
  }
  if (body.action === "standard") {
    const lang: Lang = body.lang === "FR" ? "FR" : "EN";
    // @ts-ignore EdgeRuntime is provided by the Supabase runtime
    EdgeRuntime.waitUntil((async () => {
      const log: any[] = [];
      try { await standard(lang, await settings(), log, body.force === true); }
      catch (e) { log.push({ error: String((e as Error)?.message ?? e) }); }
      await sb.from("roadmap_machine_settings").update({ standard_log: { lang, at: new Date().toISOString(), log } }).eq("id", 1);
    })());
    return new Response(JSON.stringify({ accepted: "standard", lang }), { status: 202 });
  }
  const id = body.request_id;
  if (!/^[0-9a-f-]{36}$/.test(id ?? "")) return new Response("request_id required", { status: 400 });
  // @ts-ignore EdgeRuntime is provided by the Supabase runtime
  EdgeRuntime.waitUntil(voiceRequest(id));
  return new Response(JSON.stringify({ accepted: id }), { status: 202 });
});
