"""Background job for the Free Roadmap build: fetch the approved roadmap from Supabase, build the
PPTX and PDF, and hand both back through the secret-checked RPCs (same pattern as engine.py)."""
import base64, re, threading, traceback
import requests
import engine, roadmap

TYPES = {"pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", "pdf": "application/pdf",
         "poster": "image/jpeg"}
EXT = {"poster": "jpg"}


def _filename(req, kind):
    import unicodedata
    name = unicodedata.normalize("NFKD", f"{req.get('first_name', '')} {req.get('last_name', '')}").encode("ascii", "ignore").decode()
    base = re.sub(r"[^A-Za-z0-9]+", "_", name.title()).strip("_")  # Hervé -> Herve, never Herv
    return f"Ascend_Roadmap_{base}.{EXT.get(kind, kind)}"


def _save(req_id, req, blobs, meta):
    """Upload the files straight to Storage (signed upload slots from roadmap-export), then record the paths.
    A narrated deck is tens of MB: too big to pass through the database API."""
    files = [{"kind": k, "filename": _filename(req, k)} for k in blobs]
    r = requests.post(f"{engine.SUPABASE_URL}/functions/v1/roadmap-export", timeout=60,
                      json={"action": "upload", "request_id": req_id, "secret": engine.ENGINE_SECRET, "files": files})
    r.raise_for_status()
    slots = r.json()
    done = []
    for f in files:
        slot = slots.get(f["kind"]) or {}
        if not slot.get("signed_url"):
            raise RuntimeError(f"upload slot {f['kind']}: {slot.get('error')}")
        url = slot["signed_url"]
        if url.startswith("/"):
            url = engine.SUPABASE_URL + "/storage/v1" + url
        u = requests.put(url, data=blobs[f["kind"]], timeout=300,
                         headers={"Content-Type": TYPES[f["kind"]], "x-upsert": "true"})
        if u.status_code >= 300:
            raise RuntimeError(f"upload {f['kind']} {u.status_code}: {u.text[:300]}")
        done.append(dict(f, path=slot["path"], size=len(blobs[f["kind"]])))
    engine.rpc("roadmap_build_done", p_secret=engine.ENGINE_SECRET, p_id=req_id, p_meta=meta, p_files=done)

def poster(pdf):
    """The video thumbnail on the lead's page: slide 1 of the roadmap, 1920x1080 JPEG."""
    import fitz
    doc = fitz.open(stream=pdf, filetype="pdf")
    page = doc[0]
    pix = page.get_pixmap(matrix=fitz.Matrix(1920 / page.rect.width, 1080 / page.rect.height), alpha=False)
    out = pix.tobytes("jpeg", jpg_quality=88)
    doc.close()
    return out


def make_poster(req_id):
    """Thumbnail for a roadmap already built (no rebuild, status unchanged): slide 1 of its stored PDF."""
    r = requests.post(f"{engine.SUPABASE_URL}/functions/v1/roadmap-export", timeout=120,
                      json={"request_id": req_id, "secret": engine.ENGINE_SECRET})
    r.raise_for_status()
    pdf = (r.json() or {}).get("pdf") or {}
    if not pdf.get("url"):
        raise RuntimeError("no stored PDF for this roadmap")
    blob = poster(requests.get(pdf["url"], timeout=120).content)
    name = re.sub(r"\.pdf$", ".jpg", pdf.get("filename") or "Ascend_Roadmap.pdf")
    s = requests.post(f"{engine.SUPABASE_URL}/functions/v1/roadmap-export", timeout=60,
                      json={"action": "upload", "request_id": req_id, "secret": engine.ENGINE_SECRET,
                            "files": [{"kind": "poster", "filename": name}]}).json().get("poster") or {}
    if not s.get("signed_url"):
        raise RuntimeError(f"upload slot poster: {s.get('error')}")
    url = s["signed_url"] if not s["signed_url"].startswith("/") else engine.SUPABASE_URL + "/storage/v1" + s["signed_url"]
    u = requests.put(url, data=blob, timeout=120, headers={"Content-Type": "image/jpeg", "x-upsert": "true"})
    if u.status_code >= 300:
        raise RuntimeError(f"upload poster {u.status_code}: {u.text[:300]}")
    engine.rpc("roadmap_poster_done", p_secret=engine.ENGINE_SECRET, p_id=req_id,
               p_file={"filename": name, "path": s["path"], "size": len(blob)})
    return {"path": s["path"], "bytes": len(blob)}


def _video(req_id, pptx):
    """The narrated deck as an MP4, made here (no PowerPoint step), uploaded to roadmap-videos. A failure leaves the
    deck ready to export by hand: it is logged, never turned into an error status."""
    import roadmap_video
    try:
        log = []
        mp4 = roadmap_video.make(pptx, roadmap._strip_narration(pptx), log)
        r = requests.post(f"{engine.SUPABASE_URL}/functions/v1/roadmap-export", timeout=60,
                          json={"action": "video_slot", "request_id": req_id, "secret": engine.ENGINE_SECRET})
        r.raise_for_status()
        slot = r.json()
        url = slot["signed_url"]
        if url.startswith("/"):
            url = engine.SUPABASE_URL + "/storage/v1" + url
        u = requests.put(url, data=mp4, timeout=600, headers={"Content-Type": "video/mp4", "x-upsert": "true"})
        if u.status_code >= 300:
            raise RuntimeError(f"video upload {u.status_code}: {u.text[:300]}")
        d = requests.post(f"{engine.SUPABASE_URL}/functions/v1/roadmap-export", timeout=60,
                          json={"action": "video_done", "request_id": req_id, "secret": engine.ENGINE_SECRET, "path": slot["path"]})
        d.raise_for_status()
        engine.log("roadmap", req_id, "video", {"bytes": len(mp4), "slides": len(log), "seconds": round(sum(x["ms"] for x in log) / 1000)})
    except Exception:
        engine.log("roadmap", req_id, "video failed", traceback.format_exc()[-1500:])


_lock = threading.Lock()
_running = set()


def start(req_id):
    with _lock:
        if req_id in _running:
            return False
        _running.add(req_id)
    threading.Thread(target=_run, args=(req_id,), daemon=True).start()
    return True


def _run(req_id):
    try:
        job = engine.rpc("roadmap_build_job", p_secret=engine.ENGINE_SECRET, p_id=req_id)
        if not job:
            engine.log("roadmap", req_id, "not in a buildable status")
            return
        pptx, meta = roadmap.build(job)
        pdf = roadmap.to_pdf(pptx)
        _save(req_id, job["request"], {"pptx": pptx, "pdf": pdf, "poster": poster(pdf)}, meta)
        engine.log("roadmap", req_id, "built", meta)
        # The video is exported by PowerPoint on Christian's PC (pc/Export_Roadmaps.bat): it renders the deck more
        # cleanly than the server could. roadmap_video.py (server-made video) is kept but no longer called.
    except Exception as e:
        engine.log("roadmap", req_id, "failed", traceback.format_exc()[-1500:])
        try:
            engine.rpc("roadmap_build_result", p_secret=engine.ENGINE_SECRET, p_id=req_id, p_pptx=None, p_pdf=None,
                       p_meta=None, p_error=f"{type(e).__name__}: {e}"[:1000])
        except Exception:
            pass
    finally:
        with _lock:
            _running.discard(req_id)
