/* SubSweep country localization.
   Order of detection: the visitor's saved choice → device time zone → browser language → US.
   Rates are rough and only used for totals and "≈" price hints. AED/USD/SAR/QAR/BHD/OMR are pegged; others are approximate. */
(function () {
  'use strict';

  var TO_AED = {
    AED: 1, USD: 3.6725, SAR: 0.9793, QAR: 1.0089, KWD: 11.95, BHD: 9.767, OMR: 9.551,
    EUR: 4.0, GBP: 4.7, INR: 0.043, PKR: 0.0132, CAD: 2.65, AUD: 2.4
  };

  var GCC_STAT = { n: '~3', t: 'online subscriptions per person in the UAE, at around AED 90 each per month.', src: 'Adsmehub UAE consumer survey' };
  var US_STAT = { n: '~3', t: 'out of 5 people pay for at least one subscription they don’t use (2.6 on average).', src: 'Self Financial survey (US, 2026)' };
  var UK_STAT = { n: '£1.6bn', t: 'spent every year in the UK on subscriptions people don’t want.', src: 'UK Government estimate, via Citizens Advice (2026)' };
  var GCC_LOCAL = ['Shahid VIP', 'OSN+', 'Anghami Plus', 'STARZPLAY', 'Careem Plus', 'noon One', 'talabat pro'];

  var C = {
    AE: { name: 'United Arab Emirates', cur: 'AED', local: GCC_LOCAL, stat: GCC_STAT },
    SA: { name: 'Saudi Arabia', cur: 'SAR', local: ['Shahid VIP', 'Anghami Plus', 'STARZPLAY', 'OSN+', 'noon One', 'Careem Plus', 'Jahez Plus'], stat: GCC_STAT },
    QA: { name: 'Qatar', cur: 'QAR', local: ['Shahid VIP', 'OSN+', 'Anghami Plus', 'STARZPLAY', 'talabat pro'], stat: GCC_STAT },
    KW: { name: 'Kuwait', cur: 'KWD', local: ['Shahid VIP', 'OSN+', 'Anghami Plus', 'STARZPLAY', 'talabat pro'], stat: GCC_STAT },
    BH: { name: 'Bahrain', cur: 'BHD', local: ['Shahid VIP', 'OSN+', 'Anghami Plus', 'STARZPLAY', 'talabat pro'], stat: GCC_STAT },
    OM: { name: 'Oman', cur: 'OMR', local: ['Shahid VIP', 'OSN+', 'Anghami Plus', 'STARZPLAY', 'talabat pro'], stat: GCC_STAT },
    US: { name: 'United States', cur: 'USD', local: ['Hulu', 'Max', 'Paramount+', 'Peacock', 'Amazon Prime'], stat: US_STAT },
    GB: { name: 'United Kingdom', cur: 'GBP', local: ['NOW', 'BritBox', 'Amazon Prime', 'Disney+'], stat: UK_STAT },
    IN: { name: 'India', cur: 'INR', local: ['JioHotstar', 'ZEE5', 'SonyLIV', 'Amazon Prime'], stat: US_STAT },
    PK: { name: 'Pakistan', cur: 'PKR', local: ['Tamasha', 'Amazon Prime'], stat: US_STAT },
    EU: { name: 'Europe (EUR)', cur: 'EUR', local: ['Amazon Prime', 'Disney+', 'DAZN'], stat: US_STAT },
    CA: { name: 'Canada', cur: 'CAD', local: ['Crave', 'Amazon Prime', 'Disney+'], stat: US_STAT },
    AU: { name: 'Australia', cur: 'AUD', local: ['Stan', 'Binge', 'Amazon Prime'], stat: US_STAT },
    XX: { name: 'Other country (USD)', cur: 'USD', local: ['Amazon Prime', 'Disney+'], stat: US_STAT }
  };
  var EU_CODES = 'AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK'.split(' ');

  var TZ = {
    'Asia/Dubai': 'AE', 'Asia/Riyadh': 'SA', 'Asia/Qatar': 'QA', 'Asia/Kuwait': 'KW', 'Asia/Bahrain': 'BH', 'Asia/Muscat': 'OM',
    'Europe/London': 'GB', 'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Karachi': 'PK',
    'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Edmonton': 'CA', 'America/Winnipeg': 'CA', 'America/Halifax': 'CA'
  };

  var KEY = 'subsweep.country';

  function normalize(code) {
    code = String(code || '').toUpperCase();
    if (C[code]) return code;
    if (EU_CODES.indexOf(code) !== -1) return 'EU';
    return code ? 'XX' : null;
  }
  function fromTimezone() {
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      if (TZ[tz]) return TZ[tz];
      if (/^Australia\//.test(tz)) return 'AU';
      if (/^America\//.test(tz)) return 'US';
      if (/^Europe\//.test(tz)) return 'EU';
    } catch (e) { /* ignore */ }
    return null;
  }
  function fromLanguage() {
    var m = (navigator.language || '').match(/-([A-Za-z]{2})$/);
    return m ? normalize(m[1]) : null;
  }
  function saved() { try { return normalize(localStorage.getItem(KEY)); } catch (e) { return null; } }

  // Static hosting (GitHub Pages) has no server-side country lookup, so we use the device's
  // time zone, then its language. Nothing is sent anywhere.
  function detect() {
    var s = saved();
    if (s) return Promise.resolve({ code: s, how: 'saved' });
    return Promise.resolve({ code: fromTimezone() || fromLanguage() || 'US', how: 'browser' });
  }

  function info(code) { var c = C[code] || C.XX; return { code: code, name: c.name, cur: c.cur, local: c.local, stat: c.stat }; }

  function convert(amount, from, to) { return amount * (TO_AED[from] || 1) / (TO_AED[to] || 1); }
  function money(v, cur, opts) {
    try { return new Intl.NumberFormat('en', Object.assign({ style: 'currency', currency: cur, maximumFractionDigits: v >= 100 ? 0 : 2 }, opts || {})).format(v); }
    catch (e) { return cur + ' ' + (+v).toFixed(2); }
  }

  var listeners = [];
  var current = null;
  var ready = detect().then(function (r) { current = info(r.code); current.how = r.how; return current; });

  window.SSLocale = {
    ready: ready,
    countries: C,
    rates: TO_AED,
    currencies: Object.keys(TO_AED),
    convert: convert,
    money: money,
    get: function () { return current; },
    set: function (code) {
      code = normalize(code) || 'XX';
      try { localStorage.setItem(KEY, code); } catch (e) { /* ignore */ }
      current = info(code); current.how = 'saved';
      listeners.forEach(function (fn) { fn(current); });
    },
    onChange: function (fn) { listeners.push(fn); },
    // Fill a <select> with the country list and keep it in sync.
    bindSelect: function (sel) {
      Object.keys(C).forEach(function (k) { sel.add(new Option(C[k].name, k)); });
      ready.then(function (c) { sel.value = c.code; });
      sel.addEventListener('change', function () { window.SSLocale.set(sel.value); });
      listeners.push(function (c) { sel.value = c.code; });
    }
  };
})();
