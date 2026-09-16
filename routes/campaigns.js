const express = require('express');
const db = require('../db/db');
const { runCampaign } = require('../services/mailer');

const router = express.Router();

router.get('/', (req, res) => {
  const campaigns = db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all();
  res.json(campaigns);
});

router.get('/:id', (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  const logs = db
    .prepare('SELECT * FROM campaign_logs WHERE campaign_id = ? ORDER BY sent_at DESC LIMIT 200')
    .all(req.params.id);
  res.json({ ...campaign, logs });
});

// Creates a campaign and starts sending it in the background.
router.post('/', (req, res) => {
  const { template_id, list_id, subject, includeUnsubscribeHeader } = req.body;
  if (!template_id || !list_id) {
    return res.status(400).json({ error: 'template_id and list_id are required' });
  }

  const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(template_id);
  if (!template) return res.status(404).json({ error: 'Template not found' });

  const recipientCount = db
    .prepare('SELECT COUNT(*) AS c FROM recipients WHERE list_id = ?')
    .get(list_id).c;
  if (recipientCount === 0) {
    return res.status(400).json({ error: 'Selected recipient list has no recipients' });
  }

  const result = db
    .prepare(
      'INSERT INTO campaigns (template_id, list_id, subject, total, include_unsubscribe_header) VALUES (?, ?, ?, ?, ?)'
    )
    .run(template_id, list_id, subject || template.subject, recipientCount, includeUnsubscribeHeader === false ? 0 : 1);

  const campaignId = result.lastInsertRowid;

  runCampaign(campaignId).catch((err) => {
    db.prepare("UPDATE campaigns SET status = 'failed', finished_at = datetime('now') WHERE id = ?").run(
      campaignId
    );
    console.error(`Campaign ${campaignId} failed:`, err);
  });

  res.status(201).json({ id: campaignId });
});

module.exports = router;
