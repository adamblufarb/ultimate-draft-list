/* Smart Search overlay: a structured, dropdown-driven deep search for the
   Draft List — "find a player whose [metric A] is [better/worse] than
   their [metric B] by at least [N] ranks". Metrics are Combined Rank
   (computed from whichever sources are currently checked in Draft List's
   own source filter) plus each individual source's own rank; the second
   dropdown's options always exclude whatever the first one is set to, so
   you can't compare a metric to itself. "Better"/"Worse" compares the
   metrics' rank numbers directly — a lower number is a better rank, same
   as everywhere else in the app.

   Saved Searches — a 2-column grid of tiles (same .stat-card style as
   Player Detail's source squares), one per App.state.savedSearches entry,
   plus a trailing "Add a Search" tile — sits above the criteria form.
   Tapping a tile loads that saved search's title and criteria into the
   form below (fully editable — lists, numbers, and title); tapping
   "Add a Search" clears the form for a new one. Giving the form a title
   and hitting Search both saves it (updating the tile you loaded it from,
   or adding a new one) and applies it; leaving the title blank runs it
   without saving, same as before this existed. Each tile also has its own
   ✕ to delete it.

   Same overlay chrome as the player detail view (backdrop, slide-up
   sheet, close on backdrop tap/Escape/✕), but its own self-contained
   form. Closing without hitting Search just discards whatever was being
   edited — it never runs a search, and never clears an already-active
   one (that's Draft List's own ✕ button, not this overlay's). */
(function (global) {
  let overlayEl = null;
  let closeHandler = hide;

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.className = 'detail-overlay';
    overlayEl.addEventListener('click', (e) => {
      if (e.target === overlayEl) closeHandler();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeHandler();
    });
    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  function hide() {
    if (overlayEl) overlayEl.classList.remove('open');
  }

  // metrics: [{ id, label }], id 'combined' plus one entry per source.
  // initial: a previously-run criteria object to pre-fill (Edit Search) —
  //   may itself carry { id, title } if it came from a saved search — or
  //   null for a blank form.
  // onSearch(criteria): called with { fieldA, direction, fieldB, threshold,
  //   [id, title] } once the user taps Search with valid inputs.
  function open(metrics, initial, onSearch) {
    const overlay = ensureOverlay();
    closeHandler = () => hide();

    overlay.innerHTML = '';
    const sheet = document.createElement('div');
    sheet.className = 'detail-sheet smart-search-sheet';

    const header = document.createElement('div');
    header.className = 'detail-header';
    const titleEl = document.createElement('h2');
    titleEl.className = 'detail-name';
    titleEl.textContent = 'Smart Search';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-link detail-close';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', () => closeHandler());
    header.appendChild(titleEl);
    header.appendChild(closeBtn);
    sheet.appendChild(header);

    const savedLabel = document.createElement('div');
    savedLabel.className = 'smart-search-label';
    savedLabel.textContent = 'Saved Searches';
    sheet.appendChild(savedLabel);

    const savedGrid = document.createElement('div');
    savedGrid.className = 'detail-stats smart-search-saved-grid';
    sheet.appendChild(savedGrid);

    const searchTitleInput = document.createElement('input');
    searchTitleInput.type = 'text';
    searchTitleInput.className = 'smart-search-title-input';
    searchTitleInput.placeholder = 'Search title (optional — saves it here)';
    sheet.appendChild(searchTitleInput);

    const promptLabel = document.createElement('div');
    promptLabel.className = 'smart-search-label';
    promptLabel.textContent = 'Find a player with';
    sheet.appendChild(promptLabel);

    const fieldASelect = document.createElement('select');
    fieldASelect.className = 'smart-search-select';
    sheet.appendChild(fieldASelect);

    const directionRow = document.createElement('div');
    directionRow.className = 'smart-search-toggle-row';
    const betterBtn = document.createElement('button');
    betterBtn.type = 'button';
    betterBtn.textContent = 'Better Than';
    const worseBtn = document.createElement('button');
    worseBtn.type = 'button';
    worseBtn.textContent = 'Worse Than';
    directionRow.appendChild(betterBtn);
    directionRow.appendChild(worseBtn);
    sheet.appendChild(directionRow);

    const fieldBSelect = document.createElement('select');
    fieldBSelect.className = 'smart-search-select';
    sheet.appendChild(fieldBSelect);

    const thresholdRow = document.createElement('div');
    thresholdRow.className = 'smart-search-threshold-row';
    const thresholdPrefix = document.createElement('span');
    thresholdPrefix.textContent = 'In at least';
    const thresholdInput = document.createElement('input');
    thresholdInput.type = 'number';
    thresholdInput.min = '1';
    thresholdInput.inputMode = 'numeric';
    thresholdInput.className = 'smart-search-threshold-input';
    const thresholdSuffix = document.createElement('span');
    thresholdSuffix.textContent = 'ranks.';
    thresholdRow.appendChild(thresholdPrefix);
    thresholdRow.appendChild(thresholdInput);
    thresholdRow.appendChild(thresholdSuffix);
    sheet.appendChild(thresholdRow);

    let fieldA = null;
    let direction = 'better';
    let fieldB = null;
    let editingId = null;

    function otherMetrics(excludeId) {
      return metrics.filter((m) => m.id !== excludeId);
    }

    function populateFieldA() {
      fieldASelect.innerHTML = '';
      metrics.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.label;
        if (m.id === fieldA) opt.selected = true;
        fieldASelect.appendChild(opt);
      });
    }

    function populateFieldB() {
      fieldBSelect.innerHTML = '';
      otherMetrics(fieldA).forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.label;
        if (m.id === fieldB) opt.selected = true;
        fieldBSelect.appendChild(opt);
      });
    }

    function updateDirectionButtons() {
      betterBtn.className = 'toggle-label' + (direction === 'better' ? ' is-active' : '');
      worseBtn.className = 'toggle-label' + (direction === 'worse' ? ' is-active' : '');
    }

    // Loads a saved search (or, for `null`, a blank form) into the fields —
    // used for the initial population and whenever a Saved Searches tile
    // (or "Add a Search") is tapped. Every field it sets stays fully
    // editable afterward.
    function loadIntoForm(saved) {
      editingId = saved ? saved.id : null;
      searchTitleInput.value = (saved && saved.title) || '';
      fieldA = (saved && saved.fieldA) || (metrics[0] && metrics[0].id) || null;
      direction = (saved && saved.direction) || 'better';
      fieldB = (saved && saved.fieldB) || null;
      if (!fieldB || fieldB === fieldA) {
        const opts = otherMetrics(fieldA);
        fieldB = opts[0] ? opts[0].id : null;
      }
      thresholdInput.value = String((saved && saved.threshold) || 10);
      populateFieldA();
      populateFieldB();
      updateDirectionButtons();
    }

    function renderSavedGrid() {
      savedGrid.innerHTML = '';
      App.state.savedSearches.forEach((saved) => {
        const tile = document.createElement('div');
        tile.className = 'stat-card stat-card-clickable smart-search-saved-tile';
        tile.addEventListener('click', () => loadIntoForm(saved));

        const titleDiv = document.createElement('div');
        titleDiv.className = 'smart-search-saved-title';
        titleDiv.textContent = saved.title;
        tile.appendChild(titleDiv);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'smart-search-saved-delete';
        deleteBtn.textContent = '✕';
        deleteBtn.setAttribute('aria-label', 'Delete "' + saved.title + '"');
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!confirm('Delete saved search "' + saved.title + '"?')) return;
          App.deleteSavedSearch(saved.id);
          if (editingId === saved.id) loadIntoForm(null);
          renderSavedGrid();
        });
        tile.appendChild(deleteBtn);

        savedGrid.appendChild(tile);
      });

      const addTile = document.createElement('button');
      addTile.type = 'button';
      addTile.className = 'stat-card stat-card-clickable smart-search-add-tile';
      addTile.textContent = '+ Add a Search';
      addTile.addEventListener('click', () => loadIntoForm(null));
      savedGrid.appendChild(addTile);
    }

    fieldASelect.addEventListener('change', () => {
      fieldA = fieldASelect.value;
      const opts = otherMetrics(fieldA);
      if (!opts.some((m) => m.id === fieldB)) {
        fieldB = opts[0] ? opts[0].id : null;
      }
      populateFieldB();
    });

    fieldBSelect.addEventListener('change', () => {
      fieldB = fieldBSelect.value;
    });

    betterBtn.addEventListener('click', () => {
      direction = 'better';
      updateDirectionButtons();
    });
    worseBtn.addEventListener('click', () => {
      direction = 'worse';
      updateDirectionButtons();
    });

    const searchBtn = document.createElement('button');
    searchBtn.className = 'btn btn-primary smart-search-submit';
    searchBtn.textContent = 'Search';
    searchBtn.addEventListener('click', () => {
      const n = parseInt(thresholdInput.value, 10);
      if (!fieldA || !fieldB || !n || n < 1) return;
      const title = searchTitleInput.value.trim();
      const criteria = { fieldA, direction, fieldB, threshold: n };
      if (title) {
        criteria.id = App.upsertSavedSearch({ id: editingId, title, fieldA, direction, fieldB, threshold: n });
        criteria.title = title;
      }
      hide();
      onSearch(criteria);
    });
    sheet.appendChild(searchBtn);

    renderSavedGrid();
    loadIntoForm(initial);

    overlay.appendChild(sheet);
    overlay.classList.add('open');
  }

  global.SmartSearch = { open };
})(window);
