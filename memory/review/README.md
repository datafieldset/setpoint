# Review: prove your work before sending it

Direct request from Na (Oct 11). He kept going back and forth after each
reply: something was off, he spotted it, we fixed it. The goal of this
folder is to move that checking BEFORE the reply, so what lands in his
hands has already been tested, verified and fixed.

## The goal, every time
When Na reads a reply, he should be able to trust it. If a number is in
it, the number was checked against its source. If something shipped, it
was seen working live. If something is uncertain, the reply says so
plainly instead of hoping.

## The process (run it on every piece of work, not just big ones)
1. **State the claim.** Before sending, list what the reply asserts: "X is fixed", "the rate is Y%", "it's live". Each one needs proof.
2. **Run the automated check.** `node scripts/review.mjs` from the repo root. It catches syntax errors, broken imports, JSX parse errors and known drift traps. Fix everything it reports. Do not send with failures.
3. **Prove it live (after a push).** `node scripts/verify-live.mjs`. Site up, stats API healthy, deploy matches the commit. Wait for the deploy; do not report "live" from a push alone.
4. **Prove the numbers.** Any figure given to Na is recomputed from the raw source in the same turn (query, replay, arithmetic run in code), not remembered or estimated. If a figure came from an earlier turn, re-check it or say it's old.
5. **Challenge it.** Ask: what would Na notice that I haven't? Look at the real output, not just that it ran: the actual cards, the actual page, the actual alert text. Think about the empty case, the extreme case, the case that bit us before (see lessons-learned.md).
6. **Use a second pair of eyes for high-stakes work.** Changes to signal ratings, verification rules, money, push alerts or anything customers see: have a separate agent re-check it without having seen the work being produced (the Agent tool), then fix what it finds.
7. **Fix, then re-run.** A problem found in review gets fixed and the checks run again. Only then reply.
8. **Report honestly.** Say what was checked and what couldn't be (for example "couldn't view the page in a browser"). Never claim a check that wasn't run.

## What this folder holds
- `README.md` this process
- `checklist.md` the specific things to check, by kind of work
- scripts live in `/scripts` (`review.mjs`, `verify-live.mjs`)
- add a dated line to `lessons-learned.md` whenever review catches something the checks missed, and extend the checks so it can't slip through twice

## Why it exists (the repeating failures)
- Two copies of one rule drift apart (backtest vs live pctMin; client vs server tf lists).
- A number shipped with a hidden catch (the "+0.38R per trade" headline looked fine until Na asked about tiny 1m targets).
- "Done" reported before checking it is live.
- A figure carried over from an earlier turn and no longer true.
