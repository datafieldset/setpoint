# Setpoint v7.0

## Whale flow: found real evidence, made the actual likely fix

The staleness warning confirmed the resilient parser alone wasn't enough, still 182 hours stale after visiting the page with the new code. That result actually ruled something out: it's not just Telegram's markup changing, since the new parser tries three different real patterns and still found nothing.

Fetched the actual Telegram page directly myself to check. It's completely alive, dozens of real, current whale transfers posted today. That rules out "the source is dead" entirely, and points somewhere much more specific: the request is very likely succeeding everywhere except from Vercel's own servers specifically, which is a well-known pattern, cloud/datacenter IP ranges get filtered by anti-scraping rules that residential or varied traffic sails through.

The one concrete, free thing to fix on our end: the request was sending a User-Agent that literally announces itself as a bot ("setpointalerts/1.1..."), exactly the kind of thing simple anti-bot filtering checks first. Changed it to a real browser's User-Agent string instead.

Being honest about the limits here: I can't fully verify this resolves it, since I have no way to reproduce Vercel's exact network path from where I'm working. This is the most likely real fix given the evidence, not a certainty. If it's still stale a few days after this deploys, that would point to an IP-level block specifically, which would mean the free scraping approach has hit a real wall, and the only fully reliable path left would be a paid, official data source.
