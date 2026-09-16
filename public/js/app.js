// ---------- Sidebar navigation ----------
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'campaigns') { loadCampaignOptions(); loadCampaigns(); }
    if (btn.dataset.tab === 'recipients') loadLists();
    if (btn.dataset.tab === 'templates') loadTemplates();
    if (btn.dataset.tab === 'settings') loadSettings();
    if (btn.dataset.tab === 'analytics') loadAnalytics();
    if (btn.dataset.tab === 'logs') loadLogs();
  });
});

// ---------- Quill editor ----------
const quill = new Quill('#editor', {
  theme: 'snow',
  modules: {
    toolbar: [
      [{ header: [1, 2, 3, false] }],
      ['bold', 'italic', 'underline'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['link', 'image', 'video'],
      ['clean'],
    ],
  },
});

// Quill's default image button opens a file picker and embeds the image as
// base64, which Gmail and most inboxes strip from delivered emails. Force a
// hosted-URL prompt instead so images actually survive sending.
quill.getModule('toolbar').addHandler('image', () => {
  const url = prompt('Paste the image URL (must be publicly hosted, e.g. https://...):');
  if (!url) return;
  const range = quill.getSelection(true);
  quill.insertEmbed(range.index, 'image', url, 'user');
  quill.setSelection(range.index + 1);
});

// ---------- Visual / HTML source mode toggle ----------
const htmlSourceBox = document.getElementById('html-source');
const modeVisualBtn = document.getElementById('mode-visual-btn');
const modeHtmlBtn = document.getElementById('mode-html-btn');
let editorMode = 'visual';

function setEditorMode(mode) {
  if (mode === editorMode) return;
  if (mode === 'html') {
    htmlSourceBox.value = quill.root.innerHTML;
    quill.root.parentElement.style.display = 'none';
    htmlSourceBox.style.display = 'block';
  } else {
    quill.root.innerHTML = htmlSourceBox.value;
    htmlSourceBox.style.display = 'none';
    quill.root.parentElement.style.display = '';
  }
  editorMode = mode;
  modeVisualBtn.classList.toggle('active', mode === 'visual');
  modeHtmlBtn.classList.toggle('active', mode === 'html');
}

modeVisualBtn.addEventListener('click', () => setEditorMode('visual'));
modeHtmlBtn.addEventListener('click', () => setEditorMode('html'));

function getEditorHtml() {
  return editorMode === 'html' ? htmlSourceBox.value : quill.root.innerHTML;
}

function getEditorText() {
  return editorMode === 'html' ? htmlSourceBox.value.replace(/<[^>]*>/g, '').trim() : quill.getText().trim();
}

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function formatDate(isoLike) {
  if (!isoLike) return '';
  const d = new Date(isoLike.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return isoLike;
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

const TEMPLATE_ICONS = ['icon-purple', 'icon-pink', 'icon-blue', 'icon-green', 'icon-orange'];

// ---------- Templates ----------
async function loadTemplates() {
  const templates = await api('/templates');
  const list = document.getElementById('template-list');
  list.innerHTML = templates.length ? '' : '<p class="muted">No templates yet.</p>';
  templates.forEach((t, i) => {
    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `
      <div class="list-item-main">
        <div class="item-icon ${TEMPLATE_ICONS[i % TEMPLATE_ICONS.length]}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>
        </div>
        <div>
          <div class="item-title">${escapeHtml(t.name)}</div>
          <div class="item-sub">${escapeHtml(t.subject)}</div>
        </div>
      </div>
      <span class="badge badge-${t.category || 'General'}">${escapeHtml(t.category || 'General')}</span>
      <div class="row-actions">
        <button data-edit="${t.id}">Edit</button>
        <button data-delete="${t.id}" class="danger">Delete</button>
      </div>`;
    list.appendChild(el);
  });
  list.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => editTemplate(b.dataset.edit))
  );
  list.querySelectorAll('[data-delete]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Delete this template?')) return;
      await api(`/templates/${b.dataset.delete}`, { method: 'DELETE' });
      loadTemplates();
    })
  );
}

async function editTemplate(id) {
  const t = await api(`/templates/${id}`);
  document.getElementById('template-id').value = t.id;
  document.getElementById('template-form-title').textContent = `Edit: ${t.name}`;
  document.getElementById('template-name').value = t.name;
  document.getElementById('template-subject').value = t.subject;
  document.getElementById('template-category').value = t.category || 'General';
  setEditorMode('visual');
  quill.root.innerHTML = t.html_body;
}

document.getElementById('clear-template-btn').addEventListener('click', () => {
  document.getElementById('template-id').value = '';
  document.getElementById('template-form-title').textContent = 'Create New Template';
  document.getElementById('template-name').value = '';
  document.getElementById('template-subject').value = '';
  document.getElementById('template-category').value = 'General';
  setEditorMode('visual');
  quill.root.innerHTML = '';
  htmlSourceBox.value = '';
});

document.getElementById('save-template-btn').addEventListener('click', async () => {
  const id = document.getElementById('template-id').value;
  const name = document.getElementById('template-name').value.trim();
  const subject = document.getElementById('template-subject').value.trim();
  const category = document.getElementById('template-category').value;
  const html_body = getEditorHtml();

  if (!name || !subject || getEditorText().length === 0) {
    alert('Please fill in name, subject and body.');
    return;
  }

  if (id) {
    await api(`/templates/${id}`, { method: 'PUT', body: JSON.stringify({ name, subject, html_body, category }) });
  } else {
    await api('/templates', { method: 'POST', body: JSON.stringify({ name, subject, html_body, category }) });
  }
  document.getElementById('clear-template-btn').click();
  loadTemplates();
});

// ---------- Recipients ----------
async function loadLists() {
  const lists = await api('/recipients/lists');
  const el = document.getElementById('list-list');
  el.innerHTML = lists.length ? '' : '<p class="muted">No recipient lists yet.</p>';
  lists.forEach((l) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div class="list-item-main">
        <div class="item-icon icon-green">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
        </div>
        <div>
          <div class="item-title">${escapeHtml(l.name)}</div>
          <div class="item-sub">${l.recipient_count} recipients</div>
        </div>
      </div>
      <div class="row-actions">
        <button data-delete-list="${l.id}" class="danger">Delete</button>
      </div>`;
    el.appendChild(item);
  });
  el.querySelectorAll('[data-delete-list]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Delete this list and all its recipients?')) return;
      await api(`/recipients/lists/${b.dataset.deleteList}`, { method: 'DELETE' });
      loadLists();
    })
  );
}

document.getElementById('upload-btn').addEventListener('click', async () => {
  const listName = document.getElementById('list-name').value.trim();
  const fileInput = document.getElementById('csv-file');
  const resultEl = document.getElementById('upload-result');

  if (!listName || !fileInput.files[0]) {
    alert('Please provide a list name and a CSV file.');
    return;
  }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);

  resultEl.textContent = 'Uploading...';
  try {
    const res = await fetch(`/api/recipients/lists/${encodeURIComponent(listName)}/upload`, {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    resultEl.textContent = `Imported ${data.imported} recipients into "${data.listName}".`;
    loadLists();
  } catch (err) {
    resultEl.textContent = `Error: ${err.message}`;
  }
});

// ---------- Campaigns ----------
async function loadCampaignOptions() {
  const [templates, lists] = await Promise.all([api('/templates'), api('/recipients/lists')]);
  const templateSel = document.getElementById('campaign-template');
  const listSel = document.getElementById('campaign-list');
  templateSel.innerHTML = templates
    .map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`)
    .join('');
  listSel.innerHTML = lists
    .map((l) => `<option value="${l.id}">${escapeHtml(l.name)} (${l.recipient_count})</option>`)
    .join('');
}

document.getElementById('send-campaign-btn').addEventListener('click', async () => {
  const template_id = document.getElementById('campaign-template').value;
  const list_id = document.getElementById('campaign-list').value;
  const subject = document.getElementById('campaign-subject').value.trim();
  const resultEl = document.getElementById('campaign-result');

  if (!template_id || !list_id) {
    alert('Please create a template and a recipient list first.');
    return;
  }

  try {
    const data = await api('/campaigns', {
      method: 'POST',
      body: JSON.stringify({ template_id, list_id, subject: subject || undefined }),
    });
    resultEl.textContent = `Campaign #${data.id} started. Sending in progress...`;
    loadCampaigns();
  } catch (err) {
    resultEl.textContent = `Error: ${err.message}`;
  }
});

let campaignPollTimer = null;

async function loadCampaigns() {
  const campaigns = await api('/campaigns');
  const el = document.getElementById('campaign-list-view');
  el.innerHTML = campaigns.length ? '' : '<p class="muted">No campaigns yet.</p>';
  campaigns.forEach((c) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div class="list-item-main">
        <div class="item-icon icon-orange">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>
        </div>
        <div>
          <div class="item-title">${escapeHtml(c.subject)}</div>
          <div class="item-sub">Sent ${c.sent_count}/${c.total} · Failed ${c.failed_count}</div>
        </div>
      </div>
      <span class="status-badge status-${c.status}">${c.status}</span>`;
    el.appendChild(item);
  });

  const hasActive = campaigns.some((c) => c.status === 'pending' || c.status === 'sending');
  clearTimeout(campaignPollTimer);
  if (hasActive) campaignPollTimer = setTimeout(loadCampaigns, 2000);
}

// ---------- Analytics ----------
async function loadAnalytics() {
  const stats = await api('/analytics');
  const grid = document.getElementById('stat-grid');
  const rate = stats.deliveryRate === null ? '—' : `${stats.deliveryRate}%`;
  grid.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Templates</div>
      <div class="stat-value">${stats.templateCount}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Recipients</div>
      <div class="stat-value">${stats.recipientCount}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Emails Sent</div>
      <div class="stat-value">${stats.totalSent}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Delivery Rate</div>
      <div class="stat-value">${rate}</div>
    </div>`;

  const list = document.getElementById('analytics-campaigns');
  list.innerHTML = stats.recentCampaigns.length ? '' : '<p class="muted">No campaigns yet.</p>';
  stats.recentCampaigns.forEach((c) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div class="list-item-main">
        <div class="item-icon icon-blue">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>
        </div>
        <div>
          <div class="item-title">${escapeHtml(c.subject)}</div>
          <div class="item-sub">${escapeHtml(c.template_name || '—')} → ${escapeHtml(c.list_name || '—')} · ${formatDate(c.created_at)}</div>
        </div>
      </div>
      <span class="status-badge status-${c.status}">${c.status}</span>`;
    list.appendChild(item);
  });
}

// ---------- Logs ----------
async function loadLogs() {
  const logs = await api('/logs?limit=200');
  const body = document.getElementById('logs-body');
  const empty = document.getElementById('logs-empty');
  body.innerHTML = '';
  empty.style.display = logs.length ? 'none' : 'block';
  logs.forEach((l) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(l.recipient_email)}</td>
      <td>${escapeHtml(l.campaign_subject)}</td>
      <td><span class="status-badge status-${l.status}">${l.status}</span></td>
      <td>${escapeHtml(l.error || '—')}</td>
      <td>${formatDate(l.sent_at)}</td>`;
    body.appendChild(tr);
  });
}

// ---------- Settings ----------
async function loadSettings() {
  const s = await api('/settings');
  document.getElementById('smtp-host').value = s.host || '';
  document.getElementById('smtp-port').value = s.port || 587;
  document.getElementById('smtp-secure').checked = !!s.secure;
  document.getElementById('smtp-user').value = s.user || '';
  document.getElementById('smtp-pass').value = s.pass || '';
  document.getElementById('smtp-from-name').value = s.fromName || '';
  document.getElementById('smtp-from-email').value = s.fromEmail || '';
  document.getElementById('smtp-delay').value = s.sendDelayMs || 1000;
  updateUserBadge(s);
}

function updateUserBadge(s) {
  const nameEl = document.getElementById('user-name');
  const emailEl = document.getElementById('user-email');
  const avatarEl = document.getElementById('user-avatar');
  if (s.fromEmail) {
    nameEl.textContent = s.fromName || s.fromEmail;
    emailEl.textContent = s.fromEmail;
    avatarEl.textContent = (s.fromName || s.fromEmail).charAt(0).toUpperCase();
  }
}

document.getElementById('save-settings-btn').addEventListener('click', async () => {
  const resultEl = document.getElementById('settings-result');
  const payload = {
    host: document.getElementById('smtp-host').value.trim(),
    port: document.getElementById('smtp-port').value,
    secure: document.getElementById('smtp-secure').checked,
    user: document.getElementById('smtp-user').value.trim(),
    pass: document.getElementById('smtp-pass').value,
    fromName: document.getElementById('smtp-from-name').value.trim(),
    fromEmail: document.getElementById('smtp-from-email').value.trim(),
    sendDelayMs: document.getElementById('smtp-delay').value,
  };
  try {
    await api('/settings', { method: 'POST', body: JSON.stringify(payload) });
    resultEl.textContent = 'Settings saved.';
    updateUserBadge(payload);
  } catch (err) {
    resultEl.textContent = `Error: ${err.message}`;
  }
});

document.getElementById('test-settings-btn').addEventListener('click', async () => {
  const resultEl = document.getElementById('settings-result');
  resultEl.textContent = 'Testing connection...';
  try {
    await api('/settings/test', { method: 'POST' });
    resultEl.textContent = 'Connection successful!';
  } catch (err) {
    resultEl.textContent = `Connection failed: ${err.message}`;
  }
});

// ---------- Global search (client-side filter across templates/campaigns/recipients lists) ----------
document.getElementById('global-search').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('.tab-panel.active .list-item').forEach((item) => {
    const text = item.textContent.toLowerCase();
    item.style.display = !q || text.includes(q) ? '' : 'none';
  });
});

// ---------- Init ----------
loadTemplates();
loadSettings();
