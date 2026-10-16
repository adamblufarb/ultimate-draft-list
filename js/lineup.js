/* Lineup slots for My Team. The roster comes from the draft's team structure
   (default: PG, SG, SF, PF, C, C, G (PG or SG), F (SF or PF), Util (anyone) plus
   7 bench spots, 16 players); PF/C slots take a PF or C. Players you've drafted ("Drafted By Me",
   in pick order) fill those slots automatically.

   A player's first listed position is their main one ("PF, SF" = PF first),
   and they may fill any slot they're eligible for through any listed
   position. Each player tries their main position's slot first, then their
   other positions, then the flex slots (G / F), then Util; if the slot they'd
   want is taken, whoever's in it is moved to another open slot when that
   lets everyone fit (a maximum matching), so a later dual-position pick
   never costs you a starter spot you could have kept. Otherwise nobody
   already placed is moved. Whoever can't be
   placed in a starter slot goes to the bench, and anyone past the roster size is shown as
   over the roster limit. */
(function (global) {
  // Slot types a team structure can use; eligible = positions that fit (null = anyone).
  const SLOT_TYPES = {
    PG: ['PG'], SG: ['SG'], SF: ['SF'], PF: ['PF'], C: ['C'],
    G: ['PG', 'SG'], F: ['SF', 'PF'],   // F assumed: forward flex = SF or PF
    'PF/C': ['PF', 'C'], UTIL: null
  };
  const SLOT_ORDER = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'PF/C', 'UTIL'];
  const DEFAULT_STRUCTURE = { slots: ['PG', 'SG', 'SF', 'PF', 'C', 'C', 'G', 'F', 'UTIL'], bench: 7 };

  function normalizeStructure(st) {
    const slots = st && Array.isArray(st.slots) ? st.slots.filter((x) => x in SLOT_TYPES) : DEFAULT_STRUCTURE.slots.slice();
    const bench = st && Number.isInteger(st.bench) && st.bench >= 0 ? st.bench : DEFAULT_STRUCTURE.bench;
    return { slots, bench };
  }

  function parsePositions(text) {
    return (text || '').split(',').map((p) => p.trim().toUpperCase()).filter(Boolean);
  }

  // How much a player "wants" a slot: their main position's own slot, then
  // their other positions' own slots, then flex slots, then Util.
  function slotRank(slot, positions) {
    if (!slot.eligible) return 99;                        // Util
    const hits = positions.map((p) => slot.eligible.indexOf(p) !== -1);
    if (!hits.some(Boolean)) return -1;                   // not eligible
    const single = slot.eligible.length === 1;
    const best = hits.indexOf(true);                      // 0 = main position
    return (single ? 0 : 50) + best;
  }

  // keys: players in pick order. positionsOf(key) -> "PF, SF" style text.
  // Returns { starters: [{slot, key|null}], bench: [key|null x7], over: [key] }.
  function assign(keys, positionsOf, structure) {
    const st = normalizeStructure(structure);
    const STARTERS = st.slots.map((label) => ({ label, eligible: SLOT_TYPES[label] }));
    const BENCH_SPOTS = st.bench;
    const prefs = keys.map((k) => {
      const pos = parsePositions(positionsOf(k));
      return STARTERS.map((s, i) => ({ i, r: slotRank(s, pos) })).filter((x) => x.r >= 0)
        .sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.i);
    });
    const owner = new Array(STARTERS.length).fill(-1);   // slot -> player index
    const tryPlace = (p, seen) => {
      // An open slot they're eligible for comes first, so nobody already
      // placed is moved unless that's the only way to fit this player.
      for (const s of prefs[p]) {
        if (owner[s] === -1) { owner[s] = p; return true; }
      }
      for (const s of prefs[p]) {
        if (seen[s]) continue;
        seen[s] = true;
        if (tryPlace(owner[s], seen)) { owner[s] = p; return true; }
      }
      return false;
    };
    keys.forEach((_, p) => { tryPlace(p, new Array(STARTERS.length).fill(false)); });
    const placed = new Set(owner.filter((o) => o !== -1));
    const rest = keys.filter((_, p) => !placed.has(p));
    return {
      starters: STARTERS.map((slot, i) => ({ slot, key: owner[i] === -1 ? null : keys[owner[i]] })),
      bench: Array.from({ length: BENCH_SPOTS }, (_, i) => rest[i] || null),
      over: rest.slice(BENCH_SPOTS)
    };
  }

  global.Lineup = { SLOT_ORDER, DEFAULT_STRUCTURE, normalizeStructure, assign, parsePositions };
})(window);
