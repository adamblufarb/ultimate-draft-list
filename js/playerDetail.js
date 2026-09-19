/* Player detail overlay: combined rank + draft position, last-year and
   this-year-projection stats (+ league rank), and every source's rank/score
   for one player. Opened by tapping a player row in either the Rankings or
   Draft List tab. */
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

  function statCard(label, value, subtext) {
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
      if (subtext) {
        const subEl = document.createElement('div');
        subEl.className = 'stat-rank';
        subEl.textContent = subtext;
        card.appendChild(subEl);
      }
    } else {
      const empty = document.createElement('div');
      empty.className = 'stat-empty';
      empty.textContent = 'No data';
      card.appendChild(empty);
    }
    return card;
  }

  function scoreStatCard(label, source, entry) {
    const bySource = source ? entry.bySource[source.id] : null;
    if (source && bySource && bySource.score !== null) {
      return statCard(label, Constants.formatScore(bySource.score), `League rank: ${bySource.rank}`);
    }
    return statCard(label, null);
  }

  function open(key) {
    const overlay = ensureOverlay();
    const index = Ranking.buildIndex(App.state.sources);
    const entry = index.get(key);
    if (!entry) return;

    const allIds = App.state.sources.map((s) => s.id);
    const combinedList = Ranking.combineFromIndex(index, allIds);
    const position = combinedList.findIndex((r) => r.key === key);
    const combinedEntry = position >= 0 ? combinedList[position] : null;

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

    const summaryWrap = document.createElement('div');
    summaryWrap.className = 'detail-stats';
    summaryWrap.appendChild(statCard('Combined Rank', combinedEntry ? combinedEntry.avg.toFixed(1) : null));
    summaryWrap.appendChild(statCard('Draft Position', position >= 0 ? `#${position + 1}` : null));
    sheet.appendChild(summaryWrap);

    const statsWrap = document.createElement('div');
    statsWrap.className = 'detail-stats';
    const lyAvgSource = App.state.sources.find((s) => s.scoreType === 'ly_avg');
    const lyTotalSource = App.state.sources.find((s) => s.scoreType === 'ly_total');
    const tyAvgSource = App.state.sources.find((s) => s.scoreType === 'ty_avg_proj');
    const tyTotalSource = App.state.sources.find((s) => s.scoreType === 'ty_total_proj');
    statsWrap.appendChild(scoreStatCard('Last Year Avg/Game', lyAvgSource, entry));
    statsWrap.appendChild(scoreStatCard('Last Year Total', lyTotalSource, entry));
    statsWrap.appendChild(scoreStatCard('This Year Avg/Game Proj.', tyAvgSource, entry));
    statsWrap.appendChild(scoreStatCard('This Year Total Proj.', tyTotalSource, entry));
    sheet.appendChild(statsWrap);

    const listsWrap = document.createElement('div');
    listsWrap.className = 'detail-lists';
    const listsTitle = document.createElement('div');
    listsTitle.className = 'detail-section-title';
    listsTitle.textContent = 'All ranking lists';
    listsWrap.appendChild(listsTitle);

    if (App.state.sources.length === 0) {
      const none = document.createElement('p');
      none.className = 'empty-hint';
      none.textContent = 'No sources yet.';
      listsWrap.appendChild(none);
    }

    App.state.sources.forEach((source) => {
      const bySource = entry.bySource[source.id];
      const row = document.createElement('div');
      row.className = 'detail-list-row';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'detail-list-name';
      nameSpan.textContent = source.name || 'Untitled source';
      const valSpan = document.createElement('span');
      valSpan.className = 'detail-list-value';
      if (bySource) {
        const scoreText = bySource.score !== null
          ? ` · ${Constants.scoreTypeLabel(source.scoreType)}: ${Constants.formatScore(bySource.score)}`
          : '';
        valSpan.textContent = `Rank ${bySource.rank}${scoreText}`;
      } else {
        valSpan.textContent = 'Not ranked';
        valSpan.classList.add('detail-not-ranked');
      }
      row.appendChild(nameSpan);
      row.appendChild(valSpan);
      listsWrap.appendChild(row);
    });
    sheet.appendChild(listsWrap);

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
