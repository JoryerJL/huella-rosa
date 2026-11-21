// Main timeline. Times come from src/timing.json (injected by build.py as T).
// Rules: entrances only; the next scene's crossfade or wipe is the exit. Only the close fades out.
const T = __TIMING__;
const S = T.sections;
const X = T.xfade;
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });

// Crossfade: the incoming scene fades in over the outgoing one.
function fadeIn(sel, at) {
  tl.fromTo(sel, { opacity: 0 }, { opacity: 1, duration: X, ease: "power1.out" }, at);
}

// ---- Problem 1: paper in the field, Excel at night ----
tl.from("#p1-l1", { y: 50, opacity: 0, duration: 0.7, ease: "power3.out" }, 0.2);
tl.from("#p1-paper", { x: -120, rotation: -12, opacity: 0, duration: 0.9, ease: "expo.out" }, 0.6);
tl.from("#p1-l2", { y: 50, opacity: 0, duration: 0.7, ease: "power3.out" }, 1.9);
tl.from("#p1-arrow", { x: -40, opacity: 0, duration: 0.5, ease: "power2.out" }, 2.2);
tl.from("#p1-sheet", { x: 120, opacity: 0, duration: 0.8, ease: "back.out(1.4)" }, 2.4);
tl.from("#p1-sheet .cell", { opacity: 0, duration: 0.25, stagger: 0.12, ease: "none" }, 2.9);

// ---- Problem 2: four visits, four records ----
fadeIn("#p2", S.p2[0]);
tl.from("#p2-h", { y: 40, opacity: 0, duration: 0.7, ease: "power3.out" }, S.p2[0] + 0.3);
tl.from("#p2 .card", { y: 80, rotation: (i) => [-5, 3, -3, 5][i], opacity: 0, duration: 0.7, stagger: 0.45, ease: "back.out(1.6)" }, S.p2[0] + 1.0);
tl.from("#p2-tally", { scale: 0.7, opacity: 0, duration: 0.6, ease: "elastic.out(1, 0.6)" }, S.p2[0] + 3.2);

// ---- Problem 3: no signal in the sierra ----
fadeIn("#p3", S.p3[0]);
tl.from("#p3-sierra", { y: 140, duration: 1.2, ease: "power2.out" }, S.p3[0] + 0.1);
tl.from("#p3-k", { y: 24, opacity: 0, duration: 0.5, ease: "power2.out" }, S.p3[0] + 0.5);
tl.from("#p3-h", { y: 60, opacity: 0, duration: 0.8, ease: "expo.out" }, S.p3[0] + 0.8);
tl.from("#p3-icon .bars i", { scaleY: 0, transformOrigin: "50% 100%", duration: 0.4, stagger: 0.1, ease: "back.out(2)" }, S.p3[0] + 1.2);
tl.from("#p3-slash", { scaleX: 0, duration: 0.45, ease: "power4.out" }, S.p3[0] + 2.0);

// ---- Idea: wipe in, logo draws, name and tagline ----
tl.fromTo("#idea", { clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.8, ease: "power4.inOut" }, S.idea[0]);
tl.from("#idea-mark", { scale: 0.6, opacity: 0, duration: 0.8, ease: "back.out(1.7)" }, S.idea[0] + 0.7);
tl.from("#idea-mark path", { strokeDashoffset: 1, duration: 0.9, stagger: 0.12, ease: "power2.inOut" }, S.idea[0] + 0.9);
tl.from("#idea-name", { y: 50, opacity: 0, duration: 0.8, ease: "expo.out" }, S.idea[0] + 1.6);
tl.from("#idea-tag .w", { y: 26, opacity: 0, duration: 0.45, stagger: 0.12, ease: "power3.out" }, S.idea[0] + 2.6);
tl.from("#idea-eira", { y: 30, opacity: 0, duration: 0.7, ease: "power2.out" }, S.idea[0] + 4.6);

// ---- Demo: tablets, then one header and one screen per beat ----
fadeIn("#demo", S.demo[0]);
tl.from("#tab-a", { y: 90, opacity: 0, duration: 0.8, ease: "power3.out" }, S.demo[0] + 0.2);
tl.from("#tab-b", { y: 90, opacity: 0, duration: 0.8, ease: "power3.out" }, S.demo[0] + 0.35);
T.beats.forEach((b, i) => {
  const t = b.start;
  const head = "#head-" + b.id;
  fadeIn(head, t);
  tl.from(head + " .kicker", { x: -30, opacity: 0, duration: 0.45, ease: "power2.out" }, t + 0.1);
  tl.fromTo(head + " .progress i.now b", { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: "power2.inOut" }, t + 0.2);
  tl.from(head + " h2", { y: 36, opacity: 0, duration: 0.6, ease: "power3.out" }, t + 0.2);
  tl.from(head + " p", { y: 24, opacity: 0, duration: 0.6, ease: "sine.out" }, t + 0.45);
  tl.from(head + " .pill", { scale: 0.7, opacity: 0, duration: 0.45, stagger: 0.1, ease: "back.out(2)" }, t + 0.6);
  ["a", "b"].forEach((side) => {
    const at = i === 0 ? t + 0.6 : t;
    tl.fromTo("#scr-" + side + "-" + b.id, { opacity: 0 }, { opacity: 1, duration: X, ease: "power1.out" }, at);
  });
});

// ---- Trust: wipe up, title, points, chips ----
tl.fromTo("#trust", { clipPath: "inset(100% 0% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.8, ease: "power4.inOut" }, S.trust[0]);
tl.from("#tr-k", { y: 20, opacity: 0, duration: 0.5, ease: "power2.out" }, S.trust[0] + 0.6);
tl.from("#tr-h", { y: 50, opacity: 0, duration: 0.8, ease: "expo.out" }, S.trust[0] + 0.8);
tl.from("#trust .point", { x: -50, opacity: 0, duration: 0.6, stagger: 1.2, ease: "power3.out" }, S.trust[0] + 2.0);
tl.from("#trust .chip", { y: 30, scale: 0.85, opacity: 0, duration: 0.5, stagger: 0.25, ease: "back.out(1.8)" }, S.trust[0] + 7.4);

// ---- Close: crossfade, logo, tagline, repo, co-brand; final fade out ----
fadeIn("#close", S.close[0]);
tl.from("#cl-mark", { scale: 0.6, rotation: -8, opacity: 0, duration: 0.8, ease: "back.out(1.7)" }, S.close[0] + 0.3);
tl.from("#cl-name", { y: 40, opacity: 0, duration: 0.7, ease: "expo.out" }, S.close[0] + 0.7);
tl.from("#cl-tag", { y: 26, opacity: 0, duration: 0.6, ease: "power3.out" }, S.close[0] + 1.3);
tl.from("#cl-repo", { y: 20, opacity: 0, duration: 0.6, ease: "sine.out" }, S.close[0] + 2.0);
tl.from("#cl-eira", { y: 20, opacity: 0, duration: 0.6, ease: "power2.out" }, S.close[0] + 2.6);
tl.to("#close .scene-content", { opacity: 0, duration: 0.7, ease: "power1.in" }, T.end - 0.8);

window.__timelines["main"] = tl;
