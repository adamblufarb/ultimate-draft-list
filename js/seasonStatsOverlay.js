/* Season Stats overlay: opened from Player Detail's "Show Data" button.
   Shows every uploaded season (Sources tab's Season Stats slots, most
   recent first) as its own block of label:value stat rows — whatever
   columns that season's file happened to have, in the file's own order,
   except the 5 main categories (PTS/AST/STL/BLK/TRB) are pulled up to
   right after MP so they're not buried among the shooting splits.
   One of those 5 rows also gets a small ⬆️/⬇️ next to its value when it
   moved (strictly) up or down from that same stat the season before —
   the single-year version of the health emoji's aggregate ⬆️/⬇️ badge
   (App.getImprovementEmoji/getDeclineEmoji), which needs a sustained
   2-year trend across all 3 seasons instead of just one.
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

  // Same 5 categories, in this fixed display order, as App's aggregate
  // ⬆️/⬇️ badges — used both to reorder columns (pulled up right after MP)
  // and to decide which rows can get a single-year arrow.
  const MAIN_CATEGORY_IDS = ['pts_per_g', 'ast_per_g', 'stl_per_g', 'blk_per_g', 'trb_per_g'];
  const MAIN_CATEGORY_SET = new Set(MAIN_CATEGORY_IDS);

  // Moves the 5 main categories to right after MP, wherever they'd
  // otherwise fall (Basketball-Reference's own export puts them near the
  // end, after every shooting-split column) — everything else keeps its
  // original relative order. If a file has no MP column at all, the main
  // categories just lead.
  function reorderColumnsForDisplay(columns) {
    const mpIndex = columns.findIndex((c) => c.id === 'mp_per_g');
    const mainCols = MAIN_CATEGORY_IDS.map((id) => columns.find((c) => c.id === id)).filter(Boolean);
    if (mpIndex === -1) {
      return mainCols.concat(columns.filter((c) => !MAIN_CATEGORY_SET.has(c.id)));
    }
    const before = columns.slice(0, mpIndex + 1);
    const after = columns.slice(mpIndex + 1).filter((c) => !MAIN_CATEGORY_SET.has(c.id));
    return before.concat(mainCols, after);
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
          const arrow = document.createElement('span');
          arrow.className = 'season-stat-improved';
          if (thisValue > olderValue) arrow.textContent = ' ⬆️';
          else if (thisValue < olderValue) arrow.textContent = ' ⬇️';
          if (arrow.textContent) valueEl.appendChild(arrow);
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
