# Party In Pink 4.0 — Deployment Guide

## 🚀 Quick Start

### Phase 1: Prepare Environment Variables

Go to your Netlify dashboard → Settings → Environment → Environment Variables

Add these variables:

```
SITE_URL = https://pip.rotaractjpnagar.org
CASHFREE_ENV = sandbox (for PreProd) or production (for Production)
CASHFREE_APP_ID = [Get from Cashfree Dashboard]
CASHFREE_SECRET_KEY = [Get from Cashfree Dashboard]
CASHFREE_API_VERSION = 2025-01-01

GITHUB_TOKEN = [Personal Access Token with repo access]
GITHUB_OWNER = rotaractjpnagar3191
GITHUB_REPO = Party-In-Pink
GITHUB_BRANCH = main

KONFHUB_API_KEY = [Get from KonfHub Dashboard]
KONFHUB_EVENT_ID = [Internal ID from KonfHub]
KONFHUB_FREE_TICKET_ID = [Ticket ID]
KONFHUB_BULK_TICKET_ID = [Ticket ID]

SMTP_HOST = smtp.gmail.com
SMTP_PORT = 587
SMTP_USER = [email@gmail.com]
SMTP_PASS = [App-specific password]
FROM_EMAIL = tickets@rotaractjpnagar.org

BULK_PRICE = 149
COMM_MIN = 12
UNIV_MIN = 20
```

⚠️ **NEVER commit these to GitHub**

---

### Phase 2: Test in PreProd (Staging)

1. **Deploy to Netlify**
   ```bash
   git push origin main
   # Netlify will auto-build and deploy to preview URL
   ```

2. **Test Full Flows**
   - Donation: Visit `/donate.html`, enter test amount, complete payment (sandbox)
   - Bulk: Register team of 12+, verify minimum enforcement
   - Single: Verify KonfHub widget loads
   - Success: Complete order, watch polling on success page

3. **Verify Email Integration**
   - Donate/register → Check email receives confirmation
   - Check sender reputation

4. **Run Lighthouse Audit**
   - https://lighthouse.page/
   - Aim for: Performance >85, SEO >90

---

### Phase 3: Go-Live Checklist

Before switching `CASHFREE_ENV=production`:

- [ ] All preprod tests passed
- [ ] Team confirmed event details (date/time/venue)
- [ ] DNS A record created: `pip.rotaractjpnagar.org → Netlify IP`
- [ ] SSL certificate issued (Netlify auto-provisions)
- [ ] Cashfree production keys acquired
- [ ] GitHub token working
- [ ] SMTP email configured and tested
- [ ] KonfHub event published and widget accessible

---

### Phase 4: Deploy to Production

1. **Update Environment Variable**
   - Change `CASHFREE_ENV = production`
   
2. **Verify DNS**
   - `nslookup pip.rotaractjpnagar.org`
   - Should resolve to Netlify IP

3. **Test Live Payment**
   - Complete a small test donation/registration
   - Verify order created in GitHub
   - Check email received

4. **Monitor**
   - Watch Netlify function logs for errors
   - Monitor Cashfree webhooks
   - Check order storage in GitHub

---

## 🔧 Environment Variables Detailed

### Cashfree Setup
1. Go to: https://dashboard.cashfree.com/
2. Sign in with production credentials
3. Navigate: API Keys section
4. Copy: `Merchant ID` (APP_ID) and `Secret Key`
5. Set environment: `production` (not sandbox)

### GitHub Token Setup
1. Go to: https://github.com/settings/tokens
2. Create Personal Access Token (Classic)
3. Scopes: `repo` (full control of private repositories)
4. Store securely in Netlify

### KonfHub Setup
1. Go to: https://konfhub.com/dashboard
2. Find Event ID and API Key
3. Note down Free & Bulk Ticket IDs
4. Ensure event is published (public)

### SMTP (Gmail Setup)
1. Enable 2-Factor Authentication on Gmail account
2. Generate App-specific password (not regular password)
3. Use app password in `SMTP_PASS`
4. Keep `SMTP_USER` as your full Gmail address

---

## 📊 Monitoring

### Critical Metrics to Watch
1. **Payment Success Rate**: Should be >95%
2. **Order Processing Time**: Should be <30s
3. **Email Delivery**: Check spam folder if missing
4. **Function Errors**: Monitor Netlify logs daily

### Logs Location
- **Netlify Functions**: Dashboard → Functions → Logs
- **Orders**: GitHub repo → `storage/orders/`
- **Email**: SMTP server logs or Gmail sent items

---

## 🚨 Troubleshooting

### "Payment initiation failed"
- Check Cashfree credentials
- Verify network connectivity
- Check CSP header allows Cashfree SDK

### "KonfHub widget not loading"
- Verify widget ID is correct
- Check event is published
- Clear browser cache

### "No orders in GitHub"
- Check GitHub token has repo access
- Verify branch is `main`
- Check function logs for GitHub API errors

### "Emails not received"
- Check SMTP credentials
- Verify FROM_EMAIL is correct
- Check Gmail sent folder
- Review SMTP logs

---

## ✅ Post-Launch Checklist

- [ ] Monitor orders for 24 hours
- [ ] Verify all donations reached KonfHub
- [ ] Check email delivery rate
- [ ] Review analytics (Netlify, Google)
- [ ] Get team feedback on UX
- [ ] Prepare manual backup process for pass issuance

---

## 📞 Support

If issues arise:
1. Check Netlify function logs first
2. Review PREPROD_AUDIT_REPORT.md for known configs
3. Contact Cashfree support for payment issues
4. Contact KonfHub support for ticketing issues

---

**Version**: 1.0  
**Last Updated**: November 21, 2025
