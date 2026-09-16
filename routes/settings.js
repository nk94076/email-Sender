const express = require('express');
const db = require('../db/db');
const { getSettings, verifyConnection } = require('../services/mailer');

const router = express.Router();

router.get('/', (req, res) => {
  const settings = getSettings();
  res.json({ ...settings, pass: settings.pass ? '••••••••' : '' });
});

router.post('/', (req, res) => {
  const { host, port, secure, user, pass, fromName, fromEmail, sendDelayMs } = req.body;

  const existing = db.prepare('SELECT * FROM smtp_settings WHERE id = 1').get();
  const finalPass = pass && pass !== '••••••••' ? pass : existing?.pass;

  db.prepare(
    `INSERT INTO smtp_settings (id, host, port, secure, user, pass, from_name, from_email, send_delay_ms)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       host = excluded.host, port = excluded.port, secure = excluded.secure,
       user = excluded.user, pass = excluded.pass, from_name = excluded.from_name,
       from_email = excluded.from_email, send_delay_ms = excluded.send_delay_ms`
  ).run(host, Number(port), secure ? 1 : 0, user, finalPass, fromName, fromEmail, Number(sendDelayMs) || 1000);

  res.json({ ok: true });
});

router.post('/test', async (req, res) => {
  try {
    await verifyConnection();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err.message || err) });
  }
});

module.exports = router;
