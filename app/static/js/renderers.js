/* Result renderers, one per feature slug.
 * Signature: (data, ctx) -> { title, tabs: [{id, label, html}], onMount?(root, ctx) }
 *   data = the AI API response, ctx = { audio, input } (input = submitted params + file name)
 * Response contracts are documented in /api_docs. */
(function () {
  "use strict";
  const { esc, scoreColor, icon } = window.UI;

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
  // Call Transcription  (api_docs/call_transcription.md)
  // A "studio" layout: dark deck with speaker lanes + live caption,
  // chat-style conversation, per-speaker columns and an export desk.
  // ======================================================================
  const TX_SIZES = [12.5, 13.5, 15, 17];

  const parseTs = (v) => {                       // "01:05" | "1:02:03" | 65 -> seconds
    if (typeof v === "number") return Math.max(0, v);
    const parts = String(v ?? "").trim().split(":").map(Number);
    if (!parts.length || parts.some((n) => isNaN(n))) return 0;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  };
  const clock = (sec) => {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const p = (n) => String(n).padStart(2, "0");
    return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
  };
  const srtTime = (sec) => {
    const ms = Math.round(sec * 1000), p = (n, w = 2) => String(n).padStart(w, "0");
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  const wordCount = (t) => (String(t).trim().match(/\S+/g) || []).length;
  const spkClass = (name) => {
    const k = String(name).toLowerCase();
    if (k.includes("agent")) return "a";
    if (k.includes("customer") || k.includes("caller") || k.includes("client")) return "c";
    return "o";
  };
  const shorten = (t, n = 110) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

  // Case-insensitive highlight that keeps combining marks (Bangla vowel signs) inside the match.
  function markText(text, term) {
    if (!term) return { html: esc(text), n: 0 };
    const lower = text.toLowerCase(), q = term.toLowerCase();
    let out = "", pos = 0, n = 0, at;
    while ((at = lower.indexOf(q, pos)) !== -1) {
      let end = at + q.length;
      while (end < text.length && /\p{M}/u.test(text[end])) end++;
      out += esc(text.slice(pos, at)) + `<mark class="tx-hit">${esc(text.slice(at, end))}</mark>`;
      pos = end; n++;
    }
    return { html: out + esc(text.slice(pos)), n };
  }

  Renderers["call-transcription"] = (d, ctx) => {
    const segs = (Array.isArray(d.segments) ? d.segments : [])
      .filter((s) => s && String(s.text ?? "").trim())
      .map((s) => ({ speaker: String(s.speaker || "Speaker"), start: parseTs(s.start), text: String(s.text).trim() }));
    const lastStart = segs.length ? segs[segs.length - 1].start : 0;
    const duration = Math.max(Number(d.duration_seconds) || 0, lastStart + 2, 1);
    segs.forEach((s, i) => {
      const next = i < segs.length - 1 ? segs[i + 1].start : duration;
      s.end = Math.max(next, s.start + 0.6);
      s.words = wordCount(s.text);
    });

    // speakers: Agent first, then Customer, then anyone else (in order of appearance)
    const rank = (n) => ({ a: 0, c: 1 })[spkClass(n)] ?? 2;
    const names = [...new Set(segs.map((s) => s.speaker))].sort((x, y) => rank(x) - rank(y));
    const spk = names.map((name) => {
      const mine = segs.filter((s) => s.speaker === name);
      return {
        name, cls: spkClass(name), lines: mine.length,
        words: mine.reduce((a, s) => a + s.words, 0),
        talk: mine.reduce((a, s) => a + (s.end - s.start), 0),
      };
    });
    const spkIdx = Object.fromEntries(names.map((n, i) => [n, i]));
    const totalTalk = spk.reduce((a, s) => a + s.talk, 0) || 1;
    const totalWords = spk.reduce((a, s) => a + s.words, 0);
    const turns = segs.filter((s, i) => i === 0 || segs[i - 1].speaker !== s.speaker).length;
    const lang = /bangla|bengali|^bn\b/i.test(d.language || "") ? "bn" : "";
    const L = lang ? ` lang="${lang}"` : "";
    const inp = ctx.input || {};
    const baseName = String(d.file_name || inp.file || (inp.audio_url || "").split("/").pop() || "call")
      .replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[^\wঀ-৿.-]+/g, "_").slice(0, 80) || "call";
    const usage = d.usage || {};

    if (!segs.length) {
      return {
        title: "Call transcript",
        tabs: [{ id: "chat", label: "Conversation", icon: "chat",
          html: `<div class="tx-empty">${icon("captions", 22)}<b>No speech was found in this recording.</b>
            <span class="muted">The audio may be silent, too short or in a format the AI could not read.</span></div>` }],
      };
    }

    // ---------------- header: the deck ----------------
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) =>
      `<span style="left:${k * 100}%">${clock(k * duration)}</span>`).join("");
    const lanes = spk.map((s) => `
      <div class="tx-track spk-${s.cls}">
        ${segs.map((g, i) => g.speaker !== s.name ? "" :
          `<button type="button" class="tx-blk" data-seg="${i}" aria-label="${esc(clock(g.start))} ${esc(s.name)}"
            style="left:${(g.start / duration) * 100}%;width:${((g.end - g.start) / duration) * 100}%"></button>`).join("")}
      </div>`).join("");
    const laneNames = spk.map((s) => `
      <div class="tx-lane-name spk-${s.cls}"><i></i><span>${esc(s.name)}</span><b>${Math.round((s.talk / totalTalk) * 100)}%</b></div>`).join("");

    const cell = (label, value, sub = "") =>
      `<div class="tx-stat"><small>${label}</small><b>${value}</b>${sub ? `<span>${sub}</span>` : ""}</div>`;
    const cost = usage.total_cost_usd;

    const header = `
      <div class="tx-deck" data-deck>
        <div class="tx-deck-top">
          <button type="button" class="tx-play" data-tx-play aria-label="Play / pause">
            <span class="i-play">${icon("play", 15)}</span><span class="i-pause">${icon("pause", 15)}</span>
          </button>
          <div class="tx-clock"><b data-tx-now>00:00</b><span>/ ${clock(duration)}</span></div>
          <div class="tx-deck-tags">
            <span class="tx-pill">${icon("globe", 12)} ${esc(d.language || "Unknown language")}</span>
            <span class="tx-pill">${icon("users", 12)} ${spk.length} speaker${spk.length === 1 ? "" : "s"}</span>
          </div>
          <label class="tx-follow" title="Keep the playing line in view">
            <input type="checkbox" data-tx-follow checked><span class="tx-switch"></span>Follow along
          </label>
        </div>
        <div class="tx-lanes">
          <div class="tx-lane-names">${laneNames}</div>
          <div class="tx-tracks-col">
            <div class="tx-tracks" data-tx-tracks>
              ${lanes}
              <div class="tx-head" data-tx-head></div>
              <div class="tx-tip" data-tx-tip></div>
            </div>
            <div class="tx-ticks">${ticks}</div>
          </div>
        </div>
        <div class="tx-caption" data-tx-caption aria-live="polite"></div>
        <div class="tx-noaudio-note hidden" data-tx-noaudio>${icon("alert", 12)} <span>No playable audio for this result. The timeline still shows who spoke when.</span></div>
      </div>
      <div class="tx-stats">
        ${cell("Call length", clock(duration))}
        ${cell("Speaker turns", turns, `${segs.length} lines`)}
        ${cell("Words", totalWords.toLocaleString())}
        ${cell("Transcribed in", d.processing_seconds != null ? `${Number(d.processing_seconds).toFixed(1)}s` : "-")}
        ${cell("AI cost", cost != null ? `$${Number(cost).toFixed(4)}` : "-", usage.total_tokens ? `${usage.total_tokens.toLocaleString()} tokens` : "")}
      </div>`;

    // ---------------- tab: conversation ----------------
    const chat = `
      <div class="tx-tools">
        <label class="tx-search">${icon("search", 13)}
          <input type="search" placeholder="Search what was said…" data-tx-q aria-label="Search transcript">
          <span class="tx-count" data-tx-count></span>
          <button type="button" class="tx-nav" data-tx-prev title="Previous match (Shift+Enter)">${icon("up", 12)}</button>
          <button type="button" class="tx-nav down" data-tx-next title="Next match (Enter)">${icon("up", 12)}</button>
        </label>
        <div class="tx-filters">${spk.map((s, i) =>
          `<button type="button" class="tx-filter spk-${s.cls} on" data-tx-spk="${i}" title="Show / hide ${esc(s.name)}">
            <i></i>${esc(s.name)}<small>${s.lines}</small></button>`).join("")}</div>
        <div class="tx-size" role="group" aria-label="Text size">
          <button type="button" data-tx-size="-1" title="Smaller text">A<sup>−</sup></button>
          <button type="button" data-tx-size="1" title="Larger text">A<sup>+</sup></button>
        </div>
      </div>
      <div class="tx-chat" data-tx-chat${L}>
        ${segs.map((s, i) => {
          const first = i === 0 || segs[i - 1].speaker !== s.speaker;
          const cls = spkClass(s.speaker);
          return `<div class="tx-msg spk-${cls} ${cls === "c" ? "right" : "left"} ${first ? "first" : ""}" data-i="${i}" data-spk="${spkIdx[s.speaker]}">
            ${first ? `<div class="tx-who"><span class="tx-av">${esc(initials(s.speaker))}</span>${esc(s.speaker)}</div>` : ""}
            <div class="tx-bubble">
              <p data-tx-text>${esc(s.text)}</p>
              <button type="button" class="tx-ts" data-seek="${i}" title="Play from here">${icon("play", 9)}${clock(s.start)}</button>
            </div>
          </div>`;
        }).join("")}
      </div>
      <p class="tx-hint" data-tx-hint>${icon("play", 10)} Click any line to hear that moment of the call.</p>`;

    // ---------------- tab: by speaker ----------------
    const fallbackText = (name) => segs.filter((s) => s.speaker === name).map((s) => `[${clock(s.start)}] ${s.text}`).join("\n");
    const speakerText = (name) => (d.transcript && typeof d.transcript[name.toLowerCase()] === "string" && d.transcript[name.toLowerCase()].trim())
      || fallbackText(name);
    const cols = `
      <div class="tx-cols"${L}>
        ${spk.map((s) => `
          <div class="tx-col spk-${s.cls}">
            <div class="tx-col-head">
              <span class="tx-av lg">${esc(initials(s.name))}</span>
              <div><b>${esc(s.name)}</b><small>${s.lines} lines · ${s.words.toLocaleString()} words · ${clock(s.talk)} talking</small></div>
              <button type="button" class="icon-btn sm" data-copy="${esc(speakerText(s.name))}" title="Copy ${esc(s.name)}'s lines">${icon("copy", 12)}</button>
            </div>
            <div class="tx-share"><i data-w="${Math.round((s.talk / totalTalk) * 100)}%"></i><span>${Math.round((s.talk / totalTalk) * 100)}% of talk time</span></div>
            <ol class="tx-lines">
              ${segs.map((g, i) => g.speaker !== s.name ? "" :
                `<li data-seek="${i}"><time>${clock(g.start)}</time><span>${esc(g.text)}</span></li>`).join("")}
            </ol>
          </div>`).join("")}
      </div>`;

    // ---------------- tab: export ----------------
    const FORMATS = {
      timestamped: { label: "Timestamped", ext: "txt", make: () => segs.map((s) => `[${clock(s.start)}] ${s.speaker}: ${s.text}`).join("\n") },
      plain: { label: "Plain dialogue", ext: "txt", make: () => segs.map((s) => `${s.speaker}: ${s.text}`).join("\n") },
      speaker: { label: "Per speaker", ext: "txt", make: () => spk.map((s) => `${s.name.toUpperCase()}\n${speakerText(s.name)}`).join("\n\n") },
      srt: { label: "Subtitles (.srt)", ext: "srt", make: () => segs.map((s, i) =>
        `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.speaker}: ${s.text}`).join("\n\n") + "\n" },
    };
    const exportHtml = `
      <div class="tx-export">
        <div class="tx-fmts" role="tablist">${Object.entries(FORMATS).map(([k, f], i) =>
          `<button type="button" class="tx-fmt ${i ? "" : "active"}" data-fmt="${k}">${esc(f.label)}</button>`).join("")}</div>
        <div class="tx-paper">
          <div class="tx-paper-head">
            <span>${icon("file", 12)} <b data-tx-fname></b></span>
            <span class="muted" data-tx-fsize></span>
          </div>
          <pre data-tx-preview${L}></pre>
        </div>
        <div class="tx-export-actions">
          <button type="button" class="btn btn-primary btn-sm" data-tx-dl>${icon("download", 12)} Download</button>
          <button type="button" class="btn btn-outline btn-sm" data-tx-copy>${icon("copy", 12)} Copy text</button>
        </div>
      </div>`;

    // ---------------- footer: usage ----------------
    let footer = "";
    if (usage.total_tokens) {
      const parts = [
        ["Audio in", usage.audio_input_tokens || 0, "#8b7cf6"],
        ["Text in", usage.text_input_tokens || 0, "#c4b9fb"],
        ["Output", usage.output_tokens || 0, "#f0a27f"],
      ];
      const tot = parts.reduce((a, p) => a + p[1], 0) || 1;
      footer = `<details class="expander">
        <summary>${icon("chevron", 12)} ${icon("cpu", 12)} Model &amp; usage <span class="muted">· ${esc(usage.total_tokens.toLocaleString())} tokens${cost != null ? ` · $${Number(cost).toFixed(4)}` : ""}</span></summary>
        <div class="token-body">
          <div class="split-bar">${parts.map((p) => `<i style="width:${(p[1] / tot) * 100}%;background:${p[2]}"></i>`).join("")}</div>
          <div class="token-grid">
            ${parts.map((p) => `<div><small><i class="sw" style="background:${p[2]}"></i>${p[0]}</small><b>${p[1].toLocaleString()}</b></div>`).join("")}
            <div><small>Total</small><b>${usage.total_tokens.toLocaleString()}</b></div>
          </div>
          <p class="tx-model muted small">${icon("cpu", 11)} ${esc(d.model || "-")}${d.mime_type ? ` · ${esc(d.mime_type)}` : ""}${d.size_bytes ? ` · ${esc(UI.fmtBytes(d.size_bytes))}` : ""}${usage.model_calls ? ` · ${usage.model_calls} model call${usage.model_calls === 1 ? "" : "s"}` : ""}</p>
        </div>
      </details>`;
    }

    return {
      title: "Call transcript",
      header,
      footer,
      tabs: [
        { id: "chat", label: "Conversation", icon: "chat", html: chat },
        { id: "speakers", label: "By speaker", icon: "users", html: cols },
        { id: "export", label: "Export", icon: "download", html: exportHtml },
      ],
      onMount(root, c) {
        const audio = c.audio;
        const $ = (sel) => root.querySelector(sel);
        const deck = $("[data-deck]"), chatEl = $("[data-tx-chat]"), tracks = $("[data-tx-tracks]");
        const headEl = $("[data-tx-head]"), nowEl = $("[data-tx-now]"), cap = $("[data-tx-caption]"), tip = $("[data-tx-tip]");
        const follow = $("[data-tx-follow]"), playBtn = $("[data-tx-play]");
        const msgs = [...chatEl.querySelectorAll(".tx-msg")];
        const blkAt = {};
        root.querySelectorAll(".tx-blk").forEach((b) => { blkAt[b.dataset.seg] = b; });
        const lineAt = {};
        root.querySelectorAll(".tx-lines li").forEach((li) => { lineAt[li.dataset.seek] = li; });

        const hasAudio = () => !!(audio && audio.getAttribute("src"));
        const setAudioState = () => {
          const ok = hasAudio();
          root.classList.toggle("tx-silent", !ok);
          playBtn.disabled = !ok;
          $("[data-tx-noaudio]").classList.toggle("hidden", ok);
          $("[data-tx-hint]").classList.toggle("hidden", !ok);
        };
        setAudioState();

        // -- caption under the lanes
        function showCaption(i, idle = false) {
          const s = segs[i];
          if (!s) return;
          cap.innerHTML = `<span class="tx-cap-who spk-${spkClass(s.speaker)}">${esc(s.speaker)}<small>${clock(s.start)}</small></span>
            <p${L}>${esc(s.text)}</p>${idle && hasAudio() ? `<em>Press play to follow along</em>` : ""}`;
          cap.classList.toggle("idle", idle);
          cap.classList.remove("swap"); void cap.offsetWidth; cap.classList.add("swap");
        }
        showCaption(0, true);

        // -- scrolling inside the chat box (never the whole page)
        function scrollChat(el, smooth = true) {
          if (!el || chatEl.closest(".tab-panel").classList.contains("hidden")) return;
          const top = el.offsetTop - chatEl.clientHeight / 2 + el.offsetHeight / 2;
          chatEl.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
        }
        function flash(el) { if (!el) return; el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); }

        // -- playback sync
        let active = -1;
        const segAt = (t) => {
          for (let i = segs.length - 1; i >= 0; i--) if (t >= segs[i].start) return t < segs[i].end + 0.25 ? i : -1;
          return -1;
        };
        function setActive(i, scroll) {
          if (i === active) return;
          [msgs[active], blkAt[active], lineAt[active]].forEach((el) => el?.classList.remove("live"));
          active = i;
          if (i < 0) return;
          [msgs[i], blkAt[i], lineAt[i]].forEach((el) => el?.classList.add("live"));
          showCaption(i);
          if (scroll && follow.checked && !msgs[i].classList.contains("hidden")) scrollChat(msgs[i]);
        }
        function sync(scroll = true) {
          if (!root.isConnected) return false;
          const t = audio ? audio.currentTime : 0;
          headEl.style.left = `${Math.min(100, (t / duration) * 100)}%`;
          deck.classList.toggle("started", t > 0);
          nowEl.textContent = clock(t);
          if (t > 0 || !audio.paused) setActive(segAt(t), scroll);
          return true;
        }
        let raf = 0;
        const loop = () => { if (sync()) raf = requestAnimationFrame(loop); };
        if (audio) {
          // property handlers (not addEventListener) so a re-render replaces them instead of stacking
          audio.onplay = () => { if (!root.isConnected) return; deck.classList.add("playing"); cancelAnimationFrame(raf); loop(); };
          audio.onpause = audio.onended = () => { cancelAnimationFrame(raf); if (root.isConnected) { deck.classList.remove("playing"); sync(false); } };
          audio.onseeked = () => sync();
          audio.onloadedmetadata = audio.onemptied = () => { if (root.isConnected) setAudioState(); };
          audio.onerror = () => {
            if (!root.isConnected || !audio.getAttribute("src")) return;
            playBtn.disabled = true;
            const note = $("[data-tx-noaudio]");
            note.querySelector("span").textContent = "The audio could not be loaded in the browser (the link may block playback). The transcript is still complete.";
            note.classList.remove("hidden");
          };
          if (audio.currentTime > 0) sync(false);
          if (!audio.paused) audio.onplay();
        }

        function playFrom(i) {
          if (!hasAudio()) return false;
          audio.currentTime = segs[i].start;
          audio.play().catch(() => UI.toast("The audio could not be played", "error"));
          return true;
        }
        playBtn.addEventListener("click", () => {
          if (!hasAudio()) return;
          if (audio.paused) audio.play().catch(() => UI.toast("The audio could not be played", "error"));
          else audio.pause();
        });

        // -- timeline: hover preview + click to jump
        const pos = (e) => { const r = tracks.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), w: r.width }; };
        tracks.addEventListener("mousemove", (e) => {
          const { x, w } = pos(e);
          const b = e.target.closest(".tx-blk"), s = b && segs[+b.dataset.seg];
          tip.innerHTML = s
            ? `<b class="spk-${spkClass(s.speaker)}">${esc(s.speaker)} · ${clock(s.start)}</b><span${L}>${esc(shorten(s.text))}</span>`
            : `<b>${clock(x * duration)}</b>`;
          tip.style.left = `${Math.min(w - 110, Math.max(110, x * w))}px`;
          tip.classList.add("show");
        });
        tracks.addEventListener("mouseleave", () => tip.classList.remove("show"));
        tracks.addEventListener("click", (e) => {
          const b = e.target.closest(".tx-blk");
          if (b) {
            const i = +b.dataset.seg;
            c.switchTab("chat");
            if (msgs[i].classList.contains("hidden")) { root.querySelector(`[data-tx-spk="${msgs[i].dataset.spk}"]`)?.click(); }
            scrollChat(msgs[i]);
            flash(msgs[i]);
            playFrom(i);
            return;
          }
          if (!hasAudio()) return;
          audio.currentTime = pos(e).x * duration;
          sync();
        });

        // -- click a line (chat or speaker column) to play from there
        const lineClick = (e) => {
          if (window.getSelection()?.toString()) return;          // user is selecting text to copy
          const el = e.target.closest("[data-seek], .tx-msg");
          if (!el) return;
          const i = +(el.dataset.seek ?? el.dataset.i);
          if (!playFrom(i)) flash(el.closest(".tx-msg") || el);
        };
        chatEl.addEventListener("click", lineClick);
        root.querySelector(".tx-cols").addEventListener("click", lineClick);

        // -- search
        const q = $("[data-tx-q]"), countEl = $("[data-tx-count]");
        let hits = [], cur = -1, qTimer = null;
        function runSearch() {
          const term = q.value.trim();
          msgs.forEach((m, i) => {
            const r = markText(segs[i].text, term);
            m.querySelector("[data-tx-text]").innerHTML = r.html;
            m.classList.toggle("dim", !!term && !r.n);
          });
          hits = [...chatEl.querySelectorAll(".tx-msg:not(.hidden) mark.tx-hit")];
          cur = hits.length ? 0 : -1;
          showHit();
        }
        function showHit() {
          const term = q.value.trim();
          hits.forEach((h, k) => h.classList.toggle("cur", k === cur));
          countEl.textContent = term ? (hits.length ? `${cur + 1} / ${hits.length}` : "No match") : "";
          countEl.classList.toggle("none", !!term && !hits.length);
          if (cur >= 0) scrollChat(hits[cur].closest(".tx-msg"));
        }
        const step = (dir) => { if (!hits.length) return; cur = (cur + dir + hits.length) % hits.length; showHit(); };
        q.addEventListener("input", () => { clearTimeout(qTimer); qTimer = setTimeout(runSearch, 120); });
        q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); clearTimeout(qTimer); if (!hits.length) runSearch(); else step(e.shiftKey ? -1 : 1); } });
        $("[data-tx-prev]").addEventListener("click", () => step(-1));
        $("[data-tx-next]").addEventListener("click", () => step(1));

        // -- speaker filters
        root.querySelectorAll("[data-tx-spk]").forEach((b) => b.addEventListener("click", () => {
          const on = !b.classList.contains("on");
          if (!on && root.querySelectorAll("[data-tx-spk].on").length === 1) return UI.toast("At least one speaker has to stay visible");
          b.classList.toggle("on", on);
          msgs.forEach((m) => { if (m.dataset.spk === b.dataset.txSpk) m.classList.toggle("hidden", !on); });
          runSearch();
        }));

        // -- text size
        let size = 1;
        root.querySelectorAll("[data-tx-size]").forEach((b) => b.addEventListener("click", () => {
          size = Math.min(TX_SIZES.length - 1, Math.max(0, size + Number(b.dataset.txSize)));
          chatEl.style.setProperty("--tx-fs", `${TX_SIZES[size]}px`);
          root.querySelector('[data-tx-size="-1"]').disabled = size === 0;
          root.querySelector('[data-tx-size="1"]').disabled = size === TX_SIZES.length - 1;
        }));

        // -- export
        let fmt = "timestamped";
        const preview = $("[data-tx-preview]");
        const fileName = () => `${baseName}-transcript.${FORMATS[fmt].ext}`;
        function renderExport() {
          const text = FORMATS[fmt].make();
          preview.textContent = text;
          $("[data-tx-fname]").textContent = fileName();
          $("[data-tx-fsize]").textContent = `${text.split("\n").length} lines · ${UI.fmtBytes(new Blob([text]).size)}`;
          root.querySelectorAll(".tx-fmt").forEach((b) => b.classList.toggle("active", b.dataset.fmt === fmt));
        }
        root.querySelectorAll(".tx-fmt").forEach((b) => b.addEventListener("click", () => { fmt = b.dataset.fmt; renderExport(); }));
        $("[data-tx-copy]").addEventListener("click", () => UI.copy(FORMATS[fmt].make()));
        $("[data-tx-dl]").addEventListener("click", () => UI.download(fileName(), FORMATS[fmt].make(), "text/plain;charset=utf-8"));
        renderExport();
      },
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

  // Used when no renderer exists or the response shape is unexpected.
  Renderers.fallback = (d) => ({
    title: "Result",
    tabs: [{ id: "result", label: "Result", html: `<pre class="json-view">${esc(JSON.stringify(d, null, 2))}</pre>` }],
  });

  window.Renderers = Renderers;
})();
