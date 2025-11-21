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

// ---------- Cashfree ----------
let CF_READY = false;
function loadCashfree(env) {
  return new Promise((resolve, reject) => {
    if (CF_READY) return resolve();
    const s = document.createElement("script");
    s.id = "cf-sdk";
    s.src =
      env === "production"
        ? "https://sdk.cashfree.com/js/ui/2.0.0/cashfree.prod.js"
        : "https://sdk.cashfree.com/js/ui/2.0.0/cashfree.sandbox.js";
    s.async = true;
    s.onload = () => {
      CF_READY = true;
      resolve();
    };
    s.onerror = () => reject(new Error("Failed to load Cashfree SDK"));
    document.head.appendChild(s);
  });
}
async function openCashfreeCheckout(sessionId, env) {
  try {
    await loadCashfree(env || "sandbox");
    const cf = new Cashfree(sessionId);
    cf.redirect();
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
  alert("Could not start payment. Please try again or contact support.");
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

    const phone = normalizeINPhone(phoneEl?.value);
    if (!isValidINMobile(phone)) {
      alert("Please enter a valid Indian mobile (10 digits starting 6–9).");
      phoneEl?.focus();
      return;
    }

    const amt = Number(amountEl?.value || 0);
    if (amt < 100) {
      alert("Minimum donation amount is ₹100.");
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

    try {
      const resp = await postJSON("/api/create-order", payload, $("#donor_submit"));
      if (!resp || !resp.order_id) {
        alert("Server error: Invalid response. Please try again.");
        console.error("Invalid response:", resp);
        return;
      }
      goToPayment(resp);
    } catch (err) {
      alert("Could not create donation: " + err.message);
      console.error(err);
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
(function () {
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
        const oc = await r.json();
        renderProgress(oc);

        const ok = oc.fulfilled?.status === "ok";
        const partial = oc.fulfilled?.status === "partial";

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
      /* ignore network error; keep polling */
    }

    // keep user informed
    if (badge && !done) {
      badge.textContent = `Processing…`;
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
  poll();
})();

// ---------- Boot ----------
document.addEventListener("DOMContentLoaded", () => {
  const y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();
  [initIndex, initBulk, initDonate, initRegister].forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error("Init failed:", fn.name, e);
    }
  });
});
