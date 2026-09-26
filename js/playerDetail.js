/* Player detail overlay: name and position badge share a row up top, with
   the player's age (and team, if known — "25 · DAL") from the Sources
   tab's Data List below it. Height is parsed from the Data List too but
   not shown anywhere yet.
   Combined rank (based on whichever sources are currently selected in the
   calling tab's filter), plus the Breakout/Sleeper/Do Not Draft tag
   toggles, share the next row. Below that, one square per source — every
   source, not just the special avg/total ones — showing that source's rank
   and score side by side on one row, with the currently-selected sources
   highlighted. Tapping a source square toggles it in/out of the filter
   used for Combined Rank, live. However the filter is left when the
   overlay closes (by the ✕, the backdrop, Escape, or an action button) is
   reported back to whichever tab opened it, via the optional
   onActiveIdsChange callback, so the tab's own filter and order pick up
   the change too. Below the source squares, "Show Data" opens the Season
   Stats overlay (js/seasonStatsOverlay.js) for this player. Opened by
   tapping a player row in Draft List, My Team, or Draft Board. */
(function (global) {
  let overlayEl = null;
  // Re-pointed on every open() to that call's own close/sync logic — the
  // backdrop-click and Escape listeners below are set up once, so they need
  // to always reach whichever open() call is currently showing.
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

  function sameIds(a, b) {
    if (a.length !== b.length) return false;
    const sortedA = a.slice().sort();
    const sortedB = b.slice().sort();
    return sortedA.every((id, i) => id === sortedB[i]);
  }

  // Looks up this player's Data List entry (age, team, height — height
  // unused for now) by the same normalized-name matching used everywhere
  // else. The Data List is never part of App.state.sources and has no
  // bearing on any ranking, so this is its own small lookup.
  function getDataListEntry(key) {
    return App.state.dataList.players.find((p) => NameMatch.normalize(p.name) === key) || null;
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

  function tagToggleButton(label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tag-toggle';
    btn.setAttribute('aria-label', label);
    btn.title = label;
    return btn;
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
  // Combined Rank. Tapping a square toggles it live for this view; once the
  // overlay closes, if the filter actually changed, onActiveIdsChange (when
  // given) is called with the final list so the calling tab can adopt it.
  function open(key, selectedSourceIds, onActiveIdsChange) {
    const overlay = ensureOverlay();
    const index = Ranking.buildIndex(App.state.sources);
    const entry = index.get(key);
    if (!entry) return;

    const allIds = App.state.sources.map((s) => s.id);
    const initialIds = (selectedSourceIds || allIds).slice();
    let activeIds = initialIds.slice();

    closeHandler = () => {
      if (onActiveIdsChange && !sameIds(activeIds, initialIds)) {
        onActiveIdsChange(activeIds.slice());
      }
      hide();
    };

    overlay.innerHTML = '';
    const sheet = document.createElement('div');
    sheet.className = 'detail-sheet';

    const header = document.createElement('div');
    header.className = 'detail-header';
    const titleWrap = document.createElement('div');

    const nameRow = document.createElement('div');
    nameRow.className = 'detail-name-row';
    const nameEl = document.createElement('h2');
    nameEl.className = 'detail-name';
    nameEl.textContent = entry.displayName;
    nameRow.appendChild(nameEl);
    if (entry.positions) {
      const posBadge = document.createElement('span');
      posBadge.className = 'player-positions detail-positions-badge';
      posBadge.textContent = entry.positions;
      nameRow.appendChild(posBadge);
    }
    titleWrap.appendChild(nameRow);

    const dataEntry = getDataListEntry(key);
    const ageEl = document.createElement('div');
    ageEl.className = 'detail-age';
    ageEl.textContent = dataEntry
      ? (dataEntry.team ? dataEntry.age + ' · ' + dataEntry.team : String(dataEntry.age))
      : 'Age unknown';
    titleWrap.appendChild(ageEl);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-link detail-close';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', () => closeHandler());
    header.appendChild(titleWrap);
    header.appendChild(closeBtn);
    sheet.appendChild(header);

    const combinedRow = document.createElement('div');
    combinedRow.className = 'detail-combined-row';
    const combinedCard = statCard('Combined Rank', null);
    combinedRow.appendChild(combinedCard);

    // Breakout/sleeper cycle untagged -> level 1 -> level 2 -> untagged;
    // do-not-draft just toggles on/off. Only settable here — list rows
    // only ever display the result.
    const breakoutBtn = tagToggleButton('Breakout');
    breakoutBtn.addEventListener('click', () => {
      App.cycleBreakoutLevel(key);
      refreshTagButtons();
    });
    combinedRow.appendChild(breakoutBtn);

    const sleeperBtn = tagToggleButton('Sleeper');
    sleeperBtn.addEventListener('click', () => {
      App.cycleSleeperLevel(key);
      refreshTagButtons();
    });
    combinedRow.appendChild(sleeperBtn);

    const doNotDraftBtn = tagToggleButton('Do Not Draft');
    doNotDraftBtn.addEventListener('click', () => {
      App.toggleDoNotDraft(key);
      refreshTagButtons();
    });
    combinedRow.appendChild(doNotDraftBtn);

    function refreshTagButtons() {
      const breakoutLevel = App.getBreakoutLevel(key);
      breakoutBtn.classList.toggle('is-active', breakoutLevel > 0);
      breakoutBtn.textContent = breakoutLevel >= 2 ? '🌟' : '⭐';

      const sleeperLevel = App.getSleeperLevel(key);
      sleeperBtn.classList.toggle('is-active', sleeperLevel > 0);
      sleeperBtn.textContent = sleeperLevel >= 2 ? '😴' : '🥱';

      const doNotDraft = App.isDoNotDraft(key);
      doNotDraftBtn.classList.toggle('is-active', doNotDraft);
      doNotDraftBtn.textContent = '🚫';
    }
    refreshTagButtons();

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

    const showDataBtn = document.createElement('button');
    showDataBtn.className = 'btn btn-secondary detail-show-data-btn';
    showDataBtn.textContent = 'Show Data';
    showDataBtn.addEventListener('click', () => SeasonStatsOverlay.open(key, entry.displayName));
    sheet.appendChild(showDataBtn);

    const drafted = App.isDrafted(key);
    const draftBtn = document.createElement('button');
    draftBtn.className = 'btn-draft detail-draft-btn' + (drafted ? ' is-drafted' : '');
    draftBtn.textContent = drafted ? 'Undraft' : 'Mark Drafted';
    draftBtn.addEventListener('click', () => {
      App.setDrafted(key, !drafted);
      closeHandler();
    });
    sheet.appendChild(draftBtn);

    const onMyTeam = App.isOnMyTeam(key);
    const myTeamBtn = document.createElement('button');
    myTeamBtn.className = 'detail-myteam-btn' + (onMyTeam ? ' is-on-team' : '');
    myTeamBtn.textContent = onMyTeam ? 'Remove from My Team' : 'Drafted by me';
    myTeamBtn.addEventListener('click', () => {
      if (onMyTeam) App.removeFromMyTeam(key);
      else App.draftedByMe(key);
      closeHandler();
    });
    sheet.appendChild(myTeamBtn);

    overlay.appendChild(sheet);
    overlay.classList.add('open');
  }

  global.PlayerDetail = { open, close: () => closeHandler() };
})(window);
