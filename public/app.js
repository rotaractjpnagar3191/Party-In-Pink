// ===== Party in Pink 4.0 — unified site JS ==================================

// ========== GLOBAL ERROR HANDLING & SESSION MANAGEMENT ==========

// Session timeout tracking (30 minutes of inactivity)
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
let sessionTimer = null;
let lastActivityTime = Date.now();

function resetSessionTimer() {
  lastActivityTime = Date.now();
  
  if (sessionTimer) clearTimeout(sessionTimer);
  
  sessionTimer = setTimeout(() => {
    // Mark session as expired
    sessionStorage.setItem('pip_session_expired', 'true');
    window.location.href = `timeout.html?from=${encodeURIComponent(window.location.pathname)}`;
  }, SESSION_TIMEOUT);
}

function checkSessionExpiration() {
  if (sessionStorage.getItem('pip_session_expired') === 'true') {
    sessionStorage.removeItem('pip_session_expired');
    window.location.href = `timeout.html?from=${encodeURIComponent(window.location.pathname)}`;
  }
}

// Track activity to reset session timer
['mousedown', 'keydown', 'scroll', 'touchstart'].forEach(eventType => {
  document.addEventListener(eventType, () => {
    // Only reset if we're not already on error/timeout/cancel pages
    if (!window.location.pathname.match(/\/(error|timeout|cancel|success)\.html/)) {
      resetSessionTimer();
    }
  }, { passive: true });
});

// Check on page load
checkSessionExpiration();

// Global error handler for uncaught exceptions
window.addEventListener('error', (event) => {
  console.error('[global-error] Uncaught error:', event.error?.message || event.message);
  console.error('[global-error] Stack:', event.error?.stack);
  
  // Don't redirect on certain pages
  if (!window.location.pathname.match(/\/(error|timeout|cancel|success)\.html/)) {
    // Store error details
    sessionStorage.setItem('pip_last_error', JSON.stringify({
      message: event.error?.message || event.message,
      code: 'UNCAUGHT_ERROR',
      timestamp: new Date().toISOString()
    }));
  }
});

// Global rejection handler for unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  console.error('[global-rejection] Unhandled rejection:', event.reason?.message || event.reason);
  console.error('[global-rejection] Stack:', event.reason?.stack);
  
  if (!window.location.pathname.match(/\/(error|timeout|cancel|success)\.html/)) {
    sessionStorage.setItem('pip_last_error', JSON.stringify({
      message: event.reason?.message || String(event.reason),
      code: 'UNHANDLED_REJECTION',
      timestamp: new Date().toISOString()
    }));
  }
});

// Network status listener
window.addEventListener('offline', () => {
  console.warn('[network] Going offline');
  sessionStorage.setItem('pip_offline_at', new Date().toISOString());
});

window.addEventListener('online', () => {
  console.log('[network] Going online');
  sessionStorage.removeItem('pip_offline_at');
});

// Cache buster: automatically reload on CSS changes
(() => {
  const now = new Date().toISOString().split('T')[0];
  const stored = localStorage.getItem('pip-cache-date');
  if (stored !== now) {
    localStorage.setItem('pip-cache-date', now);
    // Clear any old cached resources
    if ('caches' in window) {
      caches.keys().then(names => names.forEach(name => caches.delete(name)));
    }
  }
})();

// ---------- NAV ----------
(() => {
  const t = document.getElementById("navToggle");
  const m = document.querySelector(".main-nav");
  if (!t || !m) return;
  t.addEventListener("click", () => {
    const open = m.classList.toggle("show");
    t.setAttribute("aria-expanded", open ? "true" : "false");
  });
})();

// ---------- Helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const rupee = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");

function normalizeINPhone(raw) {
  if (!raw) return "";
  let s = String(raw).replace(/\D/g, "");
  if (s.startsWith("91") && s.length === 12) s = s.slice(2);
  if (s.startsWith("0") && s.length === 11) s = s.slice(1);
  return s;
}
function isValidINMobile(s) {
  return /^[6-9]\d{9}$/.test(s);
}
function phonePattern() {
  return "^(?:\\+?91[-\\s]?|0)?[6-9]\\d{9}$";
}

// read CSS var with fallback
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}
const RING = cssVar("--ring", "#F48FB1");

// Optional loader overlay
const GlobalLoader = {
  el: null,
  ensure() {
    if (!this.el) {
      this.el = document.createElement("div");
      this.el.className = "loader-overlay";
      this.el.innerHTML =
        '<div class="spinner" role="progressbar" aria-label="Loading"></div>';
      document.body.appendChild(this.el);
    }
  },
  show() {
    this.ensure();
    this.el.setAttribute("aria-busy", "true");
  },
  hide() {
    this.ensure();
    this.el.setAttribute("aria-busy", "false");
  },
};

// ---------- Config ----------
let CFG = null;
function parseSlabs(val) {
  if (Array.isArray(val)) {
    return val
      .map((x) => ({ amount: Number(x.amount), passes: Number(x.passes), tier: x.tier }))
      .filter((x) => Number.isFinite(x.amount) && Number.isFinite(x.passes))
      .sort((a, b) => a.amount - b.amount);
  }
  if (typeof val === "object" && val !== null) {
    return Object.entries(val)
      .map(([k, v]) => ({ amount: Number(k), passes: Number(v), tier: v.tier }))
      .filter((x) => Number.isFinite(x.amount) && Number.isFinite(x.passes))
      .sort((a, b) => a.amount - b.amount);
  }
  if (typeof val === "string") {
    return val
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((part) => {
        const [a, p] = part.split(":").map((x) => x.trim());
        return { amount: Number(a), passes: Number(p) };
      })
      .filter((x) => Number.isFinite(x.amount) && Number.isFinite(x.passes))
      .sort((a, b) => a.amount - b.amount);
  }
  return [];
}
async function loadConfig() {
  const r = await fetch("/api/config", { cache: "no-store" }).catch(() => null);
  if (!r || !r.ok) return null;
  CFG = await r.json();
  CFG.__SLABS_PARSED__ = parseSlabs(CFG.SLABS);

  $$("[data-bulk-price]").forEach((n) => (n.textContent = CFG.BULK_PRICE));
  const mc = $("[data-min-community]");
  if (mc) mc.textContent = CFG.COMM_MIN;
  const mu = $("[data-min-university]");
  if (mu) mu.textContent = CFG.UNIV_MIN;
  return CFG;
}

// ---------- Razorpay Payment Gateway ----------
let RAZORPAY_READY = false;

function loadRazorpay() {
  return new Promise((resolve, reject) => {
    if (RAZORPAY_READY) return resolve();
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.async = true;
    s.onload = () => {
      RAZORPAY_READY = true;
      resolve();
    };
    s.onerror = () => reject(new Error("Failed to load Razorpay SDK"));
    document.head.appendChild(s);
  });
}

async function openRazorpayCheckout(orderData) {
  try {
    await loadRazorpay();
    
    // Razorpay expects handler callbacks
    const options = {
      key: orderData.key_id,
      order_id: orderData.razorpay_order_id,
      amount: orderData.amount * 100, // Convert to paise
      currency: "INR",
      name: "Party In Pink",
      description: "Registration & Ticketing",
      image: "https://pip.rotaractjpnagar.org/assets/logos/PiP_Black.png",
      handler: async function(response) {
        // Payment successful - save order ID and redirect to success page
        sessionStorage.setItem('pip_order_id', orderData.order_id);
        sessionStorage.setItem('pip_razorpay_payment_id', response.razorpay_payment_id);
        window.location.href = `/success.html?order=${orderData.order_id}&type=bulk`;
      },
      prefill: {
        name: sessionStorage.getItem('pip_name') || '',
        email: sessionStorage.getItem('pip_email') || '',
        contact: sessionStorage.getItem('pip_phone') || '',
      },
      theme: {
        color: "#E91E63"
      },
      modal: {
        ondismiss: function() {
          console.log('Razorpay checkout dismissed');
          alert('Payment cancelled. Please try again.');
        }
      }
    };

    const rzp1 = new Razorpay(options);
    rzp1.open();
  } catch (err) {
    console.error("Razorpay checkout error:", err);
    alert("Payment initiation failed. Please try again or refresh the page.");
  }
}

function goToPayment(resp) {
  // Check if this is a Razorpay response
  if (resp.razorpay_order_id && resp.key_id) {
    openRazorpayCheckout(resp);
    return;
  }
  
  // Fallback: check for redirect_url
  if (resp.redirect_url) {
    location.href = resp.redirect_url;
    return;
  }
  
  const url = resp.url || resp.payment_link || resp.link;
  if (url) {
    location.href = url;
    return;
  }
  
  console.error("goToPayment: No payment method found", resp);
  const debugMsg = JSON.stringify(resp, null, 2);
  alert(`Could not start payment. Response: ${debugMsg}\n\nPlease ensure payment gateway is configured and try again, or contact support.`);
}
async function postJSON(url, data, btn) {
  let spinner = null;
  try {
    if (btn) {
      btn.disabled = true;
      spinner = document.createElement("span");
      spinner.className = "spinner";
      btn.prepend(spinner);
    }
    
    // Create AbortController with 15s timeout for payment service calls
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 15000);
    
    let r;
    try {
      r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
        signal: abortController.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    
    const text = await r.text();
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      j = { raw: text };
    }
    
    if (!r.ok) {
      const errorMsg = j?.details?.message || j?.error || text || "HTTP " + r.status;
      
      // Determine error type and code
      let errorCode = 'UNKNOWN';
      if (r.status === 0) {
        errorCode = 'NETWORK';
      } else if (r.status === 408 || r.status === 504 || r.status === 503) {
        errorCode = 'TIMEOUT';
      } else if (r.status >= 500) {
        errorCode = 'SERVER';
      } else if (r.status === 400 || r.status === 422) {
        errorCode = 'VALIDATION';
      } else if (r.status === 402) {
        errorCode = 'PAYMENT';
      }
      
      throw new Error(errorMsg || `Server error (${r.status})`, { cause: { code: errorCode, status: r.status } });
    }
    
    return j;
  } catch (err) {
    // Handle different error types
    let errorCode = 'UNKNOWN';
    
    if (err.name === 'AbortError') {
      errorCode = 'TIMEOUT';
      throw new Error('Request timeout. The payment service took too long to respond. Please try again.', { cause: { code: errorCode } });
    } else if (err.cause?.code) {
      errorCode = err.cause.code;
    } else if (!navigator.onLine) {
      errorCode = 'NETWORK';
      throw new Error('You appear to be offline. Check your internet connection and try again.', { cause: { code: errorCode } });
    }
    
    throw err;
  } finally {
    if (btn) {
      btn.disabled = false;
      if (spinner) spinner.remove();
    }
  }
}

// ---------- Index (hero, counters) ----------
async function initIndex() {
  if (!document.querySelector(".hero")) return;

  const EVENT = {
    date: "Sunday, December 14, 2025",
    time: "7:30 AM onwards",
    venue: "SSMRV College, Jayanagar, Bengaluru",
  };
  try {
    await loadConfig();
  } catch {}

  // No optional-chaining on assignment (it is illegal on LHS)
  const eDate = $("#evtDate");
  if (eDate) eDate.textContent = EVENT.date;
  const eTime = $("#evtTime");
  if (eTime) eTime.textContent = EVENT.time;
  const eVenue = $("#evtVenue");
  if (eVenue) eVenue.textContent = EVENT.venue;

  $$(".stat .num").forEach((el) => {
    const end = Number(el.getAttribute("data-countto") || 0);
    let c = 0,
      steps = 20;
    const inc = Math.max(1, Math.ceil(end / steps));
    (function tick() {
      c = Math.min(end, c + inc);
      el.textContent = String(c);
      if (c < end) requestAnimationFrame(tick);
    })();
  });

  // Load partner and club logos
  const partnersGrid = $("#partnersGrid");
  const clubsGrid = $("#clubsGrid");

  const partnerLogos = [
    "Akash.png",
    "e-relax.png",
    "HIPOWER - Logo  - SVG (1).svg",
    "Hypeexperts2_optimized.png",
    "ICON logo.png",
    "Jusgrabs.png",
    "Keerti Technologies.jpeg",
    "NXT Power.jpeg",
    "Sasya_Shyamale-removebg-preview.png",
    "smartgenie.png",
    "tag.png",
    "tie.png",
    "UK International.png",
    "Vishwanath Vajramuni Trust (R).PNG"
  ];

  const clubLogos = [
    "bmscm.png",
    "bmscw.png",
    "Innerwheel JP Nagar.jpeg",
    "Logo on White and Yellow Background_optimized.png",
    "Oriongateway.png",
    "Rac Jayanagar.jpeg",
    "RCBSW Logo.png"
  ];

  if (partnersGrid) {
    partnersGrid.innerHTML = partnerLogos.map((name) => 
      `<div class="logo"><img src="assets/logos/partners/${name}" alt="Partner logo" loading="lazy" onerror="this.parentElement.style.opacity='0.3'" /></div>`
    ).join("");
  }

  if (clubsGrid) {
    clubsGrid.innerHTML = clubLogos.map((name) => 
      `<div class="logo"><img src="assets/logos/Clubs/${name}" alt="Club logo" loading="lazy" onerror="this.parentElement.style.opacity='0.3'" /></div>`
    ).join("");
  }
}

// ---------- BULK ----------
async function initBulk() {
  const form = $("#bulkForm");
  if (!form) return;

  try {
    GlobalLoader.show();
    await loadConfig();
  } catch {
  } finally {
    GlobalLoader.hide();
  }

  $("#bulk_phone")?.setAttribute("pattern", phonePattern());

  // PRICES & MINIMUMS
  const COMM_MIN = Number(CFG?.COMM_MIN ?? 12);
  const UNIV_MIN = Number(CFG?.UNIV_MIN ?? 20);
  const CORP_MIN = Number(CFG?.CORP_MIN ?? 15);

  const COMM_PRICE = Number(CFG?.COMM_PRICE ?? 199);
  const UNIV_PRICE = Number(CFG?.UNIV_PRICE ?? COMM_PRICE);
  const CORP_PRICE = Number(CFG?.CORP_PRICE ?? 300);

  function priceFor(t) {
    if (t === "UNIVERSITY") return UNIV_PRICE;
    if (t === "CORPORATE") return CORP_PRICE;
    return COMM_PRICE; // COMMUNITY/default
  }

  const qtyEl = $("#bulk_qty");
  const amtEl = $("#bulk_amount");
  const pills = $$(".pill[data-type]");
  const minLbl = $("#minInfo");

  let clubType = "COMMUNITY";
  let minReq = COMM_MIN;
  let price = priceFor(clubType);

  function styleActive(el, on) {
    el.classList.toggle("is-active", on);
    el.dataset.selected = on ? "true" : "false";
    el.setAttribute("aria-pressed", on ? "true" : "false");

    // Inline safety in case CSS didn’t load
    if (on) {
      el.style.color = "#fff";
      el.style.background =
        "linear-gradient(90deg, var(--pink), var(--pink-600))";
      el.style.borderColor = "transparent";
      el.style.boxShadow = "0 6px 18px rgba(233,30,99,.28)";
      el.style.opacity = "1";
    } else {
      el.style.color = "";
      el.style.background = "";
      el.style.borderColor = "var(--border)";
      el.style.boxShadow = "";
      el.style.opacity = "";
    }
  }

  function recalc() {
    const q = Math.max(minReq, Number(qtyEl?.value || minReq || 0));
    if (qtyEl) qtyEl.value = String(q);
    if (amtEl) amtEl.textContent = rupee(q * price);
  }

  function choose(t) {
    clubType = t;

    // set minimums
    if (t === "UNIVERSITY") minReq = UNIV_MIN;
    else if (t === "CORPORATE") minReq = CORP_MIN;
    else minReq = COMM_MIN;

    // set price for this type
    price = priceFor(t);

    // visual state
    pills.forEach((el) => styleActive(el, el.dataset.type === t));

    // update "Minimum X passes" text
    const minText =
      t === "UNIVERSITY" ? UNIV_MIN : t === "CORPORATE" ? CORP_MIN : COMM_MIN;
    if (minLbl) minLbl.textContent = `Minimum ${minText} passes`;

    // update "₹___ per pass" label
    $$("[data-bulk-price]").forEach((n) => (n.textContent = price));

    // lock qty to min
    if (qtyEl) {
      qtyEl.min = String(minReq);
      qtyEl.value = String(minReq);
    }
    recalc();
  }

  pills.forEach((el) =>
    el.addEventListener("click", () => choose(el.dataset.type))
  );
  $("#minus")?.addEventListener("click", () => {
    if (!qtyEl) return;
    qtyEl.value = String(Math.max(minReq, Number(qtyEl.value || 0) - 1));
    recalc();
  });
  $("#plus")?.addEventListener("click", () => {
    if (!qtyEl) return;
    qtyEl.value = String(Math.max(minReq, Number(qtyEl.value || 0) + 1));
    recalc();
  });

  // initial
  if (qtyEl) {
    qtyEl.min = String(minReq);
    qtyEl.value = String(minReq);
  }
  choose("COMMUNITY");

  // Restore form data if resuming from timeout
  function restoreFormData() {
    if (sessionStorage.getItem('pip_resume_session') === 'true') {
      sessionStorage.removeItem('pip_resume_session');
      const savedData = sessionStorage.getItem('pip_bulk_form');
      if (savedData) {
        try {
          const data = JSON.parse(savedData);
          $("#bulk_name").value = data.name || '';
          $("#bulk_email").value = data.email || '';
          $("#bulk_phone").value = data.phone || '';
          $("#bulk_club").value = data.meta?.club_name || '';
          if (data.club_type) choose(data.club_type);
          if (data.meta?.quantity) {
            qtyEl.value = data.meta.quantity;
            recalc();
          }
          alert('Your form data has been restored!');
        } catch (e) {
          console.log('[bulk] Could not restore form:', e.message);
        }
      }
    }
  }

  restoreFormData();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#bulk_submit");
    const phone = normalizeINPhone($("#bulk_phone")?.value);
    if (!isValidINMobile(phone)) {
      alert("Please enter a valid Indian mobile (10 digits starting 6–9).");
      $("#bulk_phone")?.focus();
      return;
    }

    const quantity = Math.max(minReq, Number(qtyEl?.value || minReq));
    const clubName = ($("#bulk_club")?.value || "").trim();
    const uiLabel =
      clubType === "UNIVERSITY"
        ? "University"
        : clubType === "CORPORATE"
        ? "Corporate"
        : "Community";

    const payload = {
      type: "bulk",
      name: ($("#bulk_name")?.value || "").trim(),
      email: ($("#bulk_email")?.value || "").trim(),
      phone,
      club_type: clubType, // COMMUNITY | UNIVERSITY | CORPORATE
      club_name: clubName,
      quantity,
      meta: {
        club_type: clubType,
        ui_club_type:
          clubType === "UNIVERSITY"
            ? "University"
            : clubType === "CORPORATE"
            ? "Corporate"
            : "Community",
        club_name: clubName,
        quantity,
        price_per: price,
      },
    };

    // Save form data to session storage for recovery
    sessionStorage.setItem('pip_bulk_form', JSON.stringify(payload));
    sessionStorage.setItem('pip_last_page', 'bulk.html');
    sessionStorage.setItem('pip_name', payload.name);
    sessionStorage.setItem('pip_email', payload.email);
    sessionStorage.setItem('pip_phone', payload.phone);

    try {
      const resp = await postJSON("/api/create-order-razorpay", payload, btn);
      goToPayment(resp);
    } catch (err) {
      console.error('[bulk] Error:', err);
      
      // Extract error code
      const errorCode = err.cause?.code || 'UNKNOWN';
      const errorMsg = encodeURIComponent(err.message);
      
      // Redirect to error page
      window.location.href = `error.html?code=${errorCode}&msg=${errorMsg}&from=bulk.html`;
    }
  });
}

// ---------- DONATE ----------
async function initDonate() {
  const form = $("#donateForm");
  if (!form) return;

  try {
    GlobalLoader.show();
    await loadConfig();
  } catch {
    /* ignore */
  } finally {
    GlobalLoader.hide();
  }

  // Phone pattern from helper
  $("#donor_phone")?.setAttribute("pattern", phonePattern());

  // Tier metadata (frontend maintained) - maps amounts to tier names and perks
  const tierMetadata = {
    1000:  { tier: "Supporter", perks: "Social shoutout • Event certificate" },
    5000:  { tier: "Wellwisher", perks: "Donor recognition • Event certificate" },
    10000: { tier: "Silver", perks: "Major Donor Recognition • Logo on Backdrop • Social Media & Certificate" },
    15000: { tier: "Gold", perks: "All Silver benefits • 3 Min Stage Time • Recognition & MC Shoutout • Deliverables/Pamphlets" },
    20000: { tier: "Platinum", perks: "All Gold benefits • 5 Min Stage Time • Premium Recognition & Dedicated MC Mention" },
    25000: { tier: "Diamond", perks: "Exclusive partnership • VIP recognition • Custom benefits" },
    50000: { tier: "Platinum+", perks: "All benefits • Premier sponsorship • Dedicated support" },
  };

  // Slabs from server (or fallback defaults)
  let serverSlabs = CFG?.__SLABS_PARSED__ || [
    { amount: 1000,  passes: 1 },
    { amount: 5000,  passes: 2 },
    { amount: 10000, passes: 5 },
    { amount: 15000, passes: 7 },
    { amount: 20000, passes: 7 },
  ];

  // Merge server slabs with tier metadata
  let slabs = serverSlabs.map(s => ({
    amount: s.amount,
    passes: s.passes,
    tier: tierMetadata[s.amount]?.tier || `Sponsor (₹${s.amount/1000}k)`,
    perks: tierMetadata[s.amount]?.perks || 'Stage mention • Social shoutout • Logo on wall'
  }));

  // Render slab table (right side) - exclude ₹1,000 tier from display
  const tbody = $("#slab_body");
  if (tbody) {
    // Filter out ₹1,000 tier from table (but keep in logic)
    const tableSlabs = slabs.filter(s => s.amount > 1000);
    tbody.innerHTML = tableSlabs.map(s => `
      <tr data-amt="${s.amount}" style="border-bottom: 1px solid var(--border); vertical-align: top;">
        <td style="padding: 8px 6px; font-weight: 700; color: var(--pink); font-size: 0.85rem; white-space: nowrap;">${s.tier}</td>
        <td style="padding: 8px 6px; text-align: center; font-weight: 600; font-size: 0.85rem; white-space: nowrap;">${rupee(s.amount)}</td>
        <td style="padding: 8px 6px; text-align: center; font-weight: 600; font-size: 0.85rem; white-space: nowrap;">${s.passes}</td>
        <td style="padding: 8px 6px; font-size: 0.78rem; color: var(--muted); line-height: 1.4; word-break: break-word;">${s.perks}</td>
      </tr>
    `).join("");
    
    // Make rows clickable on mobile and remove hover effects (CSS handles it via .slab-hit class)
    $$("#slab_body tr").forEach(tr => {
      tr.style.cursor = "pointer";
      // Click to select amount
      tr.addEventListener("click", function() {
        const amt = this.dataset.amt;
        const amountEl = $("#donor_amount");
        if (amountEl) {
          amountEl.value = amt;
          amountEl.dispatchEvent(new Event("input", { bubbles: true }));
          amountEl.focus();
          // Scroll to form on mobile
          if (window.innerWidth <= 640) {
            amountEl.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }
      });
    });
  }

  // Build quick-pick chips
  const amountEl = $("#donor_amount");
  const nameEl   = $("#donor_name");
  const emailEl  = $("#donor_email");
  const phoneEl  = $("#donor_phone");
  const payBtn   = $("#donor_submit");

  const chipHost = $("#slab_quick");
  if (chipHost && slabs.length) {
    chipHost.innerHTML = slabs.map(s => (
      `<button type="button" class="chip" data-amt="${s.amount}">${rupee(s.amount)}</button>`
    )).join("");

    const chipBtns = $$("#slab_quick .chip");
    const setChipActive = (val) => {
      chipBtns.forEach(b => {
        if (Number(b.dataset.amt) === Number(val)) {
          b.classList.add("active");
        } else {
          b.classList.remove("active");
        }
      });
    };
    chipBtns.forEach(b => {
      b.addEventListener("click", (e) => {
        e.preventDefault();
        amountEl.value = String(b.dataset.amt);
        setChipActive(b.dataset.amt);
        amountEl.dispatchEvent(new Event("input", { bubbles:true }));
        amountEl.focus();
      });
    });
    amountEl?.addEventListener("input", () => setChipActive(Number(amountEl.value || 0)));
  }

  // Update benefit preview when amount changes
  const benefitPreview = $("#benefitPreview");
  const benefitText = $("#benefitText");
  if (benefitPreview && benefitText) {
    amountEl?.addEventListener("input", () => {
      const v = Number(amountEl?.value || 0);
      
      if (v < 100) {
        benefitPreview.style.display = "none";
        return;
      }

      benefitPreview.style.display = "block";
      let benefits = ["📧 Receipt via email"];
      
      // Find matching slab
      let hit = null;
      for (const s of slabs) {
        if (v >= s.amount) hit = s;
      }
      
      if (hit) {
        benefits.push(`🎟️ ${hit.passes} Pink Pass${hit.passes === 1 ? "" : "es"}`);
        benefits.push(`🎭 Entry to Party In Pink event`);
        if (hit.passes >= 5) benefits.push(`📱 VIP WhatsApp channel access`);
        if (hit.passes >= 7) benefits.push(`🎯 Direct sponsor recognition`);
      }
      
      benefitText.innerHTML = benefits.map(b => `<div>✓ ${b}</div>`).join("");
    });
  }

  // --- Pass logic ---
  const FIRST_SLAB = slabs?.[0]?.amount ?? 1000;        // First slab amount (usually ₹1,000)

  function highlightSlab() {
    const v = Number(amountEl?.value || 0);

    // clear previous highlight
    $$("#slab_body tr").forEach(tr => tr.classList.remove("slab-hit"));

    if (!v) {
      $("#slab_hint")?.replaceChildren(
        document.createTextNode("Enter an amount to see how many passes you'll receive.")
      );
      return;
    }

    // Find best-fit slab (<= v)
    // Iterate through slabs and find the highest one where v >= amount
    let hit = null;
    for (const s of slabs) {
      if (v >= s.amount) {
        hit = s; // Keep updating to get the highest matching slab
      }
    }

    if (hit) {
      $(`#slab_body tr[data-amt="${hit.amount}"]`)?.classList.add("slab-hit");
      const tierName = hit.tier || 'Sponsor';
      $("#slab_hint")?.replaceChildren(
        document.createTextNode(
          `Thank you! You've chosen the ${tierName} tier. You will receive ${hit.passes} Pink Pass${hit.passes === 1 ? "" : "es"}.`
        )
      );
      return;
    }

    // Below first slab (₹1,000) → donation without passes
    if (v > 0 && v < FIRST_SLAB) {
      $("#slab_hint")?.replaceChildren(
        document.createTextNode("Thank you for your donation! Reach ₹1,000 for event passes.")
      );
      return;
    }

    // Below any amount → no pass
    $("#slab_hint")?.replaceChildren(
      document.createTextNode("Enter an amount to see how many passes you'll receive.")
    );
  }

  // Enable/disable submit
  function updateProceedState() {
    const amtOk   = Number(amountEl?.value || 0) >= 100;   // keep your current minimum input
    const nameOk  = (nameEl?.value || "").trim().length >= 2;
    const emailOk = !!emailEl?.validity?.valid;
    const phone   = normalizeINPhone(phoneEl?.value);
    const phoneOk = isValidINMobile(phone);
    if (payBtn) payBtn.disabled = !(amtOk && nameOk && emailOk && phoneOk);
  }

  // Listeners
  amountEl?.addEventListener("input", () => { highlightSlab(); updateProceedState(); });
  nameEl?.addEventListener("input",  updateProceedState);
  emailEl?.addEventListener("input", updateProceedState);
  phoneEl?.addEventListener("input", updateProceedState);

  // Restore form data if resuming from timeout
  function restoreDonateFormData() {
    if (sessionStorage.getItem('pip_resume_session') === 'true') {
      sessionStorage.removeItem('pip_resume_session');
      const savedData = sessionStorage.getItem('pip_donate_form');
      if (savedData) {
        try {
          const data = JSON.parse(savedData);
          nameEl.value = data.name || '';
          emailEl.value = data.email || '';
          phoneEl.value = data.phone || '';
          amountEl.value = data.custom_amount || '';
          highlightSlab();
          updateProceedState();
          alert('Your donation form has been restored!');
        } catch (e) {
          console.log('[donate] Could not restore form:', e.message);
        }
      }
    }
  }

  restoreDonateFormData();

  // Prefill amount with first slab and init UI
  if (amountEl && slabs.length) amountEl.value = String(slabs[0].amount);
  highlightSlab();
  updateProceedState();

  // Reset → restore defaults
  form.addEventListener("reset", () => {
    setTimeout(() => {
      if (amountEl && slabs.length) amountEl.value = String(slabs[0].amount);
      highlightSlab();
      updateProceedState();
    }, 0);
  });

  // Submit
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    // Prevent double submission
    if (form.__submitting) {
      console.warn("Form submission already in progress, ignoring duplicate submit");
      return;
    }
    form.__submitting = true;

    const phone = normalizeINPhone(phoneEl?.value);
    if (!isValidINMobile(phone)) {
      alert("Please enter a valid Indian mobile (10 digits starting 6–9).");
      phoneEl?.focus();
      form.__submitting = false;
      return;
    }

    const amt = Number(amountEl?.value || 0);
    if (amt < 100) {
      alert("Minimum donation amount is ₹100.");
      form.__submitting = false;
      return;
    }

    const payload = {
      type: "donation",
      name:  (nameEl?.value || "").trim(),
      email: (emailEl?.value || "").trim(),
      phone,
      tier: "CUSTOM",
      custom_amount: amt,
      amount: amt,
    };

    // Save form data to session storage for recovery
    sessionStorage.setItem('pip_donate_form', JSON.stringify(payload));
    sessionStorage.setItem('pip_last_page', 'donate.html');
    sessionStorage.setItem('pip_name', payload.name);
    sessionStorage.setItem('pip_email', payload.email);
    sessionStorage.setItem('pip_phone', payload.phone);

    try {
      const resp = await postJSON("/api/create-order-razorpay", payload, $("#donor_submit"));
      if (!resp || !resp.order_id) {
        alert("Server error: Invalid response. Please try again.");
        console.error("Invalid response:", resp);
        form.__submitting = false;
        return;
      }
      // Keep form locked during payment redirect (don't clear __submitting flag)
      console.log(`[donate] Order created: ${resp.order_id}${resp.reused ? ' (reused)' : ''}, redirecting to payment...`);
      goToPayment(resp);
    } catch (err) {
      console.error('[donate] Error:', err);
      
      // Extract error code
      const errorCode = err.cause?.code || 'UNKNOWN';
      const errorMsg = encodeURIComponent(err.message);
      
      // Redirect to error page
      window.location.href = `error.html?code=${errorCode}&msg=${errorMsg}&from=donate.html`;
      form.__submitting = false;
    }
  });
}


// ---------- KonfHub widget ----------
function initRegister() {
  const frame = document.getElementById("konfhub-widget");
  if (!frame) return;

  const MIN = 520; // smaller minimum
  const MAX = 900; // don't let it get too tall on desktops
  const OFFSET = 120; // space for header/footer around the widget

  const setH = () => {
    const vh =
      (window.visualViewport && window.visualViewport.height) ||
      window.innerHeight;
    const target = Math.min(MAX, Math.max(MIN, vh - OFFSET));
    frame.style.height = Math.round(target) + "px";
  };

  setH();
  // keep it responsive
  window.addEventListener("resize", setH);
}

// ---------- Success page finalize + progress ----------
// NOTE: Old polling code removed - now handled in success.html
// The success.html file handles polling directly to avoid conflicts
// if (false) {
  const wrap = document.getElementById("successStatus");
  if (!wrap) return;

  const qs = new URLSearchParams(location.search);
  const orderId = qs.get("order");
  const type = (qs.get("type") || "").toLowerCase();

  const thanks = document.getElementById("thanksLine");
  const badge = document.getElementById("statusBadge");
  const detail = document.getElementById("statusDetail");

  if (thanks) {
    if (type === "bulk")
      thanks.textContent = "Thank you for your bulk registration!";
    else if (type === "donation")
      thanks.textContent = "Thank you for your donation!";
  }
  if (!orderId) {
    if (badge) badge.textContent = "Order id missing";
    if (detail)
      detail.textContent = "We could not read your order id from the URL.";
    return;
  }

  // overlay
  const ov = document.createElement("div");
  ov.className = "loader-overlay";
  ov.setAttribute("aria-busy", "true");
  ov.innerHTML = `
    <div class="card" style="background:#16161A;border:1px solid var(--border);padding:20px;border-radius:14px;min-width:280px;text-align:center">
      <div class="spinner" style="margin:0 auto 10px"></div>
      <div id="issueTitle" style="font-weight:700;margin-bottom:6px">Dispatching passes…</div>
      <div id="issueSub" class="muted tiny">Starting…</div>
    </div>`;
  document.body.appendChild(ov);

  const issueTitle = ov.querySelector("#issueTitle");
  const issueSub = ov.querySelector("#issueSub");

  // try to finalize on server (works when webhook can't reach localhost)
  let finalizeCalled = false;
  async function finalize() {
    // Only call finalize ONCE to prevent webhook replay
    if (finalizeCalled) {
      console.log('[success] finalize() already called, skipping duplicate');
      return;
    }
    finalizeCalled = true;
    
    try {
      const abortController = new AbortController();
      // Increased timeout to 15s - may need to access GitHub/KonfHub
      const timeoutId = setTimeout(() => abortController.abort(), 15000);
      try {
        const res = await fetch("/api/finalize-order", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ order_id: orderId }),
          signal: abortController.signal,
        });
        if (res.ok) {
          const data = await res.json();
          console.log('[success] finalize-order response:', data);
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (e) {
      console.log('[success] finalize-order error (ignoring, webhook still works):', e.message);
      /* ignore: server may not implement; polling still works */
    }
  }

  // render progress if server provides it
  function renderProgress(oc) {
    // flexible keys: progress.{issued,total} OR {issued,total} OR infer from recipients
    const p = oc?.progress || oc || {};
    const total = Number(
      p.total ?? p.expected ?? oc?.quantity ?? oc?.passes ?? 0
    );
    const issued = Number(
      p.issued ??
        p.sent ??
        oc?.issued ??
        (Array.isArray(oc?.delivered) ? oc.delivered.length : 0)
    );

    if (total > 0) {
      if (issueTitle)
        issueTitle.textContent = `Dispatching passes… ${Math.min(
          issued,
          total
        )}/${total}`;
      if (badge)
        badge.textContent = `Issuing ${Math.min(issued, total)}/${total}`;
      if (detail && Array.isArray(oc?.recipients)) {
        detail.textContent = `Delivering to: ${oc.recipients.join(", ")}`;
      }
      if (issueSub) {
        const state = oc?.state || oc?.fulfillment || oc?.status || "";
        issueSub.textContent = state
          ? String(state)
          : "Contacting ticketing partner…";
      }
    } else {
      if (issueTitle) issueTitle.textContent = "Dispatching passes…";
      if (issueSub) issueSub.textContent = "Contacting ticketing partner…";
    }
  }

  let tries = 0,
    done = false;
  async function poll() {
    if (done) return;
    tries++;
    try {
      const abortController = new AbortController();
      // Increased timeout to 10s - may need to access GitHub
      const timeoutId = setTimeout(() => abortController.abort(), 10000);
      let r;
      try {
        r = await fetch(
          `/api/order-status?id=${encodeURIComponent(orderId)}`,
          { cache: "no-store", signal: abortController.signal }
        );
      } finally {
        clearTimeout(timeoutId);
      }
      if (r.ok) {
        const resp = await r.json();
        // API returns { ok: true, order: {...} }
        const oc = resp.order || resp;
        console.log('[success-poll] Got order status:', { fulfilled: oc?.fulfilled, passed: oc?.passes, qty: oc?.quantity });
        console.log('[success-poll] Full response keys:', Object.keys(oc || {}));
        renderProgress(oc);

        const ok = oc.fulfilled?.status === "ok";
        const partial = oc.fulfilled?.status === "partial";
        console.log('[success-poll] Checking fulfilled - ok:', ok, 'partial:', partial);

        if (ok || partial) {
          done = true;
          if (badge)
            badge.textContent = ok ? "Tickets issued" : "Partially issued";
          if (detail) {
            detail.innerHTML = ok
              ? `All passes have been queued for delivery to: ${(
                  oc.recipients || []
                ).join(", ")}`
              : `Some passes could not be issued automatically. We’ll fix this manually.`;
          }
          ov.setAttribute("aria-busy", "false");
          ov.remove();
          return;
        }
      }
    } catch (e) {
      console.log('[success-poll] Error (continuing):', e.message);
      /* ignore network error; keep polling */
    }

    // keep user informed
    if (badge && !done) {
      badge.textContent = `Processing… (${tries * 2}s)`;
    }
    if (tries < 40) setTimeout(poll, 2000);
    else {
      if (!done) {
        done = true;
        if (badge) badge.textContent = "Processing (may take a few moments)";
        if (detail)
          detail.textContent =
            "Your passes are being prepared. Check your email within a few minutes. If they don't arrive soon, reply to the confirmation email or contact us at rotaractjpnagar@gmail.com.";
        ov.setAttribute("aria-busy", "false");
        ov.remove();
      }
    }
  }

  // Kick it off
  // CRITICAL: Only poll. Don't call finalize() on success page.
  // Let the Cashfree webhook handle ticket issuance.
  // finalize() is a fallback that should NOT be called automatically.
  // poll();
  // }
// end of disabled code

// ---------- Boot ----------
document.addEventListener("DOMContentLoaded", () => {
  const y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();
  
  // Countdown timer (reads event date from config)
  (async function initCountdown() {
    try {
      // Fetch event config
      const response = await fetch('config/event.json');
      const config = await response.json();
      const eventDateStr = config?.event?.date || '2025-12-14T07:30:00+05:30';
      const eventDate = new Date(eventDateStr).getTime();
      
      function updateCountdown() {
        const now = new Date().getTime();
        const distance = eventDate - now;
        
        if (distance < 0) {
          document.getElementById('days').textContent = '0';
          document.getElementById('hours').textContent = '0';
          document.getElementById('minutes').textContent = '0';
          document.getElementById('seconds').textContent = '0';
          return;
        }
        
        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);
        
        const daysEl = document.getElementById('days');
        const hoursEl = document.getElementById('hours');
        const minutesEl = document.getElementById('minutes');
        const secondsEl = document.getElementById('seconds');
        
        if (daysEl) daysEl.textContent = String(days).padStart(2, '0');
        if (hoursEl) hoursEl.textContent = String(hours).padStart(2, '0');
        if (minutesEl) minutesEl.textContent = String(minutes).padStart(2, '0');
        if (secondsEl) secondsEl.textContent = String(seconds).padStart(2, '0');
      }
      
      // Update immediately and then every second
      updateCountdown();
      setInterval(updateCountdown, 1000);
    } catch (error) {
      console.warn('Failed to load countdown config, using fallback date:', error);
      // Fallback to hardcoded date
      const eventDate = new Date('2025-12-14T07:30:00+05:30').getTime();
      setInterval(() => {
        const now = new Date().getTime();
        const distance = eventDate - now;
        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);
        const daysEl = document.getElementById('days');
        const hoursEl = document.getElementById('hours');
        const minutesEl = document.getElementById('minutes');
        const secondsEl = document.getElementById('seconds');
        if (daysEl) daysEl.textContent = String(days).padStart(2, '0');
        if (hoursEl) hoursEl.textContent = String(hours).padStart(2, '0');
        if (minutesEl) minutesEl.textContent = String(minutes).padStart(2, '0');
        if (secondsEl) secondsEl.textContent = String(seconds).padStart(2, '0');
      }, 1000);
    }
  })();
  
  [initIndex, initBulk, initDonate, initRegister].forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error("Init failed:", fn.name, e);
    }
  });
});
