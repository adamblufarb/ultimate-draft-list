/* Persistence layer: localStorage read/write with defaults + migration guard. */
(function (global) {
  const KEY = 'udo_state_v1';

  function defaultState() {
    return {
      sources: [],          // [{ id, name, url, rawText, scoreType, players: [{rank, name, positions, score}] }]
      selectedSourceIds: [], // ids included in Tab 1's combined average
      draftOrder: null,      // [{ key, name }] custom order, or null if never initialized
      draftedKeys: [],       // normalized keys of players marked drafted (hidden unless "include drafted" is on)
      lockedKeys: [],        // normalized keys of players that stay put when the Draft List is reset
      myTeamKeys: [],         // normalized keys of players drafted by the user, in pick order
      breakoutLevels: {},    // key -> 1 (⭐) or 2 (🌟); absent/0 means untagged
      sleeperLevels: {},     // key -> 1 (🥱) or 2 (😴); absent/0 means untagged
      doNotDraftKeys: []     // normalized keys tagged "do not draft" (🚫)
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

  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Failed to save state', e);
    }
  }

  global.Storage = { load, save, defaultState };
})(window);
