/* Tab 3 — Sources: add/edit/delete up to MAX_SOURCES ranking sources, paste
   raw rankings, preview the parsed result, and save. Each source shows a
   read-only summary once saved; "Edit" switches it back to the full form.
   Also hosts the Data List — a single, separate paste-in list (name, age,
   optionally team and height) that never feeds any ranking; it's just
   extra info shown in the player detail view. And Season Stats — 3 fixed
   slots for uploading the last 3 seasons' per-game stats (as .xls files
   exported from Basketball-Reference, which are actually HTML tables under
   the hood — see Parser.parseSeasonStatsHtml), shown only via Player
   Detail's "Show Data" button, never part of any ranking. */
(function (global) {
  const MAX_SOURCES = Constants.MAX_SOURCES;
  let container;
  const editingIds = new Set();
  let dataListEditing = false;

  function init(rootEl) {
    container = rootEl;
    GithubSync.on('status-changed', updateSyncCard);
    App.on('remote-state-loaded', render);
    render();
  }

  function updateSyncCard() {
    const existing = container.querySelector('.sync-card');
    if (existing) existing.replaceWith(renderSyncCard());
  }

  function render() {
    container.innerHTML = '';
    container.appendChild(renderSyncCard());

    const list = document.createElement('div');
    list.className = 'source-list';
    App.state.sources.forEach((source) => {
      list.appendChild(editingIds.has(source.id) ? renderEditCard(source) : renderViewCard(source));
    });
    container.appendChild(list);

    const reorderCtl = CardReorder.attach(list, { gap: 14, onReorder: onSourcesReordered });
    Array.from(list.children).forEach((card) => {
      const handle = card.querySelector('[data-drag-handle]');
      if (handle) reorderCtl.attachHandle(handle, card);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-primary btn-add-source';
    addBtn.textContent = '+ Add Source';
    addBtn.disabled = App.state.sources.length >= MAX_SOURCES;
    if (App.state.sources.length >= MAX_SOURCES) {
      addBtn.style.display = 'none';
    }
    addBtn.addEventListener('click', onAddSource);
    container.appendChild(addBtn);

    if (App.state.sources.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-hint';
      empty.textContent = 'No sources yet. Add one and paste in a ranked player list.';
      container.insertBefore(empty, addBtn);
    }

    container.appendChild(dataListEditing ? renderDataListEditCard() : renderDataListViewCard());
    container.appendChild(renderSeasonStatsSection());
  }

  function onAddSource() {
    const source = { id: App.genId(), name: '', url: '', rawText: '', scoreType: 'none', players: [] };
    App.state.sources.push(source);
    editingIds.add(source.id);
    App.persist();
    render();
    App.emit('sources-changed');
  }

  function onSourcesReordered() {
    const list = container.querySelector('.source-list');
    const orderedIds = Array.from(list.children).map((el) => el.dataset.sourceId);
    const byId = new Map(App.state.sources.map((s) => [s.id, s]));
    App.state.sources = orderedIds.map((id) => byId.get(id)).filter(Boolean);
    App.persist();
    App.emit('sources-changed');
  }

  function createDragHandle() {
    const handle = document.createElement('div');
    handle.className = 'card-drag-handle';
    handle.setAttribute('data-drag-handle', '');
    handle.textContent = '☰';
    return handle;
  }

  const SYNC_STATUS_LABELS = {
    disconnected: 'Not connected — data stays on this device only.',
    loading: 'Loading your data from GitHub…',
    idle: 'Synced ✓',
    pending: 'Change pending…',
    syncing: 'Saving to GitHub…',
    error: 'Sync error'
  };

  function renderSyncCard() {
    const card = document.createElement('div');
    card.className = 'source-card sync-card';

    const title = document.createElement('div');
    title.className = 'source-view-name';
    title.textContent = 'GitHub Sync';
    card.appendChild(title);

    const { status, message } = GithubSync.getStatus();
    const statusEl = document.createElement('div');
    statusEl.className = 'sync-status sync-status-' + status;
    statusEl.textContent = status === 'error' && message
      ? `${SYNC_STATUS_LABELS.error}: ${message}`
      : SYNC_STATUS_LABELS[status] || status;
    card.appendChild(statusEl);

    if (GithubSync.isConnected()) {
      const desc = document.createElement('p');
      desc.className = 'source-view-meta';
      desc.textContent = 'Changes on this device save to the repo automatically and load on any device connected with a token.';
      card.appendChild(desc);

      const disconnectBtn = document.createElement('button');
      disconnectBtn.className = 'btn btn-danger';
      disconnectBtn.textContent = 'Disconnect';
      disconnectBtn.addEventListener('click', () => {
        if (!confirm('Disconnect GitHub sync on this device? Your data stays as-is in the repo and in local storage here.')) return;
        GithubSync.setToken('');
        render();
      });
      card.appendChild(disconnectBtn);
    } else {
      const label = document.createElement('label');
      label.textContent = 'GitHub Personal Access Token';
      const input = document.createElement('input');
      input.type = 'password';
      input.placeholder = 'github_pat_...';
      input.className = 'input-token';

      const hint = document.createElement('p');
      hint.className = 'paste-hint';
      hint.innerHTML = 'Create a <a href="https://github.com/settings/personal-access-tokens/new" ' +
        'target="_blank" rel="noopener noreferrer">fine-grained token</a> scoped to only the ' +
        '<strong>adamblufarb/ultimate-draft-list</strong> repo, with <strong>Contents: Read and write</strong> ' +
        'permission. It\'s stored only in this browser — never written into the code.';

      const connectBtn = document.createElement('button');
      connectBtn.className = 'btn btn-primary';
      connectBtn.textContent = 'Connect';
      connectBtn.addEventListener('click', async () => {
        const token = input.value.trim();
        if (!token) return;
        GithubSync.setToken(token);
        render();
        const remote = await GithubSync.fetchRemote();
        if (remote) {
          Object.assign(App.state, remote);
          Storage.save(App.state);
          App.emit('remote-state-loaded');
        } else {
          App.persist();
        }
        render();
      });

      card.appendChild(label);
      card.appendChild(input);
      card.appendChild(hint);
      card.appendChild(connectBtn);
    }

    return card;
  }

  function renderViewCard(source) {
    const card = document.createElement('div');
    card.className = 'source-card source-card-view';
    card.dataset.sourceId = source.id;
    card.appendChild(createDragHandle());

    const nameEl = document.createElement('div');
    nameEl.className = 'source-view-name';
    nameEl.textContent = source.name || 'Untitled source';
    card.appendChild(nameEl);

    if (source.scoreType && source.scoreType !== 'none') {
      const scoreLine = document.createElement('div');
      scoreLine.className = 'source-view-meta';
      scoreLine.textContent = Constants.scoreTypeLabel(source.scoreType);
      card.appendChild(scoreLine);
    }

    if (source.url) {
      const urlLink = document.createElement('a');
      urlLink.href = source.url;
      urlLink.target = '_blank';
      urlLink.rel = 'noopener noreferrer';
      urlLink.className = 'source-url-link';
      urlLink.textContent = 'Open reference link ↗';
      card.appendChild(urlLink);
    }

    const countLine = document.createElement('div');
    countLine.className = 'source-view-meta';
    const count = source.players.length;
    countLine.textContent = `${count} player${count === 1 ? '' : 's'} parsed`;
    card.appendChild(countLine);

    const actions = document.createElement('div');
    actions.className = 'source-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-secondary';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      editingIds.add(source.id);
      render();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      if (!confirm(`Delete source "${source.name || 'Untitled source'}"? This cannot be undone.`)) return;
      App.state.sources = App.state.sources.filter((s) => s.id !== source.id);
      editingIds.delete(source.id);
      App.persist();
      render();
      App.emit('sources-changed');
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    card.appendChild(actions);

    return card;
  }

  function renderEditCard(source) {
    const wasAlreadySaved = !!source.name || source.players.length > 0;
    const card = document.createElement('div');
    card.className = 'source-card';
    card.dataset.sourceId = source.id;
    card.appendChild(createDragHandle());

    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Source name';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'e.g. ESPN, my own list...';
    nameInput.value = source.name;
    nameInput.className = 'input-name';

    const urlLabel = document.createElement('label');
    urlLabel.textContent = 'Reference URL (optional, not fetched)';
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.placeholder = 'https://...';
    urlInput.value = source.url || '';
    urlInput.className = 'input-url';

    let urlLink = null;
    if (source.url) {
      urlLink = document.createElement('a');
      urlLink.href = source.url;
      urlLink.target = '_blank';
      urlLink.rel = 'noopener noreferrer';
      urlLink.className = 'source-url-link';
      urlLink.textContent = 'Open reference link ↗';
    }

    const scoreLabel = document.createElement('label');
    scoreLabel.textContent = 'What does the Score line mean? (if included)';
    const scoreSelect = document.createElement('select');
    scoreSelect.className = 'input-score-type';
    Constants.SCORE_TYPES.forEach((opt) => {
      const optionEl = document.createElement('option');
      optionEl.value = opt.value;
      optionEl.textContent = opt.label;
      scoreSelect.appendChild(optionEl);
    });
    scoreSelect.value = source.scoreType || 'none';

    const pasteLabel = document.createElement('label');
    pasteLabel.textContent = 'Paste ranked player list';
    const pasteHint = document.createElement('p');
    pasteHint.className = 'paste-hint';
    pasteHint.textContent = 'One player per block, separated by a blank line: Rank, then Player Name, ' +
      'then optionally Positions and/or Score, each on their own line.';
    const textarea = document.createElement('textarea');
    textarea.rows = 8;
    textarea.placeholder = '4\nLeBron James\nPF, SF\n57.2\n\n5\nNikola Jokic\nC\n56';
    textarea.value = source.rawText || '';

    const previewWrap = document.createElement('div');
    previewWrap.className = 'preview-wrap';

    const warningsWrap = document.createElement('div');
    warningsWrap.className = 'preview-warnings';

    function refreshPreview() {
      const { entries, warnings } = Parser.parseRankings(textarea.value);
      previewWrap.innerHTML = '';
      const heading = document.createElement('div');
      heading.className = 'preview-heading';
      heading.textContent = `Parsed ${entries.length} player${entries.length === 1 ? '' : 's'}`;
      previewWrap.appendChild(heading);

      if (entries.length > 0) {
        const table = document.createElement('table');
        table.className = 'preview-table';
        const tbody = document.createElement('tbody');
        entries.slice(0, 500).forEach((e) => {
          const tr = document.createElement('tr');
          const tdRank = document.createElement('td');
          tdRank.textContent = e.rank;
          const tdName = document.createElement('td');
          tdName.textContent = e.name;
          const tdPositions = document.createElement('td');
          tdPositions.className = 'preview-secondary';
          tdPositions.textContent = e.positions || '—';
          const tdScore = document.createElement('td');
          tdScore.className = 'preview-secondary';
          tdScore.textContent = e.score !== null ? Constants.formatScore(e.score) : '—';
          tr.appendChild(tdRank);
          tr.appendChild(tdName);
          tr.appendChild(tdPositions);
          tr.appendChild(tdScore);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        previewWrap.appendChild(table);
      }

      warningsWrap.innerHTML = '';
      warnings.forEach((w) => {
        const p = document.createElement('p');
        p.className = 'warning';
        p.textContent = w;
        warningsWrap.appendChild(p);
      });
    }

    let debounceTimer = null;
    textarea.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(refreshPreview, 150);
    });

    const actions = document.createElement('div');
    actions.className = 'source-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
      const { entries } = Parser.parseRankings(textarea.value);
      source.name = nameInput.value.trim() || 'Untitled source';
      source.url = urlInput.value.trim();
      source.scoreType = scoreSelect.value;
      source.rawText = textarea.value;
      source.players = entries.map((e) => ({ rank: e.rank, name: e.name, positions: e.positions, score: e.score }));
      editingIds.delete(source.id);
      App.persist();
      render();
      App.emit('sources-changed');
    });

    actions.appendChild(saveBtn);

    if (wasAlreadySaved) {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn btn-secondary';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => {
        editingIds.delete(source.id);
        render();
      });
      actions.appendChild(cancelBtn);
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      if (!confirm(`Delete source "${source.name || 'Untitled source'}"? This cannot be undone.`)) return;
      App.state.sources = App.state.sources.filter((s) => s.id !== source.id);
      editingIds.delete(source.id);
      App.persist();
      render();
      App.emit('sources-changed');
    });
    actions.appendChild(deleteBtn);

    card.appendChild(nameLabel);
    card.appendChild(nameInput);
    card.appendChild(urlLabel);
    card.appendChild(urlInput);
    if (urlLink) card.appendChild(urlLink);
    card.appendChild(scoreLabel);
    card.appendChild(scoreSelect);
    card.appendChild(pasteLabel);
    card.appendChild(pasteHint);
    card.appendChild(textarea);
    card.appendChild(warningsWrap);
    card.appendChild(previewWrap);
    card.appendChild(actions);

    refreshPreview();
    return card;
  }

  // Data List: not a ranking source — never feeds any combined average or
  // the per-source filter/grid. Just extra per-player info (currently:
  // age) looked up by name and shown only in the player detail view. A
  // single fixed list (unlike Sources, there's only ever one), so no
  // add/delete/reorder — just edit its paste text in place.
  function renderDataListViewCard() {
    const card = document.createElement('div');
    card.className = 'source-card source-card-view';

    const nameEl = document.createElement('div');
    nameEl.className = 'source-view-name';
    nameEl.textContent = 'Data List';
    card.appendChild(nameEl);

    const desc = document.createElement('p');
    desc.className = 'source-view-meta';
    desc.textContent = 'Extra per-player info (age, team) shown in Player Detail — never used in any ranking.';
    card.appendChild(desc);

    const countLine = document.createElement('div');
    countLine.className = 'source-view-meta';
    const count = App.state.dataList.players.length;
    countLine.textContent = `${count} player${count === 1 ? '' : 's'} parsed`;
    card.appendChild(countLine);

    const actions = document.createElement('div');
    actions.className = 'source-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-secondary';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      dataListEditing = true;
      render();
    });
    actions.appendChild(editBtn);
    card.appendChild(actions);

    return card;
  }

  function renderDataListEditCard() {
    const card = document.createElement('div');
    card.className = 'source-card';

    const nameEl = document.createElement('div');
    nameEl.className = 'source-view-name';
    nameEl.textContent = 'Data List';
    card.appendChild(nameEl);

    const desc = document.createElement('p');
    desc.className = 'source-view-meta';
    desc.textContent = 'Extra per-player info (age, team) shown in Player Detail — never used in any ranking.';
    card.appendChild(desc);

    const pasteLabel = document.createElement('label');
    pasteLabel.textContent = 'Paste player list';
    const pasteHint = document.createElement('p');
    pasteHint.className = 'paste-hint';
    pasteHint.textContent = 'One player per block, separated by a blank line: Player Name, Age, Team (optional), Height (optional).';
    const textarea = document.createElement('textarea');
    textarea.rows = 8;
    textarea.placeholder = 'Santi Aldama\n25\nDAL\n7\'0"\n\nNikola Jokic\n30\nDEN\n6\'11"';
    textarea.value = App.state.dataList.rawText || '';

    const previewWrap = document.createElement('div');
    previewWrap.className = 'preview-wrap';
    const warningsWrap = document.createElement('div');
    warningsWrap.className = 'preview-warnings';

    function refreshPreview() {
      const { entries, warnings } = Parser.parseDataList(textarea.value);
      previewWrap.innerHTML = '';
      const heading = document.createElement('div');
      heading.className = 'preview-heading';
      heading.textContent = `Parsed ${entries.length} player${entries.length === 1 ? '' : 's'}`;
      previewWrap.appendChild(heading);

      if (entries.length > 0) {
        const table = document.createElement('table');
        table.className = 'preview-table';
        const tbody = document.createElement('tbody');
        entries.slice(0, 500).forEach((e) => {
          const tr = document.createElement('tr');
          const tdName = document.createElement('td');
          tdName.textContent = e.name;
          const tdAge = document.createElement('td');
          tdAge.className = 'preview-secondary';
          tdAge.textContent = e.age;
          const tdTeam = document.createElement('td');
          tdTeam.className = 'preview-secondary';
          tdTeam.textContent = e.team || '—';
          tr.appendChild(tdName);
          tr.appendChild(tdAge);
          tr.appendChild(tdTeam);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        previewWrap.appendChild(table);
      }

      warningsWrap.innerHTML = '';
      warnings.forEach((w) => {
        const p = document.createElement('p');
        p.className = 'warning';
        p.textContent = w;
        warningsWrap.appendChild(p);
      });
    }

    let debounceTimer = null;
    textarea.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(refreshPreview, 150);
    });

    const actions = document.createElement('div');
    actions.className = 'source-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
      const { entries } = Parser.parseDataList(textarea.value);
      App.state.dataList.rawText = textarea.value;
      App.state.dataList.players = entries;
      dataListEditing = false;
      App.persist();
      render();
    });
    actions.appendChild(saveBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      dataListEditing = false;
      render();
    });
    actions.appendChild(cancelBtn);

    card.appendChild(pasteLabel);
    card.appendChild(pasteHint);
    card.appendChild(textarea);
    card.appendChild(warningsWrap);
    card.appendChild(previewWrap);
    card.appendChild(actions);

    refreshPreview();
    return card;
  }

  // Season Stats: 3 fixed upload slots (unlike Sources, count is fixed and
  // there's no add/reorder), most-recent season first. Each slot is always
  // shown editable in place — there's no separate view/edit toggle, since
  // there's no large paste text to hide; the file input plus a compact
  // status line ("482 players parsed from 25-26.xls") is the whole card.
  function renderSeasonStatsSection() {
    const wrap = document.createElement('div');
    wrap.className = 'season-stats-section';

    const heading = document.createElement('div');
    heading.className = 'source-view-name';
    heading.textContent = 'Season Stats';
    wrap.appendChild(heading);

    const desc = document.createElement('p');
    desc.className = 'source-view-meta';
    desc.textContent = 'Upload the last 3 seasons of per-game stats (.xls export from Basketball-Reference) ' +
      'to show in Player Detail\'s "Show Data" view. Never used in any ranking.';
    wrap.appendChild(desc);

    App.state.seasonStats.forEach((slot, i) => {
      wrap.appendChild(renderSeasonStatsCard(slot, i));
    });

    return wrap;
  }

  function renderSeasonStatsCard(slot, i) {
    const card = document.createElement('div');
    card.className = 'source-card source-card-view season-stats-card';

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'input-name';
    labelInput.placeholder = 'e.g. 2025-26';
    labelInput.value = slot.label || '';
    labelInput.addEventListener('change', () => {
      App.state.seasonStats[i].label = labelInput.value.trim();
      App.persist();
    });
    card.appendChild(labelInput);

    const statusLine = document.createElement('div');
    statusLine.className = 'source-view-meta';
    statusLine.textContent = slot.players.length > 0
      ? `${slot.players.length} player${slot.players.length === 1 ? '' : 's'} parsed from ${slot.fileName}`
      : 'No file uploaded yet.';
    card.appendChild(statusLine);

    const warningsWrap = document.createElement('div');
    warningsWrap.className = 'preview-warnings';
    card.appendChild(warningsWrap);

    const actions = document.createElement('div');
    actions.className = 'source-actions';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xls,.xlsx,.htm,.html';
    fileInput.className = 'season-stats-file-input';
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const { columns, players, warnings } = Parser.parseSeasonStatsHtml(String(reader.result));
        warningsWrap.innerHTML = '';
        warnings.forEach((w) => {
          const p = document.createElement('p');
          p.className = 'warning';
          p.textContent = w;
          warningsWrap.appendChild(p);
        });
        if (players.length === 0) return;
        if (!labelInput.value.trim()) {
          labelInput.value = file.name.replace(/\.[^/.]+$/, '');
        }
        App.state.seasonStats[i] = {
          label: labelInput.value.trim(),
          fileName: file.name,
          columns,
          players
        };
        App.persist();
        render();
      };
      reader.readAsText(file);
    });
    actions.appendChild(fileInput);

    if (slot.players.length > 0) {
      const clearBtn = document.createElement('button');
      clearBtn.className = 'btn btn-danger';
      clearBtn.textContent = 'Clear';
      clearBtn.addEventListener('click', () => {
        if (!confirm(`Clear uploaded data for "${slot.label || 'this season'}"?`)) return;
        App.state.seasonStats[i] = { label: slot.label, fileName: '', columns: [], players: [] };
        App.persist();
        render();
      });
      actions.appendChild(clearBtn);
    }

    card.appendChild(actions);
    return card;
  }

  global.SourcesTab = { init, render };
})(window);
