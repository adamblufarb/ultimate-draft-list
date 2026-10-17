/* League tab: every team in the draft as a square — "Team 1", "Team 2" …
   named by their slot in round 1, except yours ("My Team", in blue). Each
   square counts the team's players by position and marks the team on the
   clock. Tapping another team lists its picks the way My Team does (reusing
   MyTeamTab's lineup view); tapping yours goes to My Team. Which team made
   each pick comes from the draft order, snake and reversed rounds included
   (App.pickOwner). */
(function (global) {
  const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
  let container;
  let openSlot = null;      // team whose roster is showing, or null for the grid
  let teamView = null;      // MyTeamTab instance for that roster

  function teamName(slot) {
    return slot === App.state.pickSlot ? 'My Team' : 'Team ' + slot;
  }

  function init(rootEl) {
    container = rootEl;
    ['drafted-changed', 'my-team-changed', 'sources-changed', 'filters-changed', 'remote-state-loaded', 'tags-changed']
      .forEach((ev) => App.on(ev, render));
    render();
  }

  function counts(keys, index) {
    const c = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 };
    keys.forEach((key) => {
      const entry = index.get(key);
      if (!entry || !entry.positions) return;
      entry.positions.split(',').forEach((p) => {
        const t = p.trim().toUpperCase();
        if (t in c) c[t] += 1;
      });
    });
    return c;
  }

  function render() {
    container.innerHTML = '';
    const size = App.state.leagueSize;
    if (openSlot !== null && openSlot > size) openSlot = null;
    if (openSlot !== null) { renderTeam(openSlot); return; }

    const index = Ranking.buildIndex(App.state.sources);
    const onClock = App.teamOnTheClock();
    const grid = document.createElement('div');
    grid.className = 'league-grid';
    for (let slot = 1; slot <= size; slot++) {
      const mine = slot === App.state.pickSlot;
      const keys = App.teamKeys(slot);
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'league-tile' + (mine ? ' is-mine' : '') + (slot === onClock ? ' is-on-clock' : '');
      const name = document.createElement('div');
      name.className = 'league-team-name';
      name.textContent = teamName(slot);
      tile.appendChild(name);
      const clock = document.createElement('div');
      clock.className = 'league-clock';
      clock.textContent = slot === onClock ? 'On the clock' : '';
      tile.appendChild(clock);
      const c = counts(keys, index);
      const row = document.createElement('div');
      row.className = 'league-positions';
      POSITIONS.forEach((pos) => {
        const cell = document.createElement('div');
        cell.className = 'league-pos';
        cell.innerHTML = '<span class="league-pos-label"></span><span class="league-pos-value"></span>';
        cell.firstChild.textContent = pos;
        cell.lastChild.textContent = c[pos];
        row.appendChild(cell);
      });
      tile.appendChild(row);
      const total = document.createElement('div');
      total.className = 'league-total';
      total.textContent = keys.length + ' / ' + App.totalRounds() + ' players';
      tile.appendChild(total);
      tile.addEventListener('click', () => {
        if (mine) { AppNav.showTab('myteam'); return; }
        openSlot = slot;
        render();
      });
      grid.appendChild(tile);
    }
    container.appendChild(grid);
  }

  function renderTeam(slot) {
    const back = document.createElement('button');
    back.className = 'btn btn-secondary sources-back';
    back.textContent = '‹ League';
    back.addEventListener('click', () => { openSlot = null; render(); });
    container.appendChild(back);
    const title = document.createElement('h2');
    title.className = 'league-title';
    title.textContent = teamName(slot);
    container.appendChild(title);
    const holder = document.createElement('div');
    container.appendChild(holder);
    teamView = global.MyTeamTab.create(() => App.teamKeys(slot));
    teamView.init(holder);
  }

  // Back to the grid when you leave the tab.
  function reset() { if (openSlot !== null) { openSlot = null; render(); } }

  global.LeagueTab = { init, render, reset };
})(window);
