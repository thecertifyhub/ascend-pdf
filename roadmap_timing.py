"""Timed roadmap deck: each slide plays its own narration clip, its reveals fire at the spoken words, and the slide
advances by itself when its clip ends. Input = the voice manifest written by the roadmap-voice edge function:
[{slide, url, ms, clicks: [ms per reveal, in click order]}] with slide numbers of the full 17-slide template.

The deck's own animations (designed in the benchmark) are kept: each click group becomes part of one sequence that
starts with the slide ("With Previous" effects, each delayed to its reveal time), so PowerPoint's video export plays
them in sync with the narration."""
import copy, io, os, urllib.request
from lxml import etree
from pptx.oxml.ns import qn

P = "http://schemas.openxmlformats.org/presentationml/2006/main"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
P14 = "http://schemas.microsoft.com/office/powerpoint/2010/main"
ADVANCE_PAD_MS = 600       # breath after a slide's last word before the next slide
NO_AUDIO_MS = 4000         # a slide without a clip stays this long


def fetch(url, tries=3):
    last = None
    for _ in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return r.read()
        except Exception as e:  # network blip: retry
            last = e
    raise last


def _next_id(slide):
    return max(int(c.get("id")) for c in slide._element.iter(qn("p:cNvPr"))) + 1


def add_audio(slide, blob, name="narration"):
    """Embed an MP3 as an off-slide audio object (PowerPoint's own markup). Returns its shape id."""
    from pptx.media import Video
    from pptx.opc.constants import RELATIONSHIP_TYPE as RT
    from PIL import Image
    media = Video.from_blob(blob, "audio/mpeg", name + ".mp3")
    media_part = slide.part.package.get_or_add_media_part(media)
    rid_media = slide.part.relate_to(media_part, RT.MEDIA)
    rid_audio = slide.part.relate_to(media_part, RT.AUDIO)
    buf = io.BytesIO(); Image.new("RGBA", (8, 8), (0, 0, 0, 0)).save(buf, "PNG")
    _, rid_img = slide.part.get_or_add_image_part(io.BytesIO(buf.getvalue()))
    nid = _next_id(slide)
    xml = (f'<p:pic xmlns:p="{P}" xmlns:a="{A}" xmlns:r="{R}">'
           f'<p:nvPicPr><p:cNvPr id="{nid}" name="{name}"><a:hlinkClick r:id="" action="ppaction://media"/></p:cNvPr>'
           '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>'
           f'<p:nvPr><a:audioFile r:link="{rid_audio}"/><p:extLst><p:ext uri="{{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}}">'
           f'<p14:media xmlns:p14="{P14}" r:embed="{rid_media}"/></p:ext></p:extLst></p:nvPr></p:nvPicPr>'
           f'<p:blipFill><a:blip r:embed="{rid_img}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
           '<p:spPr><a:xfrm><a:off x="12344400" y="6705600"/><a:ext cx="152400" cy="152400"/></a:xfrm>'
           '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>')
    slide.shapes._spTree.append(etree.fromstring(xml))
    return nid


def _el(tag, **kw):
    return etree.Element(qn(tag), **{k: str(v) for k, v in kw.items()})


def retime(slide, clicks_ms, audio=None):
    """Turn the slide's click-driven animation into one timed sequence. clicks_ms[i] = start of click group i
    (missing values repeat the previous one). audio = (spid, ms) plays the clip from the slide's start."""
    sld = slide._element
    timing = sld.find(qn("p:timing"))
    if timing is None:
        timing = _el("p:timing"); tl = etree.SubElement(timing, qn("p:tnLst"))
        rp = etree.SubElement(tl, qn("p:par"))
        root = etree.SubElement(rp, qn("p:cTn"), id="1", dur="indefinite", restart="never", nodeType="tmRoot")
        rk = etree.SubElement(root, qn("p:childTnLst"))
        seq = etree.SubElement(rk, qn("p:seq"), concurrent="1", nextAc="seek")
        main = etree.SubElement(seq, qn("p:cTn"), id="2", dur="indefinite", nodeType="mainSeq")
        etree.SubElement(main, qn("p:childTnLst"))
        _insert_timing(sld, timing)
    ids = [int(c.get("id")) for c in timing.iter(qn("p:cTn"))]
    nxt = [max(ids) + 1]
    def nid():
        nxt[0] += 1; return str(nxt[0] - 1)
    main = next(c for c in timing.iter(qn("p:cTn")) if c.get("nodeType") == "mainSeq")
    mk = main.find(qn("p:childTnLst"))
    groups = list(mk)
    effects = []          # (effect par, absolute delay ms)
    last = 0
    for gi, outer in enumerate(groups):
        t = clicks_ms[gi] if gi < len(clicks_ms) else last
        last = t
        for inner in outer.find(qn("p:cTn")).find(qn("p:childTnLst")).findall(qn("p:par")):
            ic = inner.find(qn("p:cTn"))
            idelay = int((ic.find(qn("p:stCondLst")).find(qn("p:cond")).get("delay") or "0").replace("indefinite", "0"))
            for eff in ic.find(qn("p:childTnLst")).findall(qn("p:par")):
                ec = eff.find(qn("p:cTn"))
                cond = ec.find(qn("p:stCondLst")).find(qn("p:cond"))
                own = int((cond.get("delay") or "0").replace("indefinite", "0"))
                effects.append((eff, t + idelay + own))
    for g in groups:
        mk.remove(g)
    if not effects and not audio:
        return
    outer = etree.SubElement(mk, qn("p:par"))
    oc = etree.SubElement(outer, qn("p:cTn"), id=nid(), fill="hold")
    st = etree.SubElement(oc, qn("p:stCondLst"))
    etree.SubElement(st, qn("p:cond"), delay="indefinite")
    c2 = etree.SubElement(st, qn("p:cond"), evt="onBegin", delay="0")
    etree.SubElement(c2, qn("p:tn"), val=main.get("id"))
    ok = etree.SubElement(oc, qn("p:childTnLst"))
    inner = etree.SubElement(ok, qn("p:par"))
    ic = etree.SubElement(inner, qn("p:cTn"), id=nid(), fill="hold")
    ist = etree.SubElement(ic, qn("p:stCondLst")); etree.SubElement(ist, qn("p:cond"), delay="0")
    k = etree.SubElement(ic, qn("p:childTnLst"))
    first = True
    if audio:
        spid, ms = audio
        par = etree.SubElement(k, qn("p:par"))
        ct = etree.SubElement(par, qn("p:cTn"), id=nid(), presetID="1", presetClass="mediacall", presetSubtype="0",
                              fill="hold", nodeType="afterEffect")
        s = etree.SubElement(ct, qn("p:stCondLst")); etree.SubElement(s, qn("p:cond"), delay="0")
        kids = etree.SubElement(ct, qn("p:childTnLst"))
        cmd = etree.SubElement(kids, qn("p:cmd"), type="call", cmd="playFrom(0.0)")
        cb = etree.SubElement(cmd, qn("p:cBhvr"))
        etree.SubElement(cb, qn("p:cTn"), id=nid(), dur=str(int(ms)), fill="hold")
        te = etree.SubElement(cb, qn("p:tgtEl")); etree.SubElement(te, qn("p:spTgt"), spid=str(spid))
        first = False
    for eff, delay in effects:
        ec = eff.find(qn("p:cTn"))
        ec.set("nodeType", "afterEffect" if first else "withEffect")
        first = False
        ec.find(qn("p:stCondLst")).find(qn("p:cond")).set("delay", str(max(0, int(delay))))
        k.append(eff)
    if audio:
        rk = timing.find(qn("p:tnLst")).find(qn("p:par")).find(qn("p:cTn")).find(qn("p:childTnLst"))
        for old in rk.findall(qn("p:audio")):
            rk.remove(old)
        au = etree.SubElement(rk, qn("p:audio"))
        mn = etree.SubElement(au, qn("p:cMediaNode"), vol="80000", numSld="1", showWhenStopped="0")
        ct = etree.SubElement(mn, qn("p:cTn"), id=nid(), display="0", fill="hold")
        s = etree.SubElement(ct, qn("p:stCondLst")); etree.SubElement(s, qn("p:cond"), delay="indefinite")
        en = etree.SubElement(ct, qn("p:endCondLst"))
        c = etree.SubElement(en, qn("p:cond"), evt="onStopAudio", delay="0")
        te = etree.SubElement(c, qn("p:tgtEl")); etree.SubElement(te, qn("p:sldTgt"))
        te = etree.SubElement(mn, qn("p:tgtEl")); etree.SubElement(te, qn("p:spTgt"), spid=str(audio[0]))


def _insert_timing(sld, timing):
    idx = 0
    for i, ch in enumerate(sld):
        if ch.tag in (qn("p:cSld"), qn("p:clrMapOvr"), qn("p:transition")):
            idx = i + 1
    sld.insert(idx, timing)


def set_advance(slide, ms):
    """Auto-advance after ms. A slide that already has a transition (the benchmark's Morph, written inside
    mc:AlternateContent with a Fade fallback) keeps it: both copies get the timing."""
    sld = slide._element
    existing = list(sld.iter(qn("p:transition")))
    if existing:
        for t in existing:
            t.set("advClick", "0"); t.set("advTm", str(int(ms)))
        return
    tr = _el("p:transition", advClick="0", advTm=int(ms))
    idx = 0
    for i, ch in enumerate(sld):
        if ch.tag in (qn("p:cSld"), qn("p:clrMapOvr")):
            idx = i + 1
    sld.insert(idx, tr)


def apply(prs, manifest, log=None):
    """prs: the 17-slide deck before any slide is dropped. manifest: list from the voice manifest."""
    by = {int(m["slide"]): m for m in (manifest or [])}
    slides = list(prs.slides)
    for n, slide in enumerate(slides, 1):
        m = by.get(n)
        if not m:
            retime(slide, [k * 900 for k in range(30)])
            set_advance(slide, NO_AUDIO_MS)
            continue
        blob = fetch(m["url"])
        spid = add_audio(slide, blob, name=f"narration_{n}")
        retime(slide, [int(x) for x in m.get("clicks") or []], audio=(spid, int(m["ms"])))
        set_advance(slide, int(m["ms"]) + ADVANCE_PAD_MS)
        if log is not None:
            log.append(dict(slide=n, ms=int(m["ms"]), clicks=len(m.get("clicks") or []), bytes=len(blob)))
