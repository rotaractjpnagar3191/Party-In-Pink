# Party In Pink 4.0 - Zumba Fundraiser

A full-stack event management and ticketing platform for Party In Pink, a Zumba fundraiser supporting breast cancer awareness and treatment at Sri Shankara Cancer Hospital.

## Overview

Party In Pink is built with:
- **Frontend**: HTML5, CSS3, Vanilla JavaScript (no frameworks)
- **Backend**: Netlify Functions (Node.js on AWS Lambda)
- **Storage**: GitHub API (pip-tickets-data repo as serverless database)
- **Payments**: Cashfree (Indian payment gateway)
- **Ticketing**: KonfHub API (event registration and pass issuance)

## Features

### User-Facing
- 🎟 Single registration for individual participants
- 👥 Bulk registration for clubs/universities/corporate groups
- 💳 Donation tiers (Supporter, Wellwisher, Silver, Gold, Platinum, Diamond)
- 🎁 In-kind donation pathway
- 📱 Mobile-responsive design
- 🕐 Event countdown timer (real-time updates)
- 📧 Order status tracking by ID or email
- 🎨 Beautiful dark-themed UI with gradient effects
- 🔐 Secure payment processing

### Backend Reliability
- ✅ **3-layer webhook deduplication**: Immediate duplicate detection, processing lock, fulfillment check
- ✅ **Idempotent payment processing**: Same amount+email = reuse existing order
- ✅ **Concurrent webhook serialization**: Processing lock prevents race conditions
- ✅ **Comprehensive payment validation**: Early SUCCESS-only gate, order reconstruction validation
- ✅ **Resilient storage**: GitHub as atomic, versioned database
- ✅ **Error recovery**: Finalize endpoint fallback if webhooks are late

### Admin Features
- 📋 Order check-in system with QR support
- 📊 Order status search (by ID or email)
- 📈 Admin dashboard with stats and exports
- 🔍 Comprehensive logging throughout

## Quick Start

### Prerequisites
- Node.js 14+
- Git
- Netlify CLI (for local testing)
- GitHub account with PAT (Personal Access Token)

### Environment Variables

Create a `.env.local` file in the Netlify functions context (or set in Netlify dashboard):

```env
# Cashfree Payment Gateway
CASHFREE_ENV=sandbox
CASHFREE_APP_ID=your_cashfree_app_id
CASHFREE_SECRET_KEY=your_cashfree_secret_key
CASHFREE_API_VERSION=2025-01-01

# GitHub Storage (pip-tickets-data repo)
GITHUB_TOKEN=your_github_pat_with_repo_scope
GITHUB_OWNER=rotaractjpnagar3191
GITHUB_REPO=pip-tickets-data
GITHUB_BRANCH=main
STORE_PATH=storage

# KonfHub Ticketing
KONFHUB_API_KEY=your_konfhub_api_key
KONFHUB_EVENT_ID=your_public_event_id
KONFHUB_EVENT_ID_INTERNAL=your_internal_event_id
KONFHUB_FREE_TICKET_ID=public_ticket_id
KONFHUB_BULK_TICKET_ID=bulk_ticket_id
KONFHUB_INTERNAL_FREE_TICKET_ID=internal_ticket_id
KONFHUB_INTERNAL_BULK_TICKET_ID=internal_bulk_ticket_id

# Event Configuration
SITE_URL=https://pip.rotaractjpnagar.org
BULK_PRICE=199
COMM_MIN=12
UNIV_MIN=20
SLABS=5000:2,10000:5,15000:7,20000:7,25000:10
SLAB_ABOVE_MAX=TOP

# Email (optional, for receipts)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
FROM_EMAIL=tickets@rotaractjpnagar.org
REPLY_TO=support@rotaractjpnagar.org

# Admin Key (for admin operations)
ADMIN_KEY=your_secret_admin_key_here
```

### Local Development

```bash
# Install dependencies
npm install

# Start Netlify dev server (includes functions)
netlify dev

# Visit http://localhost:8888
```

### Deployment

```bash
# Deploy to Netlify
netlify deploy --prod

# Or push to GitHub (if connected to Netlify)
git push origin main
```

## Project Structure

```
.
├── public/                    # Static assets & HTML
│   ├── index.html            # Homepage with countdown
│   ├── register.html         # Single registration
│   ├── bulk.html             # Bulk registration form
│   ├── donate.html           # Donation with tiers
│   ├── status.html           # Order status tracking
│   ├── scan.html             # Check-in system
│   ├── admin.html            # Admin dashboard
│   ├── about.html            # About Rotaract
│   ├── success.html          # Post-payment page
│   ├── app.js                # Frontend logic (forms, countdown, tier display)
│   └── styles.css            # All styling
├── netlify/functions/        # Backend APIs
│   ├── cf-webhook.js         # Cashfree webhook handler (CRITICAL)
│   ├── create-order.js       # Create orders + Cashfree link
│   ├── finalize-order.js     # Fallback issuance endpoint
│   ├── order-status.js       # Order lookup API
│   ├── checkin.js            # Check-in endpoint
│   ├── admin-stats.js        # Get order statistics
│   ├── admin-export.js       # Export orders to CSV
│   ├── admin-resend.js       # Resend emails for orders
│   ├── _config.js            # Config parsing & helpers
│   ├── _github.js            # GitHub API wrapper
│   ├── _konfhub.js           # KonfHub ticketing API
│   └── [other functions]     # Other endpoints
├── config/
│   └── event.json            # Event configuration
└── README.md                 # This file
```

## API Endpoints

### User APIs

#### POST `/api/create-order`
Create a payment order for registration or donation.

**Request:**
```json
{
  "type": "bulk",  // "bulk", "donation"
  "name": "Club Name",
  "email": "contact@club.com",
  "phone": "9876543210",
  "club_type": "COMMUNITY",  // For bulk: "COMMUNITY", "UNIVERSITY"
  "quantity": 12,  // For bulk registration
  "club_name": "XYZ Club",
  "custom_amount": 5000  // For donations
}
```

**Response:**
```json
{
  "order_id": "pip_1234567890_abc123",
  "cf_env": "sandbox",
  "payment_link": "https://payments.cashfree.com/...",
  "payment_session_id": "..."
}
```

#### GET `/api/config`
Get public configuration (tiers, minimums, etc).

#### GET `/api/order-status?q=order_id_or_email`
Look up order by ID or email.

**Response:**
```json
{
  "ok": true,
  "order": {
    "order_id": "pip_...",
    "type": "donation",
    "name": "John Doe",
    "email": "john@example.com",
    "amount": 5000,
    "passes": 2,
    "created_at": "2025-11-21T15:30:00.000Z",
    "fulfilled": {
      "status": "ok",
      "count": 2,
      "at": "2025-11-21T15:35:00.000Z"
    }
  }
}
```

#### POST `/api/checkin?order_id=...&key=...`
Mark an order as checked in at the event.

### Admin APIs

#### GET `/api/admin-stats?key=...`
Get overall order statistics.

**Response:**
```json
{
  "total_orders": 127,
  "total_raised": 450000,
  "bulk_registrations": 42,
  "individual_donations": 85,
  "passed": 234,
  "failed": 5,
  "pending": 2,
  "by_tier": {
    "supporter": 15,
    "wellwisher": 28,
    "silver": 22,
    "gold": 12,
    "platinum": 5,
    "diamond": 3
  }
}
```

#### GET `/api/admin-export?key=...`
Export all orders as CSV file.

#### POST `/api/admin-resend?key=...`
Resend email for a specific order.

```json
{ "order_id": "pip_..." }
```

#### POST `/api/finalize-order`
Fallback to trigger pass issuance if webhook failed.

```json
{ "order_id": "pip_..." }
```

## Payment & Webhook Flow

### Payment Lifecycle

```
1. User fills form on register.html / bulk.html / donate.html
   ↓
2. POST /api/create-order
   ↓
3. Returns Cashfree payment link
   ↓
4. User makes payment on Cashfree
   ↓
5. Cashfree sends SUCCESS webhook to /api/cf-webhook
   ↓
6. Webhook validates payment, issues KonfHub passes, saves order to GitHub
   ↓
7. User receives email with tickets
   ↓
8. User can check status at /status.html anytime
```

### Webhook Deduplication

Cashfree retries webhooks up to 4+ times. We prevent duplicate issuance via:

1. **Immediate Registry**: Check `webhookRegistry` (in-memory, survives Lambda context reuse)
2. **Processing Lock**: Set `processing.status='in_progress'` in GitHub, return 202 if already processing
3. **Fulfillment Check**: Only issue if `fulfilled.status !== 'ok'`

### Error Handling

- **Payment fails**: Order saved with `fulfilled.status='failed'`, user can retry
- **KonfHub timeout**: Marked as failed, can be retried via `/api/finalize-order`
- **GitHub unavailable**: Return 200 (don't retry), webhook will reconstruct from Cashfree data
- **All validation failures**: Comprehensive logging, admin can investigate

## Donation Tier System

Tiers are dynamically calculated from amount:

| Amount | Tier | Passes | Benefits |
|--------|------|--------|----------|
| ₹1,000–4,999 | Supporter | 1 | Event pass, certificate |
| ₹5,000–9,999 | Wellwisher | 2 | Event passes, donor recognition |
| ₹10,000–14,999 | Silver | 5 | Major donor recognition, logo on backdrop |
| ₹15,000–19,999 | Gold | 7 | Silver benefits + stage time + MC mention |
| ₹20,000–24,999 | Platinum | 7 | Gold benefits + 5min stage time |
| ₹25,000+ | Diamond | 10 | Exclusive partnership & VIP recognition |

**Sponsors**: Donors with logos on backdrop (Silver tier and above).

## Frontend Features

### Countdown Timer (index.html)
- Displays days/hours/minutes/seconds until December 14, 2025, 7:30 AM
- Updates every second in real-time
- Event date is fixed (not dynamic from config)

### Donation Tiers
- Tier selector in donate.html
- Real-time pass calculation
- Benefit preview showing what you'll get
- Tier name display instead of "CUSTOM"

### Form Validation
- Phone number pattern validation (Indian mobile)
- Email validation
- Real-time error messages
- localStorage persistence for partial form data

### Responsive Design
- Mobile-first CSS
- Breakpoints: 768px, 560px
- Touch-friendly buttons and inputs
- Optimized font sizing

## Security

### Payment Security
- Cashfree PCI-DSS certified
- HTTPS enforced
- CSP headers configured in netlify.toml
- No payment data stored locally (only order IDs)

### Data Protection
- GitHub as secure, versioned storage
- Sensitive data redacted in API responses (payment links, tokens)
- Admin operations require API key authentication

### Error Handling
- No stack traces exposed to clients
- Detailed logging server-side for debugging
- Graceful failures (return 200 instead of 500 when possible)

## Troubleshooting

### Payment webhooks not received
1. Check Netlify function logs: `netlify functions:create` or dashboard
2. Verify Cashfree webhook URL: `https://[site]/api/cf-webhook`
3. Verify `CASHFREE_APP_ID` and `CASHFREE_SECRET_KEY` are correct

### Orders not appearing
1. Check GitHub repo exists: `pip-tickets-data`
2. Verify `GITHUB_TOKEN` has `repo` scope
3. Check `STORE_PATH` = `storage` folder exists in repo
4. View order status at `/status.html` using order ID

### Passes not issuing to KonfHub
1. Verify `KONFHUB_API_KEY` and `KONFHUB_EVENT_ID_INTERNAL`
2. Check KonfHub webhook URL is set correctly
3. Verify ticket IDs match: `KONFHUB_FREE_TICKET_ID` vs `KONFHUB_BULK_TICKET_ID`
4. Try `/api/finalize-order` with order ID to retry

### Check-in system not working
1. Admin key is required (set in Netlify env if using)
2. Order ID must exist and be fulfilled
3. Check `/scan.html` loads properly
4. Verify `/api/checkin` endpoint is accessible

## Testing

### Manual Testing Checklist
- [ ] Create order for single registration
- [ ] Create order for bulk registration (minimum passes)
- [ ] Create donation order (each tier)
- [ ] Complete payment flow to Cashfree
- [ ] Verify webhook received and order fulfilled
- [ ] Check status.html for order (by ID, by email)
- [ ] Download tickets from KonfHub emails
- [ ] Test check-in at /scan.html
- [ ] Access admin dashboard at /admin.html

### Webhook Testing
```bash
# Simulate webhook (manual)
curl -X POST http://localhost:8888/api/cf-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "type":"PAYMENT_SUCCESS_WEBHOOK",
    "data":{
      "order":{"order_id":"pip_test123","order_amount":5000},
      "payment":{"payment_status":"SUCCESS","upi_id":"..."}
    }
  }'
```

## Performance Notes

- KonfHub API timeout: 20 seconds (bulk registrations with 12+ attendees need time)
- GitHub API: ~100-200ms per request
- Countdown timer updates every second (minimal CPU impact)
- Webhook deduplication prevents duplicate processing
- All data cached in memory where appropriate

## Future Enhancements

- [ ] Batch attendee name collection for bulk registrations
- [ ] Real-time analytics dashboard with charts
- [ ] Email receipts for donations (80G deduction info)
- [ ] Multi-language support (Kannada, Hindi, Tamil)
- [ ] Advanced analytics (conversion funnel, traffic sources)
- [ ] Sponsor tier management UI
- [ ] Advanced QR code scanning on /scan.html
- [ ] Event date as dynamic config (instead of hardcoded)

## Contact & Support

- **Email**: rotaractjpnagar@gmail.com
- **WhatsApp**: +91 8310398636
- **Website**: https://www.rotaractjpnagar.org

## License

© 2025 Rotaract Club of Bangalore JP Nagar. All rights reserved.

## Contributors

- **Frontend & Backend**: Full-stack development team
- **Payments**: Cashfree integration
- **Ticketing**: KonfHub partnership
- **Event Management**: Rotaract JP Nagar volunteers

---

**Last Updated**: November 21, 2025
**Event Date**: December 14, 2025, 7:30 AM @ SSMRV College, Bangalore
**Status**: Production Ready
