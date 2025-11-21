# Deployment Checklist: Infinite Loop Fix

## Pre-Deployment Verification ✓

- [x] Webhook deduplication added (cf-webhook.js)
- [x] 5-second issuance cooldown added (finalize-order.js + cf-webhook.js)
- [x] Success page finalize() auto-call REMOVED (app.js)
- [x] finalize() single-call guard added (app.js)
- [x] Documentation created (INFINITE_LOOP_FIX.md)

## Deploy Steps

### Step 1: Verify GitHub Token is Valid ⭐ CRITICAL
Before deploying, **ENSURE** you have:

1. Created a NEW GitHub Personal Access Token at https://github.com/settings/tokens
2. Selected **repo** scope
3. Updated `GITHUB_TOKEN` in Netlify environment variables
4. This must be done BEFORE deploying, or fixes won't work

### Step 2: Git Operations
```bash
# Stage all changes
git add -A

# Commit with clear message
git commit -m "Fix: Prevent infinite donor pass loop - add webhook deduplication & cooldown"

# Push to GitHub
git push origin main
```

### Step 3: Deploy to Netlify
Option A: Automatic (recommended)
- Netlify auto-deploys when you push to main
- Check https://app.netlify.com → Deploys tab
- Wait for green ✓ status

Option B: Manual
- Go to https://app.netlify.com
- Select site: pip.rotaractjpnagar.org
- Click "Trigger deploy" → "Deploy site"

### Step 4: Verify Deployment
1. Go to Functions tab in Netlify dashboard
2. Verify all functions deployed successfully
3. Check for any build errors

## Testing After Deployment

### Test 1: Make a Donation
1. Go to https://pip.rotaractjpnagar.org/donate.html
2. Enter amount: ₹2,985
3. Complete payment with test credentials
4. Monitor:
   - ✅ Success page shows "Tickets issued"
   - ✅ Success page completes quickly (no 80-second wait)
   - ✅ Check email for only ONE set of tickets (not 4)
   - ✅ Check Netlify logs for success patterns

### Test 2: Monitor Logs
1. Go to Netlify dashboard
2. Click Functions → cf-webhook
3. Look for new invocations
4. Verify you see:
   - `[cf-webhook] ===== WEBHOOK INVOKED =====` (only ONCE per payment, or multiple with DUPLICATE message)
   - `[cf-webhook] Issuance succeeded:` (only ONCE)
   - `[cf-webhook] Order updated and saved` (only ONCE)

### Test 3: Check GitHub Storage
1. Go to GitHub: https://github.com/rotaractjpnagar3191/Party-In-Pink
2. Navigate to: storage/orders/
3. Find order from test payment
4. Verify JSON contains:
   - `"fulfilled": { "status": "ok", ... }` (only set once)
   - `"processed_webhooks": [...]` (should show 1-4 entries, not more)
   - `"last_issued_at": "2025-11-21T..."` (single timestamp)

### Test 4: Rapid Retry (Edge Case)
1. Call finalize-order endpoint twice rapidly:
```bash
curl -X POST https://pip.rotaractjpnagar.org/api/finalize-order \
  -H "Content-Type: application/json" \
  -d '{"order_id":"pip_1763732094526_7bar9l"}'
```

2. Second call should return: `"Recently issued (within 5s)"`
3. Verify NO extra tickets issued

## Rollback Plan (If Issues)

If issues occur:

1. **Identify the problem** from logs
2. **Revert last commit**:
   ```bash
   git revert HEAD
   git push
   ```
3. **Netlify auto-redeploys** in ~30 seconds
4. **Contact** if needed with order IDs and logs

## Success Criteria

✅ Fix is successful if:
1. Each donation creates exactly ONE set of donor passes
2. Success page completes within 30 seconds (not 80)
3. No duplicate tickets in recipient email inbox
4. Order JSON shows single `fulfilled` status
5. Webhook logs show duplicate detection working

❌ If you still see:
- Multiple sets of the same tickets
- Continuous "Issuance succeeded" logs
- More than one `fulfilled` status set

Then **STOP** and check:
1. Is GitHub token valid and set in Netlify?
2. Are there GitHub auth errors in logs?
3. Has deployment completed successfully?

---

## Commands Reference

### Verify files changed
```bash
git status
```

### See what changed in each file
```bash
git diff HEAD
```

### Undo all changes before push (if needed)
```bash
git reset --hard
```

### Check deployment status
```bash
git log --oneline -5  # See recent commits
```

---

## Time Estimate

- Deployment: 1-2 minutes
- Testing: 5-10 minutes
- Total: ~15 minutes

---

## Support

If deployment fails:
1. Check GitHub/Netlify status pages (rare)
2. Verify all env vars set correctly in Netlify
3. Check function logs for build errors
4. Reach out with full error messages

**Most common issue:** Invalid GitHub token → causes immediate failure in logs
