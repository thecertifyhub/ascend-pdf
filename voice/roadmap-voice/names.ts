// names.ts: should the narration say the lead's first name? Shared by roadmap-voice and roadmap-review.
export type Lang = "EN" | "FR";
// ---------------------------------------------------------------- first name (slides 1 and 10)
// Common first names the voices say well, accent-insensitive. Any other name is used only when its shape is simple.
export const COMMON: Record<Lang, string[]> = {
  EN: ("kevin eric marvin john james michael david paul peter mark daniel ryan jason brian steven robert william thomas christopher "
    + "anthony andrew joseph richard charles george edward frank patrick henry samuel simon victor martin alex alexander nicholas "
    + "jonathan matthew benjamin joshua justin kenneth gregory greg harold jody tobi fernando nicholas jan kurt zakir wilson greg devand "
    + "mary sarah linda lisa jennifer jessica emily grace ruth esther faith joy mercy angela diana susan karen nancy helen anna "
    + "ibrahim mohamed mohammed ahmed ali omar hassan karim yusuf aymen sam tony chris mike dave steve jeff scott eddie").split(" "),
  FR: ("herve eric jean pierre paul jacques michel philippe alain patrick christian olivier nicolas francois marc luc laurent "
    + "stephane sebastien david daniel thomas julien guillaume antoine mathieu serge didier bernard yves remi joseph emmanuel "
    + "fabrice franck arnaud cedric romain bertrand koffi moussa mamadou ibrahim idriss abdoul ali omar karim hassan kevin marvin "
    + "lambert seraphin william herve lucien gilles denis andre rene robert georges henri louis martin simon victor "
    + "marie anne claire sophie nathalie isabelle christine sylvie celine julie aminata fatou mireille kyria awa grace esther").split(" "),
};
export const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
/** Should the narration say the first name? {use, say, reason}. say = what the voice reads (a respelling can replace it). */
export function nameAuto(firstName: string, lang: Lang): { use: boolean; say: string; reason: string } {
  const first = String(firstName ?? "").trim().split(/\s+/)[0] ?? "";
  const say = first.split("-").map((x) => (x ? x[0].toUpperCase() + x.slice(1).toLowerCase() : x)).join("-");
  if (!first) return { use: false, say: "", reason: "no first name" };
  if (!/^[\p{L}-]+$/u.test(first)) return { use: false, say, reason: "contains characters other than letters" };
  if (plain(first).split("-").every((x) => COMMON[lang].includes(x))) return { use: true, say, reason: "common name for this voice" };
  const p = plain(first);
  const syl = (p.match(/[aeiouy]+/g) ?? []).length;
  if (/^(ng|nk|mb|nd|nt|nz|ts|kw|gb|kp|mw|ny|dz|hl|tl)/.test(p)) return { use: false, say, reason: "starts with a sound cluster the voice may say wrong" };
  if (/[bcdfghjklmnpqrstvwxz]{3,}/.test(p)) return { use: false, say, reason: "three consonants in a row" };
  if (p.length > 7 || syl > 2) return { use: false, say, reason: "long name (over 7 letters or 2 syllables)" };
  return { use: true, say, reason: "short, simple name" };
}
