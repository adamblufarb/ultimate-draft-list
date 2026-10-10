/* App bootstrap: wires up the bottom tab nav and mounts each tab controller.
   Panels stay in the DOM when hidden (display:none), so switching tabs never
   loses in-progress state. */
(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const panels = {
      draft: document.getElementById('panel-draft'),
      myteam: document.getElementById('panel-myteam'),
      drafted: document.getElementById('panel-drafted'),
      notes: document.getElementById('panel-notes'),
      sources: document.getElementById('panel-sources')
    };
    const navButtons = document.querySelectorAll('.tab-btn');
    const fakeBanner = document.getElementById('fake-banner');
    App.on('fake-mode-changed', ({ on }) => { fakeBanner.hidden = !on; });

    DraftTab.init(panels.draft);
    MyTeamTab.init(panels.myteam);
    DraftedPlayersTab.init(panels.drafted);
    NotesTab.init(panels.notes);
    SourcesTab.init(panels.sources);

    // My Team, Draft Board, and Sources already stay in sync reactively
    // (each listens for the relevant state-change events; Sources only
    // re-renders on its own explicit actions, so in-progress paste/edit text
    // is never lost by switching tabs away and back). Draft is the
    // exception: it needs a fresh show() each time it becomes visible, both
    // because its "seed from combined average if still empty" check must
    // see whatever sources exist *now* (not just at page load), and because
    // its list measures row height via getBoundingClientRect(), which reads
    // 0 while the panel is display:none.
    function showTab(name) {
      UiState.set('tab', name);
      Object.entries(panels).forEach(([key, el]) => {
        el.classList.toggle('active', key === name);
      });
      navButtons.forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === name);
      });
      if (name === 'draft') DraftTab.show();
      // Draft Board opens at the bottom, where the latest picks are.
      if (name === 'drafted') setTimeout(() => { panels.drafted.scrollTop = panels.drafted.scrollHeight; }, 0);
    }

    navButtons.forEach((btn) => {
      btn.addEventListener('click', () => showTab(btn.dataset.tab));
    });

    const savedTab = UiState.get('tab', 'draft');
    showTab(panels[savedTab] ? savedTab : 'draft');

    // Hand GithubSync a way to read and replace the live state (in place —
    // every tab holds a reference to App.state), then, if this device has a
    // GitHub sync token, pull the latest saved state in the background and
    // merge it in once it arrives — local data renders immediately rather
    // than blocking the first paint on a network round trip. Unsynced local
    // changes are merged with it, never pushed over it, and nothing is
    // pushed until this has run (see js/githubSync.js).
    GithubSync.setAdapter({
      getState: () => App.state,
      isFake: () => App.isFakeMode(),
      replaceState: (next) => {
        // Last line of defence: never swap the live state for something that
        // doesn't look like app state (see GithubSync.validateState).
        GithubSync.stripJunk(next);
        try { GithubSync.validateState(next); } catch (e) { console.error(e); return; }
        const live = App.state;
        const incoming = Storage.normalize(Object.assign(Storage.defaultState(), next));
        Object.keys(live).forEach((k) => { delete live[k]; });
        Object.assign(live, incoming);
        Storage.save(live);
        App.emit('remote-state-loaded');
      }
    });
    if (GithubSync.isConnected()) GithubSync.syncOnLoad();
  });
})();
