export const APP_JS = String.raw`/* Ascend roadmap review page. Loaded by the shell page on thecertifyhub.com. ASCII only. */
(function () {
  var SB_URL = "https://jbncsigalbtfwkxpgwso.supabase.co";
  var ANON = window.ROADMAP_ANON_KEY;
  var API = SB_URL + "/functions/v1/roadmap-review";
  var sb = window.supabase.createClient(SB_URL, ANON);
  var root = document.getElementById("app");
  var state = { list: [], cur: null, doc: null, orig: null };

  var DIMS = {
    EN: ["", "Leadership depth", "Reliability-driven decision-making", "Business impact of actions", "Systems thinking", "Operational complexity management", "Cross-functional influence", "Strategic maintenance ownership", "Executive communication"],
    FR: ["", "Profondeur du leadership", "Prise de d\u00e9cision bas\u00e9e sur l'analyse de fiabilit\u00e9", "Impact business des actions", "Vision syst\u00e8me", "Gestion de la complexit\u00e9 op\u00e9rationnelle", "Influence transversale", "Ma\u00eetrise strat\u00e9gique de la maintenance", "Communication ex\u00e9cutive"]
  };

  var css = [
    ":root{--green:#245741;--green-pale:#e6f0eb;--amber:#fdb338;--red:#c94a3f;--cream:#f8f4ec;--ink:#1d2321;--mute:#66706b;--line:#ddd6c8;--card:#fff}",
    "*{box-sizing:border-box}body{margin:0;background:var(--cream);color:var(--ink);font:15px/1.45 'DM Sans',system-ui,sans-serif}",
    "h1,h2,h3{font-family:Fraunces,Georgia,serif;font-weight:600;margin:0 0 8px}h1{font-size:24px}h2{font-size:18px;margin-top:22px}",
    ".wrap{max-width:1280px;margin:0 auto;padding:20px 16px 80px}.top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}",
    ".card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:10px 0}",
    "table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12px;text-transform:uppercase;color:var(--mute);letter-spacing:.04em}",
    "tr.row{cursor:pointer}tr.row:hover{background:var(--green-pale)}",
    "button{font:inherit;border-radius:8px;border:1px solid var(--green);background:#fff;color:var(--green);padding:8px 14px;cursor:pointer}button.primary{background:var(--amber);border-color:var(--amber);color:#1d2321;font-weight:600}button.danger{border-color:var(--red);color:var(--red)}button:disabled{opacity:.5;cursor:default}",
    "input,select,textarea{font:inherit;border:1px solid var(--line);border-radius:6px;padding:6px 8px;background:#fff;width:100%}textarea{min-height:64px;resize:vertical}",
    ".grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:760px){.grid2{grid-template-columns:1fr}}",
    ".pill{display:inline-block;border-radius:99px;padding:2px 9px;font-size:12px;background:var(--green-pale);color:var(--green);margin:2px 4px 2px 0}.pill.red{background:#fbebeb;color:var(--red)}.pill.amber{background:#f9eeda;color:#8a5a00}",
    ".ev{font-size:13px;color:var(--mute);margin-top:4px}.lbl{font-size:12px;color:var(--mute);text-transform:uppercase;letter-spacing:.04em;margin:8px 0 3px}",
    ".score{width:70px;display:inline-block}.band-green{color:var(--green)}.band-yellow{color:#8a5a00}.band-red{color:var(--red)}",
    ".bar{position:sticky;bottom:0;background:var(--cream);border-top:1px solid var(--line);padding:10px 0;display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
    ".changed{border-color:var(--amber);background:#fffaf0}.msg{color:var(--mute);font-size:13px}",
    ".top h1{margin:0}.top .ctl{display:flex;gap:8px;align-items:center}.top .ctl select{width:auto}.top .ctl button{white-space:nowrap}",
    ".steps{display:flex;gap:10px;flex-wrap:wrap;margin:6px 0 4px}.steps div{flex:1 1 200px;background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px}.steps b{color:var(--green)}",
    ".cols{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:16px;align-items:start}@media(max-width:900px){.cols{grid-template-columns:1fr}}",
    ".card h3{font-size:16px}.card .sec{font-size:12px;color:var(--mute);margin:-4px 0 8px}",
    ".bar button{white-space:nowrap}.bar .help{flex-basis:100%;font-size:12px;color:var(--mute)}",
    "td.st span{white-space:nowrap}.count{color:var(--mute);font-size:13px;margin:4px 0 0}",
    ".prof{border-left:4px solid var(--green)}.prof table td{border-bottom:1px solid #eee8dc;padding:6px 6px}.prof td.k{width:34%;color:var(--mute);font-size:13px}.prof ul{margin:0;padding-left:18px}.prof .note{background:#f9eeda;color:#5c3d00;border-radius:6px;padding:6px 10px;margin-top:10px}"
  ].join("\n");
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "text") e.textContent = attrs[k];
      else if (k === "html") e.innerHTML = attrs[k];
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function get(o, path) { return path.split(".").reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function set(o, path, v) { var p = path.split("."); var last = p.pop(); var t = p.reduce(function (a, k) { return a[k]; }, o); t[last] = v; }

  async function api(action, body) {
    var s = (await sb.auth.getSession()).data.session;
    var r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (s ? s.access_token : "") }, body: JSON.stringify(Object.assign({ action: action }, body || {})) });
    var j = await r.json().catch(function () { return { error: "bad response" }; });
    if (!r.ok) throw new Error(j.error || ("HTTP " + r.status));
    return j;
  }

  function loginView(msg) {
    root.innerHTML = "";
    var email = el("input", { type: "email", placeholder: "Email" });
    var pass = el("input", { type: "password", placeholder: "Password" });
    var note = el("div", { class: "msg", text: msg || "" });
    var btn = el("button", { class: "primary", text: "Sign in", onclick: async function () {
      btn.disabled = true; note.textContent = "Signing in...";
      var r = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
      btn.disabled = false;
      if (r.error) { note.textContent = r.error.message; return; }
      listView();
    } });
    root.appendChild(el("div", { class: "wrap" }, [el("h1", { text: "Roadmap review" }), el("div", { class: "card" }, [email, el("div", { style: "height:8px" }), pass, el("div", { style: "height:10px" }), btn, note])]));
  }

  async function listView() {
    root.innerHTML = "";
    var wrap = el("div", { class: "wrap" });
    root.appendChild(wrap);
    var filter = el("select", {}, ["to_review", "hold", "error", "approved", "ready_to_export", "video_ready", "sent", "not_fit", "all"].map(function (s) { return el("option", { value: s, text: s.replace("_", " ") }); }));
    filter.value = state.filter || "to_review";
    filter.addEventListener("change", function () { state.filter = filter.value; listView(); });
    wrap.appendChild(el("div", { class: "top" }, [el("h1", { text: "Roadmap review" }), el("div", { class: "ctl" }, [filter, el("button", { text: "Sign out", onclick: async function () { await sb.auth.signOut(); loginView(); } })])]));
    var box = el("div", { class: "card", text: "Loading..." });
    wrap.appendChild(box);
    try {
      var j = await api("list", { status: filter.value });
      box.innerHTML = "";
      if (j.settings) wrap.insertBefore(el("div", { class: "msg", text: "Review mode: " + j.settings.review_mode + " | clean streak: " + j.settings.clean_streak + " of 20" }), box);
      if (!j.items.length) { box.textContent = "Nothing here."; return; }
      wrap.insertBefore(el("div", { class: "count", text: j.items.length + " roadmap" + (j.items.length > 1 ? "s" : "") + ", newest first. Click a row to review it." }), box);
      var t = el("table", {}, [el("tr", {}, ["Lead", "Lang", "Source", "Target", "Status", "Flags", "Received"].map(function (h) { return el("th", { text: h }); }))]);
      j.items.forEach(function (it) {
        var fl = el("td", {}, [it.red ? el("span", { class: "pill red", text: it.red + " red" }) : null, it.flags ? el("span", { class: "pill amber", text: it.flags + " to check" }) : null]);
        t.appendChild(el("tr", { class: "row", onclick: function () { detailView(it.id); } }, [
          el("td", { text: it.first_name + " " + it.last_name }), el("td", { text: it.language }), el("td", { text: it.source }),
          el("td", { text: it.target_title || it.target_family || "" }), el("td", { class: "st" }, [el("span", { class: "pill" + (it.status === "error" ? " red" : ""), text: it.status.replace(/_/g, " ") })]), fl,
          el("td", { text: new Date(it.created_at).toLocaleString() })]));
      });
      box.appendChild(t);
    } catch (e) { box.textContent = e.message; if (/sign in|auth|admin/i.test(e.message)) loginView(e.message); }
  }

  // Video and delivery: deck downloads, upload of the exported MP4, the lead's personal page link.
  function deliveryCard(req) {
    var card = el("div", { class: "card" }, [el("h3", { text: "Video and delivery" })]);
    var body = el("div", { text: "Loading..." }); card.appendChild(body);
    function copyBtn(url) {
      return el("button", { text: "Copy link", onclick: function () { try { navigator.clipboard.writeText(url); this.textContent = "Copied"; } catch (e) {} } });
    }
    async function load() {
      var d;
      try { d = await api("delivery", { id: req.id }); } catch (e) { body.textContent = e.message; return; }
      body.innerHTML = "";
      body.appendChild(el("p", { html: "<b>1.</b> Download the PowerPoint, check it, then export the video: File, Export, Create a Video, " +
        "<i>Full HD (1080p)</i>, <i>Use Recorded Timings and Narrations</i>." }));
      body.appendChild(el("div", {}, [
        d.links.pptx ? el("a", { href: d.links.pptx, text: "PowerPoint", style: "margin-right:14px" }) : null,
        d.links.pdf ? el("a", { href: d.links.pdf, text: "PDF" }) : null]));
      body.appendChild(el("p", { html: "<b>2.</b> Upload the exported MP4." }));
      var inp = el("input", { type: "file", accept: "video/mp4" });
      var st = el("div", { class: "msg", text: d.video_path ? "Video uploaded " + new Date(d.video_at).toLocaleString() + ". Uploading again replaces it." : "" });
      var go = el("button", { class: "primary", text: "Upload video", onclick: async function () {
        var f = inp.files && inp.files[0];
        if (!f) { st.textContent = "Choose the MP4 file first."; return; }
        if (!/\.mp4$/i.test(f.name)) { st.textContent = "The file must be an MP4."; return; }
        go.disabled = true; st.textContent = "Uploading " + Math.round(f.size / 1048576) + " MB. Keep this page open...";
        try {
          var slot = await api("video_slot", { id: req.id });
          var up = await sb.storage.from("roadmap-videos").uploadToSignedUrl(slot.path, slot.token, f, { contentType: "video/mp4" });
          if (up.error) throw new Error(up.error.message);
          var done = await api("video_done", { id: req.id, path: slot.path });
          st.textContent = done.message + " (" + done.size_mb + " MB)";
          load();
        } catch (e) { st.textContent = "Upload failed: " + e.message; go.disabled = false; }
      } });
      body.appendChild(el("div", {}, [inp, go])); body.appendChild(st);
      body.appendChild(el("p", { html: "<b>3.</b> The lead's personal page (video, PDF, booking button)." }));
      if (d.page_url) body.appendChild(el("div", {}, [el("a", { href: d.page_url, target: "_blank", text: "Open the page", style: "margin-right:14px" }), copyBtn(d.page_url)]));
      else body.appendChild(el("div", { class: "msg", text: "Available once the video is uploaded." }));
      if (!d.booking_url) body.appendChild(el("div", { class: "msg", html: "<span class='pill amber'>to set</span> No debrief booking link yet: the page shows \"Booking link in your email\"." }));
    }
    load();
    return card;
  }

  function field(path, label, kind, opts) {
    var v = get(state.doc, path);
    var ov = get(state.orig, path);
    var inp;
    if (kind === "select") {
      inp = el("select", {}, opts.map(function (o) { return el("option", { value: String(o[0]), text: o[1] }); }));
      var isBool = typeof opts[0][0] === "boolean";
      inp.value = String(v == null ? (isBool ? opts[0][0] : "") : v);
    } else if (kind === "area") { inp = el("textarea"); inp.value = v == null ? "" : String(v); }
    else { inp = el("input"); inp.value = v == null ? "" : String(v); }
    function mark() { inp.classList.toggle("changed", JSON.stringify(get(state.doc, path)) !== JSON.stringify(ov)); }
    inp.addEventListener("input", function () {
      var nv = inp.value;
      if (kind === "select" && typeof ov === "number") nv = Number(nv);
      if (kind === "select" && typeof opts[0][0] === "boolean") nv = nv === "true";
      set(state.doc, path, nv); mark();
    });
    mark();
    return el("div", {}, [label ? el("div", { class: "lbl", text: label }) : null, inp]);
  }

  function changes() {
    var out = [];
    function walk(a, b, p) {
      if (typeof a === "object" && a && typeof b === "object" && b && !Array.isArray(a) === !Array.isArray(b)) {
        var keys = {}; Object.keys(a).forEach(function (k) { keys[k] = 1; }); Object.keys(b).forEach(function (k) { keys[k] = 1; });
        Object.keys(keys).forEach(function (k) { walk(a[k], b[k], p ? p + "." + k : k); });
      } else if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ field: p, before: a === undefined ? null : a, after: b === undefined ? null : b });
    }
    walk(state.orig, state.doc, "");
    return out;
  }

  /* Profile summary: read-only facts from the resume, to decide before reading the slides. */
  function profileCard(ps) {
    var card = el("div", { class: "card prof" }, [el("h3", { text: "Profile summary" })]);
    if (!ps) { card.appendChild(el("div", { class: "msg", text: "Not available for this draft (generated before the summary existed). Regenerate to get it." })); return card; }
    function val(v) {
      if (v == null || v === "" || (Array.isArray(v) && !v.length)) return el("span", { class: "msg", text: "Not stated" });
      if (Array.isArray(v)) return el("ul", {}, v.map(function (x) { return el("li", { text: String(x) }); }));
      return document.createTextNode(String(v));
    }
    var cur = [ps.current_role, ps.current_employer].filter(Boolean).join(", ");
    var rows = [
      ["Current role", cur || null],
      ["Status", ps.current_status],
      ["Current industry", ps.current_industry],
      ["Time in role", ps.time_in_current_role],
      ["Lives / works in", ps.current_location],
      ["Highest role in career", ps.highest_role],
      ["Total experience", ps.total_years_experience],
      ["Industries across career", ps.industries],
      ["Highest education", ps.highest_education],
      ["Certifications and training", ps.certifications]
    ];
    card.appendChild(el("table", {}, rows.map(function (r) { return el("tr", {}, [el("td", { class: "k", text: r[0] }), el("td", {}, [val(r[1])])]); })));
    if (ps.notes) card.appendChild(el("div", { class: "note", text: ps.notes }));
    return card;
  }

  /* First name in the narration (slides 1 and 10): default from the rule, Christian can switch it off or respell it. */
  function nameCard(req, auto) {
    var nv = state.doc.name_voice || { use: false, say: "" };
    var sel = el("select", {}, [el("option", { value: "true", text: "Yes, say the first name" }), el("option", { value: "false", text: "No, skip the name" })]);
    sel.value = nv.use ? "true" : "false";
    var say = el("input", { placeholder: "How the voice should say it" }); say.value = nv.say || "";
    var player = el("span", { class: "msg" });
    function mark() {
      var o = state.orig.name_voice || {};
      sel.classList.toggle("changed", String(!!o.use) !== sel.value);
      say.classList.toggle("changed", (o.say || "") !== say.value);
    }
    sel.addEventListener("change", function () { state.doc.name_voice = { use: sel.value === "true", say: say.value }; mark(); });
    say.addEventListener("input", function () { state.doc.name_voice = { use: sel.value === "true", say: say.value }; mark(); });
    var play = el("button", { text: "Play greeting", onclick: async function () {
      play.disabled = true; player.textContent = "Recording...";
      try {
        var r = await api("preview_name", { id: req.id, say: say.value });
        player.textContent = r.text;
        new Audio("data:audio/mpeg;base64," + r.audio).play();
      } catch (e) { player.textContent = e.message; }
      play.disabled = false;
    } });
    mark();
    return el("div", { class: "card" }, [el("h3", { text: "First name in the narration (slides 1 and 10)" }),
      el("div", { class: "grid2" }, [el("div", {}, [el("div", { class: "lbl", text: "Say the name" }), sel]), el("div", {}, [el("div", { class: "lbl", text: "Spoken as (type a respelling if needed)" }), say])]),
      el("div", { class: "msg", style: "margin-top:6px", text: "Default: " + (auto ? (auto.use ? "say it" : "skip it") + " (" + auto.reason + ")" : "-") }),
      el("div", { style: "margin-top:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap" }, [play, player])]);
  }

  async function detailView(id) {
    root.innerHTML = "";
    var wrap = el("div", { class: "wrap" });
    root.appendChild(wrap);
    wrap.appendChild(el("button", { text: "Back to the list", onclick: listView }));
    var box = el("div", { class: "card", text: "Loading..." });
    wrap.appendChild(box);
    var j;
    try { j = await api("get", { id: id }); } catch (e) { box.textContent = e.message; return; }
    box.remove();
    var req = j.request, d = j.draft || {};
    state.cur = req; state.orig = clone(d.json_approved || d.json_generated || {});
    if (!state.orig.name_voice && j.name_auto) state.orig.name_voice = { use: j.name_auto.use, say: j.name_auto.say };
    state.doc = clone(state.orig);
    var doc = state.doc, lang = req.language === "FR" ? "FR" : "EN";

    wrap.appendChild(el("div", { class: "top" }, [el("h1", { text: req.first_name + " " + req.last_name }), el("div", {}, [el("span", { class: "pill", text: req.language }), el("span", { class: "pill", text: req.source }), el("span", { class: "pill", text: req.status })])]));
    if (req.error) wrap.appendChild(el("div", { class: "card" }, [el("span", { class: "pill red", text: "error" }), " " + req.error]));
    if (["ready_to_export", "video_ready", "sent"].indexOf(req.status) >= 0) wrap.appendChild(deliveryCard(req));

    wrap.appendChild(el("div", { class: "steps" }, [
      el("div", { html: "<b>1. Decide</b><br>Read the profile summary. Not a fit? Click Not a fit." }),
      el("div", { html: "<b>2. Correct</b><br>Fix any field on the right. Changed fields turn amber." }),
      el("div", { html: "<b>3. Approve</b><br>Saves your corrections and starts narration and the deck." })]));
    var cols = el("div", { class: "cols" }), side = el("div", { class: "side" }), main = el("div");
    cols.appendChild(side); cols.appendChild(main); wrap.appendChild(cols);
    var host = wrap; wrap = side;

    wrap.appendChild(profileCard(doc.profile_summary || (d.json_generated || {}).profile_summary));

    wrap.appendChild(nameCard(req, j.name_auto));

    var flags = (d.flags || []).slice().sort(function (a, b) { return (b.red ? 1 : 0) - (a.red ? 1 : 0); });
    if (flags.length) wrap.appendChild(el("div", { class: "card" }, [el("h3", { text: "Flags" })].concat(flags.map(function (f) {
      return el("div", { style: "margin:4px 0" }, [el("span", { class: "pill " + (f.red ? "red" : "amber"), text: f.code + (f.field ? " | " + f.field : "") }), " " + (f.reason || "")]);
    }))));

    wrap.appendChild(el("div", { class: "card" }, [el("h3", { text: "Form answers" }), el("div", { class: "grid2" }, [
      el("div", { html: "<div class='lbl'>Target (form)</div>" + esc((req.target_family || "") + " | " + (req.target_title || "")) }),
      el("div", { html: "<div class='lbl'>Industry / location</div>" + esc((req.target_industry || "") + " | " + (req.target_location || "")) }),
      el("div", { html: "<div class='lbl'>Pricing region</div>" + esc(req.region || "") }),
      el("div", { html: "<div class='lbl'>Note</div>" + esc(req.note || "") })])]));
    wrap = main;

    if (doc.today) wrap.appendChild(el("div", { class: "card" }, [el("h3", { text: "Slide 2. Today and target" }), el("div", { class: "grid2" }, [
      field("today.in_role", "Still in this role today?", "select", [[true, "Yes: script says \"Today, you work as\""], [false, "No: script says \"Most recently, you worked as\""]]), el("div"),
      field("today.current_title", "Current or most recent title"), field("today.location", "Location (shown and spoken)"),
      field("target.target_role_label", "Target role label"), field("target.industry", "Target industry")])]));

    var m = doc.market || {};
    var mrows = (m.rows || []).map(function (r) { return el("tr", {}, [el("td", { text: r.region }), el("td", { text: r.current ? r.current.median + " $/h (" + r.current.occupation_code + ")" : "-" }), el("td", { text: r.target ? r.target.median + " $/h (" + r.target.occupation_code + ")" : "-" }), el("td", { text: r.target ? r.target.period : "" })]); });
    wrap.appendChild(el("div", { class: "card" }, [el("h3", { text: "Slides 3 and 4. Market (computed from government data)" }),
      el("div", { class: "msg", text: "Version: " + (m.variant === "gap" ? "wage gap" : "target pay range only") + " | wage role: " + (m.wage_family || "-") + " (stated: " + (m.stated_family || "-") + ") | current: " + (m.current_family || "-") + ", " + (m.current_country || "-") }),
      el("table", {}, [el("tr", {}, ["Region", "Current", "Target", "Period"].map(function (h) { return el("th", { text: h }); }))].concat(mrows)),
      el("div", { class: "msg", text: doc.roi ? "Payback (guided program): " + payback(doc) : "Payback line not shown" }),
      el("div", { class: "msg", text: doc.demand && doc.demand.national ? "Outlook: " + doc.demand.national.openings + " openings, " + doc.demand.national.seekers + " job seekers, " + doc.demand.national.period : ((doc.demand && doc.demand.provincial || []).map(function (p) { return p.geography + ": " + p.conclusion; }).join(" | ") || "No outlook row") }),
      el("div", { class: "msg", text: "To change the market data, edit the form answers or the market tables, then regenerate." })]));

    var req5 = el("div", { class: "card" }, [el("h3", { text: "Slide 5. Requirements" }), el("div", { class: "grid2" }, [
      field("requirements.expertise", "Technical expertise", "select", [["on_track", "On track"], ["in_progress", "In progress"]]),
      field("requirements.experience", "Experience", "select", [["on_track", "On track"], ["in_progress", "In progress"]]),
      field("requirements.certification", "Target certification", "select", [["not_started", "Not started"], ["in_progress", "In progress"]])]),
      el("div", { class: "ev", text: doc.requirements && doc.requirements.notes || "" })]);
    wrap.appendChild(req5);

    var gapsCard = el("div", { class: "card" }, [el("h3", { text: "Slide 6. The three gaps" }), el("div", { class: "msg", text: "Expected by the rule: " + (doc.expected_dimensions || []).map(function (n) { return DIMS[lang][n]; }).join(", ") })]);
    var gapSentInputs = [];
    (doc.gaps || []).forEach(function (g, i) {
      var fSel = field("gaps." + i + ".n", "Gap " + (i + 1), "select", [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) { return [n, n + ". " + DIMS[lang][n]]; }));
      var fText = field("gaps." + i + ".text", null, "area");
      var ev = el("div", { class: "ev", text: "Evidence: " + (g.evidence || "") });
      var note = el("div", { class: "msg" });
      var sel = fSel.querySelector("select"), area = fText.querySelector("textarea");
      /* a new dimension needs a new text: Claude rewrites the card and its spoken sentence from the resume */
      sel.addEventListener("change", async function () {
        var n = Number(sel.value);
        note.textContent = "Rewriting this gap for " + DIMS[lang][n] + "...";
        sel.disabled = true; area.disabled = true;
        try {
          var r = await api("rewrite_gap", { id: state.cur.id, i: i, n: n, doc: state.doc });
          area.value = r.text; area.dispatchEvent(new Event("input"));
          state.doc.gaps[i].evidence = r.evidence; state.doc.gaps[i].title = r.title;
          ev.textContent = "Evidence: " + r.evidence;
          var gs = gapSentInputs[i];
          if (gs && r.sentence) { gs.value = r.sentence; gs.dispatchEvent(new Event("input")); }
          note.textContent = "Rewritten. Check the text and the spoken sentence " + (i + 1) + " below, edit if needed.";
        } catch (e) { note.textContent = "Rewrite failed: " + e.message + ". Edit the text by hand."; }
        sel.disabled = false; area.disabled = false;
      });
      gapsCard.appendChild(el("div", { style: "margin-top:10px" }, [fSel, fText, ev, note]));
    });
    wrap.appendChild(gapsCard);

    var pil = el("div", { class: "card" }, [el("h3", { text: "Slide 10. Pillar scores" })]);
    (doc.pillars || []).forEach(function (p, i) {
      var band = p.score >= 8 ? "green" : p.score >= 6 ? "yellow" : "red";
      pil.appendChild(el("div", { style: "margin-top:10px" }, [
        el("div", { class: "lbl band-" + band, text: p.name }),
        el("div", { class: "score" }, [field("pillars." + i + ".score", null, "select", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (n) { return [n, String(n)]; }))]),
        field("pillars." + i + ".note", null, "area"),
        el("div", { class: "ev", text: "Evidence: " + (p.evidence || "") })]));
    });
    wrap.appendChild(pil);

    var sv = el("div", { class: "card" }, [el("h3", { text: "Spoken script pieces" })]);
    var svKeys = ["target_role", "current_role", "years", "credentials", "target_industry", "target_regions", "target_field", "expertise_have", "experience_have"];
    var g2 = el("div", { class: "grid2" }, svKeys.filter(function (k) { return doc.script_vars && k in doc.script_vars; }).map(function (k) { return field("script_vars." + k, k.replace(/_/g, " ")); }));
    sv.appendChild(g2);
    (doc.script_vars && doc.script_vars.gap_sentences || []).forEach(function (s, i) { var f = field("script_vars.gap_sentences." + i, "gap sentence " + (i + 1), "area"); gapSentInputs[i] = f.querySelector("textarea"); sv.appendChild(f); });
    wrap.appendChild(sv);

    var reason = el("input", { placeholder: "Why you changed it (optional, helps the generator learn)" });
    var msg = el("span", { class: "msg" });
    async function act(action, extra) {
      msg.textContent = "Working...";
      try {
        var r = await api(action, Object.assign({ id: req.id, doc: state.doc, changes: changes(), reason: reason.value }, extra || {}));
        msg.textContent = r.message || "Done.";
        if (action !== "save") setTimeout(listView, 700); else { state.orig = clone(state.doc); detailView(req.id); }
      } catch (e) { msg.textContent = e.message; }
    }
    wrap = host;
    wrap.appendChild(el("div", { class: "bar" }, [
      el("div", { style: "flex:1 1 260px" }, [reason]),
      el("button", { class: "primary", text: "Approve", title: "Saves your corrections and sends the roadmap to narration and the deck build", onclick: function () { if (confirm("Approve this roadmap and send it to narration?")) act("approve"); } }),
      el("button", { text: "Save draft", title: "Keeps your corrections without sending anything; come back later", onclick: function () { act("save"); } }),
      el("button", { text: "Regenerate", title: "Redo the whole draft with your instruction (hand edits are discarded)", onclick: function () { var n = prompt("What should the generator do differently? (optional)") ; if (n !== null) act("regenerate", { note: n }); } }),
      el("button", { text: "Hold", onclick: function () { act("hold"); } }),
      el("button", { class: "danger", text: "Not a fit", onclick: function () { var n = prompt("Why is this lead not a fit?"); if (n) act("not_fit", { note: n }); } }),
      msg,
      el("div", { class: "help", text: "Normal path: correct, then Approve (no need to save first). Regenerate only when the draft is too wrong to fix by hand. Hold parks it without a decision." })]));
  }

  /* same rule as the deck and the narration: guided price after the debrief discount / monthly wage gain, rounded up */
  function payback(doc) {
    var r = doc.roi || {}, price = Number((doc.prices || {}).guided || 3900);
    var hi = Number(r.monthly_gain_high), lo = Number(r.monthly_gain_low);
    if (!(hi > 0) || !(lo > 0)) return "-";
    var a = Math.max(1, Math.ceil(price / Math.max(hi, lo))), b = Math.max(1, Math.ceil(price / Math.min(hi, lo)));
    return a === b ? "about " + a + " month" + (a === 1 ? "" : "s") : a + " to " + b + " months";
  }

  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }

  sb.auth.getSession().then(function (r) { if (r.data.session) listView(); else loginView(); });
})();
`;
