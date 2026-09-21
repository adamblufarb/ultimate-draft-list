/* Touch-friendly drag-to-reorder list using Pointer Events (works for mouse,
   touch, and pen) with absolute-positioned rows for smooth reflow. */
(function (global) {
  class ReorderableList {
    // container: element to hold rows (position:relative is set for you)
    // renderRow(item, index): returns a row element; may include a child
    //   marked [data-drag-handle] (grab handle)
    // onReorder(items): called with the new item order after a drop
    // gap: vertical space (px) between rows — since rows are absolutely
    //   positioned, a row's own CSS margin has no effect here; this is the
    //   only thing that controls spacing.
    // canDrag(key): optional — return false to make that row's handle inert.
    //   Checked fresh on every pointerdown, not cached, so it stays correct
    //   even though rows aren't recreated when e.g. a lock toggles.
    // dividerEvery / renderDivider(count): optional — a non-draggable,
    //   non-interactive marker (e.g. "— 10 —") inserted after every Nth
    //   row. Rows keep their own uniform height/spacing; dividers just add
    //   extra vertical space before the row they precede. Divider position
    //   is index-based, not item-based, so it never moves mid-drag — only
    //   the offset table (see _computeOffsets) needs to account for it.
    constructor(container, { renderRow, onReorder, gap = 0, canDrag, dividerEvery = 0, renderDivider }) {
      this.container = container;
      this.renderRow = renderRow;
      this.onReorder = onReorder;
      this.gap = gap;
      this.canDrag = canDrag || (() => true);
      this.dividerEvery = dividerEvery;
      this.renderDivider = renderDivider || null;
      this.items = [];
      this.rows = [];
      this.rowHeight = 0;
      this.slotHeight = 0;
      this.dividerHeight = 0;
      this.dividerSlotHeight = 0;
      this.offsets = [];
      this.dragState = null;
      this.container.style.position = 'relative';
    }

    setItems(items) {
      this.items = items.slice();
      this._renderAll();
    }

    getOrder() {
      return this.items.slice();
    }

    // offsets[i] = top px for row i, accounting for any divider slots
    // inserted before it. Index-based and constant for the life of this
    // render pass — reordering which item sits at index i never changes
    // offsets[i] itself, so drag math and divider placement can both use
    // it as a stable lookup table.
    _computeOffsets() {
      const offsets = [];
      let cursor = 0;
      for (let i = 0; i < this.rows.length; i++) {
        if (this.dividerEvery > 0 && i > 0 && i % this.dividerEvery === 0) {
          cursor += this.dividerSlotHeight;
        }
        offsets[i] = cursor;
        cursor += this.slotHeight;
      }
      return offsets;
    }

    _renderAll() {
      this.container.innerHTML = '';
      this.rows = [];
      this.items.forEach((item, index) => {
        const row = this.renderRow(item, index);
        row.style.position = 'absolute';
        row.style.left = '0';
        row.style.right = '0';
        row.dataset.key = item.key;
        this.container.appendChild(row);
        this.rows.push(row);
      });

      requestAnimationFrame(() => {
        if (this.rows.length > 0) {
          this.rowHeight = this.rows[0].getBoundingClientRect().height;
          this.slotHeight = this.rowHeight + this.gap;
        }

        if (this.dividerEvery > 0 && this.renderDivider) {
          const probe = this.renderDivider(this.dividerEvery);
          probe.style.position = 'absolute';
          probe.style.visibility = 'hidden';
          probe.style.left = '0';
          probe.style.right = '0';
          this.container.appendChild(probe);
          this.dividerHeight = probe.getBoundingClientRect().height;
          this.container.removeChild(probe);
          this.dividerSlotHeight = this.dividerHeight + this.gap;
        }

        this.offsets = this._computeOffsets();

        this.rows.forEach((row, i) => {
          row.style.top = this.offsets[i] + 'px';
          row.classList.toggle('row-alt', i % 2 === 1);
        });

        if (this.dividerEvery > 0 && this.renderDivider) {
          for (let i = 0; i < this.rows.length; i++) {
            if (i > 0 && i % this.dividerEvery === 0) {
              const divider = this.renderDivider(i);
              divider.style.position = 'absolute';
              divider.style.left = '0';
              divider.style.right = '0';
              divider.style.top = (this.offsets[i] - this.dividerSlotHeight) + 'px';
              divider.style.height = this.dividerHeight + 'px';
              this.container.appendChild(divider);
            }
          }
        }

        const totalHeight = this.rows.length > 0
          ? this.offsets[this.rows.length - 1] + this.slotHeight - this.gap
          : 0;
        this.container.style.height = totalHeight + 'px';
        this._attachHandlers();
      });
    }

    _attachHandlers() {
      this.rows.forEach((row) => {
        const handle = row.querySelector('[data-drag-handle]') || row;
        handle.style.touchAction = 'none';
        handle.addEventListener('pointerdown', (e) => this._onPointerDown(e, row));
      });
    }

    _onPointerDown(e, row) {
      if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
      if (!this.canDrag(row.dataset.key)) return;
      e.preventDefault();
      const startIndex = this.rows.indexOf(row);
      const startTop = this.offsets[startIndex];

      row.style.transition = 'none';
      row.style.zIndex = '10';
      row.classList.add('dragging');
      try { row.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }

      const onMove = (ev) => this._onPointerMove(ev);
      const onUp = (ev) => this._onPointerUp(ev, row, onMove, onUp);

      this.dragState = {
        row, startIndex, currentIndex: startIndex, startY: e.clientY, startTop, pointerId: e.pointerId, moved: false
      };

      row.addEventListener('pointermove', onMove);
      row.addEventListener('pointerup', onUp);
      row.addEventListener('pointercancel', onUp);
    }

    // Nearest row index for a given pixel offset — a linear scan over the
    // (monotonically increasing) offsets table. List lengths here run in
    // the hundreds at most, so this stays effectively free even at
    // pointermove's event rate.
    _indexForTop(top) {
      let closest = 0;
      let closestDist = Infinity;
      for (let i = 0; i < this.offsets.length; i++) {
        const dist = Math.abs(this.offsets[i] - top);
        if (dist < closestDist) {
          closestDist = dist;
          closest = i;
        }
      }
      return closest;
    }

    _onPointerMove(e) {
      const ds = this.dragState;
      if (!ds) return;
      const dy = e.clientY - ds.startY;
      if (!ds.moved && Math.abs(dy) > 4) ds.moved = true;
      let newTop = ds.startTop + dy;
      const maxTop = this.offsets[this.rows.length - 1];
      newTop = Math.max(0, Math.min(maxTop, newTop));
      ds.row.style.top = newTop + 'px';

      const newIndex = this._indexForTop(newTop);
      if (newIndex !== ds.currentIndex) {
        this._moveItem(ds.currentIndex, newIndex);
        ds.currentIndex = newIndex;
      }
    }

    _moveItem(from, to) {
      const item = this.items.splice(from, 1)[0];
      this.items.splice(to, 0, item);
      const row = this.rows.splice(from, 1)[0];
      this.rows.splice(to, 0, row);

      this.rows.forEach((r, i) => {
        r.classList.toggle('row-alt', i % 2 === 1);
        if (r === this.dragState.row) return;
        r.style.top = this.offsets[i] + 'px';
      });
    }

    _onPointerUp(e, row, onMove, onUp) {
      const ds = this.dragState;
      if (!ds) return;
      try { row.releasePointerCapture(ds.pointerId); } catch (err) { /* ignore */ }
      row.removeEventListener('pointermove', onMove);
      row.removeEventListener('pointerup', onUp);
      row.removeEventListener('pointercancel', onUp);

      row.style.transition = '';
      row.style.top = this.offsets[ds.currentIndex] + 'px';
      row.style.zIndex = '';
      row.classList.remove('dragging');

      // A real drag (pointer moved past the threshold) still ends with the
      // browser firing a "ghost" click afterward — and since rows shift
      // under the finger while dragging, that click can land on a
      // completely different row's button (e.g. toggling some other
      // player's lock) rather than the one that was actually dragged.
      // Swallow the very next click anywhere in the list, in the capture
      // phase, so it never reaches any row's/button's own listener.
      if (ds.moved) {
        const suppressClick = (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        this.container.addEventListener('click', suppressClick, { capture: true, once: true });
      }

      this.dragState = null;
      this.onReorder(this.items.slice());
    }
  }

  global.ReorderableList = ReorderableList;
})(window);
