# Guard Patrol — Company Server

This small server connects every phone running Guard Patrol. Once it's online:

- **One set of accounts.** Officers the administrator adds can sign in on any phone with their badge and PIN. PINs are stored encrypted (hashed), never in plain text.
- **Every report goes straight to the administrator**, from any phone, into the Report inbox and the private Report alerts channel. When the admin marks a report reviewed, the officer's phone shows it.
- **Messaging works between phones** (Dispatch and site channels, refreshed every 15 seconds).
- **Live operations board.** The admin and supervisors see who is on duty and their latest position. Positions are accepted **only while an officer is checked in**; anything sent after check-out is discarded.
- **The rules are enforced by the server**, not just the app: only the administrator can add or remove officers (max **40**), sites, or guard-tour locations (max **15 per site**). An officer who is on duty can't be removed.

It is a single file (`server.js`) with no third-party packages. It needs Node.js 18 or newer.

---

## Put it online with Railway (about 15 minutes)

You will need a free GitHub account and a Railway account. Railway charges by usage; a server this small typically costs only a few dollars a month, but check [railway.com/pricing](https://railway.com/pricing) for current plans.

### 1. Put the files on GitHub
1. Sign in at [github.com](https://github.com) → **New repository** → name it `guard-patrol-server` → choose **Private** → **Create repository**.
2. On the new repository page click **uploading an existing file**.
3. Drag in all the files from this folder (`server.js`, `package.json`, `Dockerfile`, `README.md`, `.gitignore`, `.dockerignore`), then **Commit changes**.

### 2. Deploy on Railway
1. Sign in at [railway.com](https://railway.com) (you can sign in with GitHub) → **New Project** → **Deploy from GitHub repo** → pick `guard-patrol-server`. Allow Railway access to the repo if asked.
2. Railway starts building. Open the service, then **Variables** → **New Variable**:
   - `ADMIN_PIN` = a 4–8 digit PIN for the administrator (for example `739214`). **Choose your own; don't use 1234.**
   - (optional) `ADMIN_BADGE` = administrator badge number (default `1000`)
   - (optional) `SEED_DEMO_SITES` = `false` if you don't want the two demo sites
3. **Add storage (required):** right-click the project canvas (or press ⌘K / Ctrl+K) → **Volume** → connect it to the service → mount path `/data`. Without a volume, all data is wiped every time Railway restarts the server.
4. Open the service → **Settings** → **Networking** → **Generate Domain**. You get an address like `https://guard-patrol-server-production.up.railway.app`.
5. Open that address in a browser. You should see *"Guard Patrol sync server … is running."*
6. Check **Deployments → View logs**: the line should say `data in /data`. That confirms the volume is in use.

> `ADMIN_PIN` is only used the very first time the server starts. To change the admin PIN later, use the app: **More → My profile & PIN**. If you forget to set `ADMIN_PIN`, the server prints a temporary PIN in the logs.

### 3. Connect the phones
On each phone, on the sign-in screen tap **Company server**, enter the address from step 4, then tap **Test & save** and sign in.

1. **Administrator first:** badge `1000` (or your `ADMIN_BADGE`) and your `ADMIN_PIN`. Then go to **More → Security officers** and add your officers with their badge numbers and PINs.
2. **Officers:** connect the phone the same way and sign in with the badge and PIN the administrator created.

Connecting a phone to a server clears the stand-alone demo data on that phone, so demo officers and demo reports never mix with real company data.

---

## Other hosting options
- **Render.com:** create a *Web Service* from the GitHub repo (runtime: Docker). Persistent disks need a paid instance type. Add a Disk mounted at `/data` and set the environment variable `DATA_DIR=/data`, plus `ADMIN_PIN`.
- **Any VPS or office PC with Docker:**
  `docker build -t guard-patrol-server . && docker run -d -p 8080:8080 -v gp-data:/data -e DATA_DIR=/data -e ADMIN_PIN=739214 --restart unless-stopped guard-patrol-server`
  Put it behind HTTPS (for example Caddy or Cloudflare Tunnel). Android blocks plain `http://` addresses.
- **Plain Node.js:** `ADMIN_PIN=739214 DATA_DIR=/var/lib/guard-patrol node server.js`

## Settings (environment variables)
| Variable | Default | Purpose |
|---|---|---|
| `ADMIN_PIN` | random, printed in logs | Administrator PIN on first start |
| `ADMIN_BADGE` | `1000` | Administrator badge on first start |
| `DATA_DIR` | Railway volume, else `./data` | Where data is stored, which **must be persistent** |
| `SEED_DEMO_SITES` | `true` | Create two editable demo sites on first start |
| `MAX_OFFICERS` | `40` | Officer account limit |
| `MAX_CHECKPOINTS` | `15` | Guard-tour locations per site |
| `SESSION_DAYS` | `30` | How long a phone stays signed in |
| `ALLOWED_ORIGINS` | the Android app | Leave as is |

## Backups
Everything lives in the data folder: `state.json` (accounts, sites, shifts, messages) and `reports/` (one file per report, including photos). Back up that folder regularly. On Railway, volume backups can be enabled in the volume's settings.

## Security notes
- Use HTTPS (Railway and Render provide it automatically).
- Sign-in is locked for 5 minutes after 5 wrong PINs for the same badge.
- Changing an officer's PIN signs them out on their other phones; removing an officer signs them out everywhere.
- PINs are short by design so they're quick to enter on duty. Treat the server address as private, and choose PINs that aren't easy to guess.

## API (for developers)
All endpoints are under `/api`. Every request except `health` and `login` needs `Authorization: Bearer <token>`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | `{ ok, server: "guard-patrol", version }` |
| POST | `/api/login` | `{ badge, pin }` → `{ token, user, users }` |
| POST | `/api/logout` | Ends the session |
| POST | `/api/events` | `{ id, kind, data, at }`. Kinds: `shift`, `location`, `scan`, `report`, `reportSeen`, `reportReviewed`, `message`, `ack`, `user`, `userDeleted`, `site`, `siteDeleted`. Idempotent by `id`; `4xx` means the server rejected the change. |
| GET | `/api/state?since=<now from last call>` | `{ now, me, users, sites, messages, reports, shifts, acks }` changed since `since`. Officers receive only their own reports and shifts; the Report alerts channel goes to the administrator only. |
