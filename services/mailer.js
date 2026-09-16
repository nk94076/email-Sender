const nodemailer = require('nodemailer');
const crypto = require('crypto');
const db = require('../db/db');

function rowToProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    secure: !!row.secure,
    user: row.user,
    pass: row.pass,
    fromName: row.from_name || '',
    fromEmail: row.from_email || row.user,
    sendDelayMs: row.send_delay_ms ?? 1000,
  };
}

function getProfile(id) {
  return rowToProfile(db.prepare('SELECT * FROM smtp_profiles WHERE id = ?').get(id));
}

function listProfiles() {
  return db.prepare('SELECT * FROM smtp_profiles ORDER BY created_at ASC').all().map(rowToProfile);
}

function getAppSettings() {
  const row = db.prepare('SELECT * FROM app_settings WHERE id = 1').get() || {};
  return {
    publicBaseUrl: (row.public_base_url || process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
    defaultSmtpProfileId: row.default_smtp_profile_id || null,
  };
}

// Resolves which profile a campaign should send through: an explicit choice
// made at campaign-creation time, else the app-wide default, else whichever
// profile was created first (so a single-account setup keeps working with
// zero configuration).
function resolveProfile(explicitId) {
  if (explicitId) {
    const p = getProfile(explicitId);
    if (p) return p;
  }
  const app = getAppSettings();
  if (app.defaultSmtpProfileId) {
    const p = getProfile(app.defaultSmtpProfileId);
    if (p) return p;
  }
  const first = db.prepare('SELECT id FROM smtp_profiles ORDER BY created_at ASC LIMIT 1').get();
  return first ? getProfile(first.id) : null;
}

function createTransporter(profile) {
  return nodemailer.createTransport({
    host: profile.host,
    port: profile.port,
    secure: profile.secure,
    auth: { user: profile.user, pass: profile.pass },
  });
}

async function verifyConnectionWithCreds(creds) {
  const transporter = createTransporter(creds);
  await transporter.verify();
  return true;
}

async function verifyConnection(profileId) {
  const profile = resolveProfile(profileId);
  if (!profile) throw new Error('No SMTP account configured yet');
  return verifyConnectionWithCreds(profile);
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

// Any <img> with no width/style at all renders at its native pixel size,
// which can look huge in an inbox. Only touches images with no sizing
// control of their own, so intentionally-sized images (e.g. pasted from a
// real promotional template) are left untouched.
function constrainUnsizedImages(html) {
  return html.replace(/<img\b([^>]*)>/gi, (full, attrs) => {
    if (/\b(style|width)\s*=/i.test(attrs)) return full;
    return `<img${attrs} style="max-width:600px;height:auto;">`;
  });
}

// Wraps a bare HTML fragment (e.g. pasted from the HTML Source editor) in a
// full document with a charset, since malformed/incomplete HTML is itself a
// spam signal to most inbox providers.
function ensureFullHtmlDocument(html) {
  if (/<html[\s>]/i.test(html)) return html;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body>${html}</body>
</html>`;
}

// Appends a hidden 1x1 open-tracking pixel just before </body>. Falls back
// to appending at the end if no closing tag is found.
function injectTrackingPixel(html, pixelUrl) {
  const tag = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none" border="0" />`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${tag}</body>`);
  return html + tag;
}

// Spam filters weight the presence of a plain-text alternative heavily —
// HTML-only mail is treated as more suspicious. This is a best-effort strip,
// not a full HTML-to-text renderer.
function htmlToPlainText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function runCampaign(campaignId) {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) return;

  const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(campaign.template_id);
  const recipients = db.prepare('SELECT * FROM recipients WHERE list_id = ?').all(campaign.list_id);
  const profile = resolveProfile(campaign.smtp_profile_id);

  if (!profile) {
    db.prepare("UPDATE campaigns SET status = 'failed', finished_at = datetime('now') WHERE id = ?").run(campaignId);
    throw new Error('No SMTP account configured — add one in SMTP Settings first');
  }

  const { publicBaseUrl } = getAppSettings();
  const transporter = createTransporter(profile);
  const from = profile.fromName ? `"${profile.fromName}" <${profile.fromEmail}>` : profile.fromEmail;

  db.prepare("UPDATE campaigns SET status = 'sending', started_at = datetime('now'), total = ? WHERE id = ?")
    .run(recipients.length, campaignId);

  const insertLog = db.prepare(
    'INSERT INTO campaign_logs (campaign_id, recipient_email, status, error, open_token) VALUES (?, ?, ?, ?, ?)'
  );
  const bumpSent = db.prepare('UPDATE campaigns SET sent_count = sent_count + 1 WHERE id = ?');
  const bumpFailed = db.prepare('UPDATE campaigns SET failed_count = failed_count + 1 WHERE id = ?');

  for (const recipient of recipients) {
    const data = recipient.data ? JSON.parse(recipient.data) : {};
    const recipientForTemplate = { name: recipient.name, email: recipient.email, data };
    const rawHtml = personalize(template.html_body, recipientForTemplate);
    let html = ensureFullHtmlDocument(constrainUnsizedImages(rawHtml));
    const text = htmlToPlainText(rawHtml);
    const subject = personalize(campaign.subject, recipientForTemplate);

    const openToken = publicBaseUrl ? crypto.randomBytes(16).toString('hex') : null;
    if (openToken) {
      html = injectTrackingPixel(html, `${publicBaseUrl}/t/o/${openToken}.gif`);
    }

    const headers = {};
    if (campaign.include_unsubscribe_header) {
      headers['List-Unsubscribe'] = `<mailto:${profile.fromEmail}?subject=unsubscribe>`;
    }

    try {
      await transporter.sendMail({ from, to: recipient.email, subject, html, text, headers });
      insertLog.run(campaignId, recipient.email, 'sent', null, openToken);
      bumpSent.run(campaignId);
    } catch (err) {
      insertLog.run(campaignId, recipient.email, 'failed', String(err.message || err), openToken);
      bumpFailed.run(campaignId);
    }

    if (profile.sendDelayMs > 0) {
      await sleep(profile.sendDelayMs);
    }
  }

  db.prepare("UPDATE campaigns SET status = 'completed', finished_at = datetime('now') WHERE id = ?").run(
    campaignId
  );
}

module.exports = {
  listProfiles,
  getProfile,
  getAppSettings,
  resolveProfile,
  verifyConnection,
  verifyConnectionWithCreds,
  runCampaign,
  personalize,
};
