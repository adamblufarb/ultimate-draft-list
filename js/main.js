/* App bootstrap: wires up the bottom tab nav and mounts each tab controller.
   Panels stay in the DOM when hidden (display:none), so switching tabs never
   loses in-progress state. */
(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const panels = {
      rankings: document.getElementById('panel-rankings'),
      draft: document.getElementById('panel-draft'),
      sources: document.getElementById('panel-sources')
    };
    const navButtons = document.querySelectorAll('.tab-btn');

    RankingsTab.init(panels.rankings);
    DraftTab.init(panels.draft);
    SourcesTab.init(panels.sources);

    // Rankings and Sources already stay in sync reactively (Rankings
    // listens for 'sources-changed'; Sources only re-renders on its own
    // explicit actions, so in-progress paste/edit text is never lost by
    // switching tabs away and back). Draft is the exception: it needs a
    // fresh show() each time it becomes visible, both because its
    // "seed from combined average if still empty" check must see whatever
    // sources exist *now* (not just at page load), and because its list
    // measures row height via getBoundingClientRect(), which reads 0 while
    // the panel is display:none.
    function showTab(name) {
      Object.entries(panels).forEach(([key, el]) => {
        el.classList.toggle('active', key === name);
      });
      navButtons.forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === name);
      });
      if (name === 'draft') DraftTab.show();
    }

    navButtons.forEach((btn) => {
      btn.addEventListener('click', () => showTab(btn.dataset.tab));
    });

    showTab('rankings');
  });
})();
