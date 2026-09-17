const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const db = require('../db/db');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.get('/lists', (req, res) => {
  const lists = db
    .prepare(
      `SELECT rl.id, rl.name, rl.created_at, COUNT(r.id) AS recipient_count
       FROM recipient_lists rl
       LEFT JOIN recipients r ON r.list_id = rl.id
       GROUP BY rl.id
       ORDER BY rl.created_at DESC`
    )
    .all();
  res.json(lists);
});

router.get('/lists/:id', (req, res) => {
  const recipients = db.prepare('SELECT * FROM recipients WHERE list_id = ?').all(req.params.id);
  res.json(
    recipients.map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : {} }))
  );
});

router.delete('/lists/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM recipient_lists WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: `Could not delete list: ${err.message}` });
  }
});

// Upload a CSV with headers: email,name,<any custom fields...>
router.post('/lists/:listName/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'CSV file is required (field name: file)' });

  let records;
  try {
    records = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    return res.status(400).json({ error: `Could not parse CSV: ${err.message}` });
  }

  const emailRows = records.filter((r) => r.email && r.email.includes('@'));
  if (emailRows.length === 0) {
    return res.status(400).json({ error: 'No valid rows found. CSV must have an "email" column.' });
  }

  const listName = req.params.listName;
  let list = db.prepare('SELECT * FROM recipient_lists WHERE name = ?').get(listName);
  if (!list) {
    const result = db.prepare('INSERT INTO recipient_lists (name) VALUES (?)').run(listName);
    list = { id: result.lastInsertRowid, name: listName };
  }

  const insert = db.prepare('INSERT INTO recipients (list_id, email, name, data) VALUES (?, ?, ?, ?)');
  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      const { email, name, ...rest } = row;
      insert.run(list.id, email.trim(), name || '', JSON.stringify(rest));
    }
  });
  insertMany(emailRows);

  res.status(201).json({ listId: list.id, listName: list.name, imported: emailRows.length });
});

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Quick-add a handful of recipients by typing/pasting emails directly
// (comma, space, or newline separated) — no CSV needed.
router.post('/lists/:listName/manual', (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }

  const emails = [...new Set((text.match(EMAIL_PATTERN) || []).map((e) => e.toLowerCase()))];
  if (emails.length === 0) {
    return res.status(400).json({ error: 'No valid email addresses found in the text' });
  }

  const listName = req.params.listName;
  let list = db.prepare('SELECT * FROM recipient_lists WHERE name = ?').get(listName);
  if (!list) {
    const result = db.prepare('INSERT INTO recipient_lists (name) VALUES (?)').run(listName);
    list = { id: result.lastInsertRowid, name: listName };
  }

  const insert = db.prepare('INSERT INTO recipients (list_id, email, name, data) VALUES (?, ?, ?, ?)');
  const insertMany = db.transaction((rows) => {
    for (const email of rows) insert.run(list.id, email, '', '{}');
  });
  insertMany(emails);

  res.status(201).json({ listId: list.id, listName: list.name, imported: emails.length });
});

module.exports = router;
