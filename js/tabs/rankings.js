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
      item.addEventListener('click', () => PlayerDetail.open(row.key, selectedIds));

      const rankBadge = document.createElement('div');
      rankBadge.className = 'rank-badge';
      rankBadge.textContent = row.avg.toFixed(1);

      const nameEl = document.createElement('div');
      nameEl.className = 'rank-name';
      nameEl.textContent = row.displayName;

      const draftBtn = document.createElement('button');
      draftBtn.className = 'btn-draft' + (drafted ? ' is-drafted' : '');
      draftBtn.textContent = drafted ? 'Undraft' : 'Draft';
      draftBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        App.setDrafted(row.key, !drafted);
      });

      item.appendChild(rankBadge);
      item.appendChild(nameEl);
      item.appendChild(draftBtn);
      wrap.appendChild(item);
    });

    return wrap;
  }

  global.RankingsTab = { init, render };
})(window);
