# Party in Pink 4.0 — Landing + Registration (Cashfree)  
_Static HTML/CSS/JS + Vercel Functions + Cashfree + (optional) email + KonfHub-style features_

This repo gives you a **minimal, fast** event site like JP Nagar’s (plain HTML/CSS/JS) with just enough backend via **Vercel Functions** to securely handle payments and tickets. No full database needed — we use **Vercel KV (Upstash free)** for inventory, coupons, and order metadata.

---

## ✨ Features 

- **Multiple ticket tiers** (e.g., Early Bird / Regular)  
  — price, sale window, max per order, inventory caps  
- **Coupons / promo codes**  
  — flat or % discounts, per-tier applicability, usage limits  
- **Optional donation** add-on  
- **Cashfree Checkout** (sandbox or production)  
- **Webhook-driven** status updates (PAID → issue ticket, decrement inventory/coupon usage)  
- **PDF ticket with QR** (download link + optional email via SendGrid)  
- **Check-in page** (manual order-ID entry or open QR link)  
- **CSV export** (admin-key protected)  
- **Resend ticket** (admin-key protected)

> Advanced (later): refunds (Cashfree API), GST invoice, waitlist, camera barcode scanner, speaker schedule, etc.

---

## 🧱 Stack

- **Frontend:** Plain HTML/CSS/JS (no framework)  
- **Serverless:** Vercel Functions (Node 18+)  
- **Payments:** Cashfree PG (Payment Session / Order Token)  
- **Storage:** Vercel KV (Upstash free)  
- **Email (optional):** SendGrid

---

## 📁 Project Structure

