const express = require('express');
const db = require('../db/db');
const { verifyConnectionWithCreds, getAppSettings } = require('../services/mailer');

const router = express.Router();

function maskProfile(row) {
  const app = getAppSettings();
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    secure: !!row.secure,
    user: row.user,
    fromName: row.from_name || '',
    fromEmail: row.from_email,
    sendDelayMs: row.send_delay_ms,
    isDefault: row.id === app.defaultSmtpProfileId,
  };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM smtp_profiles ORDER BY created_at ASC').all();
  res.json(rows.map(maskProfile));
});

router.post('/', (req, res) => {
  const { name, host, port, secure, user, pass, fromName, fromEmail, sendDelayMs } = req.body;
  if (!name || !host || !user || !pass || !fromEmail) {
    return res.status(400).json({ error: 'name, host, user, pass and fromEmail are required' });
  }

  const result = db
    .prepare(
      `INSERT INTO smtp_profiles (name, host, port, secure, user, pass, from_name, from_email, send_delay_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(name, host, Number(port) || 587, secure ? 1 : 0, user, pass, fromName || '', fromEmail, Number(sendDelayMs) || 1000);

  const isFirst = db.prepare('SELECT COUNT(*) AS c FROM smtp_profiles').get().c === 1;
  if (isFirst) {
    db.prepare(
      `INSERT INTO app_settings (id, default_smtp_profile_id) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET default_smtp_profile_id = excluded.default_smtp_profile_id`
    ).run(result.lastInsertRowid);
  }

  res.status(201).json({ id: result.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM smtp_profiles WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'SMTP account not found' });

  const { name, host, port, secure, user, pass, fromName, fromEmail, sendDelayMs } = req.body;
  const finalPass = pass && pass !== '••••••••' ? pass : existing.pass;

  db.prepare(
    `UPDATE smtp_profiles SET name = ?, host = ?, port = ?, secure = ?, user = ?, pass = ?,
       from_name = ?, from_email = ?, send_delay_ms = ? WHERE id = ?`
  ).run(
    name ?? existing.name,
    host ?? existing.host,
    Number(port) || existing.port,
    secure ? 1 : 0,
    user ?? existing.user,
    finalPass,
    fromName ?? existing.from_name,
    fromEmail ?? existing.from_email,
    Number(sendDelayMs) || existing.send_delay_ms,
    req.params.id
  );

  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const app = getAppSettings();
  if (app.defaultSmtpProfileId === id) {
    // Reassign the default away from this profile *before* deleting it,
    // since app_settings.default_smtp_profile_id still points at it.
    const next = db.prepare('SELECT id FROM smtp_profiles WHERE id != ? ORDER BY created_at ASC LIMIT 1').get(id);
    db.prepare(
      `INSERT INTO app_settings (id, default_smtp_profile_id) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET default_smtp_profile_id = excluded.default_smtp_profile_id`
    ).run(next ? next.id : null);
  }
  db.prepare('DELETE FROM smtp_profiles WHERE id = ?').run(id);
  res.json({ ok: true });
});

router.post('/:id/set-default', (req, res) => {
  const profile = db.prepare('SELECT id FROM smtp_profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.status(404).json({ error: 'SMTP account not found' });
  db.prepare(
    `INSERT INTO app_settings (id, default_smtp_profile_id) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET default_smtp_profile_id = excluded.default_smtp_profile_id`
  ).run(profile.id);
  res.json({ ok: true });
});

// Tests credentials directly from the request body, so a profile can be
// verified before it's saved.
router.post('/test', async (req, res) => {
  const { host, port, secure, user, pass } = req.body;
  if (!host || !user || !pass) {
    return res.status(400).json({ error: 'host, user and pass are required to test' });
  }
  try {
    await verifyConnectionWithCreds({ host, port: Number(port) || 587, secure: !!secure, user, pass });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err.message || err) });
  }
});

router.post('/:id/test', async (req, res) => {
  const row = db.prepare('SELECT * FROM smtp_profiles WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'SMTP account not found' });
  try {
    await verifyConnectionWithCreds({ host: row.host, port: row.port, secure: !!row.secure, user: row.user, pass: row.pass });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err.message || err) });
  }
});

module.exports = router;
