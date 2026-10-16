/* Shared config used across tabs. */
(function (global) {
  // Field names GitHub's Contents API uses to describe a file. They are never
  // part of the app's state — if they turn up in it, a metadata reply was once
  // mistaken for the data (the 2026-10-09 incident) and they get stripped.
  const GITHUB_RESPONSE_KEYS = ['_links', 'content', 'download_url', 'encoding', 'git_url', 'html_url', 'name', 'path', 'sha', 'size', 'type', 'url'];
  // The Data List and the Basketball-Reference stat files spell three teams
  // differently (Data List: BKN, PHX, CHA — stats: BRK, PHO, CHO). Compared as
  // written they looked like players who changed teams. canonTeam() maps every
  // spelling to one code so teams can be compared safely.
  const TEAM_ALIASES = { BKN: 'BRK', PHX: 'PHO', CHA: 'CHO' };
  function canonTeam(code) {
    const t = String(code || '').trim().toUpperCase();
    return TEAM_ALIASES[t] || t;
  }

  // One spelling to *show* everywhere: the Data List's (BKN, PHX, CHA), so a
  // team never appears as BKN in one place and BRK in another.
  const DISPLAY_TEAM = { BRK: 'BKN', PHO: 'PHX', CHO: 'CHA' };
  function displayTeam(code) {
    const t = String(code || '').trim().toUpperCase();
    return DISPLAY_TEAM[t] || t;
  }

  const MAX_SOURCES = 12;
  // Season Stats upload slots (most recent season first). Health/trend emoji
  // only ever look at the first HEALTH_TREND_SEASONS of them; older slots are
  // for viewing in Player Detail.
  const SEASON_SLOTS = 4;
  const HEALTH_TREND_SEASONS = 3;

  // What the "Score" number in a pasted list means. Selected per-source in
  // the Sources tab (not embedded in the pasted text itself). 'adp' is a
  // different beast from the rest — it switches the paste format itself
  // (Sources tab) to plain Name/ADP-score blocks, no rank line, since an
  // ADP list's order doesn't correlate with its score the way a rank does
  // (see js/parser.js's parseADPList and js/ranking.js's ADP note).
  const SCORE_TYPES = [
    { value: 'none', label: 'No score data' },
    { value: 'ly_avg', label: 'Last year – Avg/Game' },
    { value: 'ly_total', label: 'Last year – Total' },
    { value: 'ty_avg_proj', label: 'This year – Avg/Game Projection' },
    { value: 'ty_total_proj', label: 'This year – Total Projection' },
    { value: 'adp', label: 'ADP (Average Draft Position)' }
  ];

  function scoreTypeLabel(value) {
    const found = SCORE_TYPES.find((s) => s.value === value);
    return found ? found.label : value;
  }

  function formatScore(score) {
    if (score === null || score === undefined) return null;
    return Number.isInteger(score) ? String(score) : score.toFixed(1);
  }

  global.Constants = {
displayTeam, canonTeam, TEAM_ALIASES, GITHUB_RESPONSE_KEYS, MAX_SOURCES, SEASON_SLOTS, HEALTH_TREND_SEASONS, SCORE_TYPES, scoreTypeLabel, formatScore };
})(window);
