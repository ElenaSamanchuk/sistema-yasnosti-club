/* Runtime блока на Тильде. Скрипт сборки кладёт его в IIFE и вызывает после mount().
   Доступны: __syaBase (базовый URL ассетов), __syaPlayer (общее состояние плеера),
   __syaMusic ("" — генеративный эмбиент через Web Audio, иначе URL mp3), __SYA_WRAP_ID__ */
function __syaRuntime() {
  var root = document.getElementById(__SYA_WRAP_ID__);
  if (!root) return;

  /* ---------- точки в конце абзацев ---------- */
  root.querySelectorAll("p").forEach(function (p) {
    var t = p.lastChild;
    while (t && t.nodeType !== 3 && t.lastChild) t = t.lastChild;
    if (!t || t.nodeType !== 3) return;
    var s = t.data.replace(/\s+$/, "");
    if (/[^.…]\.$/.test(s)) t.data = s.slice(0, -1);
  });

  /* ---------- плавное появление ---------- */
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var noReveal = window.SYA_NO_REVEAL || /[#?&]noreveal\b/.test(location.search + location.hash); /* для сравнения с оригиналом */
  if (!reduce && !noReveal && "IntersectionObserver" in window) {
    var items = [];
    root.querySelectorAll(__SYA_REVEAL__).forEach(function (el) {
      if (items.indexOf(el) < 0) items.push(el);
    });
    items.forEach(function (el) {
      var i = 0, n = el;
      while ((n = n.previousElementSibling)) if (n.hasAttribute("data-sya-reveal")) i++;
      el.style.setProperty("--sya-d", Math.min(i, 6) * 70 + "ms");
      el.setAttribute("data-sya-reveal", "");
    });
    var done = function (el) {
      el.removeAttribute("data-sya-reveal");
      el.classList.remove("sya-in");
      el.style.removeProperty("--sya-d");
    };
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        io.unobserve(el);
        el.classList.add("sya-in");
        var fin = false;
        var end = function (ev) {
          if (ev && ev.target !== el) return;
          if (fin) return;
          fin = true;
          el.removeEventListener("transitionend", end);
          done(el);
        };
        el.addEventListener("transitionend", end);
        setTimeout(end, 1500);
      });
    }, { threshold: 0.1, rootMargin: "0px 0px -6% 0px" });
    items.forEach(function (el) { io.observe(el); });
  }

  /* ---------- плеер: тихая музыка, play/pause ---------- */
  var btn = root.querySelector(".sya-play");
  if (!btn) return;

  var LOOP = 48; /* сек — длина круга прогрессии, по ней едет точка */
  var PHASE = 0.38; /* стартовое положение точки как в макете */

  function synthEngine() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    var ctx = null, master, lp, delay, fb, wet, comp, timer = 0, nextChord = 0, chordIdx = 0, startAt = null;
    var midi = function (m) { return 440 * Math.pow(2, (m - 69) / 12); };
    /* D-мажорная тёплая прогрессия: Dmaj9 → Bm7 → Gmaj7 → A(add9) */
    var CHORDS = [[50, 57, 66, 73], [47, 54, 62, 69], [43, 50, 59, 66], [45, 52, 61, 71]];
    var CHORD_LEN = LOOP / CHORDS.length;
    var SPARK = [74, 76, 78, 81, 83, 86]; /* пентатоника D, 5-я октава */

    function build() {
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0;
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -24; comp.knee.value = 20; comp.ratio.value = 3; comp.attack.value = 0.05; comp.release.value = 0.4;
      lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1100; lp.Q.value = 0.4;
      delay = ctx.createDelay(2); delay.delayTime.value = 0.41;
      fb = ctx.createGain(); fb.gain.value = 0.34;
      wet = ctx.createGain(); wet.gain.value = 0.3;
      lp.connect(master);
      lp.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(master);
      master.connect(comp); comp.connect(ctx.destination);
    }
    function voice(freq, t0, dur, type, gain, detune) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = freq; o.detune.value = detune || 0;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 3.2);
      g.gain.setValueAtTime(gain, t0 + dur - 4.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(lp);
      o.start(t0); o.stop(t0 + dur + 0.1);
    }
    function scheduleChord(i, t0) {
      var notes = CHORDS[i % CHORDS.length], dur = CHORD_LEN + 3; /* внахлёст со следующим */
      notes.forEach(function (m, k) {
        var f = midi(m), g = k === 0 ? 0.075 : 0.055 - k * 0.006;
        voice(f, t0, dur, "triangle", g, -5);
        voice(f, t0, dur, "triangle", g * 0.8, 6);
        if (k === 0) voice(f / 2, t0, dur, "sine", 0.06, 0);
      });
      /* редкие тихие «капли» поверх аккорда */
      var n = 1 + Math.floor(Math.random() * 2);
      for (var s = 0; s < n; s++) {
        var ts = t0 + 2 + Math.random() * (CHORD_LEN - 5);
        var o = ctx.createOscillator(), g2 = ctx.createGain();
        o.type = "sine"; o.frequency.value = midi(SPARK[Math.floor(Math.random() * SPARK.length)]);
        g2.gain.setValueAtTime(0.0001, ts);
        g2.gain.exponentialRampToValueAtTime(0.03, ts + 0.04);
        g2.gain.exponentialRampToValueAtTime(0.0001, ts + 3.5);
        o.connect(g2); g2.connect(delay); g2.connect(master);
        o.start(ts); o.stop(ts + 3.6);
      }
    }
    function tick() {
      while (nextChord < ctx.currentTime + 6) {
        scheduleChord(chordIdx, nextChord);
        nextChord += CHORD_LEN;
        chordIdx++;
      }
    }
    function running(res, rej) {
      var tries = 0;
      (function chk() {
        if (ctx.state === "running") return res();
        if (++tries > 6) return rej(new Error("autoplay blocked"));
        setTimeout(chk, 40);
      })();
    }
    return {
      play: function () {
        if (!ctx) build();
        var p = ctx.resume();
        if (p && p.catch) p.catch(function () {});
        return new Promise(function (res, rej) {
          running(function () {
            var now = ctx.currentTime;
            if (startAt === null) { startAt = now; nextChord = now + 0.05; }
            master.gain.cancelScheduledValues(now);
            master.gain.setTargetAtTime(0.32, now, 0.7);
            tick();
            clearInterval(timer);
            timer = setInterval(tick, 1000);
            res();
          }, rej);
        });
      },
      pause: function () {
        if (!ctx) return;
        clearInterval(timer); timer = 0;
        var now = ctx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setTargetAtTime(0.0001, now, 0.12);
        setTimeout(function () { if (ctx.state === "running" && !__syaPlayer.playing) ctx.suspend(); }, 450);
      },
      progress: function () {
        if (!ctx || startAt === null) return PHASE;
        return (PHASE + ((ctx.currentTime - startAt) % LOOP) / LOOP) % 1;
      }
    };
  }

  function fileEngine(url) {
    var a = document.createElement("audio");
    a.src = url; a.loop = true; a.preload = "metadata"; a.volume = 0.35;
    a.setAttribute("playsinline", "");
    return {
      play: function () { var p = a.play(); return p && p.then ? p : Promise.resolve(); },
      pause: function () { a.pause(); },
      progress: function () { return a.duration ? a.currentTime / a.duration : 0; }
    };
  }

  var engine = __syaMusic ? fileEngine(/^https?:|^\//.test(__syaMusic) ? __syaMusic : __syaBase + __syaMusic) : synthEngine();
  if (!engine) return;
  __syaPlayer.progress = function () { return engine.progress(); };

  function setUI(on) {
    __syaPlayer.playing = on;
    if (on) root.setAttribute("data-sya-playing", ""); else root.removeAttribute("data-sya-playing");
    btn.setAttribute("aria-label", on ? "Пауза" : "Слушать");
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  function play() {
    return engine.play().then(function () { setUI(true); }, function () { setUI(false); });
  }
  function pause() { setUI(false); engine.pause(); }

  btn.addEventListener("click", function (ev) {
    ev.preventDefault();
    if (__syaPlayer.playing) pause();
    else play();
  });

  /* без автозапуска: музыка стартует только по клику на play */
  setUI(false);
}
