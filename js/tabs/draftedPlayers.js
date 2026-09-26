/* Tab 3 — Draft Board: every player marked drafted (by any means —
   "Mark Drafted" or "Drafted by me"), in the order they were drafted.
   That order is fixed — it's a record of what happened during the draft,
   not something you reorder — so this list has no drag handle, unlike
   Draft List. It does carry the same "List filters" (source toggle chips)
   as the other lists, but here they only change which sources feed the
   combined rank average shown next to each name; they never change the
   order players appear in. */
(function (global) {
  let container;
  let selectedIds = [];

  function init(rootEl) {
    container = rootEl;
    selectedIds = App.state.sources.map((s) => s.id);
    App.on('sources-changed', onSourcesChanged);
    App.on('drafted-changed', render);
    // Same reasoning as Draft List/Rankings: tagging a player from the
    // still-open player detail view fires this repeatedly in quick
    // succession, and a full render() would reset scroll to the top each
    // time — update just that row's tags in place instead.
    App.on('tags-changed', (payload) => {
      if (payload && payload.key) updateRowTags(payload.key);
      else render();
    });
    App.on('remote-state-loaded', onSourcesChanged);
    render();
  }

  function onSourcesChanged() {
    const currentIds = new Set(App.state.sources.map((s) => s.id));
    selectedIds = selectedIds.filter((id) => currentIds.has(id));
    App.state.sources.forEach((s) => {
      if (!selectedIds.includes(s.id)) selectedIds.push(s.id);
    });
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

    container.appendChild(renderSourceToggles());

    const index = Ranking.buildIndex(App.state.sources);
    const combined = Ranking.combineFromIndex(index, selectedIds);
    const avgByKey = new Map(combined.map((row) => [row.key, row.avg]));

    container.appendChild(renderList(draftedKeys, avgByKey, index));
  }

  function renderToggleChip(text, isActive, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toggle-label' + (isActive ? ' is-active' : '');
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function renderSourceToggles() {
    const wrap = document.createElement('div');
    wrap.className = 'source-toggles';
    App.state.sources.forEach((source) => {
      const isActive = selectedIds.includes(source.id);
      wrap.appendChild(renderToggleChip(source.name || 'Untitled source', isActive, () => {
        if (isActive) {
          selectedIds = selectedIds.filter((id) => id !== source.id);
        } else {
          selectedIds.push(source.id);
        }
        render();
      }));
    });
    return wrap;
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
    if (App.isDoNotDraft(key)) parts.push('🚫');
    if (parts.length === 0) return null;
    const el = document.createElement('span');
    el.className = 'player-tags';
    el.textContent = parts.join(' ');
    return el;
  }

  function renderListDivider(count) {
    const el = document.createElement('div');
    el.className = 'list-divider';
    el.textContent = '— ' + count + ' —';
    return el;
  }

  function renderList(draftedKeys, avgByKey, index) {
    const wrap = document.createElement('div');
    wrap.className = 'rankings-list';

    draftedKeys.forEach((key, i) => {
      const entry = index.get(key);
      const avg = avgByKey.get(key);

      const item = document.createElement('div');
      item.className = 'rank-row' + (i % 2 === 1 ? ' row-alt' : '');
      item.dataset.key = key;
      item.addEventListener('click', () => PlayerDetail.open(key, selectedIds, (newIds) => {
        selectedIds = newIds;
        render();
      }));

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
      wrap.appendChild(item);

      const position = i + 1;
      if (position % 10 === 0 && position < draftedKeys.length) {
        wrap.appendChild(renderListDivider(position));
      }
    });

    return wrap;
  }

  global.DraftedPlayersTab = { init, render };
})(window);
