"""Ascend positioning report engine.

Receives a Zoho Forms submission, stores it in Supabase, then (in the background)
writes the Resume Analysis and the LinkedIn Analysis with Claude, renders both
PDFs with WeasyPrint, checks them, and stores the results in Supabase. The 24-hour
review email and the client delivery are handled by Supabase (cron) and Make.
"""
import os, re, io, json, base64, hashlib, threading, subprocess, tempfile, traceback, unicodedata, datetime
from zoneinfo import ZoneInfo

import requests
from cryptography.fernet import Fernet
from weasyprint import HTML

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://jbncsigalbtfwkxpgwso.supabase.co")
SUPABASE_ANON = os.environ.get("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpibmNzaWdhbGJ0ZndreHBnd3NvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMDUxODcsImV4cCI6MjA5Mjc4MTE4N30.KML-1uKz7J0YYy0Z3Y8VHZhcrPRd9AR8PqdqbUaP9LY")
ENGINE_SECRET = os.environ.get("ENGINE_SECRET", "")
MODEL = os.environ.get("CLAUDE_MODEL", "claude-opus-5-5")
MAX_TOKENS = int(os.environ.get("CLAUDE_MAX_TOKENS", "32000"))
TZ = ZoneInfo("America/Toronto")
HERE = os.path.dirname(os.path.abspath(__file__))

_job_lock = threading.Lock()
_running = set()
_assets = None

MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def log(*a):
    print("[engine]", *a, flush=True)


# ---------------- Supabase ----------------
def rpc(fn, **params):
    r = requests.post(f"{SUPABASE_URL}/rest/v1/rpc/{fn}", json=params, timeout=120,
                      headers={"apikey": SUPABASE_ANON, "Authorization": f"Bearer {SUPABASE_ANON}", "Content-Type": "application/json"})
    if r.status_code >= 300:
        raise RuntimeError(f"Supabase {fn} {r.status_code}: {r.text[:300]}")
    return r.json() if r.text else None


def assets():
    global _assets
    if _assets is None:
        key = base64.urlsafe_b64encode(hashlib.sha256(ENGINE_SECRET.encode()).digest())
        with open(os.path.join(HERE, "assets.enc"), "rb") as f:
            _assets = json.loads(Fernet(key).decrypt(f.read()))
    return _assets


# ---------------- Intake ----------------
FIELD_ALIASES = {
    "email": ["email", "Email"],
    "full_name_first": ["full_name_first", "Name_First", "First_Name", "first_name"],
    "full_name_last": ["full_name_last", "Name_Last", "Last_Name", "last_name"],
}


def _norm_key(k):
    return re.sub(r"[^a-z0-9]", "", k.lower())


def parse_submission(req):
    """Accepts multipart (files) or JSON. Returns (form dict, resume (name,bytes), linkedin (name,bytes))."""
    form = {}
    if req.is_json:
        data = req.get_json(silent=True) or {}
        for k, v in data.items():
            form[k] = ", ".join(map(str, v)) if isinstance(v, list) else ("" if v is None else str(v))
    else:
        for k in req.form.keys():
            vals = [v for v in req.form.getlist(k) if v is not None]
            form[k] = ", ".join(vals) if len(vals) > 1 else (vals[0] if vals else "")
    # normalise names of known fields
    nk = {_norm_key(k): k for k in form}
    for canon, aliases in FIELD_ALIASES.items():
        if canon not in form:
            for a in aliases:
                if _norm_key(a) in nk:
                    form[canon] = form[nk[_norm_key(a)]]
                    break
    resume = linkedin = None
    files = []
    for k in req.files.keys():
        for f in req.files.getlist(k):
            b = f.read()
            if b:
                files.append((k, f.filename or k, b))
    for k, name, b in files:
        lk = (k + " " + name).lower()
        if "linkedin" in lk and linkedin is None:
            linkedin = (name, b)
        elif ("resume" in lk or "cv" in lk) and resume is None:
            resume = (name, b)
    for k, name, b in files:  # fallback by order
        if resume is None and (name, b) != linkedin:
            resume = (name, b)
        elif linkedin is None and (name, b) != resume:
            linkedin = (name, b)
    return form, resume, linkedin


def store_intake(form, resume, linkedin):
    lang = (form.get("report_language") or form.get("form_lang") or "EN").strip()
    lang = "FR" if lang.lower().startswith("fr") else "EN"
    payload = {
        "form": form, "report_language": lang,
        "resume_name": resume[0] if resume else None,
        "resume_type": (resume[0].rsplit(".", 1)[-1].lower() if resume and "." in resume[0] else None),
        "resume_b64": base64.b64encode(resume[1]).decode() if resume else None,
        "linkedin_name": linkedin[0] if linkedin else None,
        "linkedin_b64": base64.b64encode(linkedin[1]).decode() if linkedin else None,
    }
    return rpc("pr_engine_intake", p_secret=ENGINE_SECRET, p_payload=payload)


def start_job(job_id):
    job_id = str(job_id)
    if job_id in _running:
        return False
    _running.add(job_id)
    threading.Thread(target=_run_job, args=(job_id,), daemon=True).start()
    return True


# ---------------- Documents ----------------
def to_pdf(name, data):
    """Returns (pdf_bytes, note). Word files are converted with LibreOffice."""
    ext = (name.rsplit(".", 1)[-1].lower() if name and "." in name else "")
    if data[:4] == b"%PDF":
        return data, None
    if ext in ("doc", "docx", "odt", "rtf") or data[:2] == b"PK":
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, "resume." + (ext or "docx"))
            open(src, "wb").write(data)
            subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", d, src],
                           check=True, timeout=240, capture_output=True)
            return open(os.path.join(d, "resume.pdf"), "rb").read(), "converted from Word"
    raise RuntimeError(f"Unsupported resume format: {name}")


def text_chars(pdf):
    try:
        from pypdf import PdfReader
        rd = PdfReader(io.BytesIO(pdf))
        return sum(len((p.extract_text() or "").strip()) for p in rd.pages), len(rd.pages)
    except Exception:
        return 0, 0


# ---------------- Claude ----------------
def call_claude(system_text, docs, user_text):
    import anthropic
    client = anthropic.Anthropic(timeout=1800, max_retries=3)
    content = []
    for title, pdf in docs:
        content.append({"type": "document", "title": title,
                        "source": {"type": "base64", "media_type": "application/pdf", "data": base64.b64encode(pdf).decode()}})
    content.append({"type": "text", "text": user_text})
    out = []
    with client.messages.stream(
        model=MODEL, max_tokens=MAX_TOKENS,
        system=[{"type": "text", "text": system_text, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": content}],
    ) as stream:
        for t in stream.text_stream:
            out.append(t)
        final = stream.get_final_message()
    text = "".join(out)
    log("claude done", MODEL, final.stop_reason, getattr(final, "usage", None))
    if final.stop_reason == "max_tokens":
        raise RuntimeError("Claude output hit the token limit")
    return text


def block(text, tag):
    m = re.search(rf"<{tag}>\s*(.*?)\s*</{tag}>", text, re.S)
    return m.group(1).strip() if m else None


# ---------------- Clean-up and checks ----------------
def clean_dashes(html):
    html = html.replace("&mdash;", "—").replace("&ndash;", "–")
    html = re.sub(r"(\d)\s*[–—]\s*(\d)", r"\1-\2", html)
    html = re.sub(r"\s*[—–]\s*", ", ", html)
    return html.replace(", ,", ",")


DIM_KEYS = [("mise en forme", "formatting", "format"), ("profondeur", "content"), ("exhaustiv",),
            ("pertinence",), ("ats", "compatibilit"), ("langue", "language")]


def dim_index(label):
    l = re.sub(r"<[^>]+>", "", label).strip().lower()
    for i, keys in enumerate(DIM_KEYS):
        if any(l.startswith(k) or k in l for k in keys):
            return i
    return None


def check_resume(body):
    issues = []
    if "{{" in body:
        issues.append("Unfilled {{placeholders}} remain: " + ", ".join(sorted(set(re.findall(r"{{[A-Z_0-9]+}}", body)))[:10]))
    n_sec = len(re.findall(r"<h2>\s*\d+\.", body))
    if n_sec != 10:
        issues.append(f"Found {n_sec} numbered section titles (h2), expected 10.")
    n_act = len(re.findall(r'<div class="action"', body))
    if n_act != 4:
        issues.append(f"Found {n_act} action cards, expected exactly 4.")
    n_top = len(re.findall(r'class="topbadge"', body))
    if n_top != 1:
        issues.append(f"Found {n_top} top-impact badges, expected exactly 1.")
    rows = re.findall(r'<td class="dim">(.*?)</td>\s*<td class="c">\s*(\d+)\s*/10</td>.*?<td class="exp">\s*([\d\-]+)\s*/10</td>', body, re.S)
    cur, exp = {}, {}
    for lab, c, e in rows:
        i = dim_index(lab)
        if i is not None:
            cur[i], exp[i] = int(c), e
    if len(rows) != 6:
        issues.append(f"Scorecard has {len(rows)} dimension rows, expected 6.")
    state = dict(cur)
    for li in re.findall(r'<div class="lift">(.*?)</div>', body, re.S):
        for lab, a, b in re.findall(r"<b>([^<]+)</b>\s*<b>\s*(\d+)\s*→\s*(\d+)\s*</b>", li):
            i = dim_index(lab)
            if i is None or i not in state:
                continue
            if int(a) != state[i]:
                issues.append(f"Lift for '{lab.strip()}' starts at {a}, but the previous value was {state[i]}.")
            state[i] = int(b)
    for i, e in exp.items():
        if "-" not in e and i in state and state[i] != int(e) and state[i] != cur.get(i):
            issues.append(f"Final lift value for dimension {i+1} is {state[i]}, but the scorecard Expected column says {e}.")
    for i, c in cur.items():
        band = "b-weak" if c <= 3 else ("b-adeq" if c <= 6 else "b-strong")
        row = next((r for r in re.findall(r"<tr>.*?</tr>", body, re.S) if '<td class="dim">' in r and dim_index(re.search(r'<td class="dim">(.*?)</td>', r, re.S).group(1)) == i), "")
        if row and band not in row:
            issues.append(f"Badge for dimension {i+1} (score {c}) should use class {band}.")
    return issues


def check_linkedin(body):
    issues = []
    if "{{" in body:
        issues.append("Unfilled {{placeholders}} remain: " + ", ".join(sorted(set(re.findall(r"{{[A-Z_0-9]+}}", body)))[:10]))
    n = len(re.findall(r"<h1[^>]*>\s*\d+\.", body))
    if n != 11:
        issues.append(f"Found {n} numbered section titles (h1), expected 11.")
    return issues


def slug(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[^A-Za-z0-9-]+", "_", s.strip()).strip("_")
    return s or "Client"


def render(html):
    doc = HTML(string=html).render()
    pdf = doc.write_pdf()
    fonts = sorted({f.name.decode(errors="ignore").lstrip("/").split("+", 1)[-1] for f in doc.fonts.values()})
    return pdf, len(doc.pages), fonts


# ---------------- Report builders ----------------
def build_report(kind, intake, docs, lang, client_hint):
    a = assets()
    system = a["resume_system"] if kind == "resume" else a["linkedin_system"]
    user = ("Intake for this run (JSON):\n" + json.dumps(intake, ensure_ascii=False, indent=1) +
            "\n\nProduce the report now, following the output format exactly.")
    text = call_claude(system, docs, user)
    body = block(text, "report")
    if not body:
        text = call_claude(system, docs, user + "\n\nYour previous answer did not contain a <report> block. Output all required blocks.")
        body = block(text, "report")
        if not body:
            raise RuntimeError(f"{kind}: no <report> block in Claude's answer")
    decisions = [l.strip()[2:].strip() for l in (block(text, "decisions") or "").splitlines() if l.strip().startswith("- ")]
    try:
        meta = json.loads(block(text, "meta") or "{}")
    except Exception:
        meta = {}
    body = clean_dashes(body)
    issues = check_resume(body) if kind == "resume" else check_linkedin(body)
    if issues:
        log(kind, "fix pass:", issues)
        fix = call_claude(system, docs, user + "\n\nYou already wrote this report body:\n<report>\n" + body +
                          "\n</report>\n\nAn automatic check found these problems:\n- " + "\n- ".join(issues) +
                          "\n\nOutput the four required blocks again (or three for LinkedIn) with a corrected <report>. Keep everything that was correct.")
        fixed = block(fix, "report")
        if fixed:
            body = clean_dashes(fixed)
            nd = [l.strip()[2:].strip() for l in (block(fix, "decisions") or "").splitlines() if l.strip().startswith("- ")]
            decisions = nd or decisions
            try:
                meta = json.loads(block(fix, "meta") or "{}") or meta
            except Exception:
                pass
            issues = check_resume(body) if kind == "resume" else check_linkedin(body)
    name = meta.get("client_full_name") or client_hint
    first = meta.get("client_first_name") or name.split(" ")[0]
    last = meta.get("client_last_name") or (name.split(" ")[-1] if " " in name else "")
    fr = lang == "FR"
    if kind == "resume":
        title = "Analyse Professionnelle de CV" if fr else "Professional Resume Analysis"
        head = (a["resume_head"].replace("{{LANG}}", "fr" if fr else "en").replace("{{REPORT_TITLE}}", title)
                .replace("{{CLIENT_NAME}}", name).replace("{{CLIENT_SHORT_NAME}}", f"{first} {last}".strip())
                .replace("{{PAGE_OF}}", "sur" if fr else "of"))
    else:
        head = (a["linkedin_head"].replace("{{LANG}}", "fr" if fr else "en").replace("{{CLIENT_NAME}}", name)
                .replace("{{FOOTER_CENTER_TEXT}}", ("Confidentiel, Préparé pour " if fr else "Confidential, Prepared for ") + name)
                .replace("{{PAGE_LABEL}}", "Page").replace("{{OF_LABEL}}", "sur" if fr else "of"))
    html = head + "\n" + body + "\n</body>\n</html>\n"
    pdf, pages, fonts = render(html)
    qa = {"pages": pages, "fonts": fonts, "issues": issues}
    flags = []
    if kind == "resume":
        if not 20 <= pages <= 24:
            flags.append(f"Resume report is {pages} pages (target 20 to 24).")
        if any("DejaVu" in f for f in fonts):
            flags.append("Resume report used a fallback font (DejaVu); check the typography.")
    else:
        if not 10 <= pages <= 16:
            flags.append(f"LinkedIn report is {pages} pages (usual range 12 to 15).")
    for i in issues:
        flags.append(f"Automatic check still failing ({kind}): {i}")
    return {"pdf": pdf, "pages": pages, "qa": qa, "decisions": decisions, "flags": flags,
            "name": name, "first": first, "last": last}


def _run_job(job_id):
    try:
        with _job_lock:
            job = rpc("pr_engine_job", p_secret=ENGINE_SECRET, p_id=job_id)
            if not job:
                log("job not runnable", job_id)
                return
            log("job start", job_id, "attempt", job.get("attempts"))
            form = job["form"] or {}
            lang = job.get("report_language") or "EN"
            due = datetime.datetime.fromisoformat(job["review_due_at"]).astimezone(TZ).date()
            report_date = (f"{due.day}{'er' if due.day == 1 else ''} {MONTHS_FR[due.month-1]} {due.year}" if lang == "FR"
                           else f"{MONTHS_EN[due.month-1]} {due.day}, {due.year}")
            notes = []
            if not job.get("resume_b64"):
                raise RuntimeError("No resume file in the submission")
            if not job.get("linkedin_b64"):
                raise RuntimeError("No LinkedIn PDF in the submission")
            resume_pdf, conv = to_pdf(job.get("resume_name") or "resume", base64.b64decode(job["resume_b64"]))
            chars, npages = text_chars(resume_pdf)
            is_scan = chars < 300
            if conv:
                notes.append(f"Resume received as a Word file ({job.get('resume_name')}), converted to PDF for the analysis.")
            linkedin_pdf = base64.b64decode(job["linkedin_b64"])
            if linkedin_pdf[:4] != b"%PDF":
                raise RuntimeError("The LinkedIn file is not a PDF")
            intake = {
                "report_language": lang, "report_date": report_date,
                "form_name": f"{form.get('full_name_first','')} {form.get('full_name_last','')}".strip(),
                "email": form.get("email"),
                "target_role": form.get("target_role"), "other_roles": form.get("other_roles"),
                "job_postings": form.get("job_postings"), "target_industries": form.get("target_industries"),
                "target_geography": form.get("target_geography"), "secondary_geography": form.get("secondary_geography"),
                "current_location": form.get("current_location"), "search_status": form.get("search_status"),
                "open_to_work": form.get("open_to_work"), "context_notes": form.get("context_notes"),
                "linkedin_url": form.get("linkedin_url"),
                "resume_is_scan": is_scan, "resume_pages": npages, "resume_original_filename": job.get("resume_name"),
            }
            hint = intake["form_name"] or "Client"
            res = build_report("resume", intake, [("Client resume", resume_pdf)], lang, hint)
            lin = build_report("linkedin", intake, [("Client LinkedIn profile (Save to PDF export)", linkedin_pdf),
                                                    ("Client resume", resume_pdf)], lang, res["name"])
            date_s = due.isoformat()
            fn = f"{slug(res['first'])}_{slug(res['last'])}".strip("_")
            decisions = notes + res["decisions"] + [d for d in lin["decisions"] if d not in res["decisions"]] + res["flags"] + lin["flags"]
            decisions = [d for d in decisions if d and d.lower() != "none"]
            rpc("pr_engine_result", p_secret=ENGINE_SECRET, p_id=job_id, p_result={
                "client_full_name": res["name"], "client_first_name": res["first"],
                "resume_pdf_name": f"Ascend_Resume_Analysis_{fn}_{date_s}.pdf",
                "resume_pdf_b64": base64.b64encode(res["pdf"]).decode(), "resume_pages": res["pages"],
                "linkedin_pdf_name": f"Ascend_LinkedIn_Analysis_{fn}_{date_s}.pdf",
                "linkedin_pdf_b64": base64.b64encode(lin["pdf"]).decode(), "linkedin_pages": lin["pages"],
                "decisions": decisions, "qa": {"resume": res["qa"], "linkedin": lin["qa"], "model": MODEL},
            })
            log("job done", job_id, res["pages"], lin["pages"])
    except Exception as e:
        log("job failed", job_id, repr(e))
        traceback.print_exc()
        try:
            rpc("pr_engine_result", p_secret=ENGINE_SECRET, p_id=job_id, p_result={"error": f"{type(e).__name__}: {e}"[:1000]})
        except Exception:
            traceback.print_exc()
    finally:
        _running.discard(str(job_id))
