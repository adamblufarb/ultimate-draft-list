/* Tab — Notes: free-standing notes (separate from the per-player notes box
   in Player Detail). Add a note, edit it, delete it. Newest first; an
   edited note keeps its place. Cards follow the Sources tab's look: a
   read-only view with Edit/Delete, switching to a textarea with Save/Cancel
   while editing. Several notes can be open for editing at once; unsaved
   text survives a re-render and tab switches (the panel stays in the DOM),
   and the tab only re-renders on its own actions or a remote state load. */
(function (global) {
  let container;
  // Ids of existing notes currently open in their editor.
  const editingIds = new Set();
  let composing = false;
  // Unsaved text for open editors, so a re-render (e.g. opening a second
  // editor) doesn't wipe what's been typed in the first.
  const drafts = new Map();

  function init(rootEl) {
    container = rootEl;
    App.on('remote-state-loaded', render);
    render();
  }

  function render() {
    container.innerHTML = '';

    if (composing) {
      container.appendChild(renderEditCard(null));
    } else {
      const addBtn = document.createElement('button');
      addBtn.className = 'btn btn-primary btn-add-source';
      addBtn.textContent = '+ Add Note';
      addBtn.addEventListener('click', () => {
        composing = true;
        render();
        const ta = container.querySelector('textarea');
        if (ta) ta.focus();
      });
      container.appendChild(addBtn);
    }

    const list = document.createElement('div');
    list.className = 'source-list notes-list';
    App.state.notes.forEach((note) => {
      list.appendChild(editingIds.has(note.id) ? renderEditCard(note) : renderViewCard(note));
    });
    container.appendChild(list);

    if (App.state.notes.length === 0 && !composing) {
      const empty = document.createElement('p');
      empty.className = 'empty-hint';
      empty.textContent = 'No notes yet. Add one to jot something down.';
      container.insertBefore(empty, list);
    }
  }

  function renderViewCard(note) {
    const card = document.createElement('div');
    card.className = 'source-card note-card';
    card.dataset.noteId = note.id;

    const text = document.createElement('div');
    text.className = 'note-text';
    text.textContent = note.text;
    card.appendChild(text);

    const actions = document.createElement('div');
    actions.className = 'source-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-secondary';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      editingIds.add(note.id);
      render();
      const ta = container.querySelector('[data-note-id="' + CSS.escape(note.id) + '"] textarea');
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      if (!confirm('Delete this note? This cannot be undone.')) return;
      App.deleteNote(note.id);
      editingIds.delete(note.id);
      drafts.delete(note.id);
      render();
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    card.appendChild(actions);
    return card;
  }

  // note === null means the new-note form.
  function renderEditCard(note) {
    const draftKey = note ? note.id : 'new';
    const card = document.createElement('div');
    card.className = 'source-card note-card';
    if (note) card.dataset.noteId = note.id;

    const ta = document.createElement('textarea');
    ta.className = 'note-input';
    ta.rows = 4;
    ta.placeholder = 'Write a note…';
    ta.value = drafts.has(draftKey) ? drafts.get(draftKey) : (note ? note.text : '');
    ta.addEventListener('input', () => { drafts.set(draftKey, ta.value); });
    card.appendChild(ta);

    const actions = document.createElement('div');
    actions.className = 'source-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
      const value = ta.value.trim();
      if (!value) {
        // An empty note isn't worth keeping: for an existing one that
        // means "delete" (ask first); for a new one it's just a cancel.
        if (note) {
          if (!confirm('This note is empty. Delete it?')) return;
          App.deleteNote(note.id);
        }
      } else {
        App.upsertNote(value, note ? note.id : undefined);
      }
      close(draftKey);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => close(draftKey));

    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    card.appendChild(actions);
    return card;
  }

  function close(draftKey) {
    if (draftKey === 'new') composing = false; else editingIds.delete(draftKey);
    drafts.delete(draftKey);
    render();
  }

  global.NotesTab = { init, render };
})(window);
