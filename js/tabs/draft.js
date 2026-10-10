/* Tab 2 — Draft List: the user's own editable, drag-reorderable list.
   Initialized from the combined average once, then persists independently
   of source edits. Changing the source filter automatically resyncs the
   list to the newly-filtered average (no Reset button).
   Drafted players are hidden but keep their place in the full order so
   un-drafting puts them back where they were. "Lock List" freezes the
   order against filters: filter changes still update every combined rank
   but no longer reshuffle the list (rows can still be dragged by hand). Each position
   chip also shows how many of the next N undrafted picks hold that
   position (N chosen from the pool-size dropdown), flagging scarcity in
   orange/red as that count runs low relative to N. Smart Search (its own
   overlay, js/smartSearch.js) replaces the position filter's narrowing
   with a structured "metric A vs metric B, by at least N ranks" query
   while active; touching any of the quick filters (source, position)
   clears it, but tagging a player or the plain
   search box do not. Source chips can weight, not just toggle, a source
   (js/sourceWeights.js) — tapping a boostable "Average"-type source a 2nd
   time sets it to 1.5x, a 3rd time 2.5x (instead of the usual 1x), shown as a darker chip;
   "Total"-type sources start off by default. Each row also gets a health
   emoji computed from Season Stats (Sources tab) — 💪 for 65+ games in all
   3 seasons, 🚑 for 54-or-fewer games in at least 2 of them — and a trend
   emoji (⬆️/⬇️, App.getImprovementEmoji/getDeclineEmoji) for either 5+
   points in PTS/AST/STL/BLK/TRB/FT just last season, or a sustained
   2-year version (3+ points each year, with 2 of the same categories
   carrying both years) — either way, 2x a stat's minimum (or more) is
   worth 2 points, capped there so one huge single-stat swing can't
   qualify alone — both shown only here, not in the other lists. */
(function (global) {
  const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];
  const POOL_SIZE_OPTIONS = [10, 20, 30, 40, 50, 75, 100];
  let container;
  let listSection;
  let reorderable;
  // { [sourceId]: 0 | 1 | 1.5 | 2.5 } — see js/sourceWeights.js.
  let sourceWeights = {};
  // Iso mode ({ ids, saved }), set by long-pressing chips — see
  // js/sourceWeights.js.
  let iso = null;
  let selectedPositions = [];
  // Team abbreviations (from the Data List) the list is narrowed to; empty = all.
  let selectedTeams = [];
  let searchQuery = '';
  let searchInputEl;
  let searchClearBtn;
  let searchDebounceTimer = null;
  // How many of the best remaining (undrafted) picks each position count
  // is scoped to — e.g. 20 means "of the next 20 available players, how
  // many hold this position".
  let poolSize = 20;
  // { fieldA, direction, fieldB, threshold } from Smart Search, or null.
  let smartSearchCriteria = null;

  // Filters live only in memory, but a phone browser can discard and reload
  // the page whenever it's in the background — so they're mirrored into
  // UiState (this device only, never synced) on every render and restored
  // here. reconcileFilters() then drops anything that no longer exists.
  function saveFilters() {
    UiState.set('draftFilters', { sourceWeights, iso, selectedPositions, selectedTeams, poolSize, smartSearchCriteria });
  }

  function restoreFilters() {
    const saved = UiState.get('draftFilters', null);
    if (!saved) return;
    if (saved.sourceWeights && typeof saved.sourceWeights === 'object') sourceWeights = saved.sourceWeights;
    iso = saved.iso && Array.isArray(saved.iso.ids) && saved.iso.saved ? saved.iso : null;
    if (Array.isArray(saved.selectedPositions)) selectedPositions = saved.selectedPositions.filter((p) => POSITIONS.includes(p));
    if (Array.isArray(saved.selectedTeams)) selectedTeams = saved.selectedTeams.filter((t) => typeof t === 'string');
    if (POOL_SIZE_OPTIONS.includes(saved.poolSize)) poolSize = saved.poolSize;
    smartSearchCriteria = saved.smartSearchCriteria && typeof saved.smartSearchCriteria === 'object' ? saved.smartSearchCriteria : null;
  }

  function init(rootEl) {
    container = rootEl;
    sourceWeights = SourceWeights.defaultWeights(App.state.sources);
    restoreFilters();
    reconcileFilters();
    App.on('sources-changed', onSourcesChanged);
    App.on('drafted-changed', () => { if (isVisible()) render(); });
    // Tagging a player from the still-open player detail view fires this
    // repeatedly, and a full render() would reset scroll to the top each
    // time — update just that row's tags in place instead.
    App.on('tags-changed', (payload) => {
      if (!isVisible()) return;
      if (payload && payload.key) updateRowTags(payload.key);
      else render();
    });
    App.on('remote-state-loaded', () => {
      reconcileFilters();
      if (isVisible()) show();
    });
  }

  function isVisible() {
    return container && container.classList.contains('active');
  }

  function updateRowTags(key) {
    if (!container) return;
    const row = container.querySelector('.draft-row[data-key="' + CSS.escape(key) + '"]');
    if (!row) return;
    row.classList.toggle('is-pinned', App.isPinned(key));
    const existingBadge = row.querySelector('.player-tags');
    if (existingBadge) existingBadge.remove();
    const newBadge = playerTagsBadge(key);
    if (newBadge) row.appendChild(newBadge);
  }

  function reconcileFilters() {
    const r = SourceWeights.reconcileIso(sourceWeights, iso, App.state.sources);
    sourceWeights = r.weights;
    iso = r.iso;
  }

  function onSourcesChanged() {
    reconcileFilters();
    if (isVisible()) render();
  }

  function ensureInitialized() {
    if (App.state.draftOrder && App.state.draftOrder.length > 0) return;
    const defaultWeights = SourceWeights.defaultWeights(App.state.sources);
    App.state.draftOrder = Ranking.computeCombined(App.state.sources, defaultWeights)
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

  // Recomputes the whole order from the combined average over `weights`.
  function buildResetOrder(weights) {
    return Ranking.computeCombined(App.state.sources, weights)
      .map((r) => ({ key: r.key, name: r.displayName }));
  }

  // Called whenever the source filter changes: resyncs the order to the new
  // combined average — unless the list is locked, in which case the order
  // stays put (the combined ranks shown on each row still update).
  function resyncOrder() {
    if (App.state.listLocked) return;
    // Pinned players keep the slot (index in the full order) they hold now;
    // everyone else is re-sorted around them.
    const pins = new Set(App.state.pinnedKeys || []);
    const current = App.state.draftOrder || [];
    const held = [];
    current.forEach((item, i) => { if (pins.has(item.key)) held.push({ item, i }); });
    const rest = buildResetOrder(sourceWeights).filter((item) => !pins.has(item.key));
    held.forEach(({ item, i }) => { rest.splice(Math.min(i, rest.length), 0, item); });
    App.state.draftOrder = rest;
  }

  function show() {
    ensureInitialized();
    render();
  }

  function render() {
    clearTimeout(searchDebounceTimer);
    saveFilters();
    container.innerHTML = '';

    if (App.state.sources.length === 0 && (!App.state.draftOrder || App.state.draftOrder.length === 0)) {
      const empty = document.createElement('p');
      empty.className = 'empty-hint';
      empty.textContent = 'Add a data source, then come back here to build your draft list.';
      container.appendChild(empty);
      return;
    }

    container.appendChild(renderSearchBox());
    container.appendChild(renderSmartSearchRow());
    container.appendChild(renderSourceToggles());
    container.appendChild(renderPositionToggles());
    container.appendChild(renderTeamFilterRow());
    container.appendChild(renderActionsRow());

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
    const query = searchQuery.trim().toLowerCase();
    const smartMatches = smartSearchCriteria ? computeSmartSearchMatches(index, smartSearchCriteria) : null;
    const teamOf = selectedTeams.length > 0 ? teamByKey() : null;
    const visibleItems = fullOrder.filter((item) => {
      if (App.isDrafted(item.key)) return false;
      if (teamOf && !selectedTeams.includes(teamOf.get(item.key))) return false;
      if (smartMatches) {
        if (!smartMatches.has(item.key)) return false;
      } else if (selectedPositions.length > 0 && !matchesPositionFilter(item.key, index)) {
        return false;
      }
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
      } else if (smartMatches) {
        empty.textContent = 'No players match your Smart Search.';
      } else if (selectedTeams.length > 0) {
        empty.textContent = 'No players on the selected teams (a player\'s team comes from the Data List).';
      } else if (selectedPositions.length > 0) {
        empty.textContent = 'No players match the selected position filter.';
      } else {
        empty.textContent = 'All players have been drafted.';
      }
      listSection.appendChild(empty);
      return;
    }

    const listEl = document.createElement('div');
    listEl.className = 'draft-list';
    listSection.appendChild(listEl);

    const combined = Ranking.combineFromIndex(index, sourceWeights);
    const avgByKey = new Map(combined.map((row) => [row.key, row.avg]));

    reorderable = new ReorderableList(listEl, {
      gap: 6,
      renderRow: (item, i) => renderRow(item, i, avgByKey, index),
      dividerEvery: 10,
      renderDivider: (count) => renderListDivider(count),
      markers: nextPickMarkers(fullOrder, visibleItems),
      renderMarker: (label) => renderListDivider(label, true),
      onReorder: (newVisibleOrder) => {
        App.state.draftOrder = mergeReorder(App.state.draftOrder, newVisibleOrder);
        App.persist();
      }
    });
    reorderable.setItems(visibleItems);
  }

  function renderListDivider(count, isNextPick) {
    const el = document.createElement('div');
    el.className = 'list-divider' + (isNextPick ? ' list-divider-next-pick' : '');
    el.textContent = '— ' + (isNextPick ? 'Pick ' : '') + count + ' —';
    return el;
  }

  // Overall pick numbers of your turns still to come in a snake draft: odd
  // rounds go slot 1..N, even rounds reverse. "Still to come" means after
  // however many players are already marked drafted. Stops once a pick
  // is further out than there are players to draft.
  function upcomingPicks(limit) {
    const size = App.state.leagueSize;
    const slot = App.state.pickSlot;
    const taken = (App.state.draftedKeys || []).length;
    const picks = [];
    for (let round = 1; ; round++) {
      const pos = round % 2 === 1 ? slot : size - slot + 1;
      const pick = (round - 1) * size + pos;
      if (pick > limit) return picks;
      if (pick > taken) picks.push(pick);
    }
  }

  // Map of visible-row index -> label for the blue pick markers, empty when
  // the toggle is off. The players still ahead of a pick are the next
  // (pick - 1 - alreadyDrafted) undrafted ones in the full order, so its
  // marker goes right after the last of those — even with filters on, it
  // lands after however many of them are still showing. Picks that fall
  // past the end of the list get no marker, and picks that land on the
  // same row (only possible with filters) share one label: "Pick 18 · 23".
  function nextPickMarkers(fullOrder, visibleItems) {
    const markers = new Map();
    if (!App.state.showNextPick) return markers;
    const taken = (App.state.draftedKeys || []).length;
    const picks = upcomingPicks(taken + fullOrder.length + 1);
    let cutoff = 0;     // number of fullOrder entries before the marker
    let undrafted = 0;  // undrafted players among those
    let idx = 0;        // visible rows among those
    picks.forEach((pick) => {
      const ahead = pick - 1 - taken;
      while (cutoff < fullOrder.length && undrafted < ahead) {
        const item = fullOrder[cutoff];
        if (!App.isDrafted(item.key)) undrafted += 1;
        if (idx < visibleItems.length && visibleItems[idx].key === item.key) idx += 1;
        cutoff += 1;
      }
      if (undrafted < ahead || idx >= visibleItems.length) return;
      markers.set(idx, markers.has(idx) ? markers.get(idx) + ' · ' + pick : String(pick));
    });
    return markers;
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
  // For the next `size` undrafted players, per position: `main` = players
  // whose FIRST listed position it is ("PF, SF" = PF), and `effective` =
  // main + half of the players who have it as a secondary position (a dual
  // can only fill one slot, so he counts half at each of his positions
  // beyond the first). Shown as "PG 6 (7)": 6 main, 7 effective.
  function computeAvailablePositionCounts(index, size) {
    const combined = Ranking.combineFromIndex(index, sourceWeights);
    const available = combined.filter((row) => !App.isDrafted(row.key));
    const pool = available.slice(0, size);
    const main = {};
    const secondary = {};
    POSITIONS.forEach((p) => { main[p] = 0; secondary[p] = 0; });
    pool.forEach((row) => {
      const playerPositions = Lineup.parsePositions(row.positions);
      playerPositions.forEach((p, i) => {
        if (!POSITIONS.includes(p)) return;
        if (i === 0) main[p] += 1; else secondary[p] += 1;
      });
    });
    const effective = {};
    POSITIONS.forEach((p) => { effective[p] = main[p] + secondary[p] / 2; });
    return { main, effective };
  }

  // Resolves one player's "rank" for a given Smart Search metric id:
  // 'combined' is the same average the Combined Rank badges use (over the
  // currently checked List filter sources); anything else is that
  // player's literal rank on that specific source's list. Returns null if
  // the player isn't ranked under that metric at all (excluded from the
  // comparison, same as any other missing-data case elsewhere).
  function computeSmartSearchMatches(index, criteria) {
    const combined = Ranking.combineFromIndex(index, sourceWeights);
    const combinedByKey = new Map(combined.map((r) => [r.key, r.avg]));

    function valueFor(key, fieldId) {
      if (fieldId === 'combined') {
        return combinedByKey.has(key) ? combinedByKey.get(key) : null;
      }
      const entry = index.get(key);
      const bySource = entry && entry.bySource[fieldId];
      return bySource ? bySource.rank : null;
    }

    const matches = new Set();
    (App.state.draftOrder || []).forEach((item) => {
      const a = valueFor(item.key, criteria.fieldA);
      const b = valueFor(item.key, criteria.fieldB);
      if (a === null || b === null) return;
      // "Better" means a lower/better rank number — A at least `threshold`
      // ranks better than B means B's number exceeds A's by that much.
      const diff = criteria.direction === 'better' ? (b - a) : (a - b);
      if (diff >= criteria.threshold) matches.add(item.key);
    });
    return matches;
  }

  function openSmartSearch() {
    const metrics = [{ id: 'combined', label: 'Combined Rank' }]
      .concat(App.state.sources.map((s) => ({ id: s.id, label: s.name || 'Untitled source' })));
    SmartSearch.open(metrics, smartSearchCriteria, (criteria) => {
      smartSearchCriteria = criteria;
      render();
    });
  }

  function renderSmartSearchRow() {
    const wrap = document.createElement('div');
    wrap.className = 'source-toggles draft-actions-row';

    if (!smartSearchCriteria) {
      wrap.appendChild(renderToggleChip('Smart Search', false, openSmartSearch));
    } else {
      wrap.appendChild(renderToggleChip('Edit Search', true, openSmartSearch));
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'tag-toggle is-active';
      clearBtn.textContent = '✕';
      clearBtn.setAttribute('aria-label', 'Clear Smart Search');
      clearBtn.addEventListener('click', () => {
        smartSearchCriteria = null;
        render();
      });
      wrap.appendChild(clearBtn);
    }
    return wrap;
  }

  // Normalized player key -> current team abbreviation, from the Data List
  // (the only place a *current* team lives; Season Stats' team is last
  // season's). Players with no Data List entry/team have none.
  function teamByKey() {
    const map = new Map();
    App.state.dataList.players.forEach((p) => {
      const team = (p.team || '').trim().toUpperCase();
      if (team) map.set(NameMatch.normalize(p.name), team);
    });
    return map;
  }

  function openTeamFilter() {
    const info = new Map();
    teamByKey().forEach((team, key) => {
      if (!info.has(team)) info.set(team, { team, drafted: 0 });
      if (App.isDrafted(key)) info.get(team).drafted += 1;
    });
    const teams = Array.from(info.values()).sort((a, b) => a.team.localeCompare(b.team));
    const stillExists = (t) => info.has(t);
    TeamFilter.open(teams, selectedTeams.filter(stillExists), (picked) => {
      selectedTeams = picked;
      render();
    });
  }

  // Looks and works like the Smart Search row: one full-width chip that
  // opens a screen, and once something's applied turns blue (showing which
  // teams) with a ✕ beside it that clears the filter.
  function renderTeamFilterRow() {
    const wrap = document.createElement('div');
    wrap.className = 'source-toggles draft-actions-row';

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'toggle-label team-filter-chip' + (selectedTeams.length > 0 ? ' is-active' : '');
    const label = document.createElement('span');
    label.textContent = selectedTeams.length > 0 ? 'Teams: ' + selectedTeams.join(', ') : 'Team';
    chip.appendChild(label);
    chip.addEventListener('click', openTeamFilter);
    wrap.appendChild(chip);

    if (selectedTeams.length > 0) {
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'tag-toggle is-active';
      clearBtn.textContent = '✕';
      clearBtn.setAttribute('aria-label', 'Clear team filter');
      clearBtn.addEventListener('click', () => {
        selectedTeams = [];
        render();
      });
      wrap.appendChild(clearBtn);
    }
    return wrap;
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
      const count = counts.main[pos];
      const effective = counts.effective[pos];
      // Scarcity is judged on the effective count (main + half the duals) as a
      // share of the pool: 25%+ fine, 20-25% orange, under 20% red.
      const pct = poolSize > 0 ? (effective / poolSize) * 100 : 0;
      const scarcityClass = pct >= 25 ? '' : (pct >= 20 ? 'scarcity-warn' : 'scarcity-danger');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toggle-label' + (isActive ? ' is-active' : '') + (scarcityClass ? ' ' + scarcityClass : '');
      const posEl = document.createElement('span');
      posEl.textContent = pos;
      const countEl = document.createElement('span');
      countEl.className = 'position-chip-count';
      countEl.textContent = count + ' (' + (Math.round(effective * 10) / 10) + ')';
      btn.appendChild(posEl);
      btn.appendChild(countEl);
      btn.addEventListener('click', () => {
        smartSearchCriteria = null;
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

  function renderActionsRow() {
    const wrap = document.createElement('div');
    wrap.className = 'source-toggles list-actions-row';
    const locked = !!App.state.listLocked;
    wrap.appendChild(renderToggleChip('Lock List', locked, () => {
      App.state.listLocked = !locked;
      App.persist();
      render();
    }));
    const nextPickOn = !!App.state.showNextPick;
    const nextPickChip = renderToggleChip('Next Pick', nextPickOn, () => {
      App.state.showNextPick = !nextPickOn;
      App.persist();
      render();
    });
    nextPickChip.classList.add('toggle-next-pick');
    wrap.appendChild(nextPickChip);
    return wrap;
  }

  // Boostable ("Average"-type) sources cycle disabled -> 1x -> 1.5x -> 2.5x -> back
  // to disabled on tap; everything else just toggles 0/1 like before.
  // Boostable ("Average"-type) sources cycle disabled -> 1x -> 1.5x -> 2.5x
  // -> back to disabled on tap; everything else just toggles 0/1. A long
  // press isolates that source (iso mode; more long presses add more), and
  // a plain tap on an isolated one undoes it.
  function renderSourceToggles() {
    const wrap = document.createElement('div');
    wrap.className = 'source-toggles';
    App.state.sources.forEach((source) => {
      const weight = SourceWeights.getWeight(sourceWeights, source.id);
      const isolated = SourceWeights.isIso(iso, source.id);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toggle-label' + (weight > 0 ? ' is-active' : '') + SourceWeights.boostClass(weight, 'is-boosted') + (isolated ? ' is-iso' : '');
      btn.textContent = (source.name || 'Untitled source') + (isolated ? ' · iso' : SourceWeights.boostLabel(weight));
      const apply = (next) => {
        smartSearchCriteria = null;
        sourceWeights = next.weights;
        iso = next.iso;
        // Filters drive the reset computation directly now (no Reset
        // button) — changing which sources feed the average immediately
        // resyncs the whole list.
        resyncOrder();
        App.persist();
        render();
      };
      SourceWeights.attachPress(
        btn,
        () => apply(SourceWeights.tap({ weights: sourceWeights, iso }, source)),
        () => apply(SourceWeights.longPress({ weights: sourceWeights, iso }, source))
      );
      wrap.appendChild(btn);
    });
    return wrap;
  }

  function renderRow(item, _rowIndex, avgByKey, rankingIndex) {
    const drafted = App.isDrafted(item.key);
    const avg = avgByKey.get(item.key);
    const entry = rankingIndex.get(item.key);

    const row = document.createElement('div');
    row.className = 'draft-row' + (drafted ? ' is-drafted' : '');
    const openDetail = () => PlayerDetail.open(item.key, sourceWeights, (newWeights, newIso) => {
      sourceWeights = newWeights;
      iso = newIso;
      // Same auto-resync as tapping a source chip: the filter just changed,
      // so the list resyncs to the newly-filtered average.
      resyncOrder();
      App.persist();
      render();
    }, iso);
    // Tap opens the player; long press pins/unpins them in place (not from the drag handle).
    SourceWeights.attachPress(row, openDetail, () => App.togglePinned(item.key), '[data-drag-handle]');
    if (App.isPinned(item.key)) row.classList.add('is-pinned');

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
    const tagsBadge = playerTagsBadge(item.key);
    if (tagsBadge) row.appendChild(tagsBadge);
    return row;
  }

  // Breakout/sleeper/do-not-draft tags are only ever set from the player
  // detail view — list rows just display whatever's active, right-aligned.
  // The health and trend emoji (if any) always lead, ahead of the
  // user-set tags.
  function playerTagsBadge(key) {
    const parts = [];
    const healthEmoji = App.getHealthEmoji(key);
    if (healthEmoji) parts.push(healthEmoji);
    const improvementEmoji = App.getImprovementEmoji(key);
    if (improvementEmoji) parts.push(improvementEmoji);
    const declineEmoji = App.getDeclineEmoji(key);
    if (declineEmoji) parts.push(declineEmoji);
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

  global.DraftTab = { init, show, render };
})(window);
