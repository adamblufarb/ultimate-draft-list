/* Player-identity matching: normalize display names into a comparable key
   so minor spelling differences between sources still line up. */
(function (global) {
  const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

  function normalize(name) {
    if (!name) return '';
    let n = name.normalize('NFD').replace(/[̀-ͯ]/g, ''); // strip accents
    n = n.toLowerCase();
    n = n.replace(/[.,'’`\-]/g, ' ');       // punctuation -> space
    n = n.replace(/[^a-z0-9\s]/g, '');      // drop anything else non-alphanumeric
    n = n.replace(/\s+/g, ' ').trim();
    const words = n.split(' ').filter(Boolean);
    if (words.length > 1 && SUFFIXES.has(words[words.length - 1])) {
      words.pop();
    }
    return words.join(' ');
  }

  global.NameMatch = { normalize };
})(window);
