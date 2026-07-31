# Setpoint v5.9

## Build failure fixed — a real syntax error from v5.8's edit

v5.8 shipped a broken production build. When the meter's JSX was rewritten to add the numeric scale, an extra closing bracket from the old code was left behind, one leftover `)}` after the new code's own closing, invisible on a normal read but a hard syntax error to the actual compiler.

Fixed by removing the orphaned bracket. This time verified with an actual JSX-aware parser (@babel/parser), not just eyeballing the diff, the same tool Next.js itself effectively uses under the hood, catching exactly this class of error before it reaches you instead of after.

Going forward, every page.jsx change gets checked this way, not just visually reviewed. `node --check` alone can't validate JSX at all, it fails on this file with a generic error every time regardless of whether the code is actually correct, which meant real bracket mistakes like this one had no real safety net until now.
