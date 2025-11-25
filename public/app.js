// ===== Party in Pink 4.0 — unified site JS ==================================

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
  return "(\\+?91[6-9]\\d{9}|0[6-9]\\d{9})";
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

// ---------- Cashfree ----------
async function openCashfreeCheckout(sessionId, env) {
  try {
    const cashfreeFactory = window.Cashfree;
    if (typeof cashfreeFactory !== "function") {
      throw new Error("Cashfree SDK not loaded");
    }
    const mode = env === "production" ? "production" : "sandbox";
    const cashfree = cashfreeFactory({ mode });
    const checkoutOptions = {
      paymentSessionId: sessionId,
      redirectTarget: "_self",
    };
    console.log("[checkout] Opening Cashfree v3 checkout", {
      mode,
      sessionId: typeof sessionId === "string" ? `${sessionId.slice(0, 10)}...` : "<invalid>",
    });
    cashfree.checkout(checkoutOptions);
  } catch (err) {
    console.error("Cashfree checkout error:", err);
    alert("Payment initiation failed. Please try again or refresh the page.");
  }
}
function goToPayment(resp) {
  if (resp.redirect_url) {
    location.href = resp.redirect_url;
    return;
  }
  const url = resp.url || resp.payment_link || resp.link;
  if (url) {
    location.href = url;
    return;
  }
  const sid =
    resp.payment_session_id ||
    resp.session_id ||
    (resp.order && resp.order.payment_session_id);
  if (sid) {
    openCashfreeCheckout(sid, resp.cf_env || "sandbox");
    return;
  }
  console.error("goToPayment: No payment method found", resp);
  const debugMsg = JSON.stringify(resp, null, 2);
  alert(`Could not start payment. Response: ${debugMsg}\n\nPlease ensure Cashfree credentials are configured in Netlify and try again, or contact support.`);
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
    
    // Create AbortController with 10s timeout
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 10000);
    
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
    if (!r.ok)
      throw new Error(
        j?.details?.message || j?.error || text || "HTTP " + r.status
      );
    return j;
  } catch (err) {
    // Handle timeout specifically
    if (err.name === 'AbortError') {
      throw new Error('Request timeout. The payment service took too long to respond. Please try again.');
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

    if (typeof trackEvent === "function") {
      trackEvent("bulk_order_started", { passes: quantity });
    }

    try {
      const resp = await postJSON("/api/create-order", payload, btn);
      goToPayment(resp);
    } catch (err) {
      alert("Could not create order: " + err.message);
      console.error(err);
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

    if (typeof trackEvent === "function") {
      trackEvent("donation_started", { amount: payload.amount });
    }

    try {
      const resp = await postJSON("/api/create-order", payload, $("#donor_submit"));
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
      alert("Could not create donation: " + err.message);
      console.error(err);
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

  // Mark embed as loaded when iframe fires load (moved from inline script)
  try {
    const wrap = frame.parentElement;
    if (frame.complete) wrap.classList.add('embed--loaded');
    frame.addEventListener('load', () => wrap.classList.add('embed--loaded'));
  } catch (e) {
    // ignore
  }
}

// ---------- Success page finalize + progress ----------
(function () {
  const wrap = document.getElementById("successStatus");
  if (!wrap) return;

  const qs = new URLSearchParams(location.search);
  const orderId = qs.get("order") || qs.get("id");
  const type = (qs.get("type") || "").toLowerCase();

  if (!orderId) {
    document.getElementById("thanksLine").textContent = "Payment Processing";
    document.getElementById("statusBadge").textContent = "Order ID missing";
    document.getElementById("statusDetail").textContent = "We could not read your order ID from the URL.";
    return;
  }

  const thanks = document.getElementById("thanksLine");
  const badge = document.getElementById("statusBadge");
  const detail = document.getElementById("statusDetail");

  // ============================================================
  // PROFESSIONAL PAYMENT VERIFICATION STRATEGY (Redesigned)
  // 1. Show "Verifying Payment..." overlay immediately
  // 2. Check order status via API (direct validation)
  // 3. If SUCCESS → Dispatch tickets
  // 4. If FAILED/NOT_ATTEMPTED/USER_DROPPED → Redirect to error
  // 5. If PENDING → Poll with timeout (max 60 seconds)
  // ============================================================

  // Show verification overlay
  const verifyOv = document.createElement("div");
  verifyOv.className = "loader-overlay";
  verifyOv.setAttribute("aria-busy", "true");
  verifyOv.innerHTML = `
    <div class="card" style="background:#16161A;border:1px solid var(--border);padding:24px;border-radius:14px;min-width:320px;text-align:center">
      <div class="spinner" style="margin:0 auto 16px"></div>
      <div style="font-weight:700;margin-bottom:8px;font-size:1.1rem;">Verifying Payment...</div>
      <div class="muted tiny" style="line-height:1.6;">Confirming your payment status. This should only take a moment.</div>
    </div>`;
  document.body.appendChild(verifyOv);

  const PAYMENT_CHECK_TIMEOUT = 90000; // 90 seconds max (increased from 60)
  const PAYMENT_CHECK_INTERVAL = 2000; // Check every 2 seconds
  const INITIAL_WAIT = 1000; // Wait 1s for webhook to arrive initially (reduced from 2s)

  // Helper: Fetch and validate payment status from Cashfree API
  async function checkPaymentStatus() {
    try {
      const res = await fetch(`/api/order-status?id=${encodeURIComponent(orderId)}`, {
        cache: "no-store"
      });

      if (res.status === 404) {
        console.log('[success] Order not found yet (webhook may be pending)');
        return { found: false };
      }

      if (!res.ok) {
        console.error('[success] order-status API error:', res.status);
        return { error: true };
      }

      const data = await res.json();
      const order = data.order;

      if (!order) {
        return { found: false };
      }

      // ✅ CRITICAL FIX: Check CASHFREE ORDER STATUS (not just payment status)
      // PAID = payment definitely successful
      // ACTIVE = still waiting or failed
      const orderStatus = order.order_status; // PAID | ACTIVE | EXPIRED
      const latestPayment = order.latest_payment;
      const paymentStatus = latestPayment?.payment_status || 'PENDING';

      console.log('[success] Order status:', orderStatus, '| Payment status:', paymentStatus);

      // If Cashfree says order is PAID, payment definitely succeeded
      if (orderStatus === 'PAID') {
        return {
          found: true,
          status: 'SUCCESS', // Override to SUCCESS if order_status is PAID
          order: order,
          payment: latestPayment,
          definitive: true // From Cashfree, 100% reliable
        };
      }

      // If we have payment_status, use that
      if (paymentStatus && paymentStatus !== 'PENDING') {
        return {
          found: true,
          status: paymentStatus,
          order: order,
          payment: latestPayment,
          definitive: paymentStatus === 'SUCCESS' || paymentStatus === 'FAILED'
        };
      }

      // Still pending
      return {
        found: true,
        status: 'PENDING',
        order: order,
        payment: latestPayment,
        definitive: false
      };
    } catch (err) {
      console.error('[success] Payment status check failed:', err.message);
      return { error: true };
    }
  }
  
  // Main verification function
  async function verifyAndProceed() {
    console.log('[success] Starting payment verification');

    // Wait a bit for webhook to arrive
    await new Promise(resolve => setTimeout(resolve, INITIAL_WAIT));

    const startTime = Date.now();
    let lastDefinitiveStatus = null;

    // Poll until timeout or payment status determined
    while (Date.now() - startTime < PAYMENT_CHECK_TIMEOUT) {
      const result = await checkPaymentStatus();

      if (result.error) {
        console.error('[success] Error checking payment');
        await new Promise(resolve => setTimeout(resolve, PAYMENT_CHECK_INTERVAL));
        continue;
      }

      if (!result.found) {
        console.log('[success] Order not found, waiting...');
        await new Promise(resolve => setTimeout(resolve, PAYMENT_CHECK_INTERVAL));
        continue;
      }

      // CRITICAL: Check payment status
      const paymentStatus = result.status;

      if (paymentStatus === 'SUCCESS') {
        // ✅ Payment successful - proceed with ticket dispatch
        console.log('[success] ✅ PAYMENT VERIFIED: SUCCESS (from:', result.definitive ? 'Cashfree API' : 'webhook', ')');
        verifyOv.remove();
        proceedWithSuccess(result.order);
        return;
      }

      if (paymentStatus === 'FAILED' || paymentStatus === 'USER_DROPPED' || paymentStatus === 'NOT_ATTEMPTED') {
        // ❌ Payment failed (definitive)
        console.error('[success] ❌ PAYMENT FAILED:', paymentStatus);
        window.location.href = `error.html?order=${orderId}&type=${type}&reason=${paymentStatus}`;
        return;
      }

      if (paymentStatus === 'PENDING') {
        // Still waiting - keep polling
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log('[success] Payment still pending (' + elapsed + 's), continuing to wait...');
        await new Promise(resolve => setTimeout(resolve, PAYMENT_CHECK_INTERVAL));
        continue;
      }

      // Unknown status - wait and retry
      console.log('[success] Unknown payment status:', paymentStatus);
      await new Promise(resolve => setTimeout(resolve, PAYMENT_CHECK_INTERVAL));
    }

    // Timeout reached - no confirmation received
    // BUT: Check one more time with Cashfree API directly to be sure
    console.warn('[success] ⏱️  Verification timeout reached (90s). Doing final Cashfree check...');
    
    const finalCheck = await checkPaymentStatus();
    if (finalCheck.found && finalCheck.status === 'SUCCESS') {
      console.log('[success] ✅ FINAL CHECK: Payment actually succeeded!');
      verifyOv.remove();
      proceedWithSuccess(finalCheck.order);
      return;
    }

    console.error('[success] ❌ FINAL: Payment still not confirmed after 90 seconds');
    window.location.href = `error.html?order=${orderId}&type=${type}&reason=verification_timeout`;
  }
  
  // ====== PROCEED WITH SUCCESS (AFTER VERIFICATION) ======
  function proceedWithSuccess(orderData) {
    // Update thank you message based on type
    if (thanks) {
      if (type === "bulk")
        thanks.textContent = "Thank you for your bulk registration!";
      else if (type === "donation")
        thanks.textContent = "Thank you for your donation!";
      else
        thanks.textContent = "Thank you for your payment!";
    }
    
    // Show issuance overlay
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

    // Call finalize-order endpoint
    let finalizeCalled = false;
    async function finalize() {
      if (finalizeCalled) return;
      finalizeCalled = true;

      try {
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), 15000);
        try {
          const res = await fetch("/api/finalize-order", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ order_id: orderId }),
            signal: abortController.signal,
          });

          if (res.status === 402) {
            // Payment validation failed on server
            console.error('[success] Server rejected: Payment not successful');
            window.location.href = `error.html?order=${orderId}&type=${type}&reason=payment_validation_failed`;
            return;
          }

          if (res.ok) {
            const data = await res.json();
            console.log('[success] Tickets issued successfully:', data);
          }
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (e) {
        console.log('[success] finalize-order error:', e.message);
      }
    }

    // Poll for fulfillment status
    function renderProgress(oc) {
      const total = Number(oc?.passes ?? oc?.quantity ?? 0);
      const issued = Number(
        oc?.issued ?? (Array.isArray(oc?.delivered) ? oc.delivered.length : 0)
      );

      if (total > 0 && issueTitle) {
        issueTitle.textContent = `Dispatching passes… ${Math.min(issued, total)}/${total}`;
      }
      if (badge && issued > 0) {
        badge.textContent = `Issuing ${Math.min(issued, total)}/${total}`;
      }
      if (detail && Array.isArray(oc?.recipients)) {
        detail.textContent = `Delivering to: ${oc.recipients.join(", ")}`;
      }
      if (issueSub) {
        const state = oc?.state || oc?.fulfillment || "";
        issueSub.textContent = state || "Contacting ticketing partner…";
      }
    }

    let tries = 0;
    let done = false;
    async function poll() {
      if (done) {
        console.log('[success] Poll stopped - dispatch complete');
        return;
      }

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
        const response = await r.json();
        const oc = response.order;  // ✅ Extract the order from response
        
        if (!oc) {
          console.log('[success] Poll attempt', tries, 'got empty order');
          await new Promise(resolve => setTimeout(resolve, PAYMENT_CHECK_INTERVAL));
          return;
        }
        
        renderProgress(oc);

        const ok = oc.fulfilled?.status === "ok";
        const partial = oc.fulfilled?.status === "partial";

        if (ok || partial) {
          done = true;
          console.log('[success] Dispatch complete:', ok ? 'fully' : 'partially', 'issued');
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
      console.log('[success] Poll attempt', tries, 'failed:', e.message);
    }

    // keep user informed
    if (badge && !done) {
      badge.textContent = `Processing…`;
    }

    if (tries < 40 && !done) {
      setTimeout(poll, 2000);
    } else if (!done) {
      done = true;
      console.log('[success] Max polling attempts reached (80s elapsed)');
      if (badge) badge.textContent = "Processing (may take a few moments)";
      if (detail)
        detail.textContent =
          "Your passes are being prepared. Check your email within a few minutes. If they don't arrive soon, reply to the confirmation email or contact us at rotaractjpnagar@gmail.com.";
      ov.setAttribute("aria-busy", "false");
      ov.remove();
    }
    }

    // Start issuance process
    finalize();
    poll();
  }

  // Start the payment verification
  verifyAndProceed().catch(err => {
    console.error('[success] Verification error:', err);
    window.location.href = `error.html?order=${orderId}&type=${type}&reason=system_error`;
  });
})();

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
  
  [initImageErrorHandlers, initIndex, initBulk, initDonate, initRegister, initStatus, initCheckin, initError].forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error("Init failed:", fn.name, e);
    }
  });
});

// Attach error handlers to images that should be hidden on load-error
function initImageErrorHandlers() {
  try {
    const imgs = document.querySelectorAll('img[data-hide-onerror]');
    imgs.forEach((img) => {
      // remove any inline onerror left behind
      img.removeAttribute('onerror');
      img.addEventListener('error', function () {
        try { this.style.display = 'none'; } catch (e) {}
        const p = this.parentElement; if (p) p.classList.add('img-missing');
      });
    });
  } catch (e) { console.error('initImageErrorHandlers failed', e); }
}

// ---------- STATUS PAGE (moved from inline) ----------
function initStatus() {
  try {
    if (!document.querySelector('#statusSearchForm')) return;

    function formatDate(isoString) {
      try { const d = new Date(isoString); return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return isoString; }
    }
    function rupee(amt) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(amt); }

    document.getElementById('statusSearchBtn').addEventListener('click', async () => {
      const input = document.getElementById('statusInput').value.trim();
      if (!input) { alert('Please enter an Order ID or Email'); return; }

      const loading = document.getElementById('statusLoading');
      const error = document.getElementById('statusError');
      const result = document.getElementById('statusResult');

      loading.style.display = 'block'; error.style.display = 'none'; result.style.display = 'none';

      try {
        const response = await fetch(`/api/order-status?q=${encodeURIComponent(input)}`);
        const data = await response.json();
        loading.style.display = 'none';
        if (!response.ok || !data.ok) {
          error.style.display = 'block';
          error.innerHTML = `<strong>Order Not Found</strong><br>${data.error || 'Could not find an order matching that ID or email. Please check and try again.'}`;
          return;
        }

        const order = data.order;
        document.getElementById('resultOrderId').textContent = order.order_id;
        document.getElementById('resultType').textContent = (order.type || '').charAt(0).toUpperCase() + (order.type || '').slice(1);
        document.getElementById('resultName').textContent = order.name;
        document.getElementById('resultEmail').textContent = order.email;
        document.getElementById('resultAmount').textContent = rupee(order.amount);
        document.getElementById('resultCreated').textContent = formatDate(order.created_at);

        const fulfillmentReady = document.getElementById('fulfillmentReady');
        const fulfillmentNotReady = document.getElementById('fulfillmentNotReady');
        const ticketsIssued = document.getElementById('ticketsIssued');
        const ticketsPartial = document.getElementById('ticketsPartial');
        const ticketsFailed = document.getElementById('ticketsFailed');

        fulfillmentNotReady.style.display = 'none'; fulfillmentReady.style.display = 'block';
        ticketsIssued.style.display = 'none'; ticketsPartial.style.display = 'none'; ticketsFailed.style.display = 'none';

        if (order.fulfilled) {
          const status = order.fulfilled.status; const badge = document.getElementById('statusBadge');
          if (status === 'ok') {
            badge.classList.remove('pending','failed'); badge.classList.add('success'); badge.innerHTML = '✅ Tickets Issued';
            document.getElementById('resultPassCount').textContent = `${order.fulfilled.count} pass${order.fulfilled.count === 1 ? '' : 'es'}`;
            document.getElementById('resultFulfilledAt').textContent = formatDate(order.fulfilled.at);
            ticketsIssued.style.display = 'block';
          } else if (status === 'partial') {
            badge.classList.remove('success','failed'); badge.classList.add('pending'); badge.innerHTML = '⏳ Partially Issued';
            document.getElementById('resultPartialCount').textContent = order.fulfilled.count || 0; ticketsPartial.style.display = 'block';
          } else if (status === 'failed') {
            badge.classList.remove('success','pending'); badge.classList.add('failed'); badge.innerHTML = '❌ Issuance Failed';
            document.getElementById('resultError').textContent = order.fulfilled.error || 'Unknown error'; ticketsFailed.style.display = 'block';
          }
        } else {
          const badge = document.getElementById('statusBadge'); badge.classList.remove('success','failed'); badge.classList.add('pending'); badge.innerHTML = '⏳ Processing';
        }

        result.style.display = 'block';
      } catch (err) {
        loading.style.display = 'none'; error.style.display = 'block'; error.innerHTML = `<strong>Error</strong><br>${err.message || 'Could not fetch order status. Please try again.'}`;
      }
    });

    document.getElementById('statusInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') document.getElementById('statusSearchBtn').click(); });
  } catch (e) { console.error('initStatus failed', e); }
}

// ---------- CHECK-IN / SCAN PAGE (moved from inline) ----------
function initCheckin() {
  try {
    const orderInput = document.getElementById('orderId');
    if (!orderInput) return;
    const btn = document.getElementById('checkInBtn');
    const statusMsg = document.getElementById('statusMsg');

    btn.addEventListener('click', async () => {
      const orderId = orderInput.value.trim();
      const adminKey = document.getElementById('adminKey').value.trim();
      if (!orderId || !adminKey) {
        statusMsg.style.display = 'block'; statusMsg.innerHTML = '<div class="status-message status-error">Please enter both Order ID and Admin Key</div>'; return;
      }
      statusMsg.innerHTML = '<div class="status-message status-loading">Processing check-in...</div>'; statusMsg.style.display = 'block'; btn.disabled = true;
      try {
        const response = await fetch(`/api/checkin?order_id=${encodeURIComponent(orderId)}&key=${encodeURIComponent(adminKey)}`, { method: 'POST' });
        const data = await response.json().catch(() => ({}));
        if (data.ok) {
          statusMsg.innerHTML = '<div class="status-message status-success">Check-in Successful!</div>';
          // add log UI if present
          const logDiv = document.getElementById('checkInLog');
          if (logDiv) { const item = document.createElement('div'); item.className = 'log-item success'; item.innerHTML = `<span><strong>${orderId.slice(0,20)}</strong></span><span class="time">${new Date().toLocaleTimeString()}</span><span class="status">OK</span>`; logDiv.prepend(item); }
          orderInput.value = '';
          orderInput.focus();
        } else {
          statusMsg.innerHTML = `<div class="status-message status-error">Check-in Failed: ${data.error || 'Unknown error'}</div>`;
          const logDiv = document.getElementById('checkInLog'); if (logDiv) { const item = document.createElement('div'); item.className = 'log-item error'; item.innerHTML = `<span><strong>${orderId.slice(0,20)}</strong></span><span class="time">${new Date().toLocaleTimeString()}</span><span class="status">FAIL</span>`; logDiv.prepend(item); }
        }
      } catch (e) {
        statusMsg.innerHTML = `<div class="status-message status-error">Error: ${e.message}</div>`;
      } finally { btn.disabled = false; }
    });

    orderInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') btn.click(); });
    orderInput.focus();
  } catch (e) { console.error('initCheckin failed', e); }
}

// ---------- ERROR PAGE (moved from inline) ----------
function initError() {
  try {
    const wrap = document.getElementById('errorStatus');
    if (!wrap) return;
    
    const qs = new URLSearchParams(location.search);
    const type = (qs.get('type') || qs.get('t') || '').toLowerCase();
    const order = qs.get('order') || qs.get('o') || '';
    const reason = qs.get('reason') || qs.get('r') || '';

    const title = document.getElementById('errorLine');
    const msg = document.getElementById('errorMsg');
    const orderBox = document.getElementById('orderIdBox');
    const orderIdEl = document.getElementById('orderId');
    const whyFailed = document.getElementById('whyFailed');
    const nextSteps = document.getElementById('nextSteps');

    let headline = 'Payment Failed';
    let message = 'Your payment could not be processed. Please try again with a different payment method.';
    
    // Customize headline based on type
    if (type.includes('bulk')) {
      headline = 'Bulk Registration Payment Failed';
    } else if (type.includes('donation')) {
      headline = 'Donation Payment Failed';
    } else if (type.includes('single') || type.includes('registration')) {
      headline = 'Registration Payment Failed';
    }

    // Detailed reason messages with actionable guidance
    if (reason) {
      const reasonMap = {
        'declined': 'Your payment was declined by your bank or card issuer. Please verify your card details and try again, or use a different payment method.',
        'timeout': 'Payment verification timed out. We couldn\'t confirm your payment status within the expected timeframe. Please check with your bank if money was deducted, then contact us.',
        'verification_timeout': 'We couldn\'t verify your payment status after multiple attempts. No tickets have been issued to prevent double-charging. Please contact us with your order ID to resolve this.',
        'verification_error': 'An error occurred while verifying your payment. For your security, no tickets have been issued. Please contact support with your order ID.',
        'cancelled': 'You cancelled the payment at the gateway. No charges were made to your account.',
        'invalid': 'The payment details provided were invalid. Please check your card number, expiry date, CVV, and billing information.',
        'insufficient': 'Your bank reported insufficient funds. Please check your account balance and try again.',
        'network': 'A network error occurred during payment processing. Please check your internet connection and try again.',
        'failed': 'The payment was not successful. Please try again with a different payment method or contact your bank.',
        'USER_DROPPED': 'You left the payment page before completing the transaction. No charges were made.',
        'FAILED': 'Payment failed at the gateway. Please try again or use a different payment method.',
        'CANCELLED': 'Payment was cancelled. No charges were made to your account.',
        'EXPIRED': 'The payment session expired. Please create a new order and try again.',
        'system_error': 'A system error occurred while processing your request. Our team has been notified. Please try again in a few minutes.'
      };
      message = reasonMap[reason] || reasonMap[reason.toLowerCase()] || message;
    }

    if (title) title.textContent = headline;
    if (msg) msg.textContent = message;
    
    // Show additional information if order ID is available
    if (order) {
      if (orderBox) orderBox.style.display = 'block';
      if (orderIdEl) orderIdEl.textContent = order;
      if (whyFailed) whyFailed.style.display = 'block';
      if (nextSteps) nextSteps.style.display = 'block';
    }

    // Attach retry button handler (replaces inline onclick)
    const retry = document.getElementById('retryBtn');
    if (retry) {
      retry.removeAttribute('onclick');
      retry.addEventListener('click', () => {
        // Smart retry: go back to appropriate page based on type
        if (type.includes('bulk')) {
          window.location.href = 'bulk.html';
        } else if (type.includes('donation')) {
          window.location.href = 'donate.html';
        } else {
          window.location.href = 'register.html';
        }
      });
    }

    const yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();
  } catch (e) {
    console.error('initError failed', e);
  }
}
