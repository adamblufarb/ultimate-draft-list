/* Tab 3 — Draft Board: every player marked drafted (by any means —
   "Mark Drafted" or "Drafted By Me"), in the order they were drafted.
   The order is the record of the draft (and the single source of truth for
   pick numbers everywhere); it can be corrected with "Edit Draft" at the
   bottom — drag players into the right order, then Save or Cancel. There
   are no filters: the combined rank next to each name
   always uses the default source weights. Each entry shows its overall
   pick number to the left of the card, picks you made yourself (My Team)
   are blue, and a "Round N" divider (a round being one pick per team —
   App.state.leagueSize picks) starts each round. */
(function (global) {
  let container;
  // "Edit Draft" mode: `pending` is the order being edited (keys), not saved
  // until Save.
  let editing = false;
  let pending = null;
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
      editing = false;
      pending = null;
      const empty = document.createElement('p');
      empty.className = 'empty-hint';
      empty.textContent = 'No players drafted yet. Mark a player drafted from their detail view to see them here.';
      container.appendChild(empty);
      return;
    }

    const index = Ranking.buildIndex(App.state.sources);
    const combined = Ranking.combineFromIndex(index, SourceWeights.defaultWeights(App.state.sources));
    const avgByKey = new Map(combined.map((row) => [row.key, row.avg]));

    if (editing) {
      renderEditMode(draftedKeys, avgByKey, index);
      return;
    }
    container.appendChild(renderList(draftedKeys, avgByKey, index));
    container.appendChild(renderOnTheClock(draftedKeys.length + 1));
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-secondary board-edit-btn';
    editBtn.textContent = 'Edit Draft';
    editBtn.addEventListener('click', () => {
      editing = true;
      pending = draftedKeys.slice();
      render();
    });
    container.appendChild(editBtn);
  }

  // The pick that is up next, as a dotted placeholder under the last pick —
  // so the Board's numbering and the Draft List's "Pick N" markers agree.
  function renderOnTheClock(pickNumber) {
    const entry = document.createElement('div');
    entry.className = 'board-entry';
    const num = document.createElement('div');
    num.className = 'board-pick-number';
    num.textContent = String(pickNumber);
    const card = document.createElement('div');
    card.className = 'rank-row lineup-empty';
    const ghost = document.createElement('div');
    ghost.className = 'rank-badge';
    ghost.style.visibility = 'hidden';
    ghost.style.width = '0';
    ghost.style.minWidth = '0';
    ghost.style.padding = '0';
    ghost.textContent = '0.0';
    const text = document.createElement('span');
    text.textContent = 'On the clock';
    card.appendChild(ghost);
    card.appendChild(text);
    entry.appendChild(num);
    entry.appendChild(card);
    return entry;
  }

  // Edit Draft: the picks as a drag-to-reorder list (same drag handles as
  // Draft List), with round dividers; Save writes the new order, Cancel
  // throws it away.
  function renderEditMode(draftedKeys, avgByKey, index) {
    // Keep the order being edited, but follow picks added/removed meanwhile.
    pending = (pending || []).filter((k) => draftedKeys.includes(k));
    draftedKeys.forEach((k) => { if (!pending.includes(k)) pending.push(k); });

    const hint = document.createElement('p');
    hint.className = 'source-view-meta';
    hint.textContent = 'Drag players by their handle into the right order, then Save.';
    container.appendChild(hint);

    const listEl = document.createElement('div');
    listEl.className = 'draft-list';
    container.appendChild(listEl);
    const size = App.state.leagueSize;
    const items = pending.map((key) => {
      const entry = index.get(key);
      return { key, name: entry ? entry.displayName : key };
    });
    const reorderable = new ReorderableList(listEl, {
      gap: 6,
      renderRow: (item) => renderEditRow(item, avgByKey, index),
      dividerEvery: size,
      renderDivider: (i) => renderRoundDivider(Math.floor(i / size) + 1),
      onReorder: (newItems) => { pending = newItems.map((it) => it.key); }
    });
    reorderable.setItems(items);

    const actions = document.createElement('div');
    actions.className = 'source-actions board-edit-actions';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn btn-primary';
    save.textContent = 'Save';
    save.addEventListener('click', () => {
      App.reorderDrafted(pending);
      editing = false;
      pending = null;
      render();
    });
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-secondary';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      editing = false;
      pending = null;
      render();
    });
    actions.appendChild(save);
    actions.appendChild(cancel);
    container.appendChild(actions);
  }

  function renderEditRow(item, avgByKey, index) {
    const entry = index.get(item.key);
    const avg = avgByKey.get(item.key);
    const row = document.createElement('div');
    row.className = 'draft-row' + (App.isOnMyTeam(item.key) ? ' is-mine' : '');

    const handle = document.createElement('div');
    handle.className = 'drag-handle';
    handle.setAttribute('data-drag-handle', '');
    handle.textContent = '☰';

    const badge = document.createElement('div');
    badge.className = 'rank-badge';
    badge.textContent = avg !== undefined ? avg.toFixed(1) : '—';

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
    row.appendChild(name);
    return row;
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
