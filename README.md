# Bulk Emailer

Simple web app to design email templates (headings, text, images, links,
embedded video) and send them in bulk to a list of recipients via SMTP.

## Features

- **Templates** — rich-text editor (Quill) supporting headings, bold/italic,
  lists, links, images, and embedded video. Supports `{{name}}`, `{{email}}`
  and any custom `{{column}}` placeholder for personalization.
- **Recipients** — upload a CSV (`email`, `name`, plus any custom columns)
  into named lists.
- **Campaigns** — pick a template + a recipient list and send. Sending runs
  in the background with a configurable delay between messages to respect
  provider rate limits; progress and per-recipient success/failure are
  tracked and viewable in the UI.
- **SMTP Settings** — configure host/port/credentials from the UI (stored in
  SQLite) or via a `.env` file. Includes a "Test Connection" button.

## Setup

```bash
npm install
cp .env.example .env   # edit with your SMTP credentials (or set them in the UI)
npm start
```

Open http://localhost:3000

### Using Gmail as SMTP

1. Enable 2-Step Verification on the Google account.
2. Create an **App Password** (Google Account → Security → App passwords).
3. Use `smtp.gmail.com`, port `587`, secure off, and the app password as
   `SMTP_PASS` (or in the Settings tab).
4. Gmail enforces a ~500 emails/day sending limit — for larger volumes use a
   transactional provider (SendGrid, Mailgun, Resend, Amazon SES, etc.) with
   the same SMTP fields.

## CSV format

```csv
email,name,company
alice@example.com,Alice,Acme Inc
bob@example.com,Bob,Widgets Co
```

Any extra column becomes a `{{column}}` placeholder usable in the template
body or subject line.

## Data storage

All data (templates, recipient lists, campaigns, send logs, SMTP settings)
is stored in a local SQLite file: `data.sqlite` (created automatically, not
committed to git).
