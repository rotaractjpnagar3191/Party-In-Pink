# PiP Tickets — Netlify + GitHub Storage (100% free)

This version **does NOT require Google**. It stores order logs in a **private GitHub repo** as JSON Lines (JSONL) files:
- `storage/orders.jsonl` — one line per order created
- `storage/payments.jsonl` — one line per successful payment (webhook)
- `storage/checkins.jsonl` — one line per check-in

The site stays static (HTML/CSS/JS). Serverless functions run on **Netlify Free**. Payments via **Cashfree**.

## Environment variables (Netlify)

Required:
```
SITE_URL=https://pip.rotaractjpnagar.org
CASHFREE_ENV=sandbox               # later 'production'
CASHFREE_APP_ID=cf_...
CASHFREE_SECRET_KEY=...
ADMIN_KEY=<strong random>

# GitHub storage (create a *private* repo for data, e.g. pip-tickets-data)
GITHUB_TOKEN=<fine-grained PAT with Contents: Read/Write on that repo only>
GITHUB_OWNER=<your GitHub username or org>
GITHUB_REPO=pip-tickets-data
GITHUB_BRANCH=main
STORE_PATH=storage
```

Optional (for auto-emailing tickets):
```
SENDGRID_API_KEY=...
TICKETS_FROM_EMAIL=PiP <tickets@rotaractjpnagar.org>
```

## Setup

1) Create **two GitHub repos**:
   - App code repo (this one) — public or private
   - **Data repo** (private), e.g. `pip-tickets-data`

2) Make a **Fine-grained Personal Access Token** in GitHub:
   - Resource owner: your user/org
   - Repository access: **Only selected repositories** → select `pip-tickets-data`
   - Permissions → **Repository contents: Read and Write**
   - Copy the token and add it to Netlify env as `GITHUB_TOKEN`

3) Netlify → New site from Git → import this app repo.
   - Build command: *(empty)*
   - Publish dir: `public`
   - Functions dir: auto via `netlify.toml`

4) Add the **Environment variables** above (including GitHub ones).

5) Cashfree Dashboard → Webhooks:
   - `https://pip.rotaractjpnagar.org/api/cashfree-webhook`

6) Test sandbox:
   - `/register.html` → pay → `/success.html?order_id=...` → **Download Ticket (PDF)**
   - Admin export: `/api/admin-export?key=ADMIN_KEY`
   - Check-in: `/scan.html` (prompts for admin key)

## Notes
- Inventory and coupon usage are computed from **paid** orders only.
- Using a separate private data repo avoids triggering site rebuilds on every order.
- JSONL is append-only (safe & simple). Exports are generated on the fly.
