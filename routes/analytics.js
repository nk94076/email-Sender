const express = require('express');
const db = require('../db/db');

const router = express.Router();

router.get('/', (req, res) => {
  const templateCount = db.prepare('SELECT COUNT(*) AS c FROM templates').get().c;
  const recipientCount = db.prepare('SELECT COUNT(*) AS c FROM recipients').get().c;
  const listCount = db.prepare('SELECT COUNT(*) AS c FROM recipient_lists').get().c;
  const campaignCount = db.prepare('SELECT COUNT(*) AS c FROM campaigns').get().c;

  const totals = db
    .prepare(
      `SELECT
         COALESCE(SUM(sent_count), 0) AS totalSent,
         COALESCE(SUM(failed_count), 0) AS totalFailed
       FROM campaigns`
    )
    .get();

  const attempted = totals.totalSent + totals.totalFailed;
  const deliveryRate = attempted > 0 ? Math.round((totals.totalSent / attempted) * 1000) / 10 : null;

  const opens = db
    .prepare(
      `SELECT COUNT(*) AS opened, COUNT(DISTINCT CASE WHEN open_token IS NOT NULL THEN id END) AS trackable
       FROM campaign_logs WHERE opened_at IS NOT NULL`
    )
    .get();
  const trackableSent = db
    .prepare("SELECT COUNT(*) AS c FROM campaign_logs WHERE status = 'sent' AND open_token IS NOT NULL")
    .get().c;
  const openRate = trackableSent > 0 ? Math.round((opens.opened / trackableSent) * 1000) / 10 : null;

  const recentCampaigns = db
    .prepare(
      `SELECT c.id, c.subject, c.status, c.total, c.sent_count, c.failed_count, c.created_at,
              t.name AS template_name, rl.name AS list_name,
              (SELECT COUNT(*) FROM campaign_logs cl WHERE cl.campaign_id = c.id AND cl.opened_at IS NOT NULL) AS opened_count
       FROM campaigns c
       LEFT JOIN templates t ON t.id = c.template_id
       LEFT JOIN recipient_lists rl ON rl.id = c.list_id
       ORDER BY c.created_at DESC
       LIMIT 10`
    )
    .all();

  res.json({
    templateCount,
    recipientCount,
    listCount,
    campaignCount,
    totalSent: totals.totalSent,
    totalFailed: totals.totalFailed,
    deliveryRate,
    totalOpened: opens.opened,
    openRate,
    recentCampaigns,
  });
});

module.exports = router;
