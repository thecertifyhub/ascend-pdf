// roadmap-generate: turns one roadmap_requests row into a draft for review.
// POST {"request_id": "<uuid>"}. Only rows in status received (or error, for a retry) are processed.
// Secrets: ANTHROPIC_API_KEY (set by Christian), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (built in).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";
import { unzipSync, strFromU8 } from "npm:fflate@0.8.2";
import { checkOutput, selectDimensions, roiLine, bandOf, normalize, Issue } from "./checks.ts";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ORDER = ["specialist", "supervisor", "planner", "reliability_engineer", "manager", "asset_management"];

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function bytesToB64(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

async function claude(model: string, system: string, content: any, maxTokens = 8000): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content }] }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Claude API ${r.status}: ${j?.error?.message || JSON.stringify(j).slice(0, 300)}`);
  return (j.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
}

function parseJson(s: string): any {
  const t = s.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  return JSON.parse(t.slice(a, b + 1));
}

async function getJson(model: string, system: string, content: any[]): Promise<any> {
  const raw = await claude(model, system, content);
  try { return parseJson(raw); } catch (e) {
    const fixed = await claude(model, system, [...content, { type: "text", text: "Your previous answer was not valid JSON (" + String((e as Error).message) + "). Here it is:\n" + raw + "\n\nReturn the same content as one complete, valid JSON object. Escape any double quote inside a string. No prose." }]);
    return parseJson(fixed);
  }
}

async function resumeText(req: any, model: string): Promise<string> {
  if (req.resume_text && req.resume_text.trim().length > 200) return req.resume_text;
  if (!req.resume_path) throw new Error("no resume_path and no resume_text");
  let bytes: Uint8Array;
  if (req.resume_path.startsWith("pr:")) {
    const { data: pr } = await sb.from("positioning_reports").select("resume_b64").eq("id", req.resume_path.slice(3)).single();
    if (!pr?.resume_b64) throw new Error("positioning report resume not found");
    bytes = b64ToBytes(String(pr.resume_b64).replace(/^data:[^,]+,/, ""));
  } else {
    const { data, error } = await sb.storage.from("roadmap-resumes").download(req.resume_path);
    if (error || !data) throw new Error(`resume download: ${error?.message}`);
    bytes = new Uint8Array(await data.arrayBuffer());
  }
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50;
  let text = "";
  if (isPdf) {
    const pdf = await getDocumentProxy(bytes);
    const r = await extractText(pdf, { mergePages: true });
    text = String(r.text || "");
    if (text.replace(/\s/g, "").length < 300) {
      text = await claude(model, "Transcribe the document verbatim as plain text. No commentary.", [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: bytesToB64(bytes) } },
        { type: "text", text: "Transcribe this resume verbatim." },
      ]);
    }
  } else {
    const files = unzipSync(bytes);
    const xml = strFromU8(files["word/document.xml"] || new Uint8Array());
    text = xml.replace(/<w:tab\/>/g, "\t").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&quot;/g, '"');
  }
  text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 200) throw new Error("resume text too short after extraction");
  await sb.from("roadmap_requests").update({ resume_text: text }).eq("id", req.id);
  return text;
}

async function run(id: string) {
  const { data: req } = await sb.from("roadmap_requests").select("*").eq("id", id).single();
  if (!req) throw new Error("request not found");
  const [{ data: settings }, { data: rules }, { data: roles }, { data: wages }, { data: outlook }, { data: prices }] = await Promise.all([
    sb.from("roadmap_machine_settings").select("*").eq("id", 1).single(),
    sb.from("generator_rules").select("*").eq("active", true).order("version", { ascending: false }).limit(1).single(),
    sb.from("role_map").select("*"),
    sb.from("market_wages").select("*"),
    sb.from("market_outlook").select("*"),
    sb.from("roadmap_prices").select("*"),
  ]);
  const model = settings?.generator_model || "claude-opus-5-5";
  const lang = req.language === "FR" ? "FR" : "EN";
  const text = await resumeText(req, model);

  const occupations = [...new Map((wages || []).map((w: any) => [w.occupation_code, w.occupation_title])).entries()]
    .map(([code, title]) => ({ code, title }));
  const regionsAvailable = [...new Set((wages || []).map((w: any) => w.region))];

  const input = {
    language: lang,
    form: {
      target_role_family: req.target_family || "other",
      target_title_in_lead_words: req.target_title || req.target_role || null,
      target_industry: req.target_industry, target_location: req.target_location,
      works_in_mr_today: req.in_mr, pricing_region: req.region, va_note: req.note,
    },
    role_families: (roles || []).map((r: any) => ({ family: r.family, rung: r.rung, label: lang === "FR" ? r.label_fr : r.label_en, profile: r.dimension_profile })),
    available_occupations: occupations,
    available_market_regions: regionsAvailable,
    resume_text: text,
  };
  const extra = `\n\n## Extra output keys (code uses them to pick market rows)\n- current_occupation_code: the code from available_occupations for the person's CURRENT job at their real level (trade or technician code unless an engineering degree or licence is in the resume). It must be the same occupation, not a related one: a design or engineering technician is not a tradesperson, an electrical technician is not an industrial electrician. If no listed code is the same occupation, return null with a flag (code "no_current_occupation").\n- current_country: two-letter country code of where the person works today.\n- market_regions: 1 or 2 codes from available_market_regions matching the target location (and a second region only if the form or note names one). "CA" means Canada national. Empty if the target location is outside Canada (flag "no_market_data").\npillars[].name is always the English pillar name exactly as listed (it is a key, not shown). Write all lead-facing text in ${lang === "FR" ? "French" : "English"}.`;
  const system = rules!.rules_text + extra;

  const byFam = (f: string) => (roles || []).find((r: any) => r.family === f);
  const family = byFam(req.target_family);
  const base = [{ type: "text", text: JSON.stringify(input) }];
  let out = normalize(await getJson(model, system, base), lang);
  const fam = family || byFam(out?.target?.target_family);
  const profile: number[] = fam?.dimension_profile || [];

  // Wage slide (rules of Nov 24, 2026):
  // 1. The slide is always about the role the lead asked for. It never switches to another role.
  // 2. The "today" figure uses the lead's real current occupation. If that occupation is not in the wage table
  //    (current_occupation_code null), there is no today figure: the slide shows the target pay range.
  // 3. A gap is shown only when the target pays at least MIN_GAP_YEAR more than today in every region shown;
  //    otherwise the slide shows the target pay range (a small or negative gap is not a selling point).
  const MIN_GAP_YEAR = 5000, HOURS_YEAR = 2080;
  const marketBlock = () => {
    const regs: string[] = (out.market_regions || []).filter((r: string) => regionsAvailable.includes(r));
    const abroad = !!out.current_country && String(out.current_country).toUpperCase() !== "CA";
    const cur: string | null = abroad ? null : (out.current_occupation_code || null);
    const w = (code: string | null, r: string) => code ? ((wages || []).find((x: any) => x.occupation_code === code && x.region === r) || null) : null;
    const curFam = byFam(out?.today?.current_family);
    const chosen = fam || null;
    let rows = chosen ? regs.map((r) => ({ region: r, current: w(cur, r), target: w(chosen.occupation_code, r) })).filter((x) => x.target) : [];
    let variant = "range";
    let why = "";
    if (abroad) why = "current_abroad";
    else if (!cur) why = "no_current_match";
    else if (chosen && chosen.occupation_code === cur) why = "same_occupation";
    else if (rows.length && rows.every((x) => x.current)) {
      const gaps = rows.map((x) => (Number(x.target.median) - Number(x.current.median)) * HOURS_YEAR);
      if (gaps.every((g) => g >= MIN_GAP_YEAR)) variant = "gap";
      else why = gaps.some((g) => g <= 0) ? "pays_no_more" : "small_gap";
    } else if (rows.length) why = "no_current_wage";
    if (variant === "range") rows = rows.map((x) => ({ ...x, current: null }));
    return { regions: regs, current_code: cur, current_country: out.current_country || null, abroad, current_family: curFam?.family || null,
      stated_family: fam?.family || null, wage_family: chosen?.family || null, target_code: chosen?.occupation_code || null, variant, range_reason: why || null, rows };
  };
  const marketNumbers = (wages || []).flatMap((w: any) => [w.median, w.low, w.high].map(String))
    .concat((outlook || []).flatMap((o: any) => [o.openings, o.seekers, o.retirement_openings].filter(Boolean).map(String)))
    .concat([...(wages || []), ...(outlook || [])].flatMap((x: any) => String(x.period || "").match(/\d{4}/g) || []));

  const ctx = { language: lang as "EN" | "FR", profile, resumeText: text, firstName: req.first_name, lastName: req.last_name, marketNumbers };
  let issues: Issue[] = checkOutput(out, ctx);
  let retried = false;
  const firstIssues = issues.length;
  if (issues.length) {
    retried = true;
    out = normalize(await getJson(model, system, [...base,
      { type: "text", text: "Your previous JSON:\n" + JSON.stringify(out) + "\n\nThese checks failed. Fix only these fields and return the full corrected JSON object:\n" + issues.map((i) => `- ${i.field}: ${i.reason}`).join("\n") }]), lang);
    issues = checkOutput(out, ctx);
  }

  const mb = marketBlock();
  const gapsHourly = mb.variant === "gap" ? mb.rows.map((r: any) => Number(r.target.median) - Number(r.current.median)) : [];
  const priceRow = (prices || []).find((p: any) => p.region === req.region);
  const roi = priceRow && priceRow.currency === "CAD" ? roiLine(gapsHourly, priceRow) : null;
  const national = (outlook || []).find((o: any) => o.occupation_code === mb.target_code && o.geography === "Canada");
  const provincial = (outlook || []).filter((o: any) => o.occupation_code === mb.target_code && mb.regions.includes(o.geography));
  const flags = [...(out.flags || []), ...issues.map((i) => ({ code: "check_failed", field: i.field, reason: i.reason, red: true }))];
  if (!mb.rows.length) flags.push({ code: "no_market_data", reason: "no wage rows for this target and location" });
  const RANGE_WHY: Record<string, string> = {
    current_abroad: `works outside Canada today (${mb.current_country}): no current-wage row`,
    no_current_match: "the current job is not in the wage table: no today figure",
    same_occupation: "the target is the same occupation as today",
    pays_no_more: "the target pays no more than today's occupation",
    small_gap: "the gap with today is under 5,000 a year",
    no_current_wage: "no wage row for today's occupation in these regions",
  };
  if (mb.rows.length && mb.variant === "range") flags.push({ code: mb.range_reason === "current_abroad" ? "current_abroad" : "target_range_only", reason: `${RANGE_WHY[mb.range_reason || ""] || "no gap"}: slide shows the ${mb.stated_family || "target"} pay range` });
  if (gapsHourly.some((g) => g <= 0)) flags.push({ code: "pay_cut_blocked", red: true, reason: "a non-positive gap reached the wage slide" });
  if (mb.variant === "gap" && gapsHourly.length && !roi) flags.push({ code: "roi_hidden", reason: "annual gap under 5,000, payback line not shown" });
  if (req.in_mr === false) flags.push({ code: "not_in_mr", reason: "lead says they do not work in maintenance or reliability today" });
  if (fam && out?.pillars?.length === 5) out.expected_dimensions = selectDimensions(profile, out.pillars.map((p: any) => p.score));
  (out.pillars || []).forEach((p: any) => { if (Number.isInteger(p.score)) p.status = bandOf(p.score); });

  const draft = {
    ...out,
    market: { ...mb, periods: [...new Set(mb.rows.flatMap((r: any) => [r.current?.period, r.target?.period]).filter(Boolean))] },
    demand: { national: national || null, provincial },
    roi,
    prices: priceRow || null,
    meta: { model, generator_version: rules!.version, retried, first_pass_issues: firstIssues, checks_failed: issues.length },
  };
  await sb.from("roadmap_drafts").upsert({ request_id: id, json_generated: draft, flags, generated_at: new Date().toISOString() });
  await sb.from("roadmap_requests").update({ status: "to_review", generator_version: rules!.version, target_family: fam?.family || req.target_family, market_regions: mb.regions, error: null, updated_at: new Date().toISOString() }).eq("id", id);
}

Deno.serve(async (r) => {
  if (r.method !== "POST") return new Response("POST only", { status: 405 });
  if (!KEY) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY secret missing" }), { status: 500 });
  const { request_id } = await r.json().catch(() => ({}));
  if (!request_id) return new Response("request_id required", { status: 400 });
  const { data: claimed } = await sb.from("roadmap_requests").select("id,attempts,status").eq("id", request_id).in("status", ["received", "error"]).lt("attempts", 3).maybeSingle();
  if (!claimed) return new Response(JSON.stringify({ skipped: true }), { status: 200 });
  await sb.from("roadmap_requests").update({ status: "generating", attempts: (claimed.attempts || 0) + 1, updated_at: new Date().toISOString() }).eq("id", request_id);
  const job = run(request_id).catch(async (e) => {
    await sb.from("roadmap_requests").update({ status: "error", error: String(e?.message || e).slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", request_id);
  });
  // @ts-ignore EdgeRuntime is provided by Supabase
  EdgeRuntime.waitUntil(job);
  return new Response(JSON.stringify({ accepted: true }), { status: 202 });
});
