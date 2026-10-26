"use client";
// app/useVisibleInterval.js
//
// v19.46 (Na, Oct 26): refresh timers that only run while the tab is visible.
//
// A hidden tab (phone screen off, another window in front) used to ask the server, and through it the database,
// every minute or every 30 seconds. Neon's free compute only sleeps after 5 quiet minutes, so one forgotten tab kept it
// awake all day and used up the monthly allowance. Now a hidden tab makes no calls. When it becomes visible again it
// refreshes right away, so what you see is never older than it was when you left.
import { useEffect, useRef } from "react";

export function useVisibleInterval(fn, ms, { refreshOnShow = false } = {}) {
  const ref = useRef(fn);
  ref.current = fn; // always call the latest version of the function without restarting the timer
  useEffect(() => {
    const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
    const id = setInterval(() => { if (visible()) ref.current(); }, ms);
    const onShow = () => { if (refreshOnShow && visible()) ref.current(); };
    if (refreshOnShow) document.addEventListener("visibilitychange", onShow);
    return () => { clearInterval(id); if (refreshOnShow) document.removeEventListener("visibilitychange", onShow); };
  }, [ms, refreshOnShow]);
}
