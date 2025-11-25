# Debug Logging Added - 400 Bad Request Investigation

## Summary
Enhanced logging has been added to `netlify/functions/create-order.js` to diagnose the 400 Bad Request errors occurring during form submission.

## Changes Made

### 1. Input Validation Logging (Lines 232-243)
When form data is received, the function now logs:
- **Form type** (bulk/donation)
- **Name** (truncated for privacy)
- **Email** (truncated for privacy)
- **Phone raw value** (from form)
- **Phone normalized** (after processing)
- **Phone valid?** (regex validation result)
- **Name/Email/Phone OK flags** (boolean checks)

**Logged Output Example:**
```
[create-order] 📝 Input validation: { 
  type: 'bulk', 
  name: 'Samarth V...',
  email: 'samarthv0...',
  phone_raw: '+918310398636',
  phone_normalized: '8310398636',
  phone_valid: true,
  name_ok: true,
  email_ok: true
}
```

If validation fails, also logs:
```
[create-order] ❌ Validation failed: { 
  name: true, 
  email: true, 
  phone: '8310398636', 
  phone_valid: false
}
```

### 2. Cashfree API Logging (Lines 419-446)
Before sending request to Cashfree, logs:
- **Order ID**
- **Amount** (in paisa)
- **Environment** (sandbox/production)
- **API version**
- **Has App ID?** (boolean - doesn't log actual ID)
- **Has Secret Key?** (boolean - doesn't log actual key)

After receiving response, logs:
- **HTTP status code**
- **Response OK?** (boolean)
- **Error message** (if any)

**Logged Output Example:**
```
[create-order] 💳 Cashfree order request: {
  order_id: 'pip_1732..._abc123',
  amount: 2388,
  cfEnv: 'sandbox',
  apiVersion: '2022-09-01',
  hasAppId: true,
  hasSecretKey: true
}

[create-order] Cashfree response: { 
  status: 200, 
  statusOk: true, 
  errorMessage: undefined 
}
```

Or on error:
```
[create-order] Cashfree response: { 
  status: 401, 
  statusOk: false, 
  errorMessage: 'Invalid API credentials' 
}
```

## How to Diagnose Issues

### Step 1: Check Input Validation
When a form submission fails, check the logs for:
1. Is phone being sent from frontend?
2. Does phone normalize correctly?
3. Does phone pass the regex validation?

If phone_valid is `false`, the issue is in the phone field or normalization logic.

### Step 2: Check Cashfree Credentials
If input validation passes but Cashfree response status is not 200:
1. Verify `CASHFREE_APP_ID` and `CASHFREE_SECRET_KEY` are set in Netlify environment variables
2. Check if credentials are for the correct Cashfree environment (sandbox vs production)
3. Verify API version compatibility (currently using `2022-09-01`)

### Step 3: Check Cashfree Error Message
The response now includes `cfMessage` which contains the actual error from Cashfree API. Common errors:
- `"Invalid API credentials"` → Check App ID and Secret Key
- `"Invalid order amount"` → Check if amount is too high/low
- `"Invalid customer email"` → Verify email format
- `"Duplicate order"` → Check if order with same ID exists

## Testing the Fixes

1. **Deploy**: Push changes to GitHub (done: `f561bf7`)
2. **Build**: Netlify should auto-deploy and build functions
3. **Test Form**: Submit bulk registration again
4. **Check Logs**: 
   - Go to Netlify dashboard → Functions → create-order
   - Or check CloudWatch logs if deployed on AWS Lambda
5. **Review Output**: Look for `[create-order]` logs to identify where the 400 error originates

## Phone Validation Logic (Verified)

The phone normalization and validation is correct:

```javascript
normalizeINPhone('+918310398636')
  → Remove non-digits: '918310398636'
  → Starts with 91 & length 12: remove first 2 → '8310398636'
  → Final: '8310398636' ✓

isValidINMobile('8310398636')
  → Regex: /^[6-9]\d{9}$/
  → Starts with 8 (valid 6-9): ✓
  → Length is 10: ✓
  → Result: true ✓
```

## Files Modified
- `netlify/functions/create-order.js` - Added comprehensive logging

## Commit
- **Hash**: `f561bf7`
- **Message**: "Add detailed logging to create-order for debugging 400 Bad Request errors"
- **Branch**: `branch-1`

## Next Steps
1. Trigger form submission to generate logs
2. Review Netlify function logs to identify exact failure point
3. Fix issue based on log output
4. Re-test form submission
5. Once working, can remove or reduce logging verbosity
