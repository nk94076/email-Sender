require('dotenv').config();
const express = require('express');
const path = require('path');

require('./db/db'); // ensures tables exist on boot

const templatesRouter = require('./routes/templates');
const recipientsRouter = require('./routes/recipients');
const campaignsRouter = require('./routes/campaigns');
const settingsRouter = require('./routes/settings');
const smtpProfilesRouter = require('./routes/smtp-profiles');
const analyticsRouter = require('./routes/analytics');
const logsRouter = require('./routes/logs');
const uploadsRouter = require('./routes/uploads');
const trackRouter = require('./routes/track');

const app = express();
app.use(express.json({ limit: '10mb' }));
// Always revalidate app.js/index.html/style.css so a deploy is visible
// immediately without requiring users to hard-refresh their browser.
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders: (res) => res.set('Cache-Control', 'no-cache'),
  })
);

app.use('/api/templates', templatesRouter);
app.use('/api/recipients', recipientsRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/smtp-profiles', smtpProfilesRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/logs', logsRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/t', trackRouter);

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Email Sender running at http://localhost:${PORT}`);
});
