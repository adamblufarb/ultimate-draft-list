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

- **Rankings tab** — a simplified, scannable list: rank, player name with their combined rank average in parentheses, and a Draft button. Rows alternate a lighter shade for readability. Shows a combined average ranking across whichever sources you select — a player's average only counts the sources that actually ranked them. Tap a player to see their full detail view; hit "Draft" to hide them everywhere (toggle "Include drafted players" to bring them back into view).
- **Draft List tab** — your own editable, drag-to-reorder list, shown the same simplified way (name + combined rank average, alternating row shades). It's seeded from the combined average the first time you use it, then persists independently — editing sources never silently overwrites it.
  - A list filter (checkboxes, same as Rankings) controls which sources feed both the average shown next to each name and the Reset button.
  - Hit "Reset to combined average" any time to resync unlocked players to that filtered average. Hit the 🔓/🔒 button on a player to lock them in place — locked players don't move on reset, everyone else refills around them. "Unlock All" (with a confirmation) clears every lock at once.
  - Drafted players are hidden here too, but keep their spot in the order so un-drafting restores it.
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

Tapping a player opens a detail view with: their combined rank average and draft position; last-year and this-year-projection avg/game and total fantasy points (each with that source's rank, i.e. their "league rank" for that stat), pulled from whichever sources you've marked with those score types; and their rank/score in every other source.
