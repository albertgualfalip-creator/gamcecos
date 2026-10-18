# Instal·lació al servidor

GamCECOS és un únic procés de Node.js sense dependències externes. Serveix la pantalla de la sala, la pàgina de vot i les dades, i reparteix els vots en temps real (Server-Sent Events).

## VPS d'OVH amb un subdomini (manera recomanada)

1. **DNS.** Al panell d'OVH: *Web Cloud → Noms de domini → simceos.es → Zona DNS → Afegir una entrada → A*. Subdomini `joc`, destinació: la IP del VPS. Pot tardar de minuts a unes hores a funcionar.
2. **Entrar al VPS.** Des de l'ordinador: `ssh ubuntu@IP_DEL_VPS` (a OVH l'usuari sol ser `ubuntu` o `debian`).
3. **Clau perquè el VPS pugui baixar el codi** (el repositori és privat):
   ```bash
   sudo apt-get update && sudo apt-get install -y git
   ssh-keygen -t ed25519 -f ~/.ssh/gamcecos -N ""
   cat ~/.ssh/gamcecos.pub
   ```
   Copia la línia que surt i, a GitHub: repositori → *Settings → Deploy keys → Add deploy key* (sense marcar "Allow write access").
4. **Baixar el codi:**
   ```bash
   sudo mkdir -p /srv/gamcecos && sudo chown "$USER" /srv/gamcecos
   GIT_SSH_COMMAND="ssh -i ~/.ssh/gamcecos" git clone -b claude/vigilant-turing-56krps git@github.com:albertgualfalip-creator/gamcecos.git /srv/gamcecos
   cd /srv/gamcecos && git config core.sshCommand "ssh -i ~/.ssh/gamcecos"
   ```
5. **Instal·lar** (Node.js, servei i HTTPS; si el VPS ja té nginx per a simceos.es, hi afegeix el subdomini sense tocar la resta):
   ```bash
   sudo bash scripts/instal-vps.sh joc.simceos.es LA_TEVA_CONTRASENYA el-teu@correu
   ```
6. Obre `https://joc.simceos.es`.

**Actualitzar** quan hi hagi canvis: `cd /srv/gamcecos && git pull && sudo systemctl restart gamcecos`.
**Veure si funciona:** `sudo systemctl status gamcecos` · **Registres:** `sudo journalctl -u gamcecos -n 50`.

## Requisits

- Node.js 18 o superior (recomanat 22 LTS), o bé Docker.
- Un port accessible des de la xarxa on hi hagi els mòbils del públic (per defecte el 8080).
- Recomanat: HTTPS davant (nginx, Apache o el balancejador de l'organització).

## Variables d'entorn

| Variable | Per a què serveix | Per defecte |
|---|---|---|
| `PORT` | Port on escolta | `8080` |
| `GAMCECOS_CLAU` | Contrasenya per a la pantalla de la sala i les dades. La pàgina de vot només demana el codi de sala | sense contrasenya |

## Opció 1: Node.js directament

```bash
git clone <repositori> /srv/gamcecos
cd /srv/gamcecos
git checkout claude/vigilant-turing-56krps
PORT=8080 GAMCECOS_CLAU='canvieu-aquesta-clau' node server.js
```

Per deixar-lo sempre en marxa amb systemd, `/etc/systemd/system/gamcecos.service`:

```ini
[Unit]
Description=GamCECOS
After=network.target

[Service]
WorkingDirectory=/srv/gamcecos
ExecStart=/usr/bin/node server.js
Environment=PORT=8080
Environment=GAMCECOS_CLAU=canvieu-aquesta-clau
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now gamcecos
```

## Opció 2: Docker

```bash
docker build -t gamcecos .
docker run -d --name gamcecos --restart unless-stopped -p 8080:8080 -e GAMCECOS_CLAU='canvieu-aquesta-clau' gamcecos
```

## Darrere d'un proxy (nginx)

Cal desactivar la memòria intermèdia perquè els vots arribin en directe:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

## Ús

- Sala: `https://<servidor>/` (demana la contrasenya si n'hi ha). Cada pantalla de sala obre una **sala amb un codi de 4 lletres**; diversos grups poden jugar alhora sense barrejar vots.
- Públic: escaneja el QR de la sala, o entra a `https://<servidor>/vota` i escriu el codi.
- Les sales sense activitat es tanquen soles al cap de 12 hores. No es guarda res al disc.

## Actualitzar

```bash
cd /srv/gamcecos && git pull && sudo systemctl restart gamcecos
```
