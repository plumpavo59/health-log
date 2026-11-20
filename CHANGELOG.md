# Life HQ phone app – changelog

Newest first. The version shows in Settings › About (APP_VERSION in app.js) and in the service worker cache name (sw.js).
Older releases (v21–v88) are listed in Drive › _LIFE HQ › History › Life HQ history.

## v93 · 20 Nov 2026 (Claude)
- Today is calmer (Ru: too much text, can't see what's important): calendar events only (no suggested schedule); the notes box keeps Ru's own lines and at most two heads-up bullets; tasks as **Priority** (P1) and **Important** (P2, P3), everything else folded under **Other tasks (n)**; a **Tomorrow** list with tomorrow's events and P1–P3 tasks.
- New **Sort** tab: Sort's summary (opens Sort) and the Quick questions, moved off Today.
- Faster start: the heavy health data waits a few seconds when the app opens on Today, Ahead, Sort or Money; the "Tomorrow's plan is ready" check is gone.

## v92 · 20 Nov 2026 (Claude)
- Check-in: one **In bed / Up** switch instead of Wake / Day / Bed (Ru: "I check in either in bed or out of bed"). It guesses from the sleep taps and the time; the tracker's Period is worked out from it as before (in bed before getting up = Wake, in bed later = Bed, up = by the clock).
- Sleep quality, sleep disturbed, the on-waking buttons and ring-off times left the check-in: they're a **Last night › Sleep** button, any time of the day until rated.
- Stress left the check-in: **Tonight › Stress today**, from 19:30 until logged.
- Into bed: **With Mara** button beside Home / Mara's / Other (Dashboard job 22), remembered for one night like the place.
- Needs receiver HealthLog v92 to remember across devices what's already rated (works locally without it).

## v91 · 20 Nov 2026 (Claude)
- Today: an **Upkeep** line from Ru - Sort's summary (Life HQ › Sort!C1): how much is waiting today, about how long, and how much to clear out. Tap opens Sort. Hidden until the receiver has Api.gs v91 ("upkeep" action).

## v90 · 18 Nov 2026 (Claude Code on the Mac; pushed 20 Nov)
- "Then" shows at most 5 tasks; the rest wait under "If there's time" as "Also due".

## v89 · 18 Nov 2026 (Claude Code on the Mac; pushed 20 Nov)
- Quick questions card on Today (up to 3, one tap answers go to the inbox). Needs receiver v89.
- Sleep quality asked on the first check-in of the day, whatever its period.
- Medicine order, "kept off the Log tab" and the check-in watch list come from the tracker's Log settings, so no medicine names live in this public code.
