/* The league's fantasy scoring (ESPN-style categories, points per unit),
   editable from Settings → Scoring System. state.scoring maps category id →
   points; categories not listed score 0. Applied to a season's per-game
   averages it gives average fantasy points per game (js/seasonStatsView.js).
   Categories that need data the per-game exports don't have (e.g. triple
   doubles, ejections) can be entered but can't be counted. */
(function (global) {
  const col = (id) => ({ cols: [id], stat: (v) => v[id] });
  const missed = (made, att) => ({ cols: [made, att], stat: (v) => v[att] - v[made] });
  const CATEGORIES = [
    { id: 'FGM', name: 'Field Goals Made', ...col('fg_per_g'), def: 2 },
    { id: 'FGA', name: 'Field Goals Attempted', ...col('fga_per_g'), def: -1 },
    { id: 'FGMI', name: 'Field Goals Missed', ...missed('fg_per_g', 'fga_per_g'), def: 0 },
    { id: 'FTM', name: 'Free Throws Made', ...col('ft_per_g'), def: 1 },
    { id: 'FTA', name: 'Free Throws Attempted', ...col('fta_per_g'), def: -0.5 },
    { id: 'FTMI', name: 'Free Throws Missed', ...missed('ft_per_g', 'fta_per_g'), def: 0 },
    { id: '3PM', name: 'Three Pointers Made', ...col('fg3_per_g'), def: 0.5 },
    { id: '3PA', name: 'Three Pointers Attempted', ...col('fg3a_per_g'), def: 0 },
    { id: '3PMI', name: 'Three Pointers Missed', ...missed('fg3_per_g', 'fg3a_per_g'), def: 0 },
    { id: 'OREB', name: 'Offensive Rebounds', ...col('orb_per_g'), def: 0.5 },
    { id: 'DREB', name: 'Defensive Rebounds', ...col('drb_per_g'), def: 0 },
    { id: 'REB', name: 'Rebounds', ...col('trb_per_g'), def: 1 },
    { id: 'AST', name: 'Assists', ...col('ast_per_g'), def: 2 },
    { id: 'STL', name: 'Steals', ...col('stl_per_g'), def: 4 },
    { id: 'BLK', name: 'Blocks', ...col('blk_per_g'), def: 4 },
    { id: 'TO', name: 'Turnovers', ...col('tov_per_g'), def: -2 },
    { id: 'PF', name: 'Personal Fouls', ...col('pf_per_g'), def: 0 },
    { id: 'PTS', name: 'Points', ...col('pts_per_g'), def: 1 },
    { id: 'TD', name: 'Triple Doubles', cols: null, estimated: true, def: 3 },
    { id: 'DD', name: 'Double Doubles', cols: null, def: 0 }
  ];

  function defaults() {
    const o = {};
    CATEGORIES.forEach((c) => { o[c.id] = c.def; });
    return o;
  }

  // Normalizes a saved scoring map: every category present, numbers only.
  function normalize(map) {
    const out = defaults();
    if (map && typeof map === 'object') {
      CATEGORIES.forEach((c) => { const n = Number(map[c.id]); if (map[c.id] !== undefined && isFinite(n)) out[c.id] = n; });
    }
    return out;
  }

  // Average fantasy points per game for one season row, or null when the
  // file lacks a column a scored (non-zero) category needs. A blank cell
  // counts as 0. Categories with no per-game data are skipped.
  function average(scoring, columns, values) {
    const ids = new Set(columns.map((c) => c.id));
    const weights = normalize(scoring);
    let total = 0;
    for (const c of CATEGORIES) {
      const w = weights[c.id];
      if (!w || !c.cols) continue;
      if (!c.cols.every((id) => ids.has(id))) return null;
      const num = {};
      c.cols.forEach((id) => { const n = parseFloat(values[id]); num[id] = Number.isNaN(n) ? 0 : n; });
      total += w * c.stat(num);
    }
    return total;
  }

  global.Scoring = { CATEGORIES, defaults, normalize, average };
})(window);
