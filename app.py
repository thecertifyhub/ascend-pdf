"""Ascend PDF converter: HTML in, PDF out, rendered with WeasyPrint.

POST /pdf   header  X-Api-Key: <PDF_API_KEY>
            body    JSON {"html": "<full html>", "filename": "Report.pdf"}
            returns application/pdf, plus check headers:
              X-Pages        number of pages
              X-Fonts        fonts embedded in the PDF
              X-Dashes       em/en dashes found in the HTML text (must be 0)
GET  /health  returns ok (used to wake the free server up)

POST /intake?key=<PDF_API_KEY>     Zoho Forms webhook (multipart with files). Stores the
                                   submission in Supabase and starts the report job.
POST /jobs/<id>/run                (X-Api-Key header or ?key=) re-runs a stored job.
"""
import os, re, hmac
from flask import Flask, request, Response, jsonify
from weasyprint import HTML

app = Flask(__name__)
API_KEY = os.environ.get("PDF_API_KEY", "")
app.config["MAX_CONTENT_LENGTH"] = 40 * 1024 * 1024


def _authorized():
    k = request.headers.get("X-Api-Key") or request.args.get("key") or ""
    return bool(API_KEY) and hmac.compare_digest(k, API_KEY)


@app.get("/health")
def health():
    return "ok"


@app.post("/pdf")
def pdf():
    if not API_KEY or not hmac.compare_digest(request.headers.get("X-Api-Key", ""), API_KEY):
        return jsonify(error="unauthorized"), 401
    data = request.get_json(silent=True) or {}
    html = data.get("html") or ""
    if not html.strip():
        return jsonify(error="html is empty"), 400
    name = re.sub(r"[^A-Za-z0-9_.-]", "_", data.get("filename") or "report.pdf")

    text_only = re.sub(r"<style.*?</style>|<[^>]+>", " ", html, flags=re.S)
    dashes = len(re.findall("[–—]", text_only))

    doc = HTML(string=html).render()
    pdf_bytes = doc.write_pdf()
    fonts = sorted({f.name.decode(errors="ignore").lstrip("/").split("+", 1)[-1] for f in doc.fonts.values()})

    return Response(pdf_bytes, mimetype="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="{name}"',
        "X-Pages": str(len(doc.pages)),
        "X-Fonts": ",".join(fonts),
        "X-Dashes": str(dashes),
        "Access-Control-Expose-Headers": "X-Pages, X-Fonts, X-Dashes",
    })


@app.post("/intake")
def intake():
    if not _authorized():
        return jsonify(error="unauthorized"), 401
    import engine
    form, resume, linkedin = engine.parse_submission(request)
    job_id = engine.store_intake(form, resume, linkedin)
    engine.start_job(job_id)
    return jsonify(ok=True, id=job_id, resume=bool(resume), linkedin=bool(linkedin))


@app.route("/jobs/<job_id>/run", methods=["GET", "POST"])
def run_job(job_id):
    if not _authorized():
        return jsonify(error="unauthorized"), 401
    import engine
    started = engine.start_job(job_id)
    if request.method == "GET":
        return Response("<p style='font-family:sans-serif'>Report generation restarted. You will receive the review email when it is ready.</p>" if started
                        else "<p style='font-family:sans-serif'>This report is already being generated.</p>", mimetype="text/html")
    return jsonify(ok=True, started=started)
