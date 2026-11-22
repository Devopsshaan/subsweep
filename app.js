/* SubSweep — local-only subscription tracker (draft preview).
   All data lives in this browser's localStorage. Nothing is sent anywhere. */
(function () {
  'use strict';

  // ---------- config ----------
  var STORE_KEY = 'subsweep.v1';
  var L = window.SSLocale;
  var CURRENCIES = L ? L.currencies : ['AED', 'USD', 'EUR', 'GBP', 'SAR', 'INR'];
  // Rough rates to AED, for totals only (see locale.js).
  var TO_AED = L ? L.rates : { AED: 1, USD: 3.6725, SAR: 0.9793, EUR: 4.0, GBP: 4.7, INR: 0.043 };
  var CYCLE_PER_MONTH = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 };

  // Known services. `cancel` only where the account/cancel page is well known; otherwise we fall back to a web search.
  var KNOWN = [
    { n: 'Netflix', c: '#e50914', cancel: 'https://www.netflix.com/cancelplan' },
    { n: 'Spotify', c: '#1db954', cancel: 'https://www.spotify.com/account/subscription/' },
    { n: 'YouTube Premium', c: '#ff0000', cancel: 'https://www.youtube.com/paid_memberships' },
    { n: 'Apple Music', c: '#fa2d48', cancel: 'https://apps.apple.com/account/subscriptions' },
    { n: 'iCloud+', c: '#3693f3', cancel: 'https://apps.apple.com/account/subscriptions' },
    { n: 'Apple TV+', c: '#111111', cancel: 'https://apps.apple.com/account/subscriptions' },
    { n: 'Amazon Prime', c: '#00a8e1' }, { n: 'Disney+', c: '#113ccf' }, { n: 'OSN+', c: '#6d28d9' },
    { n: 'Shahid VIP', c: '#16a34a' }, { n: 'Anghami Plus', c: '#7c3aed' }, { n: 'STARZPLAY', c: '#0f172a' },
    { n: 'Careem Plus', c: '#22c55e' }, { n: 'noon One', c: '#eab308' }, { n: 'talabat pro', c: '#f97316' },
    { n: 'ChatGPT Plus', c: '#10a37f' }, { n: 'Claude Pro', c: '#d97757', cancel: 'https://claude.ai/settings/billing' },
    { n: 'Google One', c: '#4285f4' }, { n: 'GitHub Copilot', c: '#24292f', cancel: 'https://github.com/settings/billing' },
    { n: 'Cursor', c: '#111111' }, { n: 'Midjourney', c: '#0b0b0b' }, { n: 'Canva Pro', c: '#00c4cc' },
    { n: 'Notion', c: '#191919' }, { n: 'Adobe Creative Cloud', c: '#fa0f00', cancel: 'https://account.adobe.com/plans' },
    { n: 'Microsoft 365', c: '#d83b01', cancel: 'https://account.microsoft.com/services' },
    { n: 'Dropbox', c: '#0061ff' }, { n: 'LinkedIn Premium', c: '#0a66c2' }, { n: 'Duolingo', c: '#58cc02' },
    { n: 'Headspace', c: '#f47d31' },
    { n: 'X Premium', c: '#111111' }, { n: 'TradingView', c: '#131722' }, { n: 'Railway', c: '#853bce' },
    { n: 'Google AI Pro', c: '#4285f4' }, { n: 'YuppTV', c: '#f97316' }, { n: 'Truecaller', c: '#0087ff' },
    { n: 'vidIQ', c: '#cc0000' }
  ];
  var STORE_CANCEL = {
    apple: 'https://apps.apple.com/account/subscriptions',
    google: 'https://play.google.com/store/account/subscriptions'
  };

  var SEARCHES = [
    { t: 'Trials about to turn paid', q: '("free trial" OR "trial ends" OR "trial is ending" OR "will be charged") newer_than:1y' },
    { t: 'Subscriptions & renewals', q: '("auto-renew" OR "renews on" OR "next billing" OR "next payment" OR "subscription confirmed") newer_than:1y' },
    { t: 'Everything you signed up for with this email', q: 'subject:(welcome OR "verify your email" OR "confirm your email" OR "activate your account") newer_than:2y' },
    { t: 'App Store & Google Play subscriptions', q: 'from:(no_reply@email.apple.com OR googleplay-noreply@google.com) (subscription OR renewal OR receipt)' },
    { t: 'Price increases', q: '("price increase" OR "price change" OR "new price" OR "updating our prices") newer_than:1y' }
  ];

  var SAMPLE = [
    'From: Design Studio <billing@designstudio.example>',
    'To: old.hotmail@hotmail.com',
    'Subject: Your free trial ends in 3 days',
    '',
    'Hi there, your 14-day free trial of Design Studio Pro ends on ' + fmtLong(addDays(today(), 3)) + '.',
    'After that you will be charged USD 14.99 per month to your Visa ending in 0193.',
    'Cancel anytime from your account settings.'
  ].join('\n');

  // ---------- state ----------
  var state = load();

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (s && Array.isArray(s.items)) return s;
    } catch (e) { /* storage unavailable */ }
    return { items: [], base: 'AED', groupBy: 'email', baseChosen: false };
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { toast('Could not save in this browser (private mode?)'); }
  }

  // ---------- date helpers ----------
  function today() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function parseISO(s) { if (!s) return null; var p = s.split('-'); if (p.length !== 3) return null; return new Date(+p[0], +p[1] - 1, +p[2]); }
  function toISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtShort(d) { return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
  function fmtLong(d) { return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); }
  function daysUntil(d) { return Math.round((d - today()) / 86400000); }

  // Roll a past renewal date forward by its cycle so the list always shows the *next* charge.
  function nextCharge(item) {
    var d = parseISO(item.next);
    if (!d) return null;
    if (item.trial) return d;
    var guard = 0;
    while (d < today() && guard++ < 600) {
      if (item.cycle === 'weekly') d = addDays(d, 7);
      else if (item.cycle === 'quarterly') d.setMonth(d.getMonth() + 3);
      else if (item.cycle === 'yearly') d.setFullYear(d.getFullYear() + 1);
      else d.setMonth(d.getMonth() + 1);
    }
    return d;
  }

  // ---------- money ----------
  function monthly(item, base) {
    var aed = (+item.price || 0) * (TO_AED[item.cur] || 1);
    return aed * (CYCLE_PER_MONTH[item.cycle] || 1) / (TO_AED[base] || 1);
  }
  function money(v, cur) {
    try { return new Intl.NumberFormat('en', { style: 'currency', currency: cur, maximumFractionDigits: v >= 100 ? 0 : 2 }).format(v); }
    catch (e) { return cur + ' ' + v.toFixed(2); }
  }
  var CYCLE_LABEL = { weekly: '/wk', monthly: '/mo', quarterly: '/3mo', yearly: '/yr' };

  // ---------- receipt parser ----------
  var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  var SENDERISH = /(no[-_.]?reply|donotreply|billing|receipts?|invoice|support|info|account|notifications?|mailer|payments?|team|hello)@/i;

  function parseReceipt(text) {
    var out = { fields: [] };
    var lower = text.toLowerCase();

    // Service: known name first, then the "From:" display name, then the sender domain.
    var known = KNOWN.filter(function (k) { return lower.indexOf(k.n.toLowerCase()) !== -1; })
      .sort(function (a, b) { return b.n.length - a.n.length; })[0];
    if (known) out.name = known.n;
    else {
      var from = text.match(/^\s*from:\s*"?([^"<\n]+?)"?\s*<([^>]+)>/im);
      if (from && from[1].trim()) out.name = from[1].trim();
      else {
        var dom = text.match(/@([a-z0-9-]+)\.[a-z.]+/i);
        if (dom) out.name = dom[1].charAt(0).toUpperCase() + dom[1].slice(1);
      }
    }
    if (out.name) out.fields.push('service');

    // Email the account is on: prefer "To:", otherwise the first address that doesn't look like a sender.
    var to = text.match(/^\s*to:\s*.*?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/im);
    if (to) out.email = to[1];
    else {
      var all = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
      out.email = all.filter(function (e) { return !SENDERISH.test(e); })[0] || '';
    }
    if (out.email) out.fields.push('email');

    // Price + currency. Prefer a line that mentions total/amount/charged/price.
    var curRe = /(AED|USD|EUR|GBP|SAR|INR|US\$|\$|€|£|₹|د\.إ)\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)|(?<![\d,.])(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s?(AED|USD|EUR|GBP|SAR|INR|dirhams?)\b/i;
    var lines = text.split(/\n/);
    var priceLine = lines.filter(function (l) { return /total|amount|charged|price|per month|per year|\/mo|\/yr|renew/i.test(l) && curRe.test(l); })[0]
      || lines.filter(function (l) { return curRe.test(l); })[0];
    if (priceLine) {
      var m = priceLine.match(curRe);
      var sym = (m[1] || m[4] || '').toUpperCase();
      var num = (m[2] || m[3] || '').replace(/,/g, '');
      var map = { '$': 'USD', 'US$': 'USD', '€': 'EUR', '£': 'GBP', '₹': 'INR', 'د.إ': 'AED', 'DIRHAM': 'AED', 'DIRHAMS': 'AED' };
      out.cur = map[sym] || (CURRENCIES.indexOf(sym) !== -1 ? sym : 'USD');
      out.price = parseFloat(num);
      if (!isNaN(out.price)) out.fields.push('price');
    }

    // Billing cycle
    // Explicit price units ("/month", "per year") win over looser wording like "for 3 months".
    if (/\/\s?(yr|year)\b|per year|annual|yearly/i.test(text)) out.cycle = 'yearly';
    else if (/\/\s?mo(nth)?\b|per month|monthly|a month|each month|every month/i.test(text)) out.cycle = 'monthly';
    else if (/\/\s?wk\b|per week|weekly/i.test(text)) out.cycle = 'weekly';
    else if (/quarter|every 3 months|3[- ]month/i.test(text)) out.cycle = 'quarterly';
    else if (/12[- ]month/i.test(text)) out.cycle = 'yearly';
    if (out.cycle) out.fields.push('billing');

    out.trial = /free trial|trial (ends|period|is ending|will end)|your trial/i.test(text);
    if (out.trial) out.fields.push('trial');

    // Card last 4
    var card = text.match(/(?:ending(?:\s+in)?|ends\s+(?:in|with)|last\s*4[^\d]{0,10}|[*•x]{2,})\s*(\d{4})\b/i);
    if (card) { out.card = card[1]; out.fields.push('card'); }

    // Paid via app stores
    if (/apple\.com|app store|itunes/i.test(text)) out.via = 'apple';
    else if (/google play|googleplay/i.test(text)) out.via = 'google';
    else if (/paypal/i.test(text)) out.via = 'paypal';

    // Dates: collect all, prefer the first future one near a renewal/trial keyword.
    var dates = findDates(text);
    var keyed = dates.filter(function (x) { return x.keyed && x.d >= today(); })[0];
    var future = dates.filter(function (x) { return x.d >= today(); })[0];
    var pick = keyed || future || dates[0];
    if (pick) { out.next = toISO(pick.d); out.fields.push('date'); }

    return out;
  }

  function findDates(text) {
    var res = [];
    var KEY = /(renew|next (billing|payment|charge)|trial (ends|will end)|ends on|will be charged|billed on|due)/i;
    function push(d, idx) {
      if (!d || isNaN(d)) return;
      var ctx = text.slice(Math.max(0, idx - 80), idx);
      res.push({ d: d, idx: idx, keyed: KEY.test(ctx) });
    }
    var m, re;
    re = /\b(\d{4})-(\d{2})-(\d{2})\b/g;                                   // 2026-12-05
    while ((m = re.exec(text))) push(new Date(+m[1], +m[2] - 1, +m[3]), m.index);
    re = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\b/gi; // 5 December 2026
    while ((m = re.exec(text))) push(new Date(+m[3], MONTHS[m[2].toLowerCase()], +m[1]), m.index);
    re = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi; // December 5, 2026
    while ((m = re.exec(text))) push(new Date(+m[3], MONTHS[m[1].toLowerCase()], +m[2]), m.index);
    re = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;                              // 05/12/2026 → day/month (UAE format)
    while ((m = re.exec(text))) {
      var a = +m[1], b = +m[2];
      push(b > 12 ? new Date(+m[3], a - 1, b) : new Date(+m[3], b - 1, a), m.index);
    }
    var rel = text.match(/(?:ends?|renews?|charged)\s+in\s+(\d{1,2})\s+days?/i);  // "ends in 3 days"
    if (rel) push(addDays(today(), +rel[1]), text.indexOf(rel[0]) + 20);
    return res.sort(function (x, y) { return x.idx - y.idx; });
  }

  // ---------- UI refs ----------
  function $(id) { return document.getElementById(id); }
  var els = {
    base: $('base'), groupBy: $('groupBy'), list: $('list'), form: $('form'),
    fId: $('fId'), fName: $('fName'), fPrice: $('fPrice'), fCur: $('fCur'), fCycle: $('fCycle'), fNext: $('fNext'),
    fEmail: $('fEmail'), fCard: $('fCard'), fVia: $('fVia'), fTrial: $('fTrial'), fCancel: $('fCancel'),
    raw: $('raw'), parseNote: $('parseNote')
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200); }
  function knownFor(name) { var l = (name || '').toLowerCase(); return KNOWN.filter(function (k) { return k.n.toLowerCase() === l; })[0]; }
  function colorFor(name) {
    var k = knownFor(name); if (k) return k.c;
    var h = 0; for (var i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return 'hsl(' + h + ' 55% 45%)';
  }
  function initials(name) { var w = (name || '?').trim().split(/\s+/); return (w[0][0] + (w[1] ? w[1][0] : '')).toUpperCase(); }
  function cancelUrl(item) {
    if (item.cancel) return item.cancel;
    if (STORE_CANCEL[item.via]) return STORE_CANCEL[item.via];
    var k = knownFor(item.name); if (k && k.cancel) return k.cancel;
    return 'https://www.google.com/search?q=' + encodeURIComponent('how to cancel ' + item.name + ' subscription');
  }

  // ---------- tabs ----------
  function showTab(name) {
    document.querySelectorAll('.tab').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === name)); });
    document.querySelectorAll('.panel').forEach(function (p) { p.hidden = p.dataset.panel !== name; });
  }
  document.querySelectorAll('.tab').forEach(function (b) { b.addEventListener('click', function () { showTab(b.dataset.tab); }); });

  // ---------- searches ----------
  function renderSearches() {
    $('searches').innerHTML = SEARCHES.map(function (s, i) {
      var accts = [0, 1, 2].map(function (u) {
        return '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://mail.google.com/mail/u/' + u + '/#search/' + encodeURIComponent(s.q) + '">Gmail ' + (u + 1) + '</a>';
      }).join('');
      return '<div class="search-item"><h4>' + (i + 1) + '. ' + esc(s.t) + '</h4><code>' + esc(s.q) + '</code>' +
        '<div class="acct-row">' + accts + '<button class="link-btn" data-copy="' + i + '">Copy</button></div></div>';
    }).join('');
    $('searches').addEventListener('click', function (e) {
      var i = e.target.getAttribute('data-copy'); if (i == null) return;
      var q = SEARCHES[+i].q;
      if (navigator.clipboard) navigator.clipboard.writeText(q).then(function () { toast('Search copied'); }, function () { toast('Copy failed. Select the text instead.'); });
    });
  }

  // ---------- form ----------
  function fillForm(d) {
    els.fId.value = d.id || '';
    els.fName.value = d.name || '';
    els.fPrice.value = d.price != null && !isNaN(d.price) ? d.price : '';
    els.fCur.value = d.cur || state.base;
    els.fCycle.value = d.cycle || 'monthly';
    els.fNext.value = d.next || '';
    els.fEmail.value = d.email || '';
    els.fCard.value = d.card || '';
    els.fVia.value = d.via || 'card';
    els.fTrial.checked = !!d.trial;
    els.fCancel.value = d.cancel || '';
    $('saveBtn').textContent = d.id ? 'Update subscription' : 'Save subscription';
  }

  els.form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!els.fName.value.trim() || els.fPrice.value === '') { toast('Add at least the service and price'); return; }
    if (els.fCard.value && !/^\d{4}$/.test(els.fCard.value)) { toast('Card: last 4 digits only'); els.fCard.focus(); return; }
    var item = {
      id: els.fId.value || ('s' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
      name: els.fName.value.trim(), price: parseFloat(els.fPrice.value), cur: els.fCur.value, cycle: els.fCycle.value,
      next: els.fNext.value, email: els.fEmail.value.trim().toLowerCase(), card: els.fCard.value.trim(),
      via: els.fVia.value, trial: els.fTrial.checked, cancel: els.fCancel.value.trim()
    };
    var idx = state.items.findIndex(function (x) { return x.id === item.id; });
    if (idx >= 0) state.items[idx] = item; else state.items.push(item);
    save(); render(); fillForm({}); els.raw.value = ''; els.parseNote.style.display = 'none';
    toast(idx >= 0 ? 'Updated' : 'Saved ' + item.name);
    showTab('paste');
  });
  $('resetBtn').addEventListener('click', function () { fillForm({}); });

  $('parseBtn').addEventListener('click', function () {
    var txt = els.raw.value.trim();
    if (!txt) { toast('Paste an email first'); return; }
    var p = parseReceipt(txt);
    fillForm(p);
    els.parseNote.style.display = 'block';
    els.parseNote.textContent = p.fields.length
      ? 'Found: ' + p.fields.join(', ') + '. Check the details, then save.'
      : "Couldn't read much from that. Fill in the details by hand.";
    showTab('add');
  });
  $('sampleBtn').addEventListener('click', function () { els.raw.value = SAMPLE; });

  // ---------- list ----------
  function render() {
    var base = state.base;
    var items = state.items.slice();
    var totalM = items.reduce(function (s, it) { return s + monthly(it, base); }, 0);
    $('kMonth').textContent = items.length ? money(totalM, base) : '—';
    $('kYear').textContent = items.length ? money(totalM * 12, base) : '—';
    var soon = items.filter(function (it) { var d = nextCharge(it); return d && daysUntil(d) <= 7 && daysUntil(d) >= 0; });
    $('kSoon').textContent = soon.length;
    var emails = {}, cards = {};
    items.forEach(function (it) { if (it.email) emails[it.email] = 1; if (it.card) cards[it.card] = 1; });
    $('kIds').textContent = Object.keys(emails).length + ' / ' + Object.keys(cards).length;

    if (!items.length) {
      els.list.innerHTML = '<div class="card empty"><h3>No subscriptions yet</h3><p class="muted">Start with step 1: open the Gmail searches in each of your accounts. Or load example data to look around.</p></div>';
      return;
    }

    items.sort(function (a, b) {
      var da = nextCharge(a), db = nextCharge(b);
      return (da ? da.getTime() : Infinity) - (db ? db.getTime() : Infinity);
    });

    var groups = {};
    var order = [];
    items.forEach(function (it) {
      var key = state.groupBy === 'email' ? (it.email || 'Email not set')
        : state.groupBy === 'card' ? (it.card ? 'Card •• ' + it.card : (it.via === 'apple' ? 'Apple App Store' : it.via === 'google' ? 'Google Play' : 'Card not set'))
        : 'All subscriptions, by next charge';
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(it);
    });

    els.list.innerHTML = order.map(function (key) {
      var g = groups[key];
      var sum = g.reduce(function (s, it) { return s + monthly(it, base); }, 0);
      return '<div class="group"><div class="group-head"><h3>' + esc(key) + ' <span class="pill pill-muted">' + g.length + '</span></h3><span class="sum">' + money(sum, base) + '/mo</span></div>' +
        g.map(row).join('') + '</div>';
    }).join('');
  }

  function row(it) {
    var d = nextCharge(it), dd = d ? daysUntil(d) : null;
    var due = dd != null && dd >= 0 && dd <= 7;
    var pills = '';
    if (it.trial) pills += '<span class="pill pill-trial">Trial</span>';
    if (dd != null && dd < 0 && it.trial) pills += '<span class="pill pill-muted">Trial ended. Check if charged</span>';
    else if (due) pills += '<span class="pill pill-soon">' + (dd === 0 ? 'Today' : 'In ' + dd + ' day' + (dd === 1 ? '' : 's')) + '</span>';
    var via = it.via === 'apple' ? 'App Store' : it.via === 'google' ? 'Google Play' : it.via === 'paypal' ? 'PayPal' : '';
    var meta = [
      d ? (it.trial ? 'Trial ends ' : 'Next charge ') + fmtShort(d) : 'No date set',
      it.card ? 'Card •• ' + esc(it.card) : '',
      via,
      state.groupBy !== 'email' && it.email ? esc(it.email) : ''
    ].filter(Boolean).join(' · ');
    return '<div class="item' + (due ? ' due' : '') + '">' +
      '<div class="ico" style="background:' + colorFor(it.name) + '">' + esc(initials(it.name)) + '</div>' +
      '<div><div class="name">' + esc(it.name) + pills + '</div><div class="meta">' + meta + '</div></div>' +
      '<div class="right"><div class="price">' + money(+it.price || 0, it.cur) + '<span class="muted small">' + (CYCLE_LABEL[it.cycle] || '') + '</span></div>' +
      '<div class="acts"><a class="link-btn" target="_blank" rel="noopener" href="' + esc(cancelUrl(it)) + '">How to cancel ↗</a>' +
      (d ? '<a class="link-btn" target="_blank" rel="noopener" href="' + esc(remindUrl(it)) + '">Remind me ↗</a>' : '') +
      '<button class="link-btn" data-edit="' + it.id + '">Edit</button><button class="link-btn del" data-del="' + it.id + '">Remove</button></div></div></div>';
  }

  els.list.addEventListener('click', function (e) {
    var id = e.target.getAttribute('data-edit');
    if (id) { var it = state.items.filter(function (x) { return x.id === id; })[0]; if (it) { fillForm(it); showTab('add'); window.scrollTo({ top: 0, behavior: 'smooth' }); } return; }
    id = e.target.getAttribute('data-del');
    if (id && armed(e.target, 'Confirm remove')) {
      var item = state.items.filter(function (x) { return x.id === id; })[0];
      state.items = state.items.filter(function (x) { return x.id !== id; }); save(); render();
      if (item) toast('Removed ' + item.name);
    }
  });

  // Two-step confirmation inside the page (browser confirm dialogs aren't available everywhere).
  function armed(btn, label) {
    if (btn.dataset.armed === '1') { btn.dataset.armed = ''; return true; }
    var old = btn.textContent;
    btn.dataset.armed = '1'; btn.textContent = label;
    setTimeout(function () { if (btn.isConnected && btn.dataset.armed === '1') { btn.dataset.armed = ''; btn.textContent = old; } }, 3000);
    return false;
  }

  // ---------- toolbar ----------
  CURRENCIES.forEach(function (c) { els.base.add(new Option(c, c)); els.fCur.add(new Option(c, c)); });
  els.base.value = state.base; els.groupBy.value = state.groupBy;
  els.base.addEventListener('change', function () { state.base = els.base.value; state.baseChosen = true; save(); render(); });
  els.groupBy.addEventListener('change', function () { state.groupBy = els.groupBy.value; save(); render(); });

  // Country: sets the default currency (unless the user picked one) and puts local services first in suggestions.
  function applyLocale(loc) {
    if (!loc) return;
    if (!state.baseChosen) { state.base = loc.cur; els.base.value = loc.cur; save(); render(); }
    if (!els.fId.value && !els.fPrice.value) els.fCur.value = state.base;
    var names = loc.local.concat(KNOWN.map(function (k) { return k.n; }))
      .filter(function (n, i, a) { return a.indexOf(n) === i; });
    $('known').innerHTML = names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
  }
  if (L) {
    L.bindSelect($('country'));
    L.ready.then(applyLocale);
    L.onChange(function (loc) { state.baseChosen = false; applyLocale(loc); toast('Showing ' + loc.cur + ' for ' + loc.name); });
  } else {
    $('known').innerHTML = KNOWN.map(function (k) { return '<option value="' + esc(k.n) + '">'; }).join('');
  }

  $('clearBtn').addEventListener('click', function () {
    if (!state.items.length) return;
    if (armed($('clearBtn'), 'Click again to delete all ' + state.items.length)) { state.items = []; save(); render(); toast('All subscriptions deleted'); }
  });

  $('demoBtn').addEventListener('click', function () {
    if (state.items.some(function (x) { return /^demo/.test(x.id); })) { toast('Example data is already loaded'); return; }
    var t = today();
    var demo = [
      { name: 'Netflix', price: 56, cur: 'AED', cycle: 'monthly', next: toISO(addDays(t, 2)), email: 'me.personal@gmail.com', card: '4821', via: 'card' },
      { name: 'ChatGPT Plus', price: 20, cur: 'USD', cycle: 'monthly', next: toISO(addDays(t, 9)), email: 'me.personal@gmail.com', card: '4821', via: 'card' },
      { name: 'Shahid VIP', price: 29.99, cur: 'AED', cycle: 'monthly', next: toISO(addDays(t, 16)), email: 'me.personal@gmail.com', card: '', via: 'apple' },
      { name: 'Design Studio Pro', price: 14.99, cur: 'USD', cycle: 'monthly', next: toISO(addDays(t, 3)), email: 'old.hotmail@hotmail.com', card: '0193', via: 'card', trial: true },
      { name: 'Dropbox', price: 119.88, cur: 'USD', cycle: 'yearly', next: toISO(addDays(t, 52)), email: 'old.hotmail@hotmail.com', card: '0193', via: 'card' },
      { name: 'Gym membership', price: 299, cur: 'AED', cycle: 'monthly', next: toISO(addDays(t, 21)), email: 'me@work.example', card: '7710', via: 'card' }
    ];
    demo.forEach(function (d, i) { d.id = 'demo' + Date.now() + i; d.trial = !!d.trial; d.cancel = ''; state.items.push(d); });
    save(); render(); toast('Example data loaded');
  });

  $('csv').addEventListener('click', function () {
    if (!state.items.length) { toast('Nothing to export yet'); return; }
    var head = ['Service', 'Price', 'Currency', 'Billing', 'Next charge', 'Trial', 'Email', 'Card last 4', 'Paid via', 'Cancel page'];
    var rows = state.items.map(function (it) {
      var d = nextCharge(it);
      return [it.name, it.price, it.cur, it.cycle, d ? toISO(d) : '', it.trial ? 'yes' : 'no', it.email, it.card, it.via, cancelUrl(it)];
    });
    var csv = [head].concat(rows).map(function (r) { return r.map(function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\n');
    var box = $('csvBox'), ta = $('csvText');
    ta.value = csv;
    function showBox() { box.hidden = false; ta.focus(); ta.select(); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(csv).then(function () { toast('Copied. Paste it into Excel or Google Sheets.'); }, function () { showBox(); toast('Select the text below and copy it'); });
    } else { showBox(); }
  });

  // Google Calendar link: an all-day reminder 3 days before the charge (or today if that's sooner).
  function remindUrl(it) {
    var d = nextCharge(it); if (!d) return '';
    var r = addDays(d, -3); if (r < today()) r = today();
    var title = (it.trial ? 'Trial ends: ' : 'Renews: ') + it.name + ' (' + money(+it.price || 0, it.cur) + ') on ' + fmtShort(d);
    var details = 'Keep or cancel?\nEmail: ' + (it.email || '-') + '\nCard: ' + (it.card ? '\u2022\u2022' + it.card : '-') + '\nCancel: ' + cancelUrl(it);
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(title) +
      '&dates=' + toISO(r).replace(/-/g, '') + '/' + toISO(addDays(r, 1)).replace(/-/g, '') + '&details=' + encodeURIComponent(details);
  }

  // expose parser for testing
  // Used by gmail.js (Connect Gmail) to add found subscriptions.
  window.SubSweep = {
    parseReceipt: parseReceipt,
    knownNames: function () { return KNOWN.map(function (k) { return k.n; }); },
    hasItem: function (name, email) {
      var n = String(name).toLowerCase(), e = String(email || '').toLowerCase();
      return state.items.some(function (x) { return x.name.toLowerCase() === n && (x.email || '') === e; });
    },
    addItems: function (list) {
      list.forEach(function (d, i) {
        state.items.push({
          id: 'g' + Date.now().toString(36) + i, name: d.name, price: +d.price || 0, cur: d.cur || state.base,
          cycle: d.cycle || 'monthly', next: d.next || '', email: (d.email || '').toLowerCase(), card: d.card || '',
          via: d.via || 'card', trial: !!d.trial, cancel: ''
        });
      });
      save(); render();
    },
    toast: toast
  };

  renderSearches(); fillForm({}); render();
})();
