# URGENT: Complete Workflow Fix & Testing

## THE CRITICAL ISSUE

Your webhook is **NOT ARRIVING** at all. This is why `fulfilled` is always `undefined`.

**Evidence:**
- Order shows `order_status: "ACTIVE"` (no payment confirmation)
- No `fulfilled` field
- No `konfhub` field
- Polling returns undefined

## IMMEDIATE DIAGNOSTICS

### Step 1: Check If Webhook Is Reaching Netlify

**Test with debug endpoint:**
```bash
# Replace pip_1763798139779_h7qcqj with your order ID
curl https://pip.rotaractjpnagar.org/api/debug-order?id=pip_1763798139779_h7qcqj
```

**Expected Response:**
```json
{
  "ok": true,
  "order": {...},
  "debug": {
    "has_fulfilled": false,  // ← This is the problem if false
    "fulfilled_status": null,
    "has_konfhub": false,
    "has_error": false
  }
}
```

If `has_fulfilled` is `false`, the webhook never arrived.

---

### Step 2: Check Cashfree Webhook Configuration

**Required:**
1. Go to **Cashfree Dashboard** → Settings → Webhooks
2. Verify webhook URL is set to: `https://pip.rotaractjpnagar.org/api/cf-webhook`
3. Verify webhook is **ENABLED**
4. Verify **PAYMENT_SUCCESS** event is checked
5. Copy webhook secret and add to Netlify:
   ```bash
   netlify env:set CF_WEBHOOK_SECRET "your-secret-from-cashfree"
   ```

**Screenshot checklist:**
- [ ] Webhook URL: `https://pip.rotaractjpnagar.org/api/cf-webhook`
- [ ] Status: ENABLED
- [ ] Events: PAYMENT_SUCCESS checked
- [ ] Secret matches Netlify `CF_WEBHOOK_SECRET`

---

### Step 3: Test Webhook Manually

**Simulate payment webhook:**
```bash
# Test your webhook handler with a simulated payment
curl -X POST "https://pip.rotaractjpnagar.org/api/test-webhook?order_id=pip_1763798139779_h7qcqj&status=SUCCESS&amount=2388"
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Test webhook processed successfully. Issued 12 passes.",
  "order_id": "pip_1763798139779_h7qcqj",
  "fulfilled": {
    "at": "2025-11-22T...",
    "status": "ok",
    "count": 12
  }
}
```

If this works, your webhook handler is fine. If it fails, check the logs.

---

### Step 4: Check Netlify Function Logs

**View cf-webhook logs:**
```bash
netlify functions:invoke cf-webhook --querystring "order_id=pip_1763798139779_h7qcqj"
```

Or check Netlify Dashboard:
- Functions → cf-webhook → Invocations
- Look for error logs

**You should see:**
```
[cf-webhook] ===== WEBHOOK INVOKED =====
[cf-webhook] Timestamp: ...
[cf-webhook] Method: POST
```

If you don't see this, **webhook is not being sent by Cashfree**.

---

## THE FIX

### 1. **Verify Cashfree Webhook URL**

The most common issue is the webhook URL is wrong or not configured.

**In Cashfree Dashboard:**
```
Settings → Webhooks → Add Webhook

URL: https://pip.rotaractjpnagar.org/api/cf-webhook
Events: PAYMENT_SUCCESS
Status: Active
```

**Copy the Webhook Secret and set in Netlify:**
```bash
netlify env:set CF_WEBHOOK_SECRET "abcd1234xyz..."
netlify deploy
```

### 2. **Verify Payment Was Actually Completed**

Check Cashfree Dashboard → Orders:
- Find your order ID: `pip_1763798139779_h7qcqj`
- Check status: Should be **PAID** or **SETTLEMENT_PROCESSED**
- If status is **ACTIVE**, payment didn't complete

### 3. **Trigger Test Payment Again**

Once webhook is configured:
1. Go to https://pip.rotaractjpnagar.org/bulk.html
2. Fill form
3. Complete payment with test card
4. Check immediately if order shows fulfilled

### 4. **If Still Not Working**

**Check Cashfree logs:**
- Cashfree Dashboard → Webhooks → See delivery logs
- Look for failed deliveries (HTTP errors)
- Common errors:
  - `404` - Wrong URL
  - `401` - Missing/wrong signature
  - `500` - Netlify function error

**Check Netlify Function Logs:**
```bash
netlify functions:list  # Show all functions
netlify functions:invoke cf-webhook --input="{...}"  # Test directly
```

---

## WORKFLOW CHECKLIST

- [ ] Webhook URL configured in Cashfree Dashboard
- [ ] Webhook events include PAYMENT_SUCCESS
- [ ] Webhook is ENABLED
- [ ] Secret key set in Netlify `CF_WEBHOOK_SECRET`
- [ ] Test payment completed successfully
- [ ] Check Cashfree order shows PAID status
- [ ] Netlify function logs show `[cf-webhook] ===== WEBHOOK INVOKED =====`
- [ ] Order status endpoint shows `fulfilled.status = 'ok'`
- [ ] Polling on success.html completes successfully
- [ ] Tickets appear in KonfHub

---

## QUICK VERIFICATION COMMANDS

### Check if order exists:
```bash
curl https://pip.rotaractjpnagar.org/api/debug-order?id=pip_1763798139779_h7qcqj
```

### Test webhook locally:
```bash
curl -X POST https://pip.rotaractjpnagar.org/api/test-webhook?order_id=pip_test_123&status=SUCCESS&amount=2388
```

### Check Netlify env vars:
```bash
netlify env:list
# Look for: CF_WEBHOOK_SECRET, CASHFREE_APP_ID, CASHFREE_SECRET_KEY
```

### View recent function invocations:
```bash
netlify functions:list
netlify logs --functions=cf-webhook
```

---

## VERIFY_PAY FEATURE

Now enabled in create-order.js:
```javascript
products: {
  verify_pay: {
    enabled: true
  }
}
```

This adds an extra security layer - Cashfree will verify the payment before webhook is sent.

---

## THE COMPLETE FLOW (NOW FIXED)

```
1. USER SUBMITS FORM
   ↓
2. POST /api/create-order
   ├─ Create Cashfree order
   ├─ Enable verify_pay: true ✅ NEW
   ├─ Save order to GitHub
   └─ Return payment link
   ↓
3. USER COMPLETES PAYMENT
   ↓
4. CASHFREE SENDS WEBHOOK ⚠️ CHECK THIS IS CONFIGURED
   ↓
5. POST /api/cf-webhook
   ├─ Verify signature
   ├─ Check payment = SUCCESS
   ├─ Verify with verify_pay API ✅ NEW
   ├─ Load/reconstruct order
   ├─ Extract passes from order_note ✅ FIXED
   ├─ Call KonfHub → Issue tickets
   ├─ Save fulfilled status
   └─ Return 200 OK
   ↓
6. FRONTEND POLLS /api/order-status
   ├─ Check fulfilled.status
   ├─ Shows "Tickets issued!" ✅
   └─ Hide overlay
   ↓
7. CUSTOMER RECEIVES EMAILS FROM KONFHUB
```

---

## TESTING PROCEDURE

### Quick Test (5 minutes):
1. `curl https://pip.rotaractjpnagar.org/api/test-webhook?order_id=test_123&status=SUCCESS&amount=2388`
2. If it succeeds, webhook handler works ✓
3. Then check: `curl https://pip.rotaractjpnagar.org/api/debug-order?id=test_123`
4. Should show `fulfilled.status = 'ok'` ✓

### Full Test (includes payment):
1. Complete test payment at https://pip.rotaractjpnagar.org/bulk.html
2. On success.html, should see "Dispatching passes..." overlay
3. After 10-20 seconds, should show "✓ Tickets issued"
4. Check Cashfree Dashboard → Orders → Status should be PAID
5. Check logs for `[cf-webhook] ===== WEBHOOK INVOKED =====`

### If Test Fails:
1. Check Cashfree Dashboard webhook configuration
2. Verify webhook secret in Netlify matches Cashfree
3. Check Netlify logs for function errors
4. Verify GITHUB_TOKEN, KONFHUB_API_KEY are set

---

## SUPPORT CHECKLIST

When contacting support, provide:
- [ ] Order ID that failed: `pip_xxx`
- [ ] Cashfree webhook configuration screenshot
- [ ] Netlify env variables list (sanitized): `netlify env:list`
- [ ] Test webhook result: `curl ... /api/test-webhook`
- [ ] Debug order result: `curl ... /api/debug-order?id=pip_xxx`
- [ ] Netlify function logs screenshot
- [ ] Cashfree webhook delivery logs screenshot

---

## MOST LIKELY ISSUE

**99% of the time, this is the problem:**

❌ Webhook URL in Cashfree is wrong or not configured
❌ Webhook is disabled in Cashfree Dashboard
❌ Webhook secret doesn't match between Cashfree and Netlify

**The fix:**
1. Go to Cashfree Dashboard
2. Settings → Webhooks
3. Add/verify webhook:
   - URL: `https://pip.rotaractjpnagar.org/api/cf-webhook`
   - Events: PAYMENT_SUCCESS (checked)
   - Status: Active
4. Copy secret
5. In Netlify: `netlify env:set CF_WEBHOOK_SECRET "..."`
6. Deploy and test again

---

## NEXT STEPS

1. **Immediately check** Cashfree webhook configuration
2. **Test** with manual webhook: `curl ... /api/test-webhook`
3. **Deploy** any env changes
4. **Complete** a test payment
5. **Monitor** logs for success

If webhook still doesn't arrive after these steps, check Cashfree's webhook delivery logs for network errors.
