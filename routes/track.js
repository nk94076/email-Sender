const express = require('express');
const db = require('../db/db');

const router = express.Router();

// 1x1 transparent GIF, served for every pixel request regardless of whether
// the token matches, so a dead/expired link never shows a broken image.
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7',
  'base64'
);

router.get('/o/:token.gif', (req, res) => {
  const { token } = req.params;
  const log = db.prepare('SELECT id FROM campaign_logs WHERE open_token = ?').get(token);
  if (log) {
    db.prepare(
      "UPDATE campaign_logs SET open_count = open_count + 1, opened_at = COALESCE(opened_at, datetime('now')) WHERE id = ?"
    ).run(log.id);
  }
  res.set({
    'Content-Type': 'image/gif',
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0',
  });
  res.send(TRANSPARENT_GIF);
});

module.exports = router;
