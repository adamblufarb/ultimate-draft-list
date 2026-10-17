/* Central app state + a tiny pub/sub bus so tabs can react to each other
   without being tightly coupled. State is the single source of truth and
   is persisted to localStorage on every mutation, and — when a GitHub sync
   token is configured on this device — pushed (debounced) to the repo too. */
(function (global) {
  const state = Storage.load();
  const listeners = {};

  function on(event, cb) {
    (listeners[event] = listeners[event] || []).push(cb);
  }

  // 'sources-changed' and 'remote-state-loaded' are the two events every
  // add/edit/delete/reorder and remote-sync path already emits whenever
  // sources' content changes — the single choke point for invalidating
  // Ranking's index cache, so no individual call site has to remember to.
  function emit(event, payload) {
    if (event === 'sources-changed' || event === 'remote-state-loaded') {
      Ranking.invalidateIndexCache();
    }
    (listeners[event] || []).forEach((cb) => cb(payload));
  }

  function persist() {
    const teamChanged = syncMyTeam();
    Storage.save(state);
    GithubSync.scheduleSync();
    if (teamChanged) emit('my-team-changed', {});
  }

  function genId() {
    return 'src_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function isDrafted(key) {
    return state.draftedKeys.includes(key);
  }

  function setDrafted(key, drafted) {
    const set = new Set(state.draftedKeys);
    if (drafted) set.add(key); else set.delete(key);
    state.draftedKeys = Array.from(set);
    if (drafted && (state.pinnedKeys || []).includes(key)) state.pinnedKeys = state.pinnedKeys.filter((k) => k !== key); // drafting releases a pin
    // Undrafting (e.g. via the plain "Undraft" button, not "Remove from My
    // Team") puts the player back on the board — they can't simultaneously
    // be "available" and "on my roster", so drop them from My Team too.
    if (!drafted && state.myTeamKeys.includes(key)) {
      state.myTeamKeys = state.myTeamKeys.filter((k) => k !== key);
      emit('my-team-changed', { key, onTeam: false });
    }
    persist();
    emit('drafted-changed', { key, drafted });
  }

  function isOnMyTeam(key) {
    return state.myTeamKeys.includes(key);
  }

  // Marks a player drafted (if not already) and appends them to My Team, in
  // pick order. Idempotent.
  // Is the pick on the clock right now one of mine? The next overall pick is
  // (players drafted + 1); in a snake draft odd rounds run slot 1..N and even
  // rounds run N..1, and pickSlot is my slot in round 1.
  // Rounds normally snake: odd rounds run slot 1..N, even rounds N..1; a round
  // listed in state.reversedRounds runs the other way instead.
  function roundRunsBackwards(round) {
    return (round % 2 === 0) !== (state.reversedRounds || []).includes(round);
  }

  function myPositionInRound(round) {
    return roundRunsBackwards(round) ? state.leagueSize - state.pickSlot + 1 : state.pickSlot;
  }

  // Every team fills the roster (starters + bench), so that many rounds.
  function totalRounds() {
    const st = Lineup.normalizeStructure(state.teamStructure);
    return st.slots.length + st.bench;
  }

  function isDraftOver() {
    return state.draftedKeys.length >= state.leagueSize * totalRounds();
  }

  // Which team (its slot in round 1, 1..N) makes overall pick number i
  // (0-based) — follows the draft's snake and any reversed rounds.
  function pickOwner(i) {
    const size = state.leagueSize;
    const round = Math.floor(i / size) + 1;
    const position = (i % size) + 1;
    return roundRunsBackwards(round) ? size - position + 1 : position;
  }

  // Players drafted by the team in `slot`, in pick order.
  function teamKeys(slot) {
    return state.draftedKeys.filter((k, i) => pickOwner(i) === slot);
  }

  // The team on the clock (slot), or null once the draft is over.
  function teamOnTheClock() {
    return isDraftOver() ? null : pickOwner(state.draftedKeys.length);
  }

  // My Team is whoever the draft position says I picked, so changing the
  // reversed rounds / pick number / team count re-assigns every pick.
  function syncMyTeam() {
    const next = teamKeys(state.pickSlot);
    const same = next.length === state.myTeamKeys.length && next.every((k, i) => k === state.myTeamKeys[i]);
    if (!same) state.myTeamKeys = next;
    return !same;
  }

  function isMyPickOnTheClock() {
    if (isDraftOver()) return false;
    const size = state.leagueSize;
    const pick = state.draftedKeys.length + 1;
    const round = Math.floor((pick - 1) / size) + 1;
    return pick - (round - 1) * size === myPositionInRound(round);
  }

  function draftedByMe(key) {
    if (!state.draftedKeys.includes(key)) {
      state.draftedKeys = state.draftedKeys.concat(key);
    }
    if (!state.myTeamKeys.includes(key)) {
      state.myTeamKeys = state.myTeamKeys.concat(key);
    }
    persist();
    emit('drafted-changed', { key, drafted: true });
    emit('my-team-changed', { key, onTeam: true });
  }

  // Fully reverses draftedByMe: back on the board, off the roster.
  function removeFromMyTeam(key) {
    state.myTeamKeys = state.myTeamKeys.filter((k) => k !== key);
    state.draftedKeys = state.draftedKeys.filter((k) => k !== key);
    persist();
    emit('my-team-changed', { key, onTeam: false });
    emit('drafted-changed', { key, drafted: false });
  }

  // Breakout/sleeper tags: 0 (untagged) -> 1 -> 2 -> back to 0. Only ever
  // settable from the player detail view; list rows just display them.
  function getBreakoutLevel(key) {
    return state.breakoutLevels[key] || 0;
  }

  function cycleBreakoutLevel(key) {
    const next = (getBreakoutLevel(key) + 1) % 3;
    if (next > 0) state.breakoutLevels[key] = next; else delete state.breakoutLevels[key];
    persist();
    emit('tags-changed', { key });
  }

  function getSleeperLevel(key) {
    return state.sleeperLevels[key] || 0;
  }

  function cycleSleeperLevel(key) {
    const next = (getSleeperLevel(key) + 1) % 3;
    if (next > 0) state.sleeperLevels[key] = next; else delete state.sleeperLevels[key];
    persist();
    emit('tags-changed', { key });
  }

  // Do Not Draft: a single on/off tag (no second level).
  function isDoNotDraft(key) {
    return state.doNotDraftKeys.includes(key);
  }

  // Target: another single on/off tag (🎯), shown in the lists too.
  function isTarget(key) {
    return state.targetKeys.includes(key);
  }

  function toggleTarget(key) {
    const set = new Set(state.targetKeys);
    if (set.has(key)) set.delete(key); else set.add(key);
    state.targetKeys = Array.from(set);
    persist();
    emit('tags-changed', { key });
  }

  function toggleDoNotDraft(key) {
    const set = new Set(state.doNotDraftKeys);
    if (set.has(key)) set.delete(key); else set.add(key);
    state.doNotDraftKeys = Array.from(set);
    persist();
    emit('tags-changed', { key });
  }

  // A season slot's row for a player, by key. Looking this up with
  // slot.players.find() for every row, every emoji, every redraw made the
  // Draft List slow on a phone, so each slot's players array gets a
  // key -> row Map, built once per array (WeakMap: a re-uploaded season is a
  // new array and gets a fresh Map automatically).
  const seasonRowMaps = new WeakMap();
  function seasonRow(slot, key) {
    let map = seasonRowMaps.get(slot.players);
    if (!map) {
      map = new Map();
      slot.players.forEach((p) => map.set(p.key, p));
      seasonRowMaps.set(slot.players, map);
    }
    return map.get(key) || null;
  }

  // Health emoji, derived from Season Stats (Sources tab) — not a user
  // toggle like the tags above, just computed from games played. 💪 needs
  // all 3 most recent season slots to have data for this player and every one to be
  // 65+ games (missing a season means it can't be confirmed, so no badge);
  // 🚑 needs 54-or-fewer games in at least 2 of however many seasons do
  // have data for them. Shared by Draft List (on every row) and Player
  // Detail (next to the position badge).
  const HEALTH_DURABLE_GAMES = 65;
  const HEALTH_INJURY_GAMES = 54;

  function computeHealthEmoji(key) {
    const gamesPerSeason = state.seasonStats.slice(0, Constants.HEALTH_TREND_SEASONS).map((slot) => {
      const entry = seasonRow(slot, key);
      if (!entry) return null;
      const games = parseInt(entry.values.games, 10);
      return Number.isNaN(games) ? null : games;
    });
    if (gamesPerSeason.every((g) => g !== null && g >= HEALTH_DURABLE_GAMES)) {
      return '💪';
    }
    const lowSeasons = gamesPerSeason.filter((g) => g !== null && g <= HEALTH_INJURY_GAMES).length;
    if (lowSeasons >= 2) return '🚑';
    return null;
  }

  // Improvement (⬆️) / decline (⬇️) emoji, same Season Stats source as
  // health. seasonStats is ordered most-recent-first: values[0] = most
  // recent, values[1] = middle, values[2] = oldest. Two adjacent-year
  // windows are checked independently — oldest→middle and middle→most
  // recent. A category only counts toward a window if it moved by at
  // least its own minimum amount — a 0.1 blip in PTS shouldn't count the
  // same as a real jump — and moving by a whole extra multiple of that
  // minimum counts extra: 2x the minimum (or more) is worth 2 points, same
  // as a plain 1x is worth 1 — capped at 2 per category, so one huge swing
  // in a single stat can't singlehandedly clear the broad rule's bar; the
  // ⬆️/⏫ (or ⬇️/⏬) shown per-stat in Player Detail's season stats always matches
  // exactly what was scored. Same categories and thresholds as there (js/
  // seasonStatsView.js). A player earns the badge either way:
  //  - the broad, single-year way: at least 5 points' worth moved the
  //    right way from last season (middle→most-recent) alone; or
  //  - the sustained way: each window totals at least 3 points, and at
  //    least 2 categories qualified in both — so a real sustained trend
  //    reads differently from two unrelated one-year blips, without
  //    requiring the exact same 3-or-more stats both years.
  const TREND_MIN_CHANGE = {
    pts_per_g: 1,
    trb_per_g: 1,
    ast_per_g: 0.5,
    blk_per_g: 0.25,
    stl_per_g: 0.25,
    ft_per_g: 1
  };
  const TREND_CATEGORIES = Object.keys(TREND_MIN_CHANGE);
  const TREND_MIN_POINTS = 3;
  const TREND_MIN_OVERLAP = 2;
  const TREND_BROAD_MIN_POINTS = 5;

  // direction: 1 for improvement (a rise counts), -1 for decline (a drop
  // counts).
  function getTrendEmoji(key, direction, emoji) {
    const windowOldToMid = new Set();
    const windowMidToNew = new Set();
    let pointsOldToMid = 0;
    let pointsMidToNew = 0;
    TREND_CATEGORIES.forEach((statId) => {
      const minChange = TREND_MIN_CHANGE[statId];
      const values = state.seasonStats.slice(0, Constants.HEALTH_TREND_SEASONS).map((slot) => {
        const entry = seasonRow(slot, key);
        if (!entry) return null;
        const value = parseFloat(entry.values[statId]);
        return Number.isNaN(value) ? null : value;
      });
      const [recent, middle, oldest] = values;
      if (oldest !== null && middle !== null) {
        const change = direction * (middle - oldest);
        if (change >= minChange) {
          windowOldToMid.add(statId);
          pointsOldToMid += Math.min(2, Math.floor(change / minChange));
        }
      }
      if (middle !== null && recent !== null) {
        const change = direction * (recent - middle);
        if (change >= minChange) {
          windowMidToNew.add(statId);
          pointsMidToNew += Math.min(2, Math.floor(change / minChange));
        }
      }
    });

    // Broad single-year rule: last season alone racked up 5+ points —
    // enough on its own, no matter how the season before that looked.
    if (pointsMidToNew >= TREND_BROAD_MIN_POINTS) return emoji;

    // Sustained 2-year rule: each window needs enough total points, and
    // at least 2 categories have to be the ones carrying both windows.
    if (pointsOldToMid < TREND_MIN_POINTS || pointsMidToNew < TREND_MIN_POINTS) return null;
    let overlap = 0;
    windowOldToMid.forEach((id) => { if (windowMidToNew.has(id)) overlap += 1; });
    return overlap >= TREND_MIN_OVERLAP ? emoji : null;
  }

  function computeImprovementEmoji(key) {
    return getTrendEmoji(key, 1, '⬆️');
  }

  function computeDeclineEmoji(key) {
    return getTrendEmoji(key, -1, '⬇️');
  }

  // The three emojis only depend on the Season Stats rows, yet every redraw
  // of the Draft List (every search keystroke) recomputed them for every row.
  // Results are remembered per player and thrown away whenever the season
  // data is replaced (a new upload is a new players array, tracked by
  // signature) or edited in place.
  const arrayIds = new WeakMap();
  let nextArrayId = 1;
  const emojiMemo = { sig: '', health: new Map(), up: new Map(), down: new Map() };
  function emojiMemoFor(kind) {
    const sig = state.seasonStats.slice(0, Constants.HEALTH_TREND_SEASONS).map((slot) => {
      let id = arrayIds.get(slot.players);
      if (!id) { id = nextArrayId++; arrayIds.set(slot.players, id); }
      return id;
    }).join('-');
    if (sig !== emojiMemo.sig) {
      emojiMemo.sig = sig;
      emojiMemo.health.clear(); emojiMemo.up.clear(); emojiMemo.down.clear();
    }
    return emojiMemo[kind];
  }
  function memoized(kind, compute) {
    return (key) => {
      const memo = emojiMemoFor(kind);
      if (memo.has(key)) return memo.get(key);
      const value = compute(key);
      memo.set(key, value);
      return value;
    };
  }
  const getHealthEmoji = memoized('health', computeHealthEmoji);
  const getImprovementEmoji = memoized('up', computeImprovementEmoji);
  const getDeclineEmoji = memoized('down', computeDeclineEmoji);

  // Free-text note per player, set only from Player Detail's notes box.
  function getPlayerNote(key) {
    return state.playerNotes[key] || '';
  }

  function setPlayerNote(key, text) {
    if (text) state.playerNotes[key] = text; else delete state.playerNotes[key];
    persist();
  }

  // Smart Search's saved presets — { id, title, fieldA, direction, fieldB,
  // threshold }. upsertSavedSearch keys off `id`: pass one to update that
  // existing entry in place, omit it to create a new one (a fresh id is
  // generated and returned).
  function upsertSavedSearch(search) {
    const id = search.id || genId();
    const record = Object.assign({}, search, { id });
    const idx = state.savedSearches.findIndex((s) => s.id === id);
    if (idx === -1) state.savedSearches.push(record);
    else state.savedSearches[idx] = record;
    persist();
    return id;
  }

  function deleteSavedSearch(id) {
    state.savedSearches = state.savedSearches.filter((s) => s.id !== id);
    persist();
  }

  // Notes tab: free-standing notes, newest first. upsertNote creates a new
  // note (no id) or updates an existing one's text in place (id given); a
  // brand-new note goes to the top, an edited one keeps its spot.
  function upsertNote(text, id) {
    const now = Date.now();
    const existing = id && state.notes.find((n) => n.id === id);
    if (existing) {
      existing.text = text;
      existing.updatedAt = now;
    } else {
      id = genId();
      state.notes.unshift({ id, text, updatedAt: now });
    }
    persist();
    return id;
  }

  // Draft Board "Edit Draft": replace the pick order (same players, new
  // order). Everything that numbers picks (Draft Board, My Team rounds, the
  // Draft List's pick markers) derives from this one list, so they follow.
  function reorderDrafted(keys) {
    const cur = state.draftedKeys;
    if (keys.length !== cur.length || !keys.every((k) => cur.includes(k))) return false;
    state.draftedKeys = keys.slice();
    persist();
    emit('drafted-changed', { reordered: true });
    emit('my-team-changed', {});
    return true;
  }

  // Notes tab drag-reorder: `ids` is the new top-to-bottom order.
  function reorderNotes(ids) {
    const byId = new Map(state.notes.map((n) => [n.id, n]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
    state.notes.forEach((n) => { if (!ordered.includes(n)) ordered.push(n); });
    state.notes = ordered;
    persist();
  }

  function deleteNote(id) {
    state.notes = state.notes.filter((n) => n.id !== id);
    persist();
  }

  // The Draft List's current source filter (which sources count, 1.5x/2.5x,
  // iso mode) is what the combined rank means everywhere, so it's published
  // here and Draft Board / My Team use it instead of their own defaults.
  let activeFilter = null;
  function setActiveFilter(weights, iso) {
    const changed = !activeFilter || !SourceWeights.sameFilter(activeFilter.weights, activeFilter.iso, weights, iso);
    activeFilter = { weights: Object.assign({}, weights), iso: iso ? { ids: iso.ids.slice(), saved: Object.assign({}, iso.saved) } : null };
    if (changed) emit('filters-changed');
  }
  function getActiveWeights() {
    return activeFilter ? activeFilter.weights : SourceWeights.defaultWeights(state.sources);
  }
  function getActiveIso() {
    return activeFilter ? activeFilter.iso : null;
  }

  // Draft List pins: long-pressing a row pins that player to their slot so
  // filter changes can't move them (see resyncOrder in js/tabs/draft.js).
  // Only another long press, or drafting them, unpins — Lock List doesn't.
  function isPinned(key) {
    return (state.pinnedKeys || []).includes(key);
  }

  function togglePinned(key) {
    const pins = state.pinnedKeys || [];
    state.pinnedKeys = pins.includes(key) ? pins.filter((k) => k !== key) : pins.concat(key);
    persist();
    emit('tags-changed', { key });
  }

  // Recover Draft Data (Sources tab): puts the draft lists and tags from a
  // snapshot — a local backup or an old GitHub version — back into the live
  // state. Replaces drafted / My Team / targets / do-not-draft / breakout /
  // sleeper; leaves sources, season stats, notes, and the rest alone. A
  // snapshot of what's there now is taken first, so a restore can be undone
  // from the same card.
  function restoreDraftData(data) {
    Backups.add(state, 'before-restore');
    Backups.LIST_FIELDS.forEach((k) => { if (Array.isArray(data[k])) state[k] = data[k].slice(); });
    Backups.MAP_FIELDS.forEach((k) => { if (data[k] && typeof data[k] === 'object') state[k] = Object.assign({}, data[k]); });
    persist();
    emit('remote-state-loaded');
  }

  global.App = {
    state, on, emit, persist, genId,
    isDrafted, setDrafted, isMyPickOnTheClock, isDraftOver, pickOwner, teamKeys, teamOnTheClock, syncMyTeam, totalRounds, myPositionInRound, roundRunsBackwards,
    isOnMyTeam, draftedByMe, removeFromMyTeam,
    getBreakoutLevel, cycleBreakoutLevel,
    getSleeperLevel, cycleSleeperLevel,
    isDoNotDraft, toggleDoNotDraft,
    isTarget, toggleTarget, isPinned, togglePinned,
    setActiveFilter, getActiveWeights, getActiveIso,
    getHealthEmoji, getImprovementEmoji, getDeclineEmoji,
    getPlayerNote, setPlayerNote,
    upsertSavedSearch, deleteSavedSearch,
    upsertNote, deleteNote, reorderNotes, reorderDrafted, restoreDraftData
  };
})(window);
