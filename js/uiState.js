/* Per-device UI state that should survive the page being reloaded: the Draft
   List's filters (source chips and iso mode, position chips, team filter,
   Smart Search, pool size) and which tab was open. Phone browsers discard a
   page that's been in the background and reload it from scratch when you
   come back, which used to throw all of this away.

   Kept in its own localStorage key, deliberately NOT in App.state — it's a
   property of this device's screen, not your data, so it's never synced to
   GitHub, never merged, and can never overwrite or be overwritten by
   another device. Everything is wrapped in try/catch: with storage blocked
   the app just behaves as it did before (filters reset on reload). */
(function (global) {
  const KEY = 'udo_ui_state';

  function load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function get(name, fallback) {
    const all = load();
    return name in all ? all[name] : fallback;
  }

  function set(name, value) {
    try {
      const all = load();
      all[name] = value;
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch (e) { /* ignore */ }
  }

  global.UiState = { get, set };
})(window);
