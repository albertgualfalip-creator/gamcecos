#!/usr/bin/env bash
# Install GamCECOS on an Ubuntu/Debian VPS: Node.js, a systemd service and HTTPS through nginx (if present) or Caddy.
#
# Run from the cloned repository:
#   sudo bash scripts/instal-vps.sh <domini> <contrasenya> [correu]
# Example:
#   sudo bash scripts/instal-vps.sh simcecos.es 'una-clau-llarga' jo@exemple.cat
set -euo pipefail

DOMINI="${1:-}"
CLAU="${2:-}"
CORREU="${3:-}"
PORT=8080
DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [[ $EUID -ne 0 ]]; then echo "Executa-ho amb sudo."; exit 1; fi
if [[ -z "$DOMINI" || -z "$CLAU" ]]; then
  echo "Ús: sudo bash scripts/instal-vps.sh <domini> <contrasenya> [correu]"; exit 1
fi
if [[ ! -f "$DIR/server.js" ]]; then echo "No trobo server.js a $DIR"; exit 1; fi
if [[ ! "$CLAU" =~ ^[A-Za-z0-9._-]{8,}$ ]]; then
  echo "La contrasenya ha de tenir almenys 8 caràcters: lletres, números, punt, guió o guió baix."; exit 1
fi
if ! getent hosts "$DOMINI" >/dev/null; then
  echo "$DOMINI encara no apunta enlloc: crea el registre DNS (tipus A) cap a la IP del VPS i torna-ho a provar."; exit 1
fi

# For a root domain, also serve www.<domain> if it already points somewhere
NOMS=("$DOMINI")
if [[ "$DOMINI" != www.* && $(tr -cd '.' <<< "$DOMINI" | wc -c) -eq 1 ]] && getent hosts "www.$DOMINI" >/dev/null; then
  NOMS+=("www.$DOMINI")
fi
echo "Noms: ${NOMS[*]}"

echo "== 1/4 Paquets bàsics"
apt-get update -q
apt-get install -y -q curl ca-certificates gnupg git

echo "== 2/4 Node.js"
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
node --version

echo "== 3/4 Servei gamcecos"
id gamcecos >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin gamcecos
chmod -R o+rX "$DIR"
cat > /etc/systemd/system/gamcecos.service <<EOF
[Unit]
Description=GamCECOS
After=network.target

[Service]
WorkingDirectory=$DIR
ExecStart=$(command -v node) server.js
Environment=PORT=$PORT
Environment=HOST=127.0.0.1
Environment=GAMCECOS_CLAU=$CLAU
Restart=always
User=gamcecos

[Install]
WantedBy=multi-user.target
EOF
chmod 600 /etc/systemd/system/gamcecos.service
systemctl daemon-reload
systemctl enable --now gamcecos
systemctl restart gamcecos
sleep 1
curl -fsS -o /dev/null "http://127.0.0.1:$PORT/app/vota.html" && echo "El joc respon al port $PORT"

echo "== 4/4 HTTPS per a ${NOMS[*]}"
if systemctl is-active --quiet nginx; then
  echo "nginx ja és actiu: hi afegeixo el subdomini"
  cat > /etc/nginx/sites-available/gamcecos <<EOF
server {
    listen 80;
    server_name ${NOMS[*]};
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 1h;
    }
}
EOF
  ln -sf /etc/nginx/sites-available/gamcecos /etc/nginx/sites-enabled/gamcecos
  nginx -t
  systemctl reload nginx
  apt-get install -y -q certbot python3-certbot-nginx
  if [[ -n "$CORREU" ]]; then MAIL=(-m "$CORREU"); else MAIL=(--register-unsafely-without-email); fi
  CERT=(); for n in "${NOMS[@]}"; do CERT+=(-d "$n"); done
  certbot --nginx "${CERT[@]}" --non-interactive --agree-tos --redirect "${MAIL[@]}"
  # Every game screen keeps a live connection open: over HTTP/1.1 a browser allows only 6 per site
  sed -i 's/listen 443 ssl;/listen 443 ssl http2;/; s/listen \[::\]:443 ssl;/listen [::]:443 ssl http2;/' /etc/nginx/sites-available/gamcecos
  nginx -t && systemctl reload nginx
elif systemctl is-active --quiet apache2; then
  echo "Hi ha Apache actiu. Configura un proxy cap a http://127.0.0.1:$PORT (vegeu docs/desplegament.md)."
  exit 1
else
  if ! command -v caddy >/dev/null; then
    echo "Instal·lo Caddy (HTTPS automàtic)"
    apt-get install -y -q debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -q
    apt-get install -y -q caddy
    : > /etc/caddy/Caddyfile   # replace the welcome page of a fresh install
  fi
  if ! grep -q "^$DOMINI[ ,]" /etc/caddy/Caddyfile; then
    LLISTA=$(IFS=,; echo "${NOMS[*]}" | sed 's/,/, /g')
    cat >> /etc/caddy/Caddyfile <<EOF
$LLISTA {
    reverse_proxy 127.0.0.1:$PORT {
        flush_interval -1
    }
}
EOF
  fi
  systemctl reload caddy || systemctl restart caddy
fi

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp && ufw allow 443/tcp
fi

echo
echo "Fet. Obre https://$DOMINI (contrasenya de la sala: la que has posat)."
echo "Públic: https://$DOMINI/vota amb el codi de sala, o el QR."
