/* Shared helpers + navigation behaviour (loaded on every page). */
(function () {
  "use strict";

  // ---------- Sidebar (mobile) ----------
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebarBackdrop");
  const toggleSidebar = (open) => {
    sidebar?.classList.toggle("open", open);
    backdrop?.classList.toggle("show", open);
  };
  document.getElementById("burger")?.addEventListener("click", () => {
    if (window.innerWidth <= 860) return toggleSidebar(!sidebar.classList.contains("open"));
    const collapsed = document.documentElement.classList.toggle("sb-collapsed");
    try { localStorage.setItem("sidebar", collapsed ? "collapsed" : "open"); } catch {}
  });
  backdrop?.addEventListener("click", () => toggleSidebar(false));

  // Clickable table rows
  document.querySelectorAll("tr[data-href]").forEach((tr) => tr.addEventListener("click", (e) => {
    if (!e.target.closest("a, button")) location.href = tr.dataset.href;
  }));

  // ---------- Utilities (exposed globally) ----------
  const UI = {
    esc(str) {
      return String(str ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      }[c]));
    },
    fmtTime(sec) {
      sec = Math.max(0, Math.floor(Number(sec) || 0));
      const m = Math.floor(sec / 60), s = sec % 60;
      return `${m}:${String(s).padStart(2, "0")}`;
    },
    fmtBytes(n) {
      if (!n) return "0 B";
      const u = ["B", "KB", "MB", "GB"];
      const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
      return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
    },
    scoreColor(score) {
      if (score >= 85) return "#2e9d6a";
      if (score >= 70) return "#d4932a";
      return "#d65353";
    },
    toast(message, type = "") {
      const stack = document.getElementById("toastStack");
      if (!stack) return;
      const el = document.createElement("div");
      el.className = `toast ${type}`;
      el.textContent = message;
      stack.appendChild(el);
      setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; }, 3200);
      setTimeout(() => el.remove(), 3600);
    },
    async copy(text) {
      try {
        await navigator.clipboard.writeText(text);
        UI.toast("Copied to clipboard", "success");
      } catch {
        UI.toast("Copy failed", "error");
      }
    },
    download(filename, content, type = "application/json") {
      const blob = new Blob([content], { type });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    // "2026-11-23T10:00:00Z" -> "5m ago" / "Nov 3, 14:20"
    ago(iso) {
      const d = new Date(iso);
      if (isNaN(d)) return "";
      const s = (Date.now() - d.getTime()) / 1000;
      if (s < 45) return "just now";
      if (s < 3600) return `${Math.round(s / 60)}m ago`;
      if (s < 86400) return `${Math.round(s / 3600)}h ago`;
      if (s < 86400 * 6) return `${Math.round(s / 86400)}d ago`;
      return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    },
    fmtDate(iso) {
      const d = new Date(iso);
      return isNaN(d) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    },
    icon(name, size = 16) {
      const paths = {
        copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
        download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
        check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
        x: '<path d="M6 6l12 12M18 6L6 18"/>',
        alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
        chevron: '<path d="M6 9l6 6 6-6"/>',
        music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
        file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
        sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/>',
        mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
        refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
        package: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>',
        frown: '<circle cx="12" cy="12" r="9"/><path d="M8.5 16.5a5 5 0 0 1 7 0M9 9.5h.01M15 9.5h.01"/>',
        shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.4-8 9-4.6-.6-8-4.5-8-9V6l8-3z"/><path d="M12 9v4M12 16h.01"/>',
        checksq: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12.5l3 3 5-6"/>',
        clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
        tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><path d="M7.5 7.5h.01"/>',
        cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
        trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
        history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
        play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
        pause: '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>',
        link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
        search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
        chat: '<path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.2-4.6A8 8 0 1 1 21 12z"/>',
        users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
        globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
        up: '<path d="M6 15l6-6 6 6"/>',
        target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        captions: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 11h3M13 11h4M7 15h6M15 15h2"/>',
        calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
        arrowl: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
        repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
        note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
        flame: '<path d="M12 22c4 0 7-2.7 7-7 0-3-1.6-5.4-3.3-7.2-.4 2-1.5 3.2-2.7 3.7.3-3.4-1-6.6-4-8.5.3 3.3-1.8 5.6-3.3 7.7A8.2 8.2 0 0 0 5 15c0 4.3 3 7 7 7z"/>',
        handshake: '<path d="M11 17l2 2a1.4 1.4 0 0 0 2-2"/><path d="M14 14l2.5 2.5a1.4 1.4 0 0 0 2-2l-3.9-3.9a2 2 0 0 0-2.8 0l-.9.9a1.4 1.4 0 0 1-2-2l2.8-2.8a3.7 3.7 0 0 1 4.4-.6l.5.3a2 2 0 0 0 1.4.2L21 6"/><path d="M21 5l1 9h-2M3 5L2 14l6.5 6.5a1.4 1.4 0 0 0 2-2M3 6h7"/>',
        inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
        zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
        bulb: '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/>',
        eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
        layers: '<path d="M12 2l10 5-10 5L2 7z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>',
        sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
        lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
        shuffle: '<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
        smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14a5 5 0 0 0 8 0M9 9.5h.01M15 9.5h.01"/>',
        meh: '<circle cx="12" cy="12" r="9"/><path d="M8.5 15h7M9 9.5h.01M15 9.5h.01"/>',
        down: '<path d="M6 9l6 6 6-6"/>',
        chevronr: '<path d="M9 6l6 6-6 6"/>',
        swords: '<path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/><path d="M9.5 6.5L13 3h3v3l-3.5 3.5M5 14l-2 2 2 2 2-2"/>',
        help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
        flag: '<path d="M4 22V4M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1"/>',
        pin: '<path d="M12 17v5M9 10.8V4h6v6.8l2 3.2H7z"/>',
        coffee: '<path d="M17 8h1a4 4 0 0 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM6 2v3M10 2v3M14 2v3"/>',
        chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
        home: '<path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
        cap: '<path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 2 9 2 12 0v-5M22 10v6"/>',
        upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
        grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
        code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/>',
        phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
      };
      return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ""}</svg>`;
    },
  };

  window.UI = UI;
})();
