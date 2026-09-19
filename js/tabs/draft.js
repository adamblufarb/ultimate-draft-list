/* Tab 2 — Draft List: the user's own editable, drag-reorderable list.
   Initialized from the combined average once, then persists independently
   of source edits until the user explicitly hits Reset. Drafted players are
   hidden (unless "include drafted" is on) but keep their place in the full
   order so un-drafting puts them back where they were. Locked players keep
   their exact position when the list is reset. */
(function (global) {
  let container;
  let reorderable;
  let selectedIds = [];

  function init(rootEl) {
    container = rootEl;
    selectedIds = App.state.sources.map((s) => s.id);
    App.on('sources-changed', onSourcesChanged);
    App.on('drafted-changed', () => { if (isVisible()) render(); });
    App.on('include-drafted-changed', () => { if (isVisible()) render(); });
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
    const btn = row && row.querySelector('.btn-lock');
    if (!btn) return;
    const locked = App.isLocked(key);
    btn.className = 'btn-lock' + (locked ? ' is-locked' : '');
    btn.textContent = locked ? '🔒' : '🔓';
    btn.title = locked
      ? "Locked — won't move when you reset"
      : "Lock — keep this player's position when you reset";
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
    container.innerHTML = '';

    if (App.state.sources.length === 0 && (!App.state.draftOrder || App.state.draftOrder.length === 0)) {
      const empty = document.createElement('p');
      empty.className = 'empty-hint';
      empty.textContent = 'Add a data source, then come back here to build your draft list.';
      container.appendChild(empty);
      return;
    }

    container.appendChild(renderSourceToggles());
    container.appendChild(renderIncludeDraftedToggle());

    const toolbar = document.createElement('div');
    toolbar.className = 'draft-toolbar';

    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn btn-secondary';
    resetBtn.textContent = 'Reset';
    resetBtn.addEventListener('click', () => {
      if (!confirm('Replace unlocked players with the current combined average (based on the checked lists)? Locked players stay put.')) return;
      App.state.draftOrder = buildResetOrder(selectedIds);
      App.persist();
      render();
    });
    toolbar.appendChild(resetBtn);

    const unlockAllBtn = document.createElement('button');
    unlockAllBtn.className = 'btn btn-secondary';
    unlockAllBtn.textContent = 'Unlock All';
    unlockAllBtn.addEventListener('click', () => {
      if (!confirm('Unlock all locked players?')) return;
      App.unlockAll();
    });
    toolbar.appendChild(unlockAllBtn);

    container.appendChild(toolbar);

    const fullOrder = App.state.draftOrder || [];
    const includeDrafted = App.getIncludeDrafted();
    const visibleItems = fullOrder.filter((item) => includeDrafted || !App.isDrafted(item.key));

    if (visibleItems.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-hint';
      empty.textContent = fullOrder.length > 0
        ? 'All players have been drafted. Check "Include drafted players" to see them.'
        : 'No players yet — add a source or hit Reset once you have.';
      container.appendChild(empty);
      return;
    }

    const listEl = document.createElement('div');
    listEl.className = 'draft-list';
    container.appendChild(listEl);

    const index = Ranking.buildIndex(App.state.sources);
    const combined = Ranking.combineFromIndex(index, selectedIds);
    const avgByKey = new Map(combined.map((row) => [row.key, row.avg]));

    reorderable = new ReorderableList(listEl, {
      gap: 6,
      renderRow: (item, i) => renderRow(item, i, avgByKey),
      onReorder: (newVisibleOrder) => {
        App.state.draftOrder = mergeReorder(App.state.draftOrder, newVisibleOrder);
        App.persist();
      }
    });
    reorderable.setItems(visibleItems);
  }

  function renderIncludeDraftedToggle() {
    const label = document.createElement('label');
    label.className = 'toggle-label include-drafted-toggle';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = App.getIncludeDrafted();
    checkbox.addEventListener('change', () => {
      App.setIncludeDrafted(checkbox.checked);
    });
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(' Include drafted players'));
    return label;
  }

  function renderSourceToggles() {
    const wrap = document.createElement('div');
    wrap.className = 'source-toggles';
    App.state.sources.forEach((source) => {
      const label = document.createElement('label');
      label.className = 'toggle-label';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedIds.includes(source.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          if (!selectedIds.includes(source.id)) selectedIds.push(source.id);
        } else {
          selectedIds = selectedIds.filter((id) => id !== source.id);
        }
        render();
      });
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(' ' + (source.name || 'Untitled source')));
      wrap.appendChild(label);
    });
    return wrap;
  }

  function renderRow(item, _index, avgByKey) {
    const drafted = App.isDrafted(item.key);
    const locked = App.isLocked(item.key);
    const avg = avgByKey.get(item.key);

    const row = document.createElement('div');
    row.className = 'draft-row' + (drafted ? ' is-drafted' : '');
    row.addEventListener('click', () => {
      if (row.dataset.justDragged) return;
      PlayerDetail.open(item.key);
    });

    const handle = document.createElement('div');
    handle.className = 'drag-handle';
    handle.setAttribute('data-drag-handle', '');
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
      App.setLocked(item.key, !locked);
    });

    const name = document.createElement('div');
    name.className = 'draft-name';
    name.textContent = item.name;

    const draftBtn = document.createElement('button');
    draftBtn.className = 'btn-draft' + (drafted ? ' is-drafted' : '');
    draftBtn.textContent = drafted ? 'Undraft' : 'Draft';
    draftBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      App.setDrafted(item.key, !drafted);
    });

    row.appendChild(handle);
    row.appendChild(badge);
    row.appendChild(lockBtn);
    row.appendChild(name);
    row.appendChild(draftBtn);
    return row;
  }

  global.DraftTab = { init, show, render };
})(window);
