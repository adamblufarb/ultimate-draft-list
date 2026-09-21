/* Tab 2 — Draft List: the user's own editable, drag-reorderable list.
   Initialized from the combined average once, then persists independently
   of source edits. Changing the source filter automatically resyncs
   unlocked players to the newly-filtered average (no Reset button).
   Drafted players are hidden (unless "include drafted" is on) but keep
   their place in the full order so un-drafting puts them back where they
   were. Locked players keep their exact position on resync. Each position
   chip also shows how many of the next N undrafted picks hold that
   position (N chosen from the pool-size dropdown), flagging scarcity in
   orange/red as that count runs low relative to N. */
(function (global) {
  const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
  const POOL_SIZE_OPTIONS = [10, 20, 30, 40, 50, 75, 100];
  let container;
  let listSection;
  let reorderable;
  let selectedIds = [];
  let selectedPositions = [];
  let searchQuery = '';
  let searchInputEl;
  let searchClearBtn;
  let searchDebounceTimer = null;
  // How many of the best remaining (undrafted) picks each position count
  // is scoped to — e.g. 20 means "of the next 20 available players, how
  // many hold this position".
  let poolSize = 20;

  function init(rootEl) {
    container = rootEl;
    selectedIds = App.state.sources.map((s) => s.id);
    App.on('sources-changed', onSourcesChanged);
    App.on('drafted-changed', () => { if (isVisible()) render(); });
    App.on('include-drafted-changed', () => { if (isVisible()) render(); });
    App.on('tags-changed', () => { if (isVisible()) render(); });
    // A single lock toggle updates just that row's button in place rather
    // than rebuilding the whole list — a full container.innerHTML rebuild
    // right after the lock button had focus was resetting scroll to the
    // top on mobile, and could silently drop pointer capture out from
    // under an in-progress drag on that same row (the row element gets
    // destroyed and recreated mid-gesture). "Unlock All" has no single
    // key, so it still does a full render.
    App.on('locked-changed', (payload) => {
      if (!isVisible()) return;
      if (payload && payload.key) updateLockButton(payload.key);
      else render();
    });
    App.on('remote-state-loaded', () => {
      const currentIds = new Set(App.state.sources.map((s) => s.id));
      selectedIds = selectedIds.filter((id) => currentIds.has(id));
      App.state.sources.forEach((s) => {
        if (!selectedIds.includes(s.id)) selectedIds.push(s.id);
      });
      if (isVisible()) show();
    });
  }

  function isVisible() {
    return container && container.classList.contains('active');
  }

  function updateLockButton(key) {
    if (!container) return;
    const row = container.querySelector('.draft-row[data-key="' + CSS.escape(key) + '"]');
    if (!row) return;
    const btn = row.querySelector('.btn-lock');
    const handle = row.querySelector('.drag-handle');
    if (!btn) return;
    const locked = App.isLocked(key);
    btn.className = 'btn-lock' + (locked ? ' is-locked' : '');
    btn.textContent = locked ? '🔒' : '🔓';
    btn.title = locked
      ? "Locked — won't move when you reset"
      : "Lock — keep this player's position when you reset";
    if (handle) {
      handle.classList.toggle('is-locked', locked);
      handle.title = locked ? "Locked — can't be dragged" : '';
    }
  }

  function onSourcesChanged() {
    const currentIds = new Set(App.state.sources.map((s) => s.id));
    selectedIds = selectedIds.filter((id) => currentIds.has(id));
    App.state.sources.forEach((s) => {
      if (!selectedIds.includes(s.id)) selectedIds.push(s.id);
    });
    if (isVisible()) render();
  }

  function ensureInitialized() {
    if (App.state.draftOrder && App.state.draftOrder.length > 0) return;
    const allIds = App.state.sources.map((s) => s.id);
    App.state.draftOrder = Ranking.computeCombined(App.state.sources, allIds)
      .map((row) => ({ key: row.key, name: row.displayName }));
    App.persist();
  }

  // Rebuilds the full order by dropping the reordered visible items back
  // into the slots they occupied, leaving hidden (drafted) items untouched
  // in place — so un-drafting a player restores its old position.
  function mergeReorder(fullOrder, newVisibleOrder) {
    const queue = newVisibleOrder.slice();
    const visibleKeys = new Set(newVisibleOrder.map((i) => i.key));
    let qi = 0;
    return fullOrder.map((item) => (visibleKeys.has(item.key) ? queue[qi++] : item));
  }

  // Recomputes the combined average over `ids`, but any locked player keeps
  // the exact index they're currently sitting at — everyone else re-fills
  // around them in the fresh sorted order.
  function buildResetOrder(ids) {
    const combined = Ranking.computeCombined(App.state.sources, ids);
    const lockedKeys = new Set(App.state.lockedKeys);
    const oldOrder = App.state.draftOrder || [];

    const lockedSlots = [];
    oldOrder.forEach((item, idx) => {
      if (lockedKeys.has(item.key)) lockedSlots.push({ index: idx, key: item.key, name: item.name });
    });

    const nameByKey = new Map(combined.map((r) => [r.key, r.displayName]));
    const freshQueue = combined.filter((r) => !lockedKeys.has(r.key)).map((r) => ({ key: r.key, name: r.displayName }));

    const length = Math.max(combined.length, 0, ...lockedSlots.map((l) => l.index + 1));
    const result = new Array(length).fill(null);
    lockedSlots.forEach((l) => {
      if (l.index < length) result[l.index] = { key: l.key, name: nameByKey.get(l.key) || l.name };
    });

    let qi = 0;
    for (let i = 0; i < length && qi < freshQueue.length; i++) {
      if (result[i]) continue;
      result[i] = freshQueue[qi++];
    }
    while (qi < freshQueue.length) result.push(freshQueue[qi++]);

    return result.filter(Boolean);
  }

  function show() {
    ensureInitialized();
    render();
  }

  function render() {
    clearTimeout(searchDebounceTimer);
    container.innerHTML = '';

    if (App.state.sources.length === 0 && (!App.state.draftOrder || App.state.draftOrder.length === 0)) {
      const empty = document.createElement('p');
      empty.className = 'empty-hint';
      empty.textContent = 'Add a data source, then come back here to build your draft list.';
      container.appendChild(empty);
      return;
    }

    container.appendChild(renderSearchBox());
    container.appendChild(renderSourceToggles());
    container.appendChild(renderPositionToggles());
    container.appendChild(renderIncludeDraftedRow());

    listSection = document.createElement('div');
    container.appendChild(listSection);
    renderListSection();
  }

  // Only rebuilds the list portion (not the search box / toggles / toolbar
  // above it) so typing in the search box never loses focus or cursor
  // position — a full container rebuild per keystroke would.
  function renderListSection() {
    listSection.innerHTML = '';

    const index = Ranking.buildIndex(App.state.sources);
    const fullOrder = App.state.draftOrder || [];
    const includeDrafted = App.getIncludeDrafted();
    const query = searchQuery.trim().toLowerCase();
    const visibleItems = fullOrder.filter((item) => {
      if (!includeDrafted && App.isDrafted(item.key)) return false;
      if (selectedPositions.length > 0 && !matchesPositionFilter(item.key, index)) return false;
      if (query && !item.name.toLowerCase().includes(query)) return false;
      return true;
    });

    if (visibleItems.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-hint';
      if (fullOrder.length === 0) {
        empty.textContent = 'No players yet — add a source to build your draft list.';
      } else if (query) {
        empty.textContent = 'No players match your search.';
      } else if (selectedPositions.length > 0) {
        empty.textContent = 'No players match the selected position filter.';
      } else {
        empty.textContent = 'All players have been drafted. Check "Include drafted players" to see them.';
      }
      listSection.appendChild(empty);
      return;
    }

    const listEl = document.createElement('div');
    listEl.className = 'draft-list';
    listSection.appendChild(listEl);

    const combined = Ranking.combineFromIndex(index, selectedIds);
    const avgByKey = new Map(combined.map((row) => [row.key, row.avg]));

    reorderable = new ReorderableList(listEl, {
      gap: 6,
      renderRow: (item, i) => renderRow(item, i, avgByKey, index),
      canDrag: (key) => !App.isLocked(key),
      dividerEvery: 10,
      renderDivider: (count) => renderListDivider(count),
      onReorder: (newVisibleOrder) => {
        App.state.draftOrder = mergeReorder(App.state.draftOrder, newVisibleOrder);
        App.persist();
      }
    });
    reorderable.setItems(visibleItems);
  }

  function renderListDivider(count) {
    const el = document.createElement('div');
    el.className = 'list-divider';
    el.textContent = '— ' + count + ' —';
    return el;
  }

  function renderSearchBox() {
    const wrap = document.createElement('div');
    wrap.className = 'search-box';

    searchInputEl = document.createElement('input');
    searchInputEl.type = 'text';
    searchInputEl.className = 'search-input';
    searchInputEl.placeholder = 'Search players…';
    searchInputEl.value = searchQuery;
    searchInputEl.addEventListener('input', () => {
      searchQuery = searchInputEl.value;
      searchClearBtn.classList.toggle('is-visible', searchQuery.length > 0);
      // Debounced: re-filtering rebuilds every visible row, which typing
      // fast enough would otherwise trigger on every single keystroke.
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(renderListSection, 150);
    });
    wrap.appendChild(searchInputEl);

    searchClearBtn = document.createElement('button');
    searchClearBtn.type = 'button';
    searchClearBtn.className = 'search-clear' + (searchQuery ? ' is-visible' : '');
    searchClearBtn.textContent = '✕';
    searchClearBtn.setAttribute('aria-label', 'Clear search');
    searchClearBtn.addEventListener('click', () => {
      clearTimeout(searchDebounceTimer);
      searchQuery = '';
      searchInputEl.value = '';
      searchClearBtn.classList.remove('is-visible');
      searchInputEl.focus();
      renderListSection();
    });
    wrap.appendChild(searchClearBtn);

    return wrap;
  }

  function matchesPositionFilter(key, index) {
    const entry = index.get(key);
    if (!entry || !entry.positions) return false;
    const playerPositions = entry.positions.split(',').map((p) => p.trim().toUpperCase());
    return selectedPositions.some((p) => playerPositions.includes(p));
  }

  // Counts, among the best `size` still-undrafted players ranked by the
  // currently selected List filter (same combined average the rank badges
  // use), how many hold each position — a player listed under multiple
  // positions (e.g. "PF, SF") counts toward each, same as the My Team tab's
  // counters. Deliberately re-ranks from the live filter rather than
  // reading the user's dragged draft order, so it always reflects whichever
  // sources are currently checked, independent of manual reordering.
  function computeAvailablePositionCounts(index, size) {
    const combined = Ranking.combineFromIndex(index, selectedIds);
    const available = combined.filter((row) => !App.isDrafted(row.key));
    const pool = available.slice(0, size);
    const counts = {};
    POSITIONS.forEach((p) => { counts[p] = 0; });
    pool.forEach((row) => {
      if (!row.positions) return;
      const playerPositions = row.positions.split(',').map((p) => p.trim().toUpperCase());
      POSITIONS.forEach((p) => {
        if (playerPositions.includes(p)) counts[p] += 1;
      });
    });
    return counts;
  }

  function renderToggleChip(text, isActive, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toggle-label' + (isActive ? ' is-active' : '');
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function renderPositionToggles() {
    const wrap = document.createElement('div');
    wrap.className = 'source-toggles position-toggles';

    const index = Ranking.buildIndex(App.state.sources);
    const counts = computeAvailablePositionCounts(index, poolSize);

    POSITIONS.forEach((pos) => {
      const isActive = selectedPositions.includes(pos);
      const count = counts[pos];
      const pct = poolSize > 0 ? (count / poolSize) * 100 : 0;
      const scarcityClass = pct <= 17 ? 'scarcity-danger' : (pct <= 25 ? 'scarcity-warn' : '');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toggle-label' + (isActive ? ' is-active' : '') + (scarcityClass ? ' ' + scarcityClass : '');
      const posEl = document.createElement('span');
      posEl.textContent = pos;
      const countEl = document.createElement('span');
      countEl.className = 'position-chip-count';
      countEl.textContent = String(count);
      btn.appendChild(posEl);
      btn.appendChild(countEl);
      btn.addEventListener('click', () => {
        if (isActive) {
          selectedPositions = selectedPositions.filter((p) => p !== pos);
        } else {
          selectedPositions.push(pos);
        }
        render();
      });
      wrap.appendChild(btn);
    });

    const poolSelect = document.createElement('select');
    poolSelect.className = 'pool-size-select';
    poolSelect.setAttribute('aria-label', 'Position count pool size');
    POOL_SIZE_OPTIONS.forEach((n) => {
      const opt = document.createElement('option');
      opt.value = String(n);
      opt.textContent = String(n);
      if (n === poolSize) opt.selected = true;
      poolSelect.appendChild(opt);
    });
    poolSelect.addEventListener('change', () => {
      poolSize = Number(poolSelect.value);
      render();
    });
    wrap.appendChild(poolSelect);

    return wrap;
  }

  function renderIncludeDraftedRow() {
    const wrap = document.createElement('div');
    wrap.className = 'source-toggles include-drafted-toggle draft-actions-row';
    const isActive = App.getIncludeDrafted();
    wrap.appendChild(renderToggleChip('Include Drafted Players', isActive, () => {
      App.setIncludeDrafted(!isActive);
    }));
    const unlockBtn = renderToggleChip('Unlock All', false, () => {
      if (!confirm('Unlock all locked players?')) return;
      App.unlockAll();
    });
    wrap.appendChild(unlockBtn);
    const undraftBtn = renderToggleChip('Undraft All', false, () => {
      if (!confirm('Undraft all players?')) return;
      App.undraftAll();
    });
    wrap.appendChild(undraftBtn);
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
        // Filters drive the reset computation directly now (no Reset
        // button) — changing which sources feed the average immediately
        // resyncs everyone who isn't locked in place.
        App.state.draftOrder = buildResetOrder(selectedIds);
        App.persist();
        render();
      }));
    });
    return wrap;
  }

  function renderRow(item, _rowIndex, avgByKey, rankingIndex) {
    const drafted = App.isDrafted(item.key);
    const locked = App.isLocked(item.key);
    const avg = avgByKey.get(item.key);
    const entry = rankingIndex.get(item.key);

    const row = document.createElement('div');
    row.className = 'draft-row' + (drafted ? ' is-drafted' : '');
    row.addEventListener('click', () => PlayerDetail.open(item.key, selectedIds, (newIds) => {
      selectedIds = newIds;
      // Same auto-resync as tapping a source chip: the filter just changed,
      // so unlocked players resync to the newly-filtered average.
      App.state.draftOrder = buildResetOrder(selectedIds);
      App.persist();
      render();
    }));

    const handle = document.createElement('div');
    handle.className = 'drag-handle' + (locked ? ' is-locked' : '');
    handle.setAttribute('data-drag-handle', '');
    handle.title = locked ? "Locked — can't be dragged" : '';
    handle.textContent = '☰';

    // Shows the player's combined rank average — a fixed per-player stat,
    // not this row's current position in the list — so it doesn't change
    // as you drag them around.
    const badge = document.createElement('div');
    badge.className = 'rank-badge';
    badge.textContent = avg !== undefined ? avg.toFixed(1) : '—';

    const lockBtn = document.createElement('button');
    lockBtn.className = 'btn-lock' + (locked ? ' is-locked' : '');
    lockBtn.textContent = locked ? '🔒' : '🔓';
    lockBtn.title = locked
      ? "Locked — won't move when you reset"
      : "Lock — keep this player's position when you reset";
    lockBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Reads the live state rather than the `locked` captured at render
      // time: a lock toggle now updates this row in place (see
      // updateLockButton) instead of doing a full re-render, so this
      // handler's closure never gets refreshed with a new `locked` value.
      App.setLocked(item.key, !App.isLocked(item.key));
    });

    const name = document.createElement('div');
    name.className = 'draft-name';
    const nameText = document.createElement('span');
    nameText.className = 'player-name-text';
    nameText.textContent = item.name;
    name.appendChild(nameText);
    if (entry && entry.positions) {
      const posBadge = document.createElement('span');
      posBadge.className = 'player-positions';
      posBadge.textContent = entry.positions;
      name.appendChild(posBadge);
    }

    row.appendChild(handle);
    row.appendChild(badge);
    row.appendChild(lockBtn);
    row.appendChild(name);
    const tagsBadge = playerTagsBadge(item.key);
    if (tagsBadge) row.appendChild(tagsBadge);
    return row;
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

  global.DraftTab = { init, show, render };
})(window);
