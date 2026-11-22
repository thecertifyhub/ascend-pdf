"""Roadmap video, made on the server from the finished narrated deck (no PowerPoint step).

1. Plan: for each slide, read from the deck itself what PowerPoint would play: the narration clip and its length
   (the mediacall effect), and when each shape enters (entrance effects, delays already set to the spoken words).
2. States: every distinct reveal moment of a slide is one picture. A copy of the deck holds one slide per state,
   with the shapes not yet revealed removed; LibreOffice renders that copy to PDF once, PyMuPDF rasterizes it.
3. Video: one segment per slide (pictures crossfade at their reveal times, the slide fades in from the previous one,
   its clip plays from the start), then the segments are joined without re-encoding.
"""
import copy, io, os, subprocess, tempfile
from lxml import etree
from pptx import Presentation
from pptx.oxml.ns import qn

W, H, FPS = 1280, 720, 15   # sized for the small build server (512 MB, a fraction of a CPU)
CHUNK = 4                 # slides rendered per LibreOffice run (memory)
FADE_S = 0.3              # reveal and slide-change crossfade
MERGE_S = 0.35            # reveals closer than this share one picture
NO_AUDIO_MS = 4000
P14 = "http://schemas.microsoft.com/office/powerpoint/2010/main"
RNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def _delay(ctn):
    c = ctn.find(qn("p:stCondLst"))
    c = c.find(qn("p:cond")) if c is not None else None
    v = (c.get("delay") if c is not None else "0") or "0"
    return 0 if v == "indefinite" else int(v)


def plan(prs):
    """[{audio: bytes|None, dur_ms, reveals: [(ms, spid)]}] per slide, from the timed deck."""
    out = []
    for slide in prs.slides:
        x = slide._element
        audio, dur, reveals = None, 0, []
        for ctn in x.iter(qn("p:cTn")):
            cls = ctn.get("presetClass")
            tgt = next(ctn.iter(qn("p:spTgt")), None)
            if cls == "entr" and tgt is not None:
                reveals.append((_delay(ctn), int(tgt.get("spid"))))
            elif cls == "mediacall" and tgt is not None:
                inner = [int(c.get("dur")) for c in ctn.iter(qn("p:cTn")) if (c.get("dur") or "").isdigit()]
                dur = max([dur] + inner)
                audio = _audio_blob(slide, int(tgt.get("spid")))
        for tr in x.iter(qn("p:transition")):
            adv = tr.get("advTm")
            if adv and adv.isdigit():
                dur = max(dur, int(adv))
        if not dur:
            dur = NO_AUDIO_MS
        last = max([0] + [r[0] for r in reveals])
        dur = max(dur, last + 800)
        out.append(dict(audio=audio, dur_ms=dur, reveals=sorted(reveals)))
    return out


def _audio_blob(slide, spid):
    for pic in slide._element.iter(qn("p:pic")):
        nv = pic.find(qn("p:nvPicPr")).find(qn("p:cNvPr"))
        if int(nv.get("id")) != spid:
            continue
        m = next(pic.iter("{%s}media" % P14), None)
        if m is not None:
            return slide.part.related_part(m.get("{%s}embed" % RNS)).blob
    return None


def states(p):
    """[(start_ms, hidden spids)] for one slide: one picture per reveal moment. Reveals closer than MERGE_S to the
    previous picture join it. A picture hides every shape whose reveal comes at or after the next picture."""
    times = [0]
    for t, _ in p["reveals"]:
        if t - times[-1] >= MERGE_S * 1000:
            times.append(t)
    out = []
    for i, t in enumerate(times):
        nxt = times[i + 1] if i + 1 < len(times) else None
        out.append((t, {s for (rt, s) in p["reveals"] if nxt is not None and rt >= nxt}))
    return out


def _dup(prs, src):
    """Append a copy of slide src (shapes, background, images) and return it."""
    new = prs.slides.add_slide(src.slide_layout)
    rmap = {}
    for rid, rel in src.part.rels.items():
        if rel.reltype.endswith("/slideLayout") or rel.reltype.endswith("/notesSlide"):
            continue
        if rel.is_external:
            rmap[rid] = new.part.relate_to(rel.target_ref, rel.reltype, is_external=True)
        else:
            rmap[rid] = new.part.relate_to(rel.target_part, rel.reltype)
    csld = copy.deepcopy(src._element.find(qn("p:cSld")))
    for el in csld.iter():
        for k, v in list(el.attrib.items()):
            if k.startswith("{%s}" % RNS) and v in rmap:
                el.set(k, rmap[v])
    old = new._element.find(qn("p:cSld"))
    new._element.replace(old, csld)
    return new


def _remove_ids(slide, ids):
    for nv in list(slide._element.iter(qn("p:cNvPr"))):
        if int(nv.get("id")) in ids:
            shape = nv.getparent().getparent()
            if shape.getparent() is not None:
                shape.getparent().remove(shape)


def render_states(stripped_pptx, plans, workdir):
    """PNG paths per slide per state. Rendered CHUNK slides at a time so LibreOffice stays small."""
    import gc
    import fitz
    out = [[] for _ in plans]
    for c0 in range(0, len(plans), CHUNK):
        prs = Presentation(io.BytesIO(stripped_pptx))
        originals = list(prs.slides)
        index = []
        for i in range(c0, min(c0 + CHUNK, len(plans))):
            for k, (t, hidden) in enumerate(states(plans[i])):
                d = _dup(prs, originals[i])
                _remove_ids(d, hidden)
                index.append((i, k))
        sldIdLst = prs.slides._sldIdLst
        for sid in list(sldIdLst)[:len(originals)]:
            prs.part.drop_rel(sid.get(qn("r:id")))
            sldIdLst.remove(sid)
        src = os.path.join(workdir, f"states{c0:02d}.pptx")
        prs.save(src)
        del prs, originals
        gc.collect()
        subprocess.run(["soffice", "--headless", "--norestore", f"-env:UserInstallation=file://{workdir}/lo",
                        "--convert-to", "pdf", "--outdir", workdir, src], check=True, timeout=900,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        doc = fitz.open(src[:-5] + ".pdf")
        if doc.page_count != len(index):
            raise RuntimeError(f"rendered {doc.page_count} pages for {len(index)} states")
        for n, page in enumerate(doc):
            i, k = index[n]
            pix = page.get_pixmap(matrix=fitz.Matrix(W / page.rect.width, H / page.rect.height), alpha=False)
            path = os.path.join(workdir, f"s{i:02d}_{k:02d}.png")
            pix.save(path)
            out[i].append(path)
        doc.close()
        os.remove(src)
    return out


def _ff(args):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"] + args, capture_output=True, text=True, timeout=1800)
    if r.returncode:
        raise RuntimeError("ffmpeg: " + r.stderr[-800:])


def segment(pics, starts_ms, dur_ms, audio, prev_pic, out, workdir, n):
    D = dur_ms / 1000
    T = [s / 1000 for s in starts_ms]
    args, filt = [], []
    lead = 1 if prev_pic else 0
    if prev_pic:
        args += ["-loop", "1", "-t", f"{FADE_S:.3f}", "-i", prev_pic]
    for j, pic in enumerate(pics):
        end = T[j + 1] if j + 1 < len(T) else D
        length = (end - T[j]) + (FADE_S if j + 1 < len(T) else 0)
        if j == 0:
            length = end + (FADE_S if j + 1 < len(T) else 0)
        args += ["-loop", "1", "-t", f"{max(length, FADE_S + 0.05):.3f}", "-i", pic]
    a_idx = lead + len(pics)
    if audio:
        ap = os.path.join(workdir, f"a{n:02d}.mp3")
        open(ap, "wb").write(audio)
        args += ["-i", ap]
    else:
        args += ["-f", "lavfi", "-t", f"{D:.3f}", "-i", "anullsrc=r=44100:cl=stereo"]
    norm = lambda i: f"[{i}:v]scale={W}:{H},fps={FPS},format=yuv420p,setsar=1[v{i}]"
    for i in range(a_idx):
        filt.append(norm(i))
    cur = f"v{lead}"
    if prev_pic:
        filt.append(f"[v0][v1]xfade=transition=fade:duration={FADE_S}:offset=0[c1]")
        cur = "c1"
    for j in range(1, len(pics)):
        nxt = f"c{j + 1}x"
        filt.append(f"[{cur}][v{lead + j}]xfade=transition=fade:duration={FADE_S}:offset={T[j]:.3f}[{nxt}]")
        cur = nxt
    filt.append(f"[{cur}]trim=duration={D:.3f},setpts=PTS-STARTPTS[vo]")
    filt.append(f"[{a_idx}:a]aresample=44100,aformat=channel_layouts=stereo,apad,atrim=duration={D:.3f}[ao]")
    _ff(["-filter_threads", "1"] + args + ["-filter_complex", ";".join(filt), "-map", "[vo]", "-map", "[ao]",
                "-threads", "1", "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-crf", "24", "-r", str(FPS),
                "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2", out])


def make(pptx_bytes, stripped_pptx, log=None):
    """MP4 bytes for the narrated deck. stripped_pptx = the same deck without audio and timing (to_pdf's input)."""
    import gc
    prs = Presentation(io.BytesIO(pptx_bytes))
    plans = plan(prs)
    del prs
    gc.collect()
    with tempfile.TemporaryDirectory() as d:
        pics = render_states(stripped_pptx, plans, d)
        segs, prev = [], None
        for i, (p, ps) in enumerate(zip(plans, pics)):
            starts = [t for t, _ in states(p)]
            seg = os.path.join(d, f"seg{i:02d}.mp4")
            segment(ps, starts, p["dur_ms"], p["audio"], prev, seg, d, i)
            segs.append(seg); prev = ps[-1]
            if log is not None:
                log.append(dict(slide=i + 1, ms=p["dur_ms"], pictures=len(ps), audio=bool(p["audio"])))
        lst = os.path.join(d, "list.txt")
        open(lst, "w").write("".join(f"file '{s}'\n" for s in segs))
        out = os.path.join(d, "roadmap.mp4")
        _ff(["-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", "-movflags", "+faststart", out])
        return open(out, "rb").read()
