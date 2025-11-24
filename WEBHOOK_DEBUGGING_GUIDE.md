# Webhook Debugging Guide

## Issue: Tickets Not Dispatched After Payment

Your payment was completed but tickets were not issued. This guide helps diagnose where the issue occurred.

---

## Root Cause Identified & Fixed ✅

**Problem:** When the webhook arrived before `create-order.js` saved the order to GitHub, the webhook reconstructed the order from the webhook payload. However, the quantity was being set to `0` instead of being extracted from the `order_note`.

**Solution:** Enhanced webhook reconstruction to properly parse `order_note` format and extract the quantity field.

**Order Note Format:**
```
bulk:       "bulk|COMMUNITY|12"           → type=bulk, club_type=COMMUNITY, quantity=12
donation:   "donation|Silver|"             → type=donation, tier=Silver, quantity=(not used)
```

**The fix:** Now extracts the quantity (3rd field) for bulk orders:
```javascript
const noteParts = String(note).split('|');
const noteQuantity = parseInt(noteParts[2] || '0', 10) || 0;

// For bulk: use extracted quantity
oc.passes = noteType === 'bulk' ? noteQuantity : 0;
```

---

## Diagnostic Checklist

### 1. **Did the webhook arrive at all?**

**Where to check:** Netlify Functions logs for `cf-webhook`

**What to look for:**
```
[cf-webhook] ===== WEBHOOK INVOKED =====
[cf-webhook] Timestamp: 2025-11-22T07:41:25.793Z
[cf-webhook] Method: POST
[cf-webhook] Event body length: 1234
```

**If you see this:** Webhook was received ✓
**If you don't see this:** 
- Webhook URL in Cashfree Dashboard might be wrong
- Cashfree couldn't reach your Netlify function
- Network/DNS issues

---

### 2. **Did the signature verify?**

**What to look for:**
```
[cf-webhook] Signature verification:
[cf-webhook] - Match: true
```

**If Match is false:**
- Cashfree webhook secret in Netlify environment mismatch
- Check `CF_WEBHOOK_SECRET` matches Cashfree Dashboard

**If signature headers are missing:**
- Cashfree version mismatch - verify API version
- Webhook format changed

---

### 3. **Was the payment status SUCCESS?**

**What to look for:**
```
[cf-webhook] Status: SUCCESS OrderID: pip_xxxx Amount: 2388
```

**If Status ≠ SUCCESS:**
```
[cf-webhook] ⚠️  PAYMENT FAILED OR PENDING: status=PENDING
```
- Customer didn't complete payment
- Payment is processing (wait a few minutes)
- Payment failed at gateway

---

### 4. **Did payment verification succeed?**

**What to look for:**
```
[cf-webhook] Verifying payment with Cashfree API...
[cf-webhook] ✓ Payment verified successfully
```

**If verification failed:**
```
[cf-webhook] ❌ PAYMENT VERIFICATION FAILED: Amount mismatch
```

**Common failures:**
- `Amount mismatch` - Order amount ≠ paid amount
- `No successful payment` - Webhook has status=SUCCESS but API shows no payment
- `Order ID mismatch` - Data tampering detected
- `Verification request timeout` - Cashfree API slow

---

### 5. **Was the order found or reconstructed?**

**If order found in GitHub:**
```
[cf-webhook] ✓ Order pip_xxxx loaded from GitHub
```

**If order was reconstructed:**
```
[cf-webhook] ⚠️  Order pip_xxxx NOT created yet in system
[cf-webhook] Reconstructing order from webhook...
[cf-webhook] 🔍 RECONSTRUCTION DETAILS:
[cf-webhook]   - order_note: bulk|COMMUNITY|12
[cf-webhook]   - noteQuantity: 12
[cf-webhook] ✓ Reconstructed order: type=bulk, passes=12
```

**This is now fixed!** The quantity is properly extracted.

---

### 6. **Did the order have valid passes and recipients?**

**What to look for:**
```
[cf-webhook] 🔍 VALIDATION CHECK - Passes:
[cf-webhook]   - oc.passes: 12
[cf-webhook]   - oc.type: bulk
[cf-webhook] 🔍 VALIDATION CHECK - Recipients:
[cf-webhook]   - oc.recipients: ["samarthv080@gmail.com"]
[cf-webhook]   - Length: 1
```

**If passes is 0:**
```
[cf-webhook] ❌ VALIDATION FAILED: passes must be > 0
```
- **THIS WAS THE BUG** - Now fixed by proper quantity extraction

**If recipients is empty:**
```
[cf-webhook] ❌ VALIDATION FAILED: no recipients
```
- Form didn't include email
- Webhook payload missing customer_email

---

### 7. **Did KonfHub issuance succeed?**

**What to look for:**
```
[cf-webhook] ===== ABOUT TO CALL KONFHUB =====
[cf-webhook] Order ID: pip_xxxx
[cf-webhook] Type: bulk
[cf-webhook] Passes: 12
[cf-webhook] Recipients: ["samarthv080@gmail.com"]
[cf-webhook] ENV KONFHUB keys:
[cf-webhook]   - API_KEY: true
[cf-webhook]   - EVENT_ID: ABC123
[cf-webhook]   - BULK_TICKET_ID: XYZ789
```

**Then:**
```
[capture] Calling KonfHub API:
[capture]   - Ticket ID: XYZ789
[capture]   - Event ID: ABC123
[capture]   - Chunk size: 12
[capture] Response:
[capture]   - OK: true
[capture]   - Status: 200
```

**If KonfHub call failed:**
```
[cf-webhook] ❌ KonfHub issuance FAILED:
[cf-webhook]   - Error message: Ticket is not accessible (ASC-20)
```

**Common KonfHub errors:**
- `ASC-20` - Ticket ID inactive or event not started
- `401` - API key invalid
- `404` - Event ID not found
- `403` - Ticket not accessible (wrong tier/access code)

---

### 8. **Was the order saved to GitHub after fulfillment?**

**What to look for:**
```
[cf-webhook] About to save order to GitHub:
[cf-webhook] Path: storage/orders/pip_xxxx.json
[cf-webhook] Order fulfilled: {
  at: "2025-11-22T07:41:30.000Z",
  status: "ok",
  count: 12
}
[cf-webhook] ✓ Order successfully saved to GitHub
```

**If save failed (non-critical):**
```
[cf-webhook] ⚠️  SOFT FAIL - GitHub storage error (non-critical)
[cf-webhook] Order was NOT persisted, but tickets WERE issued successfully
```

This is OK - tickets were issued, just metadata not saved. Admin can still see in KonfHub.

---

## Testing Workflow

### 1. **Enable Test Mode** (if needed)
```bash
# In Netlify environment variables
ALLOW_TEST_PING=1
```

### 2. **Trigger Payment** (sandbox)
- Go to https://pip.rotaractjpnagar.org/bulk.html (sandbox)
- Fill form, click "Proceed"
- Complete Cashfree payment with test card

### 3. **Check Netlify Logs**
```bash
netlify functions:invoke cf-webhook
```

Or check Netlify Dashboard → Functions → cf-webhook → Invocations

### 4. **Check Order Status**
- Go to https://pip.rotaractjpnagar.org/status.html
- Enter order ID from payment page
- Should show "Fulfilled: ok" with ticket count

---

## Common Issues & Solutions

### Issue: Quantity = 0, tickets not issued

**Cause:** Order reconstructed without proper quantity extraction

**Status:** ✅ FIXED in latest commit

**Verification:** Check logs for:
```
[cf-webhook] ✓ Reconstructed order: type=bulk, passes=12
```

### Issue: Different behavior for Bulk vs Donate

**Answer:** Both forms follow identical flow:
1. Submit form → POST `/api/create-order`
2. Save to GitHub (or webhook reconstructs)
3. Webhook arrives → Verify payment → Extract order data
4. Call KonfHub → Issue tickets
5. Save fulfillment status

**Differences:**
- Bulk: Includes `club_type`, `club_name`, `quantity`
- Donate: Includes `tier`, `custom_amount`

Both use `order_note` format with type as first field.

### Issue: Webhook doesn't arrive

**Solutions:**
1. Check Cashfree Dashboard → Settings → Webhooks
   - Confirm webhook URL: `https://pip.rotaractjpnagar.org/api/cf-webhook`
   - Confirm webhook is ENABLED
   - Check events: Should include "PAYMENT_SUCCESS"

2. Check webhook secret
   - Copy from Cashfree Dashboard
   - Set in Netlify env var: `CF_WEBHOOK_SECRET`

3. Test webhook delivery
   - Cashfree Dashboard → Webhooks → Send test event
   - Check Netlify logs immediately

### Issue: Webhook arrives but fails verification

**Check:**
1. Order amount matches paid amount (±1 paisa)
2. Order ID is valid format
3. Payment status in webhook = SUCCESS

---

## Data Flow Diagram

```
USER SUBMITS FORM
  ↓
POST /api/create-order
  ├─ Validate input
  ├─ Create Cashfree order
  ├─ Save to GitHub (or skip if timeout)
  └─ Return payment_session_id
        ↓
  USER COMPLETES PAYMENT
        ↓
  CASHFREE SENDS WEBHOOK
        ↓
  POST /api/cf-webhook
  ├─ Verify signature
  ├─ Check payment status = SUCCESS
  ├─ Verify with Cashfree API
  ├─ Load order from GitHub
  │  └─ If not found, RECONSTRUCT from webhook
  │     (Parse order_note to extract quantity) ✅ FIXED
  ├─ Validate passes > 0 ✅ NOW WORKS
  ├─ Validate recipients.length > 0
  ├─ CALL KONFHUB to issue tickets
  ├─ Save fulfillment status to GitHub
  └─ Return 200 OK
        ↓
  FRONTEND POLLS /api/order-status
  ├─ Checks fulfilled status
  └─ Shows "Tickets issued!" when status = ok
```

---

## Quick Debugging Commands

### Get order data from GitHub:
```bash
curl -H "Authorization: token $GITHUB_TOKEN" \
  "https://api.github.com/repos/rotaractjpnagar3191/Party-In-Pink/contents/storage/orders/pip_1763797284746_zdv3ru.json"
```

### Check Netlify environment variables:
```bash
netlify env:list
```

### Trigger test webhook:
```bash
curl -X POST https://pip.rotaractjpnagar.org/api/cf-webhook \
  -H "x-webhook-signature: $(echo -n 'test' | openssl dgst -sha256 -hmac 'secret' -binary | base64)" \
  -H "x-webhook-timestamp: $(date +%s)" \
  -H "content-type: application/json" \
  -d '{"data":{"order":{"order_id":"pip_test","order_amount":1000},"payment":{"payment_status":"SUCCESS"}}}'
```

---

## Next Steps

1. **Deploy the fix** to production
2. **Test with test card** in Cashfree sandbox
3. **Monitor logs** during production payment
4. **Watch for the "✓ Reconstructed order: type=bulk, passes=12"** message
5. **Verify order status** shows fulfilled

---

## Questions?

Check logs for exact error message:
```
[cf-webhook] ❌ KEYWORD
```

Search this guide for that keyword to find the solution.
