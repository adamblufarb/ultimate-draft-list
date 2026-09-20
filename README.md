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

- **Rankings tab** — a simplified, scannable list: each row shows a player's combined rank average on the left (not a list position — it's a fixed per-player stat), their name, and their position(s) in a small badge. Rows alternate a lighter shade for readability. Shows a combined average ranking across whichever sources you select — a player's average only counts the sources that actually ranked them. Tap a player to see their full detail view (that's also where you mark them drafted); tap "Include Drafted Players" to bring drafted players back into view.
- **Draft List tab** — your own editable, drag-to-reorder list, shown the same way (combined rank average, name, position badge, alternating row shades). It's seeded from the combined average the first time you use it, then persists independently — editing sources never silently overwrites it.
  - A search box filters the list to players matching what you type (tap the ✕ to clear it).
  - A source filter (same tappable chips as Rankings) controls which sources feed the average shown next to each name. Changing it automatically resyncs unlocked players to the newly-filtered average — there's no separate Reset button, and it's easy to undo by dragging things back. A position filter (PG/SG/SF/PF/C, all the same width) just narrows which players are shown, without touching the order.
  - Each position chip also shows how many of the best remaining undrafted players hold that position — e.g. "PG 4" — scoped to a pool size you pick from the dropdown next to the chips (10/20/30/.../100). That count re-ranks live off the current source filter, so it always reflects whichever sources are checked. A position's chip outlines orange once its share of the pool is 25% or lower, and red at 17% or lower, so you can see a position running thin before you're stuck.
  - "Include Drafted Players", "Unlock All", and "Undraft All" sit together on one row. "Unlock All" (with a confirmation) clears every lock at once; "Undraft All" (with a confirmation) puts every drafted player back on the board and clears My Team. Hit the 🔓/🔒 button on a player to lock them in place — locked players don't move when the filter resyncs the list and can't be dragged, everyone else refills around them.
  - Drafted players are hidden here too, but keep their spot in the order so un-drafting restores it. Tap a player to open their detail view and mark them drafted from there.
- **My Team tab** — the roster of players you've marked "Drafted by me" (from a player's detail view), in the order you drafted them. Five small counters at the top show how many players you have eligible at each position (PG/SG/SF/PF/C) — a player listed under multiple positions (e.g. "PF, SF") counts toward each.
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

Player names are matched across sources by normalizing them (case, accents, punctuation, Jr./Sr./III-style suffixes).

Tapping a player opens a detail view with their combined rank average (based on whichever sources are selected in the tab you opened it from) as its own row up top, then one square per source — every source you've added, not just the special avg/total ones. Each square shows that source's rank and, if it has one, its actual stat (e.g. an avg or total) side by side on the same row; squares for sources currently active are highlighted blue. Tap a square to toggle that source in or out — the Combined Rank at the top updates live. Closing the view (✕, tapping outside, or Escape) carries that filter change back to the tab you opened it from, updating its chips and — in Draft List — resyncing the order to match. At the bottom: "Mark Drafted"/"Undraft" plus "Drafted by me"/"Remove from My Team" — the latter both marks them drafted and adds them to the My Team tab in one step.
