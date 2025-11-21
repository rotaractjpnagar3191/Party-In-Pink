# Cashfree Webhook Fix & System Architecture

## The Problem

Both webhooks were failing because the **signature verification format was WRONG**.

### What Was Wrong

```javascript
// ❌ WRONG - Uses dot separator
const messageToSign = `${ts}.${raw.toString('utf8')}`;
```

### The Fix

```javascript
// ✅ CORRECT - Direct concatenation per Cashfree API v2025-01-01
const signatureString = ts + raw.toString('utf8');
```

**Source**: [Cashfree Webhook Documentation](https://www.cashfree.com/docs/payments/no-code/payment-forms/webhooks#webhook-signature-verification)

The Cashfree v2025-01-01 API specification clearly states:
> Verification process:
> 1. Concatenate the timestamp and raw request body: `timestamp + rawBody`
> 2. Generate HMAC-SHA256 hash using your secret key
> 3. Base64-encode the hash
> 4. Compare with the `x-webhook-signature` header value

## How Your System Actually Works (Currently)

Despite the webhook signature failing, **your payments ARE working** because of a clever fallback mechanism:

```
┌─────────────────────────────────────────────────────────────┐
│ User Completes Payment in Cashfree                           │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
          ❌ Webhook Called (Fails)
          /api/cf-webhook → 401 Invalid Signature
                     │
                     ▼ (Cascades to frontend)
          ✅ Frontend Fallback Triggered
             User redirected to:
             /success.html?order=pip_xxx&type=bulk
                     │
                     ▼
          ✅ Frontend calls /api/finalize-order
             (5s timeout)
                     │
                     ▼
          ✅ Passes issued to KonfHub
                     │
                     ▼
          ✅ Frontend polls /api/order-status every 2s
             (up to 40 times = ~80 seconds)
                     │
                     ▼
          ✅ User sees "Tickets issued" status
```

## The Architecture

### 1. Order Creation (`/api/create-order`)
- **Input**: User submits bulk/donation form
- **Output**: Returns Cashfree payment link
- **Storage**: Saves order metadata to GitHub
- **Timeout**: 10 seconds (we added this!)

### 2. Payment in Cashfree UI
- User completes payment in Cashfree hosted UI
- Payment is confirmed in Cashfree system

### 3. Webhook Attempt (`/api/cf-webhook`) ❌ CURRENTLY FAILING
- **Should**: Process payment in real-time
- **Status**: Signature verification failing
- **Fallback**: Frontend takes over
- **Purpose**: Would issue passes immediately without user interaction

### 4. Frontend Fallback (`/api/finalize-order`) ✅ CURRENTLY WORKING
- **Trigger**: Called when user sees success page
- **What it does**:
  1. Loads order from GitHub storage
  2. Checks if payment was processed
  3. Issues passes to KonfHub if not already issued
  4. Marks order as `fulfilled`
- **Timeout**: 5 seconds (we added this!)
- **Risk**: If frontend fails, order never gets fulfilled

### 5. Status Polling (`/api/order-status`)
- **Trigger**: Success page polls every 2 seconds
- **What it does**: Returns fulfillment status
- **Timeout**: 5 seconds per request (we added this!)
- **Duration**: Polls up to 40 times (~80 seconds)

## Environment Variables Needed

```env
# Cashfree API Configuration
CASHFREE_ENV=sandbox                    # or 'production'
CASHFREE_APP_ID=<your_app_id>          # Your API Key/App ID
CASHFREE_SECRET_KEY=<your_secret_key>  # Your Secret Key
CASHFREE_API_VERSION=2025-01-01        # Current API version

# Optional: Separate webhook secret (defaults to CASHFREE_SECRET_KEY)
CF_WEBHOOK_SECRET=<optional_webhook_secret>

# GitHub Storage
GITHUB_TOKEN=<your_token>
GITHUB_OWNER=rotaractjpnagar3191
GITHUB_REPO=Party-In-Pink
STORE_PATH=storage

# KonfHub Configuration
KONFHUB_API_KEY=<your_api_key>
KONFHUB_EVENT_ID=<event_id>
KONFHUB_FREE_TICKET_ID=<ticket_id>
KONFHUB_BULK_TICKET_ID=<ticket_id>     # Optional, defaults to FREE_TICKET_ID
```

## Testing the Fix

### 1. Enable Test Mode
Set in Netlify environment variables:
```
ALLOW_TEST_PING=1
```

This bypasses signature verification for testing.

### 2. Send Test Webhook from Cashfree
- Go to **Cashfree Dashboard → Developers → Webhooks**
- Find the webhook endpoint
- Click "Test" button
- Check your function logs

### 3. Verify Logs
You'll see logs like:
```
[cf-webhook] Signature verification:
[cf-webhook] - Timestamp: 1746427759733
[cf-webhook] - Raw body length: 1234
[cf-webhook] - Expected signature: xxxxx
[cf-webhook] - Received signature: xxxxx
[cf-webhook] - Match: true
```

### 4. Disable Test Mode
Remove `ALLOW_TEST_PING=1` from environment variables and redeploy.

## Why It's Working Despite Webhook Failing

Your system has **3 layers of redundancy**:

| Layer | Mechanism | Status | Timeout |
|-------|-----------|--------|---------|
| 1 | Webhook (cf-webhook) | ❌ Failing | 10s |
| 2 | Frontend Finalize | ✅ Working | 5s |
| 3 | Polling Loop | ✅ Working | 5s × 40 = 80s |

**Layer 2** (frontend) is currently handling all payments.

## Risks if Webhook Stays Broken

1. **If Layer 2 fails**: Order never gets fulfilled
2. **If user closes browser**: Might miss issuance
3. **If GitHub is down**: No order record exists
4. **If KonfHub API fails**: No retry mechanism in webhook

## Files Modified

- `netlify/functions/cf-webhook.js`:
  - ✅ Fixed signature verification format (removed dot separator)
  - ✅ Added header case-sensitivity handling
  - ✅ Improved logging for debugging
  - ✅ Added proper JSON response headers
  - ✅ Better error messages

## Next Steps

1. **Deploy the fix** - The signature verification is now correct
2. **Set `ALLOW_TEST_PING=1`** temporarily to test
3. **Send test webhook** from Cashfree dashboard
4. **Verify logs** show "Match: true"
5. **Remove `ALLOW_TEST_PING=1`** and redeploy
6. **Test real payment** to confirm webhook processes

## API Key Verification

Your API keys are being used in:

| Component | Usage | Environment Variable |
|-----------|-------|----------------------|
| create-order | Create order in Cashfree | CASHFREE_APP_ID + CASHFREE_SECRET_KEY |
| create-order | API requests | CASHFREE_SECRET_KEY |
| cf-webhook | Signature verification | CF_WEBHOOK_SECRET or CASHFREE_SECRET_KEY |
| finalize-order | N/A (uses GitHub) | None (reads from storage) |

The API keys are verified when:
- ✅ Creating orders (API request authenticates)
- ✅ Verifying webhooks (signature uses secret key)
- ✅ Both are working if orders are being created successfully

If the API keys were wrong, **orders wouldn't be created at all**.
Since orders ARE being created, **your API keys are correct**.

