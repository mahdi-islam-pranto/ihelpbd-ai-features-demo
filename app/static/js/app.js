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
        phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
      };
      return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ""}</svg>`;
    },
  };

  window.UI = UI;
})();
