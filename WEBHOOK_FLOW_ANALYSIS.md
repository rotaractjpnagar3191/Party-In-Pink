# Webhook Flow Analysis

## Current Situation

Both webhooks configured in Cashfree are showing **"endpoint did not respond properly"**:
- **Production**: `https://a02dc3a3--party-in-pink.netlify.live/api/cf-webhook`
- **Local/Testing**: `http://localhost:8888/api/cf-webhook`

## Why This Doesn't Break Your System (Yet)

Cashfree is **still working** because of a **fallback mechanism**:

```
User Completes Payment in Cashfree
        ↓
[Preferred] Webhook triggers: /api/cf-webhook
        ↓ (if webhook fails or doesn't respond)
[Fallback] User redirected to success.html?order=pip_xxx_yyy
        ↓
Success page calls: /api/finalize-order (with 5s timeout)
        ↓
Passes are issued to KonfHub
        ↓
User sees "Dispatching passes..." status
```

## Current Flow (Working)

1. **`create-order.js`** - User creates payment order
   - Creates order in Cashfree API
   - Stores order metadata to GitHub: `/storage/orders/{order_id}.json`
   - Returns `payment_link` or `payment_session_id`

2. **User pays via Cashfree UI** - Completes payment

3. **Webhook SHOULD trigger** `cf-webhook.js` (NOT happening due to signature mismatch)
   - Would verify Cashfree signature
   - Would call `issueComplimentaryPasses()` immediately
   - Would mark order as `fulfilled: { status: 'ok' }`

4. **Webhook FAILS** - Signature validation failing

5. **User redirected to success page** with `?order={order_id}&type=bulk`
   - Shows "Dispatching passes..." overlay
   - Calls `finalize-order` endpoint (5s timeout)

6. **`finalize-order.js`** - Fallback issuance
   - Loads order from GitHub storage
   - Calls `issueComplimentaryPasses()`
   - Marks order as fulfilled
   - Success page polls `/api/order-status` every 2s (up to 40 tries)

7. **`order-status.js`** - Polls for status
   - Returns `fulfilled.status: 'ok'` or `'partial'`
   - Frontend hides spinner and shows result

## The Problem

### Webhook Signature Verification is Failing

**File**: `netlify/functions/cf-webhook.js` (lines 30-50)

```javascript
// Current implementation
const sig = event.headers['x-webhook-signature'];
const ts  = event.headers['x-webhook-timestamp'];

const messageToSign = `${ts}.${raw.toString('utf8')}`;
const expected = crypto
  .createHmac('sha256', SECRET)
  .update(messageToSign)
  .digest('base64');

if (expected !== sig) return respond(401, 'Invalid signature');
```

**Why it's failing:**
1. Cashfree might be sending headers in different case (e.g., `X-Webhook-Signature`)
2. The message format might not match what Cashfree is sending
3. The webhook secret might not be set correctly

## What We Need to Fix

### Option 1: Debug and Fix Signature Validation (Recommended)

1. Enable `ALLOW_TEST_PING=1` environment variable
2. Try sending a test webhook from Cashfree dashboard
3. Check server logs to see what signature format Cashfree is sending
4. Adjust the verification code to match

### Option 2: Add Logging to Understand the Issue

Already added to `cf-webhook.js`:
- Logs all headers received
- Tries alternative signature formats
- Reports which format matches

### Option 3: Make Webhook Optional (Current State)

The system works fine without webhook because:
- `finalize-order` is called from the frontend immediately upon redirect
- `order-status` polls until passes are issued
- This provides ~80 seconds of polling (40 tries × 2s delay)

## Risks of Webhook Not Working

1. **If JavaScript fails on success page**: Order never gets finalized
   - User sees "Still processing" indefinitely
   - Manual intervention needed

2. **If user closes browser before finalize completes**: Order stuck in limbo
   - Would need webhook to process retroactively

3. **If GitHub storage is unavailable**: No order record to finalize
   - Webhook could reconstruct from Cashfree data (it tries to!)

## To Test and Fix

1. **Check your Cashfree API version**
   - Current code assumes `2025-01-01` or `2022-09-01`
   - Different versions may have different signature formats

2. **Set `CF_WEBHOOK_SECRET` environment variable**
   - Currently falls back to `CASHFREE_SECRET_KEY`
   - Cashfree may require a separate webhook-specific secret

3. **Test with `ALLOW_TEST_PING=1`**
   ```bash
   # Locally in .env or Netlify environment:
   ALLOW_TEST_PING=1
   ```
   - This bypasses signature verification for testing
   - Lets you see webhook payload structure

4. **Check Cashfree logs**
   - Go to Cashfree Dashboard → Webhooks → View Logs
   - See what response code you got (501? 401? timeout?)
   - See what payload was sent

## Files Modified

- `netlify/functions/cf-webhook.js` - Added signature debugging

## Next Steps

1. Enable `ALLOW_TEST_PING=1` temporarily
2. Send a test webhook from Cashfree
3. Check logs for signature format that works
4. Update signature verification code
5. Disable `ALLOW_TEST_PING=1` and redeploy

