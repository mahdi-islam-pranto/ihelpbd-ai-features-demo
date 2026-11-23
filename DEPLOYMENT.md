# Deploying on a CentOS / RHEL server

Target: **CentOS Stream 9**, Rocky Linux 9 or AlmaLinux 9.
(CentOS 7 is end-of-life and ships Python 3.6. This app needs **Python 3.10+**.)

```
Browser ──HTTPS──> Nginx :443 ──> Uvicorn (systemd) 127.0.0.1:8000 ──> MySQL 127.0.0.1:3306
                                        └──> your AI APIs (e.g. :6029)
```

Run all commands as root (or with `sudo`). Replace `portal.example.com` and the passwords with your own.

---

## 1. Install system packages

```bash
dnf -y update
dnf -y install python3.11 python3.11-pip git nginx mysql-server
systemctl enable --now mysqld nginx
mysql_secure_installation          # set the MySQL root password, remove test users
```

## 2. Create the database and a dedicated MySQL user

```bash
mysql -u root -p
```
```sql
CREATE DATABASE ihelp_ai_demo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'ihelp'@'localhost' IDENTIFIED BY 'CHANGE_ME_strong_password';
GRANT ALL PRIVILEGES ON ihelp_ai_demo.* TO 'ihelp'@'localhost';
FLUSH PRIVILEGES;
```
The app creates the tables itself on first start.

## 3. Put the code on the server

```bash
useradd --system --create-home --home-dir /opt/ihelp-ai-demo --shell /sbin/nologin ihelp
cd /opt/ihelp-ai-demo
sudo -u ihelp git clone <your-repo-url> app-src      # or upload the project with scp/rsync
cd app-src
sudo -u ihelp python3.11 -m venv .venv
sudo -u ihelp .venv/bin/pip install -r requirements.txt
```

Copy the sample folders too (`sample-call-recordings/`, `sample-crm-datas/`). They are git-ignored, so `rsync`/`scp` them:
```bash
# from your PC
scp -r sample-call-recordings sample-crm-datas root@SERVER:/opt/ihelp-ai-demo/app-src/
# on the server
chown -R ihelp:ihelp /opt/ihelp-ai-demo/app-src
```

## 4. Configure `.env`

```bash
sudo -u ihelp cp .env.example .env
sudo -u ihelp vi .env
chmod 600 .env
```
Values that differ from your PC:
```ini
HOST=127.0.0.1
PORT=8000
DB_USER=ihelp
DB_PASSWORD=CHANGE_ME_strong_password
DB_NAME=ihelp_ai_demo
CALL_ANALYSIS_API_URL=http://<ai-server-ip>:6029/analyze-call   # 127.0.0.1 if the AI API runs on this same server
```

## 5. Run it as a service (systemd)

Create `/etc/systemd/system/ihelp-ai-demo.service`:
```ini
[Unit]
Description=iHelp AI Showcase (FastAPI)
After=network.target mysqld.service

[Service]
User=ihelp
Group=ihelp
WorkingDirectory=/opt/ihelp-ai-demo/app-src
ExecStart=/opt/ihelp-ai-demo/app-src/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2 --proxy-headers
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```
Don't use `python run.py` in production because it runs with auto-reload.

```bash
systemctl daemon-reload
systemctl enable --now ihelp-ai-demo
systemctl status ihelp-ai-demo
curl -s http://127.0.0.1:8000/api/health        # "connected": true means MySQL is OK
journalctl -u ihelp-ai-demo -f                  # live logs
```

## 6. Nginx reverse proxy

Create `/etc/nginx/conf.d/ihelp-ai-demo.conf`:
```nginx
server {
    listen 80;
    server_name portal.example.com;          # or the server IP

    client_max_body_size 110m;               # uploads are limited to 100 MB by the app

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;             # AI calls can take up to API_TIMEOUT (180 s)
        proxy_send_timeout 300s;
    }
}
```
```bash
nginx -t && systemctl reload nginx
```

## 7. SELinux and firewall (both are on by default on CentOS)

```bash
setsebool -P httpd_can_network_connect 1     # allow Nginx to reach Uvicorn on :8000
firewall-cmd --permanent --add-service=http --add-service=https
firewall-cmd --reload
```
A **502 Bad Gateway** from Nginx is almost always the missing `setsebool`.

## 8. HTTPS (needs a domain pointing to the server)

```bash
dnf -y install epel-release
dnf -y install certbot python3-certbot-nginx
certbot --nginx -d portal.example.com        # also sets up auto-renewal
```

## 9. Restrict access (recommended)

The portal has no login. Anyone with the URL can run the AI features (which costs tokens) and see or delete saved results.
The simplest protection is a password at the Nginx level:
```bash
dnf -y install httpd-tools
htpasswd -c /etc/nginx/.htpasswd demo        # prompts for a password
```
Add the following inside the `location / { ... }` block, then run `systemctl reload nginx`:
```nginx
auth_basic "iHelp AI Showcase";
auth_basic_user_file /etc/nginx/.htpasswd;
```

## Updating

```bash
cd /opt/ihelp-ai-demo/app-src
sudo -u ihelp git pull
sudo -u ihelp .venv/bin/pip install -r requirements.txt
systemctl restart ihelp-ai-demo
```
New feature tables are created automatically on restart. Changes to existing columns need a manual `ALTER TABLE`.

## Backups

Back up both the database and the stored uploads:
```bash
mysqldump -u ihelp -p --single-transaction ihelp_ai_demo | gzip > /backup/ihelp_ai_demo_$(date +%F).sql.gz
tar czf /backup/ihelp_storage_$(date +%F).tgz -C /opt/ihelp-ai-demo/app-src storage
```
