/* Tab 4 — My Team: the roster of players marked "Drafted By Me", in pick
   order, with a quick position-count breakdown at the top. Player cards
   look like the other lists': combined rank average (default source
   weights), name, position badge, and tag emoji. They sit in lineup slots
   (starters + bench, see js/lineup.js) that fill as you draft. */
(function (global) {
  const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
  let container;
  // Position counters double as filters; several can be on at once. Cleared
  // whenever you leave the tab (resetFilters, called from main.js).
  const activeFilters = new Set();

  function init(rootEl) {
    container = rootEl;
    App.on('my-team-changed', render);
    App.on('sources-changed', render);
    App.on('filters-changed', render);   // combined ranks follow the Draft List's filters
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
      const box = document.createElement('button');
      box.type = 'button';
      box.className = 'position-counter' + (activeFilters.has(pos) ? ' is-active' : '');
      const label = document.createElement('div');
      label.className = 'position-counter-label';
      label.textContent = pos;
      const value = document.createElement('div');
      value.className = 'position-counter-value';
      value.textContent = counts[pos];
      box.appendChild(label);
      box.appendChild(value);
      box.addEventListener('click', () => {
        if (activeFilters.has(pos)) activeFilters.delete(pos); else activeFilters.add(pos);
        render();
      });
      countersWrap.appendChild(box);
    });
    container.appendChild(countersWrap);

    const weights = App.getActiveWeights();
    const avgByKey = new Map(Ranking.combineFromIndex(index, weights).map((r) => [r.key, r.avg]));

    const lineup = Lineup.assign(App.state.myTeamKeys, (key) => { const e = index.get(key); return e ? e.positions : ''; });

    const card = (key) => {
      const entry = index.get(key);
      const avg = avgByKey.get(key);
      const row = document.createElement('div');
      row.className = 'rank-row';
      row.dataset.key = key;
      row.addEventListener('click', () => PlayerDetail.open(key, weights, () => {}, App.getActiveIso()));

      // Round the player was drafted in (their place in Draft Board's order,
      // one round per leagueSize picks), in a blue circle to the left of the
      // combined rank.
      const pickIdx = (App.state.draftedKeys || []).indexOf(key);
      const pick = document.createElement('div');
      pick.className = 'rank-badge pick-badge';
      pick.textContent = pickIdx === -1 ? '—' : String(Math.floor(pickIdx / App.state.leagueSize) + 1);

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

      row.appendChild(pick);
      row.appendChild(badge);
      row.appendChild(name);
      const tags = playerTagsBadge(key);
      if (tags) row.appendChild(tags);
      return row;
    };
    const slotRow = (label, key) => {
      const entry = document.createElement('div');
      entry.className = 'board-entry lineup-entry';
      const lab = document.createElement('div');
      lab.className = 'lineup-slot-label';
      lab.textContent = label;
      entry.appendChild(lab);
      if (key) {
        entry.appendChild(card(key));
      } else {
        const empty = document.createElement('div');
        empty.className = 'rank-row lineup-empty';
        // Hidden badge keeps the empty slot exactly as tall as a player card.
        const ghost = document.createElement('div');
        ghost.className = 'rank-badge';
        ghost.style.visibility = 'hidden';
        ghost.style.width = '0';
        ghost.style.minWidth = '0';
        ghost.style.padding = '0';
        ghost.textContent = '0.0';
        const openText = document.createElement('span');
        openText.textContent = 'Open';
        empty.appendChild(ghost);
        empty.appendChild(openText);
        entry.appendChild(empty);
      }
      return entry;
    };
    const heading = (text) => {
      const h = document.createElement('div');
      h.className = 'list-divider';
      h.textContent = '— ' + text + ' —';
      return h;
    };

    // With position filters on, only players who have one of those positions
    // (as any of their listed positions) are shown, in their lineup slots;
    // open slots and everyone else are hidden.
    const filtering = activeFilters.size > 0;
    const passes = (key) => {
      if (!filtering) return true;
      const entry = key && index.get(key);
      return !!entry && Lineup.parsePositions(entry.positions).some((p) => activeFilters.has(p));
    };
    const list = document.createElement('div');
    list.className = 'rankings-list';
    let shown = 0;
    const add = (label, key) => {
      if (filtering && !passes(key)) return;
      list.appendChild(slotRow(label, key));
      shown += 1;
    };
    lineup.starters.forEach(({ slot, key }) => add(slot.label, key));
    lineup.bench.forEach((key) => add('BNCH', key));
    const overShown = lineup.over.filter(passes);
    if (overShown.length) {
      list.appendChild(heading('Over the 16-player limit'));
      overShown.forEach((key) => { list.appendChild(slotRow('—', key)); shown += 1; });
    }
    if (filtering && shown === 0) {
      const none = document.createElement('p');
      none.className = 'empty-hint';
      none.textContent = 'No one on your team has ' + Array.from(activeFilters).join(' / ') + '.';
      list.appendChild(none);
    }
    container.appendChild(list);
  }

  // Back to "no filter" — called whenever you leave the My Team tab.
  function resetFilters() {
    if (activeFilters.size === 0) return;
    activeFilters.clear();
    render();
  }

  global.MyTeamTab = { init, render, resetFilters };
})(window);
