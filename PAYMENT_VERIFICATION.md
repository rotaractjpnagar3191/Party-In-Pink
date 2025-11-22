# Payment Verification System (verify_pay Integration)

## Overview

The Party In Pink payment system now includes comprehensive payment verification using Cashfree's `verify_pay` feature. This ensures that:

1. **Webhook spoofing is prevented** - We verify payments directly with Cashfree API
2. **Tickets are never issued for failed payments** - Multiple validation layers
3. **Duplicate payments are detected** - Idempotency checks prevent double-issuance
4. **Order state is always accurate** - Real-time verification before ticket issuance

---

## Payment Flow with Verification

### 1. Order Creation (`/api/create-order`)

```
┌─────────────────────────────────────┐
│  User submits registration form      │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Check for existing unfulfilled     │
│  order (email + type + amount)      │
└──────────────┬──────────────────────┘
               │
        ┌──────┴──────┐
        │             │
   Found    Not Found
        │             │
        ▼             ▼
   Verify        Create New
   Payment       Cashfree Order
        │             │
        │        ┌────▼─────┐
        │        │ Save to   │
        │        │ GitHub    │
        │        └────┬─────┘
        │             │
        └──────┬──────┘
               │
               ▼
    ┌──────────────────────┐
    │ Return payment link/ │
    │ session ID to client │
    └──────────────────────┘
```

**Key Features:**
- ✅ Idempotency: Same email+type+amount returns existing order
- ✅ Payment verification before reuse
- ✅ Order saved to GitHub for webhook matching

---

### 2. Cashfree Payment Processing

User goes to Cashfree hosted payment page:

```
┌──────────────────────────────────┐
│  User enters payment details      │
│  (card, UPI, netbanking, etc)    │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  Cashfree processes payment      │
└──────────────┬───────────────────┘
               │
        ┌──────┴──────────┐
        │                 │
      SUCCESS           FAILED
        │                 │
        ▼                 ▼
    Webhook         Webhook or
    Callback        User redirect
    (via POST)      to cancel.html
        │
        └────────────────┘
```

---

### 3. Webhook Processing with verify_pay (`/api/cf-webhook`)

```
┌─────────────────────────────────────────┐
│  Cashfree webhook arrives (POST)        │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  1. Verify signature (HMAC-SHA256)      │
│     - Check x-webhook-signature         │
│     - Validate timestamp                │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  2. Check payment status = SUCCESS      │
│     - Reject if PENDING/FAILED          │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  3. API CALL: Verify with Cashfree API │
│     GET /pg/orders/{order_id}          │
│     - Verify order exists               │
│     - Verify amount matches             │
│     - Check successful payment exists   │
│     - Validate payment amount           │
└──────────────┬──────────────────────────┘
               │
        ┌──────┴───────────┐
        │                  │
    Verified         Failed Verify
        │                  │
        ▼                  ▼
    Load order         Mark as failed
    from GitHub        & return 200
        │
        ▼
    Issue Tickets
    (via KonfHub)
        │
        ▼
    Save fulfillment
    to GitHub
```

**Verification Checks:**

```javascript
✅ Order ID matches payload
✅ Amount matches (tolerance: 1 paisa)
✅ Order has at least 1 successful payment
✅ Payment amount matches order amount
✅ Settlement/payment not disputed
```

---

## Verification Endpoints

### 1. Webhook Verification (Internal)

**Function:** `verifyPaymentWithCashfree()` in `cf-webhook.js`

**What it does:**
- Queries Cashfree `/pg/orders/{order_id}` endpoint
- Validates all payment details
- Returns verification result

**Called by:**
- Webhook handler (automatic on each webhook)
- Finalize-order endpoint (fallback verification)

**Example Flow:**
```
Webhook arrives → Signature verified → Verify with Cashfree API → Issue tickets
```

---

### 2. Order Creation Verification (Internal)

**Function:** `verifyExistingPayment()` in `create-order.js`

**What it does:**
- Called when reusing existing orders
- Quick verification (8s timeout)
- Prevents issuing tickets for unverified payments

**Called by:**
- Create-order endpoint (when reusing order)

**Example:**
```
User submits form → Check for existing order → Verify payment → Reuse if valid
```

---

### 3. Frontend Payment Verification Endpoint

**Endpoint:** `GET /api/verify-payment?order_id=pip_xxxxx`

**What it does:**
- Called from success.html before polling
- Frontend can verify payment status immediately
- Provides payment details and settlement status

**Response:**
```json
{
  "ok": true,
  "order_id": "pip_1234567_abcdef",
  "order_status": "PAID",
  "has_successful_payment": true,
  "payment_details": {
    "cf_payment_id": "payment_xxxxx",
    "payment_method": "card",
    "payment_time": "2025-12-14T07:30:00Z",
    "settlement_status": "COMPLETED"
  },
  "settlement_status": "COMPLETED"
}
```

---

## Error Handling & Retry Logic

### Payment Verification Failures

| Scenario | Action | User Sees |
|----------|--------|-----------|
| Signature mismatch | Reject webhook (401) | Nothing (webhook not accepted) |
| Payment status ≠ SUCCESS | Log & skip (200) | Redirected to cancel.html |
| Amount mismatch | Fail verification, mark order | Error page with retry option |
| No successful payment found | Fail verification | Error page |
| API timeout (>10s) | Fail but log for retry | Webhook retried by Cashfree |
| Network error | Fail gracefully | Order marked for manual review |

### Frontend Error Flows

```
Payment fails/cancelled
         │
         ▼
Cashfree redirects to cancel.html
         │
         ▼
User sees "Payment Cancelled"
with options:
  - Home
  - Try Again (retry form)
         │
         ▼
User can retry registration
(same email+amount reuses order)
```

---

## Verification in Different Scenarios

### Scenario 1: Fresh Payment

```
1. User submits registration → create-order (no existing order)
2. Cashfree order created
3. Order saved to GitHub
4. User goes to payment page
5. Payment succeeds
6. Webhook arrives with SUCCESS
7. Verify with Cashfree API ✓
8. Issue tickets
9. Order marked fulfilled
```

### Scenario 2: Duplicate Submission (Same Email + Amount)

```
1. User submits registration → create-order
2. Existing unfulfilled order found
3. Verify existing payment with Cashfree ✓
4. Return same payment link
5. (If user was already paid) Webhook arrives but:
   - In-memory cache hit (prevent re-issuance)
   - OR GitHub read shows fulfilled
   - OR webhook dedup registry blocks it
```

### Scenario 3: Payment Attempt, User Cancels

```
1. User goes to Cashfree
2. User cancels payment
3. Cashfree redirects to cancel.html
4. Webhook may arrive (or may not)
5. If webhook arrives: status ≠ SUCCESS → skip
6. Order remains unfulfilled
7. User can retry (same order reused)
```

### Scenario 4: Webhook Spoofing Attempt

```
1. Attacker sends fake webhook with valid order_id
2. Signature verification fails → 401 Unauthorized
3. Webhook not processed
4. OR signature passes but:
5. Status check fails → skip
6. OR verify with Cashfree fails → marked as failed
7. Tickets NOT issued
```

---

## Deployment Checklist

### Environment Variables Required

```env
# Cashfree Configuration
CASHFREE_ENV=production|sandbox
CASHFREE_APP_ID=your_app_id
CASHFREE_SECRET_KEY=your_secret
CASHFREE_API_VERSION=2025-01-01

# Webhook Secret (optional, uses CASHFREE_SECRET_KEY if not set)
CF_WEBHOOK_SECRET=your_webhook_secret

# GitHub Storage
GITHUB_TOKEN=ghp_xxxxx
GITHUB_OWNER=rotaractjpnagar3191
GITHUB_REPO=Party-In-Pink
STORE_PATH=storage

# KonfHub Integration
KONFHUB_API_KEY=xxx
KONFHUB_EVENT_ID=xxx
```

### Cashfree Configuration

1. **In Cashfree Dashboard:**
   - Go to Settings → Webhooks
   - Set webhook URL: `https://yoursite.com/api/cf-webhook`
   - Subscribe to: `PAYMENT_SUCCESS_WEBHOOK`
   - Set webhook secret (or use app secret)

2. **Test webhook:**
   ```bash
   curl -X POST https://yoursite.com/api/cf-webhook \
     -H "x-webhook-signature: xxx" \
     -H "x-webhook-timestamp: 1234567890" \
     -d '{"data":{"order":{"order_id":"test"},...}}'
   ```

---

## Monitoring & Debugging

### Logs to Watch

**In Netlify Functions Logs:**

```
[cf-webhook] WEBHOOK INVOKED
[cf-webhook] Signature verification: Match ✓
[cf-webhook] Verifying payment with Cashfree API...
[verify-payment] Cashfree order data received
[verify-payment] ✅ PAYMENT VERIFIED
[cf-webhook] About to issue X passes
```

### Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| "Invalid signature" | Secret key mismatch | Verify `CF_WEBHOOK_SECRET` matches Cashfree |
| "No successful payment found" | Webhook for cancelled payment | Check Cashfree webhook subscriptions |
| "Amount mismatch" | Order amount vs payment amount differ | Check order creation logic |
| "Verification timeout" | Cashfree API slow | Retry webhook (Cashfree will retry automatically) |
| Tickets issued twice | Webhook dedup not working | Check `webhookRegistry` Map in code |

---

## Testing

### Manual Testing

1. **Fresh Payment:**
   - Register with new email
   - Complete payment with test card
   - Check that tickets arrive

2. **Duplicate Registration:**
   - Register again with same email + amount
   - Should reuse existing order
   - Check webhook logs for reuse message

3. **Payment Cancellation:**
   - Start registration
   - Go to payment page
   - Cancel payment
   - Should see cancel.html
   - No tickets should be issued

4. **Webhook Verification:**
   - Enable logging in webhook
   - Complete payment
   - Check logs for "Verifying payment with Cashfree API"
   - Confirm verification passed

### Automated Testing

```javascript
// Test verify-payment endpoint
const response = await fetch(
  '/api/verify-payment?order_id=pip_1234567_abc',
  { method: 'GET' }
);
const data = await response.json();
console.assert(data.ok, 'Payment verification failed');
console.assert(data.has_successful_payment, 'No successful payment');
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ register.    │  │ success.html  │  │ error.html   │      │
│  │ bulk.html    │  │ (polling)     │  │ (retry)      │      │
│  │ donate.html  │  └──────────────┘  └──────────────┘      │
│  └──────┬───────┘         ▲                  ▲               │
│         │                 │ verify-payment   │               │
│         │                 │ (check status)   │               │
└─────────┼─────────────────┼──────────────────┼───────────────┘
          │                 │                  │
          ▼                 ▼                  │
    ┌──────────────────────────────────────────────────┐
    │         Netlify Functions (Backend)              │
    │ ┌────────────────────────────────────────────┐  │
    │ │ create-order                               │  │
    │ │ - Validate input                           │  │
    │ │ - Check existing orders                    │  │
    │ │ - Verify existing payments                 │  │
    │ │ - Create new Cashfree order                │  │
    │ │ - Save to GitHub                           │  │
    │ └────────────────────────────────────────────┘  │
    │ ┌────────────────────────────────────────────┐  │
    │ │ cf-webhook (Payment Verification)          │  │
    │ │ - Verify signature (HMAC-SHA256)           │  │
    │ │ - Check payment status                     │  │
    │ │ - ✅ Verify with Cashfree API              │  │
    │ │ - Check for duplicates (memory cache)      │  │
    │ │ - Issue tickets (KonfHub)                  │  │
    │ │ - Save fulfillment to GitHub               │  │
    │ └────────────────────────────────────────────┘  │
    │ ┌────────────────────────────────────────────┐  │
    │ │ verify-payment (Check Status)              │  │
    │ │ - Query Cashfree API                       │  │
    │ │ - Return payment details                   │  │
    │ │ - Indicate successful payment              │  │
    │ └────────────────────────────────────────────┘  │
    │ ┌────────────────────────────────────────────┐  │
    │ │ finalize-order (Fallback Verification)     │  │
    │ │ - Called if webhook fails                  │  │
    │ │ - Verify payment before issuing            │  │
    │ └────────────────────────────────────────────┘  │
    └──────┬──────────────────────────────┬────────────┘
           │                              │
           ▼                              ▼
    ┌────────────────┐        ┌──────────────────────┐
    │ Cashfree API   │        │ GitHub Storage       │
    │ (verify_pay)   │        │ - Orders JSON        │
    │                │        │ - Fulfillment status │
    │ /pg/orders/:id │        │ - Webhook tracking   │
    └────────────────┘        └──────────────────────┘
           ▲                              │
           │                              ▼
           │                   ┌──────────────────────┐
           │                   │ KonfHub API          │
           └───────────────────│ - Issue passes       │
                               │ - Create registrants │
                               └──────────────────────┘
```

---

## Security Considerations

### ✅ Implemented Protections

1. **HMAC-SHA256 Signature Verification**
   - Webhook signature checked against secret
   - Timestamp validation to prevent replay

2. **API Verification (verify_pay)**
   - Direct query to Cashfree API
   - Amount validation
   - Payment status cross-check
   - Prevents webhook spoofing

3. **Idempotency**
   - In-memory webhook deduplication
   - GitHub-based persistent tracking
   - Concurrent request handling

4. **Order Validation**
   - Email + Type + Amount matching
   - Minimum quantity enforcement
   - Tier/amount range validation

5. **Ticket Issuance Guards**
   - Only issue for fulfilled orders
   - Check for duplicate registrations
   - KonfHub access code validation

---

## Future Enhancements

- [ ] Implement settlement verification (for security)
- [ ] Add dispute detection (chargebacks)
- [ ] Real-time reconciliation with Cashfree
- [ ] Admin dashboard for payment tracking
- [ ] Automated refund processing
- [ ] Email notifications for failed payments
- [ ] Payment retry scheduling

---

## Support & Contact

For payment verification issues:
- Email: rotaractjpnagar@gmail.com
- GitHub Issues: [Project Repo]
- Cashfree Support: [Cashfree Dashboard]
