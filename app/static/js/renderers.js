/* Result renderers, one per feature slug.
 * Signature: (data, ctx) -> { title, tabs: [{id, label, html}], onMount?(root, ctx) }
 *   data = the AI API response, ctx = { audio, input } (input = submitted params + file name)
 * Response contracts are documented in /api_docs. */
(function () {
  "use strict";
  const { esc, fmtTime, scoreColor, icon } = window.UI;

  // ---------- Reusable pieces ----------
  const kpis = (items) => `<div class="kpi-grid">${items.map((k) =>
    `<div class="kpi"><small>${esc(k.label)}</small><div class="kpi-val">${k.html ?? esc(k.value)}</div></div>`).join("")}</div>`;

  const box = (title, body, extra = "") =>
    `<div class="box"><div class="box-head"><h4>${title}</h4>${extra}</div>${body}</div>`;

  const list = (items, empty = "None identified") => (items && items.length)
    ? `<ul class="list">${items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`
    : `<p class="empty-note">${esc(empty)}</p>`;

  const count = (arr) => `<span class="count">${(arr || []).length}</span>`;

  const toneOf = (v) => {
    const s = String(v || "").toLowerCase();
    if (s.includes("pos")) return "green";
    if (s.includes("neg")) return "red";
    if (s.includes("mix")) return "amber";
    return "blue";
  };
  const tag = (text, tone = "") => `<span class="tag ${tone ? "tag-" + tone : ""}">${esc(text)}</span>`;
  const cap = (s) => String(s || "").replace(/^\w/, (c) => c.toUpperCase());

  const bars = (items, max = 1) => items.map((b) => {
    const pct = Math.round((b.value / max) * 100);
    return `<div class="bar-row"><span>${esc(b.label)}</span><div class="bar"><i data-w="${pct}%" ${b.color ? `style="background:${b.color}"` : ""}></i></div><b>${b.display ?? pct + "%"}</b></div>`;
  }).join("");

  const scoreRing = (score, label = "/ 100") => {
    const r = 52, c = 2 * Math.PI * r;
    const off = c * (1 - Math.max(0, Math.min(100, score)) / 100);
    return `<div class="score-ring" style="--c:${scoreColor(score)}">
      <svg viewBox="0 0 120 120" width="110" height="110">
        <circle class="ring-bg" cx="60" cy="60" r="${r}" fill="none" stroke-width="10"/>
        <circle class="ring-fg" cx="60" cy="60" r="${r}" fill="none" stroke-width="10" stroke-linecap="round"
          stroke-dasharray="${c}" stroke-dashoffset="${c}" data-offset="${off}"/>
      </svg>
      <div class="ring-label"><strong>${esc(score)}</strong><small>${esc(label)}</small></div>
    </div>`;
  };

  const Renderers = {};

  // ======================================================================
  // Call Recording Analysis  (api_docs/recording_analysis.md)
  // ======================================================================
  const SENTIMENT = {
    positive: { angle: 62, tone: "green", label: "Positive" },
    neutral: { angle: 0, tone: "blue", label: "Neutral" },
    mixed: { angle: 0, tone: "amber", label: "Mixed" },
    negative: { angle: -62, tone: "red", label: "Negative" },
  };

  function sentimentGauge(value) {
    const key = String(value || "").toLowerCase().trim();
    const s = SENTIMENT[key] || { angle: 0, tone: "blue", label: cap(value || "Unknown") };
    const pt = (a, r = 46) => [60 + r * Math.cos((a * Math.PI) / 180), 60 - r * Math.sin((a * Math.PI) / 180)];
    const arc = (a1, a2, color, active) => {
      const [x1, y1] = pt(a1), [x2, y2] = pt(a2);
      return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A46 46 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${color}" stroke-width="${active ? 11 : 9}" fill="none" stroke-linecap="round" opacity="${active ? 1 : 0.55}"/>`;
    };
    return `<div class="gauge">
      <svg viewBox="0 0 120 70" width="150" height="88">
        ${arc(174, 126, "#ec9a9a", key === "negative")}
        ${arc(114, 66, key === "mixed" ? "#ecc677" : "#9cc3ea", key === "neutral" || key === "mixed")}
        ${arc(54, 6, "#8fd1b0", key === "positive")}
        <g class="needle" data-rotate="${s.angle}deg">
          <line x1="60" y1="60" x2="60" y2="24" stroke="#1e2a3a" stroke-width="3" stroke-linecap="round"/>
          <circle cx="60" cy="60" r="5.5" fill="#1e2a3a"/><circle cx="60" cy="60" r="2" fill="#fff"/>
        </g>
      </svg>
      <div class="gauge-label tone-${s.tone}">${esc(s.label)}</div>
      <small class="muted">Customer sentiment</small>
    </div>`;
  }

  // Wrap keyword occurrences in <mark> without breaking HTML escaping.
  function highlightKeywords(text, keywords) {
    const lower = text.toLowerCase(), ranges = [];
    keywords.map((k, i) => ({ k: String(k).toLowerCase().trim(), i }))
      .filter((o) => o.k.length > 1)
      .sort((a, b) => b.k.length - a.k.length)
      .forEach(({ k, i }) => {
        let from = 0, at;
        while ((at = lower.indexOf(k, from)) !== -1) {
          let end = at + k.length;
          // keep combining marks (e.g. Bangla vowel signs) inside the highlight so glyphs stay shaped
          while (end < text.length && /\p{M}/u.test(text[end])) end++;
          if (!ranges.some((r) => at < r.e && end > r.s)) ranges.push({ s: at, e: end, i });
          from = end;
        }
      });
    ranges.sort((a, b) => a.s - b.s);
    let out = "", pos = 0;
    ranges.forEach((r) => {
      out += esc(text.slice(pos, r.s)) + `<mark class="kw" data-kw="${r.i}">${esc(text.slice(r.s, r.e))}</mark>`;
      pos = r.e;
    });
    return { html: out + esc(text.slice(pos)), counts: keywords.map((_, i) => ranges.filter((r) => r.i === i).length) };
  }

  const initials = (n) => String(n || "?").trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  function insightList(items, tone, ic, emptyText) {
    if (!items || !items.length) return `<div class="ins-empty">${icon("check", 13)} ${esc(emptyText)}</div>`;
    return `<div class="ins-list">${items.map((t, i) =>
      `<div class="ins-item tone-${tone}" style="animation-delay:${i * 70}ms"><span class="ins-ic">${icon(ic, 13)}</span><span>${esc(t)}</span></div>`).join("")}</div>`;
  }

  Renderers["call-recording-analysis"] = (d, ctx) => {
    const a = d.analysis || {};
    const inp = ctx.input || {};
    const lang = d.language === "bn" ? "bn" : "en";
    const usage = d.token_usage;
    const pains = a.customer_pain_points || [], objs = a.objections_raised || [];
    const prods = a.products_services_discussed || [], acts = a.action_items || [];
    const kws = a.keywords || [];
    const followUp = !!a.follow_up_required;

    // ---- call flow (agent <-> customer)
    const person = (name, role, cls) =>
      `<div class="person ${cls}"><span class="pav">${esc(initials(name || role))}</span><div><b>${esc(name || role)}</b><small>${role}</small></div></div>`;
    const inbound = inp.call_direction === "inbound";
    const agentEl = person(inp.agent_name, "Agent", "agent"), custEl = person(inp.customer_name, "Customer", "customer");
    const flow = `<div class="call-flow">${inbound ? custEl : agentEl}
      <div class="flow-line"><span>${icon("phone", 11)} ${inp.call_direction ? cap(inp.call_direction) : "Call"}</span><i></i></div>
      ${inbound ? agentEl : custEl}</div>`;

    const chips = [
      [icon("tag", 11), lang === "bn" ? "Bangla output" : "English output"],
      inp.deal_or_lead_id && [icon("tag", 11), `Lead ${inp.deal_or_lead_id}`],
      inp.product_or_service && [icon("package", 11), inp.product_or_service],
    ].filter(Boolean).map(([ic, t]) => `<span class="mini-chip">${ic}${esc(t)}</span>`).join("");

    const stat = (id, tab, n, label, tone, ic) =>
      `<button type="button" class="ca-stat tone-${tone}" data-goto="${tab}" data-target="${id}">
        <span class="ca-stat-ic">${icon(ic, 15)}</span>
        <span class="ca-stat-txt"><b data-count="${n}">0</b><small>${label}</small></span>
        <span class="ca-stat-go">${icon("arrow", 12)}</span>
      </button>`;

    const header = `
      <div class="ca-hero">
        ${sentimentGauge(a.customer_sentiment)}
        <div class="ca-outcome">
          <small class="muted">Call outcome</small>
          <div class="outcome-text" lang="${lang}">${esc(a.call_outcome || "-")}</div>
          ${flow}
          <div class="chip-row">${chips}</div>
        </div>
        <button type="button" class="ca-follow ${followUp ? "req" : "ok"}" data-goto="next" data-target="followup">
          <span class="fu-ic">${icon(followUp ? "clock" : "check", 18)}</span>
          <b>${followUp ? "Follow-up required" : "No follow-up needed"}</b>
          <small lang="${lang}">${esc(followUp ? (a.follow_up_notes || "See next steps") : "Call fully handled")}</small>
        </button>
      </div>
      <div class="ca-stats">
        ${stat("pains", "insights", pains.length, "Pain points", "amber", "frown")}
        ${stat("objections", "insights", objs.length, "Objections", "red", "shield")}
        ${stat("products", "insights", prods.length, "Products discussed", "blue", "package")}
        ${stat("actions", "next", acts.length, "Action items", "green", "checksq")}
      </div>`;

    // ---- Overview tab
    const hl = highlightKeywords(a.summary || "", kws);
    const overview = `
      <div class="box summary-box">
        <div class="box-head"><h4>${icon("sparkles", 13)} AI summary</h4>
          <button class="btn btn-sm btn-ghost" data-copy="${esc(a.summary || "")}">${icon("copy", 11)} Copy</button></div>
        <p class="summary" lang="${lang}">${hl.html || "-"}</p>
        ${kws.length ? `<div class="kw-wrap">
          <small class="muted">Keywords · hover or click to find them in the summary</small>
          <div class="chip-row" lang="${lang}">${kws.map((k, i) =>
            `<button type="button" class="kw-chip ${hl.counts[i] ? "" : "nomatch"}" data-kw="${i}">${esc(k)}${hl.counts[i] ? `<span>${hl.counts[i]}</span>` : ""}</button>`).join("")}</div>
        </div>` : ""}
      </div>
      ${a.important_notes ? `<div class="note note-red"><strong>${icon("alert", 13)} Important notes</strong><p lang="${lang}">${esc(a.important_notes)}</p></div>` : ""}`;

    // ---- Customer insights tab
    const insights = `
      <div class="box-grid" lang="${lang}">
        <div class="box" data-section="pains"><div class="box-head"><h4>${icon("frown", 13)} Customer pain points</h4>${count(pains)}</div>
          ${insightList(pains, "amber", "frown", "No pain points mentioned")}</div>
        <div class="box" data-section="objections"><div class="box-head"><h4>${icon("shield", 13)} Objections raised</h4>${count(objs)}</div>
          ${insightList(objs, "red", "shield", "No objections raised")}</div>
      </div>
      <div class="box" data-section="products" lang="${lang}"><div class="box-head"><h4>${icon("package", 13)} Products / services discussed</h4>${count(prods)}</div>
        ${prods.length ? `<div class="prod-grid">${prods.map((p, i) =>
          `<div class="prod" style="animation-delay:${i * 60}ms"><span class="ins-ic">${icon("package", 13)}</span>${esc(p)}</div>`).join("")}</div>`
          : `<div class="ins-empty">${icon("check", 13)} No products discussed</div>`}
      </div>`;

    // ---- Next steps tab
    const next = `
      <div class="fu-card ${followUp ? "req" : "ok"}" data-section="followup" lang="${lang}">
        <span class="fu-ic">${icon(followUp ? "clock" : "check", 18)}</span>
        <div><b>${followUp ? "Follow-up required" : "No follow-up needed"}</b>
          <p>${esc(a.follow_up_notes || (followUp ? "No specific follow-up notes provided." : "The call was fully handled."))}</p></div>
        ${a.follow_up_notes ? `<button class="icon-btn sm" data-copy="${esc(a.follow_up_notes)}" title="Copy">${icon("copy", 12)}</button>` : ""}
      </div>
      <div class="box" data-section="actions" lang="${lang}">
        <div class="box-head"><h4>${icon("checksq", 13)} Action items</h4>
          ${acts.length ? `<span class="muted small" data-done>0 / ${acts.length} done</span>` : ""}</div>
        ${acts.length ? `<div class="progress"><i data-progress></i></div>
          <ul class="checklist">${acts.map((t, i) => `<li style="animation-delay:${i * 70}ms"><label>
            <input type="checkbox"><span class="cbox">${icon("check", 11)}</span><span class="ctext">${esc(t)}</span></label></li>`).join("")}</ul>
          <button class="btn btn-sm btn-outline" data-copy="${esc(acts.map((t) => "- " + t).join("\n"))}">${icon("copy", 11)} Copy as task list</button>`
          : `<div class="ins-empty">${icon("check", 13)} No action items from this call</div>`}
      </div>`;

    // ---- Footer: token usage (collapsed)
    let footer = "";
    if (usage) {
      const inT = usage.input_tokens || 0, outT = usage.output_tokens || 0, tot = usage.total_tokens || inT + outT || 1;
      footer = `<details class="expander">
        <summary>${icon("chevron", 12)} ${icon("cpu", 12)} Token usage <span class="muted">· ${esc(tot.toLocaleString())} tokens</span></summary>
        <div class="token-body">
          <div class="split-bar"><i style="width:${(inT / tot) * 100}%;background:#9cc3ea"></i><i style="width:${(outT / tot) * 100}%;background:#ec9a9a"></i></div>
          <div class="token-grid">
            <div><small><i class="sw" style="background:#9cc3ea"></i>Input</small><b>${esc(inT.toLocaleString())}</b></div>
            <div><small><i class="sw" style="background:#ec9a9a"></i>Output</small><b>${esc(outT.toLocaleString())}</b></div>
            <div><small>Total</small><b>${esc(tot.toLocaleString())}</b></div>
            <div><small>Audio</small><b>${usage.audio_tokens == null ? "n/a" : esc(usage.audio_tokens.toLocaleString())}</b></div>
          </div>
        </div>
      </details>`;
    }

    return {
      title: "Call analysis",
      header,
      footer,
      tabs: [
        { id: "overview", label: "Overview", icon: "sparkles", html: overview },
        { id: "insights", label: `Customer insights (${pains.length + objs.length + prods.length})`, icon: "frown", html: insights },
        { id: "next", label: `Next steps (${acts.length + (followUp ? 1 : 0)})`, icon: "checksq", html: next },
      ],
      onMount(root, c) {
        // stat tiles / follow-up card jump to the related tab + section
        root.querySelectorAll("[data-goto]").forEach((el) => el.addEventListener("click", () => {
          c.switchTab(el.dataset.goto);
          const sec = root.querySelector(`[data-section="${el.dataset.target}"]`);
          if (!sec) return;
          sec.scrollIntoView({ behavior: "smooth", block: "nearest" });
          sec.classList.remove("flash"); void sec.offsetWidth; sec.classList.add("flash");
        }));
        // keyword chips highlight matches in the summary
        root.querySelectorAll(".kw-chip").forEach((chip) => {
          const marks = () => root.querySelectorAll(`mark.kw[data-kw="${chip.dataset.kw}"]`);
          chip.addEventListener("mouseenter", () => marks().forEach((m) => m.classList.add("hl")));
          chip.addEventListener("mouseleave", () => marks().forEach((m) => m.classList.toggle("hl", chip.classList.contains("pinned"))));
          chip.addEventListener("click", () => {
            const on = chip.classList.toggle("pinned");
            marks().forEach((m) => m.classList.toggle("hl", on));
          });
        });
        // action item checklist progress
        const boxes = [...root.querySelectorAll(".checklist input")];
        const upd = () => {
          const done = boxes.filter((b) => b.checked).length;
          const lbl = root.querySelector("[data-done]"), bar = root.querySelector("[data-progress]");
          if (lbl) lbl.textContent = `${done} / ${boxes.length} done`;
          if (bar) bar.style.width = `${(done / (boxes.length || 1)) * 100}%`;
        };
        boxes.forEach((b) => b.addEventListener("change", () => { b.closest("li").classList.toggle("done", b.checked); upd(); }));
      },
    };
  };

  // ======================================================================
  // Call Recording Transcript  (demo shape - update when API is shared)
  // ======================================================================
  function transcriptHtml(segments) {
    return `
      <div class="tools-row">
        <input type="search" class="input" placeholder="Search transcript…" data-search>
        <button class="btn btn-sm btn-outline" data-copy-transcript>${icon("copy", 12)} Copy</button>
        <button class="btn btn-sm btn-outline" data-dl-transcript>${icon("download", 12)} .txt</button>
      </div>
      <div class="transcript" data-transcript>
        ${segments.map((s, i) => `
          <div class="seg" data-i="${i}" data-start="${s.start}" data-end="${s.end}">
            <time>${fmtTime(s.start)}</time>
            <div><div class="who ${String(s.speaker).toLowerCase()}">${esc(s.speaker)}</div><p data-text>${esc(s.text)}</p></div>
          </div>`).join("")}
      </div>`;
  }

  function mountTranscript(root, segments, audio) {
    const segEls = [...root.querySelectorAll(".seg")];
    root.querySelector("[data-search]")?.addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      segEls.forEach((el, i) => {
        const text = segments[i].text, p = el.querySelector("[data-text]");
        if (!q) { el.classList.remove("hidden"); p.innerHTML = esc(text); return; }
        const hit = text.toLowerCase().includes(q);
        el.classList.toggle("hidden", !hit);
        if (hit) p.innerHTML = esc(text).replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"), "<mark>$1</mark>");
      });
    });
    const txt = segments.map((s) => `[${fmtTime(s.start)}] ${s.speaker}: ${s.text}`).join("\n");
    root.querySelector("[data-copy-transcript]")?.addEventListener("click", () => UI.copy(txt));
    root.querySelector("[data-dl-transcript]")?.addEventListener("click", () => UI.download("transcript.txt", txt, "text/plain"));
    if (audio && audio.src) {
      segEls.forEach((el) => el.addEventListener("click", () => { audio.currentTime = +el.dataset.start; audio.play().catch(() => {}); }));
      audio.ontimeupdate = () => {
        const t = audio.currentTime;
        segEls.forEach((el) => el.classList.toggle("playing", t >= +el.dataset.start && t < +el.dataset.end));
      };
    }
  }

  Renderers["call-recording-transcript"] = (d, ctx) => {
    const segs = d.segments || [];
    const speakers = {};
    segs.forEach((s) => { speakers[s.speaker] = (speakers[s.speaker] || 0) + (s.end - s.start); });
    const total = Object.values(speakers).reduce((a, b) => a + b, 0) || 1;
    const colors = ["#5b9bd5", "#e07a7a", "#7fb3e0", "#f0a5a5"];
    return {
      title: "Transcript",
      tabs: [{
        id: "transcript", label: "Transcript",
        html: kpis([
          { label: "Duration", value: fmtTime(d.duration_sec) },
          { label: "Words", value: d.word_count ?? "-" },
          { label: "Speakers", value: (d.speakers || Object.keys(speakers)).length },
          { label: "Confidence", value: d.confidence ? `${Math.round(d.confidence * 100)}%` : "-" },
        ]) +
        box("Talk time", `<div class="split-bar">${Object.entries(speakers).map(([, v], i) => `<i style="width:${(v / total) * 100}%;background:${colors[i % 4]}"></i>`).join("")}</div>
          <div class="legend">${Object.entries(speakers).map(([k, v], i) => `<span style="--c:${colors[i % 4]}">${esc(k)} ${Math.round((v / total) * 100)}%</span>`).join("")}</div>`) +
        transcriptHtml(segs),
      }],
      onMount: (root, c) => mountTranscript(root, segs, c.audio),
    };
  };

  // ======================================================================
  // Agent Quality Check  (demo shape - update when API is shared)
  // ======================================================================
  Renderers["agent-quality-check"] = (d) => {
    const criteria = d.criteria || [];
    const passCount = criteria.filter((c) => c.status === "pass").length;
    return {
      title: "Quality scorecard",
      tabs: [
        {
          id: "scorecard", label: "Scorecard",
          html: `<div class="score-hero">
              ${scoreRing(d.overall_score)}
              <div>
                <div class="strong">Agent: ${esc(d.agent_name || "-")}</div>
                <div class="chip-row" style="margin:6px 0">
                  ${tag(d.result, d.result === "Pass" ? "green" : "red")}${tag("Grade " + d.grade, "blue")}${tag(`${passCount}/${criteria.length} criteria passed`)}
                </div>
                ${d.customer_satisfaction_prediction ? `<small class="muted">Predicted CSAT: <b>${d.customer_satisfaction_prediction} / 5</b></small>` : ""}
              </div>
            </div>
            <div class="criteria">
              ${criteria.map((c) => {
                const pct = Math.round((c.score / c.max) * 100);
                return `<div class="criterion">
                  <button class="criterion-head" type="button">
                    <span class="name"><i class="crit-dot ${c.status}"></i>${esc(c.name)}</span>
                    <div class="bar"><i data-w="${pct}%" style="background:${scoreColor(pct)}"></i></div>
                    <span class="score">${c.score}/${c.max}</span>
                    <span class="chev">${icon("chevron", 12)}</span>
                  </button>
                  <div class="criterion-body">
                    ${c.evidence ? `<blockquote class="quote">"${esc(c.evidence)}"</blockquote>` : ""}
                    <p>${esc(c.feedback)}</p>
                  </div>
                </div>`;
              }).join("")}
            </div>`,
        },
        {
          id: "compliance", label: "Compliance",
          html: box("Compliance checklist", (d.compliance_checks || []).map((c) =>
            `<div class="check-row"><span>${esc(c.name)}</span>${c.passed ? tag("Passed", "green") : tag("Missed", "red")}</div>`).join("")),
        },
        {
          id: "coaching", label: "Coaching",
          html: `<div class="box-grid">${box("Strengths", list(d.strengths))}${box("Areas to improve", list(d.improvements))}</div>`,
        },
      ],
      onMount: (root) => root.querySelectorAll(".criterion-head").forEach((h) =>
        h.addEventListener("click", () => h.parentElement.classList.toggle("open"))),
    };
  };

  // ======================================================================
  // Potential Lead Finder  (demo shape - update when API is shared)
  // ======================================================================
  Renderers["potential-lead-finder"] = (d) => {
    const leads = d.leads || [];
    const initials = (n) => n.split(" ").map((p) => p[0]).slice(0, 2).join("");
    return {
      title: "Recommended leads",
      tabs: [
        {
          id: "leads", label: `Leads (${leads.length})`,
          html: kpis([
            { label: "Records scanned", value: (d.total_scanned || 0).toLocaleString() },
            { label: "Leads found", value: d.total_found ?? leads.length },
            { label: "Avg. score", value: d.avg_score ?? "-" },
            { label: "High intent", value: leads.filter((l) => l.intent === "High").length },
          ]) +
          `<div class="lead-list">${leads.map((l) => `
            <div class="lead-card">
              <span class="avatar">${esc(initials(l.name))}</span>
              <div>
                <div class="strong">${esc(l.name)}</div>
                <div class="muted">${esc(l.title)} · ${esc(l.company)}</div>
                <div class="chip-row" style="margin-top:6px">
                  ${tag(l.intent + " intent", l.intent === "High" ? "green" : l.intent === "Medium" ? "amber" : "")}${tag(l.industry)}${tag(l.employees + " emp.")}${tag(l.location)}
                </div>
                <div class="lead-details">
                  <p>${esc(l.reason)}</p>
                  <div class="chip-row">${(l.signals || []).map((s) => tag(s, "blue")).join("")}</div>
                  <p>${icon("mail", 12)} ${esc(l.email)}<br><b>Next step:</b> ${esc(l.next_action)}</p>
                </div>
                <button class="link-btn" type="button">Show details</button>
              </div>
              <div class="lead-score"><strong style="color:${scoreColor(l.score)}">${l.score}</strong><small class="muted">score</small></div>
            </div>`).join("")}
          </div>`,
        },
        {
          id: "table", label: "Table",
          html: `<div class="table-wrap"><table class="data">
            <thead><tr><th>Score</th><th>Name</th><th>Title</th><th>Company</th><th>Industry</th><th>Intent</th><th>Email</th></tr></thead>
            <tbody>${leads.map((l) => `<tr><td><b style="color:${scoreColor(l.score)}">${l.score}</b></td><td>${esc(l.name)}</td><td>${esc(l.title)}</td>
              <td>${esc(l.company)}</td><td>${esc(l.industry)}</td><td>${esc(l.intent)}</td><td>${esc(l.email)}</td></tr>`).join("")}
            </tbody></table></div>
            <button class="btn btn-sm btn-outline" style="margin-top:10px" data-csv>${icon("download", 12)} Export CSV</button>`,
        },
      ],
      onMount: (root) => {
        root.querySelectorAll(".link-btn").forEach((b) => b.addEventListener("click", () => {
          const card = b.closest(".lead-card");
          card.classList.toggle("open");
          b.textContent = card.classList.contains("open") ? "Hide details" : "Show details";
        }));
        root.querySelector("[data-csv]")?.addEventListener("click", () => {
          const cols = ["score", "name", "title", "company", "industry", "intent", "email", "next_action"];
          const csv = [cols.join(","), ...leads.map((l) => cols.map((c) => `"${String(l[c] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
          UI.download("leads.csv", csv, "text/csv");
        });
      },
    };
  };

  // Used when no renderer exists or the response shape is unexpected.
  Renderers.fallback = (d) => ({
    title: "Result",
    tabs: [{ id: "result", label: "Result", html: `<pre class="json-view">${esc(JSON.stringify(d, null, 2))}</pre>` }],
  });

  window.Renderers = Renderers;
})();
