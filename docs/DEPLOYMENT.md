# Deployment guide — DCB HRMS & Payroll, Release 1

For the Board's IT cell and the cloud provider's operations team. It covers the three copies the PRD asks
for (§16: production, test and training), on **NIC MeghRaj** or any **MeitY-empanelled government cloud**
with all data and backups in India.

---

## 1. What runs where

| Piece | What it is | Notes |
|---|---|---|
| Web app | Next.js 16 on Node.js 22 LTS (`next start`) | Serves the screens and the REST API (`/api/v1/...`). Stateless — run two processes per copy. |
| Database | PostgreSQL 16 | Every record, the audit trail (cannot be edited), the outbox. |
| File store | A folder (`STORAGE_DIR`) | Uploaded documents, generated PDFs and bank / return files, each kept with its SHA-256. |
| Reverse proxy | nginx | HTTPS, HTTP→HTTPS redirect, adds `X-Forwarded-For`, compresses, caps upload size. |
| PDF engine | Chromium (headless, on the app server) | Payslips, pay bills, PPO and letters in Hindi and English. |
| SMS gateway | The Board's DLT-registered provider | OTP on every login (PRD §16), payslip and life-certificate messages. |
| Email | The Board's SMTP server (optional) | Payslips by email (SL-02). |
| Biometric devices | eSSL / ZKTeco in push (ADMS) mode | Send punches to `https://<site>/iclock/cdata`. |

There is **no separate job server**. Daily work (retirements leaving the rolls, leave credits, life
certificate and filing reminders) runs the first time someone opens Home each day and is safe to repeat.

### Suggested sizes

| Copy | App VM | Database VM | Disk |
|---|---|---|---|
| Production | 4 vCPU, 8 GB RAM, two Node processes | 4 vCPU, 16 GB RAM | 200 GB SSD for the database, 200 GB for files, backups on separate storage in India |
| Test | 2 vCPU, 4 GB | can share the VM | 100 GB |
| Training | 2 vCPU, 4 GB | can share the VM | 50 GB |

Measured on one Node process with the demo data (see §10): 200 people using the system at once, 0 errors,
95% of pages under 0.33 s on the server. A full payroll for 1,675 staff and 1,255 pensioners is worked out and
saved in under 2 seconds.

---

## 2. The three copies

Each copy is a separate installation: its own database, its own file folder, **its own keys**, its own URL.
`APP_ENV` says which copy it is.

| | `APP_ENV` | SMS | Demo data | Who uses it |
|---|---|---|---|---|
| Production | `production` | real gateway (`SMS_PROVIDER=http`) — the app refuses to start with `console` | never (the seed refuses) | everyone |
| Test | `test` | real gateway, or `console` for a closed test | yes by default; `SEED_DEMO=0` for a copy loaded with migrated data | IT cell, auditors, UAT |
| Training | `training` | `console` — the OTP is shown on the sign-in screen so trainees need no phone | yes; demo password `Dcb@2026` | training sessions |

Real personal data may go into the test copy only for the migration rehearsal and parallel run (PRD §15),
with the same access rules as production. The training copy never holds real data.

---

## 3. Server preparation (each copy)

```bash
# Ubuntu 24.04 LTS
sudo apt update && sudo apt install -y nginx postgresql-16 fonts-noto-core chrony git
# Node.js 22 LTS from the NodeSource or distro packages, then:
node --version   # v22.x

# A service user that owns the app; no login shell
sudo useradd --system --create-home --shell /usr/sbin/nologin dcbhrms
sudo mkdir -p /srv/dcb-hrms /srv/dcb-hrms-files /srv/dcb-backups
sudo chown dcbhrms: /srv/dcb-hrms /srv/dcb-hrms-files
sudo chmod 700 /srv/dcb-hrms-files /srv/dcb-backups
```

**Clocks** (CERT-In: synced to NIC / NPL time). In `/etc/chrony/chrony.conf` replace the pool lines with:

```
server samay1.nic.in iburst
server samay2.nic.in iburst
server time.nplindia.org iburst
```

then `sudo systemctl restart chrony && chronyc sources`. The app works in India time (IST) whatever the
server's time zone, but logs read best with `sudo timedatectl set-timezone Asia/Kolkata`.

**Firewall**: only 443 (and 80, which redirects) open to users; 22 only from the IT cell's addresses;
PostgreSQL (5432) only from the app VM. `/iclock/` only from the office network where the biometric devices
sit (see the nginx block below).

---

## 4. Database

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE dcbhrms LOGIN PASSWORD 'use-a-long-random-password';
CREATE DATABASE dcb_hrms OWNER dcbhrms;
SQL
```

In `postgresql.conf` for production:

```
listen_addresses = 'localhost'        # or the private address the app VM uses
ssl = on                              # when the database is on its own VM
password_encryption = scram-sha-256
# Point-in-time recovery: at most 1 hour of data lost (PRD §16). See §8.
wal_level = replica
archive_mode = on
archive_timeout = 900                 # a WAL file at least every 15 minutes
archive_command = '/srv/dcb-hrms/scripts/archive-wal.sh %p %f'
```

---

## 5. Configuration

Copy `.env.example` to `/srv/dcb-hrms/.env`, owned by `dcbhrms`, mode `600`.

| Setting | Production value | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://dcbhrms:…@db-host:5432/dcb_hrms?sslmode=require` | |
| `APP_ENV` | `production` | `test` / `training` for the other copies |
| `APP_URL` | `https://hrms.<board-domain>.gov.in` | Must start with `https://` — cookies are then marked Secure and HSTS is sent |
| `BOARD_CODE` | `DCB` | |
| `DATA_ENCRYPTION_KEY` | `openssl rand -base64 32` | Encrypts Aadhaar, PAN and bank numbers. **Losing it loses those fields.** |
| `BLIND_INDEX_KEY` | `openssl rand -base64 32` | Finds duplicate Aadhaar / PAN / bank without decrypting |
| `OTP_PEPPER` | `openssl rand -base64 32` | Mixed into stored OTP hashes |
| `SMS_PROVIDER` | `http` | Gateway URL, sender ID, DLT entity and template IDs are set in Settings → SMS; the API key stays in an environment variable whose **name** the setting holds |
| `STORAGE_DIR` | `/srv/dcb-hrms-files` | |
| `CHROMIUM_PATH` | empty, or the path of a Chromium the IT cell installed | Empty = the Chromium installed by `npx playwright-core install chromium` (§6) |
| `TRUSTED_PROXY_HOPS` | `1` | Reverse proxies in front of the app that add to `X-Forwarded-For`. nginx alone = 1; a cloud load balancer + nginx = 2 |
| `BOOTSTRAP_ADMIN_MOBILE` / `BOOTSTRAP_ADMIN_PASSWORD` | the IT cell officer's mobile, a one-time password | Used once by the first seed to create the `IT01` User & settings manager, who must change the password at first sign-in |
| SMTP user / password, SMS key | named in Settings | e.g. `SMS_API_KEY`, `SMTP_USER`, `SMTP_PASSWORD` in the same `.env` |

**Key custody.** The three keys are generated once per copy, written to the `.env` and also sealed on paper
or in the Board's HSM / key vault, held by a named officer (not the vendor). Production keys are never
copied to test or training.

---

## 6. Install, upgrade, run

### First install

```bash
sudo -u dcbhrms -s
cd /srv/dcb-hrms
git clone <repository> . && git checkout <release-tag>
npm ci
npx playwright-core install chromium   # PDF engine (needs the internet once; or set CHROMIUM_PATH)
# and once, as root, the libraries Chromium needs:  sudo npx --prefix /srv/dcb-hrms playwright-core install-deps chromium
npx prisma migrate deploy        # creates the tables
npx prisma db seed               # Board, sections, posts, rules, and IT01 (demo data only outside production)
npm run build
```

### Service (two processes per copy)

`/etc/systemd/system/dcb-hrms@.service`:

```ini
[Unit]
Description=DCB HRMS & Payroll (port %i)
After=network.target

[Service]
User=dcbhrms
WorkingDirectory=/srv/dcb-hrms
EnvironmentFile=/srv/dcb-hrms/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -p %i -H 127.0.0.1
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now dcb-hrms@3001 dcb-hrms@3002
curl -s http://127.0.0.1:3001/api/v1/health    # {"ok":true}
```

### Upgrades

No planned downtime from the 25th to the 1st (PRD §16 — the payroll window).

```bash
sudo -u dcbhrms /srv/dcb-hrms/scripts/backup.sh   # see §8; keep this file until the upgrade is accepted
cd /srv/dcb-hrms && git fetch && git checkout <new-tag>
npm ci && npx prisma migrate deploy && npm run build
sudo systemctl restart dcb-hrms@3001 && sleep 5 && sudo systemctl restart dcb-hrms@3002
```

Restarting one process at a time keeps the site up. Upgrade the test copy first and check it by hand; the
automated checks run on the build machine before a release is tagged (§10).

---

## 7. nginx

`/etc/nginx/sites-available/dcb-hrms`:

```nginx
upstream dcb_hrms { server 127.0.0.1:3001; server 127.0.0.1:3002; keepalive 32; }

server {
  listen 80;
  server_name hrms.example.gov.in;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name hrms.example.gov.in;
  ssl_certificate     /etc/ssl/dcb/fullchain.pem;
  ssl_certificate_key /etc/ssl/dcb/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_prefer_server_ciphers off;
  server_tokens off;

  # FoxPro migration files can be large (S-90); everything else is far smaller.
  client_max_body_size 210m;
  gzip on;
  gzip_types text/css application/javascript application/json image/svg+xml;

  proxy_set_header Host              $host;
  proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto https;
  proxy_http_version 1.1;
  proxy_set_header Connection "";
  proxy_read_timeout 120s;          # big PDFs (pay register) and bulk files

  location /iclock/ {
    allow 10.0.0.0/8;               # the office network the biometric devices are on
    deny all;
    proxy_pass http://dcb_hrms;
  }

  location / { proxy_pass http://dcb_hrms; }
}
```

The app itself sends the security headers (Content Security Policy with a fresh nonce per page, HSTS on
HTTPS, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy, COOP/CORP) and `no-store` on
every API reply, so nginx does not need to add them.

---

## 8. Backups and restore (PRD §16: daily, encrypted, 90 days, restore within 4 hours, ≤ 1 hour lost)

**Nightly full backup** — `scripts/backup.sh` dumps the database and the file folder, encrypts them with
AES-256 (key from a passphrase file held by the named officer), writes a SHA-256 checksum and deletes copies
older than 90 days.

`/etc/systemd/system/dcb-backup.service` + `.timer`:

```ini
# dcb-backup.service
[Service]
Type=oneshot
User=dcbhrms
EnvironmentFile=/srv/dcb-hrms/.env
Environment=BACKUP_DIR=/srv/dcb-backups BACKUP_PASSPHRASE_FILE=/etc/dcb/backup.key
ExecStart=/srv/dcb-hrms/scripts/backup.sh

# dcb-backup.timer
[Timer]
OnCalendar=*-*-* 01:30:00 Asia/Kolkata
Persistent=true
[Install]
WantedBy=timers.target
```

Copy `/srv/dcb-backups` to a second storage location in India (the cloud provider's object storage in another
zone) after each run.

**At most one hour lost** — the WAL archiving set in §4 ships a log segment at least every 15 minutes.
`scripts/archive-wal.sh` (create it on the database server) should encrypt and copy each segment, for example:

```bash
#!/usr/bin/env bash
set -euo pipefail
umask 077
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass file:/etc/dcb/backup.key -in "$1" -out "/srv/dcb-wal/$2.enc"
```

**Restore** (into an empty database, e.g. on a fresh VM):

```bash
createdb -O dcbhrms dcb_hrms_restored
DATABASE_URL=postgresql://…/dcb_hrms_restored STORAGE_DIR=/srv/dcb-hrms-files \
BACKUP_PASSPHRASE_FILE=/etc/dcb/backup.key scripts/restore.sh /srv/dcb-backups/dcb-hrms-<stamp>.tar.gz.enc
```

The script refuses a file without its checksum. To reach a point after the nightly dump, restore the dump with
PostgreSQL's point-in-time recovery from the archived WAL (`restore_command` decrypting the `.enc` files).

**Drill**: restore the latest backup into the test copy every quarter and compare record counts. The drill
done for Release 1 restored the demo database and 905 stored files with identical counts and checksums in
about a second; a production-size database restores well inside the 4-hour limit.

---

## 9. Logs and monitoring (CERT-In)

- The app writes to standard output; systemd keeps it in the journal. Keep **180 days** in India:
  `/etc/systemd/journald.conf` → `Storage=persistent`, `MaxRetentionSec=180day`, `SystemMaxUse=20G`.
- nginx access and error logs: `/etc/logrotate.d/nginx` → `daily`, `rotate 180`, `compress`.
- Who did what inside the system is in the audit trail (Admin → Audit trail), kept 8 years and impossible to
  edit, with user, time, address, old and new value — separate from the server logs.
- Monitor `GET /api/v1/health` every minute (200 = up, 503 = no database) and alert the IT cell.
- **Incidents**: report to CERT-In within 6 hours (incident@cert-in.org.in). Keep the logs above untouched.

---

## 10. Before go-live checklist

Security and access
- [ ] Security audit by a **CERT-In-empanelled auditor** on the test copy (PRD §16); fix every finding
- [ ] HTTPS certificate installed; `http://` redirects; `APP_URL` starts with `https://`
- [ ] `IT01` signed in once, changed the password, created the real users; bootstrap password destroyed
- [ ] Keys generated for production only, sealed copies with the named officer
- [ ] `SMS_PROVIDER=http`, DLT templates registered and their IDs entered in Settings → SMS
- [ ] Firewall as in §3; PostgreSQL not reachable from the internet; `/iclock/` limited to the office network
- [ ] Privacy notice shown to employees (DPDP Act 2023); retention schedule agreed

Data
- [ ] Migration done through the console (S-90) on the test copy, every §15 check signed, three parallel-run
      months explained, cut-over signed by the Admin; then the same files loaded into production

Operations
- [ ] Nightly backup timer running; one restore drill done; WAL archive arriving every 15 minutes
- [ ] Clocks synced to NIC / NPL (`chronyc tracking`)
- [ ] Health check monitored; journald and nginx keep 180 days

Acceptance checks
- [ ] On the build machine, for the release tag: `npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e`.
      The browser checks build their own throw-away database and server (port 3100) and cover every main flow,
      the WCAG 2.1 AA scan (axe), the 320-px reflow check and the security headers. Never point them at a copy
      with real data — they sign in with the demo logins and approve demo tasks
- [ ] 200 people at once, on the **test** copy: `APP_ENV=test DATABASE_URL=… BASE_URL=https://hrms-test… node scripts/load-test.mjs`
      (refuses to run against production; the script exits with an error if any page fails)
- [ ] One payroll month worked out end to end with the Board's own data

---

## 11. Security controls in the application (for the auditor)

| Control | Where |
|---|---|
| OTP on every login; 5 wrong passwords lock the login for 15 minutes; 5 OTPs per login in 10 minutes; 5 tries per OTP | `src/modules/auth/service.ts` |
| 15-minute idle timeout (warning at 13), 12-hour absolute session; sessions stored as SHA-256 of the cookie token | `src/lib/auth/session.ts`, `src/components/shell/idle-timer.tsx` |
| Cookie `HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS; same-origin check on every write | `src/lib/auth/session.ts`, `src/lib/api/route.ts` |
| Rate limits: 600 sign-in requests per address per 10 minutes, 300 requests per session per minute (`429` + `Retry-After`) | `src/lib/rate-limit.ts` |
| Content Security Policy with a per-request nonce (`script-src 'self' 'nonce-…' 'strict-dynamic'`, no `unsafe-inline` / `unsafe-eval` for scripts, `frame-ancestors 'none'`, `object-src 'none'`); HSTS | `src/proxy.ts`, `src/lib/csp.ts` |
| Aadhaar, PAN, bank number encrypted (AES-256-GCM), masked on screen, every reveal audited; Aadhaar never shown in full | `src/lib/crypto.ts`, `src/modules/employees/service.ts` |
| Role rights as data (PRD §14); nobody prepares, checks or approves their own pay; maker ≠ checker | `src/lib/auth/access.ts`, `src/lib/approvals/` |
| Audit trail cannot be edited (database trigger), 8 years | `prisma/migrations/*audit*`, `src/lib/audit.ts` |
| Client address taken from the trusted proxy's entry in `X-Forwarded-For`, never from a value the browser typed | `src/lib/request-meta.ts` |
| Dependencies pinned; `npm audit` clean at release | `package.json`, `package-lock.json` |

---

## 12. A demo copy on Vercel

Vercel is fine for **showing the product** (a training or demo copy). It is **not** for production: files
written there vanish between runs, and the data must stay on government cloud in India (§16).

1. **Database**: a hosted PostgreSQL 16 (Neon, Supabase…). Use `?sslmode=verify-full` in the URL (this also
   silences pg's SSL-mode warning). Create the tables and the demo data once from your machine:
   ```bash
   DATABASE_URL="<hosted url>" APP_ENV=training npx prisma migrate deploy
   DATABASE_URL="<hosted url>" APP_ENV=training DATA_ENCRYPTION_KEY=… BLIND_INDEX_KEY=… OTP_PEPPER=… npx prisma db seed
   ```
2. **Environment variables** in Vercel → Settings → Environment Variables:
   `DATABASE_URL`, `APP_ENV=training`, `APP_URL=https://<project>.vercel.app`, `DATA_ENCRYPTION_KEY`,
   `BLIND_INDEX_KEY`, `OTP_PEPPER` (the **same keys** used for the seed), `SMS_PROVIDER=console`,
   `TRUSTED_PROXY_HOPS=1`. With `training` + `console` the OTP is shown on the sign-in screen.
3. **PDFs**: nothing to set. On Vercel the app uses a Chromium built for serverless functions
   (`@sparticuz/chromium`); the first PDF after a quiet spell takes a few seconds longer.
4. **Uploaded files** (documents, migration files, generated bank files) go to `/tmp` and are lost when Vercel
   recycles the function. Downloads made right away work; nothing is kept.
5. Deploy by pushing the branch Vercel watches. Vercel runs the `vercel-build` script, which **applies any new
   database migrations first** (`prisma migrate deploy`) and then builds — so a new version never meets an old
   database. `DATABASE_URL` must therefore be available to builds (tick the environments when you add it). If
   it goes through a connection pooler (Neon host with `-pooler`, Supabase port 6543), also add
   `DIRECT_DATABASE_URL` with the direct address; migrations use it, the app keeps using `DATABASE_URL`.
   If the build stops at the migration step, its log names the problem; nothing is half-applied.
6. **"Something went wrong" on pages after an update** almost always means the database is behind the code (the
   function log shows `The table … does not exist`). Apply the migrations by hand once:
   ```bash
   DATABASE_URL="<hosted url>" npx prisma migrate deploy        # macOS / Linux
   $env:DATABASE_URL="<hosted url>"; npx prisma migrate deploy   # Windows PowerShell
   ```
