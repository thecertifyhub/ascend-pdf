"""Free Roadmap builder: approved roadmap JSON -> personalized PPTX (+ PDF via LibreOffice).

The template (templates/roadmap_<lang>.pptx) is the approved 17-slide deck. Every text box has a
stable name (row0_target_text, p2_bar, ...). The builder only rewrites text, bar widths, chip colours
and hides or drops what a lead's case does not use, so the design and animations stay intact.
"""
import copy, math, os, re, subprocess, tempfile, datetime
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.util import Pt
from pptx.oxml.ns import qn

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATES = os.path.join(HERE, "templates")

RED, AMBER, GREEN = "C2463A", "E0A526", "2E7D4F"
CHIP = {  # fill, line/text
    "on_track": ("DCEBE1", "2E7D4F"),
    "in_progress": ("FBF0D9", "B7860F"),
    "not_started": ("F6E3E0", "C2463A"),
}
REGION = {
    "EN": {"CA": "Canada", "ON": "Ontario", "QC": "Quebec", "AB": "Alberta", "BC": "British Columbia", "SK": "Saskatchewan", "MB": "Manitoba"},
    "FR": {"CA": "Canada", "ON": "Ontario", "QC": "Québec", "AB": "Alberta", "BC": "Colombie-Britannique", "SK": "Saskatchewan", "MB": "Manitoba"},
}
OCC_SHORT = {
    "EN": {"72410": "Automotive tech", "72400": "Industrial mechanic", "72020": "Maintenance supervisor",
           "70012": "Maintenance manager", "21301": "Engineer", "72201": "Industrial electrician"},
    "FR": {"72410": "Technicien automobile", "72400": "Mécanicien industriel", "72020": "Superviseur de maintenance",
           "70012": "Gestionnaire de maintenance", "21301": "Ingénieur", "72201": "Électricien industriel"},
}
FAMILY = {
    "EN": {"specialist": "Maintenance Specialist", "supervisor": "Maintenance Supervisor", "planner": "Maintenance Planner",
           "reliability_engineer": "Reliability Engineer", "manager": "Maintenance Manager", "asset_management": "Asset Management Specialist"},
    "FR": {"specialist": "Spécialiste en maintenance", "supervisor": "Superviseur de maintenance", "planner": "Planificateur de maintenance",
           "reliability_engineer": "Ingénieur fiabilité", "manager": "Gestionnaire de maintenance", "asset_management": "Spécialiste en gestion des actifs"},
}
# What employers ask for, per role family: (technical expertise, experience)
ASK = {
    "EN": {
        "specialist": ("Troubleshooting of electrical, mechanical and hydraulic systems; preventive and predictive maintenance.",
                       "Hands-on maintenance of equipment, with work orders, safety and teams."),
        "supervisor": ("Sound technical judgment across trades, plus maintenance indicators, safety programs and the maintenance system (CMMS).",
                       "Several years in maintenance, including leading a crew or a shift."),
        "planner": ("Work planning and scheduling, job estimates, parts and the maintenance system (CMMS).",
                    "Hands-on maintenance experience and coordination of work across trades."),
        "reliability_engineer": ("Failure analysis, root cause analysis, criticality and predictive maintenance programs.",
                                 "Several years improving equipment reliability, usually with an engineering background."),
        "manager": ("Maintenance strategy, budgets, performance indicators and the management of people and contractors.",
                    "Years of maintenance leadership, from supervision to department level."),
        "asset_management": ("Lifecycle cost, risk-based decisions, criticality and the asset management system (ISO 55000).",
                             "Experience in reliability or maintenance engineering at plant or fleet level."),
    },
    "FR": {
        "specialist": ("Diagnostic des systèmes électriques, mécaniques et hydrauliques; maintenance préventive et prédictive.",
                       "Maintenance d'équipements sur le terrain, avec bons de travail, sécurité et équipes."),
        "supervisor": ("Un solide jugement technique multimétier, les indicateurs de maintenance, la sécurité et la GMAO.",
                       "Plusieurs années en maintenance, dont la direction d'une équipe ou d'un quart."),
        "planner": ("Planification et ordonnancement des travaux, estimations, pièces et GMAO.",
                    "Une expérience terrain en maintenance et la coordination de travaux multimétiers."),
        "reliability_engineer": ("Analyse de défaillances et des causes racines, criticité et programmes de maintenance prédictive.",
                                 "Plusieurs années à améliorer la fiabilité des équipements, souvent avec une formation d'ingénieur."),
        "manager": ("Stratégie de maintenance, budgets, indicateurs de performance et gestion des équipes et des sous-traitants.",
                    "Des années de leadership en maintenance, de la supervision à la direction d'un service."),
        "asset_management": ("Coût sur le cycle de vie, décisions fondées sur le risque, criticité et système de gestion des actifs (ISO 55000).",
                             "Une expérience en ingénierie de fiabilité ou de maintenance, à l'échelle d'une usine ou d'un parc."),
    },
}
TXT = {
    "EN": {
        "prepared": "Prepared for {name}",
        "prepared_date": "Prepared for {name}",
        "path_to": "Your path to",
        "role": "ROLE", "employer": "EMPLOYER AND LOCATION", "location_only": "LOCATION", "experience": "EXPERIENCE",
        "credentials": "CREDENTIALS", "industry": "INDUSTRY", "location": "LOCATION",
        "m_title_gap": "Your next role pays more", "m_title_range": "What the market pays for your next role",
        "wage_data": "{period} wage data",
        "gap_label": "THE DIFFERENCE OVER A YEAR",
        "gap_text": "more a year at full-time hours, for the experience you already have, applied at the next level.",
        "range_label": "MEDIAN PAY FOR THE ROLE",
        "range_stat": "{amt}/h",
        "invest_title_short": "Three ways to get there faster with us",
        "exp_years": "{y}+ years in {ind}",
        "range_text": "median hourly wage for a {role} {rin}, {period}.",
        "demand_nat": "{openings} openings\nexpected in Canada for this occupation, {period}.",
        "demand_prov": "{rating}\nJob Bank outlook {rin}, {period}.",
        "source": "Median hourly wages, Job Bank (Government of Canada), {periods}. {occs}. Retrieved {retrieved}.",
        "d0_text": "job openings a year in Canada in this field, on average ({period} projection)",
        "d4_title": "A role the market needs every year",
        "top_stat": "Up to {amt}/h",
        "top_text": "at the top of the range for a {role} {rin}, {period}.",
        "d1_text": "of those openings come from retirements, as experienced people leave",
        "d2_text_fewer": "new job seekers a year on average, fewer than the openings",
        "d2_text_more": "new job seekers a year on average, about as many as the openings",
        "concl_shortage": "Federal outlook: a {c}.\nEmployers will compete for qualified people. A recognized credential is how they identify you as one of them.",
        "concl_balance": "Federal outlook: supply and demand in balance.\nEmployers can choose. A recognized credential is how you stand out among qualified candidates.",
        "cops_source": "Source: Canadian Occupational Projection System (COPS), Employment and Social Development Canada, projections {period} for NOC {code}.",
        "prov_title": "A role employers are looking for",
        "prov_text": "Job Bank outlook {rin}, {period}",
        "prov_concl": "Job Bank rates the outlook for this occupation by province.\nWhere it is good, employers compete for qualified people. A recognized credential is how they recognize you as one of them.",
        "prov_source": "Source: Job Bank outlook ratings (Government of Canada), {period}, NOC {code}.",
        "cert_none": "{cred}. No maintenance and reliability credential yet.",
        "cert_none_bare": "No maintenance and reliability credential yet.",
        "cert_progress": "{cred}. Maintenance and reliability certification in progress.",
        "chip": {"on_track": "On track", "in_progress": "In progress", "not_started": "Not started"},
        "bottom_both": "Your expertise and experience already meet the bar. A recognized certification makes them visible to employers.",
        "bottom_one": "Structured learning and a recognized certification close the rest, and make your profile visible to employers.",
        "bottom_none": "Build the expertise, structure your experience, and prove it with a recognized certification.",
        "score": "{s}/10", "status": {"red": "TO STRENGTHEN", "yellow": "DEVELOPING", "green": "ON TRACK"},
        "invest_title": "Three ways to get to {role} faster with us",
        "money": lambda v, cents=False: ("${:,.2f}" if cents else "${:,.0f}").format(v),
        "sub": "{amt} with the {disc} call discount",
        "save": "SAVE {amt}",
        "pay_band": ["Prices in {cur}. Payment plans available.", "", "The {disc} discount is offered during your 15-minute roadmap debrief."],
        "cur": {"CAD": "Canadian dollars", "USD": "US dollars"},
        "roi": "With the wage gap shown earlier, the investment pays for itself in {a} to {b} months in your new role.",
        "roi_one": "With the wage gap shown earlier, the investment pays for itself in about {a} month(s) in your new role.",
        "step0": "Book your 15-minute roadmap debrief\nBy {date}. We answer your questions and confirm your path.",
        "kstat": lambda a, b: (f"${a}K" if a == b else f"${a}K to ${b}K"),
    },
    "FR": {
        "prepared": "Préparé pour {name}",
        "path_to": "Votre prochain poste :",
        "role": "POSTE", "employer": "EMPLOYEUR ET LIEU", "location_only": "LIEU", "experience": "EXPÉRIENCE",
        "credentials": "TITRES ET CERTIFICATIONS", "industry": "INDUSTRIE", "location": "LIEU",
        "m_title_gap": "Votre prochain poste paie davantage", "m_title_range": "Ce que le marché paie pour votre prochain poste",
        "wage_data": "Données salariales {period}",
        "gap_label": "LA DIFFÉRENCE SUR UN AN",
        "gap_text": "de plus par année à temps plein, pour l'expérience que vous avez déjà, appliquée au niveau suivant.",
        "range_label": "SALAIRE MÉDIAN DU POSTE",
        "range_stat": "{amt}/h",
        "invest_title_short": "Trois façons d'y arriver plus vite avec nous",
        "exp_years": "Plus de {y} ans en {ind}",
        "range_text": "salaire horaire médian pour le poste {de_role} {rin}, {period}.",
        "demand_nat": "{openings} postes\nà pourvoir prévus au Canada pour cette profession, {period}.",
        "demand_prov": "{rating}\nPerspectives de Guichet-Emplois {rin}, {period}.",
        "source": "Salaires horaires médians, Guichet-Emplois (gouvernement du Canada), {periods}. {occs}. Consulté le {retrieved}.",
        "d0_text": "postes à pourvoir par année au Canada dans ce domaine, en moyenne (projection {period})",
        "d4_title": "Un poste dont le marché a besoin chaque année",
        "top_stat": "Jusqu'à {amt}/h",
        "top_text": "dans le haut de l'échelle pour le poste {de_role} {rin}, {period}.",
        "d1_text": "de ces postes proviennent de départs à la retraite de personnes expérimentées",
        "d2_text_fewer": "nouveaux chercheurs d'emploi par année en moyenne, moins que les postes à pourvoir",
        "d2_text_more": "nouveaux chercheurs d'emploi par année en moyenne, à peu près autant que les postes à pourvoir",
        "concl_shortage": "Perspectives fédérales : un risque modéré de pénurie de main-d'œuvre.\nLes employeurs devront se disputer les personnes qualifiées. Une certification reconnue leur permet de vous identifier comme l'une d'elles.",
        "concl_balance": "Perspectives fédérales : l'offre et la demande sont en équilibre.\nLes employeurs peuvent choisir. Une certification reconnue vous permet de vous démarquer parmi les candidats qualifiés.",
        "cops_source": "Source : Système de projection des professions au Canada (SPPC), Emploi et Développement social Canada, projections {period} pour la CNP {code}.",
        "prov_title": "Un poste que les employeurs recherchent",
        "prov_text": "Perspectives de Guichet-Emplois {rin}, {period}",
        "prov_concl": "Guichet-Emplois évalue les perspectives de cette profession par province.\nLà où elles sont bonnes, les employeurs se disputent les personnes qualifiées. Une certification reconnue leur permet de vous identifier comme l'une d'elles.",
        "prov_source": "Source : cotes des perspectives d'emploi de Guichet-Emplois (gouvernement du Canada), {period}, CNP {code}.",
        "cert_none": "{cred}. Aucune certification en maintenance et fiabilité pour l'instant.",
        "cert_none_bare": "Aucune certification en maintenance et fiabilité pour l'instant.",
        "cert_progress": "{cred}. Certification en maintenance et fiabilité en cours.",
        "chip": {"on_track": "En bonne voie", "in_progress": "En cours", "not_started": "Non commencée"},
        "bottom_both": "Votre expertise et votre expérience sont déjà au niveau. Une certification reconnue les rend visibles aux employeurs.",
        "bottom_one": "Un apprentissage structuré et une certification reconnue comblent le reste, et rendent votre profil visible aux employeurs.",
        "bottom_none": "Développez l'expertise, structurez votre expérience et démontrez-la par une certification reconnue.",
        "score": "{s}/10", "status": {"red": "À RENFORCER", "yellow": "EN PROGRÈS", "green": "EN BONNE VOIE"},
        "invest_title": "Trois façons de devenir {role} plus vite avec nous",
        "money": lambda v, cents=False: (("{:,.2f}" if cents and round(v, 2) != int(v) else "{:,.0f}").format(v).replace(",", "\u00a0").replace(".", ",")) + "\u00a0$",
        "sub": "{amt} après le rabais de {disc}",
        "save": "ÉCONOMIE {amt}",
        "pay_band": ["Prix en {cur}. Plans de paiement disponibles.", "", "Le rabais de {disc} est offert pendant votre débriefing de 15 minutes de votre feuille de route."],
        "cur": {"CAD": "dollars canadiens", "USD": "dollars américains"},
        "roi": "Avec l'écart salarial présenté plus tôt, l'investissement est rentabilisé en {a} à {b} mois dans votre nouveau poste.",
        "roi_one": "Avec l'écart salarial présenté plus tôt, l'investissement est rentabilisé en environ {a} mois dans votre nouveau poste.",
        "step0": "Réservez votre débriefing de 15 minutes\nAvant le {date}. Nous répondons à vos questions et confirmons votre parcours.",
        "kstat": lambda a, b: (f"{a}\u00a0k$" if a == b else f"{a}\u00a0k$ à {b}\u00a0k$"),
    },
}
REGION_IN = {
    "EN": {k: "in " + v for k, v in REGION["EN"].items()},
    "FR": {"CA": "au Canada", "ON": "en Ontario", "QC": "au Québec", "AB": "en Alberta", "BC": "en Colombie-Britannique",
           "SK": "en Saskatchewan", "MB": "au Manitoba"},
}
MONTHS = {"EN": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
          "FR": ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]}


def fmt_date(d, lang):
    return f"{MONTHS[lang][d.month - 1]} {d.day}, {d.year}" if lang == "EN" else f"{d.day} {MONTHS[lang][d.month - 1]} {d.year}"


def fmt_num(n, lang):
    return f"{n:,.0f}" if lang == "EN" else f"{n:,.0f}".replace(",", " ")


def fmt_period(p, lang):
    return (p or "").replace("-", " to " if lang == "EN" else " à ")


# ---------------- low-level helpers ----------------
def shapes_by_name(slide):
    out = {}
    def walk(coll):
        for sh in coll:
            out[sh.name] = sh
            if sh.shape_type == 6:
                walk(sh.shapes)
    walk(slide.shapes)
    return out


def set_lines(shape, text):
    """Replace the text of a shape, one paragraph per line, keeping each paragraph's first-run format."""
    lines = text.split("\n") if isinstance(text, str) else list(text)
    tf = shape.text_frame
    body = tf._txBody
    ps = body.findall(qn("a:p"))
    while len(ps) < len(lines):
        new = copy.deepcopy(ps[-1]); ps[-1].addnext(new); ps.append(new)
    for extra in ps[len(lines):]:
        body.remove(extra)
    ps = ps[:len(lines)]
    for p, line in zip(ps, lines):
        runs = p.findall(qn("a:r"))
        if not runs:
            r = p.makeelement(qn("a:r"), {}); t = r.makeelement(qn("a:t"), {}); r.append(t)
            end = p.find(qn("a:endParaRPr"))
            if end is not None: end.addprevious(r)
            else: p.append(r)
            runs = [r]
        runs[0].find(qn("a:t")).text = line
        for r in runs[1:]:
            p.remove(r)
        for br in p.findall(qn("a:br")):
            p.remove(br)


def shrink_if_long(shape, limit):
    """Second paragraph (the value) gets a smaller font when it is longer than the box comfortably holds."""
    ps = shape.text_frame.paragraphs
    if len(ps) < 2 or len(ps[1].text) <= limit:
        return
    factor = 0.85 if len(ps[1].text) <= limit * 1.5 else 0.76
    for r in ps[1].runs:
        rpr = r._r.find(qn("a:rPr"))
        if rpr is not None and rpr.get("sz"):
            rpr.set("sz", str(int(int(rpr.get("sz")) * factor)))
        elif r.font.size:
            r.font.size = int(r.font.size * factor)


def set_run_color(shape, hex_):
    for p in shape.text_frame.paragraphs:
        for r in p.runs:
            r.font.color.rgb = RGBColor.from_string(hex_)


def set_fill(shape, fill_hex, line_hex=None):
    shape.fill.solid(); shape.fill.fore_color.rgb = RGBColor.from_string(fill_hex)
    if line_hex:
        shape.line.color.rgb = RGBColor.from_string(line_hex)


def hide(shape):
    shape._element.find(".//" + qn("p:cNvPr")).set("hidden", "1")


def drop_slides(prs, numbers):
    sld_ids = prs.slides._sldIdLst
    for n in sorted(numbers, reverse=True):
        el = list(sld_ids)[n - 1]
        prs.part.drop_rel(el.get(qn("r:id")))
        sld_ids.remove(el)


def de_(x):
    """French 'de' with elision: d'ingénieur, de superviseur."""
    return ("d'" if x[:1].lower() in "aeéèêiïoôuh" else "de ") + x


def cap(s):
    s = (s or "").strip()
    s = re.sub(r"^(a|an|the|un|une|le|la|les)\s+", "", s, flags=re.I)
    return s[:1].upper() + s[1:] if s else s


def nice_fraction(x):
    best = min([(1, 4), (1, 3), (2, 5), (1, 2), (3, 5), (2, 3), (3, 4), (4, 5)], key=lambda f: abs(f[0] / f[1] - x))
    return best


# ---------------- build ----------------
def build(job):
    """job: {request:{...}, doc:{approved json}, today:'YYYY-MM-DD'} -> (pptx_bytes, meta)"""
    req, doc = job["request"], job["doc"]
    lang = "FR" if req.get("language") == "FR" else "EN"
    T = TXT.get(lang) or TXT["EN"]
    prs = Presentation(os.path.join(TEMPLATES, f"roadmap_{lang.lower()}.pptx"))
    S = [shapes_by_name(s) for s in prs.slides]
    name = f"{req.get('first_name', '').strip()} {req.get('last_name', '').strip()}".strip()
    today = datetime.date.fromisoformat(job.get("today") or datetime.date.today().isoformat())
    m = doc.get("market") or {}
    target_fam = m.get("stated_family") or (doc.get("target") or {}).get("target_family") or "specialist"
    wage_fam = m.get("wage_family") or target_fam
    role = (doc.get("target") or {}).get("target_role_label") or FAMILY[lang][target_fam]
    money = T["money"]
    notes = []

    for sh in S:
        if "footer_left" in sh and sh["footer_left"].text_frame.text.startswith(("Prepared", "Préparé")):
            set_lines(sh["footer_left"], T["prepared"].format(name=name))

    # 1 cover
    set_lines(S[0]["title"], [T["path_to"], role])
    role_in = role if lang == "EN" else role[:1].lower() + role[1:]
    pt = S[0]["prepared_text"]
    set_lines(pt, [T["prepared"].format(name="").strip(), name, fmt_date(today, lang)])
    for r in pt.text_frame.paragraphs[1].runs:  # the name: bold, 20 pt
        r.font.bold = True; r.font.size = Pt(20)
    for p in pt.text_frame.paragraphs[1:]:
        p.space_before = Pt(8)

    # 2 today / target
    td, tg, sv = doc.get("today") or {}, doc.get("target") or {}, doc.get("script_vars") or {}
    s2 = S[1]
    title_now, emp = td.get("current_title") or "", td.get("employer")
    if not emp and ", " in title_now:
        title_now, emp = title_now.rsplit(", ", 1)
    set_lines(s2["today_role_text"], [T["role"], title_now])
    set_lines(s2["today_employ_text"], [T["employer"] if emp else T["location_only"], ", ".join(x for x in [emp, td.get("location")] if x)])
    exp = td.get("experience_line")
    if not exp and isinstance(td.get("years"), (int, float)) and td.get("industry"):
        exp = T["exp_years"].format(y=int(td["years"]), ind=td["industry"][:1].lower() + td["industry"][1:])
    if not exp:
        exp = sv.get("experience_have") or ""
        if len(exp) > 70:
            exp = exp.split(",")[0]
    set_lines(s2["today_experi_text"], [T["experience"], cap(exp)])
    creds = td.get("credentials") or sv.get("credentials")
    if creds:
        set_lines(s2["today_creden_text"], [T["credentials"], cap(creds)])
    else:
        hide(s2["today_creden_text"])
    for k, lim in [("today_role_text", 42), ("today_employ_text", 42), ("today_experi_text", 44), ("today_creden_text", 60)]:
        shrink_if_long(s2[k], lim)
    set_lines(s2["target_role_text"], [T["role"], role])
    set_lines(s2["target_indust_text"], [T["industry"], cap(tg.get("industry") or sv.get("target_industry"))])
    set_lines(s2["target_locati_text"], [T["location"], cap(sv.get("target_regions") or tg.get("location"))])

    # 3 and 4 market (dropped when there is no market data)
    rows = m.get("rows") or []
    drop = []
    if not rows:
        drop += [3, 4]
        notes.append("market slides dropped: no wage data")
    else:
        s3 = S[2]
        gap = m.get("variant") == "gap" and any(
            r.get("current") and (float(r["target"]["median"]) - float(r["current"]["median"])) * 2080 >= 5000 for r in rows)
        if m.get("variant") == "gap" and not gap:
            notes.append("annual gap under 5,000: slide shows the target pay range")
        tgt_code = m.get("target_code")
        cur_code = m.get("current_code")
        set_lines(s3["title"], T["m_title_gap"] if gap else T["m_title_range"])
        set_lines(s3["col_today_label"], OCC_SHORT[lang].get(cur_code, "") if gap else "")
        set_lines(s3["col_target_label"], OCC_SHORT[lang].get(tgt_code, FAMILY[lang][wage_fam]) if gap else FAMILY[lang][wage_fam])
        for i in range(2):
            pre = f"row{i}_"
            if i >= len(rows):
                for k in ["band", "label", "today_text", "target_text", "chip", "chip_label"]:
                    hide(s3[pre + k])
                continue
            r = rows[i]
            per = (r.get("target") or {}).get("period", "")
            set_lines(s3[pre + "label"], [REGION[lang].get(r["region"], r["region"]), T["wage_data"].format(period=per)])
            set_lines(s3[pre + "target_text"], money(float(r["target"]["median"]), True))
            if gap and r.get("current"):
                c, t_ = float(r["current"]["median"]), float(r["target"]["median"])
                set_lines(s3[pre + "today_text"], money(c, True))
                set_lines(s3[pre + "chip_label"], f"+{round((t_ - c) / c * 100)}%")
            else:
                hide(s3[pre + "today_text"]); hide(s3[pre + "chip"]); hide(s3[pre + "chip_label"])
        if gap:
            ks = sorted(round((float(r["target"]["median"]) - float(r["current"]["median"])) * 2080 / 1000) for r in rows if r.get("current"))
            set_lines(s3["gap_stat"], T["kstat"](ks[0], ks[-1]))
            set_lines(s3["gap_text"], T["gap_text"])
        else:
            r0 = rows[0]
            set_lines(s3["gap_label"], T["range_label"])
            set_lines(s3["gap_stat"], T["range_stat"].format(amt=money(float(r0["target"]["median"]), True)))
            set_lines(s3["gap_text"], T["range_text"].format(role=FAMILY[lang][wage_fam].lower(), de_role=de_(FAMILY[lang][wage_fam].lower()), rin=REGION_IN[lang].get(r0["region"], r0["region"]),
                                                             period=fmt_period(r0["target"]["period"], lang)))
        dem = doc.get("demand") or {}
        nat, prov = dem.get("national"), dem.get("provincial") or []
        top = max(rows, key=lambda r: float((r.get("target") or {}).get("high") or 0))
        if (top.get("target") or {}).get("high"):
            set_lines(s3["demand_text"], [T["top_stat"].format(amt=money(float(top["target"]["high"]), True)),
                                          T["top_text"].format(role=FAMILY[lang][wage_fam].lower(), de_role=de_(FAMILY[lang][wage_fam].lower()), rin=REGION_IN[lang].get(top["region"], top["region"]),
                                                               period=fmt_period(top["target"].get("period"), lang))])
        else:
            hide(s3["demand_text"]); hide(s3["demand_panel"])
        periods = sorted({(r.get("target") or {}).get("period") for r in rows} | {(r.get("current") or {}).get("period") for r in rows if r.get("current")} - {None})
        occs = "; ".join(f"{OCC_SHORT[lang].get(c, c)}: NOC {c}" for c in [cur_code if gap else None, tgt_code] if c)
        set_lines(s3["source_text"], T["source"].format(periods=", ".join(periods), occs=occs, retrieved=fmt_date(today, lang)))

        s4 = S[3]
        if nat:
            set_lines(s4["title"], T["d4_title"])
            set_lines(s4["d0_stat"], fmt_num(round(nat["openings"] / 10, -1), lang))
            set_lines(s4["d0_text"], T["d0_text"].format(period=fmt_period(nat["period"], lang)))
            if nat.get("retirement_openings"):
                a, b = nice_fraction(nat["retirement_openings"] / nat["openings"])
                set_lines(s4["d1_stat"], f"{a} in {b}" if lang == "EN" else f"{a} sur {b}")
            set_lines(s4["d2_stat"], fmt_num(round(nat["seekers"] / 10, -1), lang))
            set_lines(s4["d2_text"], T["d2_text_fewer"] if nat["seekers"] < nat["openings"] * 0.95 else T["d2_text_more"])
            c = (nat.get("conclusion") or "").lower()
            set_lines(s4["conclusion_text"], T["concl_balance"] if "balance" in c else T["concl_shortage"].format(c=c))
            set_lines(s4["source_text"], T["cops_source"].format(period=fmt_period(nat["period"], lang), code=tgt_code))
        elif prov:
            set_lines(s4["title"], T["prov_title"])
            for i in range(3):
                if i < len(prov):
                    p = prov[i]
                    set_lines(s4[f"d{i}_stat"], re.sub(r"^.*\((\d) of 5\)$", r"\1 / 5", p["conclusion"]))
                    set_lines(s4[f"d{i}_text"], T["prov_text"].format(rin=REGION_IN[lang].get(p["geography"], p["geography"]), period=fmt_period(p["period"], lang)))
                else:
                    hide(s4[f"d{i}_stat"]); hide(s4[f"d{i}_text"])
            set_lines(s4["conclusion_text"], T["prov_concl"])
            set_lines(s4["source_text"], T["prov_source"].format(period=fmt_period(prov[0]["period"], lang), code=tgt_code))
        else:
            drop.append(4)
            notes.append("outlook slide dropped: no outlook data")

    # 5 requirements
    s5 = S[4]
    rq = doc.get("requirements") or {}
    ask = ASK[lang].get(target_fam, ASK[lang]["specialist"])
    set_lines(s5["r0_market_text"], ask[0]); set_lines(s5["r1_market_text"], ask[1])
    set_lines(s5["r0_you_text"], cap(sv.get("expertise_have")) + ".")
    set_lines(s5["r1_you_text"], cap(sv.get("experience_have")) + ".")
    cert = rq.get("certification") or "not_started"
    cred = cap(td.get("credentials") or "")
    if cert == "in_progress":
        set_lines(s5["r2_you_text"], T["cert_progress"].format(cred=cred) if cred else T["cert_progress"].format(cred="").lstrip(". "))
    else:
        set_lines(s5["r2_you_text"], T["cert_none"].format(cred=cred) if cred else T["cert_none_bare"])
    for i, st in enumerate([rq.get("expertise") or "in_progress", rq.get("experience") or "in_progress", cert]):
        fill, line = CHIP[st]
        set_fill(s5[f"r{i}_chip"], fill, line)
        set_lines(s5[f"r{i}_chip_label"], T["chip"][st]); set_run_color(s5[f"r{i}_chip_label"], line)
    on = [rq.get("expertise"), rq.get("experience")].count("on_track")
    set_lines(s5["bottom_text"], T["bottom_both"] if on == 2 else T["bottom_one"] if on == 1 else T["bottom_none"])

    # 6 gaps
    s6 = S[5]
    for i, g in enumerate((doc.get("gaps") or [])[:3]):
        set_lines(s6[f"g{i}_label"], g.get("title") or "")
        set_lines(s6[f"g{i}_text"], g.get("text") or "")

    # 10 pillar scores
    s10 = S[9]
    for i, p in enumerate((doc.get("pillars") or [])[:5]):
        sc = int(p.get("score") or 0)
        band = "green" if sc >= 8 else "yellow" if sc >= 6 else "red"
        col = {"red": RED, "yellow": AMBER, "green": GREEN}[band]
        track, bar = s10[f"p{i}_track"], s10[f"p{i}_bar"]
        bar.width = max(int(track.width * sc / 10), 1)
        set_fill(bar, col)
        set_lines(s10[f"p{i}_score_text"], T["score"].format(s=sc))
        set_lines(s10[f"p{i}_status_text"], T["status"][band]); set_run_color(s10[f"p{i}_status_text"], col)

    # 15 investment
    s15 = S[14]
    pr = doc.get("prices") or {"currency": "CAD", "self_paced": 1350, "guided": 3900, "two_certs": 7000, "discount": 500, "region": "CA"}
    disc = pr.get("discount", 500)
    long_title = len(T["invest_title"].format(role=role_in)) > 60
    set_lines(s15["title"], T["invest_title_short"] if long_title else T["invest_title"].format(role=role_in))
    for i, k in enumerate(["self_paced", "guided", "two_certs"]):
        set_lines(s15[f"tier{i}_price_text"], money(pr[k] + disc))
        set_lines(s15[f"tier{i}_sub_text"], T["sub"].format(amt=money(pr[k]), disc=money(disc)))
    save = (pr["guided"] + disc) * 2 - (pr["two_certs"] + disc)
    set_lines(s15["tier2_save_label"], T["save"].format(amt=money(save)))
    cur = T["cur"].get(pr["currency"], pr["currency"])
    set_lines(s15["pay_band"], [x.format(cur=cur, disc=money(disc)) for x in T["pay_band"]])
    roi = doc.get("roi")
    if roi:
        box = s15["title"]
        tb = list(prs.slides)[14].shapes.add_textbox(box.left, box.top + int(box.height * 0.78), box.width, int(12700 * 18))
        tb.name = "roi_text"
        src = s15["tier0_sub_text"].text_frame.paragraphs[0].runs[0].font
        r = tb.text_frame.paragraphs[0].add_run()
        r.text = (T["roi"] if roi["months_min"] != roi["months_max"] else T["roi_one"]).format(a=roi["months_min"], b=roi["months_max"])
        r.font.size = src.size; r.font.name = src.name; r.font.color.rgb = RGBColor.from_string(GREEN); r.font.bold = True
        tb.text_frame.margin_left = 0; tb.text_frame.margin_top = 0; tb.text_frame.word_wrap = True
        from pptx.enum.text import PP_ALIGN
        tb.text_frame.paragraphs[0].alignment = PP_ALIGN.LEFT

    # 16 next step
    set_lines(S[15]["step0_text"], T["step0"].format(date=fmt_date(today + datetime.timedelta(days=7), lang)))

    if drop:
        drop_slides(prs, drop)
    # renumber footers after a drop
    for i, s in enumerate(prs.slides, 1):
        sh = shapes_by_name(s)
        if "footer_num" in sh:
            set_lines(sh["footer_num"], str(i))
        if "eyebrow" in sh and i > 1:
            t = sh["eyebrow"].text_frame.text
            mm = re.match(r"^(\d+) · ", t)
            if mm:
                set_lines(sh["eyebrow"], f"{i - 1:02d} · " + t[mm.end():])

    import io
    out = io.BytesIO(); prs.save(out)
    return out.getvalue(), {"slides": len(prs.slides), "dropped": drop, "notes": notes, "lang": lang}


def to_pdf(pptx_bytes):
    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, "roadmap.pptx")
        with open(src, "wb") as f:
            f.write(pptx_bytes)
        subprocess.run(["soffice", "--headless", "--norestore", f"-env:UserInstallation=file://{d}/lo", "--convert-to", "pdf", "--outdir", d, src],
                       check=True, timeout=240, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        with open(os.path.join(d, "roadmap.pdf"), "rb") as f:
            return f.read()
