# Party In Pink 4.0 - Zumba Fundraiser

A full-stack event management and ticketing platform for Party In Pink, a Zumba fundraiser supporting breast cancer awareness and treatment at Sri Shankara Cancer Hospital.

## Overview

Party In Pink is built with:
- **Frontend**: HTML5, CSS3, Vanilla JavaScript (no frameworks)
- **Backend**: Netlify Functions (Node.js on AWS Lambda)
- **Storage**: GitHub API (pip-tickets-data repo as serverless database)
- **Payments**: Cashfree v3 SDK (Indian payment gateway)
- **Ticketing**: KonfHub API (event registration and pass issuance)

## Features

### User-Facing
- 🎟 Single registration for individual participants
- 👥 Bulk registration for clubs/universities/corporate groups
- 💳 Donation tiers (Supporter, Wellwisher, Silver, Gold, Platinum, Diamond)
- 🎁 In-kind donation pathway
- 📱 Mobile-responsive design with compact form layout
- 🕐 Event countdown timer (real-time updates)
- 📧 Order status tracking by ID or email
- 🎨 Dark-themed UI with gradient effects and hero carousel
- 🔐 Secure payment processing with CSP headers

### Visual & UX Enhancements (v4.0)
- ✨ Bright hero carousel with dark tint overlay (0.5-0.7 opacity)
- 🖼️ High-contrast logo image with 40% brightness enhancement
- 📏 Compact form fields (reduced spacing: 6px gaps, 8px input padding)
- 🎯 Improved text readability with proper contrast
- 🪙 Smaller carousel navigation dots (hidden by default)

### Backend Reliability
- ✅ **3-layer webhook deduplication**: Immediate duplicate detection, processing lock, fulfillment check
- ✅ **Idempotent payment processing**: Same amount+email = reuse existing order
- ✅ **Concurrent webhook serialization**: Processing lock prevents race conditions
- ✅ **Comprehensive payment validation**: Early SUCCESS-only gate, order reconstruction validation
- ✅ **Resilient storage**: GitHub as atomic, versioned database
- ✅ **Error recovery**: Finalize endpoint fallback if webhooks are late
- ✅ **CSP Policy**: Allows Cashfree SDK frames and payment processing

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
# Cashfree Payment Gateway (v3)
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
│   ├── index.html            # Homepage with countdown & carousel
│   ├── register.html         # Single registration
│   ├── bulk.html             # Bulk registration form
│   ├── donate.html           # Donation with tiers
│   ├── status.html           # Order status tracking
│   ├── scan.html             # Check-in system
│   ├── admin.html            # Admin dashboard
│   ├── about.html            # About Rotaract
│   ├── success.html          # Post-payment page
│   ├── app.js                # Frontend logic (forms, countdown, tier display)
│   ├── utils.js              # Utility functions
│   ├── styles.css            # All styling (responsive design)
│   ├── manifest.json         # PWA manifest
│   └── assets/logos/         # Brand logos (4.0 Logos.png)
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
├── netlify.toml              # Netlify config with CSP headers
└── README.md                 # This file
```

## Recent Updates (v4.0)

### Visual Enhancements
- **Logo Replacement**: Updated from `PiP_Black.png` to `4.0 Logos.png` (27 instances across all files)
- **Hero Carousel**: Added dark tint overlay (50-70% opacity) for better text contrast
- **Logo Brightness**: Enhanced logo brightness (1.4x) for visibility on dark backgrounds
- **Carousel Dots**: Removed navigation dots for cleaner interface
- **Form Compactness**: Reduced margins and padding for tighter form layouts
  - Form gaps: 6px (was 8px)
  - Form margins: 6px between groups (was 12px)
  - Input padding: 8px (was 12px)
  - Label spacing: 3px (was 6px)

### Security Fixes
- **CSP Headers**: Updated `netlify.toml` to allow Cashfree SDK frames
  - Added `https://sdk.cashfree.com` to `frame-src`
  - Added `https://sandbox.cashfree.com` to `frame-src`
  - Matches Cashfree v3 SDK requirements

### Payment System
- **Cashfree SDK v3**: Integrated official SDK from `https://sdk.cashfree.com/js/v3/cashfree.js`
- **Phone Validation**: Updated regex pattern to `(\+?91[6-9]\d{9}|0[6-9]\d{9})` for HTML5 compatibility
- **Payment Pages**: register.html, bulk.html, donate.html all updated with CSP meta tags

## API Endpoints

### User APIs

#### POST `/api/create-order`
Create a payment order for registration or donation.

**Request:**
```json
{
  "type": "bulk",
  "name": "Club Name",
  "email": "contact@club.com",
  "phone": "9876543210",
  "club_type": "COMMUNITY",
  "quantity": 12,
  "club_name": "XYZ Club",
  "custom_amount": 5000
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
  "pending": 2
}
```

#### GET `/api/admin-export?key=...`
Export all orders as CSV file.

#### POST `/api/admin-resend?key=...`
Resend email for a specific order.

#### POST `/api/finalize-order`
Fallback to trigger pass issuance if webhook failed.

## Payment Flow

### User Journey
```
1. User fills form (register/bulk/donate page)
   ↓
2. Form validation (phone, email, amounts)
   ↓
3. POST /api/create-order
   ↓
4. Cashfree payment link returned
   ↓
5. User redirected to Cashfree checkout (SDK v3)
   ↓
6. Payment completion
   ↓
7. Cashfree webhook → /api/cf-webhook
   ↓
8. Webhook validation & KonfHub pass issuance
   ↓
9. Order saved to GitHub storage
   ↓
10. Email sent with tickets
    ↓
11. User checks status at status.html
```

### Webhook Deduplication
- **Layer 1**: In-memory registry (immediate detection)
- **Layer 2**: GitHub processing lock (prevents concurrent processing)
- **Layer 3**: Fulfillment check (only issue if not already fulfilled)

## Donation Tier System

| Amount | Tier | Passes | Benefits |
|--------|------|--------|----------|
| ₹1,000–4,999 | Supporter | 1 | Event pass, certificate |
| ₹5,000–9,999 | Wellwisher | 2 | Event passes, donor recognition |
| ₹10,000–14,999 | Silver | 5 | Major donor recognition, logo on backdrop |
| ₹15,000–19,999 | Gold | 7 | Silver benefits + stage time |
| ₹20,000–24,999 | Platinum | 7 | Gold benefits + extended stage time |
| ₹25,000+ | Diamond | 10 | Exclusive partnership & VIP recognition |

## Frontend Features

### Countdown Timer
- Displays days/hours/minutes/seconds until December 14, 2025, 7:30 AM
- Real-time updates every second
- Event date hardcoded (not dynamic)

### Donation Tiers
- Real-time pass calculation based on amount
- Tier name display
- Benefit preview

### Form Validation
- Phone: Indian mobile format `(\+?91[6-9]\d{9}|0[6-9]\d{9})`
- Email: Standard email validation
- Real-time error messages
- localStorage persistence

### Responsive Design
- Mobile-first approach
- Breakpoints: 768px, 560px
- Touch-friendly inputs
- Optimized carousel on mobile

## Security

### Content Security Policy
The following CSP is enforced via `netlify.toml`:

```
frame-src: https://konfhub.com, https://*.forms.app, https://sdk.cashfree.com, https://sandbox.cashfree.com
script-src: 'self', 'unsafe-inline', https://sdk.cashfree.com, https://forms.app
connect-src: 'self', https://api.konfhub.com, https://sandbox.cashfree.com, https://api.cashfree.com, https://sdk.cashfree.com
style-src: 'self', 'unsafe-inline', https://fonts.googleapis.com, https://sdk.cashfree.com
```

### Payment Security
- Cashfree PCI-DSS certified
- HTTPS enforced site-wide
- No sensitive data stored locally
- Admin operations require API key

## Troubleshooting

### CSP Frame Errors (Cashfree Payment Not Loading)
- **Issue**: "Framing violates CSP directive: frame-src"
- **Fix**: Verify `netlify.toml` includes Cashfree domains in `frame-src`
- **Verify**: Check browser DevTools → Network → cf-webhook requests

### Payment Webhooks Not Received
- Check Netlify function logs
- Verify Cashfree webhook URL is correct
- Confirm `CASHFREE_APP_ID` and `CASHFREE_SECRET_KEY`

### Orders Not Appearing
- Verify `pip-tickets-data` GitHub repo exists
- Check `GITHUB_TOKEN` has `repo` scope
- Ensure `storage` folder exists in repo

### Check-in System Issues
- Verify admin key is set
- Confirm order exists and is fulfilled
- Check `/scan.html` loads properly

## Testing Checklist

- [ ] Single registration form submission
- [ ] Bulk registration (min passes validation)
- [ ] Donation tier selection
- [ ] Payment flow to Cashfree
- [ ] Webhook received and processed
- [ ] Order lookup by ID and email
- [ ] Admin stats endpoint
- [ ] Check-in system
- [ ] Mobile responsiveness (countdown, forms, carousel)
- [ ] Logo displays correctly on all pages

## Performance Notes

- KonfHub API timeout: 20 seconds (for batch operations)
- GitHub API: ~100-200ms per request
- Countdown timer: 1 update per second (minimal CPU)
- Webhook processing: <5 seconds average
- Form submission: <10 seconds (including payment link generation)

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari 14+, Chrome Mobile)

## Contact & Support

- **Email**: rotaractjpnagar@gmail.com
- **WhatsApp**: +91 8310398636
- **Website**: https://www.rotaractjpnagar.org

## License

© 2025 Rotaract Club of Bangalore JP Nagar. All rights reserved.

---

**Last Updated**: November 25, 2025  
**Event Date**: December 14, 2025, 7:30 AM @ SSMRV College, Bangalore  
**Status**: Production Ready ✅
