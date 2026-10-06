/* Team filter overlay: opened from Draft List's "Team" row (under the
   position chips). A 2-column grid of every team found in the Data List —
   same .stat-card tiles as Player Detail's source squares — where each tile
   shows the team and how many of its players are already drafted, and any
   number can be picked (a white outline and ✓ when picked). A condition at
   the bottom — "Highlight teams [N] lower than average" — fills in blue
   every team whose drafted count is at most (average drafted per team − N),
   to spot the teams you've drafted from least; N is remembered across
   uses (App.state.teamHighlightGap). "Apply" hands the picked set
   back to Draft List, which then shows only players on those teams; an
   empty pick clears the filter. Closing with ✕/backdrop/Escape discards the
   picks made here. Same overlay chrome as Smart Search and Player Detail. */
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

  // teams: [{ team, drafted }], already sorted for display.
  // selected: array of team names currently applied.
  // onApply(pickedTeams): called with the final picked array on Apply.
  function open(teams, selected, onApply) {
    const overlay = ensureOverlay();
    closeHandler = () => hide();
    const picked = new Set(selected);

    overlay.innerHTML = '';
    const sheet = document.createElement('div');
    sheet.className = 'detail-sheet team-filter-sheet';

    const header = document.createElement('div');
    header.className = 'detail-header';
    const titleEl = document.createElement('h2');
    titleEl.className = 'detail-name';
    titleEl.textContent = 'Teams';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-link detail-close';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', () => closeHandler());
    header.appendChild(titleEl);
    header.appendChild(closeBtn);
    sheet.appendChild(header);

    if (teams.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-hint';
      empty.textContent = 'No teams yet — add players with a Team in the Sources tab\'s Data List.';
      sheet.appendChild(empty);
    } else {
      const grid = document.createElement('div');
      grid.className = 'detail-stats';
      const tiles = [];
      teams.forEach((t) => {
        const tile = document.createElement('div');
        tile.className = 'stat-card stat-card-clickable team-filter-tile';

        const abbr = document.createElement('div');
        abbr.className = 'team-filter-abbr';
        const drafted = document.createElement('div');
        drafted.className = 'team-filter-drafted';
        drafted.textContent = t.drafted + ' drafted';
        tile.appendChild(abbr);
        tile.appendChild(drafted);

        tile.addEventListener('click', () => {
          if (picked.has(t.team)) picked.delete(t.team); else picked.add(t.team);
          refreshTile(t, tile, abbr);
        });
        tiles.push({ t, tile, abbr });
        grid.appendChild(tile);
      });
      sheet.appendChild(grid);

      const average = teams.reduce((sum, t) => sum + t.drafted, 0) / teams.length;

      function refreshTile(t, tile, abbr) {
        tile.classList.toggle('is-picked', picked.has(t.team));
        abbr.textContent = (picked.has(t.team) ? '✓ ' : '') + t.team;
      }

      // Recolors the highlighted teams for the current N; an empty/invalid
      // N highlights nothing.
      function refreshHighlights() {
        const gap = parseFloat(gapInput.value);
        const limit = Number.isNaN(gap) ? -Infinity : average - gap;
        tiles.forEach(({ t, tile }) => tile.classList.toggle('is-highlighted', t.drafted <= limit));
      }

      const conditionRow = document.createElement('div');
      conditionRow.className = 'smart-search-threshold-row team-filter-condition';
      const prefix = document.createElement('span');
      prefix.textContent = 'Highlight teams';
      const gapInput = document.createElement('input');
      gapInput.type = 'number';
      gapInput.min = '0';
      gapInput.step = 'any';
      gapInput.inputMode = 'decimal';
      gapInput.className = 'smart-search-threshold-input';
      gapInput.value = String(App.state.teamHighlightGap);
      const suffix = document.createElement('span');
      suffix.textContent = 'lower than average.';
      conditionRow.appendChild(prefix);
      conditionRow.appendChild(gapInput);
      conditionRow.appendChild(suffix);
      sheet.appendChild(conditionRow);

      const avgNote = document.createElement('div');
      avgNote.className = 'team-filter-average';
      avgNote.textContent = 'Average: ' + (Math.round(average * 10) / 10) + ' drafted per team';
      sheet.appendChild(avgNote);

      gapInput.addEventListener('input', () => {
        const gap = parseFloat(gapInput.value);
        if (!Number.isNaN(gap) && gap >= 0) {
          App.state.teamHighlightGap = gap;
          App.persist();
        }
        refreshHighlights();
      });

      tiles.forEach(({ t, tile, abbr }) => refreshTile(t, tile, abbr));
      refreshHighlights();
    }

    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn btn-primary team-filter-apply';
    applyBtn.textContent = 'Apply';
    applyBtn.addEventListener('click', () => {
      hide();
      onApply(Array.from(picked));
    });
    sheet.appendChild(applyBtn);

    overlay.appendChild(sheet);
    overlay.classList.add('open');
  }

  global.TeamFilter = { open };
})(window);
