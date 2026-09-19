/* Tab 4 — My Team: the roster of players marked "Drafted by me", in pick
   order, with a quick position-count breakdown at the top. */
(function (global) {
  const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
  let container;

  function init(rootEl) {
    container = rootEl;
    App.on('my-team-changed', render);
    App.on('sources-changed', render);
    App.on('remote-state-loaded', render);
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

    const list = document.createElement('div');
    list.className = 'my-team-list';
    App.state.myTeamKeys.forEach((key, i) => {
      const entry = index.get(key);
      const row = document.createElement('div');
      row.className = 'my-team-row' + (i % 2 === 1 ? ' row-alt' : '');
      row.addEventListener('click', () => PlayerDetail.open(key));

      const badge = document.createElement('div');
      badge.className = 'rank-badge';
      badge.textContent = i + 1;

      const name = document.createElement('div');
      name.className = 'my-team-name';
      const nameText = document.createElement('span');
      nameText.textContent = entry ? entry.displayName : key;
      name.appendChild(nameText);
      if (entry && entry.positions) {
        const posEl = document.createElement('span');
        posEl.className = 'my-team-positions';
        posEl.textContent = entry.positions;
        name.appendChild(posEl);
      }

      row.appendChild(badge);
      row.appendChild(name);
      list.appendChild(row);
    });
    container.appendChild(list);
  }

  global.MyTeamTab = { init, render };
})(window);
