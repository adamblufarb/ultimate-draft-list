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
    constructor(container, { renderRow, onReorder, gap = 0, canDrag }) {
      this.container = container;
      this.renderRow = renderRow;
      this.onReorder = onReorder;
      this.gap = gap;
      this.canDrag = canDrag || (() => true);
      this.items = [];
      this.rows = [];
      this.rowHeight = 0;
      this.slotHeight = 0;
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
          this.rows.forEach((row, i) => {
            row.style.top = (i * this.slotHeight) + 'px';
            row.classList.toggle('row-alt', i % 2 === 1);
          });
        }
        const totalHeight = this.rows.length > 0
          ? (this.rows.length * this.slotHeight) - this.gap
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
      const startTop = startIndex * this.slotHeight;

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

    _onPointerMove(e) {
      const ds = this.dragState;
      if (!ds) return;
      const dy = e.clientY - ds.startY;
      if (!ds.moved && Math.abs(dy) > 4) ds.moved = true;
      let newTop = ds.startTop + dy;
      const maxTop = (this.rows.length - 1) * this.slotHeight;
      newTop = Math.max(0, Math.min(maxTop, newTop));
      ds.row.style.top = newTop + 'px';

      const newIndex = Math.round(newTop / this.slotHeight);
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
        r.style.top = (i * this.slotHeight) + 'px';
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
      row.style.top = (ds.currentIndex * this.slotHeight) + 'px';
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
