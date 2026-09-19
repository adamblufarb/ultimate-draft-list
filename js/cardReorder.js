/* Touch-friendly reorder for variable-height cards kept in normal document
   flow (unlike ReorderableList, which assumes uniform row height and
   absolute positioning — not a good fit for source cards, whose height
   varies a lot between the collapsed and edit views).

   As the dragged card crosses a neighbor's midpoint, the DOM order is
   swapped live (insertBefore), and the drag offset is compensated by the
   neighbor's height so the dragged card never visually jumps. */
(function (global) {
  function attach(container, { onReorder, gap = 0 } = {}) {
    function attachHandle(handle, row) {
      handle.style.touchAction = 'none';
      handle.addEventListener('pointerdown', (e) => onPointerDown(e, row));
    }

    function onPointerDown(e, row) {
      if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();

      let startY = e.clientY;
      let dy = 0;
      let moved = false;

      row.style.position = 'relative';
      row.style.zIndex = '10';
      row.classList.add('dragging');
      // No setPointerCapture here: this component moves `row` itself in the
      // DOM (insertBefore) as it crosses a neighbor's midpoint, and several
      // browsers silently release pointer capture when the captured element
      // is removed/reinserted — even momentarily, within the same parent.
      // Listening on the document instead keeps tracking the drag no matter
      // how the DOM around `row` gets reshuffled mid-gesture.

      function applyTransform() {
        row.style.transform = `translateY(${dy}px)`;
      }

      function onMove(ev) {
        dy = ev.clientY - startY;
        if (!moved && Math.abs(dy) > 4) moved = true;
        applyTransform();

        let guard = 0;
        let next = row.nextElementSibling;
        while (next && guard < 50) {
          guard++;
          const rowRect = row.getBoundingClientRect();
          const nextRect = next.getBoundingClientRect();
          if (rowRect.top + rowRect.height / 2 <= nextRect.top + nextRect.height / 2) break;
          const shift = nextRect.height + gap;
          container.insertBefore(next, row);
          startY += shift;
          dy = ev.clientY - startY;
          applyTransform();
          next = row.nextElementSibling;
        }

        guard = 0;
        let prev = row.previousElementSibling;
        while (prev && guard < 50) {
          guard++;
          const rowRect = row.getBoundingClientRect();
          const prevRect = prev.getBoundingClientRect();
          if (rowRect.top + rowRect.height / 2 >= prevRect.top + prevRect.height / 2) break;
          const shift = prevRect.height + gap;
          container.insertBefore(row, prev);
          startY -= shift;
          dy = ev.clientY - startY;
          applyTransform();
          prev = row.previousElementSibling;
        }
      }

      function onUp() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);

        row.style.transform = '';
        row.style.position = '';
        row.style.zIndex = '';
        row.classList.remove('dragging');

        if (moved) {
          row.dataset.justDragged = '1';
          requestAnimationFrame(() => requestAnimationFrame(() => {
            delete row.dataset.justDragged;
          }));
          onReorder();
        }
      }

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    }

    return { attachHandle };
  }

  global.CardReorder = { attach };
})(window);
