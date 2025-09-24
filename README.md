# PiP Tickets — Netlify + Cashfree + GitHub Storage (free)

A minimal ticketing stack:

* Static site (HTML/CSS/JS) on **Netlify Free**
* **Cashfree Hosted Checkout** (Payment Links) — user is redirected to Cashfree’s payment page
* Serverless functions for:

  * creating links / order refs
  * webhook verification (marks **PAID**)
  * PDF ticket with QR
  * exports & check-in
* Free, append-only storage in a **private GitHub repo** (JSON Lines)

## Architecture

1. User clicks **Register** → your function creates a **Cashfree Payment Link** (amount = price × qty) and returns `link_url`.
2. Browser **redirects** to the Cashfree hosted page (no card data on your site).
3. After payment, Cashfree:

   * **redirects** back to your success page with your own `ref`
   * **sends a webhook** → your function verifies signature and marks the order **PAID** in the private GitHub repo
4. Success page polls `/api/order-status?ref=...` and, once **PAID**, shows **Download Ticket (PDF)**.

---

## Repos

* **App code repo:** this project (public/private)
* **Data repo:** private, e.g. `pip-tickets-dat` (stores JSONL files under `storage/`)

Create a **fine-grained PAT** on GitHub with:

* **Repository access:** *Only selected repositories* → select your **data** repo
* **Permissions → Repository contents:** **Read & Write**

Use that token only as `GITHUB_TOKEN` in Netlify env vars.

---

## Environment variables (Netlify)

Add these (Production + Preview + Dev). **Do not** paste real values in this README.

```
# Site
SITE_URL=<https://your-subdomain.yourdomain.tld>   # e.g. https://pip.rotaractjpnagar.org

# Cashfree
CASHFREE_ENV=<sandbox|production>
CASHFREE_APP_ID=<your-cashfree-app-id>
CASHFREE_SECRET_KEY=<your-cashfree-secret>

# Admin
ADMIN_KEY=<a-strong-random-string>

# GitHub storage (points to your private data repo)
GITHUB_TOKEN=<fine-grained PAT with Contents: Read/Write on the data repo>
GITHUB_OWNER=<github username or org>
GITHUB_REPO=<data repo name, e.g. pip-tickets-dat>
GITHUB_BRANCH=<main>
STORE_PATH=<storage>
```

Optional (for ticket emails):

```
SENDGRID_API_KEY=<sendgrid key>
TICKETS_FROM_EMAIL=<e.g. "PiP <tickets@yourdomain.tld>">
```

### Netlify Secret Scanning (to stop false positives)

Netlify may fail builds if it finds your **env *values*** inside the repo (e.g., a real URL). Keep real values out of README and add:

* **Preferred (filter only harmless keys):**

  ```
  SECRETS_SCAN_OMIT_KEYS=SITE_URL,CASHFREE_ENV,GITHUB_BRANCH,GITHUB_REPO,STORE_PATH
  SECRETS_SCAN_OMIT_PATHS=README.md,public/**
  ```
* **Quickest (turn off):**

  ```
  SECRETS_SCAN_ENABLED=false
  ```

---

## Setup (step-by-step)

1. **Create the private data repo** (e.g., `pip-tickets-dat`)

   * Make fine-grained PAT → Contents **Read & Write** → Only that repo

2. **Netlify → New site from Git** → select this app repo

   * Build command: *(empty)*
   * Publish directory: `public`
   * Functions: picked from `netlify/functions` via `netlify.toml`

3. **Add environment variables** (above)

4. **Cashfree Dashboard**

   * Keep **Sandbox** while testing
   * Set **Webhook** URL to:

     ```
     <SITE_URL>/api/cashfree-webhook
     ```
   * (Production later: switch `CASHFREE_ENV=production` and set live keys)

5. **Domain**

   * Netlify → Domain management → Add **custom domain** (e.g., `pip.rotaractjpnagar.org`) → follow CNAME instructions

6. **Ticket configuration**

   * Edit `config/event.json` (tiers, prices, quantities, sale windows)
   * Commit → Netlify redeploys

---

## How it works (Payment Links — recommended)

* **Frontend** (`public/index.html`): small form (name, email, phone, **tier**, **qty**)
  → POST `/api/create-payment-link`
* **Function** (`netlify/functions/create-payment-link.js`):

  * Validates tier & qty
  * Checks remaining stock from **paid** orders
  * Generates a unique `ref`
  * Calls **Cashfree `/pg/links`** to create a hosted link with
    `link_amount=price×qty`, and `return_url=<SITE_URL>/success.html?ref=<ref>`
  * Returns `{ ref, link_url }` → browser **redirects** to `link_url`
* **Webhook** (`/api/cashfree-webhook`):

  * Verifies `x-webhook-signature` (HMAC SHA-256 of the **raw** request body with your Cashfree secret)
  * On **PAID**, appends `{ ref, paid_at }` to `storage/payments.jsonl` in the data repo
* **Success page** (`public/success.html`):

  * Reads `ref` from URL → polls `/api/order-status?ref=...`
  * When **PAID**, shows **Download Ticket** → `/api/ticket?ref=...`
* **Ticket** (`/api/ticket`):

  * Verifies the payment exists
  * Generates an A5 PDF with a QR (contains `ref`, name, email, phone, qty)

---

## Admin tools (optional but useful)

* **Export CSV** of paid attendees:
  `/api/admin-export?key=<ADMIN_KEY>`
* **Check-in page** (`public/scan.html`):
  Paste or scan `ref` → prompts for **ADMIN\_KEY** → calls `/api/checkin?ref=...&key=...`

---

## Testing

1. Set `CASHFREE_ENV=sandbox` and sandbox keys.
2. Go to your site → pick a tier + qty → **Register**
3. You should be redirected to **Cashfree’s hosted page**.
4. Complete a sandbox payment → Cashfree returns to `/success.html?ref=...`
5. When the webhook arrives, the success page shows **Download Ticket**.

---

## Go live

* Switch `CASHFREE_ENV=production` and set live keys in Netlify
* Update `config/event.json` dates/prices if needed
* Re-deploy, test a small real transaction

---

## Troubleshooting

* **Netlify build fails: “Secrets scanning found secrets in build”**
  Add `SECRETS_SCAN_OMIT_KEYS` / `SECRETS_SCAN_OMIT_PATHS` (see above), or set `SECRETS_SCAN_ENABLED=false`.
  Also ensure you did **not** commit any real secrets to the repo.

* **Webhook 401 / Invalid signature**
  Make sure you compute HMAC **over the raw body** and compare to `x-webhook-signature`. Confirm `CASHFREE_SECRET_KEY` matches the environment (sandbox vs production).

* **Ticket says “Payment not confirmed”**
  Webhook might be delayed. The success page polls `/api/order-status`. If it never turns **PAID**, check Cashfree dashboard and your `/api/cashfree-webhook` logs.

* **Inventory mismatch**
  We count only **paid** orders when computing availability. If you change tiers/quantities in `event.json`, re-deploy.

---

## Appendix: using **PG Orders** instead (optional)

If your repo uses `cashfree-create-order.js` (PG Orders + hosted checkout via session) instead of `create-payment-link.js`, the flow is similar:

* Frontend calls `/api/cashfree-create-order` → gets a **payment session**
* You open Cashfree’s **hosted checkout** (SDK) rather than redirecting to a link
* Webhook + order status + ticket endpoints remain the same idea
* Success URL will have `order_id` instead of `ref` — adjust success page & status endpoint accordingly

Only keep **one** flow in production to avoid confusion.

---

**That’s it.** With this README and your current code, you should be able to deploy cleanly, pass Netlify’s scanner, and run the **redirect to Cashfree** ticketing flow end-to-end.
