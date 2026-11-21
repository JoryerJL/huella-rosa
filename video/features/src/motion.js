// Timeline for one feature video. Times are injected by build.py as T.
// Rules (same as demo-2min): entrances only; the next scene's crossfade or wipe is the exit.
const T = __TIMING__;
const X = T.xfade;
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });

function fadeIn(sel, at) {
  tl.fromTo(sel, { opacity: 0 }, { opacity: 1, duration: X, ease: "power1.out" }, at);
}

// ---- Title card: feature name and one plain sentence ----
tl.from("#t-k", { x: -30, opacity: 0, duration: 0.5, ease: "power2.out" }, 0.15);
tl.from("#t-h", { y: 50, opacity: 0, duration: 0.7, ease: "expo.out" }, 0.3);
tl.from("#t-p", { y: 30, opacity: 0, duration: 0.6, ease: "power3.out" }, 0.75);
tl.from("#t-brand", { y: 20, opacity: 0, duration: 0.5, ease: "power2.out" }, 1.1);

// ---- Clip in the tablet mockup ----
tl.fromTo("#demo", { clipPath: "inset(0% 100% 0% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.6, ease: "power4.inOut" }, T.demo[0]);
tl.from("#d-k", { x: -24, opacity: 0, duration: 0.45, ease: "power2.out" }, T.demo[0] + 0.35);
tl.from("#d-h", { y: 30, opacity: 0, duration: 0.55, ease: "power3.out" }, T.demo[0] + 0.45);
tl.from(".tablet", { y: 70, opacity: 0, duration: 0.6, stagger: 0.1, ease: "power3.out" }, T.demo[0] + 0.3);
tl.from(".label", { opacity: 0, duration: 0.4, ease: "sine.out" }, T.demo[0] + 0.6);
tl.fromTo(".screen", { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power1.out" }, T.demo[0] + 0.6);

// ---- End card ----
fadeIn("#close", T.close[0]);
tl.from("#cl-mark", { scale: 0.6, rotation: -8, opacity: 0, duration: 0.6, ease: "back.out(1.7)" }, T.close[0] + 0.2);
tl.from("#cl-name", { y: 36, opacity: 0, duration: 0.55, ease: "expo.out" }, T.close[0] + 0.45);
tl.from("#cl-eira", { y: 20, opacity: 0, duration: 0.5, ease: "power2.out" }, T.close[0] + 0.8);

window.__timelines["main"] = tl;
