# Webhook Fix - Code Changes

## Summary

Fixed the Cashfree webhook signature verification to match the API v2025-01-01 specification.

---

## The Change

### Before (WRONG) ❌

```javascript
// Old code - WRONG signature format
const messageToSign = `${ts}.${raw.toString('utf8')}`;
const expected = crypto
  .createHmac('sha256', SECRET)
  .update(messageToSign)
  .digest('base64');

if (expected !== sig) return respond(ALLOW_TEST_PING ? 200 : 401, 'Invalid signature');
```

**Problem**: Uses dot separator: `timestamp.body`
- Cashfree sends: `timestamp + body` (no separator)
- Result: Signature mismatch, webhook returns 401

### After (CORRECT) ✅

```javascript
// New code - CORRECT signature format per Cashfree API v2025-01-01
const signatureString = ts + raw.toString('utf8');
const expected = crypto
  .createHmac('sha256', SECRET)
  .update(signatureString)
  .digest('base64');

console.log('[cf-webhook] Signature verification:');
console.log('[cf-webhook] - Timestamp:', ts);
console.log('[cf-webhook] - Raw body length:', raw.toString('utf8').length);
console.log('[cf-webhook] - Expected signature:', expected);
console.log('[cf-webhook] - Received signature:', sig);
console.log('[cf-webhook] - Match:', expected === sig);

if (expected !== sig) {
  console.warn('[cf-webhook] ⚠️  SIGNATURE MISMATCH');
  if (!ALLOW_TEST_PING) {
    return respond(401, 'Invalid signature');
  }
  console.warn('[cf-webhook] Continuing because ALLOW_TEST_PING=1');
}
```

**Solution**: 
- Uses correct format: `timestamp + body` (direct concatenation)
- Matches Cashfree API specification
- Added detailed logging for debugging
- Allows test mode bypass for development

---

## Signature Verification Comparison

### How Cashfree v2025-01-01 Expects It

```
Message to Sign = timestamp + rawBody

Example:
timestamp: "1746427759733"
rawBody: '{"data":{"order":{"order_id":"order_123",...}}}'

messageToSign = "1746427759733" + '{"data":{"order":{"order_id":"order_123",...}}}'

HMAC-SHA256(messageToSign, secretKey) = base64_signature
```

### What We Were Doing (WRONG)

```
Message to Sign = timestamp + "." + rawBody

This added an extra dot character between them
messageToSign = "1746427759733.{"data":...}"
                              ↑ Wrong!
```

### What We Should Do (CORRECT)

```
Message to Sign = timestamp + rawBody

Direct concatenation, no dot
messageToSign = "1746427759733{"data":...}"
                ↓ Correct!
```

---

## Response Format

### Before
```javascript
const response = {
  statusCode,
  body: typeof body === 'string' ? body : JSON.stringify(body)
};
```

### After
```javascript
const response = {
  statusCode,
  headers: {
    'content-type': 'application/json',
    'cache-control': 'no-cache'
  },
  body: typeof body === 'string' ? JSON.stringify({ message: body }) : JSON.stringify(body)
};
```

**Improvements**:
- Proper JSON response headers
- Ensures Cashfree knows it's JSON
- Cache control headers
- Consistent JSON response format

---

## Testing the Fix

### Automatic Test Script

```bash
node test-webhook-signature.js
```

This verifies the signature generation with sample data.

### Manual Verification

```javascript
const crypto = require('crypto');
const timestamp = '1746427759733';
const secretKey = 'test_secret';
const rawBody = '{"test":"data"}';

const messageToSign = timestamp + rawBody;  // Correct format
const signature = crypto
  .createHmac('sha256', secretKey)
  .update(messageToSign)
  .digest('base64');

console.log('Signature:', signature);
// This is what Cashfree would have sent
```

---

## Environment Variables

Ensure these are set:

```env
CASHFREE_APP_ID=<your_api_key>
CASHFREE_SECRET_KEY=<your_secret_key>

# Optional: Can use different secret for webhooks
CF_WEBHOOK_SECRET=<optional_webhook_secret>

# For testing (remove after verification)
ALLOW_TEST_PING=1
```

---

## Files Changed

- `netlify/functions/cf-webhook.js`
  - Line 31-53: Fixed signature verification format
  - Line 209-217: Improved response headers

---

## Deployment

```bash
# Commit the changes
git add netlify/functions/cf-webhook.js
git commit -m "Fix Cashfree webhook signature verification

- Changed from ts.body format to ts+body format
- Matches Cashfree API v2025-01-01 specification
- Added detailed logging for debugging
- Improved response headers"

# Deploy
git push
```

---

## Verification Checklist

- [ ] Code changes deployed
- [ ] Set `ALLOW_TEST_PING=1` in environment
- [ ] Test webhook sent from Cashfree dashboard
- [ ] Logs show "Match: true"
- [ ] Webhook returns HTTP 200
- [ ] Remove `ALLOW_TEST_PING=1`
- [ ] Test real payment
- [ ] Webhook processes automatically
- [ ] Passes issued before user sees success page (or fallback works)

---

## References

- **Cashfree API v2025-01-01**: https://www.cashfree.com/docs/payments/no-code/payment-forms/webhooks
- **Webhook Signature Verification**: Direct concatenation: `timestamp + rawBody`
- **Test Endpoint**: POST to `{SITE_URL}/api/cf-webhook`

