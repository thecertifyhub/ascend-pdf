"""Background job for the Free Roadmap build: fetch the approved roadmap from Supabase, build the
PPTX and PDF, and hand both back through the secret-checked RPCs (same pattern as engine.py)."""
import base64, threading, traceback
import engine, roadmap

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
        engine.rpc("roadmap_build_result", p_secret=engine.ENGINE_SECRET, p_id=req_id,
                   p_pptx=base64.b64encode(pptx).decode(), p_pdf=base64.b64encode(pdf).decode(), p_meta=meta, p_error=None)
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
