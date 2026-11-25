/* CRM AI Planner: dashboard view (Renderers["crm-ai-planner"]) and a shared kit (window.PlannerKit)
 * that planner_input.js reuses for the CRM preview and the loading board.
 * Response contract: api_docs/crm_planner.md. ctx.input.crm = the CRM data that was sent. */
(function () {
  "use strict";
  const { esc, icon } = window.UI;

  // ================================================================ CRM records
  const TYPES = {
    task: { label: "Task", plural: "Tasks", icon: "checksq", coll: "all_tasks", key: "task_id" },
    followup: { label: "Follow-up", plural: "Follow-ups", icon: "repeat", coll: "all_followups", key: "followup_id" },
    note: { label: "Note", plural: "Notes", icon: "note", coll: "all_notes", key: "note_id" },
    call: { label: "Call", plural: "Calls", icon: "phone", coll: "all_calls", key: "call_id" },
    message: { label: "Message", plural: "Messages", icon: "mail", coll: "all_messages", key: "message_id" },
  };
  const TYPE_ORDER = ["task", "followup", "note", "call", "message"];

  const CHANNELS = {
    call: { icon: "phone", c: "call", label: "Call" },
    meeting: { icon: "users", c: "meet", label: "Meeting" },
    email: { icon: "mail", c: "mail", label: "Email" },
    sms: { icon: "chat", c: "sms", label: "SMS" },
    whatsapp: { icon: "chat", c: "sms", label: "WhatsApp" },
    task: { icon: "checksq", c: "task", label: "Task" },
    "check-in": { icon: "repeat", c: "task", label: "Check-in" },
  };
  const chan = (v) => CHANNELS[String(v || "").toLowerCase()] || { icon: "sparkles", c: "other", label: v || "Other" };

  function indexCrm(crm) {
    crm = crm && typeof crm === "object" ? crm : {};
    const byId = new Map(), leads = new Map(), byLead = new Map(), threads = new Map();
    TYPE_ORDER.forEach((type) => {
      const t = TYPES[type];
      (Array.isArray(crm[t.coll]) ? crm[t.coll] : []).forEach((r) => {
        if (!r || typeof r !== "object") return;
        const rec = { type, r, id: String(r[t.key] ?? "") };
        if (rec.id) byId.set(rec.id, rec);
        const lid = r.lead_id || r.lead_name;
        if (lid) {
          if (!leads.has(lid)) leads.set(lid, { id: lid, name: r.lead_name || r.contact_name || lid, company: r.company_name || "" });
          else if (!leads.get(lid).company && r.company_name) leads.get(lid).company = r.company_name;
          if (!byLead.has(lid)) byLead.set(lid, []);
          byLead.get(lid).push(rec);
        }
        if (type === "message" && r.thread_id) {
          if (!threads.has(r.thread_id)) threads.set(r.thread_id, []);
          threads.get(r.thread_id).push(r);
        }
      });
    });
    threads.forEach((list) => list.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)));
    const user = String(crm.user_name || "").trim();
    return { crm, byId, leads, byLead, threads, user, first: user.split(/\s+/)[0] || "You" };
  }

  // ================================================================ formatting
  const toMin = (t) => { const m = String(t || "").match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
  const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const dur = (min) => { min = Math.round(min); return min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ""}` : `${min}m`; };
  const workHours = (wh) => {
    const [a, b] = String(wh || "").split("-").map(toMin);
    return a != null && b != null && b > a ? { s: a, e: b } : { s: 540, e: 1080 };
  };
  const parseDay = (iso) => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
  const fmtDay = (iso, opts = { weekday: "long", day: "numeric", month: "long", year: "numeric" }) => {
    const d = parseDay(iso); return d ? d.toLocaleDateString(undefined, { ...opts, timeZone: "UTC" }) : String(iso || "");
  };
  const fmtShort = (iso) => fmtDay(iso, { day: "numeric", month: "short" });
  const fmtSecs = (s) => { s = Number(s) || 0; return s >= 60 ? `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s` : `${Math.round(s)}s`; };
  const cap = (s) => String(s || "").replace(/^\w/, (c) => c.toUpperCase());
  const initials = (n) => String(n || "?").replace(/^(dr|mr|mrs|ms)\.?\s+/i, "").trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const hue = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  const avatar = (name, size = "") => `<span class="pl-av ${size}" style="--h:${hue(name)}" aria-hidden="true">${esc(initials(name))}</span>`;
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  // ================================================================ drawer (shared)
  const drawer = {
    el: null, stack: [], ctx: null,
    ensure() {
      if (this.el?.isConnected) return this.el;
      const el = document.createElement("div");
      el.className = "pl-drawer";
      el.hidden = true;
      el.innerHTML = `<div class="pl-drawer-bg" data-close></div>
        <aside class="pl-panel" role="dialog" aria-modal="true" tabindex="-1">
          <header class="pl-panel-head">
            <button type="button" class="icon-btn sm pl-back hidden" data-back title="Back" aria-label="Back">${icon("arrowl", 13)}</button>
            <div class="pl-panel-title"><small data-sub></small><h3 data-title></h3></div>
            <button type="button" class="icon-btn sm" data-close title="Close (Esc)" aria-label="Close">${icon("x", 13)}</button>
          </header>
          <div class="pl-panel-body" data-body></div>
        </aside>`;
      document.body.appendChild(el);
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-close]")) return this.close();
        if (e.target.closest("[data-back]")) { this.stack.pop(); return this.show(this.stack[this.stack.length - 1]); }
        const tab = e.target.closest("[data-ptab]");
        if (tab) {
          el.querySelectorAll("[data-ptab]").forEach((b) => b.classList.toggle("active", b === tab));
          el.querySelectorAll("[data-ppane]").forEach((p) => p.classList.toggle("hidden", p.dataset.ppane !== tab.dataset.ptab));
          return;
        }
        const copy = e.target.closest("[data-copy-text]");
        if (copy) return UI.copy(copy.dataset.copyText);
        if (this.ctx) handleLinks(e, this.ctx, true);
      });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !el.hidden) this.close(); });
      this.el = el;
      return el;
    },
    open(view, ctx, push = false) {
      this.ensure();
      this.ctx = ctx || this.ctx;
      if (push && !this.el.hidden) this.stack.push(view); else this.stack = [view];
      this.show(view);
      if (this.el.hidden) {
        this.el.hidden = false;
        document.documentElement.classList.add("pl-noscroll");
        requestAnimationFrame(() => this.el.classList.add("open"));
      }
      this.el.querySelector(".pl-panel").focus({ preventScroll: true });
    },
    show(view) {
      const el = this.el;
      el.querySelector("[data-title]").innerHTML = view.title;
      el.querySelector("[data-sub]").innerHTML = view.sub || "";
      const body = el.querySelector("[data-body]");
      body.innerHTML = view.html;
      body.scrollTop = 0;
      el.querySelector("[data-back]").classList.toggle("hidden", this.stack.length < 2);
      body.querySelectorAll("[data-w]").forEach((b) => requestAnimationFrame(() => { b.style.width = b.dataset.w; }));
      body.querySelector(".pl-hl")?.scrollIntoView({ block: "center" });
    },
    close() {
      if (!this.el || this.el.hidden) return;
      this.el.classList.remove("open");
      document.documentElement.classList.remove("pl-noscroll");
      setTimeout(() => { if (!this.el.classList.contains("open")) this.el.hidden = true; }, 220);
    },
  };

  // ---------- record views
  const kv = (rows) => `<dl class="pl-kv">${rows.filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
  const prioTag = (p) => p ? `<span class="pl-prio p-${esc(String(p).toLowerCase())}">${esc(p)}</span>` : "";
  const leadLink = (ix, id, name) => {
    const info = ix.leads.get(id) || {};
    const n = name || info.name || id;
    return id || n ? `<button type="button" class="pl-leadlink" data-lead="${esc(id || n)}">${avatar(n, "xs")}${esc(n)}</button>` : "";
  };
  const srcChip = (ix, id, label) => {
    const rec = ix.byId.get(id);
    const t = rec ? TYPES[rec.type] : null;
    return `<button type="button" class="pl-src" data-src="${esc(id)}" title="Open ${esc(t ? t.label.toLowerCase() : "record")} ${esc(id)}">${icon(t?.icon || "file", 11)}${esc(label || id)}</button>`;
  };

  function transcriptHtml(text, me) {
    text = String(text || "").trim();
    if (!text) return "";
    const re = /(^|[\s.!?"'])([A-Z][A-Za-z'-]{1,20}):\s+/g;
    const marks = [];
    let m;
    while ((m = re.exec(text))) marks.push({ at: m.index + m[1].length, end: re.lastIndex, who: m[2] });
    if (!marks.length) return `<p class="pl-quote">${esc(text)}</p>`;
    const meKey = String(me || "").toLowerCase();
    return `<div class="pl-chat">${marks.map((k, i) => {
      const said = text.slice(k.end, marks[i + 1] ? marks[i + 1].at : undefined).trim();
      const mine = k.who.toLowerCase() === meKey;
      return `<div class="pl-bub ${mine ? "me" : "them"}"><small>${esc(k.who)}</small><p>${esc(said)}</p></div>`;
    }).join("")}</div>`;
  }

  function threadHtml(ix, threadId, focusId) {
    const msgs = ix.threads.get(threadId) || [];
    if (!msgs.length) return "";
    return `<div class="pl-thread">${msgs.map((r) => {
      const out = String(r.direction || "").toLowerCase() === "outbound";
      return `<div class="pl-msg ${out ? "me" : "them"} ${r.message_id === focusId ? "pl-hl" : ""}">
        <div class="pl-msg-meta">${icon(chan(r.channel).icon, 11)} ${esc(out ? ix.first : r.lead_name || "Lead")} · ${esc(fmtShort(r.date))} ${esc(String(r.time || "").slice(0, 5))}
          ${r.is_read === false ? `<span class="pl-unread">Unread</span>` : ""}</div>
        ${r.subject ? `<b>${esc(r.subject)}</b>` : ""}<p>${esc(r.content || "")}</p></div>`;
    }).join("")}</div>`;
  }

  function recordView(ix, id) {
    const rec = ix.byId.get(id);
    if (!rec) return { title: esc(id), sub: "Record", html: `<p class="empty-note">This record isn't in the CRM data that was sent.</p>` };
    const { type, r } = rec, t = TYPES[type];
    const sub = `<span class="pl-type t-${type}">${icon(t.icon, 11)} ${t.label}</span> ${esc(id)}`;
    const lead = leadLink(ix, r.lead_id, r.lead_name);
    const company = r.company_name ? esc(r.company_name) : "";
    const last = r.last_interaction_days != null && r.last_interaction_days !== "" ? `${esc(r.last_interaction_days)} days ago` : "";
    let title = "", body = "", rows = [];
    if (type === "task") {
      title = r.task_details || "Task";
      rows = [["Type", esc(r.task_type)], ["When", `${esc(fmtDay(r.date, { weekday: "short", day: "numeric", month: "short" }))} ${esc(String(r.time || "").slice(0, 5))}`],
        ["Priority", prioTag(r.priority)], ["Lead", lead], ["Company", company], ["Last contact", last]];
    } else if (type === "followup") {
      title = r.followup_details || "Follow-up";
      rows = [["Type", esc(r.followup_type)], ["Due", `${esc(fmtDay(r.due_date, { weekday: "short", day: "numeric", month: "short" }))}${r.due_time ? " " + esc(String(r.due_time).slice(0, 5)) : ""}`],
        ["Status", `<span class="pl-status s-${esc(String(r.status || "").toLowerCase())}">${esc(r.status)}</span>`], ["Priority", prioTag(r.priority)], ["Lead", lead], ["Company", company], ["Last contact", last]];
    } else if (type === "note") {
      title = r.note_type || "Note";
      rows = [["Written", esc(fmtDay(r.date, { day: "numeric", month: "short", year: "numeric" }))], ["Lead", lead], ["Company", company]];
      body = `<blockquote class="pl-quote">${esc(r.content || "")}</blockquote>`;
    } else if (type === "call") {
      title = `${cap(r.direction || "")} call · ${r.outcome || ""}`;
      rows = [["When", `${esc(fmtDay(r.date, { weekday: "short", day: "numeric", month: "short" }))} ${esc(String(r.time || "").slice(0, 5))}`],
        ["Duration", esc(fmtSecs(r.duration_seconds))], ["Outcome", esc(r.outcome)], ["Lead", lead], ["Company", company]];
      body = `<div class="sub-title">Transcript</div>${transcriptHtml(r.transcript, ix.first) || `<p class="empty-note">No transcript (${esc(r.outcome || "not answered")}).</p>`}`;
    } else {
      title = r.subject || `${r.channel || "Message"} from ${r.lead_name || "lead"}`;
      rows = [["Channel", esc(r.channel)], ["Direction", esc(r.direction)], ["Lead", lead], ["Company", company]];
      body = `<div class="sub-title">Conversation</div>${threadHtml(ix, r.thread_id, r.message_id) || `<p class="pl-quote">${esc(r.content || "")}</p>`}`;
    }
    return { title: esc(title), sub, html: `${kv(rows)}${body}` };
  }

  // ================================================================ AI response model
  function normalize(d) {
    d = d && typeof d === "object" ? d : {};
    const a = d.ai_response && typeof d.ai_response === "object" ? d.ai_response : d;
    const arr = (k) => (Array.isArray(a[k]) ? a[k].filter((x) => x && typeof x === "object") : []);
    const obj = (k) => (a[k] && typeof a[k] === "object" && !Array.isArray(a[k]) ? a[k] : {});
    return {
      plan: arr("today_plan"), mns: arr("must_not_slip"), risks: arr("lead_risk_alerts"), promises: arr("open_commitments"),
      overdue: arr("overdue_items"), wins: arr("quick_wins"), prep: arr("upcoming_preparation_items"), notes: arr("key_notes_insights"),
      calls: arr("call_insights"), convos: arr("conversation_insights"), briefs: arr("call_prep_briefs"),
      work: obj("workload_insights"), counts: obj("counts"),
      conflicts: (Array.isArray(a.schedule_conflicts) ? a.schedule_conflicts : []).filter(Boolean).map(String),
      tip: a.productivity_tip || "", summary: a.daily_summary || "",
      agents: (Array.isArray(d.agent_metadata) ? d.agent_metadata : []).filter((x) => x && typeof x === "object"),
      errors: (Array.isArray(d.errors) ? d.errors : []).filter(Boolean).map(String),
    };
  }
  const num = (v, fallback) => (typeof v === "number" && isFinite(v) ? v : fallback);
  const SEV = { high: 3, medium: 2, low: 1 };
  const sevKey = (s) => (SEV[String(s || "").toLowerCase()] ? String(s).toLowerCase() : "medium");
  const sentKey = (s) => { s = String(s || "").toLowerCase(); return s.includes("neg") ? "neg" : s.includes("pos") ? "pos" : s.includes("mix") ? "mix" : "neu"; };
  const SENT_LABEL = { neg: "Negative", pos: "Positive", mix: "Mixed", neu: "Neutral" };
  const SENT_ICON = { neg: "frown", pos: "smile", mix: "meh", neu: "meh" };

  // Everything the AI said, grouped by lead, plus each lead's CRM records.
  function leadModel(ix, m) {
    const L = new Map();
    const get = (id, name) => {
      const key = id || name;
      if (!key) return null;
      if (!L.has(key)) {
        const info = ix.leads.get(key) || {};
        L.set(key, { id: key, name: name || info.name || key, company: info.company || "", plan: [], mns: [], risks: [], promises: [], overdue: [], wins: [], prep: [], notes: [], calls: [], convos: [] });
      }
      return L.get(key);
    };
    ix.leads.forEach((l) => get(l.id, l.name));
    const add = (list, k) => list.forEach((x, i) => get(x.lead_id, x.lead_name)?.[k].push({ ...x, _i: i }));
    add(m.plan, "plan"); add(m.mns, "mns"); add(m.risks, "risks"); add(m.promises, "promises"); add(m.overdue, "overdue");
    add(m.wins, "wins"); add(m.prep, "prep"); add(m.notes, "notes"); add(m.calls, "calls"); add(m.convos, "convos");
    L.forEach((l) => {
      const sev = Math.max(0, ...l.risks.map((r) => SEV[sevKey(r.severity)]));
      const owed = l.convos.filter((c) => String(c.awaiting_reply_from).toLowerCase() === "user");
      l.owed = owed;
      l.sent = [...l.calls, ...l.convos].map((x) => sentKey(x.sentiment)).reduce((acc, s) => (acc === "neg" || s === "neg" ? "neg" : acc === "pos" || s === "pos" ? "pos" : acc), null);
      l.score = l.mns.length * 40 + [0, 8, 18, 30][sev] + l.overdue.length * 10
        + l.promises.filter((p) => String(p.status).toLowerCase() === "overdue").length * 12 + owed.length * 8 + l.plan.length * 5 + (l.sent === "neg" ? 10 : 0);
      l.heat = l.score >= 70 ? 5 : l.score >= 45 ? 4 : l.score >= 25 ? 3 : l.score >= 10 ? 2 : l.score > 0 ? 1 : 0;
      l.records = ix.byLead.get(l.id) || [];
    });
    return [...L.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  // ---------- lead drawer
  function leadView(ix, m, leads, id) {
    const l = leads.find((x) => x.id === id) || leads.find((x) => x.name === id);
    if (!l) return { title: esc(id), sub: "Lead", html: `<p class="empty-note">Nothing about this lead.</p>` };
    const sec = (title, ic, html, n) => html ? `<section class="pl-dsec"><h4>${icon(ic, 13)} ${title}${n != null ? `<span class="count">${n}</span>` : ""}</h4>${html}</section>` : "";
    const flags = leadFlags(l);
    const planH = l.plan.map((p) => `<button type="button" class="pl-dplan ch-${chan(p.channel).c}" data-src="${esc(p.source_id)}">
        <span class="pl-dplan-t">${esc(p.time_slot || "")}</span>${icon(chan(p.channel).icon, 12)}<b>${esc(p.headline)}</b><small>${esc(p.why || "")}</small></button>`).join("");
    const riskH = l.risks.map((r) => `<div class="pl-drisk sev-${sevKey(r.severity)}">${sevMeter(r.severity)}<p>${esc(r.issue)}</p>
        ${r.suggested_recovery_step ? `<div class="pl-recover">${icon("arrow", 12)} ${esc(r.suggested_recovery_step)}</div>` : ""}</div>`).join("");
    const promH = l.promises.map((p) => promiseRow(ix, p)).join("");
    const callH = l.calls.map((c) => callCard(ix, c, true)).join("");
    const convH = l.convos.map((c) => convoBlock(ix, c, true)).join("");
    const noteH = l.notes.map((n) => `<div class="pl-dnote">${icon("bulb", 12)}<div><b>${esc(n.insight)}</b>${n.suggested_action ? `<small>${icon("arrow", 10)} ${esc(n.suggested_action)}</small>` : ""}</div>${n.source_id ? srcChip(ix, n.source_id) : ""}</div>`).join("");
    const listH = (arr) => arr.map((x) => `<div class="pl-dline">${srcChip(ix, x.source_id)}<span>${esc(x.note || "")}</span></div>`).join("");
    const recs = TYPE_ORDER.map((t) => l.records.filter((r) => r.type === t)).flat();
    const recH = recs.length ? `<div class="pl-drecs">${recs.map((rec) => recordLine(ix, rec)).join("")}</div>` : "";
    return {
      title: `${avatar(l.name, "sm")}<span>${esc(l.name)}</span>`,
      sub: `${l.company ? esc(l.company) : "Lead"}${flags ? ` · ${flags}` : ""}`,
      html: `${l.mns.length ? `<div class="pl-dmns">${icon("flame", 14)}<div>${l.mns.map((x) => `<b>${esc(x.headline)}</b><small>If missed: ${esc(x.consequence || "")}</small>`).join("")}</div></div>` : ""}
        ${sec("Today's plan", "calendar", planH, l.plan.length)}
        ${sec("Risk", "alert", riskH)}
        ${sec("Promises", "handshake", promH, l.promises.length)}
        ${sec("Replies", "inbox", convH, l.convos.length)}
        ${sec("Calls", "phone", callH, l.calls.length)}
        ${sec("From the notes", "bulb", noteH)}
        ${sec("Overdue", "clock", listH(l.overdue), l.overdue.length)}
        ${sec("Quick wins", "zap", listH(l.wins))}
        ${sec("Coming up", "eye", listH(l.prep))}
        ${sec("CRM records", "layers", recH, recs.length)}`
        || `<p class="empty-note">No AI insights for this lead.</p>`,
    };
  }

  function recordLine(ix, rec) {
    const r = rec.r, t = TYPES[rec.type];
    const text = { task: r.task_details, followup: r.followup_details, note: r.content, call: r.transcript ? `${cap(r.direction)} call: ${r.transcript}` : `${cap(r.direction)} call · ${r.outcome}`, message: r.subject || r.content }[rec.type];
    const when = { task: r.date, followup: r.due_date, note: r.date, call: r.date, message: r.date }[rec.type];
    return `<button type="button" class="pl-rec t-${rec.type}" data-src="${esc(rec.id)}">
      <span class="pl-rec-ico">${icon(t.icon, 12)}</span>
      <span class="pl-rec-main"><b>${esc(text || "")}</b><small>${esc(t.label)} ${esc(rec.id)}${r.lead_name ? ` · ${esc(r.lead_name)}` : ""}${when ? ` · ${esc(fmtShort(when))}` : ""}</small></span>
      ${rec.type === "message" && r.is_read === false ? `<span class="pl-unread">Unread</span>` : ""}${r.priority ? prioTag(r.priority) : ""}</button>`;
  }

  // ---------- small shared pieces
  const sevMeter = (s) => { const k = sevKey(s); return `<span class="pl-sev sev-${k}" title="${cap(k)} severity"><i></i><i></i><i></i>${cap(k)}</span>`; };
  const leadFlags = (l) => [
    l.mns.length && `<span class="pl-flag f-red">${icon("flame", 10)} Must not slip</span>`,
    l.risks.length && `<span class="pl-flag f-amber">${icon("alert", 10)} At risk</span>`,
    l.owed.length && `<span class="pl-flag f-indigo">${icon("inbox", 10)} Owes reply</span>`,
    l.overdue.length && `<span class="pl-flag f-rose">${icon("clock", 10)} ${l.overdue.length} overdue</span>`,
  ].filter(Boolean).join("");

  function promiseRow(ix, p) {
    const st = String(p.status || "unknown").toLowerCase();
    const k = ["overdue", "pending", "done", "completed"].includes(st) ? (st === "completed" ? "done" : st) : "unknown";
    const cov = p.covered_by && typeof p.covered_by === "object" ? p.covered_by : null;
    return `<div class="pl-promise st-${k}">
      <span class="pl-st">${esc(cap(st))}</span>
      <div class="pl-pr-main">
        <b>${esc(p.commitment || "")}</b>
        <div class="pl-pr-meta">${leadLink(ix, p.lead_id, p.lead_name)}${p.due_hint ? `<span>${icon("clock", 10)} ${esc(p.due_hint)}</span>` : ""}${p.call_id ? srcChip(ix, p.call_id, `said on ${p.call_id}`) : ""}</div>
        ${p.suggested_action ? `<div class="pl-pr-act">${icon("arrow", 11)} ${esc(p.suggested_action)}</div>` : ""}
      </div>
      <div class="pl-pr-cover">${cov
        ? `<span class="pl-cov ok" title="${esc(cov.note || "")}">${icon("check", 11)} Scheduled</span>${srcChip(ix, cov.source_id)}`
        : `<span class="pl-cov no">${icon("alert", 11)} Not scheduled</span>`}</div>
    </div>`;
  }

  function callCard(ix, c, compact) {
    const s = sentKey(c.sentiment);
    const sig = (c.buying_signals || []).filter(Boolean), obj = (c.objections || []).filter(Boolean);
    const tot = sig.length + obj.length;
    const chips = (list, cls) => list.map((x) => `<span class="pl-chip ${cls}">${esc(x)}</span>`).join("");
    const lead = ix.leads.get(c.lead_id) || {};
    return `<article class="pl-call s-${s}">
      <header>
        ${compact ? "" : avatar(c.lead_name || lead.name || "?", "sm")}
        <div class="pl-call-who">${compact ? `<b>${esc(SENT_LABEL[s])} call</b>` : `<button type="button" class="pl-name-btn" data-lead="${esc(c.lead_id || c.lead_name)}">${esc(c.lead_name || "")}</button>`}
          <small>${esc(lead.company || "")}</small></div>
        <span class="pl-sent s-${s}" title="Sentiment: ${SENT_LABEL[s]}">${icon(SENT_ICON[s], 13)} ${SENT_LABEL[s]}</span>
        ${c.call_id ? srcChip(ix, c.call_id, "Transcript") : ""}
      </header>
      <p class="pl-call-sum">${esc(c.summary || "")}</p>
      ${tot ? `<div class="pl-tug" title="${sig.length} buying signals vs ${obj.length} objections"><i class="g" style="flex:${sig.length || 0.0001}"></i><i class="r" style="flex:${obj.length || 0.0001}"></i></div>
        <div class="pl-tug-cols"><div><small>${icon("up", 10)} Buying signals</small>${chips(sig, "g") || `<span class="muted small">none</span>`}</div>
          <div><small>${icon("down", 10)} Objections</small>${chips(obj, "r") || `<span class="muted small">none</span>`}</div></div>` : ""}
      ${(c.competitor_mentions || []).length ? `<div class="pl-comp">${icon("swords", 12)} <small>Competitors:</small> ${chips(c.competitor_mentions, "c")}</div>` : ""}
      ${(c.unanswered_questions || []).length ? `<ul class="pl-qs">${c.unanswered_questions.map((q) => `<li>${icon("help", 12)} ${esc(q)}</li>`).join("")}</ul>` : ""}
      ${c.stated_timeline ? `<div class="pl-tl">${icon("flag", 11)} ${esc(c.stated_timeline)}</div>` : ""}
    </article>`;
  }

  function convoBlock(ix, c, open) {
    const s = sentKey(c.sentiment), ch = chan(c.channel);
    const mine = String(c.awaiting_reply_from || "").toLowerCase() === "user";
    const pts = (c.suggested_reply_points || []).filter(Boolean);
    return `<details class="pl-convo s-${s}" ${open ? "open" : ""}>
      <summary>
        <span class="pl-ch-ico ch-${ch.c}">${icon(ch.icon, 12)}</span>
        <span class="pl-convo-main"><b>${esc(c.lead_name || "")}</b><small>${esc(c.summary || "")}</small></span>
        ${c.hours_waiting != null ? `<span class="pl-wait ${mine ? "mine" : ""}" title="${mine ? "Waiting for your reply" : "Waiting for their reply"}">${icon("clock", 10)} ${esc(waitLabel(c.hours_waiting))}</span>` : ""}
        ${icon("chevron", 12)}
      </summary>
      <div class="pl-convo-body">
        ${(c.decided_facts || []).length ? `<div class="pl-facts">${c.decided_facts.map((f) => `<span class="pl-chip f">${icon("pin", 10)} ${esc(f)}</span>`).join("")}</div>` : ""}
        ${pts.length ? `<div class="sub-title">Suggested reply points</div><ul class="pl-points">${pts.map((p) => `<li>${icon("check", 11)} ${esc(p)}</li>`).join("")}</ul>` : ""}
        <div class="pl-convo-acts">
          ${c.thread_id && ix.threads.has(c.thread_id) ? `<button type="button" class="btn btn-outline btn-sm" data-src="${esc(c.message_id || ix.threads.get(c.thread_id).slice(-1)[0].message_id)}">${icon("chat", 12)} Open thread</button>` : ""}
          ${pts.length ? `<button type="button" class="btn btn-ghost btn-sm" data-copy-text="${esc(pts.map((p) => `- ${p}`).join("\n"))}">${icon("copy", 12)} Copy points</button>` : ""}
        </div>
      </div>
    </details>`;
  }
  const waitLabel = (h) => { h = Number(h) || 0; return h >= 48 ? `${Math.round(h / 24)}d` : `${Math.round(h)}h`; };

  // Clicks on [data-src] / [data-lead] anywhere in the dashboard or the drawer.
  function handleLinks(e, ctx, inDrawer) {
    const src = e.target.closest("[data-src]");
    if (src) { e.preventDefault(); drawer.open(recordView(ctx.ix, src.dataset.src), ctx, inDrawer); return true; }
    const lead = e.target.closest("[data-lead]");
    if (lead && ctx.leads) { e.preventDefault(); drawer.open(leadView(ctx.ix, ctx.m, ctx.leads, lead.dataset.lead), ctx, inDrawer); return true; }
    return false;
  }

  // CRM data preview (input panel): records by type in the drawer.
  function previewView(crm, title) {
    const ix = indexCrm(crm);
    const tabs = TYPE_ORDER.map((t) => ({ t, list: [...ix.byId.values()].filter((r) => r.type === t) }));
    const first = tabs.find((x) => x.list.length)?.t || "task";
    return {
      view: {
        title: esc(title || `${ix.user}'s CRM`),
        sub: `${icon("calendar", 11)} ${esc(fmtDay(crm.today, { weekday: "short", day: "numeric", month: "short", year: "numeric" }))} · ${esc(crm.working_hours || "")} · ${esc(crm.timezone || "")}`,
        html: `<div class="pl-ptabs">${tabs.map(({ t, list }) => `<button type="button" class="${t === first ? "active" : ""}" data-ptab="${t}">${icon(TYPES[t].icon, 12)} ${TYPES[t].plural}<b>${list.length}</b></button>`).join("")}</div>
          ${tabs.map(({ t, list }) => `<div class="pl-drecs ${t === first ? "" : "hidden"}" data-ppane="${t}">${list.map((rec) => recordLine(ix, rec)).join("") || `<p class="empty-note">None</p>`}</div>`).join("")}`,
      },
      ctx: { ix, m: normalize({}), leads: leadModel(ix, normalize({})) },
    };
  }

  window.PlannerKit = { TYPES, TYPE_ORDER, chan, indexCrm, fmtDay, fmtShort, avatar, initials, hue, drawer, previewView, workHours, toMin, dur };

  // ================================================================ dashboard
  window.Renderers["crm-ai-planner"] = (d, rctx) => {
    const input = rctx.input || {};
    const crm = input.crm && typeof input.crm === "object" ? input.crm : {};
    const ix = indexCrm(crm);
    const m = normalize(d);
    const leads = leadModel(ix, m);
    const wh = workHours(crm.working_hours);
    const runKey = `pl-done:${rctx.payload?.run_id || `${crm.user_id || ix.user}:${crm.today || ""}:${m.plan.length}`}`;
    const done = doneStore(runKey);

    // ---- plan items with times
    const items = m.plan.map((p, i) => {
      const parts = String(p.time_slot || "").split("-");
      const s = toMin(parts[0]);
      let e = parts[1] ? toMin(parts[1]) : null;
      const est = Math.max(0, Number(p.estimated_minutes) || 0);
      if (s != null && (e == null || e <= s)) e = s + (est || 15);
      return { p, i, s, e, est: est || (s != null && e != null ? e - s : 0), fixed: p.is_fixed_time === true, ch: chan(p.channel), score: Math.max(0, Math.min(100, Number(p.priority_score) || 0)), overlaps: [] };
    });
    const timed = items.filter((x) => x.s != null).sort((a, b) => a.s - b.s || (b.fixed - a.fixed) || b.score - a.score);
    const untimed = items.filter((x) => x.s == null);
    timed.forEach((x, k) => {                                      // overlaps with earlier items
      x.overlaps = timed.filter((y, j) => j !== k && y.s < x.e && x.s < y.e);
    });
    const dayS = Math.min(wh.s, ...timed.map((x) => x.s)), dayE = Math.max(wh.e, ...timed.map((x) => x.e));
    const planned = num(m.counts.total_minutes_planned, items.reduce((n, x) => n + x.est, 0));
    const workMin = wh.e - wh.s;
    const fixedMin = items.filter((x) => x.fixed).reduce((n, x) => n + x.est, 0);

    const owed = m.convos.filter((c) => String(c.awaiting_reply_from || "").toLowerCase() === "user");
    const C = {
      mns: m.mns.length,
      risk: num(m.counts.at_risk_leads, m.risks.length) || m.risks.length,
      overdue: Math.max(num(m.counts.overdue, 0), m.overdue.length),
      reply: Math.max(num(m.counts.awaiting_your_reply, 0), owed.length),
      promise: Math.max(num(m.counts.open_commitments, 0), m.promises.length),
      wins: Math.max(num(m.counts.quick_wins, 0), m.wins.length),
    };

    // ---- header: hero
    const ringR = 46, ringC = 2 * Math.PI * ringR;
    const loadPct = workMin ? Math.min(100, (planned / workMin) * 100) : 0;
    const loadTone = loadPct >= 85 ? "hot" : loadPct >= 60 ? "warm" : "ok";
    const scenario = input.scenario && input.scenario !== "custom" ? input.scenario : null;
    const hero = `
      <div class="pl-hero">
        <div class="pl-hero-main">
          <div class="pl-hello">
            ${avatar(ix.user || "You", "lg")}
            <div>
              <small class="pl-kicker">${icon("sun", 12)} Daily plan${scenario ? "" : " · your CRM data"}</small>
              <h2>${esc(ix.first)}'s day</h2>
              <div class="pl-when">
                <span>${icon("calendar", 12)} ${esc(fmtDay(crm.today))}</span>
                ${crm.working_hours ? `<span>${icon("clock", 12)} ${esc(crm.working_hours)}</span>` : ""}
                ${crm.timezone ? `<span>${icon("globe", 12)} ${esc(crm.timezone)}</span>` : ""}
              </div>
            </div>
          </div>
          ${m.summary ? `<p class="pl-summary">${icon("sparkles", 14)}<span>${linkNames(m.summary, leads)}</span></p>` : ""}
        </div>
        <div class="pl-load-ring t-${loadTone}" title="${dur(planned)} planned of a ${dur(workMin)} working day">
          <svg viewBox="0 0 110 110" width="118" height="118">
            <circle class="ring-bg" cx="55" cy="55" r="${ringR}" fill="none" stroke-width="9"/>
            <circle class="ring-fg" cx="55" cy="55" r="${ringR}" fill="none" stroke-width="9" stroke-linecap="round"
              stroke-dasharray="${ringC}" stroke-dashoffset="${ringC}" data-offset="${ringC * (1 - loadPct / 100)}"/>
          </svg>
          <div class="pl-ring-lbl"><strong>${esc(dur(planned))}</strong><small>of ${esc(dur(workMin))} booked</small></div>
          <div class="pl-ring-leg"><span class="fx">${icon("lock", 10)} ${esc(dur(fixedMin))} fixed</span><span class="fl">${icon("shuffle", 10)} ${esc(dur(Math.max(0, planned - fixedMin)))} flexible</span></div>
        </div>
      </div>`;

    const KPIS = [
      { k: "mns", label: "Must not slip", ic: "flame", tone: "red", tab: "today", sec: "mns" },
      { k: "risk", label: "Leads at risk", ic: "alert", tone: "amber", tab: "risks", sec: "risks" },
      { k: "overdue", label: "Overdue", ic: "clock", tone: "rose", tab: "risks", sec: "overdue" },
      { k: "reply", label: "Owe a reply", ic: "inbox", tone: "indigo", tab: "inbox", sec: "owed" },
      { k: "promise", label: "Open promises", ic: "handshake", tone: "violet", tab: "risks", sec: "promises" },
      { k: "wins", label: "Quick wins", ic: "zap", tone: "green", tab: "today", sec: "wins" },
    ];
    const kpis = `<div class="pl-kpis">${KPIS.map((k, i) => `
      <button type="button" class="pl-kpi t-${k.tone} ${C[k.k] ? "" : "zero"}" data-kpi="${k.tab}:${k.sec}" style="--i:${i}">
        <span class="pl-kpi-ico">${icon(k.ic, 15)}</span>
        <b data-count="${C[k.k]}">0</b><small>${k.label}</small>
      </button>`).join("")}</div>`;

    const errors = m.errors.length ? `
      <details class="pl-errors">
        <summary>${icon("alert", 14)}<span><b>The AI service reported ${plural(m.errors.length, "agent error")}.</b> ${m.plan.length ? "This is a partial plan built from the rule-based checks." : "Some sections may be empty."}</span>${icon("chevron", 12)}</summary>
        <ul>${m.errors.map((e) => { const [who, ...rest] = e.split(": "); return `<li><b>${esc(rest.length ? who : "error")}</b> ${esc(shorten(rest.length ? rest.join(": ") : e, 260))}</li>`; }).join("")}</ul>
      </details>` : "";

    const mnsStrip = m.mns.length ? `
      <section class="pl-mns" data-sec="mns">
        <div class="pl-sec-head"><h4>${icon("flame", 14)} Must not slip today</h4><small class="muted">If these wait, something is lost</small></div>
        <div class="pl-mns-row">${m.mns.map((x, i) => `
          <article class="pl-mns-card ${done.has(`mns:${i}`) ? "done" : ""}" style="--i:${i}" data-mns="${i}">
            <span class="pl-mns-n">${i + 1}</span>
            <div class="pl-mns-body">
              <b>${esc(x.headline || "")}</b>
              <div class="pl-mns-meta">${leadLink(ix, x.lead_id, x.lead_name)}${x.source_id ? srcChip(ix, x.source_id) : ""}</div>
              ${x.consequence ? `<p class="pl-cons">${icon("alert", 11)} <span>If missed: ${esc(x.consequence)}</span></p>` : ""}
            </div>
            <button type="button" class="pl-check" data-done="mns:${i}" aria-pressed="${done.has(`mns:${i}`)}" title="Mark done">${icon("check", 13)}</button>
          </article>`).join("")}</div>
      </section>` : "";

    // ---- tab: today
    const chans = [...new Map(items.map((x) => [x.ch.c, x.ch])).values()];
    const strip = timed.length ? dayStrip(timed, dayS, dayE, wh) : "";
    const agendaRows = [];
    let cursor = Math.max(dayS, wh.s);
    timed.forEach((x, k) => {
      if (x.s - cursor >= 20) agendaRows.push(gapRow(cursor, x.s));
      agendaRows.push(planRow(x, k));
      cursor = Math.max(cursor, x.e);
    });
    if (timed.length && wh.e - cursor >= 20) agendaRows.push(gapRow(cursor, wh.e));
    if (untimed.length) {
      agendaRows.push(`<li class="pl-anytime">${icon("shuffle", 12)} Any time today</li>`);
      untimed.forEach((x, k) => agendaRows.push(planRow(x, timed.length + k)));
    }

    function planRow(x, k) {
      const p = x.p, key = `plan:${x.i}`, isDone = done.has(key);
      const ov = x.overlaps.filter((y) => y !== x);
      const steps = (p.steps || []).filter(Boolean);
      return `<li class="pl-item ch-${x.ch.c} ${x.fixed ? "fixed" : "flex"} ${isDone ? "done" : ""} ${ov.length ? "overlap" : ""}" data-pi="${x.i}" data-ch="${x.ch.c}" style="--i:${Math.min(k, 14)}">
        <div class="pl-time">${x.s != null ? `<b>${hhmm(x.s)}</b><small>${hhmm(x.e)}</small>` : `<b>—</b>`}
          <span class="pl-kind" title="${x.fixed ? "Fixed time (from the calendar)" : "Flexible: the AI picked this slot"}">${icon(x.fixed ? "lock" : "shuffle", 10)}</span></div>
        <div class="pl-node"><i></i></div>
        <div class="pl-card" tabindex="0" role="button" aria-expanded="false">
          <div class="pl-card-top">
            <span class="pl-ch-ico ch-${x.ch.c}" title="${esc(x.ch.label)}">${icon(x.ch.icon, 14)}</span>
            <div class="pl-card-title"><b>${esc(p.headline || "")}</b>
              <div class="pl-card-meta">${leadLink(ix, p.lead_id, p.lead_name)}
                ${x.est ? `<span class="pl-est">${icon("clock", 10)} ${esc(dur(x.est))}</span>` : ""}
                ${ov.length ? `<span class="pl-ov" title="${esc(ov.map((y) => `${hhmm(y.s)} ${y.p.headline}`).join("\n"))}">${icon("alert", 10)} Overlaps ${esc(hhmm(ov[0].s))}</span>` : ""}
              </div></div>
            ${prioRing(x.score)}
            <button type="button" class="pl-check" data-done="${key}" aria-pressed="${isDone}" title="Mark done">${icon("check", 13)}</button>
          </div>
          <div class="pl-card-more">
            ${p.why ? `<p class="pl-why">${icon("bulb", 12)} ${esc(p.why)}</p>` : ""}
            ${steps.length ? `<ol class="pl-steps">${steps.map((s, j) => `<li><button type="button" class="pl-step ${done.has(`${key}:${j}`) ? "on" : ""}" data-done="${key}:${j}">${icon("check", 10)}</button><span>${esc(s)}</span></li>`).join("")}</ol>` : ""}
            <div class="pl-card-acts">${p.source_id ? srcChip(ix, p.source_id, `Open ${(ix.byId.get(p.source_id) ? TYPES[ix.byId.get(p.source_id).type].label : p.source_type || "source").toLowerCase()} ${p.source_id}`) : ""}
              ${p.lead_id ? `<button type="button" class="pl-src" data-lead="${esc(p.lead_id)}">${icon("users", 11)} Everything about ${esc(String(p.lead_name || "").split(" ")[0])}</button>` : ""}</div>
          </div>
        </div>
      </li>`;
    }
    function gapRow(a, b) {
      return `<li class="pl-gap"><span>${icon("coffee", 12)} Free ${hhmm(a)}–${hhmm(b)}</span><b>${esc(dur(b - a))}</b></li>`;
    }

    const W = m.work || {};
    const wl = [["phone", "Calls", W.calls_count], ["users", "Meetings", W.meetings_count], ["mail", "Emails", W.emails_count], ["repeat", "Follow-ups due", W.followups_due_today_count]]
      .filter(([, , v]) => typeof v === "number");
    const freeSlots = (Array.isArray(W.free_time_slots) && W.free_time_slots.length ? W.free_time_slots : []).map(String);
    const rail = `
      <aside class="pl-rail">
        <div class="pl-panelbox">
          <h4>${icon("chart", 13)} Workload</h4>
          ${wl.some(([, , v]) => v) ? `<div class="pl-wl">${wl.map(([ic, l, v]) => `<div><span>${icon(ic, 13)}</span><b>${esc(v)}</b><small>${esc(l)}</small></div>`).join("")}</div>`
            : `<div class="pl-wl">${chans.map((c) => `<div><span>${icon(c.icon, 13)}</span><b>${items.filter((x) => x.ch.c === c.c).length}</b><small>${esc(c.label)}</small></div>`).join("")}</div>`}
          ${W.busiest_hour_range ? `<div class="pl-busy">${icon("flame", 12)} Busiest: <b>${esc(W.busiest_hour_range)}</b></div>` : ""}
          ${W.overload_warning ? `<div class="pl-warn">${icon("alert", 12)} ${esc(W.overload_warning)}</div>` : ""}
          ${freeSlots.length ? `<div class="sub-title">Free time</div><div class="pl-free">${freeSlots.map((f) => `<span>${icon("coffee", 11)} ${esc(f)}</span>`).join("")}</div>` : ""}
        </div>
        ${m.conflicts.length ? `<div class="pl-panelbox pl-conflicts"><h4>${icon("alert", 13)} Schedule conflicts</h4>${m.conflicts.map((c) => `<p>${esc(c)}</p>`).join("")}</div>` : ""}
        ${m.tip ? `<div class="pl-tip">${icon("bulb", 15)}<div><small>Productivity tip</small><p>${esc(m.tip)}</p></div></div>` : ""}
        ${m.wins.length ? `<div class="pl-panelbox" data-sec="wins"><h4>${icon("zap", 13)} Quick wins <span class="count">${m.wins.length}</span></h4>
          <ul class="pl-mini">${m.wins.map((w, i) => miniRow(w, `win:${i}`)).join("")}</ul></div>` : ""}
        ${m.prep.length ? `<div class="pl-panelbox"><h4>${icon("eye", 13)} Prepare for what's next</h4>
          <ul class="pl-mini">${m.prep.map((w, i) => miniRow(w, `prep:${i}`)).join("")}</ul></div>` : ""}
      </aside>`;
    function miniRow(w, key) {
      return `<li class="${done.has(key) ? "done" : ""}"><button type="button" class="pl-step ${done.has(key) ? "on" : ""}" data-done="${key}">${icon("check", 10)}</button>
        <div><span>${esc(w.note || "")}</span><div class="pl-mini-meta">${leadLink(ix, w.lead_id, w.lead_name)}${w.source_id ? srcChip(ix, w.source_id) : ""}</div></div></li>`;
    }

    const today = items.length ? `
      <div class="pl-today">
        <div class="pl-main">
          <div class="pl-dayhead">
            <div class="pl-prog"><div class="pl-prog-txt"><b data-prog-n>0</b> of ${items.length} done<small data-prog-left></small></div><div class="pl-prog-bar"><i data-prog-bar></i></div></div>
            ${chans.length > 1 ? `<div class="pl-filter" role="group" aria-label="Filter by channel"><button type="button" class="active" data-ch-filter="all">All <b>${items.length}</b></button>${chans.map((c) =>
              `<button type="button" class="ch-${c.c}" data-ch-filter="${c.c}">${icon(c.icon, 11)} ${esc(c.label)} <b>${items.filter((x) => x.ch.c === c.c).length}</b></button>`).join("")}</div>` : ""}
          </div>
          ${strip}
          <ol class="pl-agenda">${agendaRows.join("")}</ol>
        </div>
        ${rail}
      </div>` : `<div class="pl-today"><div class="pl-main"><div class="pl-empty">${icon("calendar", 22)}<b>No plan items came back</b><span>The AI didn't schedule anything for today.</span></div></div>${rail}</div>`;

    // ---- tab: risks & promises
    const pc = (k) => m.promises.filter((p) => (String(p.status || "").toLowerCase() || "unknown") === k).length;
    const pOver = pc("overdue"), pPend = pc("pending"), pUnk = m.promises.length - pOver - pPend;
    const risks = `
      <div class="pl-risks">
        <section class="pl-sec" data-sec="risks">
          <div class="pl-sec-head"><h4>${icon("alert", 14)} Leads at risk</h4><small class="muted">sorted by severity</small></div>
          ${m.risks.length ? `<div class="pl-risk-grid">${[...m.risks].sort((a, b) => SEV[sevKey(b.severity)] - SEV[sevKey(a.severity)]).map((r, i) => {
            const info = ix.leads.get(r.lead_id) || {};
            return `<article class="pl-risk sev-${sevKey(r.severity)}" style="--i:${i}">
              <header>${avatar(r.lead_name || "?", "sm")}<div><button type="button" class="pl-name-btn" data-lead="${esc(r.lead_id || r.lead_name)}">${esc(r.lead_name || "")}</button><small>${esc(info.company || "")}</small></div>${sevMeter(r.severity)}</header>
              <p class="pl-risk-issue">${esc(r.issue || "")}</p>
              ${(r.evidence || []).length ? `<div class="pl-evidence"><small>Evidence</small>${r.evidence.map((ev) => `<button type="button" class="pl-ev" data-src="${esc(ev.source_id)}">${icon(TYPES[ev.source_type]?.icon || "file", 11)}<span>${esc(ev.note || ev.source_id)}</span><em>${esc(ev.source_id || "")}</em></button>`).join("")}</div>` : ""}
              ${r.suggested_recovery_step ? `<div class="pl-recover">${icon("arrow", 12)} <span>${esc(r.suggested_recovery_step)}</span></div>` : ""}
            </article>`;
          }).join("")}</div>` : emptyBox("shield", "No leads at risk", "Nothing in the CRM points to a lead going cold.")}
        </section>
        <section class="pl-sec" data-sec="promises">
          <div class="pl-sec-head"><h4>${icon("handshake", 14)} Promise tracker</h4><small class="muted">things you said you'd do, found in call transcripts</small></div>
          ${m.promises.length ? `<div class="pl-pstat">
              <div class="pl-pbar">${pOver ? `<i class="st-overdue" style="flex:${pOver}"></i>` : ""}${pPend ? `<i class="st-pending" style="flex:${pPend}"></i>` : ""}${pUnk ? `<i class="st-unknown" style="flex:${pUnk}"></i>` : ""}</div>
              <div class="pl-plegend"><span class="st-overdue">${pOver} overdue</span><span class="st-pending">${pPend} pending</span>${pUnk ? `<span class="st-unknown">${pUnk} no date</span>` : ""}
                <span class="st-cov">${m.promises.filter((p) => p.covered_by).length} of ${m.promises.length} scheduled</span></div>
            </div>
            <div class="pl-promises">${[...m.promises].sort((a, b) => promiseRank(a) - promiseRank(b)).map((p) => promiseRow(ix, p)).join("")}</div>`
            : emptyBox("handshake", "No open promises", "No commitments were found in the call transcripts.")}
        </section>
        <section class="pl-sec" data-sec="overdue">
          <div class="pl-sec-head"><h4>${icon("clock", 14)} Overdue</h4></div>
          ${m.overdue.length ? `<div class="pl-over">${m.overdue.map((o) => {
            const late = lateness(o, ix);
            return `<button type="button" class="pl-over-row" data-src="${esc(o.source_id)}">
              <span class="pl-late ${late.cls}">${esc(late.label)}</span>
              <span class="pl-over-main"><b>${esc(o.note || "")}</b><small>${icon(TYPES[o.source_type]?.icon || "file", 10)} ${esc(TYPES[o.source_type]?.label || o.source_type || "")} ${esc(o.source_id || "")} · ${esc(o.lead_name || "")}</small></span>
              ${icon("chevronr", 12)}</button>`;
          }).join("")}</div>` : emptyBox("check", "Nothing overdue", "Every task and follow-up is on time.")}
        </section>
      </div>`;

    // ---- tab: leads
    const active = leads.filter((l) => l.score > 0 || l.plan.length || l.calls.length || l.convos.length);
    const quiet = leads.filter((l) => !active.includes(l));
    const leadCard = (l, i) => `
      <button type="button" class="pl-lead heat-${l.heat}" data-lead="${esc(l.id)}" style="--i:${Math.min(i, 16)}" data-q="${esc(`${l.name} ${l.company}`.toLowerCase())}">
        <div class="pl-lead-top">${avatar(l.name)}<div class="pl-lead-who"><b>${esc(l.name)}</b><small>${esc(l.company || "")}</small></div>
          ${l.sent ? `<span class="pl-sent s-${l.sent}" title="Sentiment: ${SENT_LABEL[l.sent]}">${icon(SENT_ICON[l.sent], 13)}</span>` : ""}</div>
        <div class="pl-heat" title="Needs attention: ${l.heat}/5">${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= l.heat ? "on" : ""}"></i>`).join("")}<small>${["Calm", "Low", "Watch", "Important", "High", "Critical"][l.heat]}</small></div>
        <div class="pl-flags">${leadFlags(l)}</div>
        <div class="pl-lead-nums">
          <span title="In today's plan">${icon("calendar", 11)} ${l.plan.length}</span>
          <span title="Open promises">${icon("handshake", 11)} ${l.promises.length}</span>
          <span title="CRM records">${icon("layers", 11)} ${l.records.length}</span>
          ${l.owed[0] ? `<span class="pl-wait mine" title="Waiting for your reply">${icon("clock", 10)} ${esc(waitLabel(l.owed[0].hours_waiting))}</span>` : ""}
        </div>
      </button>`;
    const leadsTab = `
      <div class="pl-leads-tools">
        <label class="pl-search">${icon("search", 13)}<input type="search" data-lead-q placeholder="Search leads or companies…" aria-label="Search leads"></label>
        <small class="muted">${plural(active.length, "lead")} need attention${quiet.length ? ` · ${quiet.length} quiet` : ""} · sorted by urgency</small>
      </div>
      <div class="pl-lead-grid">${active.map(leadCard).join("")}</div>
      ${quiet.length ? `<div class="sub-title">Quiet leads</div><div class="pl-lead-grid quiet">${quiet.map((l, i) => leadCard(l, active.length + i)).join("")}</div>` : ""}
      ${leads.length ? "" : emptyBox("users", "No leads", "The CRM data has no lead records.")}`;

    // ---- tab: inbox & calls
    const theirs = m.convos.filter((c) => !owed.includes(c));
    const maxWait = Math.max(1, ...m.convos.map((c) => Number(c.hours_waiting) || 0));
    const waitBar = (c) => `<div class="pl-wbar"><i data-w="${Math.max(4, Math.round(((Number(c.hours_waiting) || 0) / maxWait) * 100))}%"></i></div>`;
    const inbox = `
      <div class="pl-inbox">
        <section class="pl-sec" data-sec="owed">
          <div class="pl-sec-head"><h4>${icon("inbox", 14)} Waiting on your reply <span class="count">${owed.length}</span></h4><small class="muted">longest wait first</small></div>
          ${owed.length ? `<div class="pl-convos">${[...owed].sort((a, b) => (b.hours_waiting || 0) - (a.hours_waiting || 0)).map((c) => `<div class="pl-convo-wrap">${waitBar(c)}${convoBlock(ix, c, false)}</div>`).join("")}</div>`
            : emptyBox("check", "Inbox zero", "Nobody is waiting on a reply from you.")}
          ${theirs.length ? `<div class="sub-title">Waiting on them</div><div class="pl-convos theirs">${theirs.map((c) => `<div class="pl-convo-wrap">${waitBar(c)}${convoBlock(ix, c, false)}</div>`).join("")}</div>` : ""}
        </section>
        <section class="pl-sec">
          <div class="pl-sec-head"><h4>${icon("phone", 14)} What the calls revealed <span class="count">${m.calls.length}</span></h4></div>
          ${m.calls.length ? `<div class="pl-calls">${m.calls.map((c) => callCard(ix, c, false)).join("")}</div>` : emptyBox("phone", "No call insights", "The call agent returned nothing for these calls.")}
        </section>
        ${m.notes.length ? `<section class="pl-sec"><div class="pl-sec-head"><h4>${icon("bulb", 14)} Signals from notes</h4></div>
          <div class="pl-notes">${m.notes.map((n) => `<div class="pl-note">${avatar(n.lead_name || "?", "sm")}<div><b>${esc(n.insight || "")}</b>
            <small><button type="button" class="pl-name-btn" data-lead="${esc(n.lead_id || n.lead_name)}">${esc(n.lead_name || "")}</button>${n.suggested_action ? ` · ${icon("arrow", 10)} ${esc(n.suggested_action)}` : ""}</small></div>${n.source_id ? srcChip(ix, n.source_id) : ""}</div>`).join("")}</div></section>` : ""}
      </div>`;

    // ---- tab: agents
    const agentsTab = agentsView(m, ix);

    const tokens = m.agents.reduce((n, a) => n + (Number(a.total_tokens) || 0), 0);
    const models = [...new Set(m.agents.map((a) => a.model).filter(Boolean))];
    const footer = `<div class="tx-foot pl-foot">${icon("cpu", 12)} ${plural(m.agents.length, "agent")}${models.length ? ` · ${esc(models.join(", "))}` : ""}${tokens ? ` · ${tokens.toLocaleString()} tokens` : ""}
      · ${plural(ix.byId.size, "CRM record")} read${m.errors.length ? ` · <span class="red">${plural(m.errors.length, "error")}</span>` : ""}</div>`;

    return {
      title: `${ix.first}'s plan · ${fmtDay(crm.today, { weekday: "short", day: "numeric", month: "short" })}`,
      header: `${hero}${kpis}${errors}${mnsStrip}`,
      footer,
      tabs: [
        { id: "today", label: `Today (${items.length})`, icon: "calendar", html: today },
        { id: "risks", label: "Risks & promises", icon: "alert", html: risks },
        { id: "leads", label: `Leads (${active.length})`, icon: "users", html: leadsTab },
        { id: "inbox", label: "Inbox & calls", icon: "inbox", html: inbox },
        { id: "agents", label: "AI agents", icon: "cpu", html: agentsTab },
      ],
      onMount(root, { switchTab }) { mount(root, switchTab, { ix, m, leads, items, done, wh }); },
    };
  };

  // ---------- view helpers
  const shorten = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + "…" : String(t));
  const emptyBox = (ic, title, text) => `<div class="pl-empty">${icon(ic, 20)}<b>${esc(title)}</b><span>${esc(text)}</span></div>`;
  const promiseRank = (p) => ({ overdue: 0, pending: 1 }[String(p.status || "").toLowerCase()] ?? 2) + (p.covered_by ? 0.5 : 0);
  // How late an overdue item is: from its note ("3 day(s)", "117h") or the CRM record's due date.
  function lateness(o, ix) {
    const s = String(o.note || "");
    const days = (d) => ({ label: `${d}d`, cls: d >= 5 ? "hot" : d >= 2 ? "warm" : "mild" });
    let m = s.match(/(\d+)\s*day/i);
    if (m) return days(+m[1]);
    m = s.match(/(\d+)\s*h\b/i);
    if (m) return { label: waitLabel(+m[1]), cls: +m[1] >= 72 ? "hot" : +m[1] >= 24 ? "warm" : "mild" };
    const r = ix.byId.get(o.source_id)?.r || {};
    const due = parseDay(r.due_date || r.date), today = parseDay(ix.crm.today);
    if (due && today && today > due) return days(Math.round((today - due) / 86400000));
    return { label: "late", cls: "warm" };
  }
  function prioRing(score) {
    const r = 13, c = 2 * Math.PI * r;
    const tone = score >= 90 ? "p-crit" : score >= 75 ? "p-high" : score >= 50 ? "p-med" : "p-low";
    return `<span class="pl-pr ${tone}" title="Priority ${score}/100"><svg viewBox="0 0 32 32" width="32" height="32"><circle cx="16" cy="16" r="${r}" class="bg"/><circle cx="16" cy="16" r="${r}" class="fg" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-offset="${c * (1 - score / 100)}"/></svg><b>${score}</b></span>`;
  }

  function linkNames(text, leads) {
    const names = new Map();
    const firsts = new Map();
    leads.forEach((l) => {
      names.set(l.name.toLowerCase(), l.id);
      const f = l.name.replace(/^(dr|mr|mrs|ms)\.?\s+/i, "").split(/\s+/)[0];
      if (f && f.length >= 3) firsts.set(f.toLowerCase(), firsts.has(f.toLowerCase()) ? null : l.id);
    });
    firsts.forEach((id, f) => { if (id && !names.has(f)) names.set(f, id); });
    const keys = [...names.keys()].sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!keys.length) return esc(text);
    const re = new RegExp(`\\b(${keys.join("|")})('s)?\\b`, "gi");
    let out = "", last = 0, m;
    const t = String(text);
    while ((m = re.exec(t))) {
      out += esc(t.slice(last, m.index));
      out += `<button type="button" class="pl-name" data-lead="${esc(names.get(m[1].toLowerCase()))}">${esc(m[0])}</button>`;
      last = re.lastIndex;
    }
    return out + esc(t.slice(last));
  }

  function dayStrip(timed, dayS, dayE, wh) {
    const span = dayE - dayS;
    const pos = (v) => ((v - dayS) / span) * 100;
    const lanes = [];
    const segs = timed.map((x) => {
      let lane = lanes.findIndex((end) => end <= x.s);
      if (lane < 0) { lane = lanes.length; lanes.push(0); }
      lanes[lane] = x.e;
      return { x, lane };
    });
    const hours = [];
    for (let h = Math.ceil(dayS / 60) * 60; h <= dayE; h += 60) hours.push(h);
    const n = Math.min(3, lanes.length);
    return `<div class="pl-strip" style="--lanes:${n}" aria-label="Day overview">
      <div class="pl-strip-track">
        ${wh.s > dayS ? `<i class="pl-off" style="left:0;width:${pos(wh.s)}%"></i>` : ""}${wh.e < dayE ? `<i class="pl-off" style="left:${pos(wh.e)}%;right:0"></i>` : ""}
        ${hours.map((h) => `<i class="pl-tick" style="left:${pos(h)}%"></i>`).join("")}
        ${segs.map(({ x, lane }) => `<button type="button" class="pl-seg ch-${x.ch.c} ${x.fixed ? "fixed" : ""}" data-jump="${x.i}"
            style="left:${pos(x.s)}%;width:max(6px,${pos(x.e) - pos(x.s)}%);top:calc(${Math.min(lane, n - 1)} * var(--lane-h))"
            title="${esc(`${hhmm(x.s)}–${hhmm(x.e)} · ${x.p.headline}${x.p.lead_name ? ` (${x.p.lead_name})` : ""}`)}"></button>`).join("")}
        <i class="pl-now hidden" data-now></i>
      </div>
      <div class="pl-strip-hours">${hours.map((h) => `<span style="left:${pos(h)}%">${hhmm(h).replace(/:00$/, "")}</span>`).join("")}</div>
    </div>`;
  }

  function agentsView(m, ix) {
    if (!m.agents.length && !m.errors.length) return emptyBox("cpu", "No agent details", "The API didn't return agent metadata.");
    const NAMES = { call_agent: ["Call agent", "phone", "Reads call transcripts"], conversation_agent: ["Conversation agent", "chat", "Reads emails & messages"], task_agent: ["Task agent", "checksq", "Tasks, follow-ups & notes"], synthesizer: ["Planner", "sparkles", "Merges everything into the plan"] };
    const info = (a) => { const k = String(a.agent || "").replace(/\[\d+\]$/, ""); return NAMES[k] || [a.agent || "Agent", "cpu", ""]; };
    const errFor = (a) => m.errors.find((e) => e.startsWith(`${a.agent}:`));
    const synth = m.agents.filter((a) => /synth/i.test(a.agent || ""));
    const workers = m.agents.filter((a) => !synth.includes(a));
    const wMax = Math.max(0, ...workers.map((a) => Number(a.duration_ms) || 0));
    const total = wMax + synth.reduce((n, a) => n + (Number(a.duration_ms) || 0), 0) || 1;
    const row = (a, start) => {
      const [name, ic, what] = info(a), d = Number(a.duration_ms) || 0, err = errFor(a);
      return `<div class="pl-ag ${err ? "err" : ""}">
        <div class="pl-ag-who"><span class="pl-ag-ico">${icon(ic, 14)}</span><div><b>${esc(name)}</b><small>${esc(what)}${a.items_analyzed != null ? ` · ${esc(a.items_analyzed)} items` : ""}</small></div></div>
        <div class="pl-ag-track"><i style="left:${(start / total) * 100}%" data-w="${Math.max(1.5, (d / total) * 100)}%"></i></div>
        <div class="pl-ag-nums"><b>${(d / 1000).toFixed(1)}s</b><small>${a.total_tokens ? `${Number(a.total_tokens).toLocaleString()} tok` : err ? "failed" : "-"}</small></div>
        ${err ? `<p class="pl-ag-err">${icon("alert", 11)} ${esc(shorten(err.split(": ").slice(1).join(": "), 220))}</p>` : ""}
      </div>`;
    };
    let t = wMax;
    const tokens = m.agents.reduce((n, a) => n + (Number(a.total_tokens) || 0), 0);
    const inTok = m.agents.reduce((n, a) => n + (Number(a.input_tokens) || 0), 0);
    return `<div class="pl-agents">
      <div class="pl-ag-stats">
        <div><small>Agents</small><b>${m.agents.length}</b></div>
        <div><small>AI time</small><b>${(total / 1000).toFixed(1)}s</b></div>
        <div><small>Tokens</small><b>${tokens ? tokens.toLocaleString() : "-"}</b></div>
        <div><small>CRM records</small><b>${ix.byId.size}</b></div>
        <div><small>Errors</small><b class="${m.errors.length ? "red" : ""}">${m.errors.length}</b></div>
      </div>
      <div class="pl-sec-head"><h4>${icon("layers", 14)} How the plan was built</h4><small class="muted">specialist agents run in parallel, then the planner merges their reports</small></div>
      <div class="pl-ag-list">${workers.map((a) => row(a, 0)).join("")}
        ${synth.map((a) => { const r = row(a, t); t += Number(a.duration_ms) || 0; return r; }).join("")}</div>
      ${inTok ? `<p class="muted small">${inTok.toLocaleString()} input + ${(tokens - inTok).toLocaleString()} output tokens.</p>` : ""}
      ${m.errors.filter((e) => !m.agents.some((a) => e.startsWith(`${a.agent}:`))).map((e) => `<p class="pl-ag-err">${icon("alert", 11)} ${esc(shorten(e, 260))}</p>`).join("")}
    </div>`;
  }

  // ---------- done state (per viewer; a convenience, so failures are ignored)
  function doneStore(key) {
    let set = new Set();
    try { set = new Set(JSON.parse(localStorage.getItem(key) || "[]")); } catch { /* private mode */ }
    return {
      has: (k) => set.has(k),
      set(k, on) { if (on) set.add(k); else set.delete(k); try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* ignore */ } },
    };
  }

  // ================================================================ behaviour
  function mount(root, switchTab, { ix, m, leads, items, done, wh }) {
    const ctx = { ix, m, leads };
    const flash = (el) => { if (!el) return; el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.remove("pl-flash"); void el.offsetWidth; el.classList.add("pl-flash"); };

    const updateProgress = () => {
      const n = items.filter((x) => done.has(`plan:${x.i}`)).length;
      const left = items.filter((x) => !done.has(`plan:${x.i}`)).reduce((s, x) => s + x.est, 0);
      const nEl = root.querySelector("[data-prog-n]");
      if (!nEl) return;
      nEl.textContent = n;
      root.querySelector("[data-prog-bar]").style.width = `${items.length ? (n / items.length) * 100 : 0}%`;
      root.querySelector("[data-prog-left]").textContent = n === items.length ? " · all done, nice work!" : left ? ` · ${dur(left)} of work left` : "";
      root.querySelector(".pl-prog")?.classList.toggle("all", n === items.length && n > 0);
    };

    root.addEventListener("click", (e) => {
      const chk = e.target.closest("[data-done]");
      if (chk) {
        e.stopPropagation();
        const key = chk.dataset.done, on = !done.has(key);
        done.set(key, on);
        chk.setAttribute("aria-pressed", on);
        chk.classList.toggle("on", on);
        if (/^plan:\d+$/.test(key)) chk.closest(".pl-item")?.classList.toggle("done", on);
        if (/^mns:\d+$/.test(key)) chk.closest(".pl-mns-card")?.classList.toggle("done", on);
        if (/^(win|prep):\d+$/.test(key)) chk.closest("li")?.classList.toggle("done", on);
        if (on) { chk.classList.remove("pop"); void chk.offsetWidth; chk.classList.add("pop"); }
        updateProgress();
        if (on && /^plan:\d+$/.test(key) && items.every((x) => done.has(`plan:${x.i}`))) UI.toast("Every item in today's plan is done 🎉", "success");
        return;
      }
      if (handleLinks(e, ctx, false)) return;
      const kpi = e.target.closest("[data-kpi]");
      if (kpi) {
        const [tab, sec] = kpi.dataset.kpi.split(":");
        switchTab(tab);
        return setTimeout(() => flash(root.querySelector(`[data-sec="${sec}"]`)), 60);
      }
      const jump = e.target.closest("[data-jump]");
      if (jump) return flash(root.querySelector(`.pl-item[data-pi="${jump.dataset.jump}"] .pl-card`));
      const f = e.target.closest("[data-ch-filter]");
      if (f) {
        root.querySelectorAll("[data-ch-filter]").forEach((b) => b.classList.toggle("active", b === f));
        const c = f.dataset.chFilter;
        root.querySelectorAll(".pl-item").forEach((li) => li.classList.toggle("dim", c !== "all" && li.dataset.ch !== c));
        root.querySelectorAll(".pl-seg").forEach((s) => s.classList.toggle("dim", c !== "all" && !s.classList.contains(`ch-${c}`)));
        return;
      }
      const copy = e.target.closest("[data-copy-text]");
      if (copy) return UI.copy(copy.dataset.copyText);
      const card = e.target.closest(".pl-card");
      if (card && !e.target.closest("button, a, summary")) toggleCard(card);
    });
    root.addEventListener("keydown", (e) => {
      const card = e.target.closest?.(".pl-card");
      if (card && e.target === card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggleCard(card); }
    });
    function toggleCard(card) {
      const open = !card.classList.contains("open");
      card.classList.toggle("open", open);
      card.setAttribute("aria-expanded", open);
    }

    const q = root.querySelector("[data-lead-q]");
    q?.addEventListener("input", () => {
      const v = q.value.trim().toLowerCase();
      root.querySelectorAll(".pl-lead").forEach((c) => c.classList.toggle("hidden", !!v && !c.dataset.q.includes(v)));
    });

    // open the most urgent plan item so the first view isn't all collapsed
    const firstOpen = [...root.querySelectorAll(".pl-item:not(.done) .pl-card")].find((c) => c.querySelector(".pl-card-more")?.children.length);
    if (firstOpen) toggleCard(firstOpen);

    // "now" line when the plan is for today (local date)
    const now = new Date();
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const nowEl = root.querySelector("[data-now]");
    if (nowEl && ix.crm.today === iso) {
      const segs = items.filter((x) => x.s != null);
      const s = Math.min(wh.s, ...segs.map((x) => x.s)), e2 = Math.max(wh.e, ...segs.map((x) => x.e));
      const mins = now.getHours() * 60 + now.getMinutes();
      if (mins >= s && mins <= e2) { nowEl.style.left = `${((mins - s) / (e2 - s)) * 100}%`; nowEl.classList.remove("hidden"); }
    }
    updateProgress();
  }
})();
