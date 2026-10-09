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
    if (fakeSnapshot) return; // Fake Mode is a sandbox — nothing saves or syncs
    Storage.save(state);
    GithubSync.scheduleSync();
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

  // Health emoji, derived from Season Stats (Sources tab) — not a user
  // toggle like the tags above, just computed from games played. 💪 needs
  // all 3 most recent season slots to have data for this player and every one to be
  // 65+ games (missing a season means it can't be confirmed, so no badge);
  // 🚑 needs 54-or-fewer games in at least 2 of however many seasons do
  // have data for them. Shared by Draft List (on every row) and Player
  // Detail (next to the position badge).
  const HEALTH_DURABLE_GAMES = 65;
  const HEALTH_INJURY_GAMES = 54;

  function getHealthEmoji(key) {
    const gamesPerSeason = state.seasonStats.slice(0, Constants.HEALTH_TREND_SEASONS).map((slot) => {
      const entry = slot.players.find((p) => p.key === key);
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
        const entry = slot.players.find((p) => p.key === key);
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

  function getImprovementEmoji(key) {
    return getTrendEmoji(key, 1, '⬆️');
  }

  function getDeclineEmoji(key) {
    return getTrendEmoji(key, -1, '⬇️');
  }

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

  function deleteNote(id) {
    state.notes = state.notes.filter((n) => n.id !== id);
    persist();
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

  // Fake Mode: a throwaway sandbox for practicing against scrambled data.
  // Entering takes a deep snapshot of the real state, then scrambles the
  // live state in place (so every tab's existing `App.state.x` reads just
  // work):
  //  - each player gets one big random shift of 20-100 (random sign) that
  //    hits their number on every list they appear on, plus a smaller
  //    independent wobble of up to 15 either way per list. Each list is
  //    then re-ranked by those shifted values and the list's own original
  //    numbers dealt back out in the new order — so a list is still a clean
  //    ranking (no ties, no negatives, ADP lists keep their real-looking
  //    decimal scores) but the players in it have moved around a lot, and
  //    because a player's shift lands on all their lists together it
  //    survives the averaging instead of cancelling out;
  //  - on top of that, every player's combined rank gets its own random
  //    5-15 either way (Ranking.setCombinedOffsets);
  //  - last seasons' numeric stats get a random +1.5 or -1.5 (never below
  //    0; percentages, text like team/awards, and games past 82 are left
  //    alone);
  //  - every Breakout/Sleeper/Target/Do Not Draft tag is cleared.
  // The Draft List order is re-seeded from the scrambled combined average
  // so it agrees with the numbers shown. While active, persist() is a
  // no-op and Storage is read-only, so nothing reaches localStorage or
  // GitHub; exiting restores the snapshot, and a reload does the same for
  // free (the real data was never overwritten). The mode itself is never
  // persisted.
  let fakeSnapshot = null;

  function isFakeMode() {
    return fakeSnapshot !== null;
  }

  function randomSign() {
    return Math.random() < 0.5 ? -1 : 1;
  }

  const NUMERIC_TEXT = /^-?\d*\.?\d+$/;

  function scrambleSeasonStats() {
    state.seasonStats.forEach((slot) => {
      slot.players.forEach((player) => {
        slot.columns.forEach((col) => {
          if (/_pct$/.test(col.id)) return;
          const raw = player.values[col.id];
          if (typeof raw !== 'string' || !NUMERIC_TEXT.test(raw)) return;
          const decimals = (raw.split('.')[1] || '').length;
          let next = parseFloat(raw) + randomSign() * 1.5;
          next = Math.max(0, next);
          if (col.id === 'games' || col.id === 'games_started') next = Math.min(82, next);
          player.values[col.id] = next.toFixed(decimals);
        });
      });
    });
  }

  function scrambleLists() {
    const appearances = new Map(); // normalized name -> [{ source, player }]
    state.sources.forEach((source) => {
      source.players.forEach((player) => {
        const key = NameMatch.normalize(player.name);
        if (!appearances.has(key)) appearances.set(key, []);
        appearances.get(key).push(player);
      });
    });

    const shiftedValue = new Map(); // player object -> shifted number
    appearances.forEach((players) => {
      const shift = randomSign() * (20 + Math.random() * 80);
      players.forEach((player) => {
        const wobble = (Math.random() * 2 - 1) * 15;
        shiftedValue.set(player, player.rank + shift + wobble);
      });
    });

    state.sources.forEach((source) => {
      const originals = source.players.map((p) => p.rank).sort((a, b) => a - b);
      const valueOf = (p) => (shiftedValue.has(p) ? shiftedValue.get(p) : p.rank);
      source.players.slice()
        .sort((a, b) => (valueOf(a) - valueOf(b)) || (a.rank - b.rank))
        .forEach((p, i) => { p.rank = originals[i]; });
    });
  }

  function enterFakeMode() {
    if (fakeSnapshot) return;
    fakeSnapshot = JSON.parse(JSON.stringify(state));
    // Anything still waiting out the sync debounce is the real data — get it
    // out before the live object turns fake.
    GithubSync.flushPending();
    Storage.setReadOnly(true);

    scrambleLists();
    state.targetKeys = [];
    state.breakoutLevels = {};
    state.sleeperLevels = {};
    state.doNotDraftKeys = [];
    scrambleSeasonStats();

    Ranking.invalidateIndexCache();
    const offsets = new Map();
    Ranking.buildIndex(state.sources).forEach((entry, key) => offsets.set(key, randomSign() * (5 + Math.random() * 10)));
    Ranking.setCombinedOffsets(offsets);
    state.draftOrder = Ranking.computeCombined(state.sources, SourceWeights.defaultWeights(state.sources))
      .map((row) => ({ key: row.key, name: row.displayName }));

    emit('fake-mode-changed', { on: true });
    emit('remote-state-loaded');
  }

  function exitFakeMode() {
    if (!fakeSnapshot) return;
    const real = fakeSnapshot;
    fakeSnapshot = null;
    Storage.setReadOnly(false);
    Ranking.setCombinedOffsets(null);
    Object.keys(state).forEach((k) => { delete state[k]; });
    Object.assign(state, real);
    emit('fake-mode-changed', { on: false });
    emit('remote-state-loaded');
  }

  global.App = {
    state, on, emit, persist, genId,
    isDrafted, setDrafted,
    isOnMyTeam, draftedByMe, removeFromMyTeam,
    getBreakoutLevel, cycleBreakoutLevel,
    getSleeperLevel, cycleSleeperLevel,
    isDoNotDraft, toggleDoNotDraft,
    isTarget, toggleTarget,
    getHealthEmoji, getImprovementEmoji, getDeclineEmoji,
    getPlayerNote, setPlayerNote,
    upsertSavedSearch, deleteSavedSearch,
    upsertNote, deleteNote, restoreDraftData,
    isFakeMode, enterFakeMode, exitFakeMode
  };
})(window);
