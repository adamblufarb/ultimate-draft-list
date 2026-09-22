/* Tab 1 — Rankings: combined/average ranking across selected sources, with
   live recompute on checkbox toggle and drafted-player hiding. Kept
   intentionally minimal — just rank, name, and combined rank. */
(function (global) {
  let container;
  let selectedIds = [];

  function init(rootEl) {
    container = rootEl;
    selectedIds = App.state.sources.map((s) => s.id);
    App.on('sources-changed', onSourcesChanged);
    App.on('drafted-changed', render);
    App.on('include-drafted-changed', render);
    // Tagging a player from the (still-open) player detail view fires this
    // repeatedly in quick succession — a full render() would tear down and
    // rebuild the whole list each time, resetting scroll to the top. Update
    // just that row's tags in place instead, same fix as the lock button.
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

    if (App.state.sources.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-hint';
      empty.textContent = 'Add a data source in the Sources tab to see rankings here.';
      container.appendChild(empty);
      return;
    }

    container.appendChild(renderSourceToggles());
    container.appendChild(renderIncludeDraftedToggle());

    const combined = Ranking.computeCombined(App.state.sources, selectedIds);
    container.appendChild(renderList(combined));
  }

  function renderToggleChip(text, isActive, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toggle-label' + (isActive ? ' is-active' : '');
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function renderIncludeDraftedToggle() {
    const wrap = document.createElement('div');
    wrap.className = 'source-toggles include-drafted-toggle';
    const isActive = App.getIncludeDrafted();
    wrap.appendChild(renderToggleChip('Include Drafted Players', isActive, () => {
      App.setIncludeDrafted(!isActive);
    }));
    return wrap;
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

  function renderList(combined) {
    const wrap = document.createElement('div');
    wrap.className = 'rankings-list';

    const includeDrafted = App.getIncludeDrafted();
    const visible = combined.filter((row) => includeDrafted || !App.isDrafted(row.key));

    if (visible.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-hint';
      if (selectedIds.length === 0) {
        empty.textContent = 'Select at least one source to see a ranking.';
      } else if (combined.length > 0) {
        empty.textContent = 'All ranked players have been drafted. Check "Include drafted players" to see them.';
      } else {
        empty.textContent = 'No players parsed yet in the selected source(s).';
      }
      wrap.appendChild(empty);
      return wrap;
    }

    visible.forEach((row, index) => {
      const drafted = App.isDrafted(row.key);
      const item = document.createElement('div');
      item.className = 'rank-row' + (drafted ? ' is-drafted' : '') + (index % 2 === 1 ? ' row-alt' : '');
      item.dataset.key = row.key;
      item.addEventListener('click', () => PlayerDetail.open(row.key, selectedIds, (newIds) => {
        selectedIds = newIds;
        render();
      }));

      const rankBadge = document.createElement('div');
      rankBadge.className = 'rank-badge';
      rankBadge.textContent = row.avg.toFixed(1);

      const nameEl = document.createElement('div');
      nameEl.className = 'rank-name';
      const nameText = document.createElement('span');
      nameText.className = 'player-name-text';
      nameText.textContent = row.displayName;
      nameEl.appendChild(nameText);
      if (row.positions) {
        const posBadge = document.createElement('span');
        posBadge.className = 'player-positions';
        posBadge.textContent = row.positions;
        nameEl.appendChild(posBadge);
      }

      item.appendChild(rankBadge);
      item.appendChild(nameEl);
      const tagsBadge = playerTagsBadge(row.key);
      if (tagsBadge) item.appendChild(tagsBadge);
      wrap.appendChild(item);

      const position = index + 1;
      if (position % 10 === 0 && position < visible.length) {
        wrap.appendChild(renderListDivider(position));
      }
    });

    return wrap;
  }

  global.RankingsTab = { init, render };
})(window);
