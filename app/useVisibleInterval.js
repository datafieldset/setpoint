"use client";
// app/useVisibleInterval.js
//
// v19.46 (Na, Oct 26): refresh timers that only run while the tab is visible.
//
// A hidden tab (phone screen off, another window in front) used to ask the server, and through it the database,
// every minute or every 30 seconds. Neon's free compute only sleeps after 5 quiet minutes, so one forgotten tab kept it
// awake all day and used up the monthly allowance. Now a hidden tab makes no calls. When it becomes visible again it
// refreshes right away, so what you see is never older than it was when you left.
//
// v19.57 (Na, Oct 29): a tab can also be visible but untouched (phone propped up, screen on). After 5 minutes with no
// tap, scroll or key press, refreshes slow to about every 20 minutes so the database can sleep between them. The
// first touch after that refreshes right away and the normal pace comes back.
import { useEffect, useRef } from "react";

const QUIET_AFTER_MS = 5 * 60 * 1000;
const QUIET_PACE_MS = 20 * 60 * 1000; // Neon sleeps after 5 quiet minutes, so a gap of 20 lets it sleep about 15 of every 20
let lastTouch = typeof Date !== "undefined" ? Date.now() : 0;
const wakeFns = new Set(); // refresh callbacks to run the moment someone returns from a quiet spell
let listening = false;

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const touch = () => {
    const wasQuiet = Date.now() - lastTouch > QUIET_AFTER_MS;
    lastTouch = Date.now();
    if (wasQuiet && document.visibilityState !== "hidden") wakeFns.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  };
  for (const ev of ["pointerdown", "keydown", "scroll", "touchstart"]) window.addEventListener(ev, touch, { passive: true, capture: true });
}

export function useVisibleInterval(fn, ms, { refreshOnShow = false } = {}) {
  const ref = useRef(fn);
  ref.current = fn; // always call the latest version of the function without restarting the timer
  useEffect(() => {
    listen();
    const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
    let lastCall = Date.now();
    const run = () => { lastCall = Date.now(); ref.current(); };
    const id = setInterval(() => {
      if (!visible()) return;
      const quiet = Date.now() - lastTouch > QUIET_AFTER_MS;
      if (quiet && Date.now() - lastCall < Math.max(ms, QUIET_PACE_MS)) return;
      run();
    }, ms);
    const wake = () => { if (Date.now() - lastCall >= ms) run(); };
    wakeFns.add(wake);
    const onShow = () => { if (refreshOnShow && visible()) run(); };
    if (refreshOnShow) document.addEventListener("visibilitychange", onShow);
    return () => { clearInterval(id); wakeFns.delete(wake); if (refreshOnShow) document.removeEventListener("visibilitychange", onShow); };
  }, [ms, refreshOnShow]);
}
