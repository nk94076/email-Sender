const express = require('express');
const db = require('../db/db');

const router = express.Router();

router.get('/', (req, res) => {
  const templates = db.prepare('SELECT * FROM templates ORDER BY updated_at DESC').all();
  res.json(templates);
});

router.get('/:id', (req, res) => {
  const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  if (!template) return res.status(404).json({ error: 'Template not found' });
  res.json(template);
});

router.post('/', (req, res) => {
  const { name, subject, html_body, category } = req.body;
  if (!name || !subject || !html_body) {
    return res.status(400).json({ error: 'name, subject and html_body are required' });
  }
  const result = db
    .prepare('INSERT INTO templates (name, subject, html_body, category) VALUES (?, ?, ?, ?)')
    .run(name, subject, html_body, category || 'General');
  res.status(201).json({ id: result.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const { name, subject, html_body, category } = req.body;
  const existing = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Template not found' });

  db.prepare(
    "UPDATE templates SET name = ?, subject = ?, html_body = ?, category = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(
    name ?? existing.name,
    subject ?? existing.subject,
    html_body ?? existing.html_body,
    category ?? existing.category,
    req.params.id
  );
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: `Could not delete template: ${err.message}` });
  }
});

module.exports = router;
