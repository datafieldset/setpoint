# Design system

Dark, terminal-adjacent trading dashboard. Real, exact tokens pulled directly from `app/page.jsx`'s stylesheet — re-check there before assuming these haven't drifted.

## Color tokens
```
--panel:  #0F1513   (darkest surface, base panel bg)
--panel2: #151E1A   (slightly lifted surface — chips, dim tags)
--panel3: #1A2621   (lifted further — nested/inner panels)
--border: #223029
--text:   #EAF2EE   (primary text)
--muted:  #93A69D   (secondary/dim text — captions, explanatory lines)
--dim:    #5E7168   (dimmer still — least prominent labels)

--green:      #00D179  (wins, bullish, positive)
--green-soft: #5EE9AE  (softer green variant — "live" tags)
--green-dim:  rgba(0,209,121,.14)  (green tag background)

--red:      #FF5C6C  (losses, bearish, negative)
--red-soft: #FF9AA3
--red-dim:  rgba(255,92,108,.13)

--amber:     #F5B851  (regime-verified / in-between status, caution)
--amber-dim: rgba(245,184,81,.13)
```
Semantic pattern: green = bullish/win/live, red = bearish/loss, amber = regime-specific/caution/in-motion, muted/dim = de-emphasized real data that's still worth showing but not the headline.

## Typography
- **Bricolage Grotesque** — display/heading font (brand-forward, used for hero text, big numbers)
- **Inter** — body/UI font (system-ui fallback)
- **JetBrains Mono** — monospace, used for real numbers/prices/data (`.mono` class) — anywhere a real, checkable figure appears (entry/stop/target, percentages, timestamps), it should render in mono, not the body font, to visually signal "this is real, exact data."

## Recurring UI patterns (reuse these class names/structures before inventing new ones)
- `.rate-src` + modifier (`.live`, `.backtest`, `.regime`) — small, pill-shaped status tag showing where a percentage came from. `live` = green-tinted (currently, genuinely verified), `backtest` = dim/neutral (static number, no live override yet), `regime` = amber-tinted (verified via the regime-only path, not a permanent promotion).
- `.testing-tag` — explicit "testing, not yet verified" label, always shown for TESTING_SIGNALS combos regardless of whether a live number is also showing.
- `.guide-hero` / `.guide-section` / `.guide-card-top` / `.guide-card-name` — the shared, reusable structure for any full-page, "sit down and read it" admin view (Guide, AdminPanel, SignalCatalog all reuse this rather than each inventing their own layout).
- `.admin-stat-row` / `.admin-stat` / `.admin-stat-n` / `.admin-stat-k` — summary stat blocks (big number + small label underneath).
- Mobile-first: built and tested primarily for a narrow, ~380px phone viewport (Na's actual usage is the Chrome mobile browser). Screenfuls matter — keep panels scannable without excessive scrolling, lead with the plain-English conclusion before raw data (see lessons-learned.md on the Market Meter panel).
- `.mm-synthesis` — standing pattern (Sep 24) for any panel combining two or more independent, real readings: lead with one, honest, plain-English sentence synthesizing what they mean together (never a prediction, always "here's what the real, current data leans toward"), styled as a visually prominent, lifted block above the raw data, which stays visible underneath as the receipts. First built for the Market Meter (price-structure read + signal-bias win-rate lean); reuse this shape for any future panel with the same "two real numbers, no honest takeaway" problem.
- "Squeezed" is the customer-facing word for a tight, compressed, low-volatility price range that may be about to break (Sep 24, renamed from "coiled" — Na found "coiled" unclear). Matches the Coil signal's own internal language ("a real volatility squeeze"). Never use "coiled" in new customer-facing copy.

## Skills used
`frontend-design` and `skill-creator` by explicit, standing preference for all of Na's projects (should be consulted before any new UI work, not just this project).
