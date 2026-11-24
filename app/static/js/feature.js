/* Feature page controller: input handling -> API call -> render result. */
(function () {
  "use strict";
  const app = document.getElementById("demoApp");
  if (!app) return;

  const slug = app.dataset.feature;
  const fileKind = app.dataset.fileKind || null;          // "recordings" | "crm" | null
  const fileRequired = app.dataset.fileRequired === "true";
  const isAudio = fileKind === "recordings";
  const steps = JSON.parse(app.dataset.steps || "[]");
  const historyOn = app.dataset.history === "true";
  const acceptsUrl = app.dataset.acceptsUrl === "true";
  // Features with their own input panel (e.g. Lead Finder's batch queue) register
  // window.InputControllers[slug] = { init(api), run(), restore(payload), busy() }.
  const custom = (window.InputControllers || {})[slug] || null;

  const $ = (id) => document.getElementById(id);
  const fileInput = $("fileInput"), dropzone = $("dropzone"), sampleList = $("sampleList");
  const selectedBox = $("selectedFile"), selectedName = $("selectedName"), clearBtn = $("clearFile");
  const player = $("player") ? window.createAudioPlayer($("player")) : null;
  const audioPlayer = player?.audio || null, runBtn = $("runBtn"), form = $("inputForm");
  const els = { empty: $("resultEmpty"), loading: $("resultLoading"), body: $("resultBody"), steps: $("progressSteps") };
  const urlInput = $("urlInput"), urlField = $("urlField"), urlSampleList = $("urlSampleList");

  // savedFile: a stored upload from a saved result ({url, name}) - fetched again on re-run
  // mode: "file" (upload / sample) or "url" (link to the file, for features that accept one)
  const state = { file: null, sample: null, savedFile: null, url: null, objectUrl: null, busy: false, mode: "file" };

  // ---------- Input selection ----------
  function updateRunState() {
    if (custom) return;                                   // the controller owns the run button
    const hasInput = state.mode === "url" ? !!state.url : !!(state.file || state.sample || state.savedFile);
    runBtn.disabled = state.busy || (fileRequired && !hasInput);
  }

  const isHttpUrl = (v) => {
    try { const u = new URL(v); return (u.protocol === "http:" || u.protocol === "https:") && !!u.host; } catch { return false; }
  };
  const urlName = (v) => {
    try {
      const u = new URL(v);
      const last = u.pathname.split("/").filter(Boolean).pop();
      try { return last ? decodeURIComponent(last) : u.host; } catch { return last || u.host; }
    } catch { return v; }
  };

  function showSelected(name, src, source) {
    selectedName.textContent = name;
    selectedName.title = name;
    selectedBox.classList.remove("hidden");
    if (player && src) player.load(src, source);
    updateRunState();
  }

  function clearSelection() {
    state.file = null;
    state.sample = null;
    state.savedFile = null;
    state.url = null;
    if (urlInput) urlInput.value = "";
    urlField?.classList.remove("valid", "invalid");
    urlSampleList?.querySelectorAll(".sample-chip").forEach((c) => c.classList.remove("active"));
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
    if (fileInput) fileInput.value = "";
    player?.clear();
    selectedBox?.classList.add("hidden");
    sampleList?.querySelectorAll(".sample-chip").forEach((c) => c.classList.remove("active"));
    updateRunState();
  }

  function pickFile(file) {
    if (!file) return;
    clearSelection();
    state.file = file;
    if (isAudio) state.objectUrl = URL.createObjectURL(file);
    showSelected(`${file.name} · ${UI.fmtBytes(file.size)}`, state.objectUrl, file);
  }

  function pickSample(sample, chip) {
    clearSelection();
    state.sample = sample.name;
    chip.classList.add("active");
    showSelected(sample.name, isAudio ? sample.url : null);
  }

  // ---- link input ("Use a link" mode)
  function setMode(mode) {
    if (!acceptsUrl) return;
    state.mode = mode;
    app.querySelectorAll("[data-src-mode]").forEach((b) => {
      const on = b.dataset.srcMode === mode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on);
    });
    app.querySelectorAll("[data-src-pane]").forEach((p) => p.classList.toggle("hidden", p.dataset.srcPane !== mode));
    updateRunState();
  }

  // Only one source is sent, so switching tabs clears the other one.
  app.querySelectorAll("[data-src-mode]").forEach((b) => b.addEventListener("click", () => {
    if (state.mode === b.dataset.srcMode) return;
    clearSelection();
    setMode(b.dataset.srcMode);
    if (state.mode === "url") urlInput?.focus();
  }));

  function pickUrl(url, chip) {
    clearSelection();
    urlInput.value = url;
    state.url = url;
    urlField.classList.add("valid");
    chip?.classList.add("active");
    showSelected(urlName(url), url);
  }

  urlInput?.addEventListener("input", () => {
    const v = urlInput.value.trim();
    const ok = isHttpUrl(v);
    state.url = ok ? v : null;
    urlField.classList.toggle("valid", ok);
    urlField.classList.toggle("invalid", !!v && !ok);
    urlSampleList?.querySelectorAll(".sample-chip").forEach((c) => c.classList.toggle("active", c.dataset.url === v));
    if (selectedBox && !selectedBox.classList.contains("hidden")) {   // link changed: drop the old preview
      player?.clear();
      selectedBox.classList.add("hidden");
    }
    updateRunState();
  });
  // preview the audio once the link is complete (blur / Enter)
  urlInput?.addEventListener("change", () => {
    if (state.url && selectedBox.classList.contains("hidden")) pickUrl(state.url, urlSampleList?.querySelector(".sample-chip.active"));
  });
  urlInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && state.url && !runBtn.disabled) { e.preventDefault(); urlInput.blur(); run(); }
  });

  async function loadUrlSamples() {
    if (!urlSampleList) return;
    try {
      const links = await (await fetch("/api/samples/urls")).json();
      if (!links.length) return;
      urlSampleList.innerHTML = `<small class="muted">Sample links:</small>`;
      links.forEach((l) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "sample-chip";
        chip.title = l.url;
        chip.dataset.url = l.url;
        chip.innerHTML = `${UI.icon("link", 12)}<span>${UI.esc(l.name)}</span>`;
        chip.addEventListener("click", () => pickUrl(l.url, chip));
        urlSampleList.appendChild(chip);
      });
    } catch { /* no sample links */ }
  }

  fileInput?.addEventListener("change", () => pickFile(fileInput.files[0]));
  clearBtn?.addEventListener("click", clearSelection);
  if (dropzone) {
    ["dragenter", "dragover"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("drag"); }));
    ["dragleave", "drop"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("drag"); }));
    dropzone.addEventListener("drop", (e) => pickFile(e.dataTransfer.files[0]));
  }

  async function loadSamples() {
    if (!sampleList) return;
    try {
      const samples = await (await fetch(`/api/samples/${fileKind}`)).json();
      sampleList.innerHTML = "";
      if (!samples.length) {
        if (isAudio && app.dataset.mode === "demo") addDemoChip();
        else sampleList.innerHTML = `<span class="muted small">No sample files available.</span>`;
        return;
      }
      const label = document.createElement("small");
      label.className = "muted";
      label.textContent = "Samples:";
      sampleList.appendChild(label);
      samples.forEach((s) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "sample-chip";
        chip.title = s.name;
        chip.innerHTML = `${UI.icon(isAudio ? "music" : "file", 12)}<span>${UI.esc(s.name)}</span>`;
        chip.addEventListener("click", () => pickSample(s, chip));
        sampleList.appendChild(chip);
      });
    } catch {
      sampleList.innerHTML = `<span class="muted small">Could not load samples.</span>`;
    }
  }

  // Demo mode with no sample recordings on disk: offer a built-in placeholder call.
  function addDemoChip() {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "sample-chip";
    chip.innerHTML = `${UI.icon("sparkles", 12)}<span>Built-in demo call</span>`;
    chip.addEventListener("click", () => {
      clearSelection();
      state.file = new File([new Uint8Array([0])], "demo-call.wav", { type: "audio/wav" });
      chip.classList.add("active");
      showSelected("Built-in demo call", null);
    });
    sampleList.appendChild(chip);
  }

  // ---------- Run ----------
  let stepTimer = null;

  function setView(view) {
    els.empty.classList.toggle("hidden", view !== "empty");
    els.loading.classList.toggle("hidden", view !== "loading");
    els.body.classList.toggle("hidden", view !== "body");
  }

  function startProgress() {
    els.steps.innerHTML = steps.map((s) => `<li>${UI.esc(s)}</li>`).join("");
    const items = [...els.steps.children];
    let i = 0;
    const advance = () => {
      items.forEach((li, idx) => { li.classList.toggle("done", idx < i); li.classList.toggle("active", idx === i); });
      if (i < items.length - 1) i++;
    };
    advance();
    stepTimer = setInterval(advance, 1500);
  }

  function stopProgress() {
    clearInterval(stepTimer);
    [...els.steps.children].forEach((li) => { li.classList.remove("active"); li.classList.add("done"); });
  }

  async function run() {
    if (custom) return custom.run();
    if (form && !form.reportValidity()) return;
    const params = form ? Object.fromEntries(new FormData(form).entries()) : {};
    const fd = new FormData();
    fd.append("params", JSON.stringify(params));

    if (state.mode === "url") {
      if (!state.url) return UI.toast("Paste a full http(s) link to the recording", "error");
      fd.set("params", JSON.stringify({ ...params, audio_url: state.url }));   // the link goes instead of a file
    }

    state.busy = true;
    updateRunState();
    if (state.mode === "url") { /* nothing to attach */ }
    else if (state.file) fd.append("file", state.file);
    else if (state.sample) { fd.append("sample", state.sample); fd.append("sample_kind", fileKind); }
    else if (state.savedFile) {
      // re-running a saved result: fetch its stored recording again
      try {
        const blob = await (await fetch(state.savedFile.url)).blob();
        fd.append("file", new File([blob], state.savedFile.name, { type: blob.type }));
      } catch {
        state.busy = false; updateRunState();
        return UI.toast("Could not load the saved recording", "error");
      }
    }

    $("loadingText").textContent = "Processing…";
    setView("loading");
    startProgress();
    if (window.innerWidth < 1100) $("resultPanel").scrollIntoView({ behavior: "smooth", block: "start" });

    try {
      const res = await fetch(`/api/features/${slug}/run`, { method: "POST", body: fd });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.detail || `Request failed (${res.status})`);
      stopProgress();
      renderResult(payload);
      if (payload.run_id) {
        setRunParam(payload.run_id);
        loadHistory();
      } else if (payload.history_error) {
        UI.toast(`Result not saved: ${payload.history_error}`, "error");
      }
    } catch (err) {
      stopProgress();
      els.body.innerHTML = `<div class="alert-error"><b>Request failed.</b> ${UI.esc(err.message)}</div>`;
      setView("body");
      UI.toast(err.message, "error");
    } finally {
      state.busy = false;
      updateRunState();
    }
  }

  runBtn?.addEventListener("click", run);

  // ---------- Render ----------
  function animateIn(root) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.querySelectorAll("[data-w]").forEach((el) => { el.style.width = el.dataset.w; });
      root.querySelectorAll("[data-offset]").forEach((el) => { el.style.strokeDashoffset = el.dataset.offset; });
      root.querySelectorAll("[data-rotate]").forEach((el) => { el.style.transform = `rotate(${el.dataset.rotate})`; });
      root.querySelectorAll("[data-count]").forEach((el) => {
        const target = Number(el.dataset.count) || 0, dur = 700;
        let t0 = null;
        const tick = (now) => {
          if (t0 === null) t0 = now;
          const k = Math.min(1, Math.max(0, (now - t0) / dur));
          el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3)));
          if (k < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        setTimeout(() => { el.textContent = target; }, dur + 150);   // guarantee final value
      });
    }));
  }

  function renderResult(payload) {
    const ctx = { audio: audioPlayer, input: payload.input || {}, payload };
    let view;
    try {
      view = (window.Renderers[slug] || window.Renderers.fallback)(payload.data, ctx);
    } catch (e) {
      console.error("Renderer failed, showing raw JSON", e);
      view = window.Renderers.fallback(payload.data);
    }
    const tabs = [...view.tabs, { id: "raw", label: "Raw JSON", html: `<pre class="json-view">${UI.esc(JSON.stringify(payload.data, null, 2))}</pre>` }];

    els.body.innerHTML = `
      <div class="result-toolbar">
        <h3 class="result-title">${UI.icon("sparkles", 14)} ${UI.esc(view.title || "Result")}</h3>
        <div class="result-meta">
          <span class="badge badge-${payload.mode}">${payload.mode === "live" ? "Live API" : "Demo data"}</span>
          <span title="Processing time">${UI.icon("clock", 12)} ${(payload.elapsed_ms / 1000).toFixed(1)}s</span>
          ${payload.run_id ? `<span class="saved-pill" title="Saved ${UI.esc(UI.fmtDate(payload.created_at))}">${UI.icon("check", 11)} Saved #${payload.run_id}</span>` : ""}
          ${payload.history_error ? `<span class="saved-pill warn" title="${UI.esc(payload.history_error)}">${UI.icon("alert", 11)} Not saved</span>` : ""}
          <button class="icon-btn sm" data-act="copy" title="Copy JSON">${UI.icon("copy", 12)}</button>
          <button class="icon-btn sm" data-act="download" title="Download JSON">${UI.icon("download", 12)}</button>
        </div>
      </div>
      ${view.header || ""}
      <div class="tabs-row"><div class="tabs">${tabs.map((t, i) =>
        `<button class="tab ${i ? "" : "active"}" data-tab="${t.id}">${t.icon ? UI.icon(t.icon, 12) : ""}${UI.esc(t.label)}</button>`).join("")}</div></div>
      ${tabs.map((t, i) => `<div class="tab-panel ${i ? "hidden" : ""}" data-panel="${t.id}">${t.html}</div>`).join("")}
      ${view.footer || ""}`;

    const switchTab = (id) => {
      els.body.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
      els.body.querySelectorAll(".tab-panel").forEach((p) => {
        const show = p.dataset.panel === id;
        if (show && p.classList.contains("hidden")) { p.classList.remove("hidden"); animateIn(p); }
        else p.classList.toggle("hidden", !show);
      });
    };
    els.body.querySelectorAll(".tab").forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
    els.body.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => UI.copy(b.dataset.copy)));

    const json = JSON.stringify(payload.data, null, 2);
    els.body.querySelector('[data-act="copy"]').addEventListener("click", () => UI.copy(json));
    els.body.querySelector('[data-act="download"]').addEventListener("click", () => UI.download(`${slug}-result.json`, json));

    setView("body");
    view.onMount?.(els.body, { ...ctx, switchTab });
    animateIn(els.body);
  }

  // ---------- Saved results (history) ----------
  const H = { list: $("historyList"), more: $("historyMore"), search: $("historySearch"), count: $("historyCount") };
  const hist = { offset: 0, limit: 15, q: "", activeId: null, req: 0 };

  function setRunParam(id) {
    hist.activeId = id ? String(id) : null;
    const url = new URL(location.href);
    if (id) url.searchParams.set("run", id); else url.searchParams.delete("run");
    window.history.replaceState(null, "", url);
    markActive();
  }

  function markActive() {
    H.list?.querySelectorAll(".hist-item").forEach((el) => el.classList.toggle("active", el.dataset.id === hist.activeId));
  }

  function histItem(it) {
    const tags = (it.tags || []).map((t) => `<span class="tag ${t.tone ? `tag-${t.tone}` : ""}">${UI.esc(t.text)}</span>`).join("");
    const ico = it.icon ? it.icon : it.source === "none" ? "sparkles" : it.source === "url" ? "link" : isAudio ? "music" : "file";
    return `
      <div class="hist-item" data-id="${it.id}" role="button" tabindex="0">
        <span class="hist-ico">${UI.icon(ico, 13)}</span>
        <div class="hist-main">
          <div class="hist-title" title="${UI.esc(it.title)}">${UI.esc(it.title)}</div>
          ${it.subtitle ? `<div class="hist-sub" title="${UI.esc(it.subtitle)}">${UI.esc(it.subtitle)}</div>` : ""}
          <div class="hist-meta">
            <span class="status-dot ${it.mode}" title="${it.mode === "live" ? "Live API" : "Demo data"}"></span>
            ${tags}
            <span class="hist-time" title="${UI.esc(UI.fmtDate(it.created_at))}">#${it.id} · ${UI.esc(UI.ago(it.created_at))}</span>
          </div>
        </div>
        <button type="button" class="icon-btn sm hist-del" data-del="${it.id}" title="Delete">${UI.icon("trash", 12)}</button>
      </div>`;
  }

  async function loadHistory(append = false) {
    if (!historyOn || !H.list) return;
    const my = ++hist.req;
    if (!append) hist.offset = 0;
    try {
      const qs = new URLSearchParams({ limit: hist.limit, offset: hist.offset, q: hist.q });
      const res = await fetch(`/api/features/${slug}/history?${qs}`);
      const data = await res.json();
      if (my !== hist.req) return;                       // a newer request is running
      if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
      if (!data.enabled) {
        H.count.textContent = "";
        H.more.classList.add("hidden");
        H.list.innerHTML = `<div class="hist-off">${UI.icon("alert", 14)}<div><b>Saving is off: database not connected</b>
          <span>${UI.esc(data.error || "")}</span><span>Check the DB_* settings in <code>.env</code>; it reconnects automatically.</span></div></div>`;
        return;
      }
      const html = data.items.map(histItem).join("");
      if (append) H.list.insertAdjacentHTML("beforeend", html);
      else H.list.innerHTML = html || `<div class="hist-note muted small">${hist.q ? "No saved results match your search." : "No saved results yet. Every result you get is saved here."}</div>`;
      hist.offset += data.items.length;
      H.count.textContent = data.total || "";
      H.more.classList.toggle("hidden", hist.offset >= data.total);
      markActive();
    } catch (err) {
      if (my === hist.req) H.list.innerHTML = `<div class="hist-note muted small">Could not load saved results: ${UI.esc(err.message)}</div>`;
    }
  }

  // Put the saved inputs back into the panel so the run can be repeated.
  function restoreInput(payload) {
    if (custom) return custom.restore(payload);
    clearSelection();
    const input = payload.input || {};
    if (form) {
      form.reset();
      [...form.elements].forEach((el) => { if (el.name && input[el.name] != null) el.value = input[el.name]; });
    }
    if (acceptsUrl && input.audio_url) {
      setMode("url");
      const chip = [...(urlSampleList?.querySelectorAll(".sample-chip") || [])].find((c) => c.dataset.url === input.audio_url);
      return pickUrl(input.audio_url, chip);
    }
    setMode("file");
    if (!input.file) return;
    if (payload.source === "sample" && payload.file_url) {
      state.sample = input.file;
      sampleList?.querySelectorAll(".sample-chip").forEach((c) => c.classList.toggle("active", c.title === input.file));
      showSelected(input.file, isAudio ? payload.file_url : null);
    } else if (payload.file_url) {
      state.savedFile = { url: payload.file_url, name: input.file };
      showSelected(input.file, isAudio ? payload.file_url : null);
    } else {
      showSelected(`${input.file} (file not stored)`, null);
    }
  }

  async function openRun(id) {
    if (state.busy || custom?.busy?.()) return UI.toast("Wait for the current run to finish (or stop it) first", "error");
    $("loadingText").textContent = "Loading saved result…";
    els.steps.innerHTML = "";
    setView("loading");
    if (window.innerWidth < 1100) $("resultPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      const res = await fetch(`/api/features/${slug}/history/${id}`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.detail || `Error ${res.status}`);
      restoreInput(payload);
      renderResult(payload);
      setRunParam(payload.run_id);
    } catch (err) {
      setRunParam(null);
      setView("empty");
      UI.toast(`Could not open saved result: ${err.message}`, "error");
    }
  }

  async function deleteRun(id) {
    if (!confirm(`Delete saved result #${id}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/features/${slug}/history/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `Error ${res.status}`);
      if (hist.activeId === String(id)) { setRunParam(null); setView("empty"); }
      UI.toast(`Deleted result #${id}`, "success");
      loadHistory();
    } catch (err) {
      UI.toast(`Delete failed: ${err.message}`, "error");
    }
  }

  if (historyOn && H.list) {
    H.list.addEventListener("click", (e) => {
      const del = e.target.closest("[data-del]");
      if (del) return deleteRun(del.dataset.del);
      const item = e.target.closest(".hist-item");
      if (item) openRun(item.dataset.id);
    });
    H.list.addEventListener("keydown", (e) => {
      const item = e.target.closest(".hist-item");
      if (item && (e.key === "Enter" || e.key === " ") && !e.target.closest("[data-del]")) { e.preventDefault(); openRun(item.dataset.id); }
    });
    H.more.addEventListener("click", () => loadHistory(true));
    $("historyRefresh").addEventListener("click", () => loadHistory());
    let t = null;
    H.search.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => { hist.q = H.search.value.trim(); loadHistory(); }, 250);
    });
  }

  // ---------- Init ----------
  updateRunState();
  const ready = custom?.init({
    app, slug, runBtn, els, setView, renderResult, animateIn, setRunParam, loadHistory,
    steps, startProgress, stopProgress, isLive: app.dataset.mode === "live",
  });
  const initialRun = new URLSearchParams(location.search).get("run");
  Promise.all([loadSamples(), loadUrlSamples(), ready]).then(() => { if (historyOn && /^\d+$/.test(initialRun || "")) openRun(initialRun); });
  loadHistory();
})();
