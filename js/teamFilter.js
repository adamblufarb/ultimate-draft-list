/* Team filter overlay: opened from Draft List's "Team" row (under the
   position chips). A 2-column grid of every team found in the Data List —
   same .stat-card tiles as Player Detail's source squares — where each tile
   shows the team and how many of its players are already drafted, and any
   number can be picked (blue when picked). "Apply" hands the picked set
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
      teams.forEach((t) => {
        const tile = document.createElement('div');
        tile.className = 'stat-card stat-card-clickable team-filter-tile' + (picked.has(t.team) ? ' stat-card-selected' : '');

        const abbr = document.createElement('div');
        abbr.className = 'team-filter-abbr';
        abbr.textContent = t.team;
        const drafted = document.createElement('div');
        drafted.className = 'team-filter-drafted';
        drafted.textContent = t.drafted + ' drafted';
        tile.appendChild(abbr);
        tile.appendChild(drafted);

        tile.addEventListener('click', () => {
          if (picked.has(t.team)) picked.delete(t.team); else picked.add(t.team);
          tile.classList.toggle('stat-card-selected', picked.has(t.team));
        });
        grid.appendChild(tile);
      });
      sheet.appendChild(grid);
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
