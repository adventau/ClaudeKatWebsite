/* ═══════════════════════════════════════════════════════════════════
   THE ROYAL KAT & KAI VAULT — Main Application Logic
═══════════════════════════════════════════════════════════════════ */

'use strict';

// ── Utility ──────────────────────────────────────────────────────────
function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ── Site Time Override ────────────────────────────────────────────────
// When an eval "time set" command is active, _timeOffsetMs shifts all
// time-sensitive features (bell schedule, reminders, etc.) as if it
// were actually that time.
window._timeOffsetMs = 0;

function parseTimeOffset(offset) {
  if (!offset) return 0;
  // Relative: +2h, -30m, +1d, +90s
  const rel = offset.match(/^([+-])(\d+(?:\.\d+)?)(h|m|s|d)$/i);
  if (rel) {
    const sign = rel[1] === '+' ? 1 : -1;
    const val  = parseFloat(rel[2]);
    const unit = rel[3].toLowerCase();
    const ms   = unit === 'h' ? val * 3600000
               : unit === 'm' ? val * 60000
               : unit === 's' ? val * 1000
               : val * 86400000; // d
    return sign * ms;
  }
  // Absolute ISO date → compute delta from real now
  const abs = new Date(offset);
  if (!isNaN(abs)) return abs.getTime() - Date.now();
  return 0;
}

/** Returns the current site time, respecting any active time override. */
function getNow() {
  return new Date(Date.now() + window._timeOffsetMs);
}
/** Returns current site time as ms timestamp. */
function getNowMs() {
  return Date.now() + window._timeOffsetMs;
}
  });

  socket.on('show-update-log', ({ target }) => {
    if (target === 'both' || target === currentUser) {
      localStorage.removeItem('rkk-changelog-dismissed-' + currentUser);
      checkAndShowUpdateLog();
    }
  });

  socket.on('show-custom-update-log', ({ target, message }) => {
    if (target === 'both' || target === currentUser) {
      const container = document.getElementById('update-log-content');
      container.innerHTML = `<div style="font-size:0.85rem;line-height:1.6;white-space:pre-wrap">${escapeHtml(message)}</div>`;
      openModal('update-log-modal');
    }
  });

  socket.on('force-reload', () => {
    window.location.reload();
  });

  // Shared wallpaper
  socket.on('wallpaper-changed', ({ wallpaper }) => {
    const me = allUsers?.[currentUser];
    if (me?.wallpaperEnabled !== false) applyWallpaper(wallpaper);
  });

  // WebRTC
  socket.on('call-offer', handleCallOffer);
  socket.on('call-answer', handleCallAnswer);
  socket.on('call-ice-candidate', handleIceCandidate);
  socket.on('call-ended', () => endCall(true));
  socket.on('call-camera-toggle', ({ user, cameraOn }) => {
    if (!inCall || user === currentUser) return;
    const remoteVid = document.getElementById('call-video-remote');
    const remoteBg = document.getElementById('call-remote-avatar-bg');
    if (cameraOn) {
      remoteVid.style.display = 'block';
      remoteBg.style.display = 'none';
    } else {
      remoteVid.style.display = 'none';
      remoteBg.style.display = 'flex';
    }
  });
}

async function markMessageRead(msgId) {
  if (stealthMode) return; // Don't mark messages as read in stealth mode
  await fetch(`/api/messages/${msgId}/read`, { method: 'POST' });
}

// ── Brainstorm ────────────────────────────────────────────────────────
async function loadBrainstorm() {
  brainstormMessages = await fetch('/api/brainstorm').then(r => r.json()) || [];
  renderBrainstorm();
}

function renderBrainstorm() {
  const area = document.getElementById('brainstorm-messages');
  area.innerHTML = '';
  if (!brainstormMessages.length) {
    area.innerHTML = '<div class="empty-state" id="brainstorm-empty"><div class="empty-state-icon">💡</div><div class="empty-state-text">Throw ideas out there!</div></div>';
    return;
  }
  brainstormMessages.forEach(m => area.appendChild(buildBrainstormMsg(m)));
  area.scrollTop = area.scrollHeight;
}

function buildBrainstormMsg(msg) {
  const isSelf = msg.sender === currentUser;
  const div = document.createElement('div');
  div.className = `msg-row ${isSelf ? 'self' : 'other'}`;
  div.innerHTML = `
    <div class="msg-bubble ${isSelf ? 'msg-bubble-self' : 'msg-bubble-other'}" style="position:relative">
      <div style="font-size:0.7rem;opacity:0.7;margin-bottom:3px">${capitalize(msg.sender)}</div>
      ${msg.text}
      <div class="msg-meta"><span>${formatTime(msg.timestamp)}</span></div>
    </div>`;
  return div;
}

async function sendBrainstorm() {
  const input = document.getElementById('brainstorm-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  SoundSystem.send();
  await fetch('/api/brainstorm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
}

async function clearBrainstorm() {
  const ok = await showConfirmDialog({ icon: '💡', title: 'Clear brainstorm board?', msg: 'Messages are still saved on the server.', okText: 'Clear', danger: false });
  if (!ok) return;
  document.getElementById('brainstorm-messages').innerHTML =
    '<div class="empty-state" id="brainstorm-empty"><div class="empty-state-icon">💡</div><div class="empty-state-text">Board cleared locally.</div></div>';
}

// ── Notes ─────────────────────────────────────────────────────────────
async function loadNotes() {
  const url = stealthMode ? `/api/notes?viewAs=${currentUser}` : '/api/notes';
  const data = await fetch(url).then(r => r.json());
  allNotes = data;
  renderNotesList();
}

function switchNotesTab(tab, el) {
  notesTab = tab;
  document.querySelectorAll('#section-notes .section-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderNotesList();
}

function renderNotesList() {
  const list = document.getElementById('notes-list');
  let notes = [];
  if (notesTab === 'mine') notes = (allNotes.mine || []).filter(n => !n.archived);
  else if (notesTab === 'shared') notes = allNotes.shared || [];
  else notes = (allNotes.mine || []).filter(n => n.archived);

  if (!notes.length) {
    list.innerHTML = '<div class="empty-state" style="height:200px"><div class="empty-state-icon"><i data-lucide="file-text" style="width:48px;height:48px;opacity:0.4"></i></div><div class="empty-state-text">No notes here</div></div>';if(window.lucide)lucide.createIcons();
    return;
  }
  list.innerHTML = notes.map(n => `
    <div class="note-item ${n.id === activeNoteId ? 'active' : ''}" onclick="openNote('${n.id}')">
      <div class="note-item-title">${n.title}</div>
      <div class="note-item-preview">${n.type === 'todo' ? 'Todo list' : (n.content?.substring(0,60) || '…')}</div>
      <div class="note-item-meta">
        ${n.pinned ? '<span class="tag tag-pinned">📌</span>' : ''}
        ${n.sharedWith?.length ? '<span class="tag tag-shared">Shared</span>' : ''}
        ${n.archived ? '<span class="tag tag-archived">Archived</span>' : ''}
        <span>${formatDate(n.updatedAt)}</span>
      </div>
    </div>`).join('');
}

function openNote(id) {
  activeNoteId = id;
  const allN = [...(allNotes.mine || []), ...(allNotes.shared || [])];
  const note = allN.find(n => n.id === id);
  if (!note) return;
  renderNotesList(); // refresh active state

  const editor = document.getElementById('notes-editor');
  const isOwn = (allNotes.mine || []).some(n => n.id === id);

  if (note.type === 'todo') {
    const doneCount = (note.todos||[]).filter(t => t.done).length;
    const totalCount = (note.todos||[]).length;
    const pct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
    editor.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;gap:8px">
        <input type="text" id="edit-note-title" value="${note.title}" style="font-size:1.1rem;font-weight:700;flex:1" ${isOwn?'':'readonly'}>
        <div style="display:flex;gap:6px;flex-shrink:0">
          ${isOwn ? `
            <button class="btn-ghost" onclick="shareNote('${id}')" title="${note.sharedWith?.includes(otherUser) ? 'Unshare' : 'Share'}"><i data-lucide="link"></i> Share</button>
            <button class="btn-ghost" onclick="archiveNote('${id}')" title="${note.archived ? 'Unarchive' : 'Archive'}"><i data-lucide="archive"></i> Archive</button>
            <button class="btn-danger" onclick="deleteNote('${id}')" title="Delete"><i data-lucide="trash-2"></i></button>
          ` : ''}
        </div>
      </div>
      ${totalCount ? `<div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:0.72rem;color:var(--text-muted)">${doneCount} of ${totalCount} complete</span>
          <span style="font-size:0.72rem;font-weight:600;color:var(--accent)">${pct}%</span>
        </div>
        <div style="height:4px;border-radius:2px;background:var(--border);overflow:hidden">
          <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:2px;transition:width 0.3s"></div>
        </div>
      </div>` : ''}
      <div id="todo-list-editor">
        ${(note.todos||[]).map((item, i) => `
          <div class="todo-item ${item.done ? 'done' : ''}" onclick="toggleTodoItem('${id}',${i},${!item.done})">
            <div class="todo-check">
              <span class="todo-check-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>
            </div>
            <span class="todo-item-text">${item.text}</span>
            ${isOwn ? `<button class="todo-item-edit" onclick="event.stopPropagation();editTodoItem('${id}',${i})" title="Edit"><i data-lucide="pencil" style="width:12px;height:12px"></i></button>` : ''}
            ${isOwn ? `<button class="todo-item-del" onclick="event.stopPropagation();removeTodoItem('${id}',${i})" title="Remove">✕</button>` : ''}
          </div>`).join('')}
        ${isOwn ? `<div style="margin-top:8px;display:flex;gap:6px">
          <input type="text" id="new-todo-item" placeholder="Add a task…" style="flex:1" onkeydown="if(event.key==='Enter'){addTodoItemToNote('${id}');event.preventDefault()}">
          <button class="btn-primary" onclick="addTodoItemToNote('${id}')" style="border-radius:10px;padding:8px 16px">Add</button>
        </div>` : ''}
      </div>
      ${isOwn ? '<button class="btn-primary" onclick="saveCurrentNote()" style="margin-top:1rem;width:100%;border-radius:10px">Save Changes</button>' : ''}`;
    if (window.lucide) lucide.createIcons();
    // Setup drag to reorder for todo items
    if (isOwn) setupTodoDragReorder(id);
  } else {
    editor.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;gap:8px">
        <input type="text" id="edit-note-title" value="${note.title}" style="font-size:1.1rem;font-weight:700;flex:1" ${isOwn?'':'readonly'}>
        <div style="display:flex;gap:6px;flex-shrink:0">
          ${isOwn ? `
            <button class="btn-ghost" onclick="shareNote('${id}')" title="${note.sharedWith?.includes(otherUser) ? 'Unshare' : 'Share'}"><i data-lucide="link"></i> Share</button>
            <button class="btn-ghost" onclick="archiveNote('${id}')" title="${note.archived ? 'Unarchive' : 'Archive'}"><i data-lucide="archive"></i> Archive</button>
            <button class="btn-danger" onclick="deleteNote('${id}')" title="Delete"><i data-lucide="trash-2"></i></button>
          ` : ''}
        </div>
      </div>
      <textarea id="edit-note-content" rows="20" style="width:100%;border-radius:10px;line-height:1.75" ${isOwn?'':'readonly'}>${note.content||''}</textarea>
      ${isOwn ? '<button class="btn-primary" onclick="saveCurrentNote()" style="margin-top:1rem;width:100%;border-radius:10px">Save Changes</button>' : ''}`;
    if (window.lucide) lucide.createIcons();
  }
}

async function saveCurrentNote() {
  const note = [...(allNotes.mine||[])].find(n => n.id === activeNoteId);
  if (!note) return;
  const titleEl = document.getElementById('edit-note-title');
  const contentEl = document.getElementById('edit-note-content');
  const body = { title: titleEl?.value || note.title };
  if (contentEl) body.content = contentEl.value;
  await fetch(`/api/notes/${activeNoteId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  await loadNotes();
  showToast('📝 Note saved!');
}

async function saveNote() {
  const title = document.getElementById('note-title').value.trim() || 'Untitled';
  const content = document.getElementById('note-content').value;
  await fetch('/api/notes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content, type: 'note' })
  });
  closeModal('new-note-modal');
  await loadNotes();
  showToast('📝 Note saved!');
}

async function saveTodo() {
  const title = document.getElementById('todo-title').value.trim() || 'My Todo List';
  const items = Array.from(document.querySelectorAll('.todo-new-item')).map(i => ({ text: i.value, done: false })).filter(i => i.text);
  await fetch('/api/notes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, todos: items, type: 'todo' })
  });
  closeModal('new-todo-modal');
  await loadNotes();
  showToast('✅ Todo list saved!');
}

function addTodoItem() {
  const list = document.getElementById('todo-items-list');
  const count = list.querySelectorAll('.todo-new-item').length + 1;
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:6px;margin-bottom:6px';
  div.innerHTML = `<input type="text" class="todo-new-item" placeholder="Item ${count}" style="flex:1">`;
  list.appendChild(div);
}

async function toggleTodoItem(noteId, idx, done) {
  const note = (allNotes.mine||[]).find(n => n.id === noteId);
  if (!note) return;
  note.todos[idx].done = done;
  await fetch(`/api/notes/${noteId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ todos: note.todos })
  });
  openNote(noteId); // Re-render to update progress bar + checkbox state
}

async function removeTodoItem(noteId, idx) {
  const note = (allNotes.mine||[]).find(n => n.id === noteId);
  if (!note) return;
  note.todos.splice(idx, 1);
  await fetch(`/api/notes/${noteId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ todos: note.todos })
  });
  openNote(noteId);
}

async function addTodoItemToNote(noteId) {
  const note = (allNotes.mine||[]).find(n => n.id === noteId);
  if (!note) return;
  const input = document.getElementById('new-todo-item');
  if (!input?.value.trim()) return;
  note.todos = [...(note.todos||[]), { text: input.value.trim(), done: false }];
  await fetch(`/api/notes/${noteId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ todos: note.todos })
  });
  await loadNotes();
  openNote(noteId);
}

function setupTodoDragReorder(noteId) {
  const container = document.getElementById('todo-list-editor');
  if (!container) return;
  let dragIdx = null;
  container.querySelectorAll('.todo-item').forEach((item, i) => {
    item.draggable = true;
    item.dataset.idx = i;
    item.addEventListener('dragstart', (e) => {
      dragIdx = i;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      container.querySelectorAll('.todo-item').forEach(el => el.classList.remove('drag-over'));
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      container.querySelectorAll('.todo-item').forEach(el => el.classList.remove('drag-over'));
      item.classList.add('drag-over');
    });
    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      const dropIdx = parseInt(item.dataset.idx);
      if (dragIdx === null || dragIdx === dropIdx) return;
      const note = (allNotes.mine || []).find(n => n.id === noteId);
      if (!note || !note.todos) return;
      const moved = note.todos.splice(dragIdx, 1)[0];
      note.todos.splice(dropIdx, 0, moved);
      await fetch(`/api/notes/${noteId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ todos: note.todos })
      });
      openNote(noteId);
    });
  });
}

function editTodoItem(noteId, idx) {
  const note = (allNotes.mine||[]).find(n => n.id === noteId);
  if (!note || !note.todos[idx]) return;
  const items = document.querySelectorAll('#todo-list-editor .todo-item');
  const item = items[idx];
  if (!item) return;
  const textEl = item.querySelector('.todo-item-text');
  if (!textEl) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = note.todos[idx].text;
  input.style.cssText = 'flex:1;font-size:inherit;background:var(--bg-card);border:1px solid var(--accent);border-radius:6px;padding:4px 8px;color:var(--text-primary);outline:none';
  let saved = false;
  const save = async () => {
    if (saved) return;
    saved = true;
    const newText = input.value.trim();
    if (newText && newText !== note.todos[idx].text) {
      note.todos[idx].text = newText;
      await fetch(`/api/notes/${noteId}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ todos: note.todos }) });
      await loadNotes();
    }
    openNote(noteId);
  };
  input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') openNote(noteId); };
  input.onblur = save;
  textEl.replaceWith(input);
  input.focus();
  input.select();
}

async function shareNote(id) {
  await fetch(`/api/notes/${id}/share`, { method: 'POST' });
  await loadNotes(); openNote(id);
  showToast('🔗 Note sharing updated!');
}

async function archiveNote(id) {
  const note = (allNotes.mine||[]).find(n => n.id === id);
  if (!note) return;
  await fetch(`/api/notes/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived: !note.archived })
  });
  await loadNotes(); activeNoteId = null;
  document.getElementById('notes-editor').innerHTML = '<div class="empty-state"><div class="empty-state-text">Select a note</div></div>';
  showToast(note.archived ? '📤 Note unarchived' : '📦 Note archived');
}

async function deleteNote(id) {
  const ok = await showConfirmDialog({ icon: '📝', title: 'Delete note?', msg: 'This note will be permanently removed.', okText: 'Delete' });
  if (!ok) return;
  await fetch(`/api/notes/${id}`, { method: 'DELETE' });
  await loadNotes();
  activeNoteId = null;
  document.getElementById('notes-editor').innerHTML = '<div class="empty-state"><div class="empty-state-text">Select a note</div></div>';
}

// ── Calendar ──────────────────────────────────────────────────────────
function calPrev() { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); }
function calNext() { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); }

async function renderCalendar() {
  const label = document.getElementById('cal-month-label');
  label.textContent = new Date(calYear, calMonth).toLocaleString('default', { month: 'long', year: 'numeric' });

  const calData = await fetch('/api/calendar').then(r => r.json()).catch(() => ({}));
  const events = calData.shared || [];

  const grid = document.getElementById('cal-grid');
  Array.from(grid.children).slice(7).forEach(c => c.remove());

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = getNow();

  // Build day cells
  const dayCells = {};
  for (let i = 0; i < firstDay; i++) {
    const d = document.createElement('div');
    d.className = 'cal-day cal-day-empty';
    grid.appendChild(d);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement('div');
    cell.className = 'cal-day';
    if (d === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear()) cell.classList.add('today');
    cell.innerHTML = `<div class="cal-day-num">${d}</div>`;
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    cell.dataset.date = dateStr;
    dayCells[dateStr] = cell;
    cell.ondblclick = () => { openEventModalForDate(dateStr); };
    grid.appendChild(cell);
  }

  // Render events
  events.forEach(ev => {
    const evStart = ev.start || ev.date;
    const evEnd = ev.end || evStart;
    if (!evStart) return;

    // Single-day event or multi-day?
    if (evStart === evEnd) {
      // Single-day: render as pill in that cell
      const cell = dayCells[evStart];
      if (cell) {
        const el = document.createElement('div');
        el.className = 'cal-event';
        el.style.background = ev.color || 'var(--accent)';
        el.title = ev.description || ev.title;
        const titleSpan = document.createElement('span');
        titleSpan.textContent = (ev.emoji || '') + ' ' + ev.title;
        el.appendChild(titleSpan);
        const btns = document.createElement('span');
        btns.className = 'cal-event-btns';
        const editBtn = document.createElement('button');
        editBtn.className = 'cal-event-edit';
        editBtn.innerHTML = '✎';
        editBtn.title = 'Edit event';
        editBtn.onclick = (e) => { e.stopPropagation(); editCalEvent(ev.id); };
        btns.appendChild(editBtn);
        const delBtn = document.createElement('button');
        delBtn.className = 'cal-event-del';
        delBtn.textContent = '✕';
        delBtn.title = 'Delete event';
        delBtn.onclick = (e) => { e.stopPropagation(); deleteCalEvent(ev.id); };
        btns.appendChild(delBtn);
        el.appendChild(btns);
        cell.appendChild(el);
      }
    } else {
      // Multi-day: render spanning bars per week row
      const startD = new Date(evStart + 'T00:00:00');
      const endD = new Date(evEnd + 'T00:00:00');
      const monthStart = new Date(calYear, calMonth, 1);
      const monthEnd = new Date(calYear, calMonth, daysInMonth);

      // Clamp to visible month
      const visStart = startD < monthStart ? monthStart : startD;
      const visEnd = endD > monthEnd ? monthEnd : endD;

      // Iterate day by day, grouping into week rows
      let current = new Date(visStart);
      let rowStart = new Date(current);

      while (current <= visEnd) {
        const dayOfWeek = current.getDay();
        const isRowEnd = dayOfWeek === 6 || current.getTime() === visEnd.getTime();

        if (isRowEnd) {
          // Render bar from rowStart to current
          const barStartStr = fmtDate(rowStart);
          const barEndStr = fmtDate(current);
          const startCell = dayCells[barStartStr];

          if (startCell) {
            const isEventStart = rowStart.getTime() === startD.getTime();
            const isEventEnd = current.getTime() === endD.getTime();
            const spanDays = Math.round((current - rowStart) / 86400000) + 1;

            const bar = document.createElement('div');
            bar.className = 'cal-event-bar';
            if (isEventStart && isEventEnd) bar.classList.add('cal-bar-single');
            else if (isEventStart) bar.classList.add('cal-bar-start');
            else if (isEventEnd) bar.classList.add('cal-bar-end');
            else bar.classList.add('cal-bar-mid');

            bar.style.background = ev.color || 'var(--accent)';
            bar.title = `${ev.title}${ev.description ? ' — ' + ev.description : ''}`;
            // Span across cells using calc
            bar.style.width = `calc(${spanDays * 100}% + ${(spanDays - 1) * 1}px)`;

            const titleSpan = document.createElement('span');
            titleSpan.className = 'cal-bar-title';
            titleSpan.textContent = isEventStart || rowStart.getDate() === 1 ? (ev.emoji || '') + ' ' + ev.title : '';
            bar.appendChild(titleSpan);

            // Edit & delete buttons only on first segment
            if (isEventStart) {
              const btns = document.createElement('span');
              btns.className = 'cal-event-btns';
              const editBtn = document.createElement('button');
              editBtn.className = 'cal-event-edit';
              editBtn.innerHTML = '✎';
              editBtn.title = 'Edit event';
              editBtn.onclick = (e) => { e.stopPropagation(); editCalEvent(ev.id); };
              btns.appendChild(editBtn);
              const delBtn = document.createElement('button');
              delBtn.className = 'cal-event-del';
              delBtn.textContent = '✕';
              delBtn.title = 'Delete event';
              delBtn.onclick = (e) => { e.stopPropagation(); deleteCalEvent(ev.id); };
              btns.appendChild(delBtn);
              bar.appendChild(btns);
            }

            startCell.appendChild(bar);
          }

          // Start new row segment
          const next = new Date(current);
          next.setDate(next.getDate() + 1);
          rowStart = new Date(next);
        }

        current.setDate(current.getDate() + 1);
      }
    }
  });
}

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ── Event Date Picker ──
let edpYear, edpMonth, edpSelectStart = null, edpSelectEnd = null, edpPickerOpen = false;

function openEventModalForDate(dateStr) {
  edpSelectStart = dateStr;
  edpSelectEnd = dateStr;
  document.getElementById('event-start-date').value = dateStr;
  document.getElementById('event-end-date').value = dateStr;
  updateEventDateDisplay();
  const d = new Date(dateStr + 'T00:00:00');
  edpYear = d.getFullYear();
  edpMonth = d.getMonth();
  openModal('new-event-modal');
  // Auto-open the date picker
  document.getElementById('event-date-picker').style.display = '';
  edpPickerOpen = true;
  renderEdpGrid();
}

function toggleEventDatePicker() {
  const picker = document.getElementById('event-date-picker');
  edpPickerOpen = !edpPickerOpen;
  picker.style.display = edpPickerOpen ? '' : 'none';
  if (edpPickerOpen) {
    const today = getNow();
    if (!edpYear) { edpYear = today.getFullYear(); edpMonth = today.getMonth(); }
    renderEdpGrid();
  }
}

function edpPrev() { edpMonth--; if (edpMonth < 0) { edpMonth = 11; edpYear--; } renderEdpGrid(); }
function edpNext() { edpMonth++; if (edpMonth > 11) { edpMonth = 0; edpYear++; } renderEdpGrid(); }

function renderEdpGrid() {
  document.getElementById('edp-month-label').textContent =
    new Date(edpYear, edpMonth).toLocaleString('default', { month: 'long', year: 'numeric' });

  const grid = document.getElementById('edp-grid');
  Array.from(grid.children).slice(7).forEach(c => c.remove());

  const firstDay = new Date(edpYear, edpMonth, 1).getDay();
  const daysInMonth = new Date(edpYear, edpMonth + 1, 0).getDate();
  const today = getNow();

  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement('div');
    empty.className = 'edp-day edp-day-empty';
    grid.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement('div');
    cell.className = 'edp-day';
    const dateStr = `${edpYear}-${String(edpMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

    if (d === today.getDate() && edpMonth === today.getMonth() && edpYear === today.getFullYear()) {
      cell.classList.add('edp-today');
    }

    // Highlight selection range
    if (edpSelectStart && edpSelectEnd) {
      const s = edpSelectStart <= edpSelectEnd ? edpSelectStart : edpSelectEnd;
      const e = edpSelectStart <= edpSelectEnd ? edpSelectEnd : edpSelectStart;
      if (dateStr === s && dateStr === e) cell.classList.add('edp-selected-single');
      else if (dateStr === s) cell.classList.add('edp-range-start');
      else if (dateStr === e) cell.classList.add('edp-range-end');
      else if (dateStr > s && dateStr < e) cell.classList.add('edp-range-mid');
    } else if (edpSelectStart && dateStr === edpSelectStart) {
      cell.classList.add('edp-selected-single');
    }

    cell.textContent = d;
    cell.onclick = () => edpSelectDate(dateStr);
    grid.appendChild(cell);
  }
}

function edpSelectDate(dateStr) {
  if (!edpSelectStart || edpSelectEnd) {
    // First click or reset: set start
    edpSelectStart = dateStr;
    edpSelectEnd = null;
  } else {
    // Second click: set end (auto-sort)
    if (dateStr === edpSelectStart) {
      edpSelectEnd = dateStr; // same day = single day
    } else if (dateStr < edpSelectStart) {
      edpSelectEnd = edpSelectStart;
      edpSelectStart = dateStr;
    } else {
      edpSelectEnd = dateStr;
    }
  }
  document.getElementById('event-start-date').value = edpSelectStart;
  document.getElementById('event-end-date').value = edpSelectEnd || edpSelectStart;
  updateEventDateDisplay();
  renderEdpGrid();
}

function updateEventDateDisplay() {
  const display = document.getElementById('event-date-display');
  const start = edpSelectStart;
  const end = edpSelectEnd || edpSelectStart;
  if (!start) { display.textContent = 'Select date(s)...'; return; }

  const fmt = (ds) => {
    const d = new Date(ds + 'T00:00:00');
    return d.toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (start === end || !end) {
    display.textContent = fmt(start);
  } else {
    display.textContent = `${fmt(start)} – ${fmt(end)}`;
  }
  display.classList.add('has-value');
}

async function saveEvent() {
  const title = document.getElementById('event-title').value.trim();
  const start = document.getElementById('event-start-date').value;
  const end = document.getElementById('event-end-date').value || start;
  if (!title) return showToast('Event title required');
  if (!start) return showToast('Date required');
  const reminderVal = getCustomSelectValue('event-reminder') || '';
  await fetch('/api/calendar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      start,
      end,
      description: document.getElementById('event-desc').value,
      color: document.getElementById('event-color').value,
      emoji: document.getElementById('event-emoji')?.value.trim() || '',
      reminder: reminderVal !== '' ? parseInt(reminderVal) : null,
    })
  });
  // Reset form
  document.getElementById('event-title').value = '';
  document.getElementById('event-start-date').value = '';
  document.getElementById('event-end-date').value = '';
  document.getElementById('event-desc').value = '';
  if (document.getElementById('event-emoji')) document.getElementById('event-emoji').value = '';
  document.getElementById('event-date-display').textContent = 'Select date(s)...';
  document.getElementById('event-date-display').classList.remove('has-value');
  edpSelectStart = null; edpSelectEnd = null; edpPickerOpen = false;
  document.getElementById('event-date-picker').style.display = 'none';
  closeModal('new-event-modal');
  renderCalendar();
  showToast('Event saved!');
}

async function deleteCalEvent(eventId) {
  await fetch(`/api/calendar/${eventId}`, { method: 'DELETE' });
  renderCalendar();
  SoundSystem.deleteSnd();
  showToast('Event deleted');
}

// ── Edit Event Date Picker (EEDP) ─────────────────────────────────────
let eedpYear, eedpMonth, eedpSelectStart = null, eedpSelectEnd = null, eedpPickerOpen = false;

function toggleEditEventDatePicker() {
  const picker = document.getElementById('edit-event-date-picker');
  eedpPickerOpen = !eedpPickerOpen;
  picker.style.display = eedpPickerOpen ? '' : 'none';
  if (eedpPickerOpen) {
    const today = getNow();
    if (!eedpYear) { eedpYear = today.getFullYear(); eedpMonth = today.getMonth(); }
    renderEedpGrid();
  }
}

function eedpPrev() { eedpMonth--; if (eedpMonth < 0) { eedpMonth = 11; eedpYear--; } renderEedpGrid(); }
function eedpNext() { eedpMonth++; if (eedpMonth > 11) { eedpMonth = 0; eedpYear++; } renderEedpGrid(); }

function renderEedpGrid() {
  document.getElementById('eedp-month-label').textContent =
    new Date(eedpYear, eedpMonth).toLocaleString('default', { month: 'long', year: 'numeric' });

  const grid = document.getElementById('eedp-grid');
  Array.from(grid.children).slice(7).forEach(c => c.remove());

  const firstDay = new Date(eedpYear, eedpMonth, 1).getDay();
  const daysInMonth = new Date(eedpYear, eedpMonth + 1, 0).getDate();
  const today = getNow();

  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement('div');
    empty.className = 'edp-day edp-day-empty';
    grid.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement('div');
    cell.className = 'edp-day';
    const dateStr = `${eedpYear}-${String(eedpMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

    if (d === today.getDate() && eedpMonth === today.getMonth() && eedpYear === today.getFullYear()) {
      cell.classList.add('edp-today');
    }

    if (eedpSelectStart && eedpSelectEnd) {
      const s = eedpSelectStart <= eedpSelectEnd ? eedpSelectStart : eedpSelectEnd;
      const e = eedpSelectStart <= eedpSelectEnd ? eedpSelectEnd : eedpSelectStart;
      if (dateStr === s && dateStr === e) cell.classList.add('edp-selected-single');
      else if (dateStr === s) cell.classList.add('edp-range-start');
      else if (dateStr === e) cell.classList.add('edp-range-end');
      else if (dateStr > s && dateStr < e) cell.classList.add('edp-range-mid');
    } else if (eedpSelectStart && dateStr === eedpSelectStart) {
      cell.classList.add('edp-selected-single');
    }

    cell.textContent = d;
    cell.onclick = () => eedpSelectDate(dateStr);
    grid.appendChild(cell);
  }
}

function eedpSelectDate(dateStr) {
  if (!eedpSelectStart || eedpSelectEnd) {
    eedpSelectStart = dateStr;
    eedpSelectEnd = null;
  } else {
    if (dateStr === eedpSelectStart) {
      eedpSelectEnd = dateStr;
    } else if (dateStr < eedpSelectStart) {
      eedpSelectEnd = eedpSelectStart;
      eedpSelectStart = dateStr;
    } else {
      eedpSelectEnd = dateStr;
    }
  }
  document.getElementById('edit-event-start-date').value = eedpSelectStart;
  document.getElementById('edit-event-end-date').value = eedpSelectEnd || eedpSelectStart;
  updateEditEventDateDisplay();
  renderEedpGrid();
}

function updateEditEventDateDisplay() {
  const display = document.getElementById('edit-event-date-display');
  const start = eedpSelectStart;
  const end = eedpSelectEnd || eedpSelectStart;
  if (!start) { display.textContent = 'Select date(s)...'; display.classList.remove('has-value'); return; }
  const fmt = (ds) => {
    const d = new Date(ds + 'T00:00:00');
    return d.toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  display.textContent = (start === end || !end) ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
  display.classList.add('has-value');
}

// ── Edit & Update Calendar Events ─────────────────────────────────────
async function editCalEvent(eventId) {
  const calData = await fetch('/api/calendar').then(r => r.json()).catch(() => ({}));
  const events = calData.shared || [];
  const ev = events.find(e => e.id === eventId);
  if (!ev) return showToast('Event not found');

  document.getElementById('edit-event-id').value = ev.id;
  document.getElementById('edit-event-title').value = ev.title || '';
  document.getElementById('edit-event-desc').value = ev.description || '';
  document.getElementById('edit-event-color').value = ev.color || '#7c3aed';

  const reminderLabels = { '': 'No reminder', '0': 'Day of event', '1': '1 day before', '2': '2 days before', '3': '3 days before', '7': '1 week before' };
  const rVal = ev.reminder != null ? String(ev.reminder) : '';
  setCustomSelectValue('edit-event-reminder', rVal, reminderLabels[rVal] || 'No reminder');

  // Set up edit date picker state
  eedpSelectStart = ev.start || ev.date;
  eedpSelectEnd = ev.end || eedpSelectStart;
  document.getElementById('edit-event-start-date').value = eedpSelectStart;
  document.getElementById('edit-event-end-date').value = eedpSelectEnd;
  updateEditEventDateDisplay();

  const d = new Date(eedpSelectStart + 'T00:00:00');
  eedpYear = d.getFullYear();
  eedpMonth = d.getMonth();

  openModal('edit-event-modal');
  document.getElementById('edit-event-date-picker').style.display = 'none';
  eedpPickerOpen = false;
}

async function updateCalEvent() {
  const id = document.getElementById('edit-event-id').value;
  const title = document.getElementById('edit-event-title').value.trim();
  const start = document.getElementById('edit-event-start-date').value;
  const end = document.getElementById('edit-event-end-date').value || start;
  if (!title) return showToast('Event title required');
  if (!start) return showToast('Date required');

  const reminderVal = getCustomSelectValue('edit-event-reminder') || '';
  await fetch(`/api/calendar/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      start,
      end,
      description: document.getElementById('edit-event-desc').value,
      color: document.getElementById('edit-event-color').value,
      reminder: reminderVal !== '' ? parseInt(reminderVal) : null,
    })
  });

  closeModal('edit-event-modal');
  renderCalendar();
  showToast('Event updated!');
}

// ── Calendar Event Banner & Reminders ──────────────────────────────────
let _eventBannerDismissed = false;

async function checkTodayEvents() {
  try {
    const calData = await fetch('/api/calendar').then(r => r.json()).catch(() => ({}));
    const events = calData.shared || [];
    if (!events.length) return;

    const today = getNow().toISOString().split('T')[0];
    const todayEvents = events.filter(ev => {
      const start = ev.start || ev.date;
      const end = ev.end || start;
      return start <= today && today <= end;
    });

    // Show today's events banner
    const banner = document.getElementById('event-today-banner');
    const textEl = document.getElementById('event-today-text');
    if (banner && textEl && todayEvents.length > 0 && !_eventBannerDismissed) {
      const names = todayEvents.map(e => e.title).join(', ');
      textEl.textContent = 'Today: ' + names;
      banner.style.display = '';
    }

    // Check reminders — show toast for events with reminders matching today (once per session)
    const todayDate = new Date(today + 'T00:00:00');
    events.forEach(ev => {
      if (ev.reminder == null) return;
      const evStart = new Date((ev.start || ev.date) + 'T00:00:00');
      const daysUntil = Math.round((evStart - todayDate) / 86400000);
      if (daysUntil === ev.reminder) {
        const shownKey = 'rkk-event-reminder-shown-' + ev.id;
        if (sessionStorage.getItem(shownKey)) return;
        sessionStorage.setItem(shownKey, '1');
        const when = daysUntil === 0 ? 'today' : daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;
        showToast(`📅 Reminder: "${ev.title}" is ${when}!`);
      }
    });
  } catch {}
}

function dismissEventBanner() {
  _eventBannerDismissed = true;
  const banner = document.getElementById('event-today-banner');
  if (banner) banner.style.display = 'none';
}

// ── Vault ──────────────────────────────────────────────────────────────
let vaultTab = 'mine';
let vaultDragId = null;
let vaultDragOccurred = false;
let currentPreviewItemId = null;
let currentVaultFolder = null;
let vaultFolderPath = [];  // [{id, name}, ...]
let lastVaultData = null;

function resetVault() {
  document.getElementById('vault-lock-screen').style.display = '';
  document.getElementById('vault-content').style.display = 'none';
  Array.from(document.querySelectorAll('.passcode-digit')).forEach(i => i.value = '');
  document.getElementById('passcode-error').style.display = 'none';
  vaultPasscode = null;
}

function handlePasscodeInput(input, idx) {
  const val = input.value.toString().slice(-1);
  input.value = val;
  const digits = Array.from(document.querySelectorAll('.passcode-digit'));
  if (val && idx < 3) digits[idx+1].focus();
  if (idx === 3) checkVaultPasscode();
}

async function checkVaultPasscode() {
  const digits = Array.from(document.querySelectorAll('.passcode-digit')).map(i => i.value);
  if (digits.some(d => d === '')) return;
  vaultPasscode = digits.join('');
  const r = await fetch(`/api/vault?passcode=${vaultPasscode}`);
  if (r.status === 403) {
    document.getElementById('passcode-error').style.display = '';
    digits.forEach(i => {}); // reset
    Array.from(document.querySelectorAll('.passcode-digit')).forEach(i => { i.value = ''; });
    document.querySelectorAll('.passcode-digit')[0].focus();
    vaultPasscode = null;
    SoundSystem.error();
    return;
  }
  const data = await r.json();
  document.getElementById('vault-lock-screen').style.display = 'none';
  document.getElementById('vault-content').style.display = 'flex';
  renderVault(data);
}

function lockVault() { resetVault(); vaultPasscode = null; currentVaultFolder = null; vaultFolderPath = []; lastVaultData = null; }

async function refreshVault() {
  if (!vaultPasscode) return;
  try {
    const data = await fetch(`/api/vault?passcode=${vaultPasscode}`).then(r => r.json());
    renderVault(data);
  } catch(e) { console.error('Failed to refresh locker:', e); }
}

function switchVaultTab(tab, el) {
  vaultTab = tab;
  currentVaultFolder = null;
  vaultFolderPath = [];
  document.querySelectorAll('#vault-content .section-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  fetch(`/api/vault?passcode=${vaultPasscode}`).then(r => r.json()).then(renderVault);
}

function renderVault(data) {
  lastVaultData = data;
  const allItems = vaultTab === 'mine' ? (data[currentUser] || []) : (data[otherUser] || []);
  // Filter to current folder
  const items = allItems.filter(i => (i.folder || null) === currentVaultFolder);
  const grid = document.getElementById('vault-grid');
  const isMine = vaultTab === 'mine';

  // Render breadcrumb
  renderVaultBreadcrumb();

  if (!items.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon"><i data-lucide="folder-lock" style="width:48px;height:48px;opacity:0.4"></i></div><div class="empty-state-text">' + (currentVaultFolder ? 'This folder is empty' : 'No files yet') + '</div></div>';if(window.lucide)lucide.createIcons();
    return;
  }

  // Folders first, then files/links
  const folders = items.filter(i => i.type === 'folder');
  const files = items.filter(i => i.type !== 'folder');

  let html = '';

  // Render folders
  folders.forEach(item => {
    const escapedName = (item.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    html += `
      <div class="vault-item vault-folder" data-id="${item.id}" draggable="true"
        onclick="if(!vaultDragOccurred)navigateVaultFolder('${item.id}','${escapedName}')"
        ondragstart="vaultDragStart(event,'${item.id}')"
        ondragend="vaultDragEnd(event)"
        ondragover="vaultDragOver(event,'${item.id}','folder')"
        ondragleave="vaultDragLeave(event)"
        ondrop="vaultDrop(event,'${item.id}','folder')">
        <div class="vault-item-icon"><i data-lucide="folder" style="width:32px;height:32px;color:var(--accent)"></i></div>
        <div class="vault-item-name">${item.name}</div>
        <div class="vault-item-meta">${formatDate(item.uploadedAt)}</div>
        ${isMine ? `<div class="vault-item-actions">
          <button class="vault-action-btn" onclick="event.stopPropagation();renameVaultItem('${item.id}','${escapedName}')" title="Rename"><i data-lucide="pencil" style="width:14px;height:14px"></i></button>
          <button class="vault-action-btn vault-action-del" onclick="event.stopPropagation();deleteVaultItem('${item.id}')" title="Delete"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
        </div>` : ''}
      </div>`;
  });

  // Render files/links
  files.forEach(item => {
    const icon = item.type === 'link' ? '<i data-lucide="link" style="width:22px;height:22px;color:var(--accent)"></i>' : getFileIcon(item.mimeType);
    const mime = item.mimeType || '';
    let thumbHtml;
    if (mime.startsWith('image')) {
      thumbHtml = `<div class="vault-item-thumb"><img src="${item.url}" alt="" loading="lazy"></div>`;
    } else if (mime.startsWith('video')) {
      thumbHtml = `<div class="vault-item-thumb"><video src="${item.url}" muted preload="metadata"></video></div>`;
    } else {
      thumbHtml = `<div class="vault-item-icon">${icon}</div>`;
    }
    const escapedName = (item.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const escapedUrl = (item.url || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const clickAction = item.type === 'link'
      ? `window.open('${escapedUrl}','_blank')`
      : `openVaultPreview('${escapedUrl}','${escapedName}','${mime}','${item.id}')`;
    html += `
      <div class="vault-item" data-id="${item.id}" draggable="true"
        onclick="if(!vaultDragOccurred)${clickAction}"
        ondragstart="vaultDragStart(event,'${item.id}')"
        ondragend="vaultDragEnd(event)"
        ondragover="vaultDragOver(event,'${item.id}','file')"
        ondragleave="vaultDragLeave(event)"
        ondrop="vaultDrop(event,'${item.id}','file')">
        ${thumbHtml}
        <div class="vault-item-name">${item.name}</div>
        <div class="vault-item-meta">${formatDate(item.uploadedAt)}</div>
        ${isMine ? `<div class="vault-item-actions">
          <button class="vault-action-btn" onclick="event.stopPropagation();renameVaultItem('${item.id}','${escapedName}')" title="Rename"><i data-lucide="pencil" style="width:14px;height:14px"></i></button>
          <button class="vault-action-btn" onclick="event.stopPropagation();moveVaultItem('${item.id}')" title="Move to folder"><i data-lucide="folder-input" style="width:14px;height:14px"></i></button>
          <button class="vault-action-btn vault-action-del" onclick="event.stopPropagation();deleteVaultItem('${item.id}')" title="Delete"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
        </div>` : ''}
      </div>`;
  });

  grid.innerHTML = html;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderVaultBreadcrumb() {
  const bc = document.getElementById('vault-breadcrumb');
  if (!bc) return;
  if (!currentVaultFolder) { bc.style.display = 'none'; return; }
  bc.style.display = 'flex';
  let html = `<span class="vault-bc-item" onclick="navigateVaultBreadcrumb(-1)"><i data-lucide="home" style="width:14px;height:14px"></i></span>`;
  vaultFolderPath.forEach((f, i) => {
    html += `<span class="vault-bc-sep">/</span><span class="vault-bc-item" onclick="navigateVaultBreadcrumb(${i})">${f.name}</span>`;
  });
  bc.innerHTML = html;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function navigateVaultFolder(id, name) {
  currentVaultFolder = id;
  vaultFolderPath.push({ id, name });
  if (lastVaultData) renderVault(lastVaultData);
}

function navigateVaultBreadcrumb(index) {
  if (index < 0) {
    currentVaultFolder = null;
    vaultFolderPath = [];
  } else {
    vaultFolderPath = vaultFolderPath.slice(0, index + 1);
    currentVaultFolder = vaultFolderPath[index].id;
  }
  if (lastVaultData) renderVault(lastVaultData);
}

function showVaultNameModal(title, defaultValue, onConfirm) {
  const modal = document.getElementById('vault-name-modal');
  const input = document.getElementById('vault-name-input');
  const confirmBtn = document.getElementById('vault-name-confirm');
  document.getElementById('vault-name-modal-title').textContent = title;
  input.value = defaultValue || '';
  openModal('vault-name-modal');
  setTimeout(() => { input.focus(); input.select(); }, 50);
  const handler = async () => {
    const val = input.value.trim();
    if (!val) return;
    confirmBtn.removeEventListener('click', handler);
    input.removeEventListener('keydown', keyHandler);
    closeModal('vault-name-modal');
    await onConfirm(val);
  };
  const keyHandler = (e) => { if (e.key === 'Enter') handler(); };
  confirmBtn.replaceWith(confirmBtn.cloneNode(true)); // clear old listeners
  const freshBtn = document.getElementById('vault-name-confirm');
  freshBtn.addEventListener('click', handler);
  input.addEventListener('keydown', keyHandler, { once: false });
  modal._keyHandler = keyHandler;
}

function vaultNameConflict(newName, excludeId) {
  if (!lastVaultData) return false;
  const items = (lastVaultData[currentUser] || []).filter(i => (i.folder || null) === currentVaultFolder);
  return items.some(i => i.id !== excludeId && i.name.toLowerCase() === newName.toLowerCase());
}

async function renameVaultItem(id, currentName) {
  showVaultNameModal('Rename', currentName, async (newName) => {
    if (newName === currentName) return;
    if (vaultNameConflict(newName, id)) {
      showToast('A file with that name already exists in this folder');
      return;
    }
    await fetch(`/api/vault/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: vaultPasscode, name: newName })
    });
    const data = await fetch(`/api/vault?passcode=${vaultPasscode}`).then(r => r.json());
    renderVault(data);
    showToast('Renamed!');
  });
}

async function createVaultFolder() {
  showVaultNameModal('New Folder', '', async (name) => {
    if (vaultNameConflict(name, null)) {
      showToast('A folder with that name already exists here');
      return;
    }
    const fd = new FormData();
    fd.append('passcode', vaultPasscode);
    fd.append('folderName', name);
    if (currentVaultFolder) fd.append('folder', currentVaultFolder);
    await fetch('/api/vault', { method: 'POST', body: fd });
    const data = await fetch(`/api/vault?passcode=${vaultPasscode}`).then(r => r.json());
    renderVault(data);
    showToast('Folder created!');
  });
}

// ── Vault drag-and-drop ──────────────────────────────────────────────
function vaultDragStart(e, id) {
  vaultDragId = id;
  vaultDragOccurred = false;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);
  setTimeout(() => {
    const el = document.querySelector(`.vault-item[data-id="${id}"]`);
    if (el) el.classList.add('vault-dragging');
  }, 0);
}

function vaultDragEnd(e) {
  vaultDragOccurred = vaultDragId !== null;
  vaultDragId = null;
  document.querySelectorAll('.vault-item').forEach(el => {
    el.classList.remove('vault-dragging', 'vault-drop-target', 'vault-drop-before', 'vault-drop-after');
  });
  setTimeout(() => { vaultDragOccurred = false; }, 100);
}

function vaultDragOver(e, targetId, targetType) {
  if (!vaultDragId || vaultDragId === targetId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const el = e.currentTarget;
  el.classList.remove('vault-drop-before', 'vault-drop-after', 'vault-drop-target');
  if (targetType === 'folder') {
    el.classList.add('vault-drop-target');
  } else {
    const rect = el.getBoundingClientRect();
    if (e.clientX < rect.left + rect.width / 2) el.classList.add('vault-drop-before');
    else el.classList.add('vault-drop-after');
  }
}

function vaultDragLeave(e) {
  e.currentTarget.classList.remove('vault-drop-target', 'vault-drop-before', 'vault-drop-after');
}

async function vaultDrop(e, targetId, targetType) {
  e.preventDefault();
  const draggedId = vaultDragId;
  if (!draggedId || draggedId === targetId) return;
  document.querySelectorAll('.vault-item').forEach(el =>
    el.classList.remove('vault-dragging', 'vault-drop-target', 'vault-drop-before', 'vault-drop-after'));
  vaultDragId = null;

  if (targetType === 'folder') {
    await fetch(`/api/vault/${draggedId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: vaultPasscode, folder: targetId })
    });
    const data = await fetch(`/api/vault?passcode=${vaultPasscode}`).then(r => r.json());
    renderVault(data);
    showToast('Moved into folder!');
  } else {
    const grid = document.getElementById('vault-grid');
    const els = [...grid.querySelectorAll('.vault-item[data-id]')];
    const ids = els.map(el => el.dataset.id);
    const fromIdx = ids.indexOf(draggedId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const el = grid.querySelector(`.vault-item[data-id="${targetId}"]`);
    const rect = el.getBoundingClientRect();
    const insertAfter = e.clientX >= rect.left + rect.width / 2;
    ids.splice(fromIdx, 1);
    const newTo = ids.indexOf(targetId);
    ids.splice(insertAfter ? newTo + 1 : newTo, 0, draggedId);
    await fetch('/api/vault-reorder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: vaultPasscode, order: ids })
    });
    const data = await fetch(`/api/vault?passcode=${vaultPasscode}`).then(r => r.json());
    renderVault(data);
  }
}

// ── Move to folder picker ────────────────────────────────────────────
async function moveVaultItem(id) {
  if (!lastVaultData) return;
  const allItems = lastVaultData[currentUser] || [];
  const folders = allItems.filter(i => i.type === 'folder' && i.id !== id);
  const list = document.getElementById('vault-move-folder-list');
  if (!list) return;
  list.innerHTML = '';

  const doMove = async (folderId, label) => {
    closeModal('vault-move-modal');
    await fetch(`/api/vault/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: vaultPasscode, folder: folderId })
    });
    const data = await fetch(`/api/vault?passcode=${vaultPasscode}`).then(r => r.json());
    renderVault(data);
    showToast('Moved to ' + label + '!');
  };

  if (currentVaultFolder) {
    const btn = document.createElement('button');
    btn.className = 'vault-move-folder-btn';
    btn.innerHTML = '<i data-lucide="home" style="width:15px;height:15px"></i><span>Root folder</span>';
    btn.onclick = () => doMove(null, 'root');
    list.appendChild(btn);
  }

  if (!folders.length && !currentVaultFolder) {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:4px 0">No folders yet — create one first.</div>';
  } else {
    folders.forEach(f => {
      const btn = document.createElement('button');
      btn.className = 'vault-move-folder-btn';
      btn.innerHTML = `<i data-lucide="folder" style="width:15px;height:15px;color:var(--accent)"></i><span>${f.name}</span>`;
      btn.onclick = () => doMove(f.id, f.name);
      list.appendChild(btn);
    });
  }

  openModal('vault-move-modal');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function openVaultPreview(url, name, mime, itemId) {
  const body = document.getElementById('vault-preview-body');
  const titleEl = document.getElementById('vault-preview-name');
  const openBtn = document.getElementById('vault-preview-open');
  const dlBtn = document.getElementById('vault-preview-download');
  const renameBtn = document.getElementById('vault-preview-rename');
  currentPreviewItemId = itemId || null;
  titleEl.textContent = name || 'File';
  openBtn.onclick = () => window.open(url, '_blank');
  dlBtn.onclick = () => {
    const a = document.createElement('a');
    a.href = url; a.download = name || 'file'; a.click();
  };
  if (renameBtn) {
    renameBtn.style.display = itemId ? '' : 'none';
    renameBtn.onclick = () => {
      closeModal('vault-preview-modal');
      renameVaultItem(itemId, name);
    };
  }

  let content = '';
  if (mime.startsWith('image')) {
    content = `<img src="${url}" alt="${name}">`;
  } else if (mime.startsWith('video')) {
    content = `<video src="${url}" controls autoplay style="max-width:100%;max-height:70vh;border-radius:8px"></video>`;
  } else if (mime.startsWith('audio')) {
    content = `<audio src="${url}" controls autoplay></audio>`;
  } else if (mime.includes('pdf')) {
    content = `<iframe src="${url}"></iframe>`;
  } else {
    const icon = getFileIcon(mime);
    content = `<div class="file-preview-placeholder">
      <div class="file-icon">${icon}</div>
      <div class="file-name">${name}</div>
      <div class="file-hint">No preview available — click the button above to open or download</div>
    </div>`;
  }
  body.innerHTML = content;
  openModal('vault-preview-modal');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function uploadVaultLink() {
  const link = document.getElementById('vault-link').value.trim();
  if (!link) return;
  const fd = new FormData();
  fd.append('passcode', vaultPasscode);
  fd.append('link', link);
  fd.append('linkName', document.getElementById('vault-link-name').value || link);
  if (currentVaultFolder) fd.append('folder', currentVaultFolder);
  await fetch('/api/vault', { method: 'POST', body: fd });
  closeModal('vault-upload-modal');
  const data = await fetch(`/api/vault?passcode=${vaultPasscode}`).then(r => r.json());
  renderVault(data);
  showToast('🔗 Link added!');
}

async function handleVaultFiles(input) {
  if (!input.files.length) return;
  const fd = new FormData();
  fd.append('passcode', vaultPasscode);
  if (currentVaultFolder) fd.append('folder', currentVaultFolder);
  Array.from(input.files).forEach(f => fd.append('files', f));
  await fetch('/api/vault', { method: 'POST', body: fd });
  closeModal('vault-upload-modal');
  const data = await fetch(`/api/vault?passcode=${vaultPasscode}`).then(r => r.json());
  renderVault(data);
  showToast('Files added to locker!');
}

// Vault dropzone drag-and-drop
function setupVaultDropzone() {
  const dropzone = document.getElementById('vault-dropzone');
  if (!dropzone) return;
  let dragCounter = 0;
  dropzone.addEventListener('dragenter', e => {
    e.preventDefault(); e.stopPropagation();
    dragCounter++;
    dropzone.classList.add('drag-over');
  });
  dropzone.addEventListener('dragleave', e => {
    e.preventDefault(); e.stopPropagation();
    dragCounter--;
    if (dragCounter <= 0) { dragCounter = 0; dropzone.classList.remove('drag-over'); }
  });
  dropzone.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
  dropzone.addEventListener('drop', async e => {
    e.preventDefault(); e.stopPropagation();
    dragCounter = 0;
    dropzone.classList.remove('drag-over');
    const files = e.dataTransfer?.files;
    if (!files || !files.length) return;
    if (!vaultPasscode) { showToast('Please unlock the locker first.'); return; }
    const fd = new FormData();
    fd.append('passcode', vaultPasscode);
    Array.from(files).forEach(f => fd.append('files', f));
    await fetch('/api/vault', { method: 'POST', body: fd });
    closeModal('vault-upload-modal');
    const data = await fetch(`/api/vault?passcode=${vaultPasscode}`).then(r => r.json());
    renderVault(data);
    showToast('Files added to locker!');
  });
}
document.addEventListener('DOMContentLoaded', setupVaultDropzone);

async function deleteVaultItem(id) {
  const ok = await showConfirmDialog({ icon: '🔒', title: 'Remove from locker?', msg: 'This file will be permanently removed.', okText: 'Remove' });
  if (!ok) return;
  await fetch(`/api/vault/${id}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode: vaultPasscode })
  });
  const data = await fetch(`/api/vault?passcode=${vaultPasscode}`).then(r => r.json());
  renderVault(data);
}

function getFileIcon(mime = '') {
  const s = 'width:22px;height:22px;color:var(--accent)';
  if (mime.startsWith('image')) return `<i data-lucide="image" style="${s}"></i>`;
  if (mime.startsWith('video')) return `<i data-lucide="film" style="${s}"></i>`;
  if (mime.startsWith('audio')) return `<i data-lucide="music" style="${s}"></i>`;
  if (mime.includes('pdf')) return `<i data-lucide="file-text" style="${s}"></i>`;
  if (mime.includes('word') || mime.includes('document')) return `<i data-lucide="file-pen" style="${s}"></i>`;
  return `<i data-lucide="file" style="${s}"></i>`;
}

// ── Contacts ──────────────────────────────────────────────────────────
let allContactsCache = [];

async function loadContacts() {
  try {
    allContactsCache = await fetch('/api/contacts').then(r => r.json());
    if (!Array.isArray(allContactsCache)) allContactsCache = [];
    renderContactsList(allContactsCache);
  } catch (err) {
    console.error('Failed to load contacts:', err);
  }
}

function filterContacts(q) {
  const lower = q.toLowerCase();
  const filtered = lower
    ? allContactsCache.filter(c =>
        (c.name||'').toLowerCase().includes(lower) ||
        (c.phone||'').includes(lower) ||
        (c.email||'').toLowerCase().includes(lower))
    : allContactsCache;
  renderContactsList(filtered);
}

function renderContactsList(contacts) {
  const grid = document.getElementById('contacts-grid');
  if (!contacts.length) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i data-lucide="contact" style="width:48px;height:48px;opacity:0.4"></i></div><div class="empty-state-text">No contacts found</div></div>';if(window.lucide)lucide.createIcons();
    return;
  }

  // Sort
  const sortBy = getCustomSelectValue('contacts-sort') || 'name-asc';
  const sorted = [...contacts].sort((a, b) => {
    if (sortBy === 'name-asc') return (a.name||'').localeCompare(b.name||'');
    if (sortBy === 'name-desc') return (b.name||'').localeCompare(a.name||'');
    if (sortBy === 'newest') return (b.createdAt||0) - (a.createdAt||0);
    if (sortBy === 'oldest') return (a.createdAt||0) - (b.createdAt||0);
    return 0;
  });

  // Group by first letter for alphabetical sorting
  let html = '';
  if (sortBy === 'name-asc' || sortBy === 'name-desc') {
    let currentLetter = '';
    sorted.forEach(c => {
      const letter = (c.name||'?')[0].toUpperCase();
      if (letter !== currentLetter) {
        currentLetter = letter;
        html += `<div class="contact-group-letter">${letter}</div>`;
      }
      html += renderContactCard(c);
    });
  } else {
    sorted.forEach(c => { html += renderContactCard(c); });
  }

  grid.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

function renderContactCard(c) {
  const avatar = c.photo ? `<img src="${c.photo}">` : (c.name ? c.name[0].toUpperCase() : '?');
  return `
    <div class="contact-card" onclick="viewContact('${c.id}')">
      <div class="contact-avatar">${avatar}</div>
      <div class="contact-info">
        <div class="contact-name">${c.name || 'Unknown'}</div>
        ${c.phone ? `<div class="contact-detail">${c.phone}</div>` : ''}
      </div>
      <i data-lucide="chevron-right" style="width:16px;height:16px;opacity:0.3;flex-shrink:0"></i>
    </div>`;
}

function viewContact(id) {
  const c = allContactsCache.find(x => x.id === id);
  if (!c) return;
  const avatar = c.photo ? `<img src="${c.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : `<span style="font-size:2.5rem;font-weight:700">${(c.name||'?')[0].toUpperCase()}</span>`;
  const modal = document.getElementById('contact-detail-modal');
  if (!modal) return;
  document.getElementById('contact-detail-content').innerHTML = `
    <div style="text-align:center;margin-bottom:1.5rem">
      <div style="width:80px;height:80px;border-radius:50%;background:var(--bg-btn);display:inline-flex;align-items:center;justify-content:center;color:#fff;overflow:hidden;margin-bottom:12px">${avatar}</div>
      <div style="font-size:1.3rem;font-weight:700">${c.name || 'Unknown'}</div>
    </div>
    <div class="contact-detail-rows">
      ${c.phone ? `<div class="contact-detail-row" onclick="navigator.clipboard.writeText('${c.phone}');showToast('📋 Copied!')">
        <i data-lucide="phone" style="width:18px;height:18px;color:var(--accent)"></i>
        <div><div style="font-size:0.72rem;color:var(--text-muted)">Phone</div><div style="font-weight:500">${c.phone}</div></div>
      </div>` : ''}
      ${c.email ? `<div class="contact-detail-row" onclick="navigator.clipboard.writeText('${c.email}');showToast('📋 Copied!')">
        <i data-lucide="mail" style="width:18px;height:18px;color:var(--accent)"></i>
        <div><div style="font-size:0.72rem;color:var(--text-muted)">Email</div><div style="font-weight:500">${c.email}</div></div>
      </div>` : ''}
      ${c.notes ? `<div class="contact-detail-row">
        <i data-lucide="file-text" style="width:18px;height:18px;color:var(--accent)"></i>
        <div><div style="font-size:0.72rem;color:var(--text-muted)">Notes</div><div style="font-size:0.85rem">${c.notes}</div></div>
      </div>` : ''}
    </div>
    <div style="display:flex;gap:8px;margin-top:1.5rem">
      <button class="btn-primary" onclick="editContact('${c.id}')" style="flex:1;border-radius:10px"><i data-lucide="pencil"></i> Edit</button>
      <button class="btn-danger" onclick="deleteContact('${c.id}');closeModal('contact-detail-modal')" style="flex:1;border-radius:10px"><i data-lucide="trash-2"></i> Delete</button>
      <button class="btn-ghost" onclick="closeModal('contact-detail-modal')" style="flex:1;border-radius:10px">Close</button>
    </div>`;
  if (window.lucide) lucide.createIcons();
  openModal('contact-detail-modal');
}

function formatPhoneInput(input) {
  let v = input.value.replace(/\D/g, '');
  if (v.length > 10) v = v.slice(0, 10);
  if (v.length >= 7) input.value = `(${v.slice(0,3)}) ${v.slice(3,6)}-${v.slice(6)}`;
  else if (v.length >= 4) input.value = `(${v.slice(0,3)}) ${v.slice(3)}`;
  else if (v.length >= 1) input.value = `(${v}`;
  else input.value = '';
}

async function saveContact() {
  const name = document.getElementById('contact-name').value.trim();
  if (!name) return showToast('Name required');
  const fd = new FormData();
  fd.append('name', name);
  fd.append('phone', document.getElementById('contact-phone').value.trim());
  fd.append('email', document.getElementById('contact-email').value.trim());
  fd.append('notes', document.getElementById('contact-notes').value.trim());
  const photoFile = document.getElementById('contact-photo-input').files[0];
  if (photoFile) fd.append('photo', photoFile);
  const modal = document.getElementById('new-contact-modal');
  const editId = modal.dataset.editId;
  try {
    const url = editId ? `/api/contacts/${editId}` : '/api/contacts';
    const method = editId ? 'PUT' : 'POST';
    const resp = await fetch(url, { method, body: fd });
    const result = await resp.json();
    if (!result.success) { showToast('Failed to save contact'); return; }
    // Clear form
    document.getElementById('contact-name').value = '';
    document.getElementById('contact-phone').value = '';
    document.getElementById('contact-email').value = '';
    document.getElementById('contact-notes').value = '';
    document.getElementById('contact-photo-input').value = '';
    closeModal('new-contact-modal');
    delete modal.dataset.editId;
    modal.querySelector('.modal-title').innerHTML = '<i data-lucide="user-plus" style="width:16px;height:16px"></i> New Contact';
    await loadContacts();
    showToast('Contact saved!');
  } catch (err) {
    showToast('Error saving contact');
  }
}

async function deleteContact(id) {
  const ok = await showConfirmDialog({ icon: '📇', title: 'Delete contact?', msg: 'This contact will be permanently removed.', okText: 'Delete' });
  if (!ok) return;
  await fetch(`/api/contacts/${id}`, { method: 'DELETE' });
  await loadContacts();
}

async function editContact(id) {
  const c = allContactsCache.find(x => x.id === id);
  if (!c) return;
  closeModal('contact-detail-modal');
  // Populate the new contact modal with existing data for editing
  setTimeout(() => {
    document.getElementById('contact-name').value = c.name || '';
    document.getElementById('contact-phone').value = c.phone || '';
    document.getElementById('contact-email').value = c.email || '';
    document.getElementById('contact-notes').value = c.notes || '';
    // Change modal to edit mode
    const modal = document.getElementById('new-contact-modal');
    modal.dataset.editId = id;
    modal.querySelector('.modal-title').innerHTML = '<i data-lucide="pencil" style="width:16px;height:16px"></i> Edit Contact';
    if (window.lucide) lucide.createIcons();
    openModal('new-contact-modal');
  }, 200);
}

// ── Announcements ─────────────────────────────────────────────────────
async function loadAnnouncements() {
  const anns = await fetch('/api/announcements').then(r => r.json());
  const list = document.getElementById('announcements-list');
  if (!list) return;
  if (!anns.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i data-lucide="megaphone" style="width:48px;height:48px;opacity:0.4"></i></div><div class="empty-state-text">No announcements</div></div>';if(window.lucide)lucide.createIcons();
    return;
  }
  list.innerHTML = anns.filter(a => a.active).map(a => `
    <div class="announcement-card">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem">
        <div style="flex:1">
          <div class="announcement-card-title">${a.title}</div>
          <div class="announcement-card-content">${a.content}</div>
          <div class="announcement-card-meta">Posted by ${capitalize(a.createdBy)} · ${formatDate(a.createdAt)}</div>
        </div>
        <button class="btn-icon" onclick="deleteAnnouncement('${a.id}')" title="Dismiss" style="color:#ef4444;flex-shrink:0"><i data-lucide="trash-2"></i></button>
      </div>
    </div>`).join('');
  if (window.lucide) lucide.createIcons();
}

function checkAndShowAnnouncements() {
  fetch('/api/announcements').then(r => r.json()).then(anns => {
    const dismissed = JSON.parse(localStorage.getItem('dismissedAnnouncements') || '[]');
    const relevant = anns.filter(a => a.active && (a.targetUser === 'both' || a.targetUser === currentUser) && !dismissed.includes(a.id));
    if (relevant.length > 0) {
      showBanner(relevant[0]);
      SoundSystem.notify();
    }
  });
}

function showBanner(ann) {
  const banner = document.getElementById('announcement-banner');
  document.getElementById('banner-title').textContent = ann.title;
  document.getElementById('banner-content').textContent = ann.content;
  banner.dataset.annId = ann.id;
  banner.classList.add('show');
  setTimeout(() => banner.classList.remove('show'), 8000);
}

function closeBanner() {
  const banner = document.getElementById('announcement-banner');
  const annId = banner.dataset.annId;
  if (annId) {
    const dismissed = JSON.parse(localStorage.getItem('dismissedAnnouncements') || '[]');
    if (!dismissed.includes(annId)) dismissed.push(annId);
    localStorage.setItem('dismissedAnnouncements', JSON.stringify(dismissed));
  }
  banner.classList.remove('show');
}

async function postAnnouncement() {
  const title = document.getElementById('ann-title').value.trim();
  const content = document.getElementById('ann-content').value.trim();
  if (!title || !content) return showToast('⚠️ Title and content required');
  await fetch('/api/announcements', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content, targetUser: getCustomSelectValue('ann-target') || 'both' })
  });
  closeModal('new-announcement-modal');
  await loadAnnouncements();
  showToast('📢 Announcement posted!');
}

async function deleteAnnouncement(id) {
  await fetch(`/api/announcements/${id}`, { method: 'DELETE' });
  await loadAnnouncements();
}

// ── Guest Messages ────────────────────────────────────────────────────
let activeGuestId = null;
let activeGuestChannel = null; // 'group', 'kaliph', 'kathrine'
let guestData = [];
let guestUnread = {}; // { 'guestId:channel': count }

async function loadGuestMessages() {
  try {
    const res = await fetch('/api/guest-messages');
    if (!res.ok) return;
    guestData = await res.json();
  } catch { guestData = []; }
  renderGuestList();
  setupGuestSocketListeners();
}

function setupGuestSocketListeners() {
  socket.off('guest-revoked');
  guestData.forEach(g => {
    socket.off(`guest-msg-${g.id}-group`);
    socket.off(`guest-msg-${g.id}-${currentUser}`);
  });

  socket.on('guest-revoked', ({ guestId }) => {
    guestData = guestData.filter(g => g.id !== guestId);
    if (activeGuestId === guestId) {
      activeGuestId = null;
      activeGuestChannel = null;
      document.getElementById('guest-chat-header').style.display = 'none';
      document.getElementById('guest-reply-bar').style.display = 'none';
      document.getElementById('guest-messages-area').innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i data-lucide="message-square-plus" style="width:48px;height:48px;opacity:0.4"></i></div><div class="empty-state-text">Select a guest to view messages</div><div class="empty-state-sub">Guests can message you through the guest portal</div></div>';
      if (window.lucide) lucide.createIcons();
    }
    renderGuestList();
    updateGuestNavBadge();
  });

  guestData.forEach(g => {
    const handleGuestMsg = (channel) => (msg) => {
      const guest = guestData.find(x => x.id === g.id);
      if (guest) {
        if (!guest.channels[channel]) guest.channels[channel] = [];
        guest.channels[channel].push(msg);
      }
      if (activeGuestId === g.id && activeGuestChannel === channel) {
        renderGuestChat();
      } else {
        const key = g.id + ':' + channel;
        guestUnread[key] = (guestUnread[key] || 0) + 1;
        renderGuestList();
      }
      if (msg.sender !== currentUser) {
        updateGuestNavBadge();
        if (currentSection !== 'guest-messages' || activeGuestId !== g.id || activeGuestChannel !== channel) {
          const chLabel = channel === 'group' ? 'Group' : 'DM';
          sendDesktopNotif(`${msg.sender} (${chLabel})`, msg.text?.substring(0, 80) || 'New message');
          SoundSystem.receive();
          showMsgNotif(`${msg.sender} · ${chLabel}`, msg.text?.substring(0, 80) || 'New message');
        }
      }
    };
    socket.on(`guest-msg-${g.id}-group`, handleGuestMsg('group'));
    socket.on(`guest-msg-${g.id}-${currentUser}`, handleGuestMsg(currentUser));
  });
}

function updateGuestNavBadge() {
  const totalUnread = Object.values(guestUnread).reduce((a, b) => a + b, 0);
  const navItem = document.querySelector('.nav-item[data-section="guest-messages"]');
  if (!navItem) return;
  let badge = navItem.querySelector('.nav-badge');
  if (totalUnread > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'nav-badge';
      navItem.appendChild(badge);
    }
    badge.textContent = totalUnread;
    badge.style.display = '';
  } else if (badge) {
    badge.style.display = 'none';
  }
}

function renderGuestList() {
  const list = document.getElementById('guest-list');
  const badge = document.getElementById('guest-count-badge');
  if (!list) return;
  if (badge) badge.textContent = guestData.length;
  if (!guestData.length) {
    list.innerHTML = '<div class="empty-state" style="padding:2rem 1rem;height:auto"><div class="empty-state-icon"><i data-lucide="user-x" style="width:32px;height:32px;opacity:0.4"></i></div><div class="empty-state-text" style="font-size:0.82rem">No active guests</div></div>';
    if (window.lucide) lucide.createIcons();
    return;
  }

  // Build separate entries per channel
  let html = '';
  guestData.forEach(g => {
    const channels = g.channels || {};
    // Determine which channels to show — show any channel that has messages, plus 'group' always
    const channelIds = ['group', currentUser].filter(ch => {
      const msgs = channels[ch];
      return msgs && msgs.length > 0;
    });
    // If no channels have messages, show a single entry for the guest
    if (!channelIds.length) channelIds.push('group');

    channelIds.forEach(ch => {
      const msgs = channels[ch] || [];
      const lastMsg = msgs[msgs.length - 1];
      const preview = lastMsg ? (lastMsg.text.length > 30 ? lastMsg.text.slice(0, 30) + '…' : lastMsg.text) : 'No messages yet';
      const time = lastMsg ? new Date(lastMsg.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
      const unreadKey = g.id + ':' + ch;
      const unread = guestUnread[unreadKey] || 0;
      const isActive = activeGuestId === g.id && activeGuestChannel === ch;
      const chLabel = ch === 'group' ? 'Group' : 'DM';
      const chIcon = ch === 'group' ? 'users' : 'message-circle';
      html += `<div class="guest-list-item ${isActive ? 'active' : ''}" onclick="selectGuest('${g.id}','${ch}')">
        <div class="guest-item-avatar">${g.name[0].toUpperCase()}</div>
        <div class="guest-item-info">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="guest-item-name">${escapeHtml(g.name)} <span style="font-size:0.65rem;color:var(--text-muted);font-weight:400">· ${chLabel}</span></div>
            ${time ? `<span style="font-size:0.65rem;color:var(--text-muted);flex-shrink:0">${time}</span>` : ''}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
            <div class="guest-item-meta">${escapeHtml(preview)}</div>
            ${unread ? `<span class="guest-unread-badge">${unread}</span>` : ''}
          </div>
        </div>
      </div>`;
    });
  });
  list.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

function selectGuest(guestId, channel) {
  activeGuestId = guestId;
  activeGuestChannel = channel || 'group';
  // Clear unread for this specific guest+channel
  delete guestUnread[guestId + ':' + activeGuestChannel];
  updateGuestNavBadge();
  renderGuestList();
  renderGuestChat();
  document.getElementById('guest-chat-header').style.display = '';
  document.getElementById('guest-reply-bar').style.display = '';
  if (window.lucide) lucide.createIcons();
}

function renderGuestChat() {
  const area = document.getElementById('guest-messages-area');
  if (!area || !activeGuestId || !activeGuestChannel) return;
  const guest = guestData.find(g => g.id === activeGuestId);
  if (!guest) {
    area.innerHTML = '<div class="empty-state"><div class="empty-state-text">Guest not found</div></div>';
    return;
  }

  const chLabel = activeGuestChannel === 'group' ? 'Group Chat' : 'Direct Message';
  document.getElementById('guest-chat-name').textContent = guest.name;
  document.getElementById('guest-chat-initial').textContent = guest.name[0].toUpperCase();
  const statusEl = document.getElementById('guest-chat-status');
  if (statusEl) statusEl.textContent = chLabel;

  // Show only the selected channel's messages
  const msgs = (guest.channels || {})[activeGuestChannel] || [];

  if (!msgs.length) {
    area.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i data-lucide="message-circle" style="width:36px;height:36px;opacity:0.35"></i></div><div class="empty-state-text">No messages yet</div><div class="empty-state-sub">Send a message to start the conversation</div></div>';
    if (window.lucide) lucide.createIcons();
    return;
  }

  area.innerHTML = msgs.map((m, i) => {
    // Only current user's messages go on the right — other host + guest on left
    const isSelf = m.sender === currentUser;
    const isHost = m.sender === 'kaliph' || m.sender === 'kathrine';
    const senderName = isHost ? capitalize(m.sender) : escapeHtml(m.sender);
    const time = new Date(m.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const prev = msgs[i - 1];
    const sameSender = prev && prev.sender === m.sender && (m.timestamp - prev.timestamp < 120000);
    const chatColor = m.sender === 'kaliph' ? 'var(--kaliph-color, #7c3aed)' : m.sender === 'kathrine' ? 'var(--kathrine-color, #c084fc)' : 'var(--accent)';
    // Use profile picture for host users, initial letter for guests
    const userData = isHost && window._users ? window._users[m.sender] : null;
    const avatarInner = userData?.avatar
      ? `<img src="${userData.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      : (m.sender || 'G')[0].toUpperCase();

    return `<div class="guest-msg-row ${isSelf ? 'self' : ''}${sameSender ? ' same-sender' : ''}">
      ${!isSelf ? `<div class="guest-msg-avatar" style="${sameSender ? 'visibility:hidden' : ''};background:${chatColor}">${avatarInner}</div>` : ''}
      <div class="guest-msg-content">
        ${!sameSender ? `<div class="guest-msg-sender ${isSelf ? 'self' : ''}" style="color:${chatColor}">${senderName}</div>` : ''}
        <div class="guest-msg-bubble ${isSelf ? 'self' : 'other'}">
          <span>${escapeHtml(m.text)}</span>
          <span class="guest-msg-time">${time}</span>
        </div>
      </div>
      ${isSelf ? `<div class="guest-msg-avatar" style="${sameSender ? 'visibility:hidden' : ''};background:${chatColor}">${avatarInner}</div>` : ''}
    </div>`;
  }).join('');
  area.scrollTop = area.scrollHeight;
}

async function sendGuestReply() {
  const input = document.getElementById('guest-reply-input');
  const text = input.value.trim();
  if (!text || !activeGuestId || !activeGuestChannel) return;
  input.value = '';
  try {
    await fetch(`/api/guests/${activeGuestId}/message`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, target: activeGuestChannel })
    });
  } catch (e) { showToast('Failed to send'); }
}

// ── Settings ──────────────────────────────────────────────────────────
function openSettingsModal() {
  SoundSystem.modalOpen();
  const modal = document.getElementById('settings-modal');
  modal.classList.add('open');
  loadSettings();
  loadGuests();
  loadSuggestions();
  loadBellSchedule().then(() => loadBellScheduleUI());
  if (window.lucide) lucide.createIcons();
  // Close mobile sidebar when opening settings on tablet
  if (window.innerWidth <= 834) closeMobileSidebar();
}

function switchSettingsTab(tab, el) {
  SoundSystem.navigate();
  document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-' + tab)?.classList.add('active');
  if (tab === 'updates') renderUpdateHistory();
}

function renderUpdateHistory() {
  const container = document.getElementById('update-history-list');
  if (!container || !CHANGELOG.length) return;
  let html = '';
  CHANGELOG.forEach((entry, idx) => {
    const isOpen = idx === 0 ? 'open' : '';
    const count = entry.sections
      ? entry.sections.reduce((n, s) => n + s.items.length, 0)
      : (entry.improvements?.length || 0);
    html += `<details ${isOpen} style="margin-bottom:0.75rem;border:1px solid var(--border);border-radius:8px;overflow:hidden">`;
    html += `<summary style="padding:0.75rem 1rem;cursor:pointer;background:var(--bg-sidebar);font-size:0.85rem;font-weight:600;display:flex;justify-content:space-between;align-items:center">`;
    html += `<span>v${escapeHtml(entry.version)}${count ? ` <span style="font-weight:400;color:var(--accent);font-size:0.7rem">${count} features</span>` : ''}</span>`;
    html += `<span style="font-weight:400;color:var(--text-muted);font-size:0.75rem">${escapeHtml(entry.date)}</span>`;
    html += `</summary>`;
    html += `<div style="padding:0.75rem 1rem;font-size:0.82rem;line-height:1.6">`;
    html += renderChangelogEntry(entry, { skipHeader: true });
    html += `</div></details>`;
  });
  container.innerHTML = html;
}

async function loadSettings() {
  const s = await fetch('/api/settings').then(r => r.json());
  if (s.emails) {
    // Support both old format (string) and new format (array)
    const kEmails = Array.isArray(s.emails.kaliph) ? s.emails.kaliph : (s.emails.kaliph ? [s.emails.kaliph] : ['']);
    const keEmails = Array.isArray(s.emails.kathrine) ? s.emails.kathrine : (s.emails.kathrine ? [s.emails.kathrine] : ['']);
    renderEmailList('kaliph', kEmails);
    renderEmailList('kathrine', keEmails);
    // Legacy single input for profile tab
    const myInput = document.getElementById('my-email-input');
    if (myInput) {
      const myEmails = currentUser === 'kaliph' ? kEmails : keEmails;
      myInput.value = myEmails[0] || '';
    }
  }
  loadProfilePasscodeState();
  // Check email system status
  checkEmailStatus();
}

async function checkEmailStatus() {
  try {
    const status = await fetch('/api/settings/email-status').then(r => r.json());
    const banner = document.getElementById('email-status-banner');
    if (!banner) return;
    if (!status.configured) {
      banner.style.display = 'block';
      banner.style.background = 'rgba(239,68,68,0.15)';
      banner.style.color = '#ef4444';
      banner.textContent = '⚠ Email not configured — set EMAIL_USER and EMAIL_PASS in your server environment variables.';
    } else if (!status.canConnect) {
      banner.style.display = 'block';
      banner.style.background = 'rgba(245,158,11,0.15)';
      banner.style.color = '#f59e0b';
      banner.textContent = '⚠ Email configured but cannot connect — check your EMAIL_PASS (Gmail App Password).';
    } else if (!status.hasRecipients) {
      banner.style.display = 'block';
      banner.style.background = 'rgba(245,158,11,0.15)';
      banner.style.color = '#f59e0b';
      banner.textContent = 'Email server connected. Add email addresses below to enable priority notifications.';
    } else {
      banner.style.display = 'block';
      banner.style.background = 'rgba(34,197,94,0.15)';
      banner.style.color = '#22c55e';
      banner.textContent = '✓ Email notifications are working.';
    }
  } catch {}
}

function renderEmailList(person, emails) {
  const list = document.getElementById(`${person}-emails-list`);
  if (!list) return;
  if (!emails.length) emails = [''];
  list.innerHTML = emails.map((email, i) => `
    <div class="email-row">
      <input type="email" value="${escapeHtml(email)}" placeholder="${capitalize(person)}'s email${i > 0 ? ' ' + (i+1) : ''}" data-person="${person}">
      ${emails.length > 1 ? `<button class="email-remove-btn" onclick="removeEmailField('${person}',${i})" title="Remove"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}
    </div>
  `).join('');
}

function addEmailField(person) {
  const list = document.getElementById(`${person}-emails-list`);
  if (!list) return;
  const current = getEmailValues(person);
  current.push('');
  renderEmailList(person, current);
  // Focus the new input
  const inputs = list.querySelectorAll('input[type="email"]');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

function removeEmailField(person, index) {
  const current = getEmailValues(person);
  current.splice(index, 1);
  if (!current.length) current.push('');
  renderEmailList(person, current);
}

function getEmailValues(person) {
  const list = document.getElementById(`${person}-emails-list`);
  if (!list) return [];
  return Array.from(list.querySelectorAll(`input[data-person="${person}"]`)).map(i => i.value.trim());
}

// ── BELL SCHEDULE ──────────────────────────────────────────────────────────
window._bellSchedule = null;
window._scheduleSkips = {};
window._countdownEnabled = true;
let _classInterval = null;

async function loadBellSchedule() {
  try {
    const s = await fetch('/api/settings').then(r => r.json());
    window._bellSchedule = s.bellSchedule || { kaliph: { regular: [], lateStart: [], lateStartDay: '' }, kathrine: { regular: [], lateStart: [], lateStartDay: '' } };
    window._scheduleSkips = s._scheduleSkips || {};
    if (s.preferences && s.preferences[currentUser]) {
      window._countdownEnabled = s.preferences[currentUser].countdownEnabled !== false;
    }
    const toggle = document.getElementById('toggle-countdown');
    if (toggle) toggle.checked = window._countdownEnabled;
    // Apply any active time override
    if (s.timeOffset) {
      window._timeOffsetMs = parseTimeOffset(s.timeOffset);
    }
    return window._bellSchedule;
  } catch { return null; }
}

function loadBellScheduleUI() {
  const bs = window._bellSchedule;
  if (!bs) return;
  const person = currentUser; // only show current user's schedule
  const data = bs[person] || { regular: [], lateStart: [], lateStartDay: '' };
  const label = document.getElementById('my-schedule-label');
  if (label) label.textContent = (person === 'kaliph' ? "Kaliph's" : "Kathrine's") + ' Schedule';
  // Set late day via custom select
  const dayVal = data.lateStartDay || '';
  setCustomSelectValue('late-day-mine', dayVal, dayVal ? dayVal.charAt(0).toUpperCase() + dayVal.slice(1) : 'None');
  renderScheduleList('mine', 'regular', data.regular || []);
  renderScheduleList('mine', 'lateStart', data.lateStart || []);
}

function renderScheduleList(person, type, periods) {
  const list = document.getElementById(`schedule-list-${person}-${type}`);
  if (!list) return;
  if (!periods.length) { list.innerHTML = '<div style="font-size:0.78rem;color:var(--text-muted);padding:4px 0">No periods added yet.</div>'; return; }
  list.innerHTML = periods.map((p, i) => `
    <div class="schedule-row">
      <input type="text" value="${escapeHtml(p.label || '')}" placeholder="Period name" data-field="label">
      <div class="custom-time-input" data-field="start" data-value="${p.start || ''}">
        <button type="button" class="custom-time-btn" onclick="openTimePicker(this)">${p.start ? formatTime12(p.start) : 'Start'}</button>
      </div>
      <div class="custom-time-input" data-field="end" data-value="${p.end || ''}">
        <button type="button" class="custom-time-btn" onclick="openTimePicker(this)">${p.end ? formatTime12(p.end) : 'End'}</button>
      </div>
      <button class="email-remove-btn" onclick="removePeriodRow('${person}','${type}',${i})" title="Remove"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
  `).join('');
}

function switchScheduleType(person, type, btn) {
  const group = btn.closest('.schedule-person-group');
  group.querySelectorAll('.schedule-type-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  group.querySelectorAll('.schedule-list').forEach(l => l.style.display = 'none');
  const target = document.getElementById(`schedule-list-${person}-${type}`);
  if (target) target.style.display = '';
}

function getActiveScheduleType(person) {
  const group = document.getElementById(`schedule-list-${person}-regular`)?.closest('.schedule-person-group');
  if (!group) return 'regular';
  const activeBtn = group.querySelector('.schedule-type-btn.active');
  return activeBtn?.textContent.trim() === 'Late Start' ? 'lateStart' : 'regular';
}

function addPeriodRow(person) {
  const type = getActiveScheduleType(person);
  const periods = getScheduleValues(person, type);
  periods.push({ label: '', start: '', end: '' });
  renderScheduleList(person, type, periods);
  const list = document.getElementById(`schedule-list-${person}-${type}`);
  const inputs = list?.querySelectorAll('input[type="text"]');
  if (inputs?.length) inputs[inputs.length - 1].focus();
}

function removePeriodRow(person, type, index) {
  const periods = getScheduleValues(person, type);
  periods.splice(index, 1);
  renderScheduleList(person, type, periods);
}

function getScheduleValues(person, type) {
  const list = document.getElementById(`schedule-list-${person}-${type}`);
  if (!list) return [];
  return Array.from(list.querySelectorAll('.schedule-row')).map(row => ({
    label: row.querySelector('[data-field="label"]')?.value.trim() || '',
    start: row.querySelector('.custom-time-input[data-field="start"]')?.dataset.value || '',
    end: row.querySelector('.custom-time-input[data-field="end"]')?.dataset.value || '',
  }));
}

async function saveBellSchedule() {
  // Merge with existing schedule so we don't overwrite the other user's data
  const existing = window._bellSchedule || { kaliph: { regular: [], lateStart: [], lateStartDay: '' }, kathrine: { regular: [], lateStart: [], lateStartDay: '' } };
  const me = currentUser;
  const lateDayVal = getCustomSelectValue('late-day-mine');
  existing[me] = {
    regular: getScheduleValues('mine', 'regular'),
    lateStart: getScheduleValues('mine', 'lateStart'),
    lateStartDay: lateDayVal,
  };
  const resp = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bellSchedule: existing }) });
  if (!resp.ok) { SoundSystem.error(); showToast('Failed to save schedule'); return; }
  window._bellSchedule = existing;
  updateClassDisplays();
  SoundSystem.success();
  showToast('Bell schedule saved!');
}

function toggleCountdown(el) {
  SoundSystem.toggle();
  window._countdownEnabled = el.checked;
  fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ countdownEnabled: el.checked }) });
  updateClassDisplays();
}

// ── CUSTOM UI COMPONENTS ──────────────────────────────────────────────────

// ── Custom Select Dropdown ────────────────────────────────────────────────
function toggleCustomSelect(id) {
  const dropdown = document.getElementById(id + '-dropdown');
  if (!dropdown) return;
  const isOpen = dropdown.style.display !== 'none';
  closeAllCustomSelects();
  if (!isOpen) dropdown.style.display = '';
}
function closeAllCustomSelects() {
  document.querySelectorAll('.custom-select-dropdown').forEach(d => d.style.display = 'none');
}
function selectCustomOption(id, value, label) {
  const btn = document.getElementById(id + '-btn');
  if (btn) btn.querySelector('.custom-select-text').textContent = label;
  const dropdown = document.getElementById(id + '-dropdown');
  if (dropdown) {
    dropdown.querySelectorAll('.custom-select-option').forEach(o => o.classList.toggle('selected', o.dataset.value === value));
    dropdown.style.display = 'none';
  }
  // Store value on the wrap
  const wrap = document.getElementById(id + '-wrap');
  if (wrap) wrap.dataset.value = value;
}
function getCustomSelectValue(id) {
  // Try id-wrap first, then find wrap as parent of dropdown
  let wrap = document.getElementById(id + '-wrap');
  if (!wrap) {
    const dd = document.getElementById(id + '-dropdown');
    if (dd) wrap = dd.parentElement;
  }
  return wrap?.dataset.value ?? '';
}
function setCustomSelectValue(id, value, label) {
  // Find wrap
  let wrap = document.getElementById(id + '-wrap');
  if (!wrap) {
    const dd = document.getElementById(id + '-dropdown');
    if (dd) wrap = dd.parentElement;
  }
  if (wrap) {
    wrap.dataset.value = value;
    const btn = wrap.querySelector('.custom-select-btn');
    if (btn) {
      const txt = btn.querySelector('.custom-select-text');
      if (txt) txt.textContent = label;
    }
  }
  // Also try explicit btn id
  const explicitBtn = document.getElementById(id + '-btn');
  if (explicitBtn) {
    const txt = explicitBtn.querySelector('.custom-select-text');
    if (txt) txt.textContent = label;
  }
  const dropdown = document.getElementById(id + '-dropdown');
  if (dropdown) dropdown.querySelectorAll('.custom-select-option').forEach(o => o.classList.toggle('selected', o.dataset.value === value));
}

// Close dropdowns on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('.custom-select-wrap')) closeAllCustomSelects();
  if (!e.target.closest('.custom-time-picker-popup') && !e.target.closest('.custom-time-btn')) closeTimePicker();
});

// ── Custom Time Picker (for bell schedule) ────────────────────────────────
let _activeTimePicker = null;
function formatTime12(time24) {
  if (!time24) return '';
  const [h, m] = time24.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}
function parseTime12(h, m, ampm) {
  let hour = parseInt(h) || 0;
  if (ampm === 'PM' && hour !== 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${String(parseInt(m) || 0).padStart(2, '0')}`;
}

function openTimePicker(btnEl) {
  closeTimePicker();
  const wrap = btnEl.closest('.custom-time-input');
  const currentVal = wrap.dataset.value || '';
  let h = 12, m = 0, ampm = 'AM';
  if (currentVal) {
    const [hh, mm] = currentVal.split(':').map(Number);
    ampm = hh >= 12 ? 'PM' : 'AM';
    h = hh % 12 || 12;
    m = mm;
  }
  const popup = document.createElement('div');
  popup.className = 'custom-time-picker-popup';
  popup.innerHTML = `
    <div class="ctp-row">
      <div class="ctp-spinbox">
        <button type="button" class="ctp-spin" onclick="ctpSpin(this,'hour',1)">&#9650;</button>
        <input type="text" class="ctp-input" data-role="hour" value="${h}" maxlength="2" onclick="this.select()">
        <button type="button" class="ctp-spin" onclick="ctpSpin(this,'hour',-1)">&#9660;</button>
      </div>
      <span class="ctp-colon">:</span>
      <div class="ctp-spinbox">
        <button type="button" class="ctp-spin" onclick="ctpSpin(this,'minute',1)">&#9650;</button>
        <input type="text" class="ctp-input" data-role="minute" value="${String(m).padStart(2,'0')}" maxlength="2" onclick="this.select()">
        <button type="button" class="ctp-spin" onclick="ctpSpin(this,'minute',-1)">&#9660;</button>
      </div>
      <button type="button" class="ctp-ampm" onclick="ctpToggleAmPm(this)">${ampm}</button>
    </div>
    <button type="button" class="btn-ghost btn-sm ctp-done" onclick="ctpDone(this)">Done</button>
  `;
  wrap.appendChild(popup);
  _activeTimePicker = { popup, wrap, btnEl };
}
function closeTimePicker() {
  if (_activeTimePicker) {
    _activeTimePicker.popup.remove();
    _activeTimePicker = null;
  }
}
function ctpSpin(el, role, dir) {
  const popup = el.closest('.custom-time-picker-popup');
  const input = popup.querySelector(`[data-role="${role}"]`);
  let val = parseInt(input.value) || 0;
  if (role === 'hour') { val += dir; if (val > 12) val = 1; if (val < 1) val = 12; input.value = val; }
  else { val += dir * 5; if (val >= 60) val = 0; if (val < 0) val = 55; input.value = String(val).padStart(2, '0'); }
}
function ctpToggleAmPm(el) { el.textContent = el.textContent === 'AM' ? 'PM' : 'AM'; }
function ctpDone(el) {
  if (!_activeTimePicker) return;
  const popup = el.closest('.custom-time-picker-popup');
  const h = popup.querySelector('[data-role="hour"]').value;
  const m = popup.querySelector('[data-role="minute"]').value;
  const ampm = popup.querySelector('.ctp-ampm').textContent;
  const time24 = parseTime12(h, m, ampm);
  _activeTimePicker.wrap.dataset.value = time24;
  _activeTimePicker.btnEl.textContent = formatTime12(time24);
  _activeTimePicker.btnEl.classList.add('has-value');
  closeTimePicker();
}

// ── Custom DateTime Picker (for reminders) ────────────────────────────────
const _cdtpState = {};
function initCdtp(id) {
  if (!_cdtpState[id]) _cdtpState[id] = { year: getNow().getFullYear(), month: getNow().getMonth(), selectedDate: null };
}
function toggleDatetimePicker(id) {
  initCdtp(id);
  const picker = document.getElementById(id + '-picker');
  if (!picker) return;
  const isOpen = picker.style.display !== 'none';
  if (isOpen) { picker.style.display = 'none'; return; }
  picker.style.display = '';
  renderCdtpCalendar(id);
}
function closeDatetimePicker(id) {
  const picker = document.getElementById(id + '-picker');
  if (picker) picker.style.display = 'none';
  // Commit value
  commitDatetimeValue(id);
}
function commitDatetimeValue(id) {
  initCdtp(id);
  const st = _cdtpState[id];
  if (!st.selectedDate) return;
  const hEl = document.getElementById(id + '-hour');
  const mEl = document.getElementById(id + '-minute');
  const apEl = document.getElementById(id + '-ampm');
  let hour = parseInt(hEl?.value) || 12;
  const minute = parseInt(mEl?.value) || 0;
  const ampm = apEl?.textContent || 'AM';
  if (ampm === 'PM' && hour !== 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  const dt = new Date(st.selectedDate);
  dt.setHours(hour, minute, 0, 0);
  // Set the hidden input value in ISO-like format for submission
  const isoLocal = dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0') + 'T' + String(dt.getHours()).padStart(2,'0') + ':' + String(dt.getMinutes()).padStart(2,'0');
  document.getElementById(id).value = isoLocal;
  // Update button text
  const btn = document.getElementById(id + '-btn');
  if (btn) {
    const h12 = dt.getHours() % 12 || 12;
    const ap = dt.getHours() >= 12 ? 'PM' : 'AM';
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    btn.querySelector('.custom-datetime-text').textContent = `${months[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()} at ${h12}:${String(dt.getMinutes()).padStart(2,'0')} ${ap}`;
  }
}
function renderCdtpCalendar(id) {
  const st = _cdtpState[id];
  const grid = document.getElementById(id + '-grid');
  const label = document.getElementById(id + '-month');
  if (!grid || !label) return;
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  label.textContent = months[st.month] + ' ' + st.year;
  // Clear day cells (keep headers)
  const headers = grid.querySelectorAll('.cdtp-day-header');
  grid.innerHTML = '';
  headers.forEach(h => grid.appendChild(h));
  const firstDay = new Date(st.year, st.month, 1).getDay();
  const daysInMonth = new Date(st.year, st.month + 1, 0).getDate();
  const today = getNow(); today.setHours(0,0,0,0);
  for (let i = 0; i < firstDay; i++) { const empty = document.createElement('div'); empty.className = 'cdtp-day cdtp-day-empty'; grid.appendChild(empty); }
  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement('div');
    cell.className = 'cdtp-day';
    cell.textContent = d;
    const cellDate = new Date(st.year, st.month, d);
    if (cellDate.getTime() === today.getTime()) cell.classList.add('cdtp-today');
    if (st.selectedDate && cellDate.toDateString() === st.selectedDate.toDateString()) cell.classList.add('cdtp-selected');
    cell.onclick = () => { st.selectedDate = cellDate; renderCdtpCalendar(id); commitDatetimeValue(id); };
    grid.appendChild(cell);
  }
}
function cdtpPrev(id) { initCdtp(id); const st = _cdtpState[id]; st.month--; if (st.month < 0) { st.month = 11; st.year--; } renderCdtpCalendar(id); }
function cdtpNext(id) { initCdtp(id); const st = _cdtpState[id]; st.month++; if (st.month > 11) { st.month = 0; st.year++; } renderCdtpCalendar(id); }
function cdtpSpinHour(id, dir) {
  const el = document.getElementById(id + '-hour');
  let v = parseInt(el.value) || 12;
  v += dir; if (v > 12) v = 1; if (v < 1) v = 12;
  el.value = v;
  commitDatetimeValue(id);
}
function cdtpSpinMinute(id, dir) {
  const el = document.getElementById(id + '-minute');
  let v = parseInt(el.value) || 0;
  v += dir * 5; if (v >= 60) v = 0; if (v < 0) v = 55;
  el.value = String(v).padStart(2, '0');
  commitDatetimeValue(id);
}
function cdtpToggleAmPm(id) {
  const el = document.getElementById(id + '-ampm');
  el.textContent = el.textContent === 'AM' ? 'PM' : 'AM';
  commitDatetimeValue(id);
}
function cdtpClampHour(id) {
  const el = document.getElementById(id + '-hour');
  let v = parseInt(el.value) || 12;
  if (v < 1) v = 1; if (v > 12) v = 12;
  el.value = v;
  commitDatetimeValue(id);
}
function cdtpClampMinute(id) {
  const el = document.getElementById(id + '-minute');
  let v = parseInt(el.value) || 0;
  if (v < 0) v = 0; if (v > 59) v = 59;
  el.value = String(v).padStart(2, '0');
  commitDatetimeValue(id);
}
function setDatetimePickerValue(id, date) {
  initCdtp(id);
  const st = _cdtpState[id];
  st.selectedDate = new Date(date);
  st.year = st.selectedDate.getFullYear();
  st.month = st.selectedDate.getMonth();
  const h = st.selectedDate.getHours();
  const m = st.selectedDate.getMinutes();
  const h12 = h % 12 || 12;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hEl = document.getElementById(id + '-hour');
  const mEl = document.getElementById(id + '-minute');
  const apEl = document.getElementById(id + '-ampm');
  if (hEl) hEl.value = h12;
  if (mEl) mEl.value = String(m).padStart(2, '0');
  if (apEl) apEl.textContent = ampm;
  commitDatetimeValue(id);
}
function resetDatetimePicker(id) {
  _cdtpState[id] = { year: getNow().getFullYear(), month: getNow().getMonth(), selectedDate: null };
  document.getElementById(id).value = '';
  const btn = document.getElementById(id + '-btn');
  if (btn) btn.querySelector('.custom-datetime-text').textContent = 'Select date & time...';
  const hEl = document.getElementById(id + '-hour');
  const mEl = document.getElementById(id + '-minute');
  const apEl = document.getElementById(id + '-ampm');
  if (hEl) hEl.value = '12';
  if (mEl) mEl.value = '00';
  if (apEl) apEl.textContent = 'AM';
}

// ── Custom Priority Selector ──────────────────────────────────────────────
function selectPriority(id, value) {
  const wrap = document.getElementById(id + '-wrap');
  if (wrap) wrap.querySelectorAll('.custom-priority-btn').forEach(b => b.classList.toggle('active', b.dataset.value === value));
  const hidden = document.getElementById(id);
  if (hidden) hidden.value = value;
}

// ── GET CURRENT CLASS ──────────────────────────────────────────────────────
function getCurrentClass(username) {
  const bs = window._bellSchedule;
  if (!bs || !bs[username]) return null;
  // Check if schedule is skipped today (use site time)
  const siteNow = getNow();
  const today = siteNow.toISOString().split('T')[0];
  if (window._scheduleSkips[username] === today) return null;
  const data = bs[username];
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = days[siteNow.getDay()];
  // Weekend — no class
  if (dayName === 'sunday' || dayName === 'saturday') return null;
  const schedule = (data.lateStartDay && data.lateStartDay === dayName) ? (data.lateStart || []) : (data.regular || []);
  if (!schedule.length) return null;
  const nowMins = siteNow.getHours() * 60 + siteNow.getMinutes();
  for (const period of schedule) {
    if (!period.start || !period.end) continue;
    const [sh, sm] = period.start.split(':').map(Number);
    const [eh, em] = period.end.split(':').map(Number);
    const startMins = sh * 60 + sm;
    const endMins = eh * 60 + em;
    if (nowMins >= startMins && nowMins < endMins) {
      return { label: period.label, start: period.start, end: period.end, endMins };
    }
  }
  return null;
}

function formatCountdown(endMins) {
  const siteNow = getNow();
  const nowMins = siteNow.getHours() * 60 + siteNow.getMinutes();
  const nowSecs = siteNow.getSeconds();
  const totalSecsLeft = (endMins - nowMins) * 60 - nowSecs;
  if (totalSecsLeft <= 0) return '0:00';
  const m = Math.floor(totalSecsLeft / 60);
  const s = totalSecsLeft % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function updateClassDisplays() {
  // Other user — chat header + profile
  const otherClass = getCurrentClass(otherUser);
  const otherLabel = document.getElementById('other-class-label');
  if (otherLabel) otherLabel.textContent = otherClass ? '📚 ' + otherClass.label : '';

  // Current user — sidebar
  const myClass = getCurrentClass(currentUser);
  const myLabel = document.getElementById('my-class-label');
  if (myLabel) myLabel.textContent = myClass ? '📚 ' + myClass.label : '';

  // Countdown bar — only for current user
  const bar = document.getElementById('class-countdown-bar');
  const textEl = document.getElementById('class-countdown-text');
  const timerEl = document.getElementById('class-countdown-timer');
  if (bar && textEl && timerEl) {
    if (myClass && window._countdownEnabled) {
      bar.style.display = '';
      textEl.textContent = myClass.label + ' ends in';
      timerEl.textContent = formatCountdown(myClass.endMins);
    } else {
      bar.style.display = 'none';
    }
  }
}

function startClassUpdater() {
  updateClassDisplays();
  if (_classInterval) clearInterval(_classInterval);
  // Update every second for smooth countdown
  _classInterval = setInterval(updateClassDisplays, 1000);
}

// Listen for schedule skip from eval
if (typeof socket !== 'undefined') {
  socket?.on('schedule-skip', data => {
    if (data.date) window._scheduleSkips[data.user] = data.date;
    else delete window._scheduleSkips[data.user];
    updateClassDisplays();
  });
}

async function saveProfile() {
  const displayName = document.getElementById('profile-display-name').value.trim();
  const pronouns = document.getElementById('profile-pronouns').value.trim();
  const customStatus = document.getElementById('profile-custom-status').value.trim();
  const bio = document.getElementById('profile-bio').value;
  const color = document.getElementById('profile-name-color').value;
  await fetch(`/api/users/${currentUser}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName, pronouns, customStatus, bio, nameStyle: { color, gradient: true } })
  });
  SoundSystem.success();
  document.getElementById('my-name').textContent = displayName;
  nameColors[currentUser] = color;
  renderMessages();
  showToast('✅ Profile saved!');
}

async function saveEmails() {
  const email = document.getElementById('my-email-input').value;
  const body = { emails: { [currentUser]: email } };
  await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  SoundSystem.success();
  showToast('📧 Email saved!');
}

async function sendTestEmail() {
  showToast('📧 Sending test email...');
  try {
    const r = await fetch('/api/settings/test-email', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const result = await r.json();
    if (result.success) {
      showToast('✅ Test email sent! Check your inbox.');
    } else {
      showToast('❌ ' + (result.error || 'Failed to send test email'));
    }
  } catch {
    showToast('❌ Could not reach the server');
  }
}

async function saveAllEmails() {
  const kaliphEmails = getEmailValues('kaliph').filter(e => e);
  const kathrineEmails = getEmailValues('kathrine').filter(e => e);
  await fetch('/api/settings', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emails: {
      kaliph: kaliphEmails,
      kathrine: kathrineEmails,
    }})
  });
  SoundSystem.success();
  showToast('📧 Emails saved!');
}

async function uploadAvatar(input) {
  if (!input.files[0]) return;
  const fd = new FormData(); fd.append('avatar', input.files[0]);
  const r = await fetch(`/api/users/${currentUser}/avatar`, { method: 'POST', body: fd });
  const d = await r.json();
  if (d.avatar) {
    document.getElementById('settings-avatar').innerHTML = `<img src="${d.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    const wrapper = document.getElementById('my-avatar');
    const avatarDiv = wrapper.querySelector('.avatar');
    if (avatarDiv) avatarDiv.innerHTML = `<img src="${d.avatar}" alt="">`;
    else wrapper.innerHTML = `<div class="avatar"><img src="${d.avatar}" alt=""></div><div class="status-indicator online" id="my-status-dot"></div>`;
    SoundSystem.success();
    showToast('🖼️ Avatar updated!');
  }
}

async function uploadBanner(input) {
  if (!input.files[0]) return;
  const fd = new FormData(); fd.append('banner', input.files[0]);
  const r = await fetch(`/api/users/${currentUser}/banner`, { method: 'POST', body: fd });
  const d = await r.json();
  if (d.banner) {
    const bannerEl = document.getElementById('profile-edit-banner');
    if (bannerEl) { bannerEl.style.backgroundImage = `url(${d.banner})`; bannerEl.style.backgroundSize = 'cover'; }
    SoundSystem.success();
    showToast('🖼️ Banner updated!');
  }
}

async function viewProfile(username) {
  const users = await fetch('/api/users').then(r => r.json());
  window._users = users; // Refresh cache
  const u = users[username];
  if (!u) return;
  // Banner
  const banner = document.getElementById('pv-banner');
  if (u.banner) {
    banner.style.backgroundImage = `url(${u.banner})`;
    banner.style.backgroundSize = 'cover';
    banner.style.backgroundPosition = 'center';
  } else {
    banner.style.backgroundImage = '';
    banner.style.background = `linear-gradient(135deg, var(--accent), var(--bg-card))`;
  }
  // Avatar
  const avatarEl = document.getElementById('pv-avatar');
  if (u.avatar) {
    avatarEl.innerHTML = `<img src="${u.avatar}" alt="">`;
    avatarEl.style.cursor = 'pointer';
    avatarEl.onclick = () => {
      document.getElementById('enlarged-avatar-img').src = u.avatar;
      openModal('enlarged-avatar-modal');
    };
  } else {
    avatarEl.innerHTML = `<span>${(u.displayName || u.name)[0].toUpperCase()}</span>`;
    avatarEl.onclick = null;
    avatarEl.style.cursor = '';
  }
  // Status — use live _presence from server
  const statusColors = { online: '#22c55e', idle: '#eab308', dnd: '#ef4444', invisible: '#6b7280' };
  const pvPresence = u._presence || 'offline';
  const pvStatus = pvPresence === 'online' ? 'online' : pvPresence === 'idle' ? 'idle' : 'invisible';
  const pvDot = document.getElementById('pv-status-dot');
  pvDot.style.background = statusColors[pvStatus] || '#22c55e';
  pvDot.className = 'pc-status-dot' + (pvStatus === 'online' ? ' online' : '');
  // Names
  const nameEl = document.getElementById('pv-name');
  nameEl.textContent = u.displayName || capitalize(u.name);
  nameEl.style.color = u.nameStyle?.color || '';
  document.getElementById('pv-username').textContent = u.name + (u.pronouns ? ' \u2022 ' + u.pronouns : '');
  // Status display (Discord style — icon + label)
  const statusSection = document.getElementById('pv-status-section');
  if (statusSection) {
    const statusColors = { online: '#22c55e', idle: '#eab308', dnd: '#ef4444', invisible: '#6b7280' };
    const statusLucide = { online: 'circle', idle: 'moon', dnd: 'minus-circle', invisible: 'eye-off' };
    const statusLabels = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', invisible: 'Invisible' };
    const userStatus = u.status || pvStatus;
    const sColor = statusColors[userStatus] || '#22c55e';
    const sIcon = statusLucide[userStatus] || 'circle';
    statusSection.innerHTML = `
      <div class="pc-section-title">STATUS</div>
      <div class="pv-status-row">
        <span class="pv-status-icon" style="color:${sColor};display:inline-flex;align-items:center"><i data-lucide="${sIcon}" style="width:14px;height:14px;fill:${userStatus === 'online' ? sColor : 'none'}"></i></span>
        <span class="pv-status-label">${statusLabels[userStatus] || 'Online'}</span>
        ${u.customStatus ? `<span class="pv-status-custom">— ${escapeHtml(u.customStatus)}</span>` : ''}
        ${u.statusEmoji ? `<span class="pv-status-emoji">${u.statusEmoji}</span>` : ''}
      </div>
      ${username === currentUser ? `<button class="pv-edit-status-btn" onclick="openStatusEditor()"><i data-lucide="pencil" style="width:12px;height:12px"></i> Edit Status</button>` : ''}
    `;
    statusSection.style.display = '';
    if (window.lucide) lucide.createIcons({ attrs: { class: 'lucide' } });
  }

  // Custom status (legacy display — now merged into status section above)
  const csEl = document.getElementById('pv-custom-status');
  csEl.style.display = 'none'; // Hidden — shown in status section now
  // Current class
  const classSec = document.getElementById('pv-class-section');
  const classText = document.getElementById('pv-class-text');
  if (classSec && classText) {
    const cls = getCurrentClass(username);
    if (cls) { classSec.style.display = ''; classText.textContent = '📚 ' + cls.label + ' (' + formatTime12(cls.start) + ' – ' + formatTime12(cls.end) + ')'; }
    else classSec.style.display = 'none';
  }
  // Pronouns
  const pronounsSec = document.getElementById('pv-pronouns-section');
  if (u.pronouns) { pronounsSec.style.display = ''; document.getElementById('pv-pronouns').textContent = u.pronouns; }
  else pronounsSec.style.display = 'none';
  // Bio
  document.getElementById('pv-bio').textContent = u.bio || 'No bio set.';
  // Last seen — only show if user is actually offline (not online or idle)
  const lsSec = document.getElementById('pv-lastseen-section');
  if (u._presence === 'offline' && u.lastSeen && username !== currentUser) {
    lsSec.style.display = '';
    document.getElementById('pv-lastseen').textContent = formatLastSeen(u.lastSeen);
  } else {
    lsSec.style.display = 'none';
  }
  // Member since
  document.getElementById('pv-member-since').textContent = u.createdAt ? new Date(u.createdAt).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }) : 'The beginning';
  // Edit button (only for own profile)
  document.getElementById('pv-edit-btn').style.display = username === currentUser ? 'flex' : 'none';
  document.getElementById('pv-schedule-btn').style.display = 'flex';
  window._lastViewedProfileUser = username;
  openModal('profile-viewer-modal');
  if (window.lucide) lucide.createIcons();
}

// ── Schedule Viewer Modal ─────────────────────────────────────────────
function openScheduleModal() {
  const user = window._lastViewedProfileUser || currentUser;
  const bs = window._bellSchedule;
  if (!bs || !bs[user]) {
    showToast('No schedule data available.');
    return;
  }
  closeModal('profile-viewer-modal');
  const data = bs[user];
  const displayName = user === 'kaliph' ? 'Kaliph' : 'Kathrine';
  document.getElementById('schedule-viewer-title').textContent = displayName + "'s Schedule";
  const regular = data.regular || [];
  const lateStart = data.lateStart || [];
  const lateDay = data.lateStartDay || '';

  let html = '';
  // Regular schedule
  html += '<div style="margin-bottom:16px"><div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary);margin-bottom:8px">Regular Schedule</div>';
  if (regular.length) {
    html += '<div class="schedule-view-table">';
    regular.forEach(p => {
      html += `<div class="schedule-view-row">
        <span class="schedule-view-label">${escapeHtml(p.label || 'Period')}</span>
        <span class="schedule-view-time">${p.start ? formatTime12(p.start) : '—'} – ${p.end ? formatTime12(p.end) : '—'}</span>
      </div>`;
    });
    html += '</div>';
  } else {
    html += '<div style="font-size:0.82rem;color:var(--text-muted);padding:8px 0">No regular periods set.</div>';
  }
  html += '</div>';

  // Late start schedule
  if (lateStart.length || lateDay) {
    html += '<div><div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary);margin-bottom:8px">Late Start Schedule';
    if (lateDay) html += ` <span style="font-weight:400;text-transform:capitalize;color:var(--text-muted)">— ${lateDay}s</span>`;
    html += '</div>';
    if (lateStart.length) {
      html += '<div class="schedule-view-table">';
      lateStart.forEach(p => {
        html += `<div class="schedule-view-row">
          <span class="schedule-view-label">${escapeHtml(p.label || 'Period')}</span>
          <span class="schedule-view-time">${p.start ? formatTime12(p.start) : '—'} – ${p.end ? formatTime12(p.end) : '—'}</span>
        </div>`;
      });
      html += '</div>';
    } else {
      html += '<div style="font-size:0.82rem;color:var(--text-muted);padding:8px 0">No late start periods set.</div>';
    }
    html += '</div>';
  }

  document.getElementById('schedule-viewer-content').innerHTML = html;
  setTimeout(() => { openModal('schedule-viewer-modal'); if (window.lucide) lucide.createIcons(); }, 150);
}

// ── Status Editor (editable from profile) ─────────────────────────────
function openStatusEditor() {
  closeModal('profile-viewer-modal');
  setTimeout(() => openModal('status-editor-modal'), 150);
  // Populate with current values
  const users = window._users || {};
  const u = users[currentUser] || {};
  const statusVal = u.status || 'online';
  const statusLabels = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', invisible: 'Invisible' };
  const statusColors = { online: '#22c55e', idle: '#eab308', dnd: '#ef4444', invisible: '#6b7280' };
  setCustomSelectValue('se-status-select', statusVal, statusLabels[statusVal] || 'Online');
  // Update the dot color in the button
  const dot = document.querySelector('#se-status-select-wrap .se-status-dot');
  if (dot) dot.style.background = statusColors[statusVal] || '#22c55e';
  document.getElementById('se-custom-status').value = u.customStatus || '';
  document.getElementById('se-status-emoji').value = u.statusEmoji || '';
  if (window.lucide) lucide.createIcons({ node: document.getElementById('se-status-select-wrap') });
}

function selectStatus(value, label, color) {
  setCustomSelectValue('se-status-select', value, label);
  const dot = document.querySelector('#se-status-select-wrap .se-status-dot');
  if (dot) dot.style.background = color;
  closeAllCustomSelects();
}

async function saveStatus() {
  const status = getCustomSelectValue('se-status-select');
  const customStatus = document.getElementById('se-custom-status').value.trim();
  const statusEmoji = document.getElementById('se-status-emoji').value.trim() || '';
  await fetch(`/api/users/${currentUser}/status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, customStatus, statusEmoji })
  });
  // Update local cache
  if (window._users && window._users[currentUser]) {
    window._users[currentUser].status = status;
    window._users[currentUser].customStatus = customStatus;
    window._users[currentUser].statusEmoji = statusEmoji;
  }
  closeModal('status-editor-modal');
  showToast('Status updated!');
  // Also emit to socket so header updates
  socket.emit('status-change', { user: currentUser, status, customStatus, statusEmoji });
  // Update own status dot
  setStatusDot('my-status-dot', status);
  updateStatusText(status);
}

async function clearStatus() {
  await fetch(`/api/users/${currentUser}/status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'online', customStatus: '', statusEmoji: '' })
  });
  if (window._users && window._users[currentUser]) {
    window._users[currentUser].status = 'online';
    window._users[currentUser].customStatus = '';
    window._users[currentUser].statusEmoji = '';
  }
  closeModal('status-editor-modal');
  showToast('Status cleared');
  socket.emit('status-change', { user: currentUser, status: 'online' });
  setStatusDot('my-status-dot', 'online');
  updateStatusText('online');
}

async function toggleWallpaper(el) {
  const enabled = el.checked;
  const uploadRow = document.getElementById('wallpaper-upload-row');
  if (uploadRow) uploadRow.style.display = enabled ? '' : 'none';
  fetch(`/api/users/${currentUser}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallpaperEnabled: enabled })
  });
  if (enabled) {
    // Re-fetch the shared wallpaper when re-enabling
    const wpRes = await fetch('/api/wallpaper').then(r => r.json()).catch(() => ({}));
    if (wpRes.wallpaper) applyWallpaper(wpRes.wallpaper);
  } else {
    const area = document.getElementById('messages-area');
    area.classList.remove('wallpaper-on');
    area.style.backgroundImage = '';
  }
  // Sync both toggles
  ['toggle-wallpaper','modal-wallpaper-toggle'].forEach(id => {
    const el2 = document.getElementById(id);
    if (el2) el2.checked = enabled;
  });
}

async function uploadWallpaper(input) {
  if (!input.files[0]) return;
  const fd = new FormData(); fd.append('wallpaper', input.files[0]);
  const r = await fetch(`/api/users/${currentUser}/wallpaper`, { method: 'POST', body: fd });
  const d = await r.json();
  if (d.wallpaper) { applyWallpaper(d.wallpaper); showToast('🖼️ Wallpaper set!'); }
}

function applyWallpaper(url) {
  const area = document.getElementById('messages-area');
  area.classList.add('wallpaper-on');
  area.style.backgroundImage = `url(${url})`;
}

function clearWallpaper() {
  const area = document.getElementById('messages-area');
  area.classList.remove('wallpaper-on');
  area.style.backgroundImage = '';
  // Just disable locally — don't remove the shared wallpaper
  fetch(`/api/users/${currentUser}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallpaperEnabled: false }) });
  ['toggle-wallpaper','modal-wallpaper-toggle'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = false;
  });
  showToast('Wallpaper hidden on your side');
}

function toggleGif(el) {
  fetch(`/api/users/${currentUser}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gifEnabled: el.checked }) });
  document.getElementById('gif-btn').style.display = el.checked ? '' : 'none';
}

function togglePerfMode(el) {
  const enabled = el.checked;
  document.body.classList.toggle('perf-mode', enabled);
  const tog = document.getElementById('toggle-perf');
  if (tog) tog.checked = enabled;
  fetch(`/api/users/${currentUser}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ perfMode: enabled })
  });
  showToast(enabled ? '⚡ Performance mode on' : '✨ Performance mode off');
}

    version: '3.6.0',
    date: 'Mar 12 2026',
    intro: 'GIF categories, hover favorites, Chromebook typing speed improvements, real time override, and a cleaner update log.',
    sections: [
      { icon: '🎬', title: 'GIFs', items: [
        { name: 'GIF Categories', desc: 'GIF picker now has tabs — Trending, Favorites, Reactions, Scandal, Memes, and Gaming.' },
        { name: 'Hover to Favorite', desc: 'Hover over any GIF and click the ♥ button to save it to your Favorites tab.' },
        { name: 'Favorites Tab', desc: 'Access all your saved GIFs instantly from the Favorites tab.' },
        { name: 'Search Results Show Media', desc: 'has:file and has:image in search now show actual image thumbnails and GIF previews.' },
        { name: 'Pinned Messages Show Media', desc: 'Pinned messages panel now shows images and GIFs inline instead of a placeholder.' },
      ]},
      { icon: '⏰', title: 'Time Override', items: [
        { name: 'Real Time Simulation', desc: 'Eval "time set" now fully simulates the site at that time — bell schedule, reminders, and countdowns all respond as if it were actually that time.' },
      ]},
      { icon: '⚡', title: 'Performance', items: [
        { name: 'Faster Typing', desc: 'Input box resize is now deferred with requestAnimationFrame — no more layout jank while typing on Chromebook.' },
        { name: 'Passive Scroll', desc: 'Scroll listeners are now passive, reducing stutter when scrolling through messages.' },
        { name: 'Emoji Autocomplete Debounce', desc: 'Emoji autocomplete search is debounced so it no longer runs on every single keystroke.' },
      ]},
      { icon: '🗒️', title: 'Update Log', items: [
        { name: 'Latest Only', desc: 'Update log on login now shows only the most recent update instead of stacking all unseen ones.' },
      ]},
    ],
  },
  {
    version: '3.5.0',
    date: 'Mar 12 2026',
    intro: 'A huge polish & power update — Discord-style text formatting, enchanted profile cards, drag-to-reorder todos, theme builder eval commands, editable contacts, and 30+ refinements across the entire app.',
    sections: [
      { icon: '💬', title: 'Chat', items: [
        { name: 'Discord Formatting', desc: 'Use **bold**, __underline__, ~~strikethrough~~, ||spoiler||, `code`, and ```code blocks```.' },
        { name: 'Reliable Scroll', desc: 'Chat now reliably scrolls to your last read position on open.' },
        { name: 'Bigger Header Icons', desc: 'Pin, call, video & wallpaper icons are larger and cleaner.' },
      ]},
      { icon: '🎨', title: 'Themes & Sounds', items: [
        { name: 'Theme Sound Preview', desc: 'Changing your theme plays a preview of its sound profile.' },
        { name: 'Rosewood & Ocean Sounds', desc: 'New acoustic profiles for Rose & Ember and Deep Tide themes.' },
        { name: 'Reminder Colors', desc: 'Priority popup colors optimized per theme — no more harsh brightness.' },
        { name: 'Notification Sounds', desc: 'Announcements and reminders now trigger a gentle chime.' },
      ]},
      { icon: '👤', title: 'Profiles & Cards', items: [
        { name: 'Enchanted Forest', desc: 'Kathrine profile card has floating flower animations.' },
        { name: 'Profile Pic Zoom', desc: 'Click any profile picture to view it enlarged.' },
        { name: 'View Schedule', desc: 'Button on profile viewer to see someone\'s schedule.' },
        { name: 'Larger Avatars', desc: 'Profile card avatars bumped to 90px for better visibility.' },
      ]},
      { icon: '📱', title: 'Apps & Tools', items: [
        { name: 'Editable Contacts', desc: 'Edit existing contacts via pencil icon — no need to delete and re-add.' },
        { name: 'Drag Reorder Todos', desc: 'Drag todo items to rearrange their order.' },
        { name: 'iPad Todo Editing', desc: 'Larger input box for editing long todo items on tablets.' },
        { name: 'Calendar Event Emoji', desc: 'Choose a custom emoji per event, or get a random school-themed one.' },
        { name: 'Document Locker', desc: 'File Vault renamed to Document Locker everywhere.' },
      ]},
      { icon: '🛠️', title: 'Admin & Eval', items: [
        { name: 'Theme Builder', desc: 'Build custom themes via eval: theme builder, set, preview, reset.' },
        { name: 'Reset Password', desc: 'Reset the site password from eval terminal.' },
        { name: 'Time Override', desc: 'Set/reset the site clock for testing schedules: time set/reset.' },
        { name: 'Guests Archive', desc: 'Archive command now works correctly in eval.' },
      ]},
      { icon: '🧹', title: 'Cleanup', items: [
        { name: 'Icons Over Emojis', desc: 'All empty states now use Lucide icons instead of emojis.' },
        { name: 'No Browser UI', desc: 'Password change removed from settings — eval only.' },
        { name: 'Preview Cmd Removed', desc: 'Deprecated preview eval command cleaned up.' },
        { name: 'iPad Quick Actions', desc: 'Message hover actions no longer stick on iPad — tap to toggle.' },
      ]},
    ],
    fixes: [
      'Chat scroll no longer jumps to random positions on open',
      'iPad zoom prevention via touch-action and viewport meta',
      'Guest archive eval command now returns proper data',
      'Dark theme sizing fixed to fill browser with 100dvh',
    ],
  },
  {
    version: '3.4.0',
    date: 'Mar 11 2026',
    intro: 'Massive update — event editing, reminder fixes, modernized UI across the board, theme refinements, guest pass overhaul, and more.',
    sections: [
      { icon: '📅', title: 'Calendar & Events', items: [
        { name: 'Edit Events', desc: 'Click the pencil icon on any calendar event to edit its title, dates, description, color, and reminder.' },
        { name: 'Eval Time Override', desc: 'Set the site\'s time via eval for testing calendar events and reminders.' },
      ]},
      { icon: '🔔', title: 'Reminders', items: [
        { name: 'No More Popup Spam', desc: 'Reminder and event notifications no longer re-show every time you load the site.' },
        { name: 'Duplication Fix', desc: 'Fixed a bug where reminders could appear duplicated in the list.' },
        { name: 'Modern Notify Toggles', desc: 'The "Notify via" checkboxes are now sleek toggle switches matching the site design.' },
      ]},
      { icon: '🎨', title: 'UI & Themes', items: [
        { name: 'Priority Badge Refresh', desc: 'Priority message indicator redesigned with a clean icon-based pill instead of emoji.' },
        { name: 'Priority Notifications UI', desc: 'Priority notification styling now matches the site\'s native design language.' },
        { name: 'Dark Theme Chat Fix', desc: 'Main chat area on dark theme optimized for smaller screens — no more needing to zoom out on Chromebook.' },
        { name: 'Dark Theme Chat Tab Centered', desc: 'Chat tab now properly centered on dark theme.' },
        { name: 'Text & Font Optimization', desc: 'Optimized all text, fonts, and buttons across every theme so nothing is too bright or too dark to see.' },
        { name: 'Kaliph\'s Theme Revamp', desc: 'Kaliph\'s AVNT theme has been visually revamped with a fresh modern look.' },
        { name: 'Celestial Heaven Replaced', desc: 'Celestial Heaven theme has been redone with an improved design.' },
        { name: 'Enchanted Forest Text Size', desc: 'Increased text size on the Enchanted Forest theme for better readability.' },
        { name: 'Royal K&K Logo Sizing', desc: 'Royal K&K header logo is now bigger and more prominent on each theme.' },
      ]},
      { icon: '💬', title: 'Chat & Messaging', items: [
        { name: 'Slash Commands Everywhere', desc: 'Slash key now works in all text boxes across the site, not just the main chat input.' },
        { name: 'More Sound Effects', desc: 'Added more sound effects throughout the site for a richer audio experience.' },
      ]},
      { icon: '📝', title: 'Notes & Todos', items: [
        { name: 'Stealth Mode Notes Fix', desc: 'In stealth mode, notes and todos now correctly use "My Notes" instead of the other user\'s.' },
        { name: 'Editable Todo Items', desc: 'Todo list items can now be edited after being added — clicking opens edit mode instead of just toggling done.' },
      ]},
      { icon: '🔒', title: 'Settings & Security', items: [
        { name: 'Desktop Notifications Fixed', desc: 'Desktop notifications button in settings now properly requests and enables browser notifications.' },
        { name: 'Channel Permissions Revamp', desc: 'Revamped the channel permissions tab in guest settings with a cleaner layout.' },
        { name: 'Guest Pass Expiration Revamp', desc: 'Guest pass expiration now allows more specific countdowns — down to minutes or a set time.' },
        { name: 'Guest Passes Page Revamp', desc: 'Guest passes page modernized with updated UI and improved workflow.' },
      ]},
      { icon: '👤', title: 'Profiles & Login', items: [
        { name: 'Profile UI Revamp', desc: 'Profile change UI has been slightly revamped for a cleaner look.' },
        { name: 'Profile Animations', desc: 'Opening profiles now has smooth animations and a modern layout inspired by Discord.' },
        { name: 'New Login Screen', desc: 'Fresh new login screen design.' },
      ]},
    ],
  },
  {
    version: '3.3.0',
    date: 'Mar 11 2026',
    intro: 'Full reminders system with multi-channel notifications, plus click-to-jump on replied messages.',
    sections: [
      { icon: '🔔', title: 'Reminders', items: [
        { name: 'Reminders Tab', desc: 'New dedicated Reminders section in the sidebar — create, edit, and manage reminders with priority levels.' },
        { name: 'Multi-Channel Notifications', desc: 'Get notified via on-site toast, push notification, and/or email — choose per reminder.' },
        { name: 'Snooze & Repeat', desc: 'Snooze reminders for 1 hour, or set them to repeat daily, weekly, or monthly.' },
        { name: 'Smart Badge', desc: 'Sidebar badge shows count of overdue reminders at a glance.' },
        { name: 'Rich Toast Notifications', desc: 'On-site reminders show as rich toasts with Snooze, Done, and Dismiss actions.' },
      ]},
      { icon: '💬', title: 'Chat', items: [
        { name: 'Click to Jump on Replies', desc: 'Click a replied message preview to jump to and highlight the original message.' },
      ]},
    ],
  },
  {
    version: '3.2.0',
    date: 'Mar 11 2026',
    intro: 'Bell schedules, smarter search, calendar reminders, and a bunch of quality-of-life fixes.',
    sections: [
      { icon: '🔔', title: 'Bell Schedule', items: [
        { name: 'Schedule Builder', desc: 'Add your class schedule in Settings with period names and times.' },
        { name: 'Late Start Support', desc: 'Configure a separate late-start schedule and pick your late-start day.' },
        { name: 'Current Class Display', desc: 'Your current class shows automatically in the chat header, sidebar, and profile.' },
        { name: 'Class Countdown Timer', desc: 'Countdown until your current class ends, shown in a bar above the chat. Toggle it off in Chat settings.' },
        { name: 'Skip Schedule (Eval)', desc: 'Use "skipclass <user>" in eval to skip the bell schedule for a day.' },
      ]},
      { icon: '💬', title: 'Chat & Search', items: [
        { name: 'Custom Status in Header', desc: 'Custom status text and emoji now show inline with presence in the chat header.' },
        { name: 'Search: Newest First', desc: 'Search results now show latest messages at the top.' },
        { name: 'Search: Better Times', desc: 'Search results show "Yesterday 3:30 PM" or "3/10/2026 3:30 PM" for older messages.' },
        { name: 'Pinned Messages: Full Text', desc: 'Pinned messages panel now shows the complete message instead of truncating.' },
        { name: 'Chat Layout: Full Width', desc: 'Chat messages now fill the full screen width in light and dark themes.' },
        { name: 'Scroll to Last Read', desc: 'Fixed unreliable scroll position when opening the site — now reliably jumps to your last read message.' },
      ]},
      { icon: '📅', title: 'Calendar', items: [
        { name: 'Event Reminders', desc: 'Set a reminder when creating events — get notified 0-7 days before.' },
        { name: 'Today\'s Events Banner', desc: 'A subtle banner shows at the top of chat when you have events today.' },
      ]},
      { icon: '🎨', title: 'Dark Theme', items: [
        { name: 'Search Bar Restored', desc: 'Search bar now appears in the dark theme horizontal top bar.' },
      ]},
    ],
  },
  {
    version: '3.1.0',
    date: 'Mar 10 2026',
    intro: 'This is the biggest update yet — 25 new features across chat, emoji, profiles, guests, and more. Everything has been refined to feel smoother, look cleaner, and work faster. ✨',
    sections: [
      { icon: '💬', title: 'Chat', items: [
        { name: 'Pinned Messages', desc: 'Pin via hover menu or right-click. Pinned panel in the header.' },
        { name: 'Unread Divider', desc: 'Red "NEW" marker auto-scrolls to where you left off.' },
        { name: 'Rich Link Embeds', desc: 'URLs show preview cards with image, title & description.' },
        { name: 'Drag & Drop Files', desc: 'Drop images or files into the message box, or paste from clipboard.' },
        { name: 'File Previews', desc: 'Thumbnails appear above the input before you send.' },
        { name: 'Live Formatting', desc: 'Bold, italic, underline preview as you type.' },
        { name: 'Custom Audio Player', desc: 'Sleek play/pause, progress bar & seek for voice messages.' },
        { name: 'Self Messages', desc: 'Your name, avatar & chat color now show on your own messages.' },
      ]},
      { icon: '😊', title: 'Emoji & Reactions', items: [
        { name: 'Emoji Autocomplete', desc: 'Type :name: for Discord-style autocomplete with arrow keys.' },
        { name: 'Reaction Picker', desc: 'Click + on the reaction bar to pick any emoji.' },
        { name: 'Expanded Emoji Set', desc: '160+ emojis with text search.' },
        { name: 'GIF Search', desc: 'GIPHY-powered search with proper embed rendering.' },
      ]},
      { icon: '👤', title: 'Profiles & Status', items: [
        { name: 'Status on Profiles', desc: 'Online/Idle/DND/Invisible & custom text on profile cards.' },
        { name: 'Editable Status', desc: 'Click "Edit Status" on your profile — no Settings needed.' },
      ]},
      { icon: '👋', title: 'Guest Experience', items: [
        { name: 'Guest Profile Viewing', desc: 'Guests can click host avatars to see full profiles.' },
        { name: 'Messages Overhaul', desc: 'Proper bubbles, sender names, live notifications with sound.' },
        { name: 'Guest Revocation', desc: 'Revoked guests instantly disappear from the sidebar.' },
      ]},
      { icon: '📱', title: 'Apps & Tools', items: [
        { name: 'Contacts Revamp', desc: 'Search, sort, letter headers, detail modal & phone formatting.' },
        { name: 'Calendar Multi-Day', desc: 'One UI-style range picker with spanning colored bars.' },
        { name: 'Notes & Todos', desc: 'Animated circular checkboxes, progress bar, polished layout.' },
        { name: 'Two New Themes', desc: 'Rose & Ember (warm rose-gold) and Deep Tide (teal-emerald).' },
        { name: 'Instant Loading', desc: 'Notes, contacts & guest data preloaded at startup.' },
      ]},
      { icon: '🛠️', title: 'Admin & Eval', items: [
        { name: 'Stealth Browse', desc: 'Inspect user data without touching lastSeen or read receipts.' },
        { name: 'Eval Unsend', desc: 'Flag messages as unsendable — bypasses the 3-minute limit.' },
        { name: 'Announcement Dismiss', desc: 'Both users can now dismiss any announcement.' },
      ]},
    ],
    fixes: [
      'Update log only dismisses once per version',
      'GIF messages render as images, not text links',
      'Guest messages match main chat styling',
    ],
  },
  {
    version: '2.0.0',
    date: 'Mar 10 2026',
    improvements: [
      'Vault File Preview — click any file to preview inline (images, videos, PDFs, audio) with open & download buttons',
      'Push Notifications — get notified of new messages even when the site is closed',
      'Missed & Ended Call Indicators — calls now show as system messages in chat',
      'Custom Dialogs — all popups replaced with sleek in-app modals',
      'Eval Terminal — password now saves across server restarts',
    ],
    fixes: [
      'Email notifications restored with reliable connection pooling',
      'Backdoor confirm dialog is now a proper popup instead of always visible',
      'Backdoor page scrolls correctly on all screen sizes',
      'Eval login clears input on wrong password',
      'Eval login screen made larger and easier to use',
    ],
  },
  {
    version: '1.5.0',
    date: 'Mar 10 2026',
    improvements: [
      'Update History tab in Settings — browse all past changelogs',
    ],
  },
  {
    version: '1.4.0',
    date: 'Mar 10 2026',
    improvements: [
      'Admin eval terminal with 90+ commands',
      'Eval settings with 3 themes (Hacker, Cyberpunk, Amber)',
      'Command autocomplete in eval terminal',
      'Update logs shown on login',
    ],
    removed: [
      'Gmail SMTP (replaced with Brevo email API)',
    ],
    fixes: [
      'Email notifications now use Brevo HTTP API (works on Railway)',
      'Test emails send to all addresses instead of just the first',
      'Search bar no longer shows autofill on load',
      'Chat no longer flashes empty before messages load',
      'Backdoor: separate option to erase chat history',
      'Fixed "set banner clear" command being unreachable',
    ],
  },
];

function renderChangelogEntry(entry, { skipHeader = false } = {}) {
  let html = '';

  // New sectioned format (v3.1.0+)
  if (entry.sections) {
    // Version badge (skip in settings history where summary already shows it)
    if (!skipHeader) {
      html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">`;
      html += `<span style="background:var(--accent);color:#fff;font-size:0.65rem;font-weight:700;padding:2px 8px;border-radius:99px;letter-spacing:0.5px">v${escapeHtml(entry.version)}</span>`;
      html += `<span style="color:var(--text-muted);font-size:0.7rem">${escapeHtml(entry.date)}</span>`;
      html += `</div>`;
    }

    // Intro paragraph
    if (entry.intro) {
      html += `<p style="color:var(--text);font-size:0.82rem;line-height:1.55;margin:0 0 1rem 0;opacity:0.9">${escapeHtml(entry.intro)}</p>`;
    }

    // Sections
    entry.sections.forEach(section => {
      html += `<div style="margin-bottom:0.85rem">`;
      html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">`;
      html += `<span style="font-size:0.95rem">${section.icon}</span>`;
      html += `<span style="font-weight:700;font-size:0.8rem;color:var(--text);letter-spacing:0.3px">${escapeHtml(section.title)}</span>`;
      html += `</div>`;
      html += `<div style="display:flex;flex-direction:column;gap:4px;padding-left:2px">`;
      section.items.forEach(item => {
        html += `<div style="display:flex;gap:6px;font-size:0.78rem;line-height:1.45">`;
        html += `<span style="color:var(--accent);font-weight:600;white-space:nowrap">${escapeHtml(item.name)}</span>`;
        html += `<span style="color:var(--text-muted)">— ${escapeHtml(item.desc)}</span>`;
        html += `</div>`;
      });
      html += `</div></div>`;
    });

    // Bug fixes
    if (entry.fixes?.length) {
      html += `<div style="margin-top:0.5rem;padding-top:0.6rem;border-top:1px solid var(--border)">`;
      html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">`;
      html += `<span style="font-size:0.95rem">🐛</span>`;
      html += `<span style="font-weight:700;font-size:0.8rem;color:#34d399;letter-spacing:0.3px">Bug Fixes</span>`;
      html += `</div>`;
      html += `<div style="display:flex;flex-direction:column;gap:3px;padding-left:2px">`;
      entry.fixes.forEach(f => {
        html += `<div style="font-size:0.78rem;color:var(--text-muted);line-height:1.45">• ${escapeHtml(f)}</div>`;
      });
      html += `</div></div>`;
    }
  }
  // Legacy flat format (v2.0.0 and older)
  else {
    if (!skipHeader) html += `<div style="color:var(--text-muted);font-size:0.75rem;margin-bottom:0.75rem">v${escapeHtml(entry.version)} — ${escapeHtml(entry.date)}</div>`;
    if (entry.improvements?.length) {
      html += `<div style="font-weight:600;color:var(--accent);margin-bottom:4px">Improvements</div><ul style="margin:0 0 0.75rem 1.1rem;padding:0">`;
      entry.improvements.forEach(i => { html += `<li style="margin-bottom:2px;font-size:0.82rem">${escapeHtml(i)}</li>`; });
      html += `</ul>`;
    }
    if (entry.removed?.length) {
      html += `<div style="font-weight:600;color:var(--text-muted);margin-bottom:4px">Removed</div><ul style="margin:0 0 0.75rem 1.1rem;padding:0">`;
      entry.removed.forEach(i => { html += `<li style="margin-bottom:2px;font-size:0.82rem">${escapeHtml(i)}</li>`; });
      html += `</ul>`;
    }
    if (entry.fixes?.length) {
      html += `<div style="font-weight:600;color:#34d399;margin-bottom:4px">Bug Fixes</div><ul style="margin:0 0 0.75rem 1.1rem;padding:0">`;
      entry.fixes.forEach(i => { html += `<li style="margin-bottom:2px;font-size:0.82rem">${escapeHtml(i)}</li>`; });
      html += `</ul>`;
    }
  }
  return html;
}

function checkAndShowUpdateLog() {
  if (!CHANGELOG.length) return;
  const key = 'rkk-changelog-dismissed-' + currentUser;
  const dismissed = localStorage.getItem(key);
  if (dismissed === CHANGELOG[0].version) return;

  const container = document.getElementById('update-log-content');
  container.innerHTML = renderChangelogEntry(CHANGELOG[0]);
  openModal('update-log-modal');
}

function dismissUpdateLog() {
  const latest = CHANGELOG[0];
  if (latest) {
    localStorage.setItem('rkk-changelog-dismissed-' + currentUser, latest.version);
  }
  closeModal('update-log-modal');
}

// ── Start ─────────────────────────────────────────────────────────────
init().catch(err => console.error('Init failed:', err));
