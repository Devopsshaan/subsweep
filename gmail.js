/* SubSweep — Connect Gmail (beta).
   Reads subscription receipts from the visitor's Gmail INSIDE THIS BROWSER using a short-lived,
   read-only Google token. No server is involved: email content never leaves the browser.
   The token is revoked as soon as the scan finishes. */
(function () {
  'use strict';
  var CFG = window.SS_CONFIG || {};
  var S = window.SubSweep;
  if (!S) return;

  var SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
  // Transactional emails only: subject must look like a receipt/renewal/trial notice; skip Promotions,
  // Social, Forums and your own sent mail, so newsletters don't crowd out real receipts.
  var QUERY = 'newer_than:1y -in:sent -from:me -category:promotions -category:social -category:forums ' +
    'subject:(receipt OR invoice OR subscription OR renew OR renews OR renewal OR "free trial" OR "trial ends" OR ' +
    '"trial ending" OR payment OR membership OR billing OR charged OR "order confirmation")';
  var TX_SUBJECT = /receipt|invoice|subscri|\brenew(s|al)?\b|has renewed|was renewed|trial|payment|membership|billing|charged|order confirmation|your order|purchase/i;
  var MAX_MESSAGES = 150;
  var RECURRING = /subscri|renew|per month|\/\s?mo(nth)?\b|monthly|per year|\/\s?yr\b|annual|yearly|membership|free trial|trial (ends|period)|plan\b|premium|per period|billing period/i;
  var SKIP_SUBJECT = /refund|statement|key fact|itinerary|e-?ticket|boarding|one[- ]time password|\botp\b|password|verify your|loan|webinar|newsletter|black friday|sale\b|% off|split in|instal+ment|tax invoice for|credit note|cancel|credit card payment|payment received|payment (was )?success|successful payment|payment due|payment confirmation|upcoming payment|payment coming up|transfer receipt|ticket|visa|emirates id|automatic reply|maintenance|threshold|payment method updated|payment info|tabby|tamara|membership (information|application|assessment|inquiry)|google ads|ads:|thanks for shopping|order invoice|easy payment plan|balance conversion|suspended|\bfree\b(?! trial)/i;
  var SKIP_SENDER = /news|newsletter|marketing|promo|offers|digest|updates@|community|research|desk|insights|webinar/i;

  function $(id) { return document.getElementById(id); }
  S._gmail = { toCandidate: toCandidate, bodyText: bodyText }; // test hook (function declarations are hoisted)
  var btn = $('gConnect'), note = $('gNote'), prog = $('gProgress'), box = $('gResults');
  if (!btn) return;

  var clientId = (CFG.googleClientId || '').trim();
  var secure = location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (!clientId) { btn.disabled = true; note.textContent = 'Gmail connection is being set up. Use the searches below for now.'; return; }
  if (!secure) { btn.disabled = true; note.textContent = 'Connect Gmail needs a secure (https://) page. Use the searches below for now.'; return; }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function setProgress(t) { prog.hidden = !t; prog.textContent = t || ''; }

  // ---------- Google sign-in (token only, in memory) ----------
  var gisReady = null;
  function loadGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    if (gisReady) return gisReady;
    gisReady = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = function () { res(); }; s.onerror = function () { gisReady = null; rej(new Error('Could not load Google sign-in.')); };
      document.head.appendChild(s);
    });
    return gisReady;
  }
  function getToken() {
    return new Promise(function (res, rej) {
      var tc = google.accounts.oauth2.initTokenClient({
        client_id: clientId, scope: SCOPE, prompt: 'select_account',
        callback: function (r) {
          if (r && r.access_token && google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)) res(r.access_token);
          else rej(new Error(r && r.error ? r.error : 'Gmail access was not granted.'));
        },
        error_callback: function (e) { rej(new Error(e && e.type === 'popup_closed' ? 'The Google window was closed.' : 'Google sign-in failed.')); }
      });
      tc.requestAccessToken();
    });
  }
  function revoke(token) { try { google.accounts.oauth2.revoke(token, function () {}); } catch (e) { /* ignore */ } }

  // ---------- Gmail API ----------
  function api(token, path) {
    return fetch('https://gmail.googleapis.com/gmail/v1/users/me/' + path, { headers: { Authorization: 'Bearer ' + token } })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) throw new Error('Gmail refused access. Please connect again.');
        if (!r.ok) throw new Error('Gmail error ' + r.status + '.');
        return r.json();
      });
  }
  function listIds(token) {
    var ids = [];
    function page(pt) {
      var q = 'messages?maxResults=100&q=' + encodeURIComponent(QUERY) + (pt ? '&pageToken=' + pt : '');
      return api(token, q).then(function (j) {
        (j.messages || []).forEach(function (m) { ids.push(m.id); });
        if (j.nextPageToken && ids.length < MAX_MESSAGES) return page(j.nextPageToken);
        return ids.slice(0, MAX_MESSAGES);
      });
    }
    return page('');
  }

  function b64(data) {
    var s = atob(String(data).replace(/-/g, '+').replace(/_/g, '/'));
    var bytes = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    try { return new TextDecoder('utf-8').decode(bytes); } catch (e) { return s; }
  }
  function htmlToText(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('style,script,head').forEach(function (n) { n.remove(); });
    doc.querySelectorAll('br,p,div,tr,li,h1,h2,h3,td').forEach(function (n) { n.append('\n'); });
    return (doc.body ? doc.body.textContent : '').replace(/[ \t ͏­]+/g, ' ').replace(/\n\s*\n+/g, '\n');
  }
  function bodyText(payload) {
    var plain = '', html = '';
    (function walk(p) {
      if (!p) return;
      if (p.body && p.body.data) {
        if (p.mimeType === 'text/plain' && !plain) plain = b64(p.body.data);
        else if (p.mimeType === 'text/html' && !html) html = b64(p.body.data);
      }
      (p.parts || []).forEach(walk);
    })(payload);
    return plain || (html ? htmlToText(html) : '');
  }
  function header(msg, name) {
    var h = (msg.payload && msg.payload.headers || []).filter(function (x) { return x.name.toLowerCase() === name; })[0];
    return h ? h.value : '';
  }

  // Turn one Gmail message into a subscription candidate (or null).
  function toCandidate(msg, account) {
    var subject = header(msg, 'subject'), from = header(msg, 'from');
    if (SKIP_SUBJECT.test(subject) || !TX_SUBJECT.test(subject) || SKIP_SENDER.test(from)) return null;
    // Only the top of the email: receipts put the important lines first, and this stops
    // a service name mentioned deep in an article from being picked up.
    var body = bodyText(msg.payload).slice(0, 3000);
    if (!RECURRING.test(subject + '\n' + body)) return null;
    var text = 'From: ' + from + '\nTo: ' + account + '\nSubject: ' + subject + '\n' + body;
    var p = S.parseReceipt(text);
    if (!p.name || !(p.price > 0)) return null;
    var lowName = p.name.toLowerCase();
    var longer = S.knownNames().filter(function (n) { return n.toLowerCase().indexOf(lowName + ' ') === 0; });
    if (longer.length === 1) p.name = longer[0];
    var sent = new Date(+msg.internalDate); sent.setHours(0, 0, 0, 0);
    var iso = sent.getFullYear() + '-' + ('0' + (sent.getMonth() + 1)).slice(-2) + '-' + ('0' + sent.getDate()).slice(-2);
    // Use the date in the email when it's a later renewal/trial-end date; otherwise the email's date (the tracker rolls it forward).
    var next = p.next && p.next >= iso ? p.next : iso;
    return {
      name: p.name, price: p.price, cur: p.cur, cycle: p.cycle || 'monthly', next: next, trial: !!p.trial,
      card: p.card || '', via: p.via || 'card', email: account, subject: subject, sent: iso
    };
  }

  function mapLimit(items, n, fn) {
    var out = new Array(items.length), i = 0;
    function worker() { if (i >= items.length) return Promise.resolve(); var k = i++; return fn(items[k], k).then(function (v) { out[k] = v; return worker(); }); }
    var ws = []; for (var w = 0; w < Math.min(n, items.length); w++) ws.push(worker());
    return Promise.all(ws).then(function () { return out; });
  }

  // ---------- flow ----------
  var found = [];
  btn.addEventListener('click', function () {
    var token = null, account = '';
    btn.disabled = true; box.hidden = true;
    setProgress('Opening Google…');
    loadGis()
      .then(getToken)
      .then(function (t) { token = t; setProgress('Connected. Finding receipts…'); return api(token, 'profile'); })
      .then(function (prof) { account = String(prof.emailAddress || '').toLowerCase(); return listIds(token); })
      .then(function (ids) {
        var done = 0;
        setProgress('Reading 0 of ' + ids.length + ' emails in ' + account + '…');
        return mapLimit(ids, 6, function (id) {
          return api(token, 'messages/' + id + '?format=full').then(function (m) {
            done++; if (done % 5 === 0 || done === ids.length) setProgress('Reading ' + done + ' of ' + ids.length + ' emails in ' + account + '…');
            return toCandidate(m, account);
          }, function () { done++; return null; });
        });
      })
      .then(function (cands) {
        // Newest first from Gmail, so the first one per service wins.
        var seen = {};
        found = cands.filter(Boolean).filter(function (c) {
          var k = c.name.toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true;
        });
        showResults(account);
      })
      .catch(function (e) { setProgress(''); S.toast(e.message || 'Something went wrong. Try again.'); })
      .then(function () { if (token) revoke(token); btn.disabled = false; });
  });

  function showResults(account) {
    setProgress('');
    if (!found.length) {
      box.hidden = false;
      box.innerHTML = '<p class="small">No subscriptions found in <strong>' + esc(account) + '</strong> in the last year. Try your other Gmail accounts.</p>';
      return;
    }
    box.hidden = false;
    box.innerHTML = '<p class="small" style="margin:0 0 8px"><strong>' + found.length + ' possible subscriptions</strong> in ' + esc(account) +
      '. Untick anything that isn\'t a subscription, then add.</p>' +
      found.map(function (c, i) {
        var dup = S.hasItem(c.name, c.email);
        return '<label class="g-row"><input type="checkbox" data-i="' + i + '"' + (dup ? '' : ' checked') + '>' +
          '<span class="g-main"><span class="g-name">' + esc(c.name) + (c.trial ? ' <span class="pill pill-trial">Trial</span>' : '') +
          (dup ? ' <span class="pill pill-muted">Already in list</span>' : '') + '</span>' +
          '<span class="g-sub">' + esc(c.subject) + ' · ' + esc(c.sent) + '</span></span>' +
          '<span class="g-price">' + esc(c.cur) + ' ' + esc((+c.price).toFixed(2)) + '</span></label>';
      }).join('') +
      '<div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap"><button class="btn btn-primary btn-sm" id="gAdd">Add selected</button>' +
      '<button class="btn btn-ghost btn-sm" id="gClose">Close</button></div>' +
      '<p class="note">Google access was removed after the scan. Prices and dates are read automatically, so check them after adding.</p>';
    $('gAdd').addEventListener('click', function () {
      var pick = Array.prototype.filter.call(box.querySelectorAll('input[data-i]'), function (x) { return x.checked; })
        .map(function (x) { return found[+x.dataset.i]; });
      if (!pick.length) { S.toast('Nothing selected'); return; }
      S.addItems(pick);
      S.toast('Added ' + pick.length + ' from ' + account);
      box.hidden = true; box.innerHTML = '';
    });
    $('gClose').addEventListener('click', function () { box.hidden = true; box.innerHTML = ''; });
  }
})();
