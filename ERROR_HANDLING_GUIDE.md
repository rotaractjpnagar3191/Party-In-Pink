# Failure Scenarios - Quick Reference

## 🔴 Critical Failures

### 1. Session Timeout (30 min inactivity)
- **Page**: `timeout.html`
- **Auto-redirect**: YES
- **User Recovery**: Resume Registration button
- **Data Loss**: NO (sessionStorage)
- **Status**: ✅ IMPLEMENTED

### 2. Payment Cancellation  
- **Page**: `cancel.html`
- **Trigger**: User cancels in Cashfree checkout
- **Messaging**: "No charges made, you can retry anytime"
- **Status**: ✅ IMPLEMENTED

### 3. Payment Timeout (>15s)
- **Page**: `error.html?code=TIMEOUT`
- **Cause**: Cashfree API not responding
- **Solution**: Retry button or contact support
- **Status**: ✅ IMPLEMENTED

### 4. Network Error (Offline)
- **Page**: `error.html?code=NETWORK`
- **Detection**: `navigator.onLine` check
- **UI**: Shows network status badge
- **Status**: ✅ IMPLEMENTED

### 5. Server Error (5xx)
- **Page**: `error.html?code=SERVER`
- **Message**: "Our servers are experiencing issues"
- **Retry**: Available
- **Status**: ✅ IMPLEMENTED

### 6. Validation Error (400/422)
- **Page**: `error.html?code=VALIDATION`
- **Message**: "Please check your information"
- **Data Loss**: NO (form data preserved)
- **Status**: ✅ IMPLEMENTED

---

## 🟡 Secondary Failures

### 7. Duplicate Order Prevention
- **Where**: `create-order.js`
- **Method**: Search existing unfulfilled orders
- **Result**: Reuse payment link if found
- **Status**: ✅ IMPLEMENTED

### 8. Webhook Deduplication
- **Where**: `cf-webhook.js`
- **Methods**: 
  - Signature + timestamp (webhookRegistry)
  - processed_webhooks array
  - In-memory cache (10s window)
- **Result**: Prevents double-issuance
- **Status**: ✅ IMPLEMENTED

### 9. Concurrent Webhook Protection
- **Where**: `cf-webhook.js`
- **Method**: Processing lock + GitHub re-check
- **Result**: Only one webhook processes simultaneously
- **Status**: ✅ IMPLEMENTED

### 10. Partial Fulfillment
- **Where**: `cf-webhook.js`
- **Result**: fulfilled.status = "partial"
- **Action**: Admin manually fixes in GitHub
- **Status**: ✅ IMPLEMENTED

### 11. Order Reconstruction
- **Where**: `cf-webhook.js`
- **Trigger**: Webhook arrives before order created
- **Result**: Extracts type from order_note
- **Fallback**: Manual intervention if type missing
- **Status**: ✅ IMPLEMENTED

---

## 🟢 Recovery & Tracking

### 12. Order Status Page
- **URL**: `/status.html`
- **Search**: By Order ID or Email
- **Shows**: Timeline of payment → processing → delivery
- **Status**: ✅ IMPLEMENTED

### 13. Success Page Polling
- **Where**: `success.html`
- **Interval**: 2 seconds, max 60 attempts (2 min)
- **Overlay**: Shows pass count progress
- **Fallback**: Manual message after timeout
- **Status**: ✅ IMPLEMENTED

### 14. Error Recovery
- **Form Data**: Saved to sessionStorage
- **Retry**: Error page has "Retry" button
- **History**: Uses browser history.back()
- **Status**: ✅ IMPLEMENTED

### 15. Global Error Catching
- **Methods**: window.onerror, unhandledrejection
- **Storage**: Saves to sessionStorage
- **Affected Pages**: Skipped (error, timeout, cancel)
- **Status**: ✅ IMPLEMENTED

---

## 📊 Edge Cases Matrix

| Scenario | User Sees | No Charge | Data Loss | User Can Retry | Notes |
|----------|-----------|-----------|-----------|-----------------|-------|
| Session timeout | timeout.html | YES | NO | YES (Resume) | 30 min inactivity |
| Payment cancel | cancel.html | YES | NO | YES (Retry) | User action |
| Payment timeout | error.html | YES | NO | YES (Retry) | 15s limit |
| Network error | error.html | YES | NO | YES (Retry) | Offline detection |
| Server error | error.html | YES | NO | YES (Retry) | 5xx response |
| Validation error | error.html | NO | NO | YES (Same form) | 400/422 response |
| Duplicate order | Reuses link | NO | NO | NO (Automatic) | Idempotency check |
| Webhook duplicate | Not retried | NO | N/A | NO (Auto-deduped) | Signature + cache |
| Partial fulfill | partial status | YES | NO | YES (Manual) | Admin review |

---

## 🛠️ Testing Commands

```bash
# Test timeout
curl -m 5 http://localhost:8888/api/create-order  # 5s timeout

# Test offline (DevTools)
DevTools → Network → Offline
Submit any form → See NETWORK error

# Test session
Open registration page → Wait 30+ min → Auto-redirect to timeout.html

# Test duplicate
Submit form twice rapidly → Second uses first payment link

# Test webhook (manual)
curl -X POST http://localhost:8888/.netlify/functions/cf-webhook \
  -H "X-Webhook-Signature: XXXX" \
  -H "X-Webhook-Timestamp: $(date +%s)" \
  -H "Content-Type: application/json" \
  -d '{"payment": {"payment_status": "SUCCESS", ...}}'

# Test order status
curl http://localhost:8888/api/order-status?id=pip_xxx
curl http://localhost:8888/api/order-status?id=user@email.com
```

---

## 📋 Deployment Checklist

Before deploying to production:

- [ ] All 15 edge cases tested locally
- [ ] Cashfree credentials in Netlify
- [ ] Webhook secret configured
- [ ] KonfHub free ticket available
- [ ] GitHub storage folder exists (storage/orders/)
- [ ] SITE_URL points to production domain
- [ ] SSL certificate valid
- [ ] Monitor logs in Netlify Functions
- [ ] Test payment flow end-to-end
- [ ] Email templates working
- [ ] Support contact info accessible

---

## 🚨 Troubleshooting

### "Order not found" on success page
→ Check GitHub storage path is correct  
→ Webhook may have failed, check logs

### "Session timeout" too fast
→ Check SESSION_TIMEOUT value (should be 30 min)  
→ Activity detection may need adjustment

### "Duplicate order" appearing
→ Idempotency check not working  
→ Check existing order lookup in create-order.js

### Webhook not firing
→ Verify webhook URL in Cashfree console  
→ Check CF_WEBHOOK_SECRET matches  
→ See Cashfree webhook logs

### Passes not delivered
→ Check KonfHub credentials  
→ Verify free ticket ID exists in KonfHub  
→ Review cf-webhook logs for errors

---

## 📚 Files Modified

```
public/
  ├── app.js (↑ 50 lines added)
  ├── error.html (NEW)
  ├── timeout.html (NEW)
  ├── cancel.html (NEW)
  ├── success.html (↑ polling enhanced)
  └── status.html (↑ search UI improved)

netlify/functions/
  ├── create-order.js (↑ idempotency added)
  ├── cf-webhook.js (↑ major enhancements)
  ├── finalize-order.js (↑ logging)
  └── order-status.js (↑ search improved)

docs/
  ├── EDGE_CASES.md (NEW)
  └── ERROR_HANDLING_GUIDE.md (NEW - this file)
```

---

**Last Updated**: Nov 22, 2025  
**Version**: 1.0  
**Status**: ✅ All edge cases implemented
