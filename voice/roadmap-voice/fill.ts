// fill.ts: roadmap narration texts from the approved roadmap JSON and the script templates.
// Pure functions (no Deno or network), shared by the roadmap-voice edge function and the local tests.
// Click markers [[n]] in a template mark where reveal n of the slide starts (n = the slide's click order).

export type Lang = "EN" | "FR";
export type Templates = Record<string, string>;
export type SlideText = { slide: number; text: string };

// ---------------------------------------------------------------- numbers as words
const EN_1 = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const EN_10 = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function en999(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  const t = r < 20 ? (r || h === 0 ? EN_1[r] : "") : EN_10[Math.floor(r / 10)] + (r % 10 ? "-" + EN_1[r % 10] : "");
  return [h ? EN_1[h] + " hundred" : "", t].filter(Boolean).join(" ");
}
export function enWords(n: number): string {
  n = Math.round(n);
  if (n < 1000) return en999(n);
  const th = Math.floor(n / 1000), r = n % 1000;
  return en999(th) + " thousand" + (r ? " " + en999(r) : "");
}
const FR_1 = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze",
  "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"];
const FR_10 = ["", "dix", "vingt", "trente", "quarante", "cinquante", "soixante"];
function fr99(n: number): string {
  if (n < 20) return FR_1[n];
  const t = Math.floor(n / 10), u = n % 10;
  if (t < 7) return FR_10[t] + (u === 1 ? " et un" : u ? "-" + FR_1[u] : "");
  if (t === 7) return "soixante" + (u === 1 ? " et onze" : "-" + FR_1[10 + u]);
  if (t === 8) return "quatre-vingt" + (u ? "-" + FR_1[u] : "s");
  return "quatre-vingt-" + FR_1[10 + u];
}
function fr999(n: number, final = true): string {
  const h = Math.floor(n / 100), r = n % 100;
  let s = "";
  if (h) s = (h > 1 ? FR_1[h] + " " : "") + "cent" + (h > 1 && !r && final ? "s" : "");
  if (r) {
    let w = fr99(r);
    if (!final && r === 80) w = "quatre-vingt";
    s = (s ? s + " " : "") + w;
  }
  return s;
}
export function frWords(n: number): string {
  n = Math.round(n);
  if (n === 0) return "zéro";
  if (n < 1000) return fr999(n);
  const th = Math.floor(n / 1000), r = n % 1000;
  return (th === 1 ? "mille" : fr999(th, false) + " mille") + (r ? " " + fr999(r) : "");
}
export const words = (n: number, lang: Lang) => (lang === "FR" ? frWords(n) : enWords(n));

/** 42 -> "forty-two dollars"; 35.5 -> "thirty-five dollars and fifty cents"; FR: "soixante-six dollars et quatre-vingt-trois" */
export function money(v: number, lang: Lang, perHour = false): string {
  const d = Math.floor(v + 1e-9), c = Math.round((v - d) * 100);
  if (lang === "FR") {
    let s = `${frWords(d)} dollar${d > 1 ? "s" : ""}` + (c ? ` et ${frWords(c)}` : "");
    return perHour ? s + " de l'heure" : s;
  }
  let s = `${enWords(d)} dollar${d === 1 ? "" : "s"}` + (c ? ` and ${enWords(c)} cent${c === 1 ? "" : "s"}` : "");
  return perHour ? s + " an hour" : s;
}

// ---------------------------------------------------------------- language helpers
export const aAn = (s: string) => (/^[aeiou]/i.test(s.trim()) ? "an " : "a ") + s.trim();
export const de = (s: string) => (/^[aeiouyéèêàâîïôûh]/i.test(s.trim()) ? "d'" : "de ") + s.trim();
// lower-case a title only when it is a plain phrase ("Maintenance specialist"), not a proper title ("Senior Reliability Engineer")
const lcFirst = (s: string) => (/^[A-ZÉ][^A-Z]*$/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const ucFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** "le Québec" -> "au Québec", "la Colombie" -> "en Colombie", "l'Ontario" -> "en Ontario", "les X" -> "aux X" */
export function frIn(s: string): string {
  const t = (s ?? "").trim();
  if (!t) return "";
  if (/^(au|aux|en|à|partout|dans|sur)\b/i.test(t)) return t;
  if (/^le /i.test(t)) return "au " + t.slice(3);
  if (/^les /i.test(t)) return "aux " + t.slice(4);
  if (/^la /i.test(t)) return "en " + t.slice(3);
  if (/^l'/i.test(t)) return "en " + t.slice(2);
  return "à " + t;
}

export const REGION: Record<Lang, Record<string, string>> = {
  EN: { CA: "Canada", ON: "Ontario", QC: "Quebec", AB: "Alberta", BC: "British Columbia", SK: "Saskatchewan", MB: "Manitoba" },
  FR: { CA: "Canada", ON: "Ontario", QC: "Québec", AB: "Alberta", BC: "Colombie-Britannique", SK: "Saskatchewan", MB: "Manitoba" },
};
const FR_REGION_IN: Record<string, string> = { CA: "au Canada", ON: "en Ontario", QC: "au Québec", AB: "en Alberta",
  BC: "en Colombie-Britannique", SK: "en Saskatchewan", MB: "au Manitoba" };
export const FAMILY: Record<Lang, Record<string, string>> = {
  EN: { specialist: "maintenance specialist", supervisor: "maintenance supervisor", planner: "maintenance planner",
    reliability_engineer: "reliability engineer", manager: "maintenance manager", asset_management: "asset management specialist" },
  FR: { specialist: "spécialiste en maintenance", supervisor: "superviseur de maintenance", planner: "planificateur de maintenance",
    reliability_engineer: "ingénieur fiabilité", manager: "gestionnaire de maintenance", asset_management: "spécialiste en gestion des actifs" },
};
const PILLARS: Record<Lang, string[]> = {
  EN: ["business and management", "manufacturing process reliability", "equipment reliability", "organization and leadership", "work management"],
  FR: ["les affaires et la gestion", "la fiabilité des procédés de fabrication", "la fiabilité des équipements", "l'organisation et le leadership", "la gestion des travaux"],
};
const PILLARS_DE_FR = ["des affaires et de la gestion", "de la fiabilité des procédés de fabrication", "de la fiabilité des équipements",
  "de l'organisation et du leadership", "de la gestion des travaux"];
const RATING_FR: Record<string, string> = { "very good": "très bonnes", good: "bonnes", moderate: "modérées", fair: "passables",
  limited: "limitées", "very limited": "très limitées", undetermined: "indéterminées" };

// gap dimensions 1 to 8 (generator), spoken with their article in French
const GAP_TITLES: Record<Lang, string[]> = {
  EN: ["", "leadership depth", "reliability-driven decision-making", "business impact of actions", "systems thinking",
    "operational complexity management", "cross-functional influence", "strategic maintenance ownership", "executive communication"],
  FR: ["", "la profondeur du leadership", "la prise de décision basée sur l'analyse de fiabilité", "l'impact business des actions", "la vision système",
    "la gestion de la complexité opérationnelle", "l'influence transversale", "la maîtrise stratégique de la maintenance", "la communication exécutive"],
};

import { nameAuto } from "./names.ts";
export { nameAuto };
function withName(slide: number, text: string, doc: any, req: any, lang: Lang): string {
  const nv = doc.name_voice ?? nameAuto(req?.first_name, lang);
  const say = String(nv?.say ?? "").trim();
  if (!nv?.use || !say) return text;
  if (slide === 1) return text.replace(lang === "EN" ? /^(\[\[\d+\]\])*Hello,/ : /^(\[\[\d+\]\])*Bonjour,/, (m) => m.replace(/,$/, ` ${say},`));
  // slide 10: "Kevin, here is where your profile stands" / "Hervé, voici où se situe votre profil"
  return text.replace(/^((?:\[\[\d+\]\])*)(\p{Lu})/u, (_, mk, c) => `${mk}${say}, ${c.toLowerCase()}`);
}

function nice(x: number): [number, number] {
  const fs: [number, number][] = [[1, 4], [1, 3], [2, 5], [1, 2], [3, 5], [2, 3], [3, 4], [4, 5]];
  return fs.reduce((b, f) => (Math.abs(f[0] / f[1] - x) < Math.abs(b[0] / b[1] - x) ? f : b));
}
const period = (p: string, lang: Lang) => (p ?? "").replace("-", lang === "EN" ? " to " : " à ");
const listJoin = (xs: string[], lang: Lang) => xs.length < 2 ? (xs[0] ?? "")
  : xs.slice(0, -1).join(", ") + (lang === "EN" ? (xs.length > 2 || xs.some((x) => x.includes(" and ")) ? ", and " : " and ") : " et ") + xs[xs.length - 1];

function fill(t: string, v: Record<string, string>): string {
  return t.replace(/\{(\w+)\}/g, (_, k) => (k in v ? v[k] : `{${k}}`)).replace(/\s+([.,])/g, "$1").replace(/ {2,}/g, " ")
    .replace(/([.!?] (?:\[\[\d+\]\])*)(\p{Ll})/gu, (_, a, c) => a + c.toUpperCase())   // a sentence starts with a capital
    .trim();
}

// ---------------------------------------------------------------- slide plan (mirrors roadmap.py)
export function plan(doc: any) {
  const m = doc.market ?? {}, rows = m.rows ?? [];
  const dem = doc.demand ?? {};
  const drop: number[] = [];
  if (!rows.length) drop.push(3, 4);
  else if (!dem.national && !(dem.provincial ?? []).length) drop.push(4);
  const gap = m.variant === "gap" && rows.some((r: any) => r.current && (r.target.median - r.current.median) * 2080 >= 5000);
  return { drop, gap };
}

/** Personalized slides (1 to 6 and 10), texts with click markers. */
export function personalTexts(doc: any, req: any, T: Templates, lang: Lang): SlideText[] {
  const sv = doc.script_vars ?? {}, td = doc.today ?? {}, tg = doc.target ?? {}, m = doc.market ?? {};
  const fam = m.stated_family ?? tg.target_family ?? "specialist", wfam = m.wage_family ?? fam;
  const role = (sv.target_role ?? tg.target_role_label ?? FAMILY[lang][fam]).trim();
  const roleL = lcFirst(role);
  const emp = (td.employer ?? "").trim();   // only the generator's employer field (a title suffix can be a unit, not a company)
  let cur = (sv.current_role ?? "").trim();
  if (lang === "FR") cur = cur.replace(/^(un|une)\s+/i, "");
  const loc = (sv.location ?? td.location ?? "").trim();
  const v: Record<string, string> = {
    target_role: roleL, a_target_role: aAn(roleL), de_target_role: de(roleL),
    current_role: cur,
    at_employer: emp ? (lang === "EN" ? ` at ${emp}` : ` chez ${emp}`) : "",
    in_location: loc ? (lang === "EN" ? ` in ${loc}` : (loc.includes(",") ? `, ${frIn(loc)}` : "")) : "",
    years: sv.years ?? "",
    with_credentials: sv.credentials ? (lang === "EN" ? `, along with ${sv.credentials}` : `, avec ${sv.credentials}`) : "",
    target_industry: sv.target_industry ?? tg.industry ?? "",
    target_regions: sv.target_regions ?? tg.location ?? "",
    in_regions: sv.target_regions ? `, ${frIn(sv.target_regions)}` : "",
    target_field: sv.target_field ?? "",
    expertise_have: sv.expertise_have ?? "", experience_have: sv.experience_have ?? "",
  };
  const out: SlideText[] = [];
  const { drop, gap } = plan(doc);
  out.push({ slide: 1, text: withName(1, fill(T.s01, v), doc, req, lang) });
  out.push({ slide: 2, text: fill(T.s02, v) });

  // 3 market
  const rows = m.rows ?? [];
  if (!drop.includes(3)) {
    const r0 = rows[0], rin = (r: any) => (lang === "EN" ? REGION.EN[r.region] ?? r.region : FR_REGION_IN[r.region] ?? r.region);
    const top = rows.reduce((b: any, r: any) => ((r.target?.high ?? 0) > (b?.target?.high ?? 0) ? r : b), null);
    const where = rows.length > 1 ? (lang === "EN" ? " in " + (REGION.EN[top?.region] ?? top?.region) : " " + (FR_REGION_IN[top?.region] ?? "")) : "";
    const topv = top?.target?.high ? (money(top.target.high, lang, true) + where).trim() : "";
    if (gap) {
      const ks = rows.filter((r: any) => r.current).map((r: any) => Math.round((r.target.median - r.current.median) * 2080 / 1000)).sort((a: number, b: number) => a - b);
      const k = ks[0] === ks[ks.length - 1] ? `${words(ks[0], lang)} ${lang === "EN" ? "thousand dollars" : "mille dollars"}`
        : `${words(ks[0], lang)} ${lang === "EN" ? "to" : "à"} ${words(ks[ks.length - 1], lang)} ${lang === "EN" ? "thousand dollars" : "mille dollars"}`;
      let r2 = "";
      if (rows[1]?.current) {
        const g0 = r0.target.median - r0.current.median, g1 = rows[1].target.median - rows[1].current.median;
        r2 = fill(g1 > g0 ? T.s03_region2_wider : T.s03_region2_same, {
          region2: REGION[lang][rows[1].region] ?? rows[1].region, Region2_in: ucFirst(rin(rows[1])),
          wage_now_2: money(rows[1].current.median, lang), wage_target_2: wordsMoneyShort(rows[1].target.median, lang) });
      }
      out.push({ slide: 3, text: fill(T.s03_gap, { ...v, region1: REGION[lang][r0.region] ?? r0.region, Region1_in: ucFirst(rin(r0)),
        wage_now_1: money(r0.current.median, lang, true), wage_target_1: wordsMoneyShort(r0.target.median, lang),
        region2_sentence: r2, annual_gap: k, top_sentence: topv ? fill(T.s03_gap_top, { top_of_range: topv }) : "" }) });
    } else {
      const wr = FAMILY[lang][wfam];
      out.push({ slide: 3, text: fill(T.s03_range, { ...v, region1: REGION[lang][r0.region] ?? r0.region, Region1_in: ucFirst(rin(r0)),
        a_wage_role: aAn(wr), d_wage_role: "d'un " + wr,
        wage_target_1: money(r0.target.median, lang, true), period: period(r0.target.period, lang),
        top_sentence: topv ? fill(T.s03_range_top, { top_of_range: topv }) : "" }) });
    }
  }
  // 4 outlook
  if (!drop.includes(4)) {
    const nat = doc.demand?.national, prov = doc.demand?.provincial ?? [];
    if (nat) {
      const [a, b] = nat.retirement_openings ? nice(nat.retirement_openings / nat.openings) : [1, 2];
      const share = lang === "EN" ? `About ${enWords(a)} in ${enWords(b)}`
        : `Environ ${a === 1 ? "un poste" : frWords(a) + " postes"} sur ${frWords(b)} ${a === 1 ? "proviendra" : "proviendront"}`;
      const per = (x: number) => words(Math.round(x / 100) * 10, lang);
      const balance = (nat.conclusion ?? "").toLowerCase().includes("balance");
      out.push({ slide: 4, text: fill(balance ? T.s04_balance : T.s04_shortage, { openings_per_year: per(nat.openings),
        seekers_per_year: per(nat.seekers), retire_share: share }) });
    } else {
      const parts = prov.slice(0, 3).map((p: any) => {
        const rating = String(p.conclusion ?? "").replace(/\s*\(.*\)$/, "").toLowerCase();
        return lang === "EN" ? `as ${rating} in ${REGION.EN[p.geography] ?? p.geography}`
          : `comme ${RATING_FR[rating] ?? rating} ${FR_REGION_IN[p.geography] ?? p.geography}`;
      });
      out.push({ slide: 4, text: fill(T.s04_prov, { provincial_ratings: listJoin(parts, lang) }) });
    }
  }
  // 5 requirements
  const rq = doc.requirements ?? {};
  const st = (k: string) => (["on_track", "in_progress", "not_started"].includes(rq[k]) ? rq[k] : "in_progress");
  out.push({ slide: 5, text: fill(T.s05, { ...v,
    expertise_sentence: fill(T[`s05_expertise_${st("expertise")}`], v),
    experience_sentence: fill(T[`s05_experience_${st("experience")}`], v),
    cert_sentence: T[`s05_cert_${rq.certification === "in_progress" ? "in_progress" : rq.certification === "on_track" ? "on_track" : "not_started"}`] }) });
  // 6 gaps: each one named, then explained ("First, systems thinking: look beyond each machine ...")
  const gs: string[] = (Array.isArray(sv.gap_sentences) ? sv.gap_sentences : []).map((x: string) => {
    let y = x.trim().replace(lang === "EN" ? /^(the )?(first|second|third)( step| one| gap)? is (to )?/i : /^(la |le )?(première|premier|deuxième|troisième)( étape| piste)? (est|consiste à) (de |d'|à )?/i, "");
    return y ? y[0].toLowerCase() + y.slice(1) : y;
  });
  const gt = (doc.gaps ?? []).slice(0, 3).map((g: any) => GAP_TITLES[lang][Number(g.n)] ?? lcFirst(String(g.title ?? "")));
  out.push({ slide: 6, text: fill(T.s06, { ...v, gap_1: gs[0] ?? "", gap_2: gs[1] ?? "", gap_3: gs[2] ?? "",
    gap_title_1: gt[0] ?? "", gap_title_2: gt[1] ?? "", gap_title_3: gt[2] ?? "" }) });
  // 10 pillars
  const sc: number[] = (doc.pillars ?? []).slice(0, 5).map((p: any) => Math.round(Number(p.score) || 0));
  if (sc.length === 5) {
    const hi = sc.indexOf(Math.max(...sc)), lo = sc.indexOf(Math.min(...sc));
    const others = sc.map((s, i) => [s, i]).filter(([s, i]) => i !== lo && i !== hi && s <= 5).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
    const fb = others.length ? (lang === "EN" ? ", followed by " + listJoin(others.map((i) => PILLARS.EN[i]), "EN")
      : ", suivi " + others.map((i) => PILLARS_DE_FR[i]).join(" et ")) : "";
    out.push({ slide: 10, text: withName(10, fill(T.s10, { ...v, strongest: PILLARS[lang][hi], strong_score: words(sc[hi], lang),
      weakest: PILLARS[lang][lo], weak_score: words(sc[lo], lang), followed_by: fb }), doc, req, lang) });
  }
  // 15 investment: with a payback, slide 15 becomes personal (the standard clip is used otherwise)
  const pb = payback(doc);
  if (pb && T.s15_roi) {
    const span = pb.min === pb.max
      ? (lang === "EN" ? `about ${enWords(pb.min)} ${pb.min === 1 ? "month" : "months"}` : `environ ${frWords(pb.min)} mois`)
      : (lang === "EN" ? `${enWords(pb.min)} to ${enWords(pb.max)} months` : `${frWords(pb.min)} à ${frWords(pb.max)} mois`);
    const roi = fill(T.s15_roi, { roi_range: span });
    // right after "The prices for your region are on screen." (the sentence that opens click 4, the green band)
    const base = T.s15, at = base.indexOf("[[4]]"), end = at < 0 ? -1 : base.indexOf(". ", at);
    const text = end < 0 ? `${base} ${roi}` : `${base.slice(0, end + 1)} ${roi}${base.slice(end + 1)}`;
    out.push({ slide: 15, text: fill(text, {}) });
  }
  return out;
}

/** Months for the guided program (after the debrief discount) to pay for itself out of the monthly wage gain.
 *  Same rule as roadmap.py payback(): ceil(price / high gain) to ceil(price / low gain). */
export function payback(doc: any): { min: number; max: number } | null {
  const r = doc.roi, price = Number(doc.prices?.guided ?? 3900);
  const hi = Number(r?.monthly_gain_high), lo = Number(r?.monthly_gain_low);
  if (!r || !(hi > 0) || !(lo > 0)) return null;
  const min = Math.max(1, Math.ceil(price / Math.max(hi, lo))), max = Math.max(1, Math.ceil(price / Math.min(hi, lo)));
  return { min, max };
}
/** second mention of a wage: "forty-two dollars" (no "an hour") */
function wordsMoneyShort(v: number, lang: Lang) { return money(v, lang, false); }

export const STANDARD_SLIDES = [7, 8, 9, 11, 12, 13, 14, 15, 16, 17];
export function standardTexts(T: Templates): SlideText[] {
  return STANDARD_SLIDES.map((n) => ({ slide: n, text: fill(T[`s${String(n).padStart(2, "0")}`], {}) }));
}

// ---------------------------------------------------------------- markers
/** "[[1]]Now, the market. [[2]]In ..." -> clean text and, per marker, the index of the word it precedes */
export function markers(text: string) {
  const toks = text.split(/\s+/).filter(Boolean);
  const words_: string[] = []; const marks: { n: number; word: number }[] = [];
  for (const t of toks) {
    let w = t;
    let m: RegExpMatchArray | null;
    while ((m = w.match(/^\[\[(\d+)\]\]/))) { marks.push({ n: Number(m[1]), word: words_.length }); w = w.slice(m[0].length); }
    const tail: number[] = [];
    while ((m = w.match(/\[\[(\d+)\]\]$/))) { tail.unshift(Number(m[1])); w = w.slice(0, -m[0].length); }
    if (w) words_.push(w);
    for (const n of tail) marks.push({ n, word: words_.length });
  }
  return { clean: words_.join(" "), words: words_, marks };
}
