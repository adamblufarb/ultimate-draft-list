/* Persistence layer: localStorage read/write with defaults + migration guard. */
(function (global) {
  const KEY = 'udo_state_v1';

  function defaultState() {
    return {
      sources: [],          // [{ id, name, url, rawText, scoreType, players: [{rank, name, positions, score}] }]
      selectedSourceIds: [], // ids included in Tab 1's combined average
      draftOrder: null,      // [{ key, name }] custom order, or null if never initialized
      draftedKeys: [],       // normalized keys of players marked drafted (always hidden from Draft List; kept in the full order)
      myTeamKeys: [],         // normalized keys of players drafted by the user, in pick order
      breakoutLevels: {},    // key -> 1 (⭐) or 2 (🌟); absent/0 means untagged
      sleeperLevels: {},     // key -> 1 (🥱) or 2 (😴); absent/0 means untagged
      targetKeys: [],        // normalized keys tagged "target" (🎯)
      teamHighlightGap: 1,   // Team filter screen's "highlight teams N lower than average" number
      doNotDraftKeys: [],    // normalized keys tagged "do not draft" (🚫)
      dataList: { rawText: '', players: [] }, // [{ name, age, team, height }] — extra player info shown only in Player Detail, never part of any ranking
      // Fixed Constants.SEASON_SLOTS slots (most-recent season first), each
      // uploaded from an .xls (HTML-format) per-game stats export. columns:
      // [{ id, label }] in the file's own order; players: [{ key, displayName,
      // values: { [colId]: text } }]. Never part of any ranking — shown only
      // at the bottom of Player Detail.
      seasonStats: Array.from({ length: Constants.SEASON_SLOTS }, () => ({ label: '', fileName: '', columns: [], players: [] })),
      playerNotes: {}, // key -> free-text note, set from Player Detail
      pinnedKeys: [],        // players pinned in place on Draft List (long press); only unpinned by long-pressing again or drafting
      listLocked: false,     // Draft List's "Lock List" toggle — keeps the order fixed while filters change
      showNextPick: false,   // Draft List's "Next Pick" toggle
      pickSlot: 3,           // your slot in the first round (1 = picks first)
      leagueSize: 10,        // teams in the league (snake draft)
      notes: [],        // [{ id, text, updatedAt }] — free-standing notes from the Notes tab, newest first
      savedSearches: [] // [{ id, title, fieldA, direction, fieldB, threshold }] — Smart Search's saved presets
    };
  }

  // Brings state saved by an older version up to the current shape: adds
  // any Season Stats slots it predates (the 4th one is pre-labelled 22-23).
  // Run on everything that becomes the live state — local load and every
  // state pulled from or merged with GitHub.
  function normalize(state) {
    Constants.GITHUB_RESPONSE_KEYS.forEach((k) => { delete state[k]; });
    if (!Array.isArray(state.seasonStats)) state.seasonStats = [];
    while (state.seasonStats.length < Constants.SEASON_SLOTS) {
      const label = state.seasonStats.length === 3 ? '22-23' : '';
      state.seasonStats.push({ label, fileName: '', columns: [], players: [] });
    }
    return state;
  }

  function load() {
    let raw;
    try {
      raw = localStorage.getItem(KEY);
    } catch (e) {
      console.warn('localStorage unavailable', e);
      return defaultState();
    }
    if (!raw) return defaultState();
    try {
      const parsed = JSON.parse(raw);
      const base = defaultState();
      return normalize(Object.assign(base, parsed));
    } catch (e) {
      console.warn('Failed to parse saved state, resetting', e);
      return defaultState();
    }
  }

  // Fake Mode (App.enterFakeMode) flips this on so nothing it does ever
  // reaches localStorage — a reload always comes back to the real data.
  let readOnly = false;
  function setReadOnly(value) { readOnly = value; }

  function save(state) {
    if (readOnly) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Failed to save state', e);
    }
  }

  global.Storage = { load, save, defaultState, normalize, setReadOnly };
})(window);
