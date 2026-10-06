/* Persistence layer: localStorage read/write with defaults + migration guard. */
(function (global) {
  const KEY = 'udo_state_v1';

  function defaultState() {
    return {
      sources: [],          // [{ id, name, url, rawText, scoreType, players: [{rank, name, positions, score}] }]
      selectedSourceIds: [], // ids included in Tab 1's combined average
      draftOrder: null,      // [{ key, name }] custom order, or null if never initialized
      draftedKeys: [],       // normalized keys of players marked drafted (hidden unless "include drafted" is on)
      myTeamKeys: [],         // normalized keys of players drafted by the user, in pick order
      breakoutLevels: {},    // key -> 1 (⭐) or 2 (🌟); absent/0 means untagged
      sleeperLevels: {},     // key -> 1 (🥱) or 2 (😴); absent/0 means untagged
      targetKeys: [],        // normalized keys tagged "target" (🎯)
      teamHighlightGap: 1,   // Team filter screen's "highlight teams N lower than average" number
      doNotDraftKeys: [],    // normalized keys tagged "do not draft" (🚫)
      dataList: { rawText: '', players: [] }, // [{ name, age, team, height }] — extra player info shown only in Player Detail, never part of any ranking
      // Fixed 3 slots (most-recent season first), each uploaded from an .xls
      // (HTML-format) per-game stats export. columns: [{ id, label }] in the
      // file's own order; players: [{ key, displayName, values: { [colId]: text } }].
      // Never part of any ranking — shown only via Player Detail's "Show Data".
      seasonStats: [
        { label: '', fileName: '', columns: [], players: [] },
        { label: '', fileName: '', columns: [], players: [] },
        { label: '', fileName: '', columns: [], players: [] }
      ],
      playerNotes: {}, // key -> free-text note, set from Player Detail
      savedSearches: [] // [{ id, title, fieldA, direction, fieldB, threshold }] — Smart Search's saved presets
    };
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
      return Object.assign(base, parsed);
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

  global.Storage = { load, save, defaultState, setReadOnly };
})(window);
