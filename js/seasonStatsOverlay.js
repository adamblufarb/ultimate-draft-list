/* Season Stats overlay: opened from Player Detail's "Show Data" button.
   Shows every uploaded season (Sources tab's Season Stats slots, most
   recent first) as its own block of label:value stat rows — whatever
   columns that season's file happened to have, in the file's own order,
   except the 6 main categories (PTS/AST/STL/BLK/TRB/FT) are pulled up to
   right after MP so they're not buried among the shooting splits; FTA
   tags along right after FT even though it isn't a main category itself.
   One of those 6 rows also gets a small ⬆️/⬇️ next to its value when it
   moved by at least that stat's own minimum amount from the season
   before — the single-year version of the health emoji's aggregate ⬆️/⬇️
   badge (App.getImprovementEmoji/getDeclineEmoji), which needs a
   sustained 2-year trend across all 3 seasons instead of just one (same
   categories and thresholds as there).
   Same overlay chrome as Player Detail/Smart Search (backdrop, slide-up
   sheet, close on backdrop tap/Escape/✕); purely a read-only view, so
   closing it never has anything to report back. */
(function (global) {
  let overlayEl = null;
  let closeHandler = hide;

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.className = 'detail-overlay';
    overlayEl.addEventListener('click', (e) => {
      if (e.target === overlayEl) closeHandler();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeHandler();
    });
    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  function hide() {
    if (overlayEl) overlayEl.classList.remove('open');
  }

  // Age/Team/Position are dropped even for a season uploaded before this
  // filter existed (Parser.parseSeasonStatsHtml now excludes them for any
  // upload going forward) — shown elsewhere already (Data List, the
  // position badge), not wanted a third time here.
  const HIDDEN_COLUMN_IDS = new Set(['age', 'team_name_abbr', 'pos']);

  // Same categories, thresholds, and display order as App's aggregate
  // ⬆️/⬇️ badges — the minimum a stat has to move (up or down) from the
  // season before to earn an arrow here at all.
  const MAIN_CATEGORY_MIN_CHANGE = {
    pts_per_g: 1.5,
    trb_per_g: 1.5,
    ast_per_g: 0.75,
    blk_per_g: 0.375,
    stl_per_g: 0.375,
    ft_per_g: 1.5
  };
  const MAIN_CATEGORY_IDS = Object.keys(MAIN_CATEGORY_MIN_CHANGE);
  const MAIN_CATEGORY_SET = new Set(MAIN_CATEGORY_IDS);
  // Non-main columns that tag along right after their main stat when
  // columns get reordered — FTA isn't a main category itself (no arrow,
  // doesn't count toward the aggregate badge), but sits with FT rather
  // than wherever the file's own order left it.
  const COMPANION_COLUMN_IDS = { ft_per_g: 'fta_per_g' };

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

    const grid = document.createElement('div');
    grid.className = 'season-stats-grid';
    const displayColumns = reorderColumnsForDisplay(slot.columns).filter((col) => !HIDDEN_COLUMN_IDS.has(col.id));
    displayColumns.forEach((col) => {
      const row = document.createElement('div');
      row.className = 'season-stat-row';
      const labelEl = document.createElement('span');
      labelEl.className = 'season-stat-label';
      labelEl.textContent = col.label;
      const valueEl = document.createElement('span');
      valueEl.className = 'season-stat-value';
      const rawValue = playerEntry.values[col.id];
      valueEl.textContent = rawValue || '—';

      if (MAIN_CATEGORY_SET.has(col.id) && olderEntry) {
        const thisValue = parseFloat(rawValue);
        const olderValue = parseFloat(olderEntry.values[col.id]);
        if (!Number.isNaN(thisValue) && !Number.isNaN(olderValue)) {
          const change = thisValue - olderValue;
          const minChange = MAIN_CATEGORY_MIN_CHANGE[col.id];
          if (Math.abs(change) >= minChange) {
            const arrow = document.createElement('span');
            arrow.className = 'season-stat-improved';
            arrow.textContent = change > 0 ? ' ⬆️' : ' ⬇️';
            valueEl.appendChild(arrow);
          }
        }
      }

      row.appendChild(labelEl);
      row.appendChild(valueEl);
      grid.appendChild(row);
    });
    block.appendChild(grid);
    return block;
  }

  function open(key, displayName) {
    const overlay = ensureOverlay();
    closeHandler = () => hide();

    overlay.innerHTML = '';
    const sheet = document.createElement('div');
    sheet.className = 'detail-sheet season-stats-sheet';

    const header = document.createElement('div');
    header.className = 'detail-header';
    const titleEl = document.createElement('h2');
    titleEl.className = 'detail-name';
    titleEl.textContent = displayName ? displayName + ' — Season Stats' : 'Season Stats';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-link detail-close';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', () => closeHandler());
    header.appendChild(titleEl);
    header.appendChild(closeBtn);
    sheet.appendChild(header);

    // Fixed 3 slots, most-recent-first — index i+1 is always exactly one
    // year older than index i, by construction, even if that older slot
    // itself has no file uploaded (then there's simply no comparison, and
    // no arrow, rather than comparing across a gap).
    const allSlots = App.state.seasonStats;
    const hasAnyData = allSlots.some((slot) => slot.players && slot.players.length > 0);
    if (!hasAnyData) {
      const empty = document.createElement('p');
      empty.className = 'empty-hint';
      empty.textContent = 'No season stats uploaded yet — add them under Season Stats in the Sources tab.';
      sheet.appendChild(empty);
    } else {
      allSlots.forEach((slot, i) => {
        if (!slot.players || slot.players.length === 0) return;
        const playerEntry = slot.players.find((p) => p.key === key) || null;
        const olderSlot = allSlots[i + 1] || null;
        const olderEntry = olderSlot ? (olderSlot.players.find((p) => p.key === key) || null) : null;
        sheet.appendChild(seasonBlock(slot, playerEntry, olderEntry));
      });
    }

    overlay.appendChild(sheet);
    overlay.classList.add('open');
  }

  global.SeasonStatsOverlay = { open };
})(window);
