/* Tab 4 — My Team: the roster of players marked "Drafted by me", in pick
   order, with a quick position-count breakdown at the top. Player cards
   look like the other lists': combined rank average (default source
   weights), name, position badge, and tag emoji. */
(function (global) {
  const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
  let container;

  function init(rootEl) {
    container = rootEl;
    App.on('my-team-changed', render);
    App.on('sources-changed', render);
    App.on('remote-state-loaded', render);
    App.on('tags-changed', render);
    render();
  }

  function countPositions(index) {
    const counts = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
    App.state.myTeamKeys.forEach((key) => {
      const entry = index.get(key);
      if (!entry || !entry.positions) return;
      entry.positions.split(',').forEach((p) => {
        const token = p.trim().toUpperCase();
        if (Object.prototype.hasOwnProperty.call(counts, token)) counts[token] += 1;
      });
    });
    return counts;
  }

  // Same tag emoji as the other lists (breakout/sleeper/target/do-not-draft).
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

  function render() {
    container.innerHTML = '';

    const index = Ranking.buildIndex(App.state.sources);
    const counts = countPositions(index);

    const countersWrap = document.createElement('div');
    countersWrap.className = 'position-counters';
    POSITIONS.forEach((pos) => {
      const box = document.createElement('div');
      box.className = 'position-counter';
      const label = document.createElement('div');
      label.className = 'position-counter-label';
      label.textContent = pos;
      const value = document.createElement('div');
      value.className = 'position-counter-value';
      value.textContent = counts[pos];
      box.appendChild(label);
      box.appendChild(value);
      countersWrap.appendChild(box);
    });
    container.appendChild(countersWrap);

    if (App.state.myTeamKeys.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-hint';
      empty.textContent = 'No players yet. Open a player\'s detail view and hit "Drafted by me" to add them here.';
      container.appendChild(empty);
      return;
    }

    const weights = SourceWeights.defaultWeights(App.state.sources);
    const avgByKey = new Map(Ranking.combineFromIndex(index, weights).map((r) => [r.key, r.avg]));

    const list = document.createElement('div');
    list.className = 'rankings-list';
    App.state.myTeamKeys.forEach((key, i) => {
      const entry = index.get(key);
      const avg = avgByKey.get(key);
      const row = document.createElement('div');
      row.className = 'rank-row' + (i % 2 === 1 ? ' row-alt' : '');
      row.dataset.key = key;
      row.addEventListener('click', () => PlayerDetail.open(key, weights, () => {}, null));

      const badge = document.createElement('div');
      badge.className = 'rank-badge';
      badge.textContent = avg !== undefined ? avg.toFixed(1) : '—';

      const name = document.createElement('div');
      name.className = 'rank-name';
      const nameText = document.createElement('span');
      nameText.className = 'player-name-text';
      nameText.textContent = entry ? entry.displayName : key;
      name.appendChild(nameText);
      if (entry && entry.positions) {
        const posEl = document.createElement('span');
        posEl.className = 'player-positions';
        posEl.textContent = entry.positions;
        name.appendChild(posEl);
      }

      row.appendChild(badge);
      row.appendChild(name);
      const tags = playerTagsBadge(key);
      if (tags) row.appendChild(tags);
      list.appendChild(row);
    });
    container.appendChild(list);
  }

  global.MyTeamTab = { init, render };
})(window);
