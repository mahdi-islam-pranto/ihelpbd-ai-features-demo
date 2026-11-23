/* Compact audio player with a real waveform (decoded via Web Audio).
 * Usage: const p = createAudioPlayer(rootEl); p.load(url, blobOrUrl); p.clear(); p.audio */
(function () {
  "use strict";
  const BARS = 64;
  const SPEEDS = [1, 1.25, 1.5, 2, 0.75];

  function createAudioPlayer(root) {
    const audio = root.querySelector("audio");
    const playBtn = root.querySelector("[data-play]");
    const wave = root.querySelector("[data-wave]");
    const time = root.querySelector("[data-time]");
    const speedBtn = root.querySelector("[data-speed]");
    let bars = [], raf = null, token = 0;

    function drawBars(peaks) {
      wave.innerHTML = peaks.map((p) => `<i style="height:${Math.max(10, Math.round(p * 100))}%"></i>`).join("");
      bars = [...wave.children];
      paint();
    }

    function placeholder() {
      const p = [];
      for (let i = 0; i < BARS; i++) p.push(0.3 + 0.25 * Math.abs(Math.sin(i * 0.7)) + 0.15 * Math.abs(Math.sin(i * 2.3)));
      drawBars(p);
    }

    async function analyse(source) {
      const my = ++token;
      wave.classList.add("loading");
      placeholder();
      try {
        const buf = source instanceof Blob ? await source.arrayBuffer() : await (await fetch(source)).arrayBuffer();
        const AC = window.AudioContext || window.webkitAudioContext;
        const ctx = new AC();
        const data = await ctx.decodeAudioData(buf);
        ctx.close();
        if (my !== token) return;
        const ch = data.getChannelData(0);
        const step = Math.floor(ch.length / BARS) || 1;
        const stride = Math.max(1, Math.floor(step / 500));
        const peaks = [];
        for (let i = 0; i < BARS; i++) {
          let sum = 0, n = 0;
          for (let j = i * step; j < (i + 1) * step && j < ch.length; j += stride) { sum += Math.abs(ch[j]); n++; }
          peaks.push(n ? sum / n : 0);
        }
        const max = Math.max(...peaks) || 1;
        drawBars(peaks.map((p) => Math.sqrt(p / max)));
      } catch {
        /* undecodable audio: keep the placeholder bars */
      }
      if (my === token) wave.classList.remove("loading");
    }

    function paint() {
      const d = audio.duration || 0;
      const n = d ? Math.round((audio.currentTime / d) * bars.length) : 0;
      bars.forEach((b, i) => b.classList.toggle("on", i < n));
      time.textContent = `${UI.fmtTime(audio.currentTime)} / ${UI.fmtTime(d)}`;
    }

    function loop() { paint(); raf = requestAnimationFrame(loop); }
    const stop = () => { root.classList.remove("playing"); cancelAnimationFrame(raf); paint(); };

    audio.addEventListener("play", () => { root.classList.add("playing"); cancelAnimationFrame(raf); loop(); });
    audio.addEventListener("pause", stop);
    audio.addEventListener("ended", stop);
    audio.addEventListener("loadedmetadata", paint);

    playBtn.addEventListener("click", () => (audio.paused ? audio.play().catch(() => {}) : audio.pause()));
    wave.addEventListener("click", (e) => {
      if (!audio.duration) return;
      const r = wave.getBoundingClientRect();
      audio.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * audio.duration;
      paint();
    });
    speedBtn.addEventListener("click", () => {
      const next = SPEEDS[(SPEEDS.indexOf(audio.playbackRate) + 1) % SPEEDS.length];
      audio.playbackRate = next;
      speedBtn.textContent = `${next}x`;
    });

    return {
      audio,
      load(src, source) {
        audio.src = src;
        audio.load();
        root.classList.remove("hidden");
        analyse(source || src);
      },
      clear() {
        token++;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        wave.innerHTML = "";
        bars = [];
        time.textContent = "0:00 / 0:00";
        root.classList.add("hidden");
      },
    };
  }

  window.createAudioPlayer = createAudioPlayer;
})();
