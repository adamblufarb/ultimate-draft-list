/* Smart Search overlay: a structured, dropdown-driven deep search for the
   Draft List — "find a player whose [metric A] is [better/worse] than
   their [metric B] by at least [N] ranks". Metrics are Combined Rank
   (computed from whichever sources are currently checked in Draft List's
   own source filter) plus each individual source's own rank; the second
   dropdown's options always exclude whatever the first one is set to, so
   you can't compare a metric to itself. "Better"/"Worse" compares the
   metrics' rank numbers directly — a lower number is a better rank, same
   as everywhere else in the app.

   Two screens, both inside the same overlay:
   - The main "Smart Search" screen: a 2-column Saved Searches grid (same
     .stat-card style as Player Detail's source squares) — tapping a tile
     commits that saved search immediately (applies it and closes); its
     small ✏️ opens the edit screen for that one instead. A trailing
     "+ Add a Search" tile opens the edit screen blank. Below the grid
     sits the plain, untitled criteria form this had before Saved Searches
     existed — its own Search button just applies an ad-hoc, unsaved query.
   - The "New Search"/"Edit Search" screen: a title field up top, then the
     same criteria fields, then "Save Search" (saves — adding a new tile
     or updating the one you opened — and returns to the main screen) and,
     when editing an existing one, "Delete Search". Its own ✕ also just
     goes back to the main screen, not a full close.

   Same overlay chrome as the player detail view (backdrop, slide-up
   sheet, close on backdrop tap/Escape/✕ from the main screen), but its
   own self-contained form. Closing the whole thing without hitting the
   main screen's Search button just discards whatever was being edited —
   it never runs a search, and never clears an already-active one (that's
   Draft List's own ✕ button, not this overlay's). */
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

  // Builds the shared "Find a player with [A] [Better/Worse] [B] in at
  // least [N] ranks" field group, used by both screens. set(criteria)
  // pre-fills from a criteria/saved-search object (or null for defaults);
  // get() returns { fieldA, direction, fieldB, threshold } or null if the
  // threshold isn't a valid positive number.
  function buildCriteriaFields(metrics) {
    const wrap = document.createElement('div');
    wrap.className = 'smart-search-fields';

    const fieldASelect = document.createElement('select');
    fieldASelect.className = 'smart-search-select';
    wrap.appendChild(fieldASelect);

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
    wrap.appendChild(directionRow);

    const fieldBSelect = document.createElement('select');
    fieldBSelect.className = 'smart-search-select';
    wrap.appendChild(fieldBSelect);

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
    wrap.appendChild(thresholdRow);

    let fieldA = null;
    let direction = 'better';
    let fieldB = null;

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

    function set(criteria) {
      fieldA = (criteria && criteria.fieldA) || (metrics[0] && metrics[0].id) || null;
      direction = (criteria && criteria.direction) || 'better';
      fieldB = (criteria && criteria.fieldB) || null;
      if (!fieldB || fieldB === fieldA) {
        const opts = otherMetrics(fieldA);
        fieldB = opts[0] ? opts[0].id : null;
      }
      thresholdInput.value = String((criteria && criteria.threshold) || 10);
      populateFieldA();
      populateFieldB();
      updateDirectionButtons();
    }

    function get() {
      const n = parseInt(thresholdInput.value, 10);
      if (!fieldA || !fieldB || !n || n < 1) return null;
      return { fieldA, direction, fieldB, threshold: n };
    }

    return { el: wrap, get, set };
  }

  // metrics: [{ id, label }], id 'combined' plus one entry per source.
  // initial: a previously-run criteria object to pre-fill the main
  //   screen's ad-hoc form (Edit Search) — may itself carry { id, title }
  //   if it came from a saved search, though that's only used to seed the
  //   fields, not to open the edit screen — or null for defaults.
  // onSearch(criteria): called with { fieldA, direction, fieldB, threshold,
  //   [id, title] } once a search is committed, either via the main
  //   screen's own Search button or by tapping a saved search tile.
  function open(metrics, initial, onSearch) {
    const overlay = ensureOverlay();

    function showListView() {
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

      const grid = document.createElement('div');
      grid.className = 'detail-stats smart-search-saved-grid';
      App.state.savedSearches.forEach((saved) => {
        const tile = document.createElement('div');
        tile.className = 'stat-card stat-card-clickable smart-search-saved-tile';
        tile.addEventListener('click', () => {
          hide();
          onSearch({
            id: saved.id, title: saved.title, fieldA: saved.fieldA,
            direction: saved.direction, fieldB: saved.fieldB, threshold: saved.threshold
          });
        });

        const titleDiv = document.createElement('div');
        titleDiv.className = 'smart-search-saved-title';
        titleDiv.textContent = saved.title;
        tile.appendChild(titleDiv);

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'smart-search-saved-edit';
        editBtn.textContent = '✏️';
        editBtn.setAttribute('aria-label', 'Edit "' + saved.title + '"');
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          showEditView(saved);
        });
        tile.appendChild(editBtn);

        grid.appendChild(tile);
      });

      const addTile = document.createElement('button');
      addTile.type = 'button';
      addTile.className = 'stat-card stat-card-clickable smart-search-add-tile';
      addTile.textContent = '+ Add a Search';
      addTile.addEventListener('click', () => showEditView(null));
      grid.appendChild(addTile);
      sheet.appendChild(grid);

      const promptLabel = document.createElement('div');
      promptLabel.className = 'smart-search-label';
      promptLabel.textContent = 'Find a player with';
      sheet.appendChild(promptLabel);

      const fields = buildCriteriaFields(metrics);
      fields.set(initial);
      sheet.appendChild(fields.el);

      const searchBtn = document.createElement('button');
      searchBtn.className = 'btn btn-primary smart-search-submit';
      searchBtn.textContent = 'Search';
      searchBtn.addEventListener('click', () => {
        const criteria = fields.get();
        if (!criteria) return;
        hide();
        onSearch(criteria);
      });
      sheet.appendChild(searchBtn);

      overlay.appendChild(sheet);
      overlay.classList.add('open');
    }

    // saved: the entry being edited, or null when creating a new one.
    function showEditView(saved) {
      closeHandler = () => hide();
      overlay.innerHTML = '';
      const sheet = document.createElement('div');
      sheet.className = 'detail-sheet smart-search-sheet';

      const header = document.createElement('div');
      header.className = 'detail-header';
      const titleEl = document.createElement('h2');
      titleEl.className = 'detail-name';
      titleEl.textContent = saved ? 'Edit Search' : 'New Search';
      const backBtn = document.createElement('button');
      backBtn.className = 'btn-link detail-close';
      backBtn.textContent = '✕';
      backBtn.setAttribute('aria-label', 'Back to Saved Searches');
      backBtn.addEventListener('click', () => showListView());
      header.appendChild(titleEl);
      header.appendChild(backBtn);
      sheet.appendChild(header);

      const titleInput = document.createElement('input');
      titleInput.type = 'text';
      titleInput.className = 'smart-search-title-input';
      titleInput.placeholder = 'Search title';
      titleInput.value = (saved && saved.title) || '';
      sheet.appendChild(titleInput);

      const promptLabel = document.createElement('div');
      promptLabel.className = 'smart-search-label';
      promptLabel.textContent = 'Find a player with';
      sheet.appendChild(promptLabel);

      const fields = buildCriteriaFields(metrics);
      fields.set(saved);
      sheet.appendChild(fields.el);

      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn btn-primary smart-search-submit';
      saveBtn.textContent = 'Save Search';
      saveBtn.addEventListener('click', () => {
        const criteria = fields.get();
        const title = titleInput.value.trim();
        if (!criteria || !title) return;
        App.upsertSavedSearch(Object.assign({ id: saved ? saved.id : null, title }, criteria));
        showListView();
      });
      sheet.appendChild(saveBtn);

      if (saved) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-danger smart-search-delete-btn';
        deleteBtn.textContent = 'Delete Search';
        deleteBtn.addEventListener('click', () => {
          if (!confirm('Delete saved search "' + saved.title + '"?')) return;
          App.deleteSavedSearch(saved.id);
          showListView();
        });
        sheet.appendChild(deleteBtn);
      }

      overlay.appendChild(sheet);
      overlay.classList.add('open');
    }

    showListView();
  }

  global.SmartSearch = { open };
})(window);
