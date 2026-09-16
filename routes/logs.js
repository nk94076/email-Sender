const express = require('express');
const db = require('../db/db');

const router = express.Router();

router.get('/', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const logs = db
    .prepare(
      `SELECT cl.id, cl.recipient_email, cl.status, cl.error, cl.sent_at,
              c.id AS campaign_id, c.subject AS campaign_subject
       FROM campaign_logs cl
       JOIN campaigns c ON c.id = cl.campaign_id
       ORDER BY cl.sent_at DESC
       LIMIT ?`
    )
    .all(limit);
  res.json(logs);
});

module.exports = router;
