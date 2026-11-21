// Release video timeline (v2). Built synchronously and registered on window.__timelines (HyperFrames contract).
// Scenes enter with wipes; the next scene's wipe is the exit, except the end card which fades out.
window.__timelines = window.__timelines || {};
(function () {
  const T = __TIMING__;
  const [SW, SH] = T.screen;
  const S = T.scale;
  const tl = gsap.timeline({ paused: true });

  // ---------- Hook: the fingerprint builds in, then the two lines ----------
  tl.from("#hook .mark .tile", { scale: 0.4, opacity: 0, transformOrigin: "50% 50%", duration: 0.6, ease: "back.out(1.6)" }, 0.15);
  tl.fromTo("#hook .mark path", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.1, ease: "power2.inOut", stagger: 0.08 }, 0.35);
  tl.from("#hook-l1", { y: 70, opacity: 0, duration: 0.7, ease: "power3.out" }, 1.1);
  tl.from("#hook-l2", { y: 70, opacity: 0, duration: 0.7, ease: "expo.out" }, 1.75);
  tl.fromTo("#hook h1", { scale: 1 }, { scale: 1.04, duration: T.hook[1] - 1.1, ease: "none" }, 1.1);

  // ---------- Stage: revealed under the first question card, stays until the end card ----------
  const s0 = T.beats[0].card[0];
  tl.fromTo("#stage", { clipPath: "inset(0 0 0 100%)" }, { clipPath: "inset(0 0 0 0%)", duration: 0.01, ease: "none" }, s0 + 0.6);
  tl.fromTo(".glow", { scale: 0.85 }, { scale: 1.1, duration: T.end[0] - s0, ease: "sine.inOut" }, s0);

  // Camera: a window [x, y, w] of the 1280x800 tablet fills the screen (clamped so the tablet edge never shows).
  function view(v) {
    const z = 1280 / v[2];
    const x = Math.min(0, Math.max(SW - SW * z, -v[0] * S * z));
    const y = Math.min(0, Math.max(SH - SH * z, -v[1] * S * z));
    return { x: x, y: y, scale: z };
  }

  function spotTweens(root, spots) {
    const els = root.querySelectorAll(".spot");
    els.forEach(function (el) {
      const sp = spots[Number(el.dataset.i)];
      tl.fromTo(el, { opacity: 0, scale: 1.12 }, { opacity: 1, scale: 1, transformOrigin: "50% 50%", duration: 0.28, ease: "back.out(2)" }, sp[0]);
      tl.to(el, { opacity: 0, duration: 0.22, ease: "power1.in" }, Math.max(sp[0] + 0.3, sp[1] - 0.22));
    });
  }

  T.beats.forEach(function (b, i) {
    // Question card wipes in over whatever is on screen, holds, then wipes off to reveal the beat.
    const c = "#card-" + b.id;
    const [c0, c1] = b.card;
    tl.fromTo(c, { clipPath: "inset(0 0 0 100%)" }, { clipPath: "inset(0 0 0 0%)", duration: 0.45, ease: "power4.inOut" }, c0);
    tl.from(c + " .count", { y: 24, opacity: 0, duration: 0.4, ease: "power2.out" }, c0 + 0.3);
    tl.from(c + " h2", { y: 60, opacity: 0, scale: 0.96, duration: 0.6, ease: "expo.out" }, c0 + 0.35);
    tl.to(c, { clipPath: "inset(0 100% 0 0)", duration: 0.45, ease: "power4.inOut" }, c1 - 0.45);

    // Copy: the question, the headline, and one caption per step of the action.
    const cp = "#copy-" + b.id;
    const f0 = b.foot[0];
    tl.from(cp + " .ask", { x: -30, opacity: 0, duration: 0.4, ease: "power2.out" }, f0 + 0.1);
    tl.from(cp + " h2", { y: 40, opacity: 0, duration: 0.55, ease: "expo.out" }, f0 + 0.2);
    tl.from(cp + " .dots", { opacity: 0, duration: 0.3, ease: "power1.out" }, f0 + 0.3);
    b.steps.forEach(function (st, k) {
      const el = "#step-" + b.id + "-" + k;
      tl.fromTo(el, { y: 34, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, st[0] + 0.12);
      tl.to("#dot-" + b.id + "-" + k, { backgroundColor: "#FFA9B8", duration: 0.25, ease: "power1.out" }, st[0] + 0.05);
      const next = b.steps[k + 1];
      if (next) tl.to(el, { y: -24, opacity: 0, duration: 0.18, ease: "power2.in" }, next[0] - 0.06);
    });

    // Shots: each enters with a flash cut (new place) or blends in (same take continues); the camera follows the keys.
    b.shots.forEach(function (shot, j) {
      const el = document.getElementById("shot-" + shot.id);
      const t0 = shot.start;
      tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: shot.cut === "flash" ? 0.18 : 0.08, ease: "power1.out" }, t0);
      if (shot.cut === "flash") {
        tl.fromTo("#flash", { opacity: 0.5 }, { opacity: 0, duration: 0.35, ease: "power2.out", immediateRender: false }, t0);
        tl.fromTo("#tablet", { scale: 0.975 }, { scale: 1, duration: 0.45, ease: "back.out(2)", immediateRender: false }, t0);
      }
      if (shot.duo) {
        el.querySelectorAll(".strip").forEach(function (strip, n) {
          tl.from(strip, { x: n ? 60 : -60, opacity: 0, duration: 0.5, ease: "power3.out" }, t0 + 0.05 * n);
          tl.from(strip.querySelector(".who"), { y: 16, opacity: 0, duration: 0.3, ease: "power2.out" }, t0 + 0.3);
        });
        spotTweens(el, shot.spots);
        return;
      }
      const cam = el.querySelector(".cam");
      let prev = view(shot.keys[0][1]);
      tl.set(cam, prev, t0);
      for (let k = 1; k < shot.keys.length; k++) {
        const [at, v] = shot.keys[k];
        const target = view(v);
        const gap = at - shot.keys[k - 1][0];
        const dur = Math.min(0.75, Math.max(0.35, gap * 0.8));
        tl.to(cam, Object.assign({ duration: dur, ease: "power3.inOut" }, target), at - dur);
        const big = Math.max(target.scale / prev.scale, prev.scale / target.scale) > 1.25;
        if (big) {
          tl.to(cam, { filter: "blur(2.5px)", duration: dur * 0.4, ease: "power2.in" }, at - dur);
          tl.to(cam, { filter: "blur(0px)", duration: dur * 0.5, ease: "power2.out" }, at - dur * 0.5);
        }
        prev = target;
      }
      spotTweens(el, shot.spots);
    });

    if (b.stamp) {
      tl.fromTo("#stamp-" + b.id, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(2.2)" }, b.stamp[0]);
      // Hidden once the next question card covers the tablet.
      tl.to("#stamp-" + b.id, { opacity: 0, duration: 0.05, ease: "none" }, b.copy[1] - 0.3);
    }
  });

  // ---------- End card ----------
  const e0 = T.end[0];
  tl.fromTo("#end", { clipPath: "circle(0% at 50% 50%)" }, { clipPath: "circle(75% at 50% 50%)", duration: 0.7, ease: "power3.inOut" }, e0);
  tl.from("#end .mark .tile", { scale: 0.5, opacity: 0, transformOrigin: "50% 50%", duration: 0.55, ease: "back.out(1.7)" }, e0 + 0.35);
  tl.fromTo("#end .mark path", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.9, ease: "power2.inOut", stagger: 0.06 }, e0 + 0.5);
  tl.from("#end-name", { y: 50, opacity: 0, duration: 0.6, ease: "expo.out" }, e0 + 0.8);
  tl.from("#end-tagline .w", { y: 24, opacity: 0, duration: 0.4, ease: "power2.out", stagger: 0.06 }, e0 + 1.2);
  tl.from("#end-madefor", { y: 20, opacity: 0, duration: 0.5, ease: "power3.out" }, e0 + 2.1);
  tl.from("#end-url", { scale: 0.9, opacity: 0, duration: 0.5, ease: "back.out(1.8)" }, e0 + 2.5);
  tl.to("#end .scene-content", { opacity: 0, duration: 0.6, ease: "power1.in" }, T.total - 0.7);

  window.__timelines["main"] = tl;
})();
