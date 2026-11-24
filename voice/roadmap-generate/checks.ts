// Code checks for the Free Roadmap generator output. Pure functions, no I/O.

export const PILLARS = [
  "Business & Management",
  "Manufacturing Process Reliability",
  "Equipment Reliability",
  "Organization & Leadership",
  "Work Management",
];

export const DIM_PILLARS: Record<number, number[]> = {
  1: [3], 2: [2], 3: [0], 4: [1], 5: [4], 6: [3], 7: [0, 4], 8: [0, 3],
};

export const DIM_TITLES: Record<number, { EN: string; FR: string }> = {
  1: { EN: "Leadership depth", FR: "Profondeur du leadership" },
  2: { EN: "Reliability-driven decision-making", FR: "Prise de décision basée sur l'analyse de fiabilité" },
  3: { EN: "Business impact of actions", FR: "Impact business des actions" },
  4: { EN: "Systems thinking", FR: "Vision système" },
  5: { EN: "Operational complexity management", FR: "Gestion de la complexité opérationnelle" },
  6: { EN: "Cross-functional influence", FR: "Influence transversale" },
  7: { EN: "Strategic maintenance ownership", FR: "Maîtrise stratégique de la maintenance" },
  8: { EN: "Executive communication", FR: "Communication exécutive" },
};

const BANNED_EN = [
  "resume shows", "resume demonstrates", "resume mentions", "resume indicates", "your resume",
  "profile shows", "your profile", "linkedin shows", "your cv", "cv shows", "the document",
  "appears to", "seems to", "the credential", "most appropriate next step",
];
const BANNED_FR = [
  "votre cv", "le cv", "votre profil", "le profil montre", "semble", "il apparaît",
  "la certification de référence", "l'étape la plus appropriée", "la prochaine étape la plus appropriée",
];
const ACRONYM_OK = new Set(["CMRP", "SMRP", "CAMA", "PMP", "ISO", "ANSI", "OK", "CV", "GTA", "USD", "CAD"]);
const NUMBER_OK = new Set(["1", "2", "3", "4", "5", "6", "7", "8", "10", "12", "24", "48"]);

export type Issue = { field: string; code: string; reason: string };

export function bandOf(score: number): string {
  return score >= 8 ? "green" : score >= 6 ? "yellow" : "red";
}

export function words(s: string): number {
  return (s || "").trim().split(/\s+/).filter(Boolean).length;
}

export function selectDimensions(profile: number[], scores: number[]): number[] {
  const withScore = profile.map((d, i) => ({
    d, i, s: Math.min(...DIM_PILLARS[d].map((p) => scores[p])),
  }));
  withScore.sort((a, b) => a.s - b.s || a.i - b.i);
  return withScore.slice(0, 3).map((x) => x.d).sort((a, b) => profile.indexOf(a) - profile.indexOf(b));
}

// Lead-facing text only (requirements.notes and evidence lines are review-page only and not checked here).
export function leadFacing(out: any): { field: string; text: string }[] {
  const t: { field: string; text: string }[] = [];
  const sv = out?.script_vars || {};
  for (const k of Object.keys(sv)) {
    const v = sv[k];
    if (Array.isArray(v)) v.forEach((x: any, i: number) => t.push({ field: `script_vars.${k}[${i}]`, text: typeof x === "string" ? x : JSON.stringify(x ?? "") }));
    else t.push({ field: `script_vars.${k}`, text: typeof v === "string" ? v : JSON.stringify(v ?? "") });
  }
  (out?.gaps || []).forEach((g: any, i: number) => t.push({ field: `gaps[${i}].text`, text: String(g?.text ?? "") }));
  (out?.pillars || []).forEach((p: any, i: number) => t.push({ field: `pillars[${i}].note`, text: String(p?.note ?? "") }));
  return t;
}

function normNum(s: string): string {
  return s.replace(/[\s,\u00A0\u202F]/g, "").replace(/\.0+$/, "");
}

export function checkOutput(out: any, ctx: {
  language: "EN" | "FR";
  profile: number[];
  resumeText: string;
  firstName?: string;
  lastName?: string;
  marketNumbers: string[];
}): Issue[] {
  const issues: Issue[] = [];
  const add = (field: string, code: string, reason: string) => issues.push({ field, code, reason });

  const pillars = out?.pillars;
  if (!Array.isArray(pillars) || pillars.length !== 5) {
    add("pillars", "structure", "pillars must be an array of exactly 5 in the fixed order");
  } else {
    pillars.forEach((p: any, i: number) => {
      if (p?.name !== PILLARS[i]) add(`pillars[${i}].name`, "structure", `name must be "${PILLARS[i]}"`);
      const s = p?.score;
      if (!Number.isInteger(s) || s < 0 || s > 10) add(`pillars[${i}].score`, "structure", "score must be an integer 0 to 10");
      else if (!String(p?.evidence || "").trim()) add(`pillars[${i}].evidence`, "evidence", "every score must cite the resume line that justifies it");
      if (words(p?.note) > 25) add(`pillars[${i}].note`, "length", `note is ${words(p?.note)} words, max 25`);
    });
  }

  const gaps = out?.gaps;
  if (!Array.isArray(gaps) || gaps.length !== 3) add("gaps", "structure", "gaps must be exactly 3");
  else {
    gaps.forEach((g: any, i: number) => {
      const n = g?.n;
      const title = DIM_TITLES[n]?.[ctx.language];
      if (!title) add(`gaps[${i}].n`, "structure", "n must be a dimension number 1 to 8");
      else if (g?.title !== title) add(`gaps[${i}].title`, "verbatim", `title must be exactly "${title}"`);
      if (words(g?.text) > 40) add(`gaps[${i}].text`, "length", `text is ${words(g?.text)} words, max 40`);
      const sentences = String(g?.text || "").split(/[.!?](?:\s|$)/).filter((x) => x && x.trim().length > 2);
      if (sentences.length !== 2) add(`gaps[${i}].text`, "shape", "text must be exactly two sentences");
      if (!String(g?.evidence || "").trim()) add(`gaps[${i}].evidence`, "evidence", "each gap needs its evidence line");
    });
    const firstWords = gaps.map((g: any) => String(g?.text || "").trim().split(/\s+/)[0]?.toLowerCase());
    if (new Set(firstWords).size === 1) add("gaps", "pattern", "the 3 gap cards must use 3 different patterns (A, B, C)");
    if (Array.isArray(pillars) && pillars.length === 5 && pillars.every((p: any) => Number.isInteger(p?.score)) && ctx.profile.length) {
      const expected = selectDimensions(ctx.profile, pillars.map((p: any) => p.score));
      const got = gaps.map((g: any) => g?.n).slice().sort((a: number, b: number) => ctx.profile.indexOf(a) - ctx.profile.indexOf(b));
      if (expected.join(",") !== got.join(",")) {
        add("gaps", "selection", `with these pillar scores and the profile ${ctx.profile.join(",")}, the dimensions must be ${expected.join(",")}`);
      }
    }
  }

  const req = out?.requirements || {};
  for (const k of ["expertise", "experience"]) {
    if (!["on_track", "in_progress"].includes(req[k])) add(`requirements.${k}`, "structure", "must be on_track or in_progress");
  }
  if (!["not_started", "in_progress"].includes(req.certification)) add("requirements.certification", "structure", "must be not_started or in_progress (never on_track)");
  if (!Array.isArray(out?.script_vars?.gap_sentences) || out.script_vars.gap_sentences.length !== 3) add("script_vars.gap_sentences", "structure", "gap_sentences must be an array of exactly 3 sentences");

  const pieces = leadFacing(out);
  const banned = ctx.language === "FR" ? BANNED_FR.concat(BANNED_EN) : BANNED_EN;
  const nameTokens = [ctx.firstName, ctx.lastName].join(" ").split(/[\s-]+/).filter((x) => x && x.length >= 3).map((x) => x.toLowerCase());
  const resumeNums = new Set((ctx.resumeText.match(/\d[\d,.\u00A0\u202F]*\d|\d/g) || []).map(normNum));
  const marketNums = new Set(ctx.marketNumbers.map(normNum));
  let total = 0;
  const seenAcr = new Set<string>();
  const ordered = pieces.slice().sort((a, b) => (a.field.startsWith("script_vars") ? 0 : 1) - (b.field.startsWith("script_vars") ? 0 : 1));
  for (const p of ordered) {
    const low = p.text.toLowerCase();
    if (p.field.startsWith("script_vars")) total += words(p.text);
    if (p.text.includes("—")) add(p.field, "em_dash", "no em dashes, use commas or periods");
    for (const b of banned) if (low.includes(b)) add(p.field, "banned", `banned phrase "${b}"`);
    for (const n of nameTokens) if (new RegExp(`(^|[^\\p{L}])${n}([^\\p{L}]|$)`, "iu").test(p.text)) add(p.field, "name", "never use the lead's name in lead-facing text");
    for (const m of p.text.match(/\d[\d,.\u00A0\u202F]*\d|\d/g) || []) {
      const v = normNum(m.replace(/[.,]$/, ""));
      if (!NUMBER_OK.has(v) && !resumeNums.has(v) && !marketNums.has(v)) add(p.field, "number", `the number ${m.trim()} is not in the resume or the market rows`);
    }
    for (const s of p.text.split(/(?<=[.!?])\s+/)) if (words(s) > 30) add(p.field, "plain_language", `sentence of ${words(s)} words, keep under 30`);
    const re = /\b[A-Z]{2,6}s?\b/g;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(p.text))) {
      const a = mm[0].replace(/s$/, "");
      if (ACRONYM_OK.has(a) || seenAcr.has(a)) continue;
      seenAcr.add(a);
      const around = p.text.slice(Math.max(0, mm.index - 2), mm.index + mm[0].length + 2);
      if (!around.includes("(") && !around.includes(")")) add(p.field, "acronym", `explain ${a} the first time it is used, for example "long form (${a})"`);
    }
    if (ctx.language === "FR" && /\$\s?\d/.test(p.text)) add(p.field, "fr_number", "French number format: 200 $, not $200");
  }
  if (total > 500) add("script_vars", "length", `personalized script is ${total} words, max 500`);
  return issues;
}

export function roiLine(hourlyGaps: number[], prices: { self_paced: number; two_certs: number }) {
  const pos = hourlyGaps.filter((g) => g > 0);
  if (!pos.length) return null;
  const annualMax = Math.max(...pos) * 2080;
  if (annualMax < 5000) return null;
  const monthly = pos.map((g) => (g * 2080) / 12);
  const x = Math.ceil(prices.self_paced / Math.max(...monthly));
  const y = Math.ceil(prices.two_certs / Math.min(...monthly));
  return { months_min: x, months_max: y, monthly_gain_low: Math.round(Math.min(...monthly)), monthly_gain_high: Math.round(Math.max(...monthly)) };
}

export function normalize(out: any, language: "EN" | "FR") {
  if (!out || typeof out !== "object") return out;
  (out.gaps || []).forEach((g: any) => {
    for (const [n, t] of Object.entries(DIM_TITLES)) if (g?.title === t[language]) g.n = Number(n);
  });
  const r = out.requirements;
  if (r && r.notes && typeof r.notes === "object") r.notes = Object.entries(r.notes).map(([k, v]) => `${k}: ${v}`).join(" ");
  const sv = out.script_vars;
  if (sv && typeof sv.gap_sentences === "string") sv.gap_sentences = sv.gap_sentences.split(/(?<=[.!?])\s+/).filter(Boolean);
  return out;
}
