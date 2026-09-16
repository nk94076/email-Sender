#!/usr/bin/env bash
# Deploys the bulk emailer (email-Sender) to this VPS, behind Nginx with SSL,
# on the domain passed as $1 (default: mailer.adstrackio.com).
#
# Uses the certbot "webroot" method instead of the nginx auto-installer, so
# it never touches any other vhost on the box (important on panels like
# CloudPanel that manage their own shared default.conf for other domains).
set -euo pipefail

DOMAIN="${1:-mailer.adstrackio.com}"
APP_DIR="/opt/email-sender"
REPO_URL="https://github.com/nk94076/email-Sender.git"
BRANCH="naveen/brave-shannon-2iuvrx"
CERT_EMAIL="naveen.p@adhookmedia.com"
WEBROOT="/var/www/certbot"
SITE_CONF="/etc/nginx/sites-available/email-sender.conf"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"

echo "== [1/8] Updating system packages =="
apt-get update -y

echo "== [2/8] Installing Node.js 22 LTS =="
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "== [3/8] Installing Nginx, Certbot, git, PM2 =="
apt-get install -y nginx certbot git build-essential
npm install -g pm2

echo "== [4/8] Fetching application code =="
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git fetch origin
  git checkout "$BRANCH"
  git reset --hard "origin/$BRANCH"
else
  git clone -b "$BRANCH" "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

echo "== [5/8] Installing app dependencies =="
npm install --omit=dev

echo "== [6/8] Preparing environment file =="
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  echo "Created $APP_DIR/.env from example — EDIT THIS with real SMTP credentials before sending real campaigns."
fi

echo "== [7/8] Starting app with PM2 (auto-restart on crash/reboot) =="
cd "$APP_DIR"
pm2 delete email-sender >/dev/null 2>&1 || true
pm2 start server.js --name email-sender
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash || true

echo "== [8/8] Configuring Nginx (site-scoped file, does not touch other vhosts) =="
mkdir -p "$WEBROOT"

write_http_only_conf() {
  cat > "$SITE_CONF" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root ${WEBROOT};
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        client_max_body_size 10M;
    }
}
NGINX
}

write_https_conf() {
  cat > "$SITE_CONF" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root ${WEBROOT};
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ${DOMAIN};

    ssl_certificate ${CERT_DIR}/fullchain.pem;
    ssl_certificate_key ${CERT_DIR}/privkey.pem;

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINX
}

if [ -f "${CERT_DIR}/fullchain.pem" ]; then
  write_https_conf
else
  write_http_only_conf
fi

ln -sf "$SITE_CONF" "/etc/nginx/sites-enabled/$(basename "$SITE_CONF")"
nginx -t
systemctl reload nginx

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 'Nginx Full' || true
  ufw allow OpenSSH || true
fi

if [ ! -f "${CERT_DIR}/fullchain.pem" ]; then
  echo "== Requesting SSL certificate via Let's Encrypt (webroot method) =="
  echo "   (this needs the DNS A record for ${DOMAIN} to have propagated to this server's IP already)"
  if certbot certonly --webroot -w "$WEBROOT" -d "${DOMAIN}" --non-interactive --agree-tos -m "${CERT_EMAIL}"; then
    echo "Certificate obtained. Switching Nginx to HTTPS."
    write_https_conf
    nginx -t
    systemctl reload nginx
    echo "SSL configured successfully."
  else
    echo "Certbot failed (DNS probably hasn't propagated yet)."
    echo "Once DNS is live, re-run this script, or run:"
    echo "  certbot certonly --webroot -w ${WEBROOT} -d ${DOMAIN} --agree-tos -m ${CERT_EMAIL}"
  fi
fi

echo ""
echo "================================================================"
echo " Done. App is running via PM2 and reverse-proxied through Nginx."
echo " Visit: https://${DOMAIN} (falls back to http:// until SSL succeeds)"
echo " Edit SMTP settings at: $APP_DIR/.env, then: pm2 restart email-sender"
echo " Or configure SMTP directly from the app's Settings tab in the browser."
echo "================================================================"
