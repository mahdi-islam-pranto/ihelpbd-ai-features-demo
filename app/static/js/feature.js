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

  const $ = (id) => document.getElementById(id);
  const fileInput = $("fileInput"), dropzone = $("dropzone"), sampleList = $("sampleList");
  const selectedBox = $("selectedFile"), selectedName = $("selectedName"), clearBtn = $("clearFile");
  const player = $("player") ? window.createAudioPlayer($("player")) : null;
  const audioPlayer = player?.audio || null, runBtn = $("runBtn"), form = $("inputForm");
  const els = { empty: $("resultEmpty"), loading: $("resultLoading"), body: $("resultBody"), steps: $("progressSteps") };

  const state = { file: null, sample: null, objectUrl: null, busy: false };

  // ---------- Input selection ----------
  function updateRunState() {
    runBtn.disabled = state.busy || (fileRequired && !(state.file || state.sample));
  }

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
    if (form && !form.reportValidity()) return;
    const params = form ? Object.fromEntries(new FormData(form).entries()) : {};
    const fd = new FormData();
    fd.append("params", JSON.stringify(params));
    if (state.file) fd.append("file", state.file);
    else if (state.sample) { fd.append("sample", state.sample); fd.append("sample_kind", fileKind); }

    state.busy = true;
    updateRunState();
    setView("loading");
    startProgress();
    if (window.innerWidth < 1100) $("resultPanel").scrollIntoView({ behavior: "smooth", block: "start" });

    try {
      const res = await fetch(`/api/features/${slug}/run`, { method: "POST", body: fd });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.detail || `Request failed (${res.status})`);
      stopProgress();
      renderResult(payload);
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
    const ctx = { audio: audioPlayer, input: payload.input || {} };
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

  loadSamples();
  updateRunState();
})();
