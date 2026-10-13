// Renderer for the transparent full-window throw overlay. The main process expands this view to the
// whole window, calls window.playThrow(ballId), and shrinks it back when the returned promise settles.
// Purely cosmetic: it draws the thrown ball arcing in, a flash, a drop-and-bounce, and three wobbles,
// then rests and fades — it never shows a catch/escape outcome (that's the DM's call).
import { ballSvg } from "../src/poke5e/ball-art.js";

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Run a WAAPI animation, then bake its final frame to inline style so the next phase continues from it. */
function run(el: Element, frames: Keyframe[], opts: KeyframeAnimationOptions): Promise<void> {
  const a = el.animate(frames, { fill: "forwards", ...opts });
  return a.finished.then(() => { try { a.commitStyles(); } catch { /* ignore */ } a.cancel(); });
}
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function playThrow(ballId: string): Promise<void> {
  const stage = document.getElementById("stage");
  if (!stage) return;
  stage.innerHTML = ""; // drop any in-flight throw so a rapid re-throw restarts cleanly

  const scrim = document.createElement("div"); scrim.className = "ov-scrim";
  const flash = document.createElement("div"); flash.className = "ov-flash";
  const ball = document.createElement("div"); ball.className = "ov-ball"; ball.innerHTML = ballSvg(ballId);
  const ballEl = ball as HTMLElement;
  ballEl.style.transform = "translate(0, 62vh) scale(.5)"; // start below the window (no centre flash)
  stage.append(scrim, flash, ball);

  const T = reduce ? 0.4 : 1; // time scale (reduced motion → quick)
  try {
    run(scrim, [{ opacity: 0 }, { opacity: 0.3 }], { duration: 300 * T });

    // A — fly in: a spinning parabola up from below to centre.
    await run(ball, [
      { transform: "translate(0, 62vh) scale(.5) rotate(0deg)" },
      { transform: "translate(0, -6vh) scale(1.08) rotate(560deg)", offset: 0.72 },
      { transform: "translate(0, 0) scale(1) rotate(720deg)" },
    ], { duration: 640 * T, easing: "cubic-bezier(.2,.7,.3,1)" });

    // B — flash of capture light at centre.
    run(flash, [{ opacity: 0 }, { opacity: 0.95, offset: 0.3 }, { opacity: 0 }], { duration: 420 * T, easing: "ease-out" });

    // C — drop to rest with a squash/stretch bounce.
    const base = "translate(0, 10vh) scale(.92)";
    await run(ball, [
      { transform: "translate(0, 0) scale(1)", easing: "cubic-bezier(.45,0,.9,.35)" },
      { transform: "translate(0, 10vh) scaleX(1.1) scaleY(.8)", offset: 0.5 },
      { transform: "translate(0, 7vh) scale(.92)", offset: 0.7, easing: "ease-out" },
      { transform: "translate(0, 10vh) scaleX(1.06) scaleY(.88)", offset: 0.86 },
      { transform: base },
    ], { duration: 520 * T });
    ballEl.style.transformOrigin = "50% 86%"; // pivot on the ground for the wobble

    // D — three slow wobbles.
    for (let w = 0; w < 3; w++) {
      const dir = w % 2 === 0 ? -1 : 1;
      await run(ball, [
        { transform: base + " rotate(0deg)" },
        { transform: base + ` rotate(${dir * 15}deg)`, offset: 0.3 },
        { transform: base + ` rotate(${-dir * 10}deg)`, offset: 0.65 },
        { transform: base + " rotate(0deg)" },
      ], { duration: 540 * T, easing: "ease-in-out" });
      if (!reduce) await wait(150);
    }
    if (!reduce) await wait(260); // hold on the cliffhanger — the DM rules on the catch

    // E — rest and fade away (no "caught"/"broke free").
    run(ball, [{ opacity: 1 }, { opacity: 0 }], { duration: 340, easing: "ease-in" });
    await run(scrim, [{ opacity: 0.3 }, { opacity: 0 }], { duration: 360, easing: "ease-in" });
  } catch { /* cosmetic — swallow */ } finally {
    stage.innerHTML = "";
  }
}

(window as unknown as { playThrow: typeof playThrow }).playThrow = playThrow;
