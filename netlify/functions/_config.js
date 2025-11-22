// Parse & expose environment-driven config in one place
function parseSlabs(raw) {
  // "5000:2,10000:5,15000:7,20000:7,25000:10"
  const out = [];
  String(raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .forEach(pair => {
      const [amt, passes] = pair.split(':').map(x => Number(String(x).trim()));
      if (Number.isFinite(amt) && Number.isFinite(passes)) out.push({ amount: amt, passes });
    });
  out.sort((a, b) => a.amount - b.amount);
  return out;
}

function getConfig() {
  const {
    SITE_URL = 'http://localhost:8888',
    BULK_PRICE = '149',
    COMM_MIN = '12',
    UNIV_MIN = '20',
    SLABS = '5000:2,10000:5,15000:7,20000:7,25000:10',
    SLAB_BELOW_MIN = '0',
    SLAB_ABOVE_MAX = 'TOP',
    CASHFREE_ENV = 'sandbox',
    CASHFREE_APP_ID,
    CASHFREE_SECRET_KEY,
    CASHFREE_API_VERSION = '2025-01-01',
    GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH = 'main', STORE_PATH = 'storage',
    KONFHUB_API_KEY, KONFHUB_EVENT_ID, KONFHUB_EVENT_ID_INTERNAL,
    KONFHUB_FREE_TICKET_ID, KONFHUB_BULK_TICKET_ID,
    KONFHUB_INTERNAL_FREE_TICKET_ID, KONFHUB_INTERNAL_BULK_TICKET_ID,
    KONFHUB_ACCESS_CODE_BULK, KONFHUB_ACCESS_CODE_FREE,
    KONFHUB_CF_ROTARACTOR, KONFHUB_CF_CLUB,
    SMTP_HOST, SMTP_PORT = '587', SMTP_USER, SMTP_PASS, FROM_EMAIL = 'tickets@rotaractjpnagar.org', REPLY_TO,
    RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
  } = process.env;

  const slabs = parseSlabs(SLABS);

  return {
    public: {
      SITE_URL,
      BULK_PRICE: Number(BULK_PRICE),
      COMM_MIN: Number(COMM_MIN),
      UNIV_MIN: Number(UNIV_MIN),
      SLABS: slabs
    },
    private: {
      SLAB_BELOW_MIN: Number(SLAB_BELOW_MIN),
      SLAB_ABOVE_MAX,
      CASHFREE_ENV, CASHFREE_APP_ID, CASHFREE_SECRET_KEY, CASHFREE_API_VERSION,
      GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, STORE_PATH,
      KONFHUB_API_KEY, KONFHUB_EVENT_ID, KONFHUB_EVENT_ID_INTERNAL,
      KONFHUB_FREE_TICKET_ID, KONFHUB_BULK_TICKET_ID,
      KONFHUB_INTERNAL_FREE_TICKET_ID, KONFHUB_INTERNAL_BULK_TICKET_ID,
      KONFHUB_ACCESS_CODE_BULK, KONFHUB_ACCESS_CODE_FREE,
      KONFHUB_CF_ROTARACTOR, KONFHUB_CF_CLUB,
      SMTP_HOST, SMTP_PORT: Number(SMTP_PORT), SMTP_USER, SMTP_PASS, FROM_EMAIL, REPLY_TO,
      RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
    }
  };
}

function normalizeINPhone(raw){
  if(!raw) return '';
  let s = String(raw).replace(/\D/g, '');
  if(s.startsWith('91') && s.length === 12) s = s.slice(2);
  if(s.startsWith('0')  && s.length === 11) s = s.slice(1);
  return s;
}
function isValidINMobile(s){ return /^[6-9]\d{9}$/.test(s); }

// Map a paid amount to passes using the slabs
function mapAmountToPasses(amount, slabs, belowMin = 0, aboveMaxPolicy = 'TOP') {
  if (!Array.isArray(slabs) || !slabs.length) return 0;
  if (amount < slabs[0].amount) return Number(belowMin) || 0;

  let chosen = slabs[0].passes;
  for (const s of slabs) {
    if (amount >= s.amount) chosen = s.passes;
    else break;
  }
  const top = slabs[slabs.length - 1];
  if (amount > top.amount) {
    if (String(aboveMaxPolicy).toUpperCase() === 'TOP') return top.passes;
    const m = /^EXTRA_PER=(\d+)$/.exec(String(aboveMaxPolicy));
    if (m) {
      const k = Number(m[1]);
      const extra = Math.floor((amount - top.amount) / k);
      return top.passes + Math.max(0, extra);
    }
  }
  return chosen;
}

// Map donation amount to tier name based on ranges
function getTierName(amount) {
  const amt = Number(amount) || 0;
  
  if (amt >= 25000) return 'Diamond';
  if (amt >= 20000) return 'Platinum';
  if (amt >= 15000) return 'Gold';
  if (amt >= 10000) return 'Silver';
  if (amt >= 5000) return 'Wellwisher';
  if (amt >= 1000) return 'Supporter';
  return 'Supporter';
}

module.exports = { getConfig, normalizeINPhone, isValidINMobile, mapAmountToPasses, getTierName };
