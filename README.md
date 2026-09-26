# Ultimate Draft Order

A mobile-first, single-page tool for building a personal "ultimate draft order" for an NBA fantasy H2H points league, by blending up to 8 pasted-in ranking sources with your own manually reordered draft list.

No backend, no build step. Open `index.html` directly in a browser, or serve the folder with any static file server.

## Data & privacy

By default, all data (sources, parsed rankings, drafted status, and your draft list) is stored **only in this browser's `localStorage`**, on this device. There is no server and nothing is uploaded anywhere.

**This means, unless you turn on GitHub Sync (below):**
- Your data does not sync across devices or browsers.
- Clearing your browser's site data/history for this page (or using a different browser/profile) will lose it.
- There is no built-in backup — consider it "how-to-use-at-your-own-risk" for anything you'd be upset to lose.

### GitHub Sync (optional)

The Sources tab has a "GitHub Sync" card. Paste in a **fine-grained GitHub Personal Access Token**, scoped to only this repo with `Contents: Read and write` permission, and:
- Your data loads from `data/state.json` in this repo every time the app opens on that device.
- Every change you make (debounced by a couple of seconds) pushes an update back to that file — as an actual git commit.
- Connect the same repo with a token on another device (phone, another browser) and it'll load the same data.

Notes:
- The token is stored **only in that browser's local storage** — it is never written into the code or the repo, so it isn't exposed by the fact that this site is public.
- Because saves are real commits, active use (lots of dragging/reordering) will add a fair number of commits to this repo's history over time.
- Saving requires a network connection and GitHub being reachable; without a token, the app works exactly as before (local-only).

## How it works

- **Draft List tab** — your own editable, drag-to-reorder list, shown the same way (combined rank average, name, position badge, tag emoji, every-10th divider, alternating row shades). It's seeded from the combined average the first time you use it, then persists independently — editing sources never silently overwrites it.
  - A search box filters the list to players matching what you type (tap the ✕ to clear it).
  - A source filter (same tappable chips as Rankings) controls which sources feed the average shown next to each name. Changing it automatically resyncs unlocked players to the newly-filtered average — there's no separate Reset button, and it's easy to undo by dragging things back. A position filter (PG/SG/SF/PF/C, all the same width) just narrows which players are shown, without touching the order.
  - Each position chip also shows how many of the best remaining undrafted players hold that position — e.g. "PG 4" — scoped to a pool size you pick from the dropdown next to the chips (10/20/30/.../100). That count re-ranks live off the current source filter, so it always reflects whichever sources are checked. A position's chip outlines orange once its share of the pool is 25% or lower, and red at 17% or lower, so you can see a position running thin before you're stuck.
  - "Include Drafted Players", "Unlock All", and "Undraft All" sit together on one row. "Unlock All" (with a confirmation) clears every lock at once; "Undraft All" (with a confirmation) puts every drafted player back on the board and clears My Team. Hit the 🔓/🔒 button on a player to lock them in place — locked players don't move when the filter resyncs the list and can't be dragged, everyone else refills around them.
  - Drafted players are hidden here too, but keep their spot in the order so un-drafting restores it. Tap a player to open their detail view and mark them drafted from there.
  - A health emoji shows on the right of a row when Season Stats (Sources tab) supports it — 💪 for a player who played 65+ games in all 3 uploaded seasons, 🚑 for one who played 54 or fewer games in at least 2 of them. Shown only in Draft List, computed fresh from whatever seasons are uploaded (a season with no file, or where this player has no row, just doesn't count toward either).
  - **Smart Search** (its own button right below the search box) opens a structured deep-search overlay: "Find a player with [metric A] [Better Than / Worse Than] [metric B], in at least [N] ranks." Metrics are Combined Rank (using whichever sources Draft List's own filter currently has checked) plus each individual source's own rank — the second dropdown always excludes whatever the first one is set to. "Better Than" compares rank numbers directly: metric A is at least N ranks better (lower) than metric B. For example, "2026 Average Better Than Combined Rank, at least 15 ranks" finds players who ranked well on 2026 Average but have since fallen at least 15 spots in the current Combined Rank — a quick way to spot decliners (or, flipped, breakouts). Once a search runs, the button becomes "Edit Search" (reopens it pre-filled) plus a ✕ that clears it. Tapping any of the other quick filters (a source chip, a position chip, or Include Drafted Players) also clears an active Smart Search, since narrowing them both at once would be ambiguous — but tagging a player or typing in the plain search box does not.
- **My Team tab** — the roster of players you've marked "Drafted by me" (from a player's detail view), in the order you drafted them. Five small counters at the top show how many players you have eligible at each position (PG/SG/SF/PF/C) — a player listed under multiple positions (e.g. "PF, SF") counts toward each.
- **Draft Board tab** — every player marked drafted by any means (not just "Drafted by me" — the plain "Mark Drafted" button too), in the order they were actually drafted. That order is fixed; it's a record of the draft, not something you reorder. It carries the same List filters (source toggle chips) as Draft List, but here they only change which sources feed the combined rank average shown next to each name — they never change the order players appear in. Shown the same way as the other lists otherwise (name, position badge, tag emoji, every-10th divider, alternating row shades).
- **Sources tab** — add up to 8 sources. Each has a name, an optional reference URL (shown as a link only, never fetched), what its "Score" column means (last year avg/game, last year total, or a this-year projection), and a paste-in box for raw ranked player text. Once saved, a source collapses to a summary card — hit "Edit" to paste a new list or change its details, or "Cancel" to back out without saving. Drag a card by its grip bar to reorder sources (this controls, e.g., which source's data wins for a player's positions, and display order in the player detail view).

  Paste format: one player per block, separated by a blank line —
  ```
  4
  LeBron James
  PF, SF
  57.2

  5
  Nikola Jokic
  C
  56
  ```
  Rank and Name are required; Positions and Score are each optional.

  Below the sources sits the **Data List** — a single, separate list that's never part of any ranking (it doesn't feed the combined average, the source filter, or the per-source grid in player detail). It's just extra per-player info to show in the player detail view — currently age and team (height is parsed too but not shown anywhere yet). Paste format is simpler than a ranking source's — no rank: one player per block, Name/Age/Team/Height, with Team and Height each optional —
  ```
  Santi Aldama
  25
  DAL
  7'0"

  Nikola Jokic
  30
  ```

  Below that sits **Season Stats** — 3 fixed upload slots (not a paste box) for the last 3 seasons' per-game stats, also never part of any ranking. Each slot has a label (e.g. "2025-26") and a file picker; pick the `.xls` file Basketball-Reference's "Per Game Stats" page exports (Share & Export → Get table as Excel) — it's actually an HTML table under the hood, so the browser reads it directly with no upload or external service involved. Whatever columns that export has (Age, Team, GP, MPG, full shooting splits, rebounds/assists/steals/blocks/TOV/PF/PTS, Awards, etc.) are carried straight through; a player traded mid-season is collapsed to their one combined-season line. "Clear" removes an uploaded season.

Player names are matched across sources (and the Data List) by normalizing them (case, accents, punctuation, Jr./Sr./III-style suffixes).

Tapping a player opens a detail view. Up top, their name (with a position badge — same style as the list rows' — to its right, sized to match the name's own row height) and, below that, their age from the Data List — with their team alongside it when known, as "25 · DAL" — or "Age unknown" if they're not in the Data List at all. Next, their combined rank average (based on whichever sources are selected in the tab you opened it from) and three tag toggles share a row: ⭐/🌟 Breakout, 🥱/😴 Sleeper (each tap cycles untagged → level 1 → level 2 → untagged), and 🚫 Do Not Draft (a plain on/off toggle). A toggle turns solid blue while tagged — this is the only place you can set these; list rows just display whichever emoji ends up active, on the right of the row. Below that, one square per source — every source you've added, not just the special avg/total ones. Each square shows that source's rank and, if it has one, its actual stat (e.g. an avg or total) side by side on the same row; squares for sources currently active are highlighted blue. Tap a square to toggle that source in or out — the Combined Rank at the top updates live. "Show Data" opens an overlay listing every uploaded Season Stats season for this player (most recent first), each as its own block of every stat that season's file has — "No data" for a season where this player has no row (e.g. a rookie with no earlier seasons). Closing the view (✕, tapping outside, or Escape) carries that filter change back to the tab you opened it from, updating its chips and — in Draft List — resyncing the order to match. At the bottom: "Mark Drafted"/"Undraft" plus "Drafted by me"/"Remove from My Team" — the latter both marks them drafted and adds them to the My Team tab in one step.
