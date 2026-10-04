// lib/style.js
// One voice for everything Setpoint writes. Import this into any route or
// job that generates text (AI reads now, alert/email/Telegram copy later) so the
// product speaks with a single, consistent style. Edit here to change the voice
// everywhere at once.
//
// Real, direct lesson (Oct 2): naming "Morning Brew" in the prompt was never
// the gap, the model already had that. The real, repeated miss was a field
// meant to be one sentence coming back as two, a backwards, hedge-stacked
// line instead of a punchy one. That rule used to live buried inside each
// route's own JSON schema description, worded slightly differently every
// time, which meant every route had to remember to write it well on its
// own, and a new route would start from zero. It's a real, explicit rule
// here now, same weight as every other rule in this guide, and enforced
// the same way everywhere via checkStyleViolations below, not just asked
// for and hoped.

export const STYLE_GUIDE = `WRITING STYLE (follow exactly):

Voice: Morning Brew. Simple, smart, short, easy to read. A sharp friend who trades, not a newsletter selling a course.

Do:
- Short sentences. One idea each.
- Lead with the point, then the reason. Example: "XLM is stretched. It's pushed higher fast with nothing new behind it."
- Translate technical readings into plain language instead of naming them. "RSI at 78" becomes "stretched" or "overbought." "Volume ratio 0.2" becomes "thin trading" or "not much real interest behind this move." Never say "RSI," "ADX," "plusDI," "volume ratio," or cite their raw values, a reader shouldn't need to know what any of those mean.
- Real price and real percent moves are fine to state directly, those are already plain and meaningful on their own.
- Confident and a little dry. Describe the setup, never hype it.
- Make every line skimmable in five seconds.
- When a field is described as one sentence or a short note, write exactly one sentence. Not two short ones stitched together. If the thought genuinely needs a second idea, cut one of the ideas instead of adding a second sentence.

Never use:
- Em-dashes or en-dashes. Use a period or a comma instead.
- Semicolons. Split into two sentences.
- The construction "it's not just X, it's Y".
- Filler phrases: "in a world where", "at the end of the day", "the reality is", "let's dive in", "needless to say", "that said", "it's worth noting", "ultimately", "arguably", "essentially", "notably".
- Rule-of-three padding like "fast, clean, and simple".
- Emoji or exclamation points.
- Hype words: "massive", "explosive", "skyrocket", "moonshot", "game-changer".

This is informational only. Describe the setup. Never tell the reader to buy or sell.`;

// Raw indicator names/values leaking into customer-facing text instead of
// being translated to plain language, exactly what the style guide above
// forbids. Checked once, here, so every route enforces the same list
// instead of each route hand-rolling its own check, or forgetting one.
const FORBIDDEN_TERMS = [/\brsi\b/i, /\badx\b/i, /\bplus ?di\b/i, /\bminus ?di\b/i, /\bvolume ratio\b/i, /\bvol ratio\b/i];

export function findForbiddenTerms(text) {
  if (!text) return [];
  const found = [];
  for (const re of FORBIDDEN_TERMS) {
    const m = text.match(re);
    if (m) found.push(m[0]);
  }
  return found;
}

export function countSentences(text) {
  if (!text) return 0;
  return text.trim().split(/(?<=[.!?])\s+/).filter(Boolean).length;
}

// The one, shared check any route generating AI text calls on its full,
// parsed JSON result. shortFieldNames lists which fields in that route's
// own schema are meant to be exactly one sentence (a caution, a catalyst
// note, not a "reasoning" field that's meant to run 2-3 sentences) — every
// string field, short or not, still gets checked for forbidden terms.
// Returns a list of real, specific problems found, empty if the output is
// genuinely clean.
export function checkStyleViolations(fields, shortFieldNames = []) {
  const problems = [];
  for (const [name, value] of Object.entries(fields || {})) {
    if (typeof value !== "string" || !value) continue;
    const forbidden = findForbiddenTerms(value);
    if (forbidden.length) problems.push(`"${name}" names a raw indicator (${forbidden.join(", ")}) instead of translating it to plain language`);
    if (shortFieldNames.includes(name) && countSentences(value) > 1) {
      problems.push(`"${name}" is ${countSentences(value)} sentences, it must be exactly one`);
    }
  }
  return problems;
}

// Appended to the system prompt on a real, automatic retry, so the model
// sees exactly what was wrong last time instead of just being asked to
// try again blind.
export function retryInstruction(problems) {
  return `\n\nYour previous attempt at this had a real problem: ${problems.join("; ")}. Write it again, correctly this time, following the rules above exactly.`;
}
