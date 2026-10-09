/* Per-source "weight" for the combined-average filter — shared by Draft
   List, Draft Board, and Player Detail so the same source cycles the same
   way no matter which of those you tap it from.

   A weight is 0 (excluded — the source isn't in the weights object at
   all), 1 (normal chip "on", today's existing behavior), 1.5 or 2.5 (boosted —
   counts that many times as heavily in the combined average). Only "Average"-style
   sources (scoreType 'ly_avg' or 'ty_avg_proj' — Last Year Avg/Game and
   This Year Avg/Game Projection) and ADP sources (scoreType 'adp' — a
   continuous consensus score, the same spirit as an average) can ever
   reach 1.5 or 2.5; every other source just cycles the plain 0/1 on-off toggle it
   always has.

   "Total"-style sources (scoreType 'ly_total' or 'ty_total_proj') start
   excluded by default — a large total number skews a combined *average*
   of ranks/scores the same way an average-style source doesn't, so they
   opt in rather than opt out. Everything else (plain sources with no
   scoreType, ADP, plus the boostable averages) defaults to normal (1x)
   weight, same as before this existed.

   Iso mode: long-pressing a source's chip/square isolates it — only that
   source counts (weights become { [id]: 1 }), so the combined rank shown
   is just that source's own rank. Long-pressing more sources while in iso
   adds them (as many as you like; long-pressing a member again drops it,
   and dropping the last one ends iso). The weights from before are kept
   (iso = { ids, saved }); a plain tap on any chip while in iso — isolated
   or not — cancels it and puts them back exactly as they were, and that tap
   does nothing else. tap()/longPress() are pure state-in/state-out
   helpers — { weights, iso } — and attachPress() does the long-press
   detection, so Draft List, Draft Board, and Player Detail all behave
   identically. */
(function (global) {
  const BOOSTABLE_SCORE_TYPES = new Set(['ly_avg', 'ty_avg_proj', 'adp']);
  const DEFAULT_OFF_SCORE_TYPES = new Set(['ly_total', 'ty_total_proj']);

  // The weights a boostable source steps through, in tap order.
  const BOOST_STEPS = [1, 1.5, 2.5];

  function isBoostable(source) {
    return BOOSTABLE_SCORE_TYPES.has(source.scoreType);
  }

  function defaultWeights(sources) {
    const weights = {};
    sources.forEach((s) => {
      if (!DEFAULT_OFF_SCORE_TYPES.has(s.scoreType)) weights[s.id] = 1;
    });
    return weights;
  }

  // Drops ids for sources that no longer exist, and adds any newly-added
  // source (one with no entry at all) at its default weight. A source the
  // user turned off keeps an explicit 0 entry — so it's never mistaken for
  // a new source and quietly switched back on when this runs again (it runs
  // every time sync finishes loading, which on a slow phone connection is
  // seconds after the user has started setting filters).
  function reconcileWeights(weights, sources) {
    const next = {};
    const byId = new Map(sources.map((s) => [s.id, s]));
    Object.keys(weights).forEach((id) => {
      if (byId.has(id)) next[id] = weights[id] || 0;
    });
    sources.forEach((s) => {
      if (!(s.id in next) && !DEFAULT_OFF_SCORE_TYPES.has(s.scoreType)) {
        next[s.id] = 1;
      }
    });
    return next;
  }

  function getWeight(weights, id) {
    return weights[id] || 0;
  }

  // Tap cycle: 0 -> 1 -> (1.5 -> 2.5 if boostable, else back to 0) -> 0.
  function cycleWeight(weights, source) {
    const current = getWeight(weights, source.id);
    const next = Object.assign({}, weights);
    if (current === 0) {
      next[source.id] = 1;
    } else if (isBoostable(source) && current < BOOST_STEPS[BOOST_STEPS.length - 1]) {
      next[source.id] = BOOST_STEPS[BOOST_STEPS.indexOf(current) + 1];
    } else {
      next[source.id] = 0; // explicit off, not absent — see reconcileWeights
    }
    return next;
  }

  function weightsEqual(a, b) {
    const ids = new Set(Object.keys(a).concat(Object.keys(b)));
    for (const id of ids) {
      if ((a[id] || 0) !== (b[id] || 0)) return false;
    }
    return true;
  }

  // Label suffix for a boosted weight (" · 1.5x"/" · 2.5x"), '' otherwise —
  // shared by every chip/square so they all read the same.
  function boostLabel(weight) {
    return weight > 1 ? ' · ' + weight + 'x' : '';
  }

  // Extra CSS class for a boosted weight (darker blue; darker still at 2.5x).
  function boostClass(weight, base) {
    if (weight > 1.5) return ' ' + base + ' ' + base + '-3';
    return weight > 1 ? ' ' + base : '';
  }

  const LONG_PRESS_MS = 450;
  // A long press that just fired swallows the click the finger-lift
  // produces; module-level (not per element) because acting on the press
  // usually re-renders and replaces the very button being held. Cleared a
  // beat after the finger comes up — however long it was held.
  let swallowNextClick = false;
  const releaseSwallow = () => setTimeout(() => { swallowNextClick = false; }, 60);
  window.addEventListener('pointerup', releaseSwallow, true);
  window.addEventListener('pointercancel', releaseSwallow, true);

  function weightsFor(ids) {
    const weights = {};
    ids.forEach((id) => { weights[id] = 1; });
    return weights;
  }

  function isIso(iso, id) {
    return !!iso && iso.ids.includes(id);
  }

  function tap(state, source) {
    // Any tap while in iso mode just cancels it, putting back exactly the
    // filters that were on before — the tap itself does nothing else.
    if (state.iso) return { weights: state.iso.saved, iso: null };
    return { weights: cycleWeight(state.weights, source), iso: null };
  }

  function longPress(state, source) {
    if (!state.iso) {
      return { weights: weightsFor([source.id]), iso: { ids: [source.id], saved: state.weights } };
    }
    const ids = isIso(state.iso, source.id)
      ? state.iso.ids.filter((id) => id !== source.id)
      : state.iso.ids.concat(source.id);
    if (ids.length === 0) return { weights: state.iso.saved, iso: null };
    return { weights: weightsFor(ids), iso: { ids, saved: state.iso.saved } };
  }

  // reconcileWeights, iso-aware: the saved weights are reconciled too, and
  // isolated sources that were deleted drop out (iso ends if none are left).
  function reconcileIso(weights, iso, sources) {
    if (!iso) return { weights: reconcileWeights(weights, sources), iso: null };
    const saved = reconcileWeights(iso.saved, sources);
    const ids = iso.ids.filter((id) => sources.some((s) => s.id === id));
    if (ids.length === 0) return { weights: saved, iso: null };
    return { weights: weightsFor(ids), iso: { ids, saved } };
  }

  // Tab/overlay snapshots differ if the effective weights or which sources
  // (if any) are isolated changed.
  function sameFilter(weightsA, isoA, weightsB, isoB) {
    const idsA = isoA ? isoA.ids.slice().sort().join(',') : '';
    const idsB = isoB ? isoB.ids.slice().sort().join(',') : '';
    return weightsEqual(weightsA, weightsB) && idsA === idsB;
  }

  // Wires tap vs. long-press onto a chip/square. Moving more than a few px
  // (a scroll) or lifting early cancels the press; the context menu a long
  // press would otherwise pop up on touch is suppressed.
  function attachPress(el, onTap, onLongPress) {
    let timer = null;
    let startX = 0;
    let startY = 0;
    const cancel = () => { clearTimeout(timer); timer = null; };
    el.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      startX = e.clientX;
      startY = e.clientY;
      cancel();
      timer = setTimeout(() => {
        timer = null;
        swallowNextClick = true;
        onLongPress();
      }, LONG_PRESS_MS);
    });
    el.addEventListener('pointermove', (e) => {
      if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > 10) cancel();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => el.addEventListener(type, cancel));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('click', () => {
      if (swallowNextClick) return;
      onTap();
    });
  }

  global.SourceWeights = { tap, longPress, attachPress, reconcileIso, isIso, sameFilter, boostLabel, boostClass, isBoostable, defaultWeights, reconcileWeights, getWeight, cycleWeight, weightsEqual };
})(window);
