// ===== Party in Pink 4.0 — site JS (nav, helpers, config, bulk, donate, success) =====

// ---------- NAV ----------
(function(){
  const t=document.getElementById('navToggle');
  const m=document.getElementById('navMenu');
  if(!t||!m) return;
  t.addEventListener('click',()=>{ const open=m.classList.toggle('show'); t.setAttribute('aria-expanded', open ? 'true' : 'false'); });
})();

// ---------- Optional forms.app embeds ----------
(function(){
  const targets = Array.from(document.querySelectorAll('[formsappId]'));
  if(!targets.length) return;
  const s = document.createElement('script');
  s.src = 'https://forms.app/cdn/embed.js'; s.async = true; s.defer = true;
  s.onload = ()=>targets.forEach(n=>{ try{ new formsapp(n.getAttribute('formsappId'),'standard',{width:'100%',height:'700px'},'https://firx950x.forms.app'); }catch(e){} });
  document.head.appendChild(s);
})();

// ---------- Helpers ----------
const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const rupee = (n)=> '₹'+ Number(n||0).toLocaleString('en-IN');

function normalizeINPhone(raw){ if(!raw) return ''; let s=String(raw).replace(/\D/g,''); if(s.startsWith('91')&&s.length===12)s=s.slice(2); if(s.startsWith('0')&&s.length===11)s=s.slice(1); return s; }
function isValidINMobile(s){ return /^[6-9]\d{9}$/.test(s); }
function phonePattern(){ return '^(?:\\+?91[-\\s]?|0)?[6-9]\\d{9}$'; }

// Global loader
const GlobalLoader = {
  el:null,
  ensure(){ if(!this.el){ this.el=document.createElement('div'); this.el.className='loader-overlay'; this.el.innerHTML='<div class="spinner" role="progressbar" aria-label="Loading"></div>'; document.body.appendChild(this.el);} },
  show(){ this.ensure(); this.el.setAttribute('aria-busy','true'); },
  hide(){ this.ensure(); this.el.setAttribute('aria-busy','false'); }
};

// ---------- Config ----------
let CFG=null;

function parseSlabs(val){
  // Accept "5000:2,10000:5", [{amount,passes}], or {"5000":2}
  if (Array.isArray(val)) {
    return val.map(x=>({amount:Number(x.amount), passes:Number(x.passes)}))
              .filter(x=>Number.isFinite(x.amount)&&Number.isFinite(x.passes))
              .sort((a,b)=>a.amount-b.amount);
  }
  if (typeof val === 'object' && val !== null) {
    return Object.entries(val).map(([k,v])=>({amount:Number(k), passes:Number(v)}))
      .filter(x=>Number.isFinite(x.amount)&&Number.isFinite(x.passes))
      .sort((a,b)=>a.amount-b.amount);
  }
  if (typeof val === 'string') {
    return val.split(',').map(s=>s.trim()).filter(Boolean).map(part=>{
      const [a,p]=part.split(':').map(x=>x.trim());
      return {amount:Number(a), passes:Number(p)};
    }).filter(x=>Number.isFinite(x.amount)&&Number.isFinite(x.passes))
      .sort((a,b)=>a.amount-b.amount);
  }
  return [];
}

async function loadConfig(){
  const r = await fetch('/api/config',{cache:'no-store'});
  if(!r.ok) throw new Error('Config not available');
  CFG = await r.json();

  // Hydrate hints
  $$('#[data-bulk-price]').forEach(n=>n.textContent = CFG.BULK_PRICE);
  const mc=$('[data-min-community]'); if(mc) mc.textContent = CFG.COMM_MIN;
  const mu=$('[data-min-university]'); if(mu) mu.textContent = CFG.UNIV_MIN;

  CFG.__SLABS_PARSED__ = parseSlabs(CFG.SLABS);
  return CFG;
}

// ---------- Cashfree ----------
let CF_READY=false;
function loadCashfree(env){
  return new Promise((resolve,reject)=>{
    if(CF_READY) return resolve();
    const s=document.createElement('script');
    s.id='cf-sdk';
    s.src = (env==='production')
      ? 'https://sdk.cashfree.com/js/ui/2.0.0/cashfree.prod.js'
      : 'https://sdk.cashfree.com/js/ui/2.0.0/cashfree.sandbox.js';
    s.async=true; s.onload=()=>{ CF_READY=true; resolve(); };
    s.onerror=()=>reject(new Error('Failed to load Cashfree SDK'));
    document.head.appendChild(s);
  });
}
async function openCashfreeCheckout(sessionId, env){
  await loadCashfree(env||'sandbox');
  const cf = new Cashfree(sessionId);
  cf.redirect();
}
function goToPayment(resp){
  if(resp.redirect_url){ location.href=resp.redirect_url; return; }
  const url = resp.url || resp.payment_link || resp.link;
  if(url){ location.href=url; return; }
  const sid = resp.payment_session_id || resp.session_id || (resp.order && resp.order.payment_session_id);
  if(sid){ openCashfreeCheckout(sid, resp.cf_env || 'sandbox'); return; }
  alert('Could not start payment. Please try again.');
}

async function postJSON(url, data, btn){
  let spinner=null;
  try{
    if(btn){ btn.disabled=true; spinner=document.createElement('span'); spinner.className='spinner'; btn.prepend(spinner); }
    const r = await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
    const text = await r.text(); let j; try{ j=JSON.parse(text);}catch{ j={raw:text}; }
    if(!r.ok) throw new Error(j?.details?.message || j?.error || text || ('HTTP '+r.status));
    return j;
  }finally{
    if(btn){ btn.disabled=false; if(spinner) spinner.remove(); }
  }
}

// ---------- BULK ----------
async function initBulk(){
  const form = $('#bulkForm'); if(!form) return;

  GlobalLoader.show(); try{ await loadConfig(); }catch(e){} finally{ GlobalLoader.hide(); }

  $('#bulk_phone')?.setAttribute('pattern', phonePattern());

  const PRICE     = Number(CFG?.BULK_PRICE || 199);
  const COMM_MIN  = Number(CFG?.COMM_MIN   || 12);
  const UNIV_MIN  = Number(CFG?.UNIV_MIN   || 20);

  const qtyEl  = $('#bulk_qty');
  const amtEl  = $('#bulk_amount');
  const pills  = $$('.pill[data-type]');
  const minLbl = $('#minInfo');

  let clubType = 'COMMUNITY';
  let minReq   = COMM_MIN;

  function recalc(){
    const q = Math.max(minReq, Number(qtyEl.value||minReq));
    qtyEl.value = String(q);
    amtEl.textContent = rupee(q*PRICE);
  }
  function choose(t){
    clubType = t;
    minReq   = (t==='COMMUNITY') ? COMM_MIN : UNIV_MIN;
    pills.forEach(el=> el.dataset.selected = (el.dataset.type===t ? 'true':'false'));
    minLbl.textContent = (t==='COMMUNITY') ? `Minimum ${COMM_MIN} passes` : `Minimum ${UNIV_MIN} passes`;
    qtyEl.min = String(minReq);
    qtyEl.value = String(minReq);   // snap back to type min
    recalc();
  }

  pills.forEach(el=> el.addEventListener('click',()=>choose(el.dataset.type)));
  $('#minus')?.addEventListener('click',()=>{ qtyEl.value = String(Math.max(minReq, (Number(qtyEl.value||0)-1))); recalc(); });
  $('#plus') ?.addEventListener('click',()=>{ qtyEl.value = String(Math.max(minReq, (Number(qtyEl.value||0)+1))); recalc(); });

  // initial
  qtyEl.min = String(minReq);
  qtyEl.value = String(minReq);
  recalc();

  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const btn   = $('#bulk_submit');
    const phone = normalizeINPhone($('#bulk_phone').value);
    if(!isValidINMobile(phone)){ alert('Please enter a valid Indian mobile (10 digits starting 6–9).'); $('#bulk_phone').focus(); return; }

    const quantity = Math.max(minReq, Number(qtyEl.value||minReq));
    const clubName = $('#bulk_club').value.trim();

    const payload = {
      type: 'bulk',
      name:  $('#bulk_name').value.trim(),
      email: $('#bulk_email').value.trim(),
      phone,

      // ROOT-LEVEL fields (what your function validates)
      club_type: clubType,
      club_name: clubName,
      quantity,

      // also keep meta so the stored order matches the ledger shape
      meta: { club_type: clubType, club_name: clubName, quantity }
    };

    try{
      const resp = await postJSON('/api/create-order', payload, btn);
      goToPayment(resp);
    }catch(err){
      alert('Could not create order: '+err.message);
      console.error(err);
    }
  });
}

// ---------- DONATE ----------
async function initDonate(){
  const form = $('#donateForm'); if(!form) return;

  GlobalLoader.show(); try{ await loadConfig(); }catch(e){} finally{ GlobalLoader.hide(); }

  $('#donor_phone')?.setAttribute('pattern', phonePattern());

  const slabs = CFG.__SLABS_PARSED__ || [];
  const tbody = $('#slab_body');
  if (tbody) {
    tbody.innerHTML = slabs.map(s=>`
      <tr data-amt="${s.amount}">
        <td>${rupee(s.amount)}</td>
        <td>${s.passes} passes</td>
        <td class="help">Perks: stage mention • social shoutout • logo on wall</td>
      </tr>`).join('');
  }

  const amountEl = $('#donor_amount');
  function highlightSlab(){
    const v = Number(amountEl.value||0);
    $$('#slab_body tr').forEach(tr=> tr.classList.remove('slab-hit'));
    let hit=null; for(const s of slabs){ if(v>=s.amount) hit=s; }
    if(hit){
      const tr=$(`#slab_body tr[data-amt="${hit.amount}"]`); if(tr) tr.classList.add('slab-hit');
      $('#slab_hint').textContent = `This donation will grant approximately ${hit.passes} Pink Passes.`;
    } else {
      $('#slab_hint').textContent = 'Below minimum slab — 0 passes.';
    }
  }
  amountEl?.addEventListener('input', highlightSlab);
  highlightSlab();

  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const btn   = $('#donor_submit');
    const phone = normalizeINPhone($('#donor_phone').value);
    if(!isValidINMobile(phone)){ alert('Please enter a valid Indian mobile (10 digits starting 6–9).'); $('#donor_phone').focus(); return; }

    const amt = Number($('#donor_amount').value||0);

    const payload = {
      type:  'donation',
      name:  $('#donor_name').value.trim(),
      email: $('#donor_email').value.trim(),
      phone,

      // <<— IMPORTANT: your function expects these
      tier: 'CUSTOM',
      custom_amount: amt,

      // harmless extra for future-proofing
      amount: amt
    };

    try{
      const resp = await postJSON('/api/create-order', payload, btn);
      goToPayment(resp);
    }catch(err){
      alert('Could not create donation: '+err.message);
      console.error(err);
    }
  });
}

// ---------- Success polling ----------
(function(){
  const box = document.getElementById('successStatus'); if(!box) return;
  const qs = new URLSearchParams(location.search);
  const orderId = qs.get('order'); const type=(qs.get('type')||'').toLowerCase();
  const thanks = document.getElementById('thanksLine');
  if(type==='bulk') thanks.textContent='Thank you for your bulk registration!';
  else if(type==='donation') thanks.textContent='Thank you for your donation!';

  const badge = document.getElementById('statusBadge');
  const detail = document.getElementById('statusDetail');

  if(!orderId){ badge.textContent='Order id missing'; detail.textContent='We could not read your order id from the URL.'; return; }

  let tries=0, done=false;
  const poll = async ()=>{
    if(done) return; tries++;
    try{
      const r = await fetch(`/api/order-status?id=${encodeURIComponent(orderId)}`,{cache:'no-store'});
      if(r.ok){
        const oc = await r.json();
        if(oc.fulfilled?.status==='ok' || oc.fulfilled?.status==='partial'){
          done=true;
          badge.textContent = (oc.fulfilled.status==='ok') ? 'Tickets issued' : 'Partially issued';
          detail.innerHTML = (oc.fulfilled.status==='ok')
            ? `All passes have been queued by KonfHub for delivery to: ${ (oc.recipients||[]).join(', ') }`
            : `Some passes could not be issued automatically. We’ve been notified and will fix this manually.`;
          return;
        }
      }
      if(tries<20){ badge.textContent=`Processing… (${tries})`; setTimeout(poll, 2000); }
      else { badge.textContent='Still processing'; detail.textContent='We’re waiting for confirmation. If passes don’t arrive soon, reply to the confirmation email or contact us.'; }
    }catch(e){
      if(tries<20) setTimeout(poll,2000);
      else { badge.textContent='Status unavailable'; detail.textContent='Please check your email shortly or contact support.'; }
    }
  };
  poll();
})();

// ---------- Boot ----------
document.addEventListener('DOMContentLoaded', ()=>{
  initBulk();
  initDonate();
});
