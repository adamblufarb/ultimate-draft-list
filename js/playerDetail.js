/* Player detail overlay: combined rank (based on whichever sources are
   currently selected in the calling tab's filter) as its own row up top,
   then one square per source — every source, not just the special
   avg/total ones — showing that source's rank and score side by side on
   one row, with the currently-selected sources highlighted. Tapping a
   source square toggles it in/out of the filter used for Combined Rank,
   live, for the rest of this view session. Opened by tapping a player row
   in the Rankings, Draft List, or My Team tab. */
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

  function setCardValue(card, value) {
    const existing = card.querySelector('.stat-value, .stat-empty, .stat-rank-row');
    if (existing) existing.remove();
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
  }

  function statCard(label, value) {
    const card = document.createElement('div');
    card.className = 'stat-card';
    const titleEl = document.createElement('div');
    titleEl.className = 'stat-title';
    titleEl.textContent = label;
    card.appendChild(titleEl);
    setCardValue(card, value);
    return card;
  }

  // One square per source: rank and score (if this source has one) shown
  // side by side on one row — rank big, score smaller and gray. Sources
  // with no score at all (pure ranking lists) just show the rank alone.
  function sourceCard(source, entry, isSelected) {
    const bySource = entry.bySource[source.id];
    const card = document.createElement('div');
    card.className = 'stat-card stat-card-clickable' + (isSelected ? ' stat-card-selected' : '');

    const titleEl = document.createElement('div');
    titleEl.className = 'stat-title';
    titleEl.textContent = source.name || 'Untitled source';
    card.appendChild(titleEl);

    if (bySource) {
      const rankRow = document.createElement('div');
      rankRow.className = 'stat-rank-row';
      const valueEl = document.createElement('span');
      valueEl.className = 'stat-value';
      valueEl.textContent = String(bySource.rank);
      rankRow.appendChild(valueEl);
      if (bySource.score !== null) {
        const scoreEl = document.createElement('span');
        scoreEl.className = 'stat-score';
        scoreEl.textContent = Constants.formatScore(bySource.score);
        rankRow.appendChild(scoreEl);
      }
      card.appendChild(rankRow);
    } else {
      const empty = document.createElement('div');
      empty.className = 'stat-empty';
      empty.textContent = 'Not ranked';
      card.appendChild(empty);
    }
    return card;
  }

  // selectedSourceIds: the calling tab's current source filter, used both to
  // seed which squares start highlighted and to compute the initial
  // Combined Rank. From here, tapping any square toggles it for this view
  // only — the calling tab's own filter is never touched.
  function open(key, selectedSourceIds) {
    const overlay = ensureOverlay();
    const index = Ranking.buildIndex(App.state.sources);
    const entry = index.get(key);
    if (!entry) return;

    const allIds = App.state.sources.map((s) => s.id);
    let activeIds = (selectedSourceIds || allIds).slice();

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
    const combinedCard = statCard('Combined Rank', null);
    combinedRow.appendChild(combinedCard);
    sheet.appendChild(combinedRow);

    function updateCombined() {
      const combinedEntry = Ranking.combineFromIndex(index, activeIds).find((r) => r.key === key) || null;
      setCardValue(combinedCard, combinedEntry ? combinedEntry.avg.toFixed(1) : null);
    }
    updateCombined();

    const gridWrap = document.createElement('div');
    gridWrap.className = 'detail-stats';
    if (App.state.sources.length === 0) {
      const none = document.createElement('p');
      none.className = 'empty-hint';
      none.textContent = 'No sources yet.';
      gridWrap.appendChild(none);
    } else {
      App.state.sources.forEach((source) => {
        const card = sourceCard(source, entry, activeIds.includes(source.id));
        card.addEventListener('click', () => {
          if (activeIds.includes(source.id)) {
            activeIds = activeIds.filter((id) => id !== source.id);
            card.classList.remove('stat-card-selected');
          } else {
            activeIds.push(source.id);
            card.classList.add('stat-card-selected');
          }
          updateCombined();
        });
        gridWrap.appendChild(card);
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
