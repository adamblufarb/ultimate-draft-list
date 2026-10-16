/* Multiple drafts + the Settings screen.
   The top-level state fields (draftedKeys, myTeamKeys, pinnedKeys, draftOrder,
   pickSlot, leagueSize, listLocked, showNextPick, sources, selectedSourceIds)
   always belong to the ACTIVE draft, so the rest of the app is unchanged.
   Switching drafts stashes those fields into the draft being left
   (state.drafts[i].data; ranking lists go into state.sourcesBySeason[season],
   so drafts for the same season share them) and loads the target's.
   Ranking lists and the Data List belong to the season. Shared by every draft: Season Stats, tags, player notes, notes. */
(function (global) {
  const DRAFT_FIELDS = ['draftedKeys', 'myTeamKeys', 'pinnedKeys', 'draftOrder', 'pickSlot', 'leagueSize', 'listLocked', 'showNextPick', 'teamStructure', 'notes', 'playerNotes', 'breakoutLevels', 'sleeperLevels', 'targetKeys', 'doNotDraftKeys'];

  function st() { return App.state; }
  function active() { return st().drafts.find((d) => d.id === st().activeDraftId); }
  function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }

  function seasonFor(date) { const y = (date || new Date()).getFullYear(); return y + '-' + (y + 1); }

  function stash() {
    const s = st(); const d = active(); if (!d) return;
    d.data = {};
    DRAFT_FIELDS.forEach((k) => { d.data[k] = clone(s[k]); });
    s.sourcesBySeason[d.season] = { sources: s.sources, selectedSourceIds: s.selectedSourceIds, dataList: s.dataList };
  }

  function load(d) {
    const s = st(); const def = Storage.defaultState();
    DRAFT_FIELDS.forEach((k) => {
      s[k] = d.data && d.data[k] !== undefined ? clone(d.data[k]) : clone(def[k]);
    });
    const ss = s.sourcesBySeason[d.season];
    s.sources = ss ? ss.sources : [];
    s.selectedSourceIds = ss ? ss.selectedSourceIds : [];
    s.dataList = ss && ss.dataList ? ss.dataList : { rawText: '', players: [] };
    s.activeDraftId = d.id;
  }

  function reload() { App.persist(); App.emit('sources-changed'); App.emit('remote-state-loaded'); }

  function switchTo(id) {
    const s = st(); const d = s.drafts.find((x) => x.id === id);
    if (!d || id === s.activeDraftId) return;
    Backups.add(s, 'before-switch-draft');
    stash();
    load(d);
    reload();
  }

  function create(name, season, pickSlot, leagueSize, structure) {
    const s = st();
    Backups.add(s, 'before-new-draft');
    stash();
    const d = { id: 'draft_' + Date.now().toString(36), name, season, createdAt: Date.now(), data: { pickSlot, leagueSize, teamStructure: Lineup.normalizeStructure(structure) } };
    s.drafts.push(d);
    load(d);
    reload();
  }

  function edit(id, name, season, pickSlot, leagueSize, structure) {
    const s = st(); const d = s.drafts.find((x) => x.id === id); if (!d) return;
    const isActive = id === s.activeDraftId;
    if (isActive) {
      stash();
      d.name = name;
      d.data.pickSlot = pickSlot; d.data.leagueSize = leagueSize; d.data.teamStructure = Lineup.normalizeStructure(structure);
      if (season !== d.season) { d.season = season; load(d); } else { s.pickSlot = pickSlot; s.leagueSize = leagueSize; s.teamStructure = d.data.teamStructure; }
    } else {
      d.name = name; d.season = season; d.data = d.data || {};
      d.data.pickSlot = pickSlot; d.data.leagueSize = leagueSize; d.data.teamStructure = Lineup.normalizeStructure(structure);
    }
    reload();
  }

  function remove(id) {
    const s = st();
    if (s.drafts.length < 2) return;
    Backups.add(s, 'before-delete-draft');
    if (id === s.activeDraftId) {
      stash();
      const next = s.drafts.find((x) => x.id !== id);
      s.drafts = s.drafts.filter((x) => x.id !== id);
      load(next);
    } else {
      s.drafts = s.drafts.filter((x) => x.id !== id);
    }
    reload();
  }

  // ---- UI ----------------------------------------------------------------
  let overlayEl = null;
  function hide() { if (overlayEl) overlayEl.classList.remove('open'); }
  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.className = 'detail-overlay';
    overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) hide(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function sheetWithHeader(title, onClose) {
    const sheet = el('div', 'detail-sheet smart-search-sheet');
    const header = el('div', 'detail-header');
    header.appendChild(el('h2', 'detail-name', title));
    const x = el('button', 'btn-link detail-close', '✕');
    x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', onClose);
    header.appendChild(x);
    sheet.appendChild(header);
    return sheet;
  }

  function show(sheet) {
    const o = ensureOverlay();
    o.innerHTML = '';
    o.appendChild(sheet);
    o.classList.add('open');
  }

  function seasonOptions(current) {
    const y = new Date().getFullYear();
    const list = [];
    for (let i = y - 1; i <= y + 4; i++) list.push(i + '-' + (i + 1));
    if (current && list.indexOf(current) === -1) list.push(current);
    return list;
  }

  function showList() {
    const s = st();
    const sheet = sheetWithHeader('Settings', hide);
    sheet.appendChild(el('div', 'smart-search-label', 'Drafts'));
    const grid = el('div', 'detail-stats smart-search-saved-grid draft-grid');
    s.drafts.forEach((d) => {
      const isActive = d.id === s.activeDraftId;
      const tile = el('div', 'stat-card smart-search-saved-tile' + (isActive ? ' draft-active' : ''));
      tile.appendChild(el('div', 'smart-search-saved-title', d.name));
      tile.addEventListener('click', () => { if (!isActive) { switchTo(d.id); } showList(); });
      const pencil = el('button', 'smart-search-saved-edit', '✏️');
      pencil.setAttribute('aria-label', 'Edit ' + d.name);
      pencil.addEventListener('click', (e) => { e.stopPropagation(); showForm(d); });
      tile.appendChild(pencil);
      grid.appendChild(tile);
    });
    const add = el('div', 'stat-card smart-search-add-tile draft-new-tile', '+ New Draft');
    add.addEventListener('click', () => showForm(null));
    grid.appendChild(add);
    sheet.appendChild(grid);
    show(sheet);
  }

  function numberRow(label, value) {
    const row = el('div', 'smart-search-threshold-row');
    row.appendChild(el('span', null, label));
    const inp = el('input', 'smart-search-threshold-input');
    inp.type = 'number'; inp.inputMode = 'numeric'; inp.min = '1'; inp.value = String(value);
    row.appendChild(inp);
    return { row, inp };
  }

  function showStructure(structure, back) {
    const work = { slots: structure.slots.slice(), bench: structure.bench };
    const sheet = sheetWithHeader('Team Structure', () => back(work));
    sheet.appendChild(el('div', 'draft-tile-sub', 'Starting slots and bench spots on your team. G = PG/SG, F = SF/PF, PF/C = PF or C, UTIL = anyone.'));
    const listEl = el('div', 'structure-list');
    sheet.appendChild(listEl);
    const addRow = el('div', 'structure-add');
    const sel = el('select', 'smart-search-select');
    Lineup.SLOT_ORDER.forEach((p) => { const o = el('option', null, p); o.value = p; sel.appendChild(o); });
    const addBtn = el('button', 'btn btn-secondary', '+ Add Slot');
    addBtn.addEventListener('click', () => { work.slots.push(sel.value); draw(); });
    addRow.appendChild(sel); addRow.appendChild(addBtn);
    sheet.appendChild(addRow);
    const bench = numberRow('Bench spots', work.bench);
    bench.inp.min = '0';
    bench.inp.addEventListener('input', () => { const n = parseInt(bench.inp.value, 10); work.bench = n >= 0 ? n : 0; draw(true); });
    sheet.appendChild(bench.row);
    const total = el('div', 'draft-tile-sub');
    sheet.appendChild(total);
    const done = el('button', 'btn btn-primary smart-search-submit', 'Done');
    done.addEventListener('click', () => back(work));
    sheet.appendChild(done);
    function draw(totalOnly) {
      total.textContent = work.slots.length + ' starters + ' + work.bench + ' bench = ' + (work.slots.length + work.bench) + ' players';
      if (totalOnly) return;
      listEl.innerHTML = '';
      work.slots.forEach((label, i) => {
        const row = el('div', 'structure-row');
        row.appendChild(el('span', 'structure-label', label));
        const rm = el('button', 'btn btn-danger structure-remove', 'Remove');
        rm.addEventListener('click', () => { work.slots.splice(i, 1); draw(); });
        row.appendChild(rm);
        listEl.appendChild(row);
      });
    }
    draw();
    show(sheet);
  }

  let formDraft = null; // unsaved form values while the Team Structure screen is open

  function showForm(d, keep) {
    if (!keep) formDraft = null;
    const sheet = sheetWithHeader(d ? 'Edit Draft' : 'New Draft', showList);
    const fields = el('div', 'smart-search-fields');
    const name = el('input', 'smart-search-title-input');
    name.type = 'text'; name.placeholder = 'Name this draft'; name.value = formDraft ? formDraft.name : d ? d.name : '';
    fields.appendChild(name);

    fields.appendChild(el('div', 'smart-search-label', 'Season'));
    const sel = el('select', 'smart-search-select');
    const cur = formDraft ? formDraft.season : d ? d.season : seasonFor();
    seasonOptions(cur).forEach((o) => {
      const opt = el('option', null, o); opt.value = o; if (o === cur) opt.selected = true; sel.appendChild(opt);
    });
    fields.appendChild(sel);
    if (d) fields.appendChild(el('div', 'draft-tile-sub', 'Changing the season switches this draft to that season’s ranking lists.'));

    const data = d ? (d.id === st().activeDraftId ? st() : (d.data || {})) : {};
    const pick = numberRow('I pick number', formDraft ? formDraft.pick : data.pickSlot || 1);
    const teams = numberRow('Teams in the draft', formDraft ? formDraft.teams : data.leagueSize || 10);
    fields.appendChild(pick.row); fields.appendChild(teams.row);
    let structure = formDraft ? formDraft.structure : Lineup.normalizeStructure(data.teamStructure);
    const stBtn = el('button', 'btn btn-secondary', 'Team Structure');
    stBtn.addEventListener('click', () => {
      formDraft = { name: name.value, season: sel.value, pick: pick.inp.value, teams: teams.inp.value, structure };
      showStructure(structure, (next) => { formDraft.structure = next; showForm(d, true); });
    });
    fields.appendChild(stBtn);
    sheet.appendChild(fields);

    const err = el('div', 'draft-tile-sub');
    sheet.appendChild(err);
    const save = el('button', 'btn btn-primary smart-search-submit', d ? 'Save' : 'Create Draft');
    save.addEventListener('click', () => {
      const n = name.value.trim(); const p = parseInt(pick.inp.value, 10); const t = parseInt(teams.inp.value, 10);
      if (!n) { err.textContent = 'Give the draft a name.'; return; }
      if (!(t >= 2 && t <= 30) || !(p >= 1 && p <= t)) { err.textContent = 'Pick number must be between 1 and the number of teams.'; return; }
      if (d) edit(d.id, n, sel.value, p, t, structure); else create(n, sel.value, p, t, structure);
      formDraft = null;
      showList();
    });
    sheet.appendChild(save);
    if (d && st().drafts.length > 1) {
      const del = el('button', 'btn btn-danger smart-search-delete-btn', 'Delete Draft');
      del.addEventListener('click', () => {
        if (!confirm('Delete “' + d.name + '”? Its drafted players and My Team will be gone for good.')) return;
        remove(d.id);
        showList();
      });
      sheet.appendChild(del);
    }
    show(sheet);
    if (!d) setTimeout(() => name.focus(), 50);
  }

  function open() { showList(); }

  global.Drafts = { open, switchTo, create, edit, seasonFor, DRAFT_FIELDS };
})(window);
