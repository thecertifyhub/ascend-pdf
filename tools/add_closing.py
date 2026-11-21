"""Appends the branded closing slide (logo reveal with its piano sting) to the end of a roadmap template.
Idempotent: an existing closing slide is replaced. Run after make_templates.py, or on its own:
    python tools/add_closing.py templates/roadmap_en.pptx EN
The slide carries its own audio and timing; roadmap_timing.apply leaves it untouched (shape "closing_logo")."""
import io, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from lxml import etree
from pptx import Presentation
from pptx.util import Emu, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.oxml.ns import qn
import roadmap, roadmap_timing as rt

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "closing")
CREAM, GREEN, GOLD_TEXT, GOLD_LINE = "FBFAF6", "1A4030", "8A6A1F", "C9A84C"
TAGLINE = {"EN": "Learn, Grow, Excel", "FR": "Apprendre, grandir, exceller"}
STING_MS = 7549            # length of closing.mp3
HOLD_MS = STING_MS + 600   # the slide (and the video) ends just after the sting
TAGLINE_AT_MS = 1200       # tagline appears after the logo wipe


def is_closing(slide):
    return any(sh.name == "closing_logo" for sh in slide.shapes)


def _wipe(nid, spid, delay):
    """Entrance 'Wipe' from the centre (the sting's own effect), as a With Previous effect at delay ms."""
    P = rt.P
    return etree.fromstring(
        f'<p:par xmlns:p="{P}"><p:cTn id="{nid()}" presetID="16" presetClass="entr" presetSubtype="21" fill="hold" '
        f'nodeType="withEffect"><p:stCondLst><p:cond delay="{delay}"/></p:stCondLst><p:childTnLst>'
        f'<p:set><p:cBhvr><p:cTn id="{nid()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>'
        f'<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName>'
        f'</p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>'
        f'<p:animEffect transition="in" filter="barn(inVertical)"><p:cBhvr><p:cTn id="{nid()}" dur="500"/>'
        f'<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl></p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par>')


def add(path, lang):
    prs = Presentation(path)
    old = [i for i, s in enumerate(prs.slides, 1) if is_closing(s)]
    if old:
        roadmap.drop_slides(prs, old)
    blank = next((l for l in prs.slide_layouts if l.name.lower() == "blank"), prs.slides[-1].slide_layout)
    s = prs.slides.add_slide(blank)
    for ph in list(s.placeholders):
        ph._element.getparent().remove(ph._element)
    s.background.fill.solid(); s.background.fill.fore_color.rgb = RGBColor.from_string(CREAM)
    W, H = prs.slide_width, prs.slide_height

    bar = s.shapes.add_shape(1, 0, 0, Emu(155448), H)            # same left accent bar as the cover
    bar.name = "accent_bar"; bar.fill.solid(); bar.fill.fore_color.rgb = RGBColor.from_string(GREEN); bar.line.fill.background()

    lw = Emu(7315200); lh = Emu(int(lw * 357 / 2400))            # logo 8 in wide, its own aspect ratio
    logo = s.shapes.add_picture(os.path.join(HERE, "logo.png"), (W - lw) // 2, Emu(2286000), lw, lh)
    logo.name = "closing_logo"

    line = s.shapes.add_shape(1, (W - Emu(1014984)) // 2, Emu(2286000) + lh + Emu(320040), Emu(1014984), Emu(41148))
    line.name = "gold_line"; line.fill.solid(); line.fill.fore_color.rgb = RGBColor.from_string(GOLD_LINE); line.line.fill.background()

    tb = s.shapes.add_textbox(Emu(813816), line.top + Emu(228600), W - Emu(2 * 813816), Emu(502920))
    tb.name = "closing_tagline"
    p = tb.text_frame.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
    r = p.add_run(); r.text = TAGLINE[lang]
    r.font.name = "Manrope"; r.font.size = Pt(22); r.font.color.rgb = RGBColor.from_string(GOLD_TEXT)

    with open(os.path.join(HERE, "closing.mp3"), "rb") as f:
        spid = rt.add_audio(s, f.read(), name="closing_sting")

    # one sequence that starts with the slide: sting + logo wipe at 0, tagline at TAGLINE_AT_MS
    rt.retime(s, [], audio=(spid, HOLD_MS))
    timing = s._element.find(qn("p:timing"))
    ids = [int(c.get("id")) for c in timing.iter(qn("p:cTn"))]
    nxt = [max(ids) + 1]
    def nid():
        nxt[0] += 1; return str(nxt[0] - 1)
    main = next(c for c in timing.iter(qn("p:cTn")) if c.get("nodeType") == "mainSeq")
    group = main.find(qn("p:childTnLst"))[0].find(qn("p:cTn")).find(qn("p:childTnLst"))[0].find(qn("p:cTn")).find(qn("p:childTnLst"))
    group.append(_wipe(nid, logo.shape_id, 0))
    group.append(_wipe(nid, tb.shape_id, TAGLINE_AT_MS))
    rt.set_advance(s, 0)
    prs.save(path)
    return len(prs.slides)


if __name__ == "__main__":
    print(add(sys.argv[1], sys.argv[2]), "slides")
