/* Season Stats overlay: opened from Player Detail's "Show Data" button.
   Shows every uploaded season (Sources tab's Season Stats slots, most
   recent first) as its own block of label:value stat rows — whatever
   columns that season's file happened to have, in the file's own order.
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

  function seasonBlock(slot, playerEntry) {
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
      valueEl.textContent = playerEntry.values[col.id] || '—';
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

    const configuredSlots = App.state.seasonStats.filter((slot) => slot.players && slot.players.length > 0);
    if (configuredSlots.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-hint';
      empty.textContent = 'No season stats uploaded yet — add them under Season Stats in the Sources tab.';
      sheet.appendChild(empty);
    } else {
      configuredSlots.forEach((slot) => {
        const playerEntry = slot.players.find((p) => p.key === key) || null;
        sheet.appendChild(seasonBlock(slot, playerEntry));
      });
    }

    overlay.appendChild(sheet);
    overlay.classList.add('open');
  }

  global.SeasonStatsOverlay = { open };
})(window);
