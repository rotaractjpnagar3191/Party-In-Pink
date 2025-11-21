# Party In Pink 4.0 — Preprod/Production Deployment Checklist

## ✅ PRE-DEPLOYMENT VALIDATION (Complete Before Moving to PreProd)

### Website Functionality
- [x] Homepage loads correctly
- [x] Navigation works across all pages
- [x] "About Us" page displays properly
- [x] Donate page: Form submission works, passes highlight correctly
- [x] Register page: KonfHub widget loads
- [x] Bulk page: Club type selection works, pricing updates
- [x] Success page: Polling animation displays
- [x] Footer: Links work, year updates automatically
- [x] Mobile: Hamburger menu toggles, responsive layout
- [x] All internal links work (no 404s)
- [x] All external links use `target="_blank"`

### Event Information
- [x] Date displays: "Sunday, December 14, 2025"
- [x] Time displays: "7:30 AM onwards"
- [x] Venue displays: "SSMRV College, Jayanagar, Bengaluru"
- [x] Impact stat: "₹5L+ raised"
- [x] Contact email: rotaractjpnagar@gmail.com (in footer)

### SEO & Social Media
- [x] Meta description present (160 chars, index.html)
- [x] Keywords present (15+ relevant terms)
- [x] OG:title, description, image set
- [x] OG:url points to `https://pip.rotaractjpnagar.org`
- [x] Twitter card configured
- [x] Favicon present
- [x] All pages have proper title tags
- [x] No 404 status codes on assets

### Security
- [x] CSP header allows all required external resources
- [x] No secrets hardcoded in JavaScript
- [x] Forms use POST (not GET for sensitive data)
- [x] Input validation working (phone, email, amount)
- [x] No SQL injection vulnerabilities
- [x] HTTPS will be enforced on production

### Performance
- [x] App.js is minified (or as small as possible)
- [x] Styles.css is minified
- [x] Images use modern formats (webp where available)
- [x] CSS/JS have cache headers configured
- [x] No console errors on any page
- [x] Page loads in <3 seconds (3G network)

---

## 📋 PREPROD DEPLOYMENT STEPS

### Step 1: Prepare Netlify Environment
- [ ] Log in to Netlify dashboard
- [ ] Navigate to Site Settings → Environment
- [ ] Add all variables from DEPLOYMENT_GUIDE.md
- [ ] Set `CASHFREE_ENV = sandbox` for testing
- [ ] Save all variables

### Step 2: Deploy Code
- [ ] Ensure all changes are committed: `git status` (should be clean)
- [ ] Push to main: `git push origin main`
- [ ] Netlify auto-deploys
- [ ] Monitor build logs
- [ ] Wait for "Deploy published" message

### Step 3: Verify Deployment
- [ ] Visit preview URL (Netlify provides)
- [ ] Check homepage loads
- [ ] Check nav links work
- [ ] Verify SEO meta tags in page source (`<head>`)
- [ ] Run Lighthouse audit (target >85 performance)

### Step 4: Test Payment Flow (Sandbox)
- [ ] Go to `/donate.html`
- [ ] Enter donation: ₹5,000
- [ ] Fill form: name, email, phone
- [ ] Click "Proceed to Payment"
- [ ] Should redirect to Cashfree sandbox
- [ ] Complete test payment (use test card: 4111111111111111)
- [ ] Success page should appear
- [ ] Check order created in GitHub (`storage/orders/`)
- [ ] Verify email sent (check spam folder)

### Step 5: Test Bulk Registration (Sandbox)
- [ ] Go to `/bulk.html`
- [ ] Select "Community"
- [ ] Enter: 12+ passes, club name, email, phone
- [ ] Click "Create Order"
- [ ] Complete test payment
- [ ] Verify success page polling

### Step 6: Test Single Registration
- [ ] Go to `/register.html`
- [ ] Verify KonfHub widget loads (takes 2-3 seconds)
- [ ] Try selecting passes (if possible in sandbox)

### Step 7: Validate Email Integration
- [ ] Donate → Check email received donation confirmation
- [ ] Bulk → Check email received registration confirmation
- [ ] Verify sender: `tickets@rotaractjpnagar.org`
- [ ] Check email is not in spam
- [ ] Verify email contains order details

### Step 8: Test Error Scenarios
- [ ] Try invalid phone: Should show error
- [ ] Try empty email: Should show error
- [ ] Try amount < ₹100: Should show error
- [ ] Network disconnect during payment: Should timeout gracefully
- [ ] Try bulk with insufficient passes: Should enforce minimum

### Step 9: Mobile Testing (Real Device)
- [ ] Open on iPhone (or Android)
- [ ] Nav hamburger works
- [ ] Donate form fills properly on mobile
- [ ] Buttons are touch-friendly (>48px)
- [ ] No horizontal scroll
- [ ] Images load

### Step 10: Performance Testing
- [ ] Use Chrome DevTools Network tab
- [ ] Throttle to "Slow 3G"
- [ ] Load homepage
- [ ] Should load in <5 seconds
- [ ] Run Lighthouse audit: Performance >80

---

## 🚀 PRODUCTION DEPLOYMENT STEPS

### ⚠️ PRE-GO-LIVE CHECKLIST
- [ ] All PreProd tests passed
- [ ] Team confirms event details are correct
- [ ] Cashfree production account active
- [ ] Cashfree production keys obtained
- [ ] GitHub token created and working
- [ ] SMTP credentials tested
- [ ] KonfHub event published
- [ ] DNS configured (if needed)

### Step 1: Update Cashfree Environment
- [ ] In Netlify Environment Variables
- [ ] Change: `CASHFREE_ENV = production`
- [ ] Update: `CASHFREE_APP_ID` → production ID
- [ ] Update: `CASHFREE_SECRET_KEY` → production secret
- [ ] ⚠️ Triple-check these values

### Step 2: Configure DNS (if not done)
- [ ] DNS provider: Add A record
  - Subdomain: `pip`
  - Points to: Netlify IP (get from Netlify dashboard)
  - TTL: 3600 (1 hour)
- [ ] Or: Add CNAME (if preferred)
  - Subdomain: `pip`
  - Points to: `[sitename].netlify.app`
- [ ] Wait for DNS to propagate (5-30 mins)
- [ ] Verify: `nslookup pip.rotaractjpnagar.org` resolves

### Step 3: Verify SSL Certificate
- [ ] Netlify auto-provisions HTTPS
- [ ] Visit: `https://pip.rotaractjpnagar.org`
- [ ] Should show green lock icon
- [ ] No SSL warnings

### Step 4: First Live Test
- [ ] Visit production URL: `https://pip.rotaractjpnagar.org`
- [ ] Test donation with small amount (₹100)
- [ ] Complete real payment (use real payment method, get refund later if needed)
- [ ] Verify order in GitHub
- [ ] Verify email received

### Step 5: Monitor for 24 Hours
- [ ] Check Netlify function logs
- [ ] Monitor for errors
- [ ] Watch order volume
- [ ] Verify all orders reach KonfHub
- [ ] Check email delivery

### Step 6: Post-Launch Communication
- [ ] Announce site live to team
- [ ] Share URL in social media / email
- [ ] Brief support team on manual order handling
- [ ] Document rollback procedure (if needed)

---

## 🔴 ROLLBACK PROCEDURE (If Critical Issue)

If critical bug discovered in production:

1. **Identify Issue**: Check Netlify function logs
2. **Rollback Code**: 
   - `git revert [commit-hash]` or
   - Deploy previous working commit
3. **Revert Cashfree**: Set `CASHFREE_ENV = sandbox` (pause payments)
4. **Notify Team**: Brief on what happened
5. **Fix & Redeploy**: After fixing, change back to production and redeploy

---

## 📊 MONITORING & MAINTENANCE

### Daily (First Week)
- [ ] Check order count vs expected
- [ ] Verify no function errors
- [ ] Spot-check order data in GitHub
- [ ] Monitor email delivery

### Weekly
- [ ] Review Lighthouse scores
- [ ] Check error rates
- [ ] Validate data integrity

### Before Event Day
- [ ] Verify all orders imported to KonfHub
- [ ] Test manual check-in process
- [ ] Brief ops team on day-of procedures

---

## 🎯 Success Criteria

Production deployment is successful when:
1. ✅ Site loads on `pip.rotaractjpnagar.org` with HTTPS
2. ✅ Donations are processed and reach KonfHub
3. ✅ Registrations are recorded
4. ✅ Emails are delivered (check inbox, not spam)
5. ✅ No errors in Netlify function logs
6. ✅ Lighthouse score >85 for performance
7. ✅ Zero downtime for first 48 hours

---

## 📞 Escalation Path

| Issue | Owner | Contact |
|-------|-------|---------|
| Payment failures | Cashfree | support@cashfree.com |
| Registration issues | KonfHub | KonfHub support |
| Website errors | Dev Team | Check Netlify logs |
| Email not received | SMTP provider | Gmail/SMTP logs |
| Order data missing | Dev | GitHub repo check |

---

## ✨ Additional Notes

- **Backup**: All orders auto-saved to GitHub `storage/orders/`
- **Revert**: Easy to revert to sandbox if needed (change env var)
- **Monitoring**: No active monitoring setup yet—set up after launch
- **Analytics**: Consider adding Google Analytics for tracking

---

**Checklist Version**: 1.0  
**Last Updated**: November 21, 2025  
**Status**: Ready for deployment approval

---

### Sign-Off

- [ ] Project Lead: _________________
- [ ] Tech Lead: _________________
- [ ] Date Approved: _________________
- [ ] Deployment Date: _________________
