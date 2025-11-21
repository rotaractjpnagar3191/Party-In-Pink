# Setting Up Subdomain DNS for pip.rotaractjpnagar.org in Netlify

## Overview
You have two options:
1. **Point DNS to Netlify** (Netlify manages DNS)
2. **Use CNAME at current DNS provider** (Keep DNS elsewhere, just alias subdomain)

Based on your setup, I recommend **Option 2** (simpler, less disruptive).

---

## Option 1: Use Netlify DNS (Full DNS Management)

### Step 1: Add Domain to Netlify
1. Go to your Netlify dashboard
2. Select **Party-In-Pink** site
3. Navigate to: **Site Settings** → **Domain Management**
4. Click **Add domain**
5. Enter: `pip.rotaractjpnagar.org`
6. Click **Verify**

### Step 2: Change Nameservers at Your DNS Provider
Netlify will give you 4 nameservers. Go to where you manage `rotaractjpnagar.org` DNS (GoDaddy, Route53, etc.) and update the nameservers.

Example:
```
ns1.netlify.com
ns2.netlify.com
ns3.netlify.com
ns4.netlify.com
```

⚠️ **Warning**: This affects the entire `rotaractjpnagar.org` domain. Only do this if you're moving all DNS to Netlify.

---

## Option 2: Use CNAME (Recommended - No Disruption)

### Step 1: Get Your Netlify Site URL
1. Go to your Netlify site dashboard
2. Look for **Site name** (e.g., `party-in-pink-4.netlify.app`)
3. Copy the full URL

### Step 2: Add CNAME at Your Current DNS Provider

Go to where you manage `rotaractjpnagar.org` DNS (GoDaddy, Namecheap, CloudFlare, etc.):

**Create a new DNS record:**
```
Type:  CNAME
Name:  pip
Value: party-in-pink-4.netlify.app
TTL:   3600 (1 hour)
```

### Step 3: Verify in Netlify
1. Netlify dashboard → **Domain Management**
2. Click **Add domain**
3. Enter: `pip.rotaractjpnagar.org`
4. Netlify will check if CNAME exists and auto-verify

### Step 4: Wait for DNS Propagation
- Takes 5-30 minutes typically
- Check: `nslookup pip.rotaractjpnagar.org`
- Should resolve to Netlify servers

---

## Step-by-Step: Using GoDaddy (Most Common)

If your DNS is at **GoDaddy**:

1. **Log in to GoDaddy.com**
2. Go to **Manage My Domains** → **rotaractjpnagar.org**
3. Click **DNS** (or **Nameservers**)
4. Find the **DNS Records** section
5. Click **Add** (or **+** button)
6. Fill in:
   ```
   Record Type: CNAME
   Name:        pip
   Value:       party-in-pink-4.netlify.app
   TTL:         3600
   ```
7. Click **Save**
8. Wait 5-30 minutes for propagation

---

## Step-by-Step: Using CloudFlare

If your DNS is at **CloudFlare**:

1. **Log in to CloudFlare.com**
2. Go to your **rotaractjpnagar.org** domain
3. Navigate to **DNS** tab
4. Click **Add record**
5. Fill in:
   ```
   Type:   CNAME
   Name:   pip
   Target: party-in-pink-4.netlify.app
   TTL:    Auto (or 3600)
   ```
6. Click **Save**
7. Wait for propagation

---

## Step-by-Step: Using Route53 (AWS)

If your DNS is at **Route53**:

1. **Log in to AWS Console**
2. Go to **Route 53** → **Hosted Zones**
3. Select **rotaractjpnagar.org**
4. Click **Create record**
5. Fill in:
   ```
   Record name: pip
   Record type: CNAME
   Value:       party-in-pink-4.netlify.app
   TTL:         3600
   ```
6. Click **Create records**
7. Wait for propagation

---

## Verify DNS Setup

### Check via Command Line
```powershell
nslookup pip.rotaractjpnagar.org
```

Expected output (after propagation):
```
Name:    pip.rotaractjpnagar.org
Address: 75.2.x.x (Netlify's IP)
```

### Check via Online Tools
- https://dns-propagation-checker.io/
- https://mxtoolbox.com/
- Enter: `pip.rotaractjpnagar.org`

---

## Enable HTTPS (SSL Certificate)

### In Netlify
1. Go to **Site Settings** → **Domain Management**
2. Your domain `pip.rotaractjpnagar.org` should appear
3. Click **Set as primary domain** (optional)
4. Netlify auto-provisions **Let's Encrypt SSL** certificate
5. Wait ~5 minutes
6. Visit `https://pip.rotaractjpnagar.org` (should show 🔒 green lock)

### Verify SSL
- Visit: `https://pip.rotaractjpnagar.org`
- Should load without warnings
- Check certificate: Click 🔒 lock icon

---

## Update Your .env File

After DNS is live, update:

```env
# From:
SITE_URL=http://localhost:8888

# To:
SITE_URL=https://pip.rotaractjpnagar.org
```

Then:
1. Commit & push
2. Netlify rebuilds with new SITE_URL
3. Test payment links work correctly

---

## Troubleshooting

### DNS Not Resolving
- **Problem**: `nslookup` returns "Non-existent domain"
- **Solution**: 
  - Wait 5-30 minutes
  - Check CNAME entry is spelled correctly
  - Verify no trailing dots

### SSL Certificate Not Issuing
- **Problem**: "Certificate pending" in Netlify
- **Solution**:
  - Wait 10-15 minutes
  - Ensure DNS is propagated
  - Refresh Netlify dashboard

### Redirects Not Working
- **Problem**: `pip.rotaractjpnagar.org` doesn't load site
- **Solution**:
  - Check CNAME points to correct Netlify domain
  - Verify site is deployed in Netlify
  - Check netlify.toml redirects

### Mixed Content Error
- **Problem**: "This page has insecure content"
- **Solution**:
  - Ensure netlify.toml has: `upgrade-insecure-requests`
  - Update all external resources to HTTPS

---

## Quick Reference

| Task | How |
|------|-----|
| **Get Netlify site domain** | Dashboard → Site info → Site URL |
| **Add CNAME** | Go to DNS provider → Add CNAME record |
| **Verify DNS** | `nslookup pip.rotaractjpnagar.org` |
| **Check SSL** | Visit https://pip.rotaractjpnagar.org → Check 🔒 lock |
| **Update .env** | Change SITE_URL to `https://pip.rotaractjpnagar.org` |

---

## Recommended Setup Order

1. ✅ Deploy site to Netlify (already done)
2. ⏳ **Add CNAME to DNS provider** (next)
3. ⏳ Wait 5-30 mins for DNS propagation
4. ⏳ Verify in Netlify dashboard
5. ⏳ Check SSL certificate issued
6. ⏳ Update .env file
7. ⏳ Rebuild on Netlify
8. ✅ Test live: `https://pip.rotaractjpnagar.org`

---

## Notes

- **No server setup needed** - Netlify handles hosting
- **SSL is automatic** - Let's Encrypt via Netlify
- **DNS caching** - Changes may take time to propagate
- **Multiple subdomains** - Can add more later (e.g., `admin.rotaractjpnagar.org`)

---

**Next Step**: 
1. Identify where your DNS is hosted (GoDaddy, CloudFlare, Route53, etc.)
2. Add the CNAME record above
3. Wait for propagation (~15 mins typically)
4. Test in browser
5. Update .env and redeploy

Let me know if you need help with your specific DNS provider!
