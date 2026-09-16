const nodemailer = require('nodemailer');
const db = require('../db/db');

function getSettings() {
  const row = db.prepare('SELECT * FROM smtp_settings WHERE id = 1').get();
  if (row) {
    return {
      host: row.host || process.env.SMTP_HOST,
      port: row.port || Number(process.env.SMTP_PORT || 587),
      secure: !!row.secure,
      user: row.user || process.env.SMTP_USER,
      pass: row.pass || process.env.SMTP_PASS,
      fromName: row.from_name || process.env.FROM_NAME || '',
      fromEmail: row.from_email || process.env.FROM_EMAIL || row.user,
      sendDelayMs: row.send_delay_ms ?? Number(process.env.SEND_DELAY_MS || 1000),
    };
  }
  return {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    fromName: process.env.FROM_NAME || '',
    fromEmail: process.env.FROM_EMAIL || process.env.SMTP_USER,
    sendDelayMs: Number(process.env.SEND_DELAY_MS || 1000),
  };
}

function createTransporter(settings) {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: { user: settings.user, pass: settings.pass },
  });
}

async function verifyConnection() {
  const settings = getSettings();
  const transporter = createTransporter(settings);
  await transporter.verify();
  return true;
}

// Replaces {{field}} placeholders with values from the recipient's data,
// falling back to the recipient's name/email for the common cases.
function personalize(html, recipient) {
  const data = { name: recipient.name || '', email: recipient.email, ...recipient.data };
  return html.replace(/{{\s*(\w+)\s*}}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(data, key) ? String(data[key]) : match;
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runCampaign(campaignId) {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) return;

  const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(campaign.template_id);
  const recipients = db.prepare('SELECT * FROM recipients WHERE list_id = ?').all(campaign.list_id);

  const settings = getSettings();
  const transporter = createTransporter(settings);
  const from = settings.fromName ? `"${settings.fromName}" <${settings.fromEmail}>` : settings.fromEmail;

  db.prepare("UPDATE campaigns SET status = 'sending', started_at = datetime('now'), total = ? WHERE id = ?")
    .run(recipients.length, campaignId);

  const insertLog = db.prepare(
    'INSERT INTO campaign_logs (campaign_id, recipient_email, status, error) VALUES (?, ?, ?, ?)'
  );
  const bumpSent = db.prepare('UPDATE campaigns SET sent_count = sent_count + 1 WHERE id = ?');
  const bumpFailed = db.prepare('UPDATE campaigns SET failed_count = failed_count + 1 WHERE id = ?');

  for (const recipient of recipients) {
    const data = recipient.data ? JSON.parse(recipient.data) : {};
    const recipientForTemplate = { name: recipient.name, email: recipient.email, data };
    const html = personalize(template.html_body, recipientForTemplate);
    const subject = personalize(campaign.subject, recipientForTemplate);

    try {
      await transporter.sendMail({ from, to: recipient.email, subject, html });
      insertLog.run(campaignId, recipient.email, 'sent', null);
      bumpSent.run(campaignId);
    } catch (err) {
      insertLog.run(campaignId, recipient.email, 'failed', String(err.message || err));
      bumpFailed.run(campaignId);
    }

    if (settings.sendDelayMs > 0) {
      await sleep(settings.sendDelayMs);
    }
  }

  db.prepare("UPDATE campaigns SET status = 'completed', finished_at = datetime('now') WHERE id = ?").run(
    campaignId
  );
}

module.exports = { getSettings, verifyConnection, runCampaign, personalize };
