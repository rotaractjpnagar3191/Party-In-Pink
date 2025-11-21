# Edge Cases & Failure Scenarios - Implementation Guide

## 1. SESSION TIMEOUT (30 minutes inactivity)

### Implementation
- **Where**: `app.js` - Session timeout tracking
- **Behavior**: User redirected to `timeout.html` after 30 minutes of inactivity
- **User Activity Tracking**: Detects mousedown, keydown, scroll, touchstart events
- **Recovery**: User can resume registration, form data saved to sessionStorage

### URLs
- **Timeout page**: `timeout.html`
- **Query params**: `?from=register.html` (redirects back to original page)

### Code Locations
```
public/app.js - Lines 3-42 (SESSION_TIMEOUT logic)
public/timeout.html - Session resume mechanism
```

---

## 2. PAYMENT FAILURE / CANCELLATION

### Scenarios Handled
1. **User Cancels Payment** → Redirected to `cancel.html`
2. **Payment Gateway Timeout** → Redirected to `error.html?code=TIMEOUT`
3. **Invalid Payment Details** → Redirected to `error.html?code=PAYMENT`
4. **Network Error During Payment** → Redirected to `error.html?code=NETWORK`

### Implementation
- **Frontend**: `cancel.html` page with contextual messaging
- **Cashfree Config**: `create-order.js` includes `cancel_url` in order payload
- **Status**: No charges made, order not fulfilled

### URLs
- **Cancel page**: `cancel.html?order={ORDER_ID}&type={bulk|donation}&email={EMAIL}`
- **Error page**: `error.html?code={CODE}&msg={MESSAGE}&from={PREV_PAGE}`

### Error Codes
```
TIMEOUT    - Request took too long
NETWORK    - Connection failed  
SERVER     - 5xx errors
VALIDATION - Invalid form data (400/422)
PAYMENT    - Payment gateway error (402)
DUPLICATE  - Order already exists
UNKNOWN    - Other errors
```

---

## 3. NETWORK ERRORS & OFFLINE MODE

### Detection
```javascript
// Real-time network status
window.addEventListener('offline', () => { /* handle */ });
window.addEventListener('online', () => { /* handle */ });

// In postJSON
if (!navigator.onLine) {
  throw new Error('Offline - check internet');
}
```

### User Experience
- **When Offline**: Error page shows network status message
- **Auto-Retry**: Available retry button when connection restored
- **Storage**: Form data persisted to sessionStorage before submission

### Files
- `app.js` - Network detection & postJSON handling
- `error.html` - Network status display

---

## 4. REQUEST TIMEOUTS

### Timeout Values
- **Payment Service**: 15 seconds (create-order, payment-link)
- **Poll/Status Checks**: 10 seconds  
- **Webhook Processing**: 10-15 seconds

### Implementation (AbortController)
```javascript
const abortController = new AbortController();
const timeoutId = setTimeout(() => abortController.abort(), 15000);
try {
  await fetch(url, { signal: abortController.signal });
} finally {
  clearTimeout(timeoutId);
}
```

### User Feedback
- Shows timeout message → Directs to `error.html?code=TIMEOUT`
- Suggests retry or contact support

### Files
- `app.js` - postJSON with AbortController
- `create-order.js` - Cashfree API timeout handling
- `finalize-order.js` - Increased timeouts (15s)

---

## 5. DUPLICATE ORDERS (IDEMPOTENCY)

### Problem
User submits form twice → Two orders created → Two payments required

### Solution
```javascript
// In create-order.js
const existingOrder = await findExistingOrder(ENV, email, type, amount);
if (existingOrder && existingOrder.cashfree?.data?.payment_session_id) {
  return { order_id, reused: true, payment_session_id };
}
```

### Logic
1. Search for unfullfilled order with same email + type + amount
2. If found and has valid payment_session_id → Reuse it
3. If found but fulfilled → Create new order
4. Otherwise → Create new order

### Also Prevents
- Webhook replays (processed_webhooks tracking)
- In-memory cache (10 second window)
- Processing locks (concurrent issuance prevention)

### Files
- `create-order.js` - findExistingOrder() function
- `cf-webhook.js` - Duplicate webhook detection

---

## 6. WEBHOOK FAILURES & RETRIES

### Scenarios
1. **Webhook Timeout** → Cashfree retries up to 5 times
2. **GitHub API Failure** → Order reconstruction from webhook payload
3. **KonfHub API Failure** → Mark as partial fulfillment, manual recovery

### Recovery Mechanisms
```javascript
// Webhook deduplication
const webhookKey = `${order_id}:${ts}:${sig}`;
webhookRegistry.set(webhookKey, Date.now()); // In-memory cache

// Processing lock
oc.processing = { status: 'in_progress', ... };
// Prevents concurrent webhooks from re-issuing

// Order reconstruction
if (!oc) {
  oc = reconstructFromWebhookPayload(data);
}
```

### Critical Checks
- ✓ Signature verification (HMAC-SHA256)
- ✓ Status check (only SUCCESS triggers issuance)
- ✓ Concurrent issuance prevention
- ✓ In-memory & GitHub-level deduplication

### Files
- `cf-webhook.js` - Main webhook handler with safety checks

---

## 7. FORM STATE PERSISTENCE

### On Submission
```javascript
// Save to sessionStorage before calling API
sessionStorage.setItem('pip_bulk_form', JSON.stringify(payload));
sessionStorage.setItem('pip_donate_form', JSON.stringify(payload));
```

### On Session Resume
```javascript
// timeout.html has "Resume Registration" button
// Sets: sessionStorage.setItem('pip_resume_session', 'true')

// Form can check and restore:
if (sessionStorage.getItem('pip_resume_session') === 'true') {
  const form = JSON.parse(sessionStorage.getItem('pip_bulk_form'));
  // Auto-fill fields
}
```

### Storage Keys
- `pip_bulk_form` - Bulk registration data
- `pip_donate_form` - Donation data
- `pip_last_email` - Last used email
- `pip_last_page` - Breadcrumb for navigation
- `pip_resume_session` - Session resume flag
- `pip_offline_at` - Offline timestamp

---

## 8. POLLING & PASS ISSUANCE

### Success Page Flow
```
1. Redirect to success.html?order={ORDER_ID}
2. Start polling /api/order-status?id={ORDER_ID}
3. Poll every 2 seconds, up to 60 times (2 minutes)
4. Show progress overlay with pass count
5. On completion (fulfilled.status = 'ok' or 'partial') → Hide overlay
6. On timeout → Show manual message "Check email"
```

### Polling States
- **Pending**: "Dispatching passes... (status=pending)"
- **Processing**: "Processing... (20s elapsed)"
- **Completed**: "Tickets issued" (overlay removed)
- **Timeout**: "Processing may take a few moments. Check email."

### Files
- `success.html` - Polling script with overlay
- `order-status.js` - Backend status endpoint

---

## 9. ORDER STATUS TRACKING

### User Access
- **URL**: `/status.html` (searchable order tracking page)
- **Search By**: Order ID (pip_*) or Email address
- **Shows**:
  - Payment received ✓
  - Processing status (in progress/complete)
  - Pass delivery status
  - Order details (amount, passes, recipients)

### Endpoint
- **GET** `/api/order-status?id={QUERY}`
- **Response**: { ok, order: {...} }
- **Error**: 404 if not found, 500 if storage issue

### Files
- `public/status.html` - Status tracking UI
- `netlify/functions/order-status.js` - Backend endpoint

---

## 10. ERROR PAGE FLOWS

### Error Pages
1. **error.html** - General errors (timeout, network, server)
2. **cancel.html** - Payment cancelled
3. **timeout.html** - Session expired
4. **success.html** - Success with polling

### Error Page Features
- ✓ Network status detection (online/offline badge)
- ✓ Error code display (for debugging)
- ✓ Contextual help text
- ✓ Retry button with history back
- ✓ Contact information
- ✓ Home button fallback

### Navigation
```
register.html → error.html?code=NETWORK
            ↓
        [Retry] → Tries history.back()
                  Falls back to register.html
```

---

## 11. GLOBAL ERROR HANDLERS

### Window Error Events
```javascript
// Uncaught exceptions
window.addEventListener('error', (event) => {
  sessionStorage.setItem('pip_last_error', {...});
});

// Unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  sessionStorage.setItem('pip_last_error', {...});
});
```

### Prevented Pages
Error handlers skip: `error.html`, `timeout.html`, `cancel.html`, `success.html`
(to avoid redirect loops)

### Files
- `app.js` - Lines 45-65 (Global error handlers)

---

## 12. PAYMENT GATEWAY INTEGRATION

### Cashfree Order Creation
```javascript
// POST /api/create-order
POST https://sandbox.cashfree.com/pg/orders

Payload includes:
- cancel_url: "https://site/cancel.html?order={ID}"
- return_url: "https://site/success.html?order={ID}"
- notify_url: "https://site/api/cf-webhook" (async notification)
```

### Payment Outcomes
1. **Successful** → Webhook to cf-webhook → Tickets issued
2. **Cancelled** → Redirect to cancel_url
3. **Failed** → Redirect to cancel_url
4. **Timeout** → Frontend timeout handling

### Webhooks
- **Signature**: HMAC-SHA256(timestamp + rawBody)
- **Status Check**: Only "SUCCESS" triggers issuance
- **Retry**: Cashfree retries up to 5 times
- **Deduplication**: timestamp + signature based

### Files
- `create-order.js` - Order creation
- `cf-webhook.js` - Webhook handler

---

## 13. TESTING ERROR SCENARIOS

### Manual Testing Checklist

```bash
# 1. Timeout Simulation
- Open DevTools → Throttle to "EDGE"
- Submit form → Should timeout after 15s
- Redirect to error.html?code=TIMEOUT

# 2. Offline Mode
- DevTools → Network → Offline
- Try submitting form
- Should show: "You are offline"

# 3. Session Timeout
- Open register.html
- Wait 30 minutes without interaction
- Auto-redirect to timeout.html

# 4. Duplicate Order
- Submit registration
- Before redirect, hit submit again (before webhook)
- System should reuse payment link

# 5. Webhook Retry
- Trigger payment
- Kill webhook manually
- Cashfree will retry → Should eventually succeed

# 6. Order Status Page
- Go to /status.html
- Enter order ID from email
- Should show pass distribution status

# 7. Cancel Payment
- Start payment
- Hit "Cancel" in Cashfree checkout
- Redirect to cancel.html

# 8. Browser Refresh on Success Page
- Payment completes → success.html
- Browser refresh (F5)
- Should restore polling state (continue checking)

# 9. Multiple Webhooks
- Manual Webhook trigger twice
- Should only issue passes once (deduplication)

# 10. Form Restore After Timeout
- Fill bulk registration form
- Wait 30+ minutes
- timeout.html appears
- Click "Resume Registration"
- Form should restore (if sessionStorage implemented)
```

---

## 14. MONITORING & ALERTS

### Logs to Check

#### Production
- Netlify Function Logs: `netlify/functions/*.js` output
- Cashfree Dashboard: Payment status
- GitHub Storage: Order JSON files
- KonfHub Dashboard: Ticket issuance

#### Key Log Markers
```
[cf-webhook] WEBHOOK INVOKED
[cf-webhook] Signature mismatch → Check CF_WEBHOOK_SECRET
[cf-webhook] Order already fulfilled → Duplicate prevention working
[cf-webhook] Issuance failed → Check KonfHub credentials
[create-order] Reusing existing order → Idempotency working
[finalize-order] Issuance completed → Fallback working
[order-status] Order not found → Check query param
```

---

## 15. CONFIGURATION CHECKLIST

Before going live, ensure:

```
[ ] CASHFREE_APP_ID → Netlify env vars
[ ] CASHFREE_SECRET_KEY → Netlify env vars
[ ] CF_WEBHOOK_SECRET → Netlify env vars (HMAC key)
[ ] CASHFREE_ENV → "sandbox" or "production"
[ ] CASHFREE_API_VERSION → "2022-09-01" or newer
[ ] GITHUB_TOKEN → Netlify env vars
[ ] GITHUB_OWNER → repo owner name
[ ] GITHUB_REPO → repo name
[ ] KONFHUB_API_KEY → Netlify env vars
[ ] KONFHUB_EVENT_ID → Event ID (prod)
[ ] KONFHUB_FREE_TICKET_ID → Free ticket type ID
[ ] SITE_URL → https://your-domain (for URLs)
[ ] Webhook URL registered in Cashfree console
[ ] GitHub repo has storage/orders/ folder
[ ] KonfHub free ticket available
```

---

## Summary

The system now handles:
✅ Session timeouts  
✅ Payment cancellations  
✅ Network failures  
✅ Request timeouts  
✅ Duplicate orders  
✅ Webhook failures  
✅ Form data persistence  
✅ Pass issuance polling  
✅ Order status tracking  
✅ Global error catching  
✅ Offline detection  
✅ User-friendly error messaging  

All with proper logging, monitoring, and user guidance.
