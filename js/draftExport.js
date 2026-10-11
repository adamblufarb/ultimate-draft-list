/* Draft Board "Export Draft": builds a PDF of every pick, in the app's design
   with a light palette (white page), and downloads it. Only what a printed draft board needs: the pick
   number (outside the card, like the Draft Board), the player's name and
   positions, and a round indicator at the start of each round — no tags, no
   combined rank, no blue highlight for your own picks.

   The PDF is written by hand (no libraries, works offline): one content
   stream per page using the built-in Helvetica fonts, so names are reduced to
   plain Latin letters (Dončić -> Doncic). The page itself is 40% narrower than
   US Letter (367pt wide, same 792pt height), cropped around the narrow card
   column. */
(function (global) {
  const PAGE_W = 367;      // 60% of US Letter's 612pt width: the page is cropped to the card column
  const PAGE_H = 792;
  const MARGIN = 36;
  const ROW_H = 28;
  const GAP = 6;
  const DIVIDER_H = 26;
  const NUM_W = 34;        // pick-number column, left of the cards
  const CARD_W = 290;      // card width (the earlier full-width cards were ~484)
  const COLORS = {         // the app's design in a light palette (white page). A black page was
                           // tried and dropped: the phone's PDF viewer draws a thin page outline
                           // that shows against it and can't be turned off from inside the file.
    bg: '#ffffff', surface: '#f4f5f8', rowAlt: '#e9ecf1', border: '#d3d8e0',
    text: '#14171c', dim: '#6b7380'
  };

  const rgb = (hex) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
  // Helvetica (WinAnsi) can't draw most accented letters: strip accents, drop the rest.
  const clean = (text) => String(text == null ? '' : text)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

  // Rounded rectangle path (bottom-left origin).
  function roundedRect(x, y, w, h, r) {
    const k = 0.5523 * r;
    return [
      `${x + r} ${y} m`, `${x + w - r} ${y} l`,
      `${x + w - r + k} ${y} ${x + w} ${y + r - k} ${x + w} ${y + r} c`, `${x + w} ${y + h - r} l`,
      `${x + w} ${y + h - r + k} ${x + w - r + k} ${y + h} ${x + w - r} ${y + h} c`, `${x + r} ${y + h} l`,
      `${x + r - k} ${y + h} ${x} ${y + h - r + k} ${x} ${y + h - r} c`, `${x} ${y + r} l`,
      `${x} ${y + r - k} ${x + r - k} ${y} ${x + r} ${y} c`, 'h'
    ].join('\n');
  }

  // picks: [{ number, name, positions }]; roundSize: picks per round.
  function buildPdf(picks, roundSize) {
    // 1) lay everything out into pages of drawing commands
    const pages = [];
    let ops = null;
    let y = 0;
    const newPage = () => {
      ops = [`${rgb(COLORS.bg)} rg`, `0 0 ${PAGE_W} ${PAGE_H} re f`];
      pages.push(ops);
      y = PAGE_H - MARGIN;
    };
    const text = (str, x, baseline, size, font, color) => {
      ops.push('BT', `/${font} ${size} Tf`, `${rgb(color)} rg`, `${x.toFixed(2)} ${baseline.toFixed(2)} Td`, `(${clean(str)}) Tj`, 'ET');
    };
    newPage();
    // The number column + card form one block, centered on the page.
    const blockW = NUM_W + 8 + CARD_W;
    const left = (PAGE_W - blockW) / 2;
    const x0 = left + NUM_W + 8;           // card's left edge
    picks.forEach((pick, i) => {
      const startsRound = i % roundSize === 0;
      const need = (startsRound ? DIVIDER_H + GAP : 0) + ROW_H;
      if (y - need < MARGIN) newPage();
      if (startsRound) {
        const label = 'Round ' + (i / roundSize + 1);
        const mid = x0 + CARD_W / 2;
        const half = label.length * 3.4;                    // ~half the label's width at 11pt bold
        const baseline = y - DIVIDER_H + 8;
        ops.push(`${rgb(COLORS.border)} RG`, '0.8 w', `${x0} ${baseline + 4} m ${mid - half - 10} ${baseline + 4} l S`,
          `${mid + half + 10} ${baseline + 4} m ${x0 + CARD_W} ${baseline + 4} l S`);
        text(label, mid - half, baseline, 11, 'F2', COLORS.dim);
        y -= DIVIDER_H + GAP;
      }
      const top = y;
      ops.push(`${rgb(i % 2 === 1 ? COLORS.rowAlt : COLORS.surface)} rg`, `${rgb(COLORS.border)} RG`, '0.6 w',
        roundedRect(x0, top - ROW_H, CARD_W, ROW_H, 7), 'B');
      const baseline = top - ROW_H / 2 - 4;
      text(String(pick.number), left, baseline, 12, 'F2', COLORS.dim);
      text(pick.name, x0 + 12, baseline, 13, 'F1', COLORS.text);   // regular weight
      text(pick.positions || '', x0 + CARD_W - 64, baseline, 11, 'F1', COLORS.dim);
      y -= ROW_H + GAP;
    });

    // 2) serialize: catalog, pages, 2 fonts, then page + content per page
    const objs = [];
    const add = (body) => { objs.push(body); return objs.length; };
    const pagesId = 2;
    add('<< /Type /Catalog /Pages 2 0 R >>');
    add('PLACEHOLDER');
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    pages.forEach((pageOps) => {
      const stream = pageOps.join('\n');
      const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`);
      kids.push(`${pageId} 0 R`);
    });
    objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
    let pdf = '%PDF-1.4\n';
    const offsets = [];
    objs.forEach((body, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
    const xref = pdf.length;
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    offsets.forEach((o) => { pdf += `${String(o).padStart(10, '0')} 00000 n \n`; });
    pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return pdf;
  }

  function download(picks, roundSize) {
    const pdf = buildPdf(picks, roundSize);
    const bytes = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 255;
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'draft-picks.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  global.DraftExport = { buildPdf, download };
})(window);
