"""Ascend PDF converter: HTML in, PDF out, rendered with WeasyPrint.

POST /pdf   header  X-Api-Key: <PDF_API_KEY>
            body    JSON {"html": "<full html>", "filename": "Report.pdf"}
            returns application/pdf, plus check headers:
              X-Pages        number of pages
              X-Fonts        fonts embedded in the PDF
              X-Dashes       em/en dashes found in the HTML text (must be 0)
GET  /health  returns ok (used to wake the free server up)
"""
import os, re, hmac
from flask import Flask, request, Response, jsonify
from weasyprint import HTML

app = Flask(__name__)
API_KEY = os.environ.get("PDF_API_KEY", "")
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024


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
