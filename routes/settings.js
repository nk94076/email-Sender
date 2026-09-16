const express = require('express');
const db = require('../db/db');
const { getAppSettings } = require('../services/mailer');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(getAppSettings());
});

router.post('/', (req, res) => {
  const { publicBaseUrl } = req.body;
  const existing = getAppSettings();
  db.prepare(
    `INSERT INTO app_settings (id, public_base_url, default_smtp_profile_id) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET public_base_url = excluded.public_base_url`
  ).run((publicBaseUrl || '').replace(/\/+$/, ''), existing.defaultSmtpProfileId);
  res.json({ ok: true });
});

module.exports = router;
