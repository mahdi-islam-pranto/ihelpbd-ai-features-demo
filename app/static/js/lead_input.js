/* Lead Finder AI: input panel (call queue + lead criteria) and the batch runner.
 * A batch of up to 1,000 calls is sent in small chunks to /api/features/lead-finder/batch;
 * results stream into a live "scanning" board and are merged into one saved run. */
(function () {
  "use strict";
  const SLUG = "lead-finder";
  const MAX_CALLS = 1000;
  const CHUNK = 5;          // calls per request
  const PARALLEL = 3;       // requests in flight at once
  const AUDIO_RE = /\.(mp3|wav|m4a|ogg|flac|webm|aac|opus|amr|wma)$/i;

  const PRESETS = {
    default: { keywords: [], context: "", not: "" },
    hospital: {
      keywords: ["appointment", "doctor", "serial", "health checkup", "package", "test", "admission"],
      context: "We are a private hospital in Dhaka. A lead is a caller who wants to book a doctor appointment or serial, " +
        "a health checkup package, a diagnostic test or a hospital admission.",
      not: "Follow-up calls about past patients, complaints, wrong numbers, and calls that only ask for an address or phone number.",
    },
  };

  const { esc, icon } = window.UI;
  const $ = (id) => document.getElementById(id);
  let api = null;
  let el = {};
  const queue = [];                 // {id, kind: upload|sample|url|saved, name, file?, url?, size?}
  const keys = new Set();
  let uid = 0;
  let job = null;
  let objectUrls = [];

  // ---------------------------------------------------------------- queue
  const keyOf = (it) => it.kind === "upload" ? `f:${it.name}:${it.size}:${it.file?.lastModified}`
    : it.kind === "sample" ? `s:${it.name}` : `u:${it.url}`;
  const isHttpUrl = (v) => { try { const u = new URL(v); return /^https?:$/.test(u.protocol) && !!u.host; } catch { return false; } };
  const urlName = (v) => { try { const p = new URL(v).pathname.split("/").filter(Boolean).pop(); return p ? decodeURIComponent(p) : v; } catch { return v; } };

  function add(items) {
    let added = 0, dup = 0, full = 0;
    for (const it of items) {
      const k = keyOf(it);
      if (keys.has(k)) { dup++; continue; }
      if (queue.length >= MAX_CALLS) { full++; continue; }
      keys.add(k);
      queue.push({ ...it, id: ++uid });
      added++;
    }
    if (full) UI.toast(`Queue is full: a run can have at most ${MAX_CALLS.toLocaleString()} calls (${full} not added)`, "error");
    else if (dup && !added) UI.toast(dup === 1 ? "Already in the queue" : `All ${dup} are already in the queue`);
    renderQueue();
    return added;
  }
  function remove(pred) {
    for (let i = queue.length - 1; i >= 0; i--) if (pred(queue[i])) { keys.delete(keyOf(queue[i])); queue.splice(i, 1); }
    renderQueue();
  }

  function renderQueue() {
    const files = queue.filter((q) => q.kind !== "url").length, links = queue.length - files;
    const bytes = queue.reduce((n, q) => n + (q.size || 0), 0);
    el.list.innerHTML = queue.map((q, i) => `
      <li class="lf-qi k-${q.kind}" data-id="${q.id}">
        <span class="lf-qi-n">${i + 1}</span>
        <span class="lf-qi-ico">${icon(q.kind === "url" ? "link" : "music", 12)}</span>
        <span class="lf-qi-name" title="${esc(q.url || q.name)}">${esc(q.name)}</span>
        <small class="lf-qi-meta">${q.kind === "sample" ? "sample" : q.kind === "saved" ? "saved" : q.kind === "url" ? esc(hostOf(q.url)) : UI.fmtBytes(q.size)}</small>
        <button type="button" class="lf-qi-x" data-remove="${q.id}" title="Remove" aria-label="Remove">${icon("x", 11)}</button>
      </li>`).join("");
    el.empty.classList.toggle("hidden", queue.length > 0);
    el.clear.classList.toggle("hidden", !queue.length);
    el.stat.textContent = queue.length
      ? [`${queue.length.toLocaleString()} call${queue.length === 1 ? "" : "s"}`, files && links ? `${files} file${files === 1 ? "" : "s"} + ${links} link${links === 1 ? "" : "s"}` : "", bytes ? UI.fmtBytes(bytes) : ""].filter(Boolean).join(" · ")
      : "empty";
    el.nFiles.textContent = files || "";
    el.nLinks.textContent = links || "";
    document.querySelectorAll("#lfSamples .sample-chip[data-name]").forEach((c) => c.classList.toggle("active", keys.has(`s:${c.dataset.name}`)));
    document.querySelectorAll("#lfSampleLinks .sample-chip[data-url]").forEach((c) => c.classList.toggle("active", keys.has(`u:${c.dataset.url}`)));
    updateRun();
  }
  const hostOf = (u) => { try { return new URL(u).host; } catch { return "link"; } };

  function updateRun() {
    const busy = !!job;
    el.run.disabled = busy || !queue.length;
    el.runLabel.textContent = busy ? "Scanning…" : queue.length
      ? `Find leads in ${queue.length.toLocaleString()} call${queue.length === 1 ? "" : "s"}` : "Add calls to start";
  }

  function addFiles(list) {
    const files = [...list];
    const audio = files.filter((f) => AUDIO_RE.test(f.name) || f.type.startsWith("audio/"));
    if (files.length > audio.length) UI.toast(`${files.length - audio.length} file(s) skipped: not audio`, "error");
    const n = add(audio.map((f) => ({ kind: "upload", name: f.name, file: f, size: f.size })));
    if (n > 1) UI.toast(`${n} recordings added`, "success");
  }

  // ---------------------------------------------------------------- links box
  function parseLinks() {
    const parts = el.links.value.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
    return { ok: [...new Set(parts.filter(isHttpUrl))], bad: parts.filter((x) => !isHttpUrl(x)) };
  }
  function linkStat() {
    const { ok, bad } = parseLinks();
    el.addLinks.disabled = !ok.length;
    el.linkStat.innerHTML = !ok.length && !bad.length ? "One link per line, or separated by commas."
      : `<b class="ok">${ok.length} link${ok.length === 1 ? "" : "s"} ready</b>${bad.length ? ` · <b class="bad">${bad.length} not a full http(s) link</b>` : ""} <span class="muted">(Ctrl+Enter)</span>`;
  }
  function addLinks() {
    const { ok, bad } = parseLinks();
    if (!ok.length) return;
    const n = add(ok.map((u) => ({ kind: "url", name: urlName(u), url: u })));
    el.links.value = bad.join("\n");                 // keep only what couldn't be added
    linkStat();
    if (n) UI.toast(`${n} link${n === 1 ? "" : "s"} added${bad.length ? `, ${bad.length} not valid (left in the box)` : ""}`, "success");
  }

  // ---------------------------------------------------------------- samples
  function sampleChips(box, items, makeItem, keyFn, label) {
    if (!items.length) { box.innerHTML = ""; return; }
    box.innerHTML = `<small class="muted">${label}</small>`;
    const all = document.createElement("button");
    all.type = "button";
    all.className = "sample-chip lf-all";
    all.innerHTML = `${icon("plus", 12)}<span>Add all ${items.length}</span>`;
    all.addEventListener("click", () => add(items.map(makeItem)));
    box.appendChild(all);
    items.forEach((s) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "sample-chip";
      Object.assign(chip.dataset, keyFn(s));
      chip.title = `${s.name} (click to add / remove)`;
      chip.innerHTML = `${icon(makeItem(s).kind === "url" ? "link" : "music", 12)}<span>${esc(s.name)}</span>`;
      chip.addEventListener("click", () => {
        const item = makeItem(s);
        if (keys.has(keyOf(item))) remove((q) => keyOf(q) === keyOf(item));
        else add([item]);
      });
      box.appendChild(chip);
    });
  }
  async function loadSamples() {
    const [files, links] = await Promise.all([
      fetch("/api/samples/recordings").then((r) => r.json()).catch(() => []),
      fetch("/api/samples/urls").then((r) => r.json()).catch(() => []),
    ]);
    sampleChips($("lfSamples"), files, (s) => ({ kind: "sample", name: s.name, size: s.size }), (s) => ({ name: s.name }), "Samples:");
    if (!files.length) $("lfSamples").innerHTML = "";
    sampleChips($("lfSampleLinks"), links, (l) => ({ kind: "url", name: l.name, url: l.url }), (l) => ({ url: l.url }), "Sample links:");
    renderQueue();
  }

  // ---------------------------------------------------------------- criteria
  const tags = [];
  function renderTags() {
    el.tags.querySelectorAll(".lf-tag").forEach((t) => t.remove());
    tags.forEach((t, i) => el.tagInput.insertAdjacentHTML("beforebegin",
      `<span class="lf-tag">${esc(t)}<button type="button" data-tag="${i}" aria-label="Remove ${esc(t)}">${icon("x", 10)}</button></span>`));
    el.tagInput.placeholder = tags.length ? "Add another…" : "Type a word or phrase, press Enter";
    updateMode();
  }
  function addTags(text) {
    String(text).split(/[,\n،]+/).map((x) => x.trim()).filter(Boolean).forEach((t) => {
      if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t.slice(0, 80));
    });
    renderTags();
  }
  const criteria = () => ({
    lead_keywords: tags.join(", "),
    business_context: el.context.value.trim(),
    not_a_lead_criteria: el.not.value.trim(),
  });
  function updateMode() {
    const c = criteria();
    const custom = !!(c.lead_keywords || c.business_context || c.not_a_lead_criteria);
    el.mode.className = `lf-mode ${custom ? "custom" : ""}`;
    el.mode.innerHTML = custom
      ? `${icon("check", 12)}<span><b>Using your criteria.</b>${!c.business_context ? " Tip: add a business context too, it helps the AI judge calls." : !c.lead_keywords ? " Tip: keywords make matches easier to spot." : ""}</span>`
      : `${icon("info", 12)}<span><b>Using the built-in FedEx profile.</b> Leave everything empty for FedEx, or describe your own business below.</span>`;
    document.querySelectorAll("[data-preset]").forEach((b) => {
      const p = PRESETS[b.dataset.preset];
      b.classList.toggle("active", p.keywords.join(", ") === c.lead_keywords && p.context === c.business_context && p.not === c.not_a_lead_criteria);
    });
  }
  function setCriteria({ keywords = [], context = "", not = "" }) {
    tags.length = 0;
    addTags(keywords.join(","));
    el.context.value = context;
    el.not.value = not;
    updateMode();
  }

  // ---------------------------------------------------------------- tabs
  function setTab(t) {
    document.querySelectorAll("[data-lf-tab]").forEach((b) => {
      const on = b.dataset.lfTab === t;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on);
    });
    document.querySelectorAll("[data-lf-pane]").forEach((p) => p.classList.toggle("hidden", p.dataset.lfPane !== t));
  }

  // ================================================================ batch run
  const { QUALITY, ORDER, qualityKey, isLead, mergeChunk, summarize, callMeta } = window.LeadKit;

  function chunksOf(items) {
    const out = [];
    let cur = null;
    items.forEach((it, i) => {
      const group = it.kind === "url" ? "url" : "file";     // the API takes files OR links per request
      if (!cur || cur.group !== group || cur.items.length >= CHUNK) out.push(cur = { group, offset: i, items: [] });
      cur.items.push(it);
    });
    return out;
  }

  function audioUrl(it) {
    if (it.kind === "url" || it.kind === "saved") return it.url;
    if (it.kind === "sample") return `/samples/recordings/${encodeURIComponent(it.name)}`;
    const u = URL.createObjectURL(it.file);
    objectUrls.push(u);
    return u;
  }

  function localErrorChunk(ch, message) {
    const results = ch.items.map((it, k) => ({
      index: ch.offset + k, source: it.url || it.name, source_type: it.kind === "url" ? "url" : "file",
      status: "error", error: message, call_summary: null, customer_intent: null, is_potential_lead: false,
      lead_quality: "Not a Lead", confidence_score: 0, keywords_matched: [], other_lead_signals: [],
      business_requirements: [], justification: null, tokens_used: 0,
    }));
    return { summary: summarize(results, null), leads: [], results };
  }

  async function sendChunk(ch) {
    const fd = new FormData();
    const params = { ...job.criteria, offset: ch.offset, planned: job.planned, items: [], save: job.save };
    if (job.runId) params.append_to = job.runId;
    for (const it of ch.items) {
      if (it.kind === "url") params.items.push({ kind: "url", url: it.url });
      else if (it.kind === "sample") params.items.push({ kind: "sample", name: it.name });
      else {
        let file = it.file;
        if (it.kind === "saved") {               // a stored upload from a saved run: fetch it again
          const blob = await (await fetch(it.url)).blob();
          file = new File([blob], it.name, { type: blob.type });
        }
        params.items.push({ kind: "upload" });
        fd.append("files", file, it.name);
      }
    }
    fd.append("params", JSON.stringify(params));
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(`/api/features/${SLUG}/batch`, { method: "POST", body: fd, signal: job.abort.signal });
        const body = await res.json().catch(() => ({}));
        if (res.ok) return body;
        const err = new Error(body.detail || `Request failed (${res.status})`);
        err.final = res.status < 500;
        throw err;
      } catch (e) {
        if (e.name === "AbortError" || e.final || attempt >= 1) throw e;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }

  async function runChunk(ch) {
    board.scanning(ch);
    let payload;
    try {
      payload = await sendChunk(ch);
    } catch (e) {
      if (e.name === "AbortError") { board.unscan(ch); return; }
      payload = { data: localErrorChunk(ch, e.message), chunk_error: e.message };
    }
    if (!job || job.finished) return;
    job.data = mergeChunk(job.data, payload.data);
    job.done += ch.items.length;
    if (payload.mode === "live") job.mode = "live"; else job.mode = job.mode || payload.mode;
    if (payload.run_id) { job.runId = payload.run_id; job.createdAt = job.createdAt || payload.created_at; }
    if (payload.history_error && !job.historyError) {
      job.historyError = payload.history_error;
      if (!job.runId) job.save = false;          // don't create a separate saved row per chunk
    }
    if (payload.chunk_error) {
      job.failStreak++;
      if (job.failStreak === 1) UI.toast(`Some calls failed: ${payload.chunk_error}`, "error");
      if (job.failStreak >= 3 && !job.cancelled) {
        job.cancelled = true;
        job.stopReason = "Stopped: the AI service failed 3 times in a row.";
      }
    } else job.failStreak = 0;
    board.update(payload.data.results || []);
  }

  async function run() {
    if (job || !queue.length) return;
    const items = queue.slice(0, MAX_CALLS);
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
    objectUrls = [];
    job = {
      items, planned: items.length, criteria: criteria(), data: null, done: 0, runId: null, createdAt: null,
      mode: null, save: true, cancelled: false, finished: false, failStreak: 0, started: performance.now(),
      abort: new AbortController(), sources: items.map((it, i) => ({ index: i, kind: it.kind, name: it.name, url: audioUrl(it) })),
    };
    updateRun();
    api.setRunParam(null);
    board.mount();
    if (window.innerWidth < 1100) $("resultPanel").scrollIntoView({ behavior: "smooth", block: "start" });

    const chunks = chunksOf(items);
    try {
      await runChunk(chunks[0]);                           // the first chunk creates the saved run
      let next = 1;
      const worker = async () => { while (!job.cancelled && next < chunks.length) await runChunk(chunks[next++]); };
      await Promise.all(Array.from({ length: Math.min(PARALLEL, chunks.length - 1) }, worker));
    } finally {
      finish();
    }
  }

  function finish() {
    const j = job;
    if (!j || j.finished) return;
    j.finished = true;
    board.stopTimer();
    job = null;
    updateRun();
    if (!j.data || !j.data.results.length) {
      api.els.body.innerHTML = "";
      api.setView("empty");
      UI.toast("Stopped before any call was analyzed", "error");
      return;
    }
    const criteriaIn = Object.fromEntries(Object.entries(j.criteria).filter(([, v]) => v));
    api.renderResult({
      feature: SLUG, mode: j.mode || (api.isLive ? "live" : "demo"), elapsed_ms: Math.round(performance.now() - j.started),
      input: criteriaIn, data: j.data, run_id: j.runId, created_at: j.createdAt, history_error: j.historyError,
      planned: j.planned, sources: j.sources,
    });
    if (j.stopReason) UI.toast(j.stopReason, "error");
    else if (j.cancelled) UI.toast(`Stopped: ${j.data.results.length} of ${j.planned} calls analyzed`);
    const leads = j.data.results.filter(isLead).length;
    if (!j.cancelled) UI.toast(`${leads} lead${leads === 1 ? "" : "s"} found in ${j.data.results.length} calls`, "success");
    if (j.runId) { api.setRunParam(j.runId); api.loadHistory(); }
    else if (j.historyError) UI.toast(`Result not saved: ${j.historyError}`, "error");
  }

  function stop() {
    if (!job || job.cancelled) return;
    job.cancelled = true;
    board.stopping();
  }

  // ---------------------------------------------------------------- live board
  const board = {
    timer: null,
    mount() {
      const n = job.planned;
      const size = n <= 40 ? "lg" : n <= 200 ? "md" : "sm";
      api.els.body.innerHTML = `
        <div class="lf-live">
          <div class="lf-live-head">
            <div class="lf-scope" aria-hidden="true"><i></i><b></b></div>
            <div class="lf-live-title">
              <strong data-l-title>Scanning ${n.toLocaleString()} call${n === 1 ? "" : "s"} for leads…</strong>
              <small data-l-sub>Sending the first calls to the AI</small>
            </div>
            <button type="button" class="btn btn-outline btn-sm lf-stop" data-l-stop>${icon("x", 12)} Stop</button>
          </div>
          <div class="lf-live-bar"><i data-l-bar></i></div>
          <div class="lf-live-counts">${ORDER.map((k) => `<div class="lf-lc q-${k}" data-l-c="${k}"><i></i><span>${QUALITY[k].short}</span><b>0</b></div>`).join("")}</div>
          <div class="lf-grid ${size}" data-l-grid>${job.items.map((it, i) =>
            `<i data-t="${i}" title="#${i + 1} ${esc(it.name)}">${size === "lg" ? i + 1 : ""}</i>`).join("")}</div>
          <div class="lf-feed">
            <div class="sub-title">Leads found so far</div>
            <ul data-l-feed><li class="lf-feed-none muted small">None yet. Leads appear here as soon as they're found.</li></ul>
          </div>
        </div>`;
      api.setView("body");
      this.root = api.els.body.querySelector(".lf-live");
      this.tiles = [...this.root.querySelectorAll("[data-t]")];
      this.root.querySelector("[data-l-stop]").addEventListener("click", stop);
      clearInterval(this.timer);
      this.timer = setInterval(() => this.progress(), 1000);
    },
    scanning(ch) { ch.items.forEach((_, k) => this.tiles[ch.offset + k]?.classList.add("scan")); },
    unscan(ch) { ch.items.forEach((_, k) => this.tiles[ch.offset + k]?.classList.remove("scan")); },
    update(results) {
      if (!this.root?.isConnected) return;
      const feed = this.root.querySelector("[data-l-feed]");
      results.forEach((r) => {
        const k = qualityKey(r), t = this.tiles[r.index];
        if (t) { t.className = `q-${k} done`; t.title = `#${r.index + 1} ${callMeta(r.source).name}: ${QUALITY[k].label}`; }
        if (isLead(r)) {
          feed.querySelector(".lf-feed-none")?.remove();
          feed.insertAdjacentHTML("afterbegin", `<li class="q-${k}"><span class="lf-q q-${k}"><i></i>${esc(QUALITY[k].short)}</span>
            <b title="${esc(callMeta(r.source).name)}">#${r.index + 1} ${esc(callMeta(r.source).name)}</b>
            <span>${esc(r.customer_intent || r.call_summary || "")}</span></li>`);
          while (feed.children.length > 6) feed.lastElementChild.remove();
        }
      });
      const s = job?.data?.summary;
      if (s) {
        const c = { strong: s.strong_leads, potential: s.potential_lead_quality, weak: s.weak_interest, not: s.not_a_lead, failed: s.failed };
        ORDER.forEach((k) => {
          const box = this.root.querySelector(`[data-l-c="${k}"]`);
          const b = box.querySelector("b");
          if (b.textContent !== String(c[k])) { b.textContent = c[k]; box.classList.remove("bump"); void box.offsetWidth; box.classList.add("bump"); }
        });
      }
      this.progress();
    },
    progress() {
      if (!job || !this.root?.isConnected) return;
      const pct = job.planned ? (job.done / job.planned) * 100 : 0;
      this.root.querySelector("[data-l-bar]").style.width = `${pct}%`;
      const secs = (performance.now() - job.started) / 1000;
      let sub = `${job.done.toLocaleString()} of ${job.planned.toLocaleString()} analyzed · ${UI.fmtTime(secs)} elapsed`;
      if (job.done && job.done < job.planned && !job.cancelled) {
        const left = (secs / job.done) * (job.planned - job.done);
        sub += ` · about ${left < 60 ? `${Math.max(5, Math.round(left / 5) * 5)}s` : `${Math.round(left / 60)} min`} left`;
      }
      if (job.cancelled) sub = `Stopping… finishing the calls already sent (${job.done} done)`;
      this.root.querySelector("[data-l-sub]").textContent = sub;
    },
    stopping() {
      const b = this.root?.querySelector("[data-l-stop]");
      if (b) { b.disabled = true; b.textContent = "Stopping…"; }
      this.root?.classList.add("stopping");
      this.progress();
    },
    stopTimer() { clearInterval(this.timer); },
  };

  // ================================================================ controller
  window.InputControllers = window.InputControllers || {};
  window.InputControllers[SLUG] = {
    init(a) {
      api = a;
      el = {
        list: $("lfQueueList"), empty: $("lfQueueEmpty"), clear: $("lfClear"), stat: $("lfQueueStat"),
        nFiles: document.querySelector('[data-lf-n="files"]'), nLinks: document.querySelector('[data-lf-n="links"]'),
        run: $("runBtn"), runLabel: $("lfRunLabel"), links: $("lfLinks"), addLinks: $("lfAddLinks"), linkStat: $("lfLinkStat"),
        tags: $("lfTags"), tagInput: $("lfTagInput"), context: $("lfContext"), not: $("lfNot"), mode: $("lfMode"),
      };
      const drop = $("lfDrop"), fileInput = $("lfFiles");
      fileInput.addEventListener("change", () => { addFiles(fileInput.files); fileInput.value = ""; });
      ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("drag"); }));
      ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("drag"); }));
      drop.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
      // dropping a list of links anywhere on the input card
      $("lfIn").addEventListener("drop", (e) => {
        const text = e.dataTransfer?.getData("text");
        if (text && !e.dataTransfer.files.length) { e.preventDefault(); setTab("links"); el.links.value += (el.links.value ? "\n" : "") + text; linkStat(); }
      });

      document.querySelectorAll("[data-lf-tab]").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.lfTab)));
      el.list.addEventListener("click", (e) => {
        const x = e.target.closest("[data-remove]");
        if (x) remove((q) => q.id === +x.dataset.remove);
      });
      el.clear.addEventListener("click", () => {
        if (queue.length > 20 && !confirm(`Remove all ${queue.length} calls from the queue?`)) return;
        remove(() => true);
      });
      el.links.addEventListener("input", linkStat);
      el.links.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addLinks(); } });
      el.addLinks.addEventListener("click", addLinks);

      el.tags.addEventListener("click", (e) => {
        const x = e.target.closest("[data-tag]");
        if (x) { tags.splice(+x.dataset.tag, 1); renderTags(); }
        el.tagInput.focus();
      });
      el.tagInput.addEventListener("keydown", (e) => {
        if ((e.key === "Enter" || e.key === ",") && el.tagInput.value.trim()) { e.preventDefault(); addTags(el.tagInput.value); el.tagInput.value = ""; }
        else if (e.key === "Backspace" && !el.tagInput.value && tags.length) { tags.pop(); renderTags(); }
      });
      el.tagInput.addEventListener("paste", (e) => {
        const t = e.clipboardData.getData("text");
        if (/[,\n]/.test(t)) { e.preventDefault(); addTags(t); }
      });
      el.tagInput.addEventListener("blur", () => { if (el.tagInput.value.trim()) { addTags(el.tagInput.value); el.tagInput.value = ""; } });
      [el.context, el.not].forEach((t) => t.addEventListener("input", updateMode));
      document.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => setCriteria(PRESETS[b.dataset.preset])));
      el.run.addEventListener("click", run);
      window.addEventListener("beforeunload", (e) => { if (job) { e.preventDefault(); e.returnValue = ""; } });

      renderTags();
      renderQueue();
      return loadSamples();
    },
    run,
    busy: () => !!job,
    // Put a saved run's calls and criteria back so it can be run again.
    restore(payload) {
      const input = payload.input || {};
      setCriteria({
        keywords: String(input.lead_keywords || "").split(/[,\n]/).map((x) => x.trim()).filter(Boolean),
        context: input.business_context || "", not: input.not_a_lead_criteria || "",
      });
      remove(() => true);
      const missing = [];
      add((payload.sources || []).map((s) => {
        if (s.kind === "url") return { kind: "url", name: s.name, url: s.url };
        if (s.kind === "sample" && s.url) return { kind: "sample", name: s.name };
        if (s.kind === "upload" && s.url) return { kind: "saved", name: s.name, url: s.url };
        missing.push(s.name);
        return null;
      }).filter(Boolean));
      setTab(queue.length && queue.every((q) => q.kind === "url") ? "links" : "files");
      if (missing.length) UI.toast(`${missing.length} uploaded file(s) of this run weren't stored, so they're not in the queue`, "error");
    },
  };
})();
