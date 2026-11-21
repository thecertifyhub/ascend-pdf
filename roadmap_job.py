"""Background job for the Free Roadmap build: fetch the approved roadmap from Supabase, build the
PPTX and PDF, and hand both back through the secret-checked RPCs (same pattern as engine.py)."""
import base64, re, threading, traceback
import requests
import engine, roadmap

TYPES = {"pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", "pdf": "application/pdf"}


def _filename(req, kind):
    base = re.sub(r"[^A-Za-z0-9]+", "_", f"{req.get('first_name', '')} {req.get('last_name', '')}".title()).strip("_")
    return f"Ascend_Roadmap_{base}.{kind}"


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
        _save(req_id, job["request"], {"pptx": pptx, "pdf": pdf}, meta)
        engine.log("roadmap", req_id, "built", meta)
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
