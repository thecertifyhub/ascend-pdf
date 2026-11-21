import { personalTexts, standardTexts, markers, frWords, enWords } from "./fill.ts";
import fs from "node:fs";
const T = JSON.parse(fs.readFileSync("templates.json", "utf8"));
const docs = JSON.parse(fs.readFileSync("docs.json", "utf8"));
for (const d of docs) {
  const lang = d.req.language;
  console.log("\n=====", d.req.first_name, lang);
  for (const s of personalTexts(d.doc, d.req, T[lang], lang)) {
    const m = markers(s.text);
    console.log(`-- s${s.slide} [${m.marks.map(x=>x.n+"@"+x.word).join(" ")}] ${m.clean.length}c\n${m.clean}`);
    if (/\{\w+\}/.test(s.text)) console.log("!!! UNFILLED");
  }
}
console.log(frWords(1280), "|", frWords(780), "|", frWords(3840), "|", frWords(71), "|", frWords(80), "|", enWords(3840));
for (const L of ["EN","FR"]) console.log(L, standardTexts(T[L]).map(s=>markers(s.text).clean.length));
