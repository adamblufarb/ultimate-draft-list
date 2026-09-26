/* Season Stats overlay: opened from Player Detail's "Show Data" button.
   Shows every uploaded season (Sources tab's Season Stats slots, most
   recent first) as its own block of label:value stat rows — whatever
   columns that season's file happened to have, in the file's own order.
   A PTS/AST/STL/BLK/TRB row also gets a small ⬆️ next to its value when it
   improved (strictly increased) over that same stat the season before —
   the single-year version of the health emoji's aggregate ⬆️ badge (App.
   getImprovementEmoji), which needs the trend across all 3 seasons.
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

  // Same 5 categories, and the same "higher is better" assumption, as
  // App.getImprovementEmoji's aggregate 3-season badge.
  const IMPROVEMENT_COLUMN_IDS = new Set(['pts_per_g', 'ast_per_g', 'stl_per_g', 'blk_per_g', 'trb_per_g']);

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
    slot.columns.filter((col) => !HIDDEN_COLUMN_IDS.has(col.id)).forEach((col) => {
      const row = document.createElement('div');
      row.className = 'season-stat-row';
      const labelEl = document.createElement('span');
      labelEl.className = 'season-stat-label';
      labelEl.textContent = col.label;
      const valueEl = document.createElement('span');
      valueEl.className = 'season-stat-value';
      const rawValue = playerEntry.values[col.id];
      valueEl.textContent = rawValue || '—';

      if (IMPROVEMENT_COLUMN_IDS.has(col.id) && olderEntry) {
        const thisValue = parseFloat(rawValue);
        const olderValue = parseFloat(olderEntry.values[col.id]);
        if (!Number.isNaN(thisValue) && !Number.isNaN(olderValue) && thisValue > olderValue) {
          const arrow = document.createElement('span');
          arrow.className = 'season-stat-improved';
          arrow.textContent = ' ⬆️';
          valueEl.appendChild(arrow);
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
