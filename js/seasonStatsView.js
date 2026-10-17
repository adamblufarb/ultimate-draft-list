/* Season Stats view: the bottom section of Player Detail. Shows every
   uploaded season (Sources tab's Season Stats slots, most recent first) as
   its own block of label:value stat rows — whatever
   columns that season's file happened to have, in the file's own order,
   except the 6 main categories (PTS/AST/STL/BLK/TRB/FT) are pulled up to
   right after MP so they're not buried among the shooting splits; FTA
   tags along right after FT even though it isn't a main category itself.
   One of those 6 rows also gets a small ⬆️/⬇️ next to its value when it
   moved by at least that stat's own minimum amount from the season
   before — ⏫/⏬ instead once it moved by at least *double* that amount —
   the single-year version of the health emoji's aggregate ⬆️/⬇️ badge
   (App.getImprovementEmoji/getDeclineEmoji), which needs a sustained
   2-year trend across all 3 seasons instead of just one (same categories
   and thresholds as there).
   Under each season's title sit its average fantasy points per game
   (Avg) and total (Tot = Avg x games played) under this league's scoring
   (FP_WEIGHTS), each with its rank among every player that season.
   Team is pushed to the very bottom of each block, after everything else.
   Purely a read-only view; render(key) just returns the element for
   Player Detail to append. */
(function (global) {
  // Age/Position are dropped — shown elsewhere already (Data List, the
  // position badge), not wanted a third time here. Team is kept, but
  // pushed to the bottom of the list (see reorderColumnsForDisplay).
  const HIDDEN_COLUMN_IDS = new Set(['age', 'pos']);
  const TEAM_COLUMN_ID = 'team_name_abbr';

  // Same categories, thresholds, and display order as App's aggregate
  // ⬆️/⬇️ badges — the minimum a stat has to move (up or down) from the
  // season before to earn an arrow here at all.
  const MAIN_CATEGORY_MIN_CHANGE = {
    pts_per_g: 1,
    trb_per_g: 1,
    ast_per_g: 0.5,
    blk_per_g: 0.25,
    stl_per_g: 0.25,
    ft_per_g: 1
  };
  const MAIN_CATEGORY_IDS = Object.keys(MAIN_CATEGORY_MIN_CHANGE);
  const MAIN_CATEGORY_SET = new Set(MAIN_CATEGORY_IDS);
  // Non-main columns that tag along right after their main stat when
  // columns get reordered — FTA isn't a main category itself (no arrow,
  // doesn't count toward the aggregate badge), but sits with FT rather
  // than wherever the file's own order left it.
  const COMPANION_COLUMN_IDS = { ft_per_g: 'fta_per_g' };

  // Triple doubles aren't in the per-game files, so the plain average above
  // leaves out their bonus. It is estimated per player from the gap between
  // last season's list average (the "Last year – Avg/Game" source, which
  // includes it) and the TD-free average from the stats file: that gap is the
  // bonus points per game; x games / 3 = last season's TD count. Older
  // seasons scale that TD count by how the player's TD-free average changed
  // (half the average → half the TDs). Avg = TD-free avg + TD points / games;
  // Tot = Avg x games.
  // Last season's Avg / Tot are taken straight from the Last year – Avg/Game and
  // Last year – Total lists when the player is on them (the lists are the source
  // of truth). Players without a list average or a most-recent-season row get no estimate.
  const ESPN_TD_VALUE = 3;

  // Map(slot -> Map(key -> { avg, tot, td })) for every player in every
  // season; td is null when nothing could be estimated. Rebuilt per render.
  function buildFantasy() {
    const slots = App.state.seasonStats;
    const out = new Map();
    const w = Scoring.normalize(App.state.scoring).TD;
    const base = (slot, p) => {
      const avg = Scoring.average(App.state.scoring, slot.columns, p.values);
      const games = parseFloat(p.values.games);
      return avg === null || Number.isNaN(games) ? null : { avg, games };
    };
    const recent = new Map();   // key -> TD-free avg last season
    const td0 = new Map();      // key -> TDs last season
    const listAvg0 = new Map(); // key -> last season's Avg straight from the list (the source of truth)
    const listTot0 = new Map(); // key -> last season's Total straight from the list
    if (slots[0]) {
      const index = Ranking.buildIndex(App.state.sources);
      const listSrc = App.state.sources.find((src) => src.scoreType === 'ly_avg');
      const totSrc = App.state.sources.find((src) => src.scoreType === 'ly_total');
      const fromList = (src, key) => {
        const e = src && index.get(key);
        const v = e && e.bySource[src.id] ? e.bySource[src.id].score : null;
        return typeof v === 'number' ? v : null;
      };
      slots[0].players.forEach((p) => {
        const b = base(slots[0], p);
        if (!b || !(b.avg > 0)) return;
        recent.set(p.key, b.avg);
        const listAvg = fromList(listSrc, p.key);
        if (listAvg !== null) {
          listAvg0.set(p.key, listAvg);
          td0.set(p.key, Math.max(0, listAvg - b.avg) / ESPN_TD_VALUE * b.games);
        }
        const listTot = fromList(totSrc, p.key);
        if (listTot !== null) listTot0.set(p.key, listTot);
      });
    }
    slots.forEach((slot) => {
      const m = new Map();
      slot.players.forEach((p) => {
        const b = base(slot, p);
        if (!b) return;
        // TD count follows the TD-free average: half the average, half the TDs.
        const td = td0.has(p.key) ? td0.get(p.key) * (b.avg / recent.get(p.key)) : null;
        let avg = b.avg + (td === null ? 0 : w * td / b.games);
        let tot = avg * b.games;
        // Last season is exactly what the lists say (they're the source of truth).
        if (slot === slots[0]) {
          if (listAvg0.has(p.key)) { avg = listAvg0.get(p.key); tot = avg * b.games; }
          if (listTot0.has(p.key)) tot = listTot0.get(p.key);
        }
        m.set(p.key, { avg, tot, td });
      });
      out.set(slot, m);
    });
    return out;
  }
  let fantasy = new Map();

  function fantasyFor(slot, key) {
    const m = fantasy.get(slot);
    return (m && m.get(key)) || null;
  }

  // 1 + how many other players beat this value that season (ties share a
  // rank), among every player in that season's file who has a figure.
  function rankIn(slot, field, value) {
    let better = 0;
    (fantasy.get(slot) || new Map()).forEach((f) => { if (f[field] > value) better += 1; });
    return better + 1;
  }

  // "Avg: 49.0 (#12)" with "Tot: 3234 (#8)" on the line below — the ranks are against every other
  // player in the same season's file (by that figure, highest first).
  // Null if nothing to show.
  function fantasyLine(slot, playerEntry) {
    const f = fantasyFor(slot, playerEntry.key);
    if (!f) return null;
    const el = document.createElement('div');
    el.className = 'season-stats-block-fp';
    [['Avg', 'avg', f.avg.toFixed(1)], ['Tot', 'tot', String(Math.round(f.tot))]].forEach(([label, field, text]) => {
      const part = document.createElement('span');
      part.textContent = label + ': ' + text + ' (#' + rankIn(slot, field, f[field]) + ')';
      el.appendChild(part);
    });
    return el;
  }

  // Moves the main categories (plus each one's companion column, if any)
  // to right after MP, wherever they'd otherwise fall (Basketball-
  // Reference's own export puts most of them near the end, after every
  // shooting-split column) — everything else keeps its original relative
  // order. If a file has no MP column at all, the pulled-up columns just
  // lead.
  function reorderColumnsForDisplay(columns) {
    const byId = new Map(columns.map((c) => [c.id, c]));
    const pulledUpIds = new Set();
    const pulledUpCols = [];
    MAIN_CATEGORY_IDS.forEach((id) => {
      const col = byId.get(id);
      if (col) { pulledUpCols.push(col); pulledUpIds.add(id); }
      const companionId = COMPANION_COLUMN_IDS[id];
      const companionCol = companionId && byId.get(companionId);
      if (companionCol) { pulledUpCols.push(companionCol); pulledUpIds.add(companionId); }
    });

    const mpIndex = columns.findIndex((c) => c.id === 'mp_per_g');
    if (mpIndex === -1) {
      return pulledUpCols.concat(columns.filter((c) => !pulledUpIds.has(c.id)));
    }
    const before = columns.slice(0, mpIndex + 1).filter((c) => !pulledUpIds.has(c.id));
    const after = columns.slice(mpIndex + 1).filter((c) => !pulledUpIds.has(c.id));
    return before.concat(pulledUpCols, after);
  }

  // olderEntry: this same player's row in the season immediately before
  // this one (one slot older — seasonStats is most-recent-first), or null
  // if that season has no file uploaded or no row for this player. Used
  // only to mark a single-year improvement on PTS/AST/STL/BLK/TRB; null
  // just means no arrow, never an error.
  function seasonBlock(slot, playerEntry, olderEntry) {
    const block = document.createElement('div');
    block.className = 'season-stats-block';

    const title = document.createElement('div');
    title.className = 'season-stats-block-title';
    title.textContent = slot.label || 'Season';
    block.appendChild(title);

    if (!playerEntry) {
      const empty = document.createElement('div');
      empty.className = 'stat-empty';
      empty.textContent = 'No data';
      block.appendChild(empty);
      return block;
    }

    const fp = fantasyLine(slot, playerEntry);
    if (fp) block.appendChild(fp);

    const grid = document.createElement('div');
    grid.className = 'season-stats-grid';
    const withoutHidden = reorderColumnsForDisplay(slot.columns).filter((col) => !HIDDEN_COLUMN_IDS.has(col.id));
    const teamCol = withoutHidden.find((col) => col.id === TEAM_COLUMN_ID);
    const displayColumns = teamCol
      ? withoutHidden.filter((col) => col.id !== TEAM_COLUMN_ID).concat(teamCol)
      : withoutHidden;
    const tdRow = () => {
      // Estimated triple doubles (see buildFantasy), shown right after PF with a ~.
      const f = fantasyFor(slot, playerEntry.key);
      const row = document.createElement('div');
      row.className = 'season-stat-row';
      const labelEl = document.createElement('span');
      labelEl.className = 'season-stat-label';
      labelEl.textContent = 'TD';
      const valueEl = document.createElement('span');
      valueEl.className = 'season-stat-value';
      valueEl.textContent = f && f.td !== null ? '~' + Math.round(f.td) : '—';
      row.appendChild(labelEl);
      row.appendChild(valueEl);
      return row;
    };
    let tdAdded = false;
    displayColumns.forEach((col) => {
      const row = document.createElement('div');
      row.className = 'season-stat-row';
      const labelEl = document.createElement('span');
      labelEl.className = 'season-stat-label';
      labelEl.textContent = col.label;
      const valueEl = document.createElement('span');
      valueEl.className = 'season-stat-value';
      const rawValue = playerEntry.values[col.id];
      valueEl.textContent = (col.id === TEAM_COLUMN_ID ? Constants.displayTeam(rawValue) : rawValue) || '—';

      if (MAIN_CATEGORY_SET.has(col.id) && olderEntry) {
        const thisValue = parseFloat(rawValue);
        const olderValue = parseFloat(olderEntry.values[col.id]);
        if (!Number.isNaN(thisValue) && !Number.isNaN(olderValue)) {
          const change = thisValue - olderValue;
          const minChange = MAIN_CATEGORY_MIN_CHANGE[col.id];
          const points = Math.floor(Math.abs(change) / minChange);
          if (points >= 1) {
            const arrow = document.createElement('span');
            arrow.className = 'season-stat-improved';
            const doubled = points >= 2;
            if (change > 0) arrow.textContent = doubled ? ' ⏫' : ' ⬆️';
            else arrow.textContent = doubled ? ' ⏬' : ' ⬇️';
            valueEl.appendChild(arrow);
          }
        }
      }

      row.appendChild(labelEl);
      row.appendChild(valueEl);
      grid.appendChild(row);
      if (col.id === 'pf_per_g') { grid.appendChild(tdRow()); tdAdded = true; }
    });
    if (!tdAdded) grid.appendChild(tdRow());
    block.appendChild(grid);
    return block;
  }

  // Returns a container with one block per uploaded season for this
  // player (or a hint if nothing's been uploaded at all).
  function render(key) {
    fantasy = buildFantasy();
    const wrap = document.createElement('div');
    wrap.className = 'detail-season-stats';

    // Fixed 3 slots, most-recent-first — index i+1 is always exactly one
    // year older than index i, by construction, even if that older slot
    // itself has no file uploaded (then there's simply no comparison, and
    // no arrow, rather than comparing across a gap).
    const allSlots = App.state.seasonStats;
    const hasAnyData = allSlots.some((slot) => slot.players && slot.players.length > 0);
    if (!hasAnyData) {
      const empty = document.createElement('p');
      empty.className = 'empty-hint';
      empty.textContent = 'No season stats uploaded yet — add them under Settings → Sources → Season Stats.';
      wrap.appendChild(empty);
      return wrap;
    }
    allSlots.forEach((slot, i) => {
      if (!slot.players || slot.players.length === 0) return;
      const playerEntry = slot.players.find((p) => p.key === key) || null;
      // Only compare with the next-older file when it is exactly one season back.
      const next = allSlots[i + 1] || null;
      const olderSlot = next && Constants.seasonStart(next.label) === Constants.seasonStart(slot.label) - 1 ? next : null;
      const olderEntry = olderSlot ? (olderSlot.players.find((p) => p.key === key) || null) : null;
      wrap.appendChild(seasonBlock(slot, playerEntry, olderEntry));
    });
    return wrap;
  }

  global.SeasonStatsView = { render };
})(window);
