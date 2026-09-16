// ---------- Tabs ----------
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'campaigns') { loadCampaignOptions(); loadCampaigns(); }
    if (btn.dataset.tab === 'recipients') loadLists();
    if (btn.dataset.tab === 'templates') loadTemplates();
    if (btn.dataset.tab === 'settings') loadSettings();
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

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---------- Templates ----------
async function loadTemplates() {
  const templates = await api('/templates');
  const list = document.getElementById('template-list');
  list.innerHTML = templates.length ? '' : '<p class="hint">No templates yet.</p>';
  for (const t of templates) {
    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `
      <div>
        <strong>${escapeHtml(t.name)}</strong>
        <div class="meta">${escapeHtml(t.subject)}</div>
      </div>
      <div class="row-actions">
        <button data-edit="${t.id}">Edit</button>
        <button data-delete="${t.id}" class="danger">Delete</button>
      </div>`;
    list.appendChild(el);
  }
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
  quill.root.innerHTML = t.html_body;
}

document.getElementById('clear-template-btn').addEventListener('click', () => {
  document.getElementById('template-id').value = '';
  document.getElementById('template-form-title').textContent = 'New Template';
  document.getElementById('template-name').value = '';
  document.getElementById('template-subject').value = '';
  quill.root.innerHTML = '';
});

document.getElementById('save-template-btn').addEventListener('click', async () => {
  const id = document.getElementById('template-id').value;
  const name = document.getElementById('template-name').value.trim();
  const subject = document.getElementById('template-subject').value.trim();
  const html_body = quill.root.innerHTML;

  if (!name || !subject || quill.getText().trim().length === 0) {
    alert('Please fill in name, subject and body.');
    return;
  }

  if (id) {
    await api(`/templates/${id}`, { method: 'PUT', body: JSON.stringify({ name, subject, html_body }) });
  } else {
    await api('/templates', { method: 'POST', body: JSON.stringify({ name, subject, html_body }) });
  }
  document.getElementById('clear-template-btn').click();
  loadTemplates();
});

// ---------- Recipients ----------
async function loadLists() {
  const lists = await api('/recipients/lists');
  const el = document.getElementById('list-list');
  el.innerHTML = lists.length ? '' : '<p class="hint">No recipient lists yet.</p>';
  for (const l of lists) {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(l.name)}</strong>
        <div class="meta">${l.recipient_count} recipients</div>
      </div>
      <div class="row-actions">
        <button data-delete-list="${l.id}" class="danger">Delete</button>
      </div>`;
    el.appendChild(item);
  }
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
  el.innerHTML = campaigns.length ? '' : '<p class="hint">No campaigns yet.</p>';
  for (const c of campaigns) {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(c.subject)}</strong>
        <div class="meta">Sent ${c.sent_count}/${c.total} · Failed ${c.failed_count}</div>
      </div>
      <span class="status-badge status-${c.status}">${c.status}</span>`;
    el.appendChild(item);
  }

  const hasActive = campaigns.some((c) => c.status === 'pending' || c.status === 'sending');
  clearTimeout(campaignPollTimer);
  if (hasActive) campaignPollTimer = setTimeout(loadCampaigns, 2000);
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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Init ----------
loadTemplates();
