// Release video timeline. Built synchronously and registered on window.__timelines (HyperFrames contract).
// Entrances only; the next scene's wipe is the exit, except the end card which fades out.
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

  // ---------- Stage: wipes in over the hook and stays until the end card ----------
  const s0 = T.stage[0];
  tl.fromTo("#stage", { clipPath: "inset(0 0 0 100%)" }, { clipPath: "inset(0 0 0 0%)", duration: 0.55, ease: "power4.inOut" }, s0);
  tl.from("#tablet", { x: 140, rotation: 2, opacity: 0, duration: 0.8, ease: "power3.out" }, s0 + 0.15);
  tl.fromTo(".glow", { scale: 0.85 }, { scale: 1.1, duration: T.stage[1] - s0, ease: "sine.inOut" }, s0);

  // Camera: center the focus box at `zoom`, clamped so the tablet edge never shows.
  function camera(shot) {
    const el = document.getElementById("shot-" + shot.id);
    const [x, y, w, h] = shot.focus;
    const z = shot.zoom;
    const fx = (x + w / 2) * S;
    const fy = (y + h / 2) * S;
    const tx = Math.min(0, Math.max(SW - SW * z, SW / 2 - fx * z));
    const ty = Math.min(0, Math.max(SH - SH * z, SH / 2 - fy * z));
    return { el, cam: el.querySelector(".cam"), rings: el.querySelectorAll(".ring"), tx, ty, z };
  }

  T.beats.forEach(function (b, i) {
    const sel = "#copy-" + b.id;
    // Copy block wipes in over the previous one (no exit tweens on the old block).
    if (i > 0) {
      tl.fromTo(sel, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.45, ease: "power3.inOut" }, b.start);
    }
    tl.from(sel + " .count", { x: -40, opacity: 0, duration: 0.45, ease: "power2.out" }, b.start + 0.2);
    tl.from(sel + " h2", { y: 60, opacity: 0, duration: 0.65, ease: "expo.out" }, b.start + 0.3);
    tl.from(sel + " p", { y: 30, opacity: 0, duration: 0.55, ease: "power3.out" }, b.start + 0.6);

    b.shots.forEach(function (shot, j) {
      const c = camera(shot);
      const t0 = shot.start;
      const len = shot.end - shot.start;
      // Quick cut: flash + punch on the tablet, the new shot fades in on top of the previous one.
      tl.fromTo(c.el, { opacity: 0 }, { opacity: 1, duration: 0.22, ease: "power1.out" }, t0);
      if (i + j > 0) {
        tl.fromTo("#flash", { opacity: 0.55 }, { opacity: 0, duration: 0.35, ease: "power2.out", immediateRender: false }, t0);
        tl.fromTo("#tablet", { scale: 0.965 }, { scale: 1, duration: 0.5, ease: "back.out(2)", immediateRender: false }, t0);
      }
      // Camera: wide for a beat, whip-zoom onto the element, then a slow push while it holds.
      tl.fromTo(c.cam, { x: 0, y: 0, scale: 1 }, { x: c.tx, y: c.ty, scale: c.z, duration: 1.05, ease: "power3.inOut" }, t0 + 0.45);
      tl.fromTo(c.cam, { filter: "blur(0px)" }, { filter: "blur(3px)", duration: 0.35, ease: "power2.in", immediateRender: false }, t0 + 0.55);
      tl.to(c.cam, { filter: "blur(0px)", duration: 0.4, ease: "power2.out" }, t0 + 0.9);
      const hold = Math.max(0.6, len - 1.6);
      const z2 = c.z * 1.05;
      const fx = (shot.focus[0] + shot.focus[2] / 2) * S;
      const fy = (shot.focus[1] + shot.focus[3] / 2) * S;
      tl.to(c.cam, {
        x: Math.min(0, Math.max(SW - SW * z2, SW / 2 - fx * z2)),
        y: Math.min(0, Math.max(SH - SH * z2, SH / 2 - fy * z2)),
        scale: z2, duration: hold, ease: "sine.out",
      }, t0 + 1.5);
      // Rings outline the proof once the camera lands.
      tl.from(c.rings, { scale: 1.25, opacity: 0, transformOrigin: "50% 50%", duration: 0.45, ease: "back.out(2.2)", stagger: 0.18 }, t0 + 1.35);
      tl.from(c.el.querySelector(".who"), { y: 20, opacity: 0, duration: 0.35, ease: "power2.out" }, t0 + 0.15);
    });
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
