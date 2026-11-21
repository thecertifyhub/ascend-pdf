"""Builds templates/roadmap_en.pptx (scrubbed of the benchmark lead's data) and templates/roadmap_fr.pptx
from the approved benchmark deck. Run once whenever the benchmark design changes:
    python tools/make_templates.py <benchmark.pptx>
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pptx import Presentation
from pptx.util import Pt
from pptx.dml.color import RGBColor
from pptx.oxml.ns import qn
import roadmap

SCRUB = {  # personal fields reset to neutral placeholders (overwritten at build time)
    "EN": {
        "prepared_text": ["Prepared for", "First Last", "Month D, YYYY"],
        "footer_prepared": "Prepared for First Last",
        "today_role_text": ["ROLE", "Current role"], "today_employ_text": ["EMPLOYER AND LOCATION", "Employer, City"],
        "today_experi_text": ["EXPERIENCE", "Years of experience"], "today_creden_text": ["CREDENTIALS", "Credentials"],
        "target_role_text": ["ROLE", "Target role"], "target_indust_text": ["INDUSTRY", "Target industry"],
        "target_locati_text": ["LOCATION", "Target location"],
        "row0_label": ["Region", "Period wage data"], "row1_label": ["Region", "Period wage data"],
        "source_text": "Median hourly wages, Job Bank (Government of Canada).",
        "r0_you_text": "Expertise today.", "r1_you_text": "Experience today.", "r2_you_text": "Credentials today.",
        "g0_label": "Gap one", "g1_label": "Gap two", "g2_label": "Gap three",
        "g0_text": "Gap text.", "g1_text": "Gap text.", "g2_text": "Gap text.",
    },
}
SCRUB["FR"] = {
    "prepared_text": ["Préparé pour", "Prénom Nom", "J mois AAAA"],
    "footer_prepared": "Préparé pour Prénom Nom",
    "today_role_text": ["POSTE", "Poste actuel"], "today_employ_text": ["EMPLOYEUR ET LIEU", "Employeur, ville"],
    "today_experi_text": ["EXPÉRIENCE", "Années d'expérience"], "today_creden_text": ["TITRES ET CERTIFICATIONS", "Titres"],
    "target_role_text": ["POSTE", "Poste visé"], "target_indust_text": ["INDUSTRIE", "Industrie visée"],
    "target_locati_text": ["LIEU", "Lieu visé"],
    "row0_label": ["Région", "Données salariales"], "row1_label": ["Région", "Données salariales"],
    "source_text": "Salaires horaires médians, Guichet-Emplois (gouvernement du Canada).",
    "r0_you_text": "Expertise actuelle.", "r1_you_text": "Expérience actuelle.", "r2_you_text": "Titres actuels.",
    "g0_label": "Écart un", "g1_label": "Écart deux", "g2_label": "Écart trois",
    "g0_text": "Texte de l'écart.", "g1_text": "Texte de l'écart.", "g2_text": "Texte de l'écart.",
}

# English static text changed after the benchmark (Christian's review, Nov 21)
EN = {
    (7, "k2_text"): ["Deliberate career positioning", "A resume, LinkedIn profile and story that present you as the best candidate."],
    (12, "a1_text"): ["02", "Certification readiness", "A structured method to pass the certification exam on the first attempt."],
    (12, "a2_text"): ["03", "Professional brand and market positioning", "A resume, LinkedIn profile and story that present you as the best candidate."],
    (12, "a3_text"): ["04", "Private coaching and mentoring", "A mentor at your side, from the start to the end of the program."],
    **{(13, f"w{i}_text"): ["Learning", "Application", f"Mini-project {i + 1}", "Coaching"] for i in range(4)},
    (13, "w4_text"): ["Exam simulator 1", "Professional brand development", "Coaching"],
    (13, "w5_text"): ["Exam simulator 2", "Professional brand development", "Exam registration", "Coaching"],
    (14, "story2_text"): ["Angelico S., CMRP", "Vibration analyst, ISO Category III", "CMRP and career positioning completed with us",
                          "7 interviews and 2 job offers", "within a month of completing the program"],
    (16, "step2_text"): ["Confirm with a $200 deposit and choose your start date."],
    (16, "step1_text"): ["Unlock your $500 discount", "It applies to all three options, during the debrief."],
    (16, "cta_text"): ["Book your 15-minute roadmap debrief", "Use the booking link in the email that came with this roadmap."],
    (17, "outro_title"): "We look forward to your roadmap debrief.",
}

# Layout from Christian's edited deck (EMU): (slide, shape) -> (top, height); None keeps the value.
LAYOUT = {
    (1, "prepared_text"): (5156488, 1384482),
    (2, "today_card"): (None, 4085644), (2, "target_card"): (None, 4085644),
    (5, "bottom_text"): (5665764, 208199),
    (9, "competent_band"): (5879592, None), (9, "competent_text"): (5879592, None),
    (11, "stat0_stat"): (None, 460767), (11, "stat1_stat"): (None, 460767), (11, "stat2_stat"): (None, 460767),
    (13, "commit_band"): (5486400, None), (13, "commit_text"): (5577840, None),  # room for the longer week 6 list
    (15, "pay_band"): (None, 1232717),
}
FOOTER_TOP = 6604816  # footers sit closer to the bottom edge
REMOVE = {15: ["pay_label", "pay0_text", "pay1_text", "fine_text"]}


def add_break(shape, pidx):
    """Soft line break at the end of paragraph pidx (an empty line before the next one)."""
    p = shape.text_frame.paragraphs[pidx]._p
    br = p.makeelement(qn("a:br"), {})
    end = p.find(qn("a:endParaRPr"))
    if end is not None: end.addprevious(br)
    else: p.append(br)


def style_pay_band(shape):
    """Pay band holds text now: white Manrope, bold first line, regular last line, centered."""
    tf = shape.text_frame
    for i, p in enumerate(tf.paragraphs):
        for r in p.runs:
            r.font.name = "Manrope"; r.font.size = Pt(13 if i == 0 else 12); r.font.bold = (i == 0)
            r.font.color.rgb = RGBColor.from_string("FFFFFF")


# French static text, keyed by (slide number, shape name). Lines = paragraphs.
FR = {
    (1, "eyebrow"): "FEUILLE DE ROUTE CMRP PERSONNALISÉE",
    (1, "title"): ["Votre parcours vers", "Spécialiste en maintenance"],
    (1, "sub_text"): "Où vous en êtes aujourd'hui, ce que le marché paie pour votre prochaine étape, et le chemin le plus logique pour y arriver.",
    (2, "eyebrow"): "01 · OÙ VOUS EN ÊTES, OÙ VOUS ALLEZ",
    (2, "title"): "De votre expérience à votre prochain poste",
    (2, "today_label"): "AUJOURD'HUI", (2, "target_label"): "VOTRE CIBLE",
    (3, "eyebrow"): "02 · CE QUE LE MARCHÉ PAIE",
    (3, "title"): "Votre prochain poste paie davantage",
    (3, "table_head_text"): "SALAIRE HORAIRE MÉDIAN",
    (3, "col_today_label"): "Poste actuel", (3, "col_target_label"): "Poste visé",
    (3, "gap_label"): "LA DIFFÉRENCE SUR UN AN",
    (3, "gap_text"): "de plus par année à temps plein, pour l'expérience que vous avez déjà, appliquée au niveau suivant.",
    (4, "eyebrow"): "03 · POURQUOI CE POSTE",
    (4, "title"): "Un poste dont le marché aura besoin d'ici 2035",
    (4, "d0_text"): "postes à pourvoir prévus au Canada dans ce domaine, 2026 à 2035",
    (4, "d1_stat"): "2 sur 3",
    (4, "d1_text"): "de ces postes viennent des départs à la retraite de personnes expérimentées",
    (4, "d2_text"): "nouveaux chercheurs d'emploi prévus sur la même période, moins que les postes à pourvoir",
    (4, "conclusion_text"): ["Perspectives fédérales : un risque modéré de pénurie de main-d'œuvre.",
                             "Les employeurs se disputeront les personnes qualifiées. Une certification reconnue est la façon dont ils vous reconnaissent comme l'une d'elles."],
    (5, "eyebrow"): "04 · CE QUE LE MARCHÉ DEMANDE",
    (5, "title"): "Les exigences des employeurs et ce que vous apportez",
    (5, "th0_label"): "EXIGENCE", (5, "th1_label"): "CE QUE DEMANDENT LES EMPLOYEURS",
    (5, "th2_label"): "CE QUE VOUS APPORTEZ", (5, "th3_label"): "CORRESPONDANCE",
    (5, "r0_req_text"): "Expertise technique",
    (5, "r0_market_text"): "Diagnostic des systèmes électriques, mécaniques et hydrauliques; maintenance préventive et prédictive.",
    (5, "r0_chip_label"): "En bonne voie",
    (5, "r1_req_text"): "Expérience",
    (5, "r1_market_text"): "Maintenance d'équipements sur le terrain, avec bons de travail, sécurité et équipes.",
    (5, "r1_chip_label"): "En bonne voie",
    (5, "r2_req_text"): "Certification visée",
    (5, "r2_market_text"): "Une certification reconnue en maintenance et fiabilité, comme le CMRP.",
    (5, "r2_chip_label"): "Non commencée",
    (5, "bottom_text"): "Votre expertise et votre expérience sont déjà au niveau. Une certification reconnue les rend visibles aux employeurs.",
    (6, "eyebrow"): "05 · LES ÉCARTS À COMBLER",
    (6, "title"): "Ce qui vous sépare du poste",
    (6, "gap_note_text"): "Aucun de ces écarts n'est une question de talent. Ils relèvent des connaissances, de la structure et de la façon de présenter votre expérience.",
    (7, "eyebrow"): "06 · CE QUI COMBLE L'ÉCART",
    (7, "title"): "Trois leviers pour atteindre le poste visé",
    (7, "k0_text"): ["Des connaissances ciblées", "Apprendre exactement ce que votre poste visé exige, et l'appliquer à des cas réels."],
    (7, "k1_text"): ["Une certification reconnue", "Une reconnaissance à laquelle les employeurs font confiance, et qui atteste votre compétence avant même l'entrevue."],
    (7, "k2_text"): ["Un positionnement de carrière réfléchi", "Un CV, un profil LinkedIn et un récit qui vous présentent comme le meilleur candidat."],
    (7, "bridge_text"): ["La certification CMRP, une structure claire et un mentorat privé réunissent les trois."],
    (8, "eyebrow"): "07 · À PROPOS DU CMRP",
    (8, "title"): "Certified Maintenance & Reliability Professional",
    (8, "quote_text"): "La SMRP décrit le CMRP comme la principale certification attestant les connaissances, les compétences et les aptitudes des professionnels de la maintenance, de la fiabilité et de la gestion des actifs physiques.",
    (8, "ansi_text"): "C'est le seul programme de certification de ce type accrédité par l'American National Standards Institute (ANSI), un organisme qui accrédite selon les normes ISO reconnues mondialement.",
    (8, "smrp_text"): "SMRP : Society for Maintenance & Reliability Professionals. Source : smrp.org.",
    (8, "st0_text"): "Accréditation selon les normes ISO",
    (8, "st1_stat"): "~10 000",
    (8, "st1_text"): "titulaires du CMRP dans le monde (catalogue des certifiés de la SMRP)",
    (8, "st2_text"): "piliers de compétence, évalués dans un seul examen",
    (9, "eyebrow"): "08 · LES CINQ PILIERS",
    (9, "title"): "Ce qu'un CMRP doit maîtriser",
    (9, "pentagon_text"): ["CMRP", "Compétent dans les cinq"],
    (9, "l0_text"): ["Affaires et gestion", "Aligner la maintenance et la fiabilité sur les objectifs de l'entreprise : stratégie, indicateurs de performance, budgets et analyse de rentabilité."],
    (9, "l1_text"): ["Fiabilité des procédés de fabrication", "Maintenir l'ensemble du procédé de production stable et capable, par l'analyse des procédés et l'amélioration continue."],
    (9, "l2_text"): ["Fiabilité des équipements", "Assurer la performance requise des actifs : analyse des défaillances, maintenance préventive et prédictive."],
    (9, "l3_text"): ["Organisation et leadership", "Le volet humain : rôles, compétences, communication et conduite du changement."],
    (9, "l4_text"): ["Gestion des travaux", "Planifier, ordonnancer et exécuter les travaux de maintenance avec efficacité, du bon de travail aux pièces de rechange."],
    (9, "competent_text"): "Une fois certifié CMRP, vous êtes reconnu compétent dans les cinq.",
    (10, "eyebrow"): "09 · OÙ VOUS EN ÊTES",
    (10, "title"): "Votre profil aujourd'hui, pilier par pilier",
    (10, "sub_text"): "Les piliers mesurent la gestion de la maintenance et de la fiabilité : la couche qui s'ajoute à votre expertise technique.",
    (10, "target_label"): "Cible : 8 sur 10",
    (10, "legend_text"): "0 à 5 : à renforcer   6 à 7 : en progrès   8 et plus : en bonne voie",
    (10, "p0_label"): "Affaires et gestion", (10, "p1_label"): "Fiabilité des procédés de fabrication",
    (10, "p2_label"): "Fiabilité des équipements", (10, "p3_label"): "Organisation et leadership", (10, "p4_label"): "Gestion des travaux",
    (11, "eyebrow"): "10 · QUI NOUS SOMMES",
    (11, "firm_text"): "Un cabinet de coaching et de mentorat pour les professionnels de la maintenance et de la fiabilité, établi dans la région du Grand Toronto, au Canada.",
    (11, "value_text"): "Nous aidons les professionnels de la maintenance, de la fiabilité et de la gestion des actifs à obtenir les certifications qui ouvrent les postes de haut niveau, et à se positionner pour que le marché le voie. Notre programme phare : un mentorat privé CMRP de 8 semaines.",
    (11, "stat0_text"): "de réussite au CMRP dans notre programme de mentorat privé de 8 semaines",
    (11, "stat1_text"): "Coaching privé, jamais en groupe",
    (11, "stat2_stat"): "FR · EN",
    (11, "stat2_text"): "Coaching en français ou en anglais, entièrement à distance",
    (11, "founder_text"): ["FONDÉ PAR", "Christian Dimene", "Fondateur et consultant principal", "CMRP, CAMA, PMP, PSM"],
    (12, "eyebrow"): "11 · NOTRE APPROCHE",
    (12, "title"): "Quatre axes vers votre prochain poste",
    (12, "a0_text"): ["01", "Apprentissage ciblé et application", "Apprendre ce que votre poste visé exige et l'appliquer à des cas réels."],
    (12, "a1_text"): ["02", "Préparation à la certification", "Une méthode structurée pour réussir l'examen de certification à la première tentative."],
    (12, "a2_text"): ["03", "Marque professionnelle et positionnement", "Un CV, un profil LinkedIn et un récit qui vous présentent comme le meilleur candidat."],
    (12, "a3_text"): ["04", "Coaching et mentorat privés", "Un mentor à vos côtés, du début à la fin du programme."],
    (13, "eyebrow"): "12 · VOS 8 SEMAINES",
    (13, "title"): "Du début du programme au jour de l'examen",
    (13, "phase0_label"): "Semaines 1 à 4 · Apprendre et appliquer",
    (13, "phase1_label"): "Semaines 5 à 7 · S'exercer et se positionner",
    (13, "phase2_label"): "Se certifier",
    **{(13, f"w{i}_label"): f"Semaine {i + 1}" for i in range(8)},
    **{(13, f"w{i}_text"): ["Apprentissage", "Applications", f"Mini-projet {i + 1}", "Coaching"] for i in range(4)},
    (13, "w4_text"): ["Simulateur d'examen 1", "Développement de la marque professionnelle", "Coaching"],
    (13, "w5_text"): ["Simulateur d'examen 2", "Développement de la marque professionnelle", "Inscription à l'examen", "Coaching"],
    (13, "w6_text"): ["Révision finale", "Coaching"], (13, "w7_text"): ["Examen CMRP", "Positionnement sur le marché"],
    (13, "commit_text"): "Engagement : 5 à 6 heures par semaine. Vous commencez le lundi de votre choix, et vous pouvez faire une pause si votre situation l'exige.",
    (14, "eyebrow"): "13 · PREUVES",
    (14, "title"): "Des résultats, pas des promesses",
    (14, "big_text"): "des professionnels qui ont terminé le programme ont réussi leur CMRP.",
    (14, "guarantee_text"): ["La garantie Ascend", "Si vous faites le travail et ne réussissez pas, vous êtes remboursé."],
    (14, "story0_text"): ["Harold T., P.Eng., CMRP", "A dirigé la maintenance de 7 sites chez Siemens Energy", "Aujourd'hui directeur de la maintenance et des installations, Alstom",
                          "7 semaines", "du début au CMRP", "« Je voulais une structure. Je connaissais les concepts de maintenance, mais pas comment les assembler. »"],
    (14, "story1_text"): ["Marvin A., P.Eng., CMRP", "Première tentative sans plan : battu par le temps", "Réussi, et promu gestionnaire des installations pendant le programme",
                          "50+ min", "restantes au chronomètre à sa deuxième tentative", "« Cette fois, j'avais beaucoup de temps en réserve. »"],
    (14, "story2_text"): ["Angelico S., CMRP", "Analyste vibratoire, catégorie III ISO", "CMRP et positionnement de carrière réalisés avec nous",
                          "7 entrevues et 2 offres d'emploi", "dans le mois suivant la fin du programme"],
    (15, "eyebrow"): "14 · INVESTISSEMENT",
    (15, "title"): "Trois façons d'y arriver plus vite avec nous",
    (15, "tier0_label"): "AUTONOME",
    (15, "tier0_text"): "Progressez de façon autonome grâce à notre approche structurée, en appliquant notre cadre de réussite à votre rythme.",
    (15, "tier1_tag_label"): "RECOMMANDÉ · LE PLUS POPULAIRE",
    (15, "tier1_label"): "PROGRAMME GUIDÉ COMPLET",
    (15, "tier1_text"): "Tout le programme autonome, plus le positionnement de carrière, une garantie de réussite ou remboursement, et un mentor privé tout au long du programme.",
    (15, "tier2_label"): "DEUX CERTIFICATIONS COMBINÉES",
    (15, "tier2_text"): "CMRP plus PMP, P&S-CMMS, VCAT ou MLT. Deux programmes guidés, avec la réécriture de votre CV et de votre profil LinkedIn.",
    (16, "eyebrow"): "15 · PROCHAINE ÉTAPE",
    (16, "title"): "La prochaine étape la plus logique",
    (16, "step1_text"): ["Débloquez votre rabais de 500\u00a0$", "Il s'applique aux trois options, pendant le débriefing."],
    (16, "step2_text"): ["Confirmez avec un dépôt de 200\u00a0$ et choisissez votre date de début."],
    (16, "cta_text"): ["Réservez votre débriefing de 15 minutes", "Utilisez le lien de réservation dans le courriel qui accompagne cette feuille de route."],
    (17, "outro_title"): "Au plaisir d'échanger lors de votre débriefing.",
    (17, "outro_text"): ["Ascend Leadership Group", "Coaching et mentorat pour les professionnels de la maintenance et de la fiabilité. Région du Grand Toronto, Canada."],
}


def make(src, lang, out):
    prs = Presentation(src)
    for i, s in enumerate(prs.slides, 1):
        sh = roadmap.shapes_by_name(s)
        if lang == "EN" and i == 7 and "bridge_text" in sh:
            roadmap.set_lines(sh["bridge_text"], [sh["bridge_text"].text_frame.paragraphs[0].text])
        for (n, name), lines in (FR if lang == "FR" else EN).items():
            if n == i and name in sh:
                roadmap.set_lines(sh[name], lines)
        sc = SCRUB[lang]
        for name, lines in sc.items():
            if name in sh:
                roadmap.set_lines(sh[name], lines)
        if "footer_left" in sh and sh["footer_left"].text_frame.text.startswith("Prepared"):
            roadmap.set_lines(sh["footer_left"], sc["footer_prepared"])
        for n in ("footer_left", "footer_num"):
            if n in sh:
                sh[n].top = FOOTER_TOP
        for (n, name), (top, h) in LAYOUT.items():
            if n == i:
                if top is not None: sh[name].top = top
                if h is not None: sh[name].height = h
        for name in REMOVE.get(i, []):
            el = sh[name]._element; el.getparent().remove(el)
        if i == 14:
            for k in ("story0_text", "story1_text", "story2_text"):
                add_break(sh[k], 1)
        if i == 15:
            roadmap.set_lines(sh["pay_band"], ["Payment plans available." if lang == "EN" else "Plans de paiement disponibles.", "", "Discount line."])
            style_pay_band(sh["pay_band"])
    if lang == "FR":  # wider "save" badge on the pricing slide for the longer French label
        sh = roadmap.shapes_by_name(prs.slides[14])
        for n in ("tier2_save", "tier2_save_label"):
            sh[n].left -= 12700 * 34; sh[n].width += 12700 * 34
    import sys, os; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
    import roadmap_timing; roadmap_timing.prune_dangling(prs)  # removed shapes must not keep their animations
    prs.save(out)


if __name__ == "__main__":
    src = sys.argv[1]
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    make(src, "EN", os.path.join(here, "templates", "roadmap_en.pptx"))
    make(src, "FR", os.path.join(here, "templates", "roadmap_fr.pptx"))
    print("templates written")
