/* Tab 3 — Draft Board: every player marked drafted (by any means —
   "Mark Drafted" or "Drafted By Me"), in the order they were drafted.
   That order is fixed — it's a record of what happened during the draft,
   not something you reorder — so this list has no drag handle, unlike
   Draft List, and no filters either: the combined rank next to each name
   always uses the default source weights. Each entry shows its overall
   pick number to the left of the card, picks you made yourself (My Team)
   are blue, and a "Round N" divider (a round being one pick per team —
   App.state.leagueSize picks) starts each round. */
(function (global) {
  let container;
  function init(rootEl) {
    container = rootEl;
    App.on('sources-changed', render);
    App.on('drafted-changed', render);
    // Same reasoning as Draft List/Rankings: tagging a player from the
    // still-open player detail view fires this repeatedly in quick
    // succession, and a full render() would reset scroll to the top each
    // time — update just that row's tags in place instead.
    App.on('tags-changed', (payload) => {
      if (payload && payload.key) updateRowTags(payload.key);
      else render();
    });
    App.on('remote-state-loaded', render);
    render();
  }

  function render() {
    container.innerHTML = '';

    const draftedKeys = App.state.draftedKeys || [];
    if (draftedKeys.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-hint';
      empty.textContent = 'No players drafted yet. Mark a player drafted from their detail view to see them here.';
      container.appendChild(empty);
      return;
    }

    const index = Ranking.buildIndex(App.state.sources);
    const combined = Ranking.combineFromIndex(index, SourceWeights.defaultWeights(App.state.sources));
    const avgByKey = new Map(combined.map((row) => [row.key, row.avg]));

    container.appendChild(renderList(draftedKeys, avgByKey, index));
  }

  function updateRowTags(key) {
    if (!container) return;
    const row = container.querySelector('.rank-row[data-key="' + CSS.escape(key) + '"]');
    if (!row) return;
    const existingBadge = row.querySelector('.player-tags');
    if (existingBadge) existingBadge.remove();
    const newBadge = playerTagsBadge(key);
    if (newBadge) row.appendChild(newBadge);
  }

  // Breakout/sleeper/do-not-draft tags are only ever set from the player
  // detail view — list rows just display whatever's active, right-aligned.
  function playerTagsBadge(key) {
    const parts = [];
    const breakoutLevel = App.getBreakoutLevel(key);
    if (breakoutLevel >= 2) parts.push('🌟'); else if (breakoutLevel === 1) parts.push('⭐');
    const sleeperLevel = App.getSleeperLevel(key);
    if (sleeperLevel >= 2) parts.push('😴'); else if (sleeperLevel === 1) parts.push('🥱');
    if (App.isTarget(key)) parts.push('🎯');
    if (App.isDoNotDraft(key)) parts.push('🚫');
    if (parts.length === 0) return null;
    const el = document.createElement('span');
    el.className = 'player-tags';
    el.textContent = parts.join(' ');
    return el;
  }

  function renderRoundDivider(round) {
    const el = document.createElement('div');
    el.className = 'list-divider';
    el.textContent = '— Round ' + round + ' —';
    return el;
  }

  function renderList(draftedKeys, avgByKey, index) {
    const wrap = document.createElement('div');
    wrap.className = 'rankings-list';

    const roundSize = App.state.leagueSize;
    draftedKeys.forEach((key, i) => {
      if (i % roundSize === 0) wrap.appendChild(renderRoundDivider(i / roundSize + 1));
      const entry = index.get(key);
      const avg = avgByKey.get(key);

      const item = document.createElement('div');
      item.className = 'rank-row' + (i % 2 === 1 ? ' row-alt' : '') + (App.isOnMyTeam(key) ? ' is-mine' : '');
      item.dataset.key = key;
      item.addEventListener('click', () => PlayerDetail.open(key, SourceWeights.defaultWeights(App.state.sources), () => {}, null));

      const rankBadge = document.createElement('div');
      rankBadge.className = 'rank-badge';
      rankBadge.textContent = avg !== undefined ? avg.toFixed(1) : '—';

      const nameEl = document.createElement('div');
      nameEl.className = 'rank-name';
      const nameText = document.createElement('span');
      nameText.className = 'player-name-text';
      nameText.textContent = entry ? entry.displayName : key;
      nameEl.appendChild(nameText);
      if (entry && entry.positions) {
        const posBadge = document.createElement('span');
        posBadge.className = 'player-positions';
        posBadge.textContent = entry.positions;
        nameEl.appendChild(posBadge);
      }

      item.appendChild(rankBadge);
      item.appendChild(nameEl);
      const tagsBadge = playerTagsBadge(key);
      if (tagsBadge) item.appendChild(tagsBadge);

      // Overall pick number sits to the left, outside the card.
      const pickRow = document.createElement('div');
      pickRow.className = 'board-entry';
      const pickNum = document.createElement('div');
      pickNum.className = 'board-pick-number';
      pickNum.textContent = String(i + 1);
      pickRow.appendChild(pickNum);
      pickRow.appendChild(item);
      wrap.appendChild(pickRow);
    });

    return wrap;
  }

  global.DraftedPlayersTab = { init, render };
})(window);
