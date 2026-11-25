/* CRM AI Planner: input panel (demo CRM picker / own JSON, data preview) and the
 * "agents at work" loading board shown while /api/features/crm-ai-planner/run is running. */
(function () {
  "use strict";
  const SLUG = "crm-ai-planner";
  const { esc, icon } = window.UI;
  const K = window.PlannerKit;
  const $ = (id) => document.getElementById(id);

  let api = null, el = {};
  let scenarios = [];
  let sel = null;                 // scenario id or "custom"
  let custom = null;              // parsed custom CRM (valid) or null
  let customErr = "";
  let job = null;
  const live = () => el.root?.dataset.live === "true";

  // ---------------------------------------------------------------- helpers
  const COLLS = ["all_tasks", "all_followups", "all_notes", "all_calls", "all_messages"];
  const total = (crm) => COLLS.reduce((n, c) => n + (Array.isArray(crm?.[c]) ? crm[c].length : 0), 0);
  const current = () => (sel === "custom" ? custom : scenarios.find((s) => s.id === sel)?.crm) || null;
  const meta = () => (sel === "custom" ? { industry: "Your CRM", title: "Custom data", persona: "", icon: "code", accent: "slate" } : scenarios.find((s) => s.id === sel) || {});

  function checkCustom(text) {
    custom = null; customErr = "";
    if (!text.trim()) return;
    let d;
    try { d = JSON.parse(text); } catch (e) { customErr = `Not valid JSON: ${e.message.replace(/^JSON\.parse: /, "")}`; return; }
    if (!d || typeof d !== "object" || Array.isArray(d)) { customErr = "The JSON must be an object."; return; }
    if (!String(d.user_name || "").trim()) { customErr = "Missing \"user_name\"."; return; }
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(d.today || ""))) { customErr = "\"today\" must be a date like 2026-09-06."; return; }
    const bad = COLLS.find((c) => d[c] != null && !Array.isArray(d[c]));
    if (bad) { customErr = `"${bad}" must be a list.`; return; }
    if (!total(d)) { customErr = "No tasks, follow-ups, notes, calls or messages found."; return; }
    custom = d;
  }

  // Facts we can see before the AI runs (shown as "at a glance").
  function glance(crm) {
    const today = String(crm.today || "");
    const done = /^(done|completed|closed)$/i;
    const overdueT = (crm.all_tasks || []).filter((t) => t.date && t.date < today).length;
    const overdueF = (crm.all_followups || []).filter((f) => f.due_date && f.due_date < today && !done.test(f.status || "")).length;
    const todayT = (crm.all_tasks || []).filter((t) => t.date === today).length + (crm.all_followups || []).filter((f) => f.due_date === today).length;
    const unread = (crm.all_messages || []).filter((m) => m.is_read === false && String(m.direction).toLowerCase() === "inbound").length;
    const snoozed = (crm.all_followups || []).filter((f) => /snooz/i.test(f.status || "")).length;
    const transcripts = (crm.all_calls || []).filter((c) => String(c.transcript || "").trim()).length;
    return [
      todayT && { ic: "calendar", t: `${todayT} due today`, tone: "indigo" },
      overdueT + overdueF && { ic: "clock", t: `${overdueT + overdueF} overdue`, tone: "red" },
      unread && { ic: "inbox", t: `${unread} unread`, tone: "amber" },
      snoozed && { ic: "repeat", t: `${snoozed} snoozed`, tone: "slate" },
      transcripts && { ic: "phone", t: `${transcripts} transcripts`, tone: "green" },
    ].filter(Boolean);
  }

  // ---------------------------------------------------------------- render input
  function renderScenarios() {
    el.scns.innerHTML = scenarios.map((s, i) => `
      <button type="button" class="pl-scn a-${esc(s.accent)} ${s.id === sel ? "active" : ""}" role="radio" aria-checked="${s.id === sel}" data-scn="${esc(s.id)}" style="--i:${i}">
        <span class="pl-scn-ico">${icon(s.icon, 16)}</span>
        <span class="pl-scn-main"><small>${esc(s.industry)}</small><b>${esc(s.crm.user_name || "")}</b><em>${esc(s.title)}</em></span>
        <span class="pl-scn-n">${total(s.crm)}<small>records</small></span>
        <span class="pl-scn-tick">${icon("check", 11)}</span>
      </button>`).join("") || `<p class="muted small">No demo CRMs found.</p>`;
  }

  function renderSummary() {
    const crm = current(), mt = meta();
    el.ownToggle.classList.toggle("active", sel === "custom");
    if (!crm) {
      el.sum.innerHTML = sel === "custom"
        ? `<div class="pl-sum-empty ${customErr ? "bad" : ""}">${icon(customErr ? "alert" : "code", 14)} ${esc(customErr || "Paste or upload CRM JSON above.")}</div>`
        : `<span class="muted small">Pick a CRM above.</span>`;
      return updateRun();
    }
    const counts = COLLS.map((c, i) => ({ t: K.TYPE_ORDER[i], n: (crm[c] || []).length }));
    const max = Math.max(1, ...counts.map((c) => c.n));
    el.sum.innerHTML = `
      <div class="pl-sum-card a-${esc(mt.accent || "blue")}">
        <div class="pl-sum-who">${K.avatar(crm.user_name || "?", "md")}
          <div><b>${esc(crm.user_name || "")}</b><small>${esc([mt.title, mt.industry].filter(Boolean).join(" · "))}</small></div>
          <button type="button" class="icon-btn sm" data-preview title="Preview the CRM data" aria-label="Preview the CRM data">${icon("eye", 13)}</button>
        </div>
        <div class="pl-sum-when"><span>${icon("calendar", 11)} ${esc(K.fmtDay(crm.today, { weekday: "short", day: "numeric", month: "short", year: "numeric" }))}</span>
          ${crm.working_hours ? `<span>${icon("clock", 11)} ${esc(crm.working_hours)}</span>` : ""}${crm.timezone ? `<span>${icon("globe", 11)} ${esc(crm.timezone)}</span>` : ""}</div>
        ${mt.persona ? `<p class="pl-persona">${esc(mt.persona)}</p>` : ""}
        <div class="pl-sum-bars">${counts.map((c) => `
          <button type="button" class="pl-sbar t-${c.t}" data-preview="${c.t}" title="Preview ${K.TYPES[c.t].plural.toLowerCase()}">
            <span>${icon(K.TYPES[c.t].icon, 12)} ${K.TYPES[c.t].plural}</span><div><i style="width:${(c.n / max) * 100}%"></i></div><b>${c.n}</b></button>`).join("")}</div>
        ${glance(crm).length ? `<div class="pl-glance"><small>At a glance</small>${glance(crm).map((g) => `<span class="g-${g.tone}">${icon(g.ic, 11)} ${esc(g.t)}</span>`).join("")}</div>` : ""}
      </div>`;
    updateRun();
  }

  function updateRun() {
    const crm = current();
    const blocked = sel === "custom" && !live();
    el.run.disabled = !!job || !crm || blocked;
    el.runLabel.textContent = job ? "Planning…" : blocked ? "Needs the live API" : api ? "Plan my day" : "Plan my day";
  }

  function select(id) {
    sel = id;
    el.scns.querySelectorAll(".pl-scn").forEach((b) => { const on = b.dataset.scn === id; b.classList.toggle("active", on); b.setAttribute("aria-checked", on); });
    renderSummary();
  }

  function setOwnOpen(open) {
    el.own.classList.toggle("hidden", !open);
    el.ownToggle.setAttribute("aria-expanded", open);
  }

  function onJson() {
    checkCustom(el.json.value);
    el.jsonStat.className = custom ? "ok" : customErr ? "bad" : "muted";
    el.jsonStat.textContent = custom
      ? `✓ ${custom.user_name} · ${K.fmtDay(custom.today, { day: "numeric", month: "short", year: "numeric" })} · ${total(custom)} records`
      : customErr || "Paste JSON, or start from a template.";
    if (el.json.value.trim()) select("custom");
    else if (sel === "custom") select(scenarios[0]?.id || null);
  }

  function preview(type) {
    const crm = current();
    if (!crm) return;
    const { view, ctx } = K.previewView(crm, `${crm.user_name}'s CRM`);
    K.drawer.open(view, ctx);
    if (type) K.drawer.el.querySelector(`[data-ptab="${type}"]`)?.click();
  }

  // ---------------------------------------------------------------- run
  async function run() {
    if (job) return;
    const crm = current();
    if (!crm) return UI.toast("Pick a CRM first", "error");
    if (sel === "custom" && !live()) return UI.toast("Your own CRM data needs the live API", "error");
    job = { started: performance.now() };
    updateRun();
    api.setRunParam(null);
    board.mount(crm);
    if (window.innerWidth < 1100) $("resultPanel").scrollIntoView({ behavior: "smooth", block: "start" });

    const fd = new FormData();
    fd.append("params", JSON.stringify(sel === "custom" ? { scenario: "custom", crm } : { scenario: sel }));
    try {
      const res = await fetch(`/api/features/${SLUG}/run`, { method: "POST", body: fd });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.detail || `Request failed (${res.status})`);
      await board.complete();
      api.renderResult(payload);
      const a = payload.data?.ai_response || {};
      const errs = (payload.data?.errors || []).length;
      if (errs) UI.toast(`The AI service reported ${errs} agent error${errs === 1 ? "" : "s"}: showing a partial plan`, "error");
      else UI.toast(`Plan ready: ${(a.today_plan || []).length} items, ${(a.must_not_slip || []).length} must not slip`, "success");
      if (payload.run_id) { api.setRunParam(payload.run_id); api.loadHistory(); }
      else if (payload.history_error) UI.toast(`Result not saved: ${payload.history_error}`, "error");
    } catch (err) {
      board.stop();
      api.els.body.innerHTML = `<div class="alert-error"><b>Planning failed.</b> ${esc(err.message)}</div>`;
      api.setView("body");
      UI.toast(err.message, "error");
    } finally {
      job = null;
      updateRun();
    }
  }

  // ---------------------------------------------------------------- loading board
  const AGENTS = [
    { k: "task", name: "Task agent", ic: "checksq", types: ["task", "followup", "note"], verb: "Checking" },
    { k: "call", name: "Call agent", ic: "phone", types: ["call"], verb: "Listening to" },
    { k: "conv", name: "Conversation agent", ic: "chat", types: ["message"], verb: "Reading" },
  ];
  const SYNTH_LINES = [
    "Looking for promises you made on calls…", "Checking who is waiting for your reply…", "Spotting leads going cold…",
    "Ranking what must not slip…", "Fitting the work around fixed meetings…", "Finding schedule conflicts…", "Writing your day summary…",
  ];

  const board = {
    t: null, clock: null, root: null,
    mount(crm) {
      const ix = K.indexCrm(crm);
      const recs = [...ix.byId.values()].sort((a, b) => K.TYPE_ORDER.indexOf(a.type) - K.TYPE_ORDER.indexOf(b.type));
      // interleave the three agents' records so all lanes move at once
      const lanes = AGENTS.map((a) => recs.filter((r) => a.types.includes(r.type)));
      const order = [];
      for (let i = 0; order.length < recs.length; i++) lanes.forEach((l) => { if (l[i]) order.push(l[i]); });
      const wh = K.workHours(crm.working_hours);
      this.s = { ix, order, pos: 0, done: false, responded: false, synth: 0, resolve: null, lanes, wh };
      const line = (r) => {
        const x = r.r;
        if (r.type === "call") return x.transcript ? `${x.lead_name}'s call (${Math.round((x.duration_seconds || 0) / 60) || "<1"} min)` : `${x.lead_name}: ${String(x.outcome || "no answer").toLowerCase()}`;
        if (r.type === "message") return `${x.channel || "Message"} ${String(x.direction).toLowerCase() === "outbound" ? "to" : "from"} ${x.lead_name}${x.is_read === false ? " (unread)" : ""}`;
        if (r.type === "followup") return `follow-up for ${x.lead_name}${x.due_date && x.due_date < crm.today ? " (overdue)" : ""}`;
        if (r.type === "note") return `note on ${x.lead_name}`;
        return `${String(x.task_type || "task").toLowerCase()} with ${x.lead_name}${x.date && x.date < crm.today ? " (overdue)" : ""}`;
      };
      this.s.line = line;
      const hours = Math.max(1, Math.round((wh.e - wh.s) / 60));
      api.els.body.innerHTML = `
        <div class="pl-boot">
          <div class="pl-boot-head">
            <div class="pl-orb" aria-hidden="true"><i></i><i></i><i></i><span>${icon("sparkles", 18)}</span></div>
            <div class="pl-boot-title"><strong>Planning ${esc(ix.first)}'s day…</strong><small data-b-sub>Sending ${recs.length} CRM records to the AI agents</small></div>
            <span class="pl-boot-time" data-b-time>0:00</span>
          </div>
          <div class="pl-boot-bar"><i data-b-bar></i></div>
          <div class="pl-boot-flow">
            <div class="pl-boot-feed" aria-hidden="true"><div class="pl-feed-in" data-b-feed>${order.map((r, i) => `
              <div class="pl-bchip t-${r.type}" data-k="${i}">${icon(K.TYPES[r.type].icon, 11)}<b>${esc(r.id)}</b><span>${esc(r.r.lead_name || "")}</span></div>`).join("")}</div></div>
            <div class="pl-boot-agents">
              ${AGENTS.map((a, i) => `
                <div class="pl-bag" data-agent="${a.k}">
                  <span class="pl-bag-ico">${icon(a.ic, 15)}</span>
                  <div class="pl-bag-main"><b>${a.name}</b><small data-a-now>${lanes[i].length ? "Waiting…" : "Nothing to read"}</small>
                    <div class="pl-bag-bar"><i data-a-bar></i></div></div>
                  <span class="pl-bag-n" data-a-n>0/${lanes[i].length}</span>
                </div>`).join("")}
              <div class="pl-merge" aria-hidden="true"><i></i><i></i><i></i></div>
              <div class="pl-bag synth" data-agent="synth">
                <span class="pl-bag-ico">${icon("sparkles", 15)}</span>
                <div class="pl-bag-main"><b>Planner</b><small data-a-now>Waits for the three reports</small>
                  <div class="pl-sk" aria-hidden="true">${[0, 1, 2, 3, 4, 5].map((i) => `<i style="--i:${i}"></i>`).join("")}</div></div>
                <span class="pl-bag-n" data-a-n>${hours}h day</span>
              </div>
            </div>
          </div>
          <div class="pl-boot-tick" data-b-tick>${icon("sparkles", 12)} <span>Connecting to the agents…</span></div>
          ${live() ? `<p class="pl-boot-note muted small">A full plan usually takes 30–60 seconds: four AI agents read every record.</p>` : ""}
        </div>`;
      api.setView("body");
      this.root = api.els.body.querySelector(".pl-boot");
      clearInterval(this.clock);
      this.clock = setInterval(() => {
        const s = (performance.now() - job?.started || 0) / 1000;
        const t = this.root?.querySelector("[data-b-time]");
        if (t && job) t.textContent = UI.fmtTime(s);
      }, 500);
      this.step();
    },
    q(sel) { return this.root?.querySelector(sel); },
    agentOf(type) { return AGENTS.find((a) => a.types.includes(type)); },
    step() {
      const s = this.s;
      if (!this.root?.isConnected) return;
      if (s.pos < s.order.length) {
        const r = s.order[s.pos];
        const chip = this.q(`[data-k="${s.pos}"]`);
        this.root.querySelectorAll(".pl-bchip.reading").forEach((c) => { c.classList.remove("reading"); c.classList.add("read"); });
        chip?.classList.add("reading");
        const feed = this.q("[data-b-feed]");
        if (chip && feed) feed.style.transform = `translateY(${-Math.max(0, chip.offsetTop - 64)}px)`;
        const a = this.agentOf(r.type), ai = AGENTS.indexOf(a);
        const card = this.q(`[data-agent="${a.k}"]`);
        const doneN = s.order.slice(0, s.pos + 1).filter((x) => a.types.includes(x.type)).length;
        card.classList.add("busy");
        card.querySelector("[data-a-now]").textContent = `${a.verb} ${s.line(r)}`;
        card.querySelector("[data-a-bar]").style.width = `${(doneN / s.lanes[ai].length) * 100}%`;
        card.querySelector("[data-a-n]").textContent = `${doneN}/${s.lanes[ai].length}`;
        if (doneN === s.lanes[ai].length) setTimeout(() => this.agentDone(a), s.responded ? 60 : 420);
        this.q("[data-b-bar]").style.width = `${((s.pos + 1) / s.order.length) * 72}%`;
        this.q("[data-b-sub]").textContent = `${s.pos + 1} of ${s.order.length} records read`;
        if (s.pos % 3 === 0) this.tick(`${a.verb} ${s.line(r)}`);
        s.pos++;
        this.t = setTimeout(() => this.step(), s.responded ? 45 : 360 + Math.random() * 160);
        return;
      }
      // all records read -> planner merges the reports
      if (!s.done) {
        s.done = true;
        this.root.querySelectorAll(".pl-bchip.reading").forEach((c) => { c.classList.remove("reading"); c.classList.add("read"); });
        AGENTS.forEach((a) => this.agentDone(a));
        this.root.classList.add("merging");
        const syn = this.q('[data-agent="synth"]');
        syn.classList.add("busy");
        this.q("[data-b-sub]").textContent = "The planner is merging the agents' reports";
      }
      const syn = this.q('[data-agent="synth"]');
      const line = SYNTH_LINES[s.synth % SYNTH_LINES.length];
      syn.querySelector("[data-a-now]").textContent = line;
      this.tick(line);
      this.q("[data-b-bar]").style.width = `${Math.min(96, 72 + s.synth * 3.5)}%`;
      s.synth++;
      if (s.responded && s.synth >= 2) {
        syn.classList.remove("busy");
        syn.classList.add("done");
        syn.querySelector("[data-a-now]").textContent = "Plan ready";
        this.q("[data-b-bar]").style.width = "100%";
        this.root.classList.add("ready");
        clearInterval(this.clock);
        this.t = setTimeout(() => s.resolve?.(), 550);
        return;
      }
      this.t = setTimeout(() => this.step(), s.responded ? 380 : 1700);
    },
    agentDone(a) {
      const card = this.q(`[data-agent="${a.k}"]`);
      if (!card || card.classList.contains("done")) return;
      card.classList.remove("busy");
      card.classList.add("done");
      const n = this.s.lanes[AGENTS.indexOf(a)].length;
      card.querySelector("[data-a-now]").textContent = n ? `Report ready · ${n} item${n === 1 ? "" : "s"}` : "Nothing to read";
      card.querySelector("[data-a-bar]").style.width = "100%";
    },
    tick(text) {
      const t = this.q("[data-b-tick] span");
      if (!t) return;
      t.classList.remove("in"); void t.offsetWidth;
      t.textContent = text;
      t.classList.add("in");
    },
    // response arrived: fast-forward the animation, resolve when it has finished
    complete() {
      if (!this.root?.isConnected || !this.s) return Promise.resolve();
      return new Promise((resolve) => {
        this.s.resolve = resolve;
        this.s.responded = true;
        clearTimeout(this.t);
        this.step();
        setTimeout(resolve, 6000);                       // never block the result
      });
    },
    stop() { clearTimeout(this.t); clearInterval(this.clock); },
  };

  // ---------------------------------------------------------------- controller
  window.InputControllers = window.InputControllers || {};
  window.InputControllers[SLUG] = {
    async init(a) {
      api = a;
      el = {
        root: $("plIn"), scns: $("plScenarios"), sum: $("plSum"), run: $("runBtn"), runLabel: $("plRunLabel"),
        ownToggle: $("plOwnToggle"), own: $("plOwn"), json: $("plJson"), jsonStat: $("plJsonStat"),
        file: $("plFile"), drop: $("plDrop"),
      };
      el.scns.addEventListener("click", (e) => { const b = e.target.closest("[data-scn]"); if (b && !job) select(b.dataset.scn); });
      el.scns.addEventListener("keydown", (e) => {
        if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
        const ids = scenarios.map((s) => s.id), i = Math.max(0, ids.indexOf(sel));
        const n = ids[(i + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length];
        e.preventDefault(); select(n); el.scns.querySelector(`[data-scn="${n}"]`)?.focus();
      });
      el.sum.addEventListener("click", (e) => { const p = e.target.closest("[data-preview]"); if (p) preview(p.dataset.preview); });
      el.ownToggle.addEventListener("click", () => {
        const open = el.own.classList.contains("hidden");
        setOwnOpen(open);
        if (open) { el.json.focus(); if (custom) select("custom"); }
        else if (sel === "custom") select(scenarios[0]?.id || null);
      });
      let t = null;
      el.json.addEventListener("input", () => { clearTimeout(t); t = setTimeout(onJson, 250); });
      $("plTemplate").addEventListener("click", () => {
        const base = (sel !== "custom" && current()) || scenarios[0]?.crm;
        if (!base) return;
        el.json.value = JSON.stringify(base, null, 2);
        onJson();
        UI.toast("Template loaded: edit it, then plan the day");
      });
      $("plDownload").addEventListener("click", () => {
        const crm = current() || scenarios[0]?.crm;
        if (crm) UI.download(`crm-${(crm.user_name || "data").toLowerCase().replace(/\W+/g, "-")}.json`, JSON.stringify(crm, null, 2));
      });
      const readFile = (f) => {
        if (!f) return;
        if (f.size > 5 * 1024 * 1024) return UI.toast("That file is larger than 5 MB", "error");
        f.text().then((txt) => { el.json.value = txt; onJson(); }).catch(() => UI.toast("Could not read the file", "error"));
      };
      el.file.addEventListener("change", () => { readFile(el.file.files[0]); el.file.value = ""; });
      ["dragenter", "dragover"].forEach((ev) => el.drop.addEventListener(ev, (e) => { e.preventDefault(); el.drop.classList.add("drag"); }));
      ["dragleave", "drop"].forEach((ev) => el.drop.addEventListener(ev, (e) => { e.preventDefault(); el.drop.classList.remove("drag"); }));
      el.drop.addEventListener("drop", (e) => readFile(e.dataTransfer.files[0]));

      updateRun();
      try {
        const res = await fetch("/api/crm-planner/scenarios");
        scenarios = await res.json();
        if (!res.ok || !Array.isArray(scenarios)) throw new Error();
      } catch {
        scenarios = [];
        el.scns.innerHTML = `<p class="muted small">Could not load the demo CRMs.</p>`;
      }
      if (scenarios.length) {
        sel = scenarios[0].id;
        renderScenarios();
        renderSummary();
      }
    },
    run,
    busy: () => !!job,
    restore(payload) {
      const input = payload.input || {};
      if (input.scenario && input.scenario !== "custom" && scenarios.some((s) => s.id === input.scenario)) {
        setOwnOpen(false);
        return select(input.scenario);
      }
      if (input.crm && typeof input.crm === "object") {
        setOwnOpen(true);
        el.json.value = JSON.stringify(input.crm, null, 2);
        onJson();
      }
    },
  };
})();
