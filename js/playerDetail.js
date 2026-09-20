/* Player detail overlay: combined rank (based on whichever sources are
   currently selected in the calling tab's filter) as its own row up top,
   then one square per source — every source, not just the special
   avg/total ones — showing that source's rank big and its score (if any)
   small, with the currently-selected sources highlighted. Opened by
   tapping a player row in the Rankings, Draft List, or My Team tab. */
(function (global) {
  let overlayEl = null;

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.className = 'detail-overlay';
    overlayEl.addEventListener('click', (e) => {
      if (e.target === overlayEl) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  function close() {
    if (overlayEl) overlayEl.classList.remove('open');
  }

  function statCard(label, value) {
    const card = document.createElement('div');
    card.className = 'stat-card';

    const titleEl = document.createElement('div');
    titleEl.className = 'stat-title';
    titleEl.textContent = label;
    card.appendChild(titleEl);

    if (value !== null) {
      const valueEl = document.createElement('div');
      valueEl.className = 'stat-value';
      valueEl.textContent = value;
      card.appendChild(valueEl);
    } else {
      const empty = document.createElement('div');
      empty.className = 'stat-empty';
      empty.textContent = 'No data';
      card.appendChild(empty);
    }
    return card;
  }

  // One square per source: rank shown big (the primary thing you scan for),
  // its score (if this source has one) shown small underneath. Sources with
  // no score at all (pure ranking lists) just show the rank alone.
  function sourceCard(source, entry, isSelected) {
    const bySource = entry.bySource[source.id];
    const card = document.createElement('div');
    card.className = 'stat-card' + (isSelected ? ' stat-card-selected' : '');

    const titleEl = document.createElement('div');
    titleEl.className = 'stat-title';
    titleEl.textContent = source.name || 'Untitled source';
    card.appendChild(titleEl);

    if (bySource) {
      const valueEl = document.createElement('div');
      valueEl.className = 'stat-value';
      valueEl.textContent = String(bySource.rank);
      card.appendChild(valueEl);
      if (bySource.score !== null) {
        const subEl = document.createElement('div');
        subEl.className = 'stat-rank';
        subEl.textContent = Constants.formatScore(bySource.score);
        card.appendChild(subEl);
      }
    } else {
      const empty = document.createElement('div');
      empty.className = 'stat-empty';
      empty.textContent = 'Not ranked';
      card.appendChild(empty);
    }
    return card;
  }

  // selectedSourceIds: the calling tab's current source filter, used both to
  // compute Combined Rank the same way that tab does, and to highlight
  // matching squares blue. Defaults to every source when not given (e.g.
  // opened from My Team, which has no such filter).
  function open(key, selectedSourceIds) {
    const overlay = ensureOverlay();
    const index = Ranking.buildIndex(App.state.sources);
    const entry = index.get(key);
    if (!entry) return;

    const allIds = App.state.sources.map((s) => s.id);
    const activeIds = selectedSourceIds || allIds;
    const combinedEntry = Ranking.combineFromIndex(index, activeIds).find((r) => r.key === key) || null;

    overlay.innerHTML = '';
    const sheet = document.createElement('div');
    sheet.className = 'detail-sheet';

    const header = document.createElement('div');
    header.className = 'detail-header';
    const titleWrap = document.createElement('div');
    const nameEl = document.createElement('h2');
    nameEl.className = 'detail-name';
    nameEl.textContent = entry.displayName;
    const posEl = document.createElement('div');
    posEl.className = 'detail-positions';
    posEl.textContent = entry.positions || 'Position unknown';
    titleWrap.appendChild(nameEl);
    titleWrap.appendChild(posEl);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-link detail-close';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', close);
    header.appendChild(titleWrap);
    header.appendChild(closeBtn);
    sheet.appendChild(header);

    const combinedRow = document.createElement('div');
    combinedRow.className = 'detail-combined-row';
    combinedRow.appendChild(statCard('Combined Rank', combinedEntry ? combinedEntry.avg.toFixed(1) : null));
    sheet.appendChild(combinedRow);

    const gridWrap = document.createElement('div');
    gridWrap.className = 'detail-stats';
    if (App.state.sources.length === 0) {
      const none = document.createElement('p');
      none.className = 'empty-hint';
      none.textContent = 'No sources yet.';
      gridWrap.appendChild(none);
    } else {
      App.state.sources.forEach((source) => {
        gridWrap.appendChild(sourceCard(source, entry, activeIds.includes(source.id)));
      });
    }
    sheet.appendChild(gridWrap);

    const drafted = App.isDrafted(key);
    const draftBtn = document.createElement('button');
    draftBtn.className = 'btn-draft detail-draft-btn' + (drafted ? ' is-drafted' : '');
    draftBtn.textContent = drafted ? 'Undraft' : 'Mark Drafted';
    draftBtn.addEventListener('click', () => {
      App.setDrafted(key, !drafted);
      close();
    });
    sheet.appendChild(draftBtn);

    const onMyTeam = App.isOnMyTeam(key);
    const myTeamBtn = document.createElement('button');
    myTeamBtn.className = 'detail-myteam-btn' + (onMyTeam ? ' is-on-team' : '');
    myTeamBtn.textContent = onMyTeam ? 'Remove from My Team' : 'Drafted by me';
    myTeamBtn.addEventListener('click', () => {
      if (onMyTeam) App.removeFromMyTeam(key);
      else App.draftedByMe(key);
      close();
    });
    sheet.appendChild(myTeamBtn);

    overlay.appendChild(sheet);
    overlay.classList.add('open');
  }

  global.PlayerDetail = { open, close };
})(window);
