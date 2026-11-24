/* Lead Finder AI: result view (radar overview, lead board, call table, signals, call drawer).
 * Response contract: api_docs/lead_finder.md. Also exposes window.LeadKit for lead_input.js. */
(function () {
  "use strict";
  const { esc, icon } = window.UI;

  // ---------- Shared helpers (also used by the live progress board) ----------
  const QUALITY = {
    strong: { label: "Strong lead", short: "Strong" },
    potential: { label: "Potential lead", short: "Potential" },
    weak: { label: "Weak interest", short: "Weak" },
    not: { label: "Not a lead", short: "Not a lead" },
    failed: { label: "Failed", short: "Failed" },
  };
  const ORDER = ["strong", "potential", "weak", "not", "failed"];
  const SUMMARY_KEY = { strong: "strong_leads", potential: "potential_lead_quality", weak: "weak_interest", not: "not_a_lead" };

  const isOk = (r) => String(r.status || "success").toLowerCase() === "success";
  function qualityKey(r) {
    if (!isOk(r)) return "failed";
    const q = String(r.lead_quality || "").toLowerCase();
    if (q.includes("strong")) return "strong";
    if (q.includes("weak")) return "weak";
    if (q.includes("not")) return "not";
    if (q.includes("potential")) return "potential";
    return r.is_potential_lead ? "potential" : "not";
  }
  const isLead = (r) => isOk(r) && (r.is_potential_lead === true || ["strong", "potential"].includes(qualityKey(r)));

  // Same rules as app/services/leads.py (summarize / merge).
  function summarize(results, criteria) {
    const ok = results.filter(isOk);
    const s = {
      criteria_used: criteria ?? null, total_calls: results.length, analyzed: ok.length,
      failed: results.length - ok.length, potential_leads: ok.filter((r) => r.is_potential_lead).length,
      strong_leads: 0, potential_lead_quality: 0, weak_interest: 0, not_a_lead: 0,
      total_tokens_used: results.reduce((n, r) => n + (Number(r.tokens_used) || 0), 0),
    };
    ok.forEach((r) => { const k = SUMMARY_KEY[qualityKey(r)]; if (k) s[k]++; });
    return s;
  }
  function mergeChunk(base, chunk) {
    const byIndex = new Map();
    [...(base?.results || []), ...(chunk?.results || [])].forEach((r) => byIndex.set(r.index, r));
    const results = [...byIndex.keys()].sort((a, b) => a - b).map((k) => byIndex.get(k));
    const criteria = chunk?.summary?.criteria_used || base?.summary?.criteria_used;
    return { summary: summarize(results, criteria), leads: results.filter((r) => isOk(r) && r.is_potential_lead), results };
  }

  // "20260615-101255_FEDEX_TN_FEDEX_IMPORT_bijoy_8801923430572-all.mp3" -> date, agent, phone
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function callMeta(source) {
    const raw = String(source || "");
    let name = raw, host = "";
    if (/^https?:\/\//i.test(raw)) {
      try {
        const u = new URL(raw);
        host = u.host;
        const last = u.pathname.split("/").filter(Boolean).pop();
        try { name = last ? decodeURIComponent(last) : u.host; } catch { name = last || u.host; }
      } catch { /* keep raw */ }
    }
    const base = name.replace(/\.[a-z0-9]{2,5}$/i, "");
    const meta = { name, host, isUrl: !!host };
    const dm = base.match(/(20\d{2})(\d{2})(\d{2})[-_ ]?(\d{2})(\d{2})(\d{2})?/);
    if (dm && +dm[2] >= 1 && +dm[2] <= 12) meta.date = `${+dm[3]} ${MONTHS[+dm[2] - 1]}, ${dm[4]}:${dm[5]}`;
    const tokens = base.split(/[_\s]+/);
    const pi = tokens.findIndex((t) => /^\+?\d{10,14}(-[a-z]+)?$/i.test(t));
    if (pi >= 0) {
      meta.phone = tokens[pi].replace(/-[a-z]+$/i, "");
      const agent = tokens[pi - 1];
      if (agent && /^[a-z][a-z.]{1,24}$/.test(agent)) meta.agent = agent[0].toUpperCase() + agent.slice(1);
    }
    return meta;
  }

  window.LeadKit = { QUALITY, ORDER, qualityKey, isLead, isOk, summarize, mergeChunk, callMeta };

  // ---------- Small view pieces ----------
  const chip = (text, cls = "", attrs = "") => `<span class="lf-chip ${cls}" ${attrs}>${esc(text)}</span>`;
  const kwChips = (list, max = 99) => {
    const items = (list || []).filter(Boolean);
    if (!items.length) return "";
    const shown = items.slice(0, max).map((k) => `<button type="button" class="lf-chip kw" data-kw="${esc(k)}" title="Show calls with “${esc(k)}”">${esc(k)}</button>`).join("");
    return shown + (items.length > max ? `<span class="lf-chip more">+${items.length - max}</span>` : "");
  };
  const metaLine = (m) => [
    m.date && `${icon("clock", 11)} ${esc(m.date)}`,
    m.agent && `${icon("users", 11)} ${esc(m.agent)}`,
    m.phone && `${icon("phone", 11)} ${esc(m.phone)}`,
    m.isUrl && !m.date && `${icon("link", 11)} ${esc(m.host)}`,
  ].filter(Boolean).map((x) => `<span>${x}</span>`).join("");
  const playBtn = (r, size = 12) => `<button type="button" class="lf-play" data-play="${r._i}" ${r._audio ? "" : "disabled"}
      title="${r._audio ? "Play recording" : "Recording not available"}" aria-label="Play recording">
      <span class="i-play">${icon("play", size)}</span><span class="i-pause">${icon("pause", size)}</span></button>`;
  const qBadge = (k) => `<span class="lf-q q-${k}"><i></i>${esc(QUALITY[k].label)}</span>`;
  const conf = (r) => (isOk(r) ? Math.max(0, Math.min(100, Math.round(Number(r.confidence_score) || 0))) : 0);

  function radar(rows) {
    const BANDS = { strong: [10, 40], potential: [46, 70], weak: [76, 94], not: [100, 116], failed: [100, 116] };
    const n = rows.length, rad = n <= 40 ? 5 : n <= 150 ? 3.6 : n <= 400 ? 2.6 : 1.9;
    const blips = rows.map((r, k) => {
      const [a, b] = BANDS[r._q];
      const dist = a + (1 - conf(r) / 100) * (b - a) * 0.9 + ((k * 7) % 5) * (b - a) * 0.02;
      const ang = (k * 137.508 + 12) * Math.PI / 180;
      const x = (Math.sin(ang) * dist).toFixed(1), y = (-Math.cos(ang) * dist).toFixed(1);
      const pulse = (r._q === "strong" || r._q === "potential") && n <= 60;
      return `${pulse ? `<circle class="lf-pulse q-${r._q}" cx="${x}" cy="${y}" r="${rad}"/>` : ""}
        <circle class="lf-blip q-${r._q}" cx="${x}" cy="${y}" r="${rad}" data-i="${r._i}" tabindex="-1"/>`;
    }).join("");
    const ring = (r, k, label) => `<circle class="lf-ring ring-${k}" r="${r}"/>${label ? `<text class="lf-ring-lbl" x="0" y="${-r + 9}">${label}</text>` : ""}`;
    return `<svg class="lf-radar" viewBox="-124 -124 248 248" role="img" aria-label="Radar of all calls: leads closest to the centre">
      <defs><linearGradient id="lfSweep" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="var(--lf-accent)" stop-opacity="0"/><stop offset="1" stop-color="var(--lf-accent)" stop-opacity=".28"/></linearGradient></defs>
      <circle class="lf-disc" r="120"/>
      ${ring(118, "not", "NOT A LEAD")}${ring(96, "weak", "WEAK")}${ring(73, "pot", "POTENTIAL")}${ring(43, "str", "STRONG")}
      <path class="lf-cross" d="M-120 0H120M0 -120V120"/>
      <g class="lf-sweep"><path d="M0 0 L0 -120 A120 120 0 0 1 84.85 -84.85 Z" fill="url(#lfSweep)"/></g>
      ${blips}
    </svg>`;
  }

  const BOARD_LIMIT = 60, PAGE = 50;

  // ======================================================================
  window.Renderers["lead-finder"] = (d, ctx) => {
    const payload = ctx.payload || {};
    const audioByIndex = new Map((payload.sources || []).filter((s) => s.url).map((s) => [s.index, s.url]));
    const rows = (Array.isArray(d.results) ? d.results : []).filter((r) => r && typeof r === "object").map((r, pos) => {
      const i = Number.isInteger(r.index) ? r.index : pos;
      return { ...r, _i: i, _q: qualityKey(r), _m: callMeta(r.source), _audio: audioByIndex.get(i) || null };
    });
    const byI = new Map(rows.map((r) => [r._i, r]));
    const s = summarize(rows, d.summary?.criteria_used);
    const total = rows.length, leads = rows.filter(isLead);
    const counts = Object.fromEntries(ORDER.map((k) => [k, rows.filter((r) => r._q === k).length]));
    const planned = Math.max(payload.planned || 0, total);
    const rate = s.analyzed ? Math.round((leads.length / s.analyzed) * 100) : 0;
    const isDefault = String(s.criteria_used || "").startsWith("default");
    const input = ctx.input || {};
    const best = [...rows].sort((a, b) => ORDER.indexOf(a._q) - ORDER.indexOf(b._q) || conf(b) - conf(a) || a._i - b._i);
    const pos = (r) => `${r._i + 1}`;

    // ---- header: radar + headline numbers
    const pct = (v) => (total ? Math.max(v ? 2 : 0, Math.round((v / total) * 100)) : 0);
    const funnel = [
      ["Calls scanned", total, "all"], ["Analyzed", s.analyzed, "ok"], ["Leads", leads.length, "lead"], ["Strong leads", counts.strong, "strong"],
    ].map(([label, v, k]) => `<div class="lf-fun-row f-${k}"><span>${label}</span><div class="lf-fun-bar"><i data-w="${pct(v)}%"></i></div><b>${v.toLocaleString()}</b></div>`).join("");
    const stack = ORDER.filter((k) => counts[k]).map((k) =>
      `<button type="button" class="q-${k}" style="flex:${counts[k]}" data-filter="${k}" title="${esc(QUALITY[k].label)}: ${counts[k]}"></button>`).join("");
    const legend = ORDER.filter((k) => k !== "failed" || counts.failed).map((k) =>
      `<button type="button" class="lf-leg q-${k}" data-filter="${k}"><i></i>${esc(QUALITY[k].short)}<b>${counts[k]}</b></button>`).join("");
    const header = `
      <div class="lf-hero">
        <div class="lf-radar-wrap" data-radar>${radar(rows)}<div class="lf-tip hidden" data-tip></div></div>
        <div class="lf-hero-main">
          <div class="lf-kicker">
            <span class="lf-pill ${isDefault ? "" : "custom"}">${icon(isDefault ? "package" : "tag", 11)} ${isDefault ? "Default FedEx criteria" : "Your lead criteria"}</span>
            ${planned > total ? `<span class="lf-pill warn">${icon("alert", 11)} Stopped early: ${total} of ${planned} calls</span>` : ""}
          </div>
          <div class="lf-big">
            <b data-count="${leads.length}">${leads.length}</b>
            <span>${leads.length === 1 ? "lead" : "leads"} found<small>in ${total.toLocaleString()} call${total === 1 ? "" : "s"} · ${rate}% of analyzed calls</small></span>
          </div>
          <div class="lf-funnel">${funnel}</div>
          <div class="lf-stack" aria-label="Results by lead quality">${stack}</div>
          <div class="lf-legend">${legend}</div>
        </div>
      </div>`;

    // ---- tab 1: lead board
    const card = (r) => `
      <article class="lf-card q-${r._q}" data-open="${r._i}" tabindex="0">
        <div class="lf-card-top">
          <span class="lf-num">#${pos(r)}</span>
          <span class="lf-card-name" title="${esc(r._m.name)}">${esc(r._m.name)}</span>
          ${playBtn(r)}
        </div>
        ${metaLine(r._m) ? `<div class="lf-meta">${metaLine(r._m)}</div>` : ""}
        ${r._q === "failed"
          ? `<p class="lf-card-text err">${esc(r.error || "Could not analyze this call")}</p>`
          : `<p class="lf-card-text">${esc(r.customer_intent || r.call_summary || "")}</p>
             <div class="lf-card-foot"><div class="lf-confbar" title="Confidence ${conf(r)}%"><i data-w="${conf(r)}%"></i></div><small>${conf(r)}%</small></div>
             ${(r.keywords_matched || []).length ? `<div class="lf-chips">${kwChips(r.keywords_matched, 3)}</div>` : ""}`}
      </article>`;
    const board = `<div class="lf-board">${ORDER.filter((k) => k !== "failed" || counts.failed).map((k) => {
      const list = best.filter((r) => r._q === k);
      return `<section class="lf-col q-${k}">
        <header><i></i>${esc(QUALITY[k].label)}<b>${list.length}</b></header>
        <div class="lf-col-body">${list.slice(0, BOARD_LIMIT).map(card).join("") || `<p class="lf-col-empty">No calls here</p>`}
          ${list.length > BOARD_LIMIT ? `<button type="button" class="lf-col-more" data-filter="${k}">+ ${list.length - BOARD_LIMIT} more in All calls</button>` : ""}
        </div></section>`;
    }).join("")}</div>
    ${leads.length ? "" : `<div class="lf-noleads">${icon("info", 14)}<div><b>No leads in this batch.</b> ${isDefault
      ? "These calls were judged against the default FedEx profile. If your calls are about a different business, describe it under <i>What counts as a lead?</i> and run again."
      : "Try adding more keywords or loosening the business context."}</div></div>`}`;

    // ---- tab 2: all calls
    const segs = [["all", "All", total], ["lead", "Leads", leads.length], ...ORDER.filter((k) => k !== "failed" || counts.failed).map((k) => [k, QUALITY[k].short, counts[k]])];
    const calls = `
      <div class="lf-tools">
        <label class="lf-search">${icon("search", 13)}<input type="search" data-q placeholder="Search name, phone, keyword, summary…" aria-label="Search calls"></label>
        <select class="input lf-sort" data-sort aria-label="Sort">
          <option value="best">Best leads first</option><option value="conf">Highest confidence</option><option value="order">Call order</option>
        </select>
        <div class="lf-tool-btns">
          <button type="button" class="btn btn-outline btn-sm" data-csv>${icon("download", 12)} CSV</button>
          ${leads.length ? `<button type="button" class="btn btn-outline btn-sm" data-copy-leads>${icon("copy", 12)} Copy leads</button>` : ""}
        </div>
      </div>
      <div class="lf-seg" role="tablist">${segs.map(([k, label, n], i) =>
        `<button type="button" class="${i ? "" : "active"} ${k !== "all" && k !== "lead" ? `q-${k}` : ""}" data-seg="${k}">${k !== "all" && k !== "lead" ? "<i></i>" : ""}${esc(label)} <b>${n}</b></button>`).join("")}</div>
      <div class="lf-table-wrap"><table class="lf-table">
        <thead><tr><th>#</th><th>Call</th><th>Result</th><th class="hide-sm">Customer intent</th><th></th></tr></thead>
        <tbody data-tbody></tbody>
      </table></div>
      <div class="lf-more-row"><small class="muted" data-shown></small><button type="button" class="btn btn-outline btn-sm hidden" data-more>Show more</button></div>`;

    // ---- tab 3: signals
    const tally = (pick, onlyLeads) => {
      const m = new Map();
      rows.filter((r) => isOk(r) && (!onlyLeads || r._q !== "not")).forEach((r) =>
        new Set((pick(r) || []).map((x) => String(x).trim()).filter(Boolean)).forEach((x) => m.set(x, (m.get(x) || 0) + 1)));
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const kwT = tally((r) => r.keywords_matched), sigT = tally((r) => r.other_lead_signals);
    const kwMax = kwT[0]?.[1] || 1;
    const needs = best.filter((r) => isOk(r) && r._q !== "not" && (r.business_requirements || []).length).slice(0, 40);
    const wantedKw = String(input.lead_keywords || "").split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
    const failedRows = rows.filter((r) => r._q === "failed");
    const signals = `<div class="lf-sig-grid">
      <div class="box"><div class="box-head"><h4>${icon("tag", 13)} Keywords heard</h4><small class="muted">calls that mention each</small></div>
        ${kwT.length ? `<div class="lf-kwbars">${kwT.slice(0, 15).map(([k, n]) =>
          `<button type="button" class="lf-kwbar" data-kw="${esc(k)}"><span>${esc(k)}</span><div><i data-w="${Math.round((n / kwMax) * 100)}%"></i></div><b>${n}</b></button>`).join("")}</div>`
          : `<p class="empty-note">No lead keywords were heard in these calls.</p>`}
        ${wantedKw.length ? `<div class="lf-kw-miss"><small class="muted">Never heard:</small> ${wantedKw.filter((k) => !kwT.some(([x]) => x.toLowerCase() === k.toLowerCase())).map((k) => chip(k, "off")).join("") || `<small class="muted">every keyword was heard at least once</small>`}</div>` : ""}
      </div>
      <div class="box"><div class="box-head"><h4>${icon("sparkles", 13)} Other buying signals</h4></div>
        ${sigT.length ? `<ul class="lf-siglist">${sigT.slice(0, 15).map(([k, n]) => `<li><span>${esc(k)}</span>${n > 1 ? `<b>×${n}</b>` : ""}</li>`).join("")}</ul>`
          : `<p class="empty-note">No other signals found.</p>`}
      </div>
      <div class="box lf-span2"><div class="box-head"><h4>${icon("chat", 13)} What customers asked for</h4><small class="muted">from leads and interested callers</small></div>
        ${needs.length ? `<div class="lf-needs">${needs.map((r) => `
          <div class="lf-need"><button type="button" class="lf-need-call q-${r._q}" data-open="${r._i}" title="${esc(r._m.name)}"><i></i>#${pos(r)}</button>
            <ul>${r.business_requirements.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`).join("")}</div>`
          : `<p class="empty-note">No specific requirements were captured.</p>`}
      </div>
      <div class="box"><div class="box-head"><h4>${icon("target", 13)} Lead criteria used</h4></div>
        ${isDefault && !wantedKw.length && !input.business_context
          ? `<p class="small">No criteria were given, so the AI used its built-in <b>FedEx</b> profile: callers who want new shipping services count as leads, existing-shipment queries don't.</p>`
          : `${wantedKw.length ? `<div class="lf-chips">${wantedKw.map((k) => chip(k, "kwin")).join("")}</div>` : ""}
             ${input.business_context ? `<div class="lf-crit"><small>Business</small><p>${esc(input.business_context)}</p></div>` : ""}
             ${input.not_a_lead_criteria ? `<div class="lf-crit"><small>Not a lead</small><p>${esc(input.not_a_lead_criteria)}</p></div>` : ""}`}
      </div>
      <div class="box"><div class="box-head"><h4>${icon("cpu", 13)} Processing</h4></div>
        <div class="lf-stats">
          <div><small>Analyzed</small><b>${s.analyzed.toLocaleString()}</b></div>
          <div><small>Failed</small><b class="${s.failed ? "red" : ""}">${s.failed}</b></div>
          <div><small>Tokens</small><b>${s.total_tokens_used.toLocaleString()}</b></div>
          <div><small>Avg / call</small><b>${s.analyzed ? Math.round(s.total_tokens_used / s.analyzed).toLocaleString() : "-"}</b></div>
        </div>
        ${failedRows.length ? `<div class="lf-fails">${failedRows.slice(0, 8).map((r) => `<button type="button" data-open="${r._i}"><b>#${pos(r)}</b> ${esc(r._m.name)}<small>${esc(r.error || "")}</small></button>`).join("")}</div>` : ""}
      </div>
    </div>`;

    const footer = `<div class="tx-foot lf-foot">${icon("cpu", 12)} ${s.total_tokens_used.toLocaleString()} tokens · ${s.analyzed} analyzed${s.failed ? ` · ${s.failed} failed` : ""}${planned > total ? ` · ${planned - total} not scanned (stopped)` : ""}</div>`;

    return {
      title: leads.length ? `${leads.length} lead${leads.length === 1 ? "" : "s"} in ${total} call${total === 1 ? "" : "s"}` : `No leads in ${total} call${total === 1 ? "" : "s"}`,
      header,
      footer,
      tabs: [
        { id: "board", label: "Lead board", icon: "target", html: board },
        { id: "calls", label: `All calls (${total})`, icon: "file", html: calls },
        { id: "signals", label: "Signals", icon: "sparkles", html: signals },
      ],
      onMount(root, { switchTab }) { mount(root, switchTab, { rows, byI, best, leads }); },
    };
  };

  // ---------- Behaviour ----------
  let audio = null;                       // one player for the whole result
  function mount(root, switchTab, { rows, byI, best, leads }) {
    if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
    audio = new Audio();
    audio.preload = "none";
    let playing = null;                   // index of the call loaded in the player

    // ---- audio
    const btns = (i) => root.querySelectorAll(`[data-play="${i}"]`);
    function paint() {
      root.querySelectorAll(".lf-play.on").forEach((b) => { if (+b.dataset.play !== playing || audio.paused) b.classList.remove("on"); });
      if (playing == null) return;
      const p = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
      btns(playing).forEach((b) => { b.classList.toggle("on", !audio.paused); b.style.setProperty("--p", p.toFixed(1)); });
      const mini = root.querySelector(`[data-mini="${playing}"]`);
      if (mini) {
        mini.querySelector("[data-mini-bar]").style.width = `${p}%`;
        mini.querySelector("[data-mini-time]").textContent = `${UI.fmtTime(audio.currentTime)} / ${audio.duration ? UI.fmtTime(audio.duration) : "–:––"}`;
      }
    }
    audio.ontimeupdate = paint; audio.onplay = paint; audio.onpause = paint; audio.onloadedmetadata = paint;
    audio.onended = () => { paint(); };
    audio.onerror = () => {
      if (playing == null || !audio.getAttribute("src")) return;
      btns(playing).forEach((b) => { b.classList.remove("on"); b.classList.add("err"); b.title = "This recording can't be played in the browser"; });
      UI.toast("This recording can't be played in the browser (the link may block it)", "error");
      playing = null;
    };
    function toggle(i) {
      const r = byI.get(i);
      if (!r?._audio) return;
      if (playing === i) { audio.paused ? audio.play().catch(() => {}) : audio.pause(); return; }
      if (playing != null) btns(playing).forEach((b) => { b.classList.remove("on"); b.style.removeProperty("--p"); });
      playing = i;
      audio.src = r._audio;
      audio.play().catch(() => {});
    }

    // ---- radar tooltip
    const wrap = root.querySelector("[data-radar]"), tip = root.querySelector("[data-tip]");
    wrap?.addEventListener("mouseover", (e) => {
      const b = e.target.closest(".lf-blip");
      if (!b) return;
      const r = byI.get(+b.dataset.i);
      tip.innerHTML = `<b>#${r._i + 1} ${esc(r._m.name)}</b><span class="lf-q q-${r._q}"><i></i>${esc(QUALITY[r._q].label)}${r._q !== "failed" ? ` · ${conf(r)}%` : ""}</span>`;
      const wr = wrap.getBoundingClientRect(), br = b.getBoundingClientRect();
      tip.style.left = `${br.left - wr.left + br.width / 2}px`;
      tip.style.top = `${br.top - wr.top}px`;
      tip.classList.remove("hidden");
    });
    wrap?.addEventListener("mouseout", (e) => { if (e.target.closest(".lf-blip")) tip.classList.add("hidden"); });

    // ---- all-calls table
    const T = { q: "", seg: "all", sort: "best", limit: PAGE };
    const tbody = root.querySelector("[data-tbody]");
    const hay = new Map(rows.map((r) => [r._i, [r._m.name, r.source, r._m.phone, r._m.agent, r.customer_intent, r.call_summary,
      r.justification, r.error, ...(r.keywords_matched || []), ...(r.other_lead_signals || []), ...(r.business_requirements || [])]
      .filter(Boolean).join(" \n").toLowerCase()]));
    function filtered() {
      let list = T.sort === "order" ? [...rows].sort((a, b) => a._i - b._i)
        : T.sort === "conf" ? [...rows].sort((a, b) => conf(b) - conf(a) || a._i - b._i) : best;
      if (T.seg === "lead") list = list.filter(isLead);
      else if (T.seg !== "all") list = list.filter((r) => r._q === T.seg);
      const q = T.q.toLowerCase();
      if (q) list = list.filter((r) => hay.get(r._i).includes(q));
      return list;
    }
    function renderTable() {
      const list = filtered();
      tbody.innerHTML = list.slice(0, T.limit).map((r) => `
        <tr data-open="${r._i}" class="q-${r._q}" tabindex="0">
          <td class="lf-td-num">${r._i + 1}</td>
          <td class="lf-td-call"><div class="lf-td-name" title="${esc(r._m.name)}">${esc(r._m.name)}</div>${metaLine(r._m) ? `<div class="lf-meta">${metaLine(r._m)}</div>` : ""}</td>
          <td class="lf-td-res">${qBadge(r._q)}${r._q !== "failed" ? `<div class="lf-confbar sm"><i style="width:${conf(r)}%"></i></div><small class="muted">${conf(r)}% sure</small>` : ""}</td>
          <td class="hide-sm lf-td-intent">${esc(r._q === "failed" ? r.error || "" : r.customer_intent || "")}
            ${(r.keywords_matched || []).length ? `<div class="lf-chips">${kwChips(r.keywords_matched, 4)}</div>` : ""}</td>
          <td class="lf-td-play">${playBtn(r)}</td>
        </tr>`).join("") || `<tr><td colspan="5" class="lf-empty-row">No calls match.</td></tr>`;
      root.querySelector("[data-shown]").textContent = list.length ? `Showing ${Math.min(T.limit, list.length)} of ${list.length}` : "";
      root.querySelector("[data-more]").classList.toggle("hidden", list.length <= T.limit);
      if (playing != null) paint();
    }
    function setSeg(k) {
      T.seg = k; T.limit = PAGE;
      root.querySelectorAll("[data-seg]").forEach((b) => b.classList.toggle("active", b.dataset.seg === k));
      renderTable();
    }
    let qt = null;
    root.querySelector("[data-q]").addEventListener("input", (e) => {
      clearTimeout(qt);
      qt = setTimeout(() => { T.q = e.target.value.trim(); T.limit = PAGE; renderTable(); }, 120);
    });
    root.querySelector("[data-sort]").addEventListener("change", (e) => { T.sort = e.target.value; renderTable(); });
    root.querySelectorAll("[data-seg]").forEach((b) => b.addEventListener("click", () => setSeg(b.dataset.seg)));
    root.querySelector("[data-more]").addEventListener("click", () => { T.limit += PAGE * 2; renderTable(); });
    renderTable();

    function showCalls({ seg = "all", q = "" } = {}) {
      const input = root.querySelector("[data-q]");
      input.value = q; T.q = q;
      setSeg(seg);
      switchTab("calls");
      root.querySelector(".tabs-row")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    // ---- exports
    const CSV_COLS = ["index", "source", "lead_quality", "is_potential_lead", "confidence_score", "keywords_matched", "other_lead_signals",
      "business_requirements", "customer_intent", "call_summary", "justification", "status", "error", "tokens_used"];
    const cell = (v) => `"${String(Array.isArray(v) ? v.join("; ") : v ?? "").replace(/"/g, '""')}"`;
    root.querySelector("[data-csv]")?.addEventListener("click", () => {
      const list = filtered();
      const csv = [CSV_COLS.join(","), ...list.map((r) => CSV_COLS.map((c) => cell(c === "index" ? r._i + 1 : c === "lead_quality" ? QUALITY[r._q].label : r[c])).join(","))].join("\r\n");
      UI.download(`lead-finder-${T.seg}-${list.length}-calls.csv`, "﻿" + csv, "text/csv;charset=utf-8");
    });
    root.querySelector("[data-copy-leads]")?.addEventListener("click", () => {
      UI.copy(best.filter(isLead).map((r) => `#${r._i + 1} ${QUALITY[r._q].label} (${conf(r)}%) - ${r._m.name}${r._m.phone ? ` - ${r._m.phone}` : ""}\n   ${r.customer_intent || r.call_summary || ""}`).join("\n"));
    });

    // ---- drawer (call details)
    const drawer = document.createElement("div");
    drawer.className = "lf-drawer";
    drawer.hidden = true;
    root.appendChild(drawer);
    let nav = { list: best, at: 0 };
    const section = (title, body) => body ? `<section><h5>${title}</h5>${body}</section>` : "";
    const ul = (items) => (items || []).length ? `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
    function openDrawer(i, list) {
      const r = byI.get(i);
      if (!r) return;
      if (list) nav.list = list;
      nav.at = Math.max(0, nav.list.findIndex((x) => x._i === i));
      if (!nav.list[nav.at] || nav.list[nav.at]._i !== i) { nav.list = best; nav.at = best.findIndex((x) => x._i === i); }
      const c = conf(r);
      drawer.innerHTML = `
        <div class="lf-drawer-bg" data-close></div>
        <aside class="lf-panel q-${r._q}" role="dialog" aria-modal="true" aria-label="Call details" tabindex="-1">
          <header class="lf-panel-head">
            ${qBadge(r._q)}
            <span class="muted small">${nav.at + 1} of ${nav.list.length}</span>
            <span class="lf-panel-nav">
              <button type="button" class="icon-btn sm" data-nav="-1" title="Previous (←)" ${nav.at ? "" : "disabled"}><span style="display:inline-flex;transform:rotate(90deg)">${icon("chevron", 13)}</span></button>
              <button type="button" class="icon-btn sm" data-nav="1" title="Next (→)" ${nav.at < nav.list.length - 1 ? "" : "disabled"}><span style="display:inline-flex;transform:rotate(-90deg)">${icon("chevron", 13)}</span></button>
              <button type="button" class="icon-btn sm" data-close title="Close (Esc)">${icon("x", 13)}</button>
            </span>
          </header>
          <div class="lf-panel-body">
            <div class="lf-panel-title"><span class="lf-num">#${r._i + 1}</span><h3 title="${esc(r.source || "")}">${esc(r._m.name)}</h3></div>
            ${metaLine(r._m) ? `<div class="lf-meta lg">${metaLine(r._m)}</div>` : ""}
            ${r._q !== "failed" ? `<div class="lf-panel-conf"><div><b>${c}%</b><small>confidence</small></div><div class="lf-confbar lg"><i style="width:${c}%"></i></div></div>` : ""}
            ${r._audio ? `<div class="lf-mini" data-mini="${r._i}">${playBtn(r, 14)}
                <div class="lf-mini-track" data-seek><i data-mini-bar></i></div><small data-mini-time>0:00 / –:––</small></div>`
              : `<div class="lf-mini off">${icon("music", 13)} Recording not available to play here</div>`}
            ${r._q === "failed" ? `<div class="alert-error"><b>Could not analyze this call.</b> ${esc(r.error || "")}</div>` : ""}
            ${section("Call summary", r.call_summary ? `<p>${esc(r.call_summary)}</p>` : "")}
            ${section("What the customer wanted", r.customer_intent ? `<p>${esc(r.customer_intent)}</p>` : "")}
            ${section(`Why “${esc(QUALITY[r._q].label)}”`, r.justification ? `<p>${esc(r.justification)}</p>` : "")}
            ${section("Keywords heard", (r.keywords_matched || []).length ? `<div class="lf-chips">${kwChips(r.keywords_matched)}</div>` : "")}
            ${section("Other buying signals", ul(r.other_lead_signals))}
            ${section("Customer needs", ul(r.business_requirements))}
            ${r.source && /^https?:/i.test(r.source) ? section("Recording link", `<a class="lf-link" href="${esc(r.source)}" target="_blank" rel="noopener">${esc(r.source)}</a>`) : ""}
          </div>
          <footer class="lf-panel-foot">
            <small class="muted">${icon("cpu", 11)} ${(Number(r.tokens_used) || 0).toLocaleString()} tokens</small>
            <button type="button" class="btn btn-outline btn-sm" data-copy-call>${icon("copy", 12)} Copy details</button>
          </footer>
        </aside>`;
      drawer.hidden = false;
      document.body.classList.add("lf-lock");
      requestAnimationFrame(() => drawer.classList.add("open"));
      drawer.querySelector(".lf-panel").focus({ preventScroll: true });
      if (playing != null) paint();
      drawer.querySelector("[data-copy-call]").addEventListener("click", () => UI.copy([
        `#${r._i + 1} ${r._m.name}`, `Result: ${QUALITY[r._q].label}${r._q !== "failed" ? ` (${c}% confidence)` : ""}`,
        r.call_summary && `Summary: ${r.call_summary}`, r.customer_intent && `Customer wanted: ${r.customer_intent}`,
        r.justification && `Why: ${r.justification}`, (r.keywords_matched || []).length && `Keywords: ${r.keywords_matched.join(", ")}`,
        (r.business_requirements || []).length && `Needs: ${r.business_requirements.join("; ")}`, r.error && `Error: ${r.error}`,
      ].filter(Boolean).join("\n")));
    }
    function closeDrawer() {
      if (drawer.hidden) return;
      drawer.classList.remove("open");
      document.body.classList.remove("lf-lock");
      setTimeout(() => { if (!drawer.classList.contains("open")) drawer.hidden = true; }, 220);
    }
    const step = (dir) => {
      const next = nav.list[nav.at + dir];
      if (next) openDrawer(next._i);
    };
    drawer.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) return closeDrawer();
      const n = e.target.closest("[data-nav]");
      if (n) return step(+n.dataset.nav);
      const seek = e.target.closest("[data-seek]");
      if (seek && audio.duration && playing === +seek.parentElement.dataset.mini) {
        const rc = seek.getBoundingClientRect();
        audio.currentTime = ((e.clientX - rc.left) / rc.width) * audio.duration;
      } else if (seek) toggle(+seek.parentElement.dataset.mini);
    });
    const onKey = (e) => {
      if (!root.isConnected) return document.removeEventListener("keydown", onKey);
      if (drawer.hidden) return;
      if (e.key === "Escape") closeDrawer();
      else if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); step(1); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); step(-1); }
    };
    document.addEventListener("keydown", onKey);

    // ---- one click handler for everything in the result
    root.addEventListener("click", (e) => {
      if (drawer.contains(e.target) && !e.target.closest("[data-play],[data-kw]")) return;
      const play = e.target.closest("[data-play]");
      if (play) { e.stopPropagation(); return toggle(+play.dataset.play); }
      const kw = e.target.closest("[data-kw]");
      if (kw) { closeDrawer(); return showCalls({ q: kw.dataset.kw }); }
      const f = e.target.closest("[data-filter]");
      if (f) return showCalls({ seg: f.dataset.filter });
      const blip = e.target.closest(".lf-blip");
      if (blip) return openDrawer(+blip.dataset.i, best);
      const open = e.target.closest("[data-open]");
      if (open) {
        const fromTable = !!open.closest("[data-tbody]");
        return openDrawer(+open.dataset.open, fromTable ? filtered() : best);
      }
    });
    root.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("[data-open]")) {
        e.preventDefault();
        const fromTable = !!e.target.closest("[data-tbody]");
        openDrawer(+e.target.dataset.open, fromTable ? filtered() : best);
      }
    });
  }
})();
