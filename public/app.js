'use strict';

// ---------- tiny helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) el.append(kid && kid.nodeType ? kid : document.createTextNode(kid ?? ''));
  return el;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { showLogin(); throw new Error('Please sign in.'); }
  if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status})`);
  return data;
}

// ---------- signing in ----------
let me = null;        // who is using the app: { id, username, role }
let meOpen = false;   // true when there is one account with no password, so nothing to sign in to

function showLogin(message = '') {
  if (document.querySelector('.login')) return;
  const error = h('p', { class: 'login-error', role: 'alert' }, message);
  const user = h('input', { type: 'text', name: 'username', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Username', placeholder: 'Username' });
  const pass = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', 'aria-label': 'Password', placeholder: 'Password' });
  const go = h('button', { class: 'btn primary', type: 'submit' }, 'Sign in');
  const form = h('form', { class: 'login-card', onsubmit: async (e) => {
    e.preventDefault();
    go.disabled = true;
    error.textContent = '';
    try {
      const res = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user.value, password: pass.value }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not sign in.');
      location.reload();
    } catch (err) {
      error.textContent = err.message;
      go.disabled = false;
    }
  } },
    h('h1', {}, document.title || 'Sign in'),
    h('p', { class: 'muted' }, 'Sign in to your account.'),
    h('div', { class: 'field' }, user), h('div', { class: 'field' }, pass),
    error, go);
  document.body.append(h('div', { class: 'login' }, form));
  user.focus();
}

let toastTimer;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), isErr ? 6000 : 3000);
}

async function guard(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(e.message === 'Failed to fetch' ? 'Cannot reach the app. Is it still running?' : e.message, true);
  }
}

// A bottom sheet instead of the browser's plain confirm box.
function ask({ title, body = '', confirm = 'Continue', danger = false }) {
  return new Promise((resolve) => {
    const sheet = $('#sheet');
    const yes = $('#sheet-yes');
    const previous = document.activeElement;
    $('#sheet-title').textContent = title;
    $('#sheet-body').textContent = body;
    yes.textContent = confirm;
    yes.className = 'btn ' + (danger ? 'danger' : 'primary');
    sheet.hidden = false;
    yes.focus();
    const done = (value) => {
      sheet.hidden = true;
      $('#sheet-yes').onclick = $('#sheet-no').onclick = $('#sheet-backdrop').onclick = null;
      document.removeEventListener('keydown', onKey);
      if (previous && previous.focus) previous.focus();
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    document.addEventListener('keydown', onKey);
    yes.onclick = () => done(true);
    $('#sheet-no').onclick = () => done(false);
    $('#sheet-backdrop').onclick = () => done(false);
  });
}

const cap = (t) => String(t || '').charAt(0).toUpperCase() + String(t || '').slice(1);
const money = (n, sym = '₦') => sym + Math.round(n).toLocaleString('en-US');
const when = (ts) => new Date(ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const phoneOf = (jid) => '+' + String(jid || '').split(/[:@]/)[0];
const autosize = (ta) => { ta.style.height = 'auto'; ta.style.height = Math.max(ta.scrollHeight + 2, 112) + 'px'; };

// ---------- state + navigation ----------
const view = $('#view');
const TABS = ['home', 'posts', 'settings', 'log'];
const TITLES = { home: 'Home', posts: 'Posts', settings: 'Settings', log: 'Log' };
const BRAND = $('#title').textContent;
const fromHash = () => (TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home');
let tab = fromHash();
let S = null;          // settings being edited
let savedJson = '';    // settings as last saved
let chats = { groups: [], people: [] };
let aiCfg = null;
let updateInfo = null; // result of the last update check
let postFilter = null;
let postsDirty = false;
const pairing = { phone: '', code: null };

function syncTabs() {
  for (const b of document.querySelectorAll('#tabs button')) {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  document.title = `${TITLES[tab]} · ${BRAND}`;
  if (tab !== 'settings') { $('#savebar').hidden = true; previewHook = null; }
}

const settingsDirty = () => tab === 'settings' && S && JSON.stringify(S) !== savedJson;

async function go(next) {
  if (next === tab) { show(); return; }
  if (settingsDirty() && !(await ask({ title: 'Leave without saving?', body: 'Your changes in Settings will be lost.', confirm: 'Leave', danger: true }))) return;
  location.hash = next;
}

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) go(b.dataset.tab);
});
window.addEventListener('hashchange', () => { tab = fromHash(); syncTabs(); show(); });

function updateHeader(st) {
  const c = st.whatsapp.connection;
  const map = {
    open: ['pill pill-ok', 'Connected'],
    qr: ['pill pill-wait', 'Scan the code'],
    starting: ['pill pill-wait', 'Starting…'],
    reconnecting: ['pill pill-wait', 'No connection'],
    logged_out: ['pill pill-bad', 'Logged out'],
    replaced: ['pill pill-bad', 'Link taken over'],
  };
  const [cls, label] = map[c] || map.starting;
  $('#pill').className = cls;
  $('#pill').textContent = label;
  const n = st.counts.needs_review || 0;
  $('#badge').hidden = n === 0;
  $('#badge').textContent = n;
}

// ---------- Home ----------
const STATE_TEXT = {
  paused: 'Posting is paused. Turn it back on in Settings.',
  no_targets: 'Choose the groups to post to in Settings.',
  sending: 'Posting right now…',
  due: 'Posting will start in a moment.',
  offline: 'No connection. Posts go out as soon as you are back online.',
  done: "Today's limit is reached. The rest wait for tomorrow.",
  nothing_ready: 'Nothing ready yet. New vendor posts appear after they are prepared.',
};

function stateText(sch) {
  if (sch.state === 'waiting') return `Next posting at ${sch.postTime}. ${sch.readyToday} ready to go.`;
  if (sch.state === 'nothing_ready' && sch.category) return `Nothing ready in today's category yet. New ${sch.category} posts show up after they are prepared.`;
  return STATE_TEXT[sch.state];
}

function greeting(set) {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return h('div', { class: 'greet' },
    h('h2', {}, `${part}${set.businessName ? `, ${set.businessName}` : ''}.`),
    h('p', {}, 'Here is how today is going.'));
}

function sectionHead(label, linkText, onLink) {
  return h('div', { class: 'section-head' }, h('span', { class: 'label' }, label), linkText ? h('button', { type: 'button', onclick: onLink }, linkText) : '');
}

function heroCard(sch) {
  const strip = sch.limit <= 40
    ? h('div', { class: 'strip', 'aria-hidden': 'true' }, Array.from({ length: sch.limit }, (_, i) => h('i', { class: i < sch.sentToday ? 'full' : '' })))
    : h('div', { class: 'bar', 'aria-hidden': 'true' }, h('b', { style: `width:${Math.min(100, (sch.sentToday / sch.limit) * 100)}%` }));
  return h('section', { class: 'hero' },
    h('div', { class: 'label' }, 'Posted today'),
    h('div', { class: 'hero-count' }, String(sch.sentToday), h('small', {}, ` of ${sch.limit}`)),
    sch.category ? h('div', { class: 'today-cat' }, `Today: ${cap(sch.category)}`) : '',
    h('p', {}, stateText(sch)),
    strip,
    h('button', {
      class: 'btn', disabled: sch.state === 'sending',
      onclick: () => guard(async () => {
        if (!(await ask({ title: 'Post now?', body: sch.category ? `This starts posting today's category (${cap(sch.category)}) instead of waiting for the post time. It still keeps to today's limit.` : "This starts posting instead of waiting for the post time. It still keeps to today's limit.", confirm: 'Post now' }))) return;
        const r = await api('/api/run-now', { method: 'POST' });
        toast(r.ok ? 'Posting started.' : r.reason, !r.ok);
        renderHome();
      }),
    }, 'Post now'));
}

function updateBanner() {
  if (!updateInfo?.found) return '';
  return h('section', { class: 'card' },
    h('h2', {}, `Version ${updateInfo.found.version} is ready`),
    h('p', {}, 'A newer version of the app is waiting to be installed. Your settings and posts stay.'),
    h('button', { class: 'btn primary', onclick: () => go('settings') }, 'Open the update'));
}

function setupCard(st, set) {
  const linked = st.whatsapp.connection === 'open';
  const steps = [
    [linked, 'Link your WhatsApp number'],
    [st.aiReady, 'Add your AI helper key (Settings, at the top)'],
    [set.vendorChats.length > 0, 'Choose a vendor chat to copy from'],
    [set.targetGroups.length > 0 || set.postToStatus, 'Choose where to post'],
  ];
  if (steps.every(([done]) => done)) return '';
  return h('section', { class: 'card' },
    h('h2', {}, 'Finish setting up'),
    h('ol', { class: 'steps' }, steps.map(([done, label]) => h('li', {}, `${done ? '✓ ' : ''}${label}`))),
    h('button', { class: 'btn primary', onclick: () => go('settings') }, 'Open Settings'));
}

// One tap to post a kind of item right now, whatever today's category is.
function categoryNow(sch, set) {
  if (!set.categories.length) return '';
  const by = sch.readyByCategory || {};
  const ready = (k) => by[k === 'other' ? '' : k] || 0;
  const kinds = [...set.categories, ...(by[''] ? ['other'] : [])];
  return h('div', {},
    sectionHead('Post a category now'),
    h('div', { class: 'tokens' }, kinds.map((k) => h('button', {
      class: 'chip-btn', type: 'button', disabled: ready(k) === 0 || sch.state === 'sending',
      onclick: () => guard(async () => {
        const n = Math.min(ready(k), set.itemsPerDay);
        if (!(await ask({ title: `Post ${k} now?`, body: `Up to ${n} ${k} post${n === 1 ? '' : 's'} go out now, one after another. They count towards today's total.`, confirm: `Post ${k}` }))) return;
        const r = await api('/api/run-now', { method: 'POST', body: { category: k, count: set.itemsPerDay } });
        toast(r.ok ? 'Posting started.' : r.reason, !r.ok);
        renderHome();
      }),
    }, `${cap(k)} (${ready(k)})`))));
}

function pairingBox() {
  const phone = h('input', {
    type: 'text', inputmode: 'tel', placeholder: 'Your WhatsApp number, e.g. 0803 123 4567', 'aria-label': 'Your WhatsApp number',
    value: pairing.phone, 'data-keep': '1', oninput: (e) => { pairing.phone = e.target.value; },
  });
  return h('div', {},
    h('h3', {}, 'Linking from this same phone?'),
    h('p', { class: 'muted' }, 'You cannot scan a code shown on the phone you are holding. Get a code instead: open WhatsApp, go to Linked devices, Link a device, then "Link with phone number instead", and type the code.'),
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, phone),
      h('button', {
        class: 'btn primary',
        onclick: () => guard(async () => {
          const r = await api('/api/pairing-code', { method: 'POST', body: { phone: phone.value } });
          pairing.code = r.code;
          renderHome();
        }),
      }, 'Get code')),
    pairing.code ? h('div', { class: 'code', 'aria-live': 'polite' }, pairing.code) : '');
}

function connectionBody(wa) {
  const kids = [];
  const bad = wa.connection === 'logged_out' || wa.connection === 'replaced';
  if (wa.connection === 'open') {
    pairing.code = null;
    kids.push(h('p', { class: 'muted' }, 'Your number is linked. Posts are sent from it.'));
  } else if (wa.connection === 'qr' && wa.qr) {
    kids.push(
      h('ol', { class: 'steps' },
        h('li', {}, 'On the phone with your WhatsApp number, open WhatsApp.'),
        h('li', {}, 'Go to Linked devices, then Link a device.'),
        h('li', {}, 'Scan this code with that phone. Using one phone only? Use the code option below.')),
      h('img', { class: 'qr', src: wa.qr, alt: 'QR code to link WhatsApp' }),
      h('p', { class: 'muted' }, 'The picture refreshes by itself.'),
      pairingBox());
  } else if (bad) {
    kids.push(h('p', {}, wa.connection === 'logged_out' ? 'WhatsApp logged this app out. Link it again to continue.' : 'Another device or program took over this link. Link it again to continue.'));
  } else if (wa.connection === 'reconnecting') {
    kids.push(h('p', {}, 'No connection right now. The app keeps trying, and waiting posts go out when it returns.'));
  } else {
    kids.push(h('p', {}, 'Starting up…'));
  }
  const buttons = [];
  if (wa.connection === 'open') {
    buttons.push(h('button', {
      class: 'btn',
      onclick: () => guard(async () => {
        if (!(await ask({ title: 'Send a test message?', body: 'A short test message goes to every group you chose.', confirm: 'Send test' }))) return;
        const r = await api('/api/test-message', { method: 'POST' });
        toast(`Test sent to ${r.sent.join(', ')}`);
      }),
    }, 'Test message'));
    buttons.push(h('button', {
      class: 'btn',
      onclick: () => guard(async () => {
        if (!(await ask({ title: 'Send a test status?', body: 'A short text status is posted to your WhatsApp status. You can delete it afterwards.', confirm: 'Send test status' }))) return;
        const r = await api('/api/test-status', { method: 'POST' });
        toast(`Status accepted by WhatsApp (${r.people} people can see it). Check your Status tab.`);
      }),
    }, 'Test status'));
  }
  buttons.push(h('button', {
    class: 'btn' + (bad ? ' primary' : ''),
    onclick: () => guard(async () => {
      if (!(await ask({ title: wa.connection === 'open' ? 'Use a different number?' : 'Link again?', body: 'This unlinks the current number and shows a new code to scan.', confirm: 'Continue', danger: true }))) return;
      await api('/api/relink', { method: 'POST' });
      renderHome();
    }),
  }, wa.connection === 'open' ? 'Different number' : 'Link again'));
  kids.push(h('div', { class: 'actions' }, buttons));
  return kids;
}

// One quiet row. It opens by itself when the link needs attention.
let connOpen = false;
function connectionRow(wa) {
  const bad = wa.connection === 'logged_out' || wa.connection === 'replaced';
  const subtitle = {
    open: wa.me ? `Connected as ${phoneOf(wa.me)}` : 'Connected',
    qr: 'Scan the code to link',
    starting: 'Starting up…',
    reconnecting: 'No connection. Waiting posts are kept.',
    logged_out: 'Logged out. Tap to link again',
    replaced: 'Link taken over. Tap to link again',
  }[wa.connection] || 'Starting up…';
  const summary = h('summary', {},
    h('span', { class: `dot ${wa.connection === 'open' ? 'ok' : bad ? 'bad' : ''}` }),
    h('div', {}, h('div', { class: 'row-title' }, 'WhatsApp'), h('div', { class: 'row-sub' }, subtitle)),
    h('span', { class: 'chev' }));
  const d = h('details', { class: 'row-card', open: connOpen || wa.connection !== 'open' }, summary, h('div', { class: 'row-body' }, connectionBody(wa)));
  summary.addEventListener('click', () => { connOpen = !d.open; });
  return d;
}

function circles(counts) {
  const items = [['needs_review', 'Review'], ['approved', 'Ready'], ['sent', 'Posted'], ['skipped', 'Skipped']];
  if (counts.failed) items.push(['failed', 'Failed']);
  return h('div', { class: 'circles' }, items.map(([k, label]) =>
    h('button', {
      class: `circle-item k-${k}` + (k === 'needs_review' && counts[k] ? ' hot' : ''), type: 'button', 'aria-label': `${label}: ${counts[k] || 0}`,
      onclick: () => { postFilter = k; go('posts'); },
    }, h('span', { class: 'circle' }, String(counts[k] || 0)), h('span', { class: 'label' }, label))));
}

async function renderHome() {
  const [st, set] = await Promise.all([api('/api/status'), api('/api/settings')]);
  updateHeader(st);
  if (tab !== 'home') return;
  view.replaceChildren(
    greeting(set),
    heroCard(st.schedule),
    updateBanner(),
    setupCard(st, set),
    sectionHead('Your posts', 'View all', () => { postFilter = 'all'; go('posts'); }),
    circles(st.counts),
    categoryNow(st.schedule, set),
    connectionRow(st.whatsapp));
}

// ---------- Posts ----------
const FILTERS = [
  ['needs_review', 'Needs review'], ['approved', 'Ready'], ['incoming', 'Preparing'],
  ['sent', 'Sent'], ['skipped', 'Skipped'], ['failed', 'Failed'], ['all', 'All'],
];
const STATUS_LABEL = { needs_review: 'Needs review', approved: 'Ready', incoming: 'Preparing', sent: '✓ Sent', skipped: 'Skipped', failed: '✕ Failed' };

const openPosts = new Set(); // posts the user has opened, so a refresh does not fold them shut

function postRow(p, set) {
  const sym = set.currency;
  const editable = ['needs_review', 'approved', 'skipped'].includes(p.status);
  const area = h('textarea', { 'aria-label': `Caption for post ${p.id}`, disabled: !editable, oninput: (e) => { postsDirty = true; autosize(e.target); } }, p.finalCaption);
  const act = (path, body, msg) => guard(async () => {
    await api(`/api/items/${p.id}${path}`, { method: path ? 'POST' : 'PUT', body });
    postsDirty = false;
    toast(msg);
    renderPosts();
  });
  const buttons = [];
  if (p.status === 'needs_review') buttons.push(h('button', { class: 'btn primary', onclick: () => act('/approve', { finalCaption: area.value }, 'Approved. It goes out at post time.') }, 'Approve'));
  if (p.status === 'needs_review' || p.status === 'approved') {
    buttons.push(h('button', { class: 'btn', onclick: () => act('', { finalCaption: area.value }, 'Caption saved.') }, 'Save caption'));
    buttons.push(h('button', { class: 'btn danger', onclick: () => act('/skip', {}, 'Skipped.') }, 'Skip'));
  }
  if (p.status === 'skipped') buttons.push(h('button', { class: 'btn', onclick: () => act('/restore', {}, 'Restored.') }, 'Restore'));

  const finals = p.priceLines.map((l) => l.final);
  const priceText = !finals.length ? '' : finals.length > 1 ? `from ${money(Math.min(...finals), sym)}` : money(finals[0], sym);
  const firstLine = (p.finalCaption || '').split('\n').find((l) => l.trim()) || (p.status === 'incoming' ? 'Preparing this post…' : 'No caption yet');

  const summary = h('summary', {},
    h('img', { class: 'sum-thumb', src: `/api/items/${p.id}/thumb/0`, alt: '', loading: 'lazy' }),
    h('div', {},
      h('div', { class: 'sum-title' }, firstLine),
      h('div', { class: 'sum-meta' },
        h('span', { class: `status s-${p.status}` }, STATUS_LABEL[p.status]),
        priceText ? h('b', {}, priceText) : '',
        p.category ? h('span', { class: 'cat-tag' }, p.category) : '',
        p.files.length > 1 ? `${p.files.length} pictures` : '')),
    h('span', { class: 'chev' }));

  const thumbs = p.files.length > 1 ? h('div', { class: 'thumbs' },
    p.files.slice(0, 5).map((f, i) => h('div', { class: 'thumb-wrap' },
      h('img', { class: 'thumb', src: `/api/items/${p.id}/thumb/${i}`, alt: '', loading: 'lazy' }),
      f.type === 'video' ? h('em', {}, 'video') : '')),
    p.files.length > 5 ? h('div', { class: 'more' }, `+${p.files.length - 5}`) : '') : '';
  const prices = p.priceLines.length > 1 || (p.priceLines[0] && p.priceLines[0].label)
    ? h('div', { class: 'prices' }, p.priceLines.map((l) => h('div', { class: 'price' },
        l.label ? `${l.label}: ` : '', h('span', {}, `${money(l.vendor, sym)} → `), money(l.final, sym))))
    : p.priceLines.length
      ? h('div', { class: 'prices' }, h('div', { class: 'price' }, h('span', {}, `Vendor ${money(p.priceLines[0].vendor, sym)} → `), `You ${money(p.priceLines[0].final, sym)}`))
      : h('div', { class: 'muted', style: 'margin-bottom:.8rem' }, 'No price');

  const catPick = editable && set.categories.length
    ? h('label', { class: 'cat-pick' }, 'Category',
        h('select', {
          'aria-label': `Category for post ${p.id}`,
          onfocus: () => { postsDirty = true; },
          onchange: (e) => guard(async () => {
            await api(`/api/items/${p.id}`, { method: 'PUT', body: { category: e.target.value } });
            postsDirty = false;
            toast('Category saved.');
          }),
        },
          h('option', { value: 'other', selected: !set.categories.includes(p.category) }, 'Other'),
          set.categories.map((c) => h('option', { value: c, selected: p.category === c }, cap(c)))))
    : '';

  const body = h('div', { class: 'post-body' },
    thumbs,
    catPick,
    [p.vendor, p.sentAt ? when(p.sentAt) : ''].filter(Boolean).length ? h('p', { class: 'muted' }, [p.vendor, p.sentAt ? when(p.sentAt) : ''].filter(Boolean).join(' · ')) : '',
    p.note ? h('div', { class: 'note' }, p.note) : '',
    p.status === 'incoming' ? h('p', { class: 'muted' }, 'Collecting pictures and preparing the caption…') : [prices, area],
    p.originalCaption ? h('details', { class: 'plain' }, h('summary', {}, "Vendor's original caption"), h('pre', {}, p.originalCaption)) : '',
    buttons.length ? h('div', { class: 'actions' }, buttons) : '');

  const d = h('details', { class: 'post-row', open: openPosts.has(p.id) }, summary, body);
  summary.addEventListener('click', () => { if (d.open) openPosts.delete(p.id); else openPosts.add(p.id); });
  d.addEventListener('toggle', () => { if (d.open) d.querySelectorAll('textarea').forEach(autosize); });
  return d;
}

async function renderPosts() {
  const [st, set] = await Promise.all([api('/api/status'), api('/api/settings')]);
  updateHeader(st);
  if (postFilter === null) postFilter = (st.counts.needs_review || 0) > 0 ? 'needs_review' : (st.counts.approved || 0) > 0 ? 'approved' : 'all';
  const items = await api(`/api/items?status=${postFilter}`);
  if (tab !== 'posts') return;
  const filters = h('div', { class: 'filters', role: 'group', 'aria-label': 'Show posts' }, FILTERS.map(([k, label]) =>
    h('button', { 'aria-pressed': String(postFilter === k), onclick: () => { postFilter = k; postsDirty = false; renderPosts(); } },
      `${label}${k !== 'all' && st.counts[k] ? ` (${st.counts[k]})` : ''}`)));
  const extra = [];
  if (postFilter === 'needs_review' && items.length > 1) {
    extra.push(h('button', {
      class: 'btn primary', style: 'width:100%;margin-bottom:1rem',
      onclick: () => guard(async () => {
        if (!(await ask({ title: `Approve all ${items.length} posts?`, body: 'They will go out at the next post time. Check the captions first.', confirm: 'Approve all' }))) return;
        for (const p of items) await api(`/api/items/${p.id}/approve`, { method: 'POST', body: {} });
        toast('All approved.');
        renderPosts();
      }),
    }, `Approve all (${items.length})`));
  }
  const list = items.length
    ? items.map((p) => postRow(p, set))
    : [h('div', { class: 'card empty' },
        h('strong', {}, postFilter === 'all' ? 'No posts yet' : 'Nothing here'),
        postFilter === 'all' ? 'Choose a vendor chat in Settings. Their pictures and videos show up here.' : 'Posts that match this filter will show up here.')];
  view.replaceChildren(filters, ...extra, ...list);
  view.querySelectorAll('textarea').forEach(autosize);
}

// ---------- Settings ----------
let previewHook = null;
function checkDirty() {
  if (tab !== 'settings') return;
  $('#savebar').hidden = !settingsDirty();
  if (previewHook) previewHook();
}
view.addEventListener('input', checkDirty);
view.addEventListener('change', checkDirty);

// Each settings section folds away behind one quiet row, so the screen stays calm.
let openAcc = null;
function fold(key, section, summaryText) {
  const heading = section.querySelector('h2');
  const title = heading.textContent;
  heading.remove();
  const d = h('details', { class: 'acc', open: openAcc === key },
    h('summary', {}, h('span', { class: 'acc-title' }, title), h('span', { class: 'acc-sum' }, summaryText || ''), h('span', { class: 'chev' })),
    h('div', { class: 'acc-body' }, [...section.childNodes]));
  d.addEventListener('toggle', () => {
    if (d.open) {
      openAcc = key;
      document.querySelectorAll('details.acc').forEach((o) => { if (o !== d) o.open = false; });
      d.querySelectorAll('textarea').forEach(autosize);
    } else if (openAcc === key) openAcc = null;
  });
  return d;
}

let uid = 0;
function field(label, control, hint, group = false) {
  const id = `f${++uid}`;
  return h('div', { class: 'field' },
    group ? h('span', { class: 'lbl', id }, label) : '',
    group ? h('div', { role: 'group', 'aria-labelledby': id }, control) : h('label', {}, label, control),
    hint ? h('p', { class: 'muted', style: 'margin:.3rem 0 0' }, hint) : '');
}
function switchRow(title, hint, checked, onChange) {
  return h('label', { class: 'switch-row' },
    h('span', { class: 'txt' }, title, h('small', {}, hint)),
    h('input', { type: 'checkbox', class: 'sw', role: 'switch', checked, onchange: (e) => onChange(e.target.checked) }));
}
function stepper(key, min, max, step) {
  const input = h('input', { type: 'number', inputmode: step < 1 ? 'decimal' : 'numeric', min, max, step, value: S[key], 'aria-label': key });
  const set = (v) => { S[key] = Math.min(max, Math.max(min, Math.round(v * 100) / 100)); input.value = S[key]; checkDirty(); };
  input.addEventListener('change', () => set(Number(input.value) || min));
  return h('div', { class: 'stepper' },
    h('button', { class: 'btn', type: 'button', 'aria-label': 'Less', onclick: () => set(S[key] - step) }, '−'),
    input,
    h('button', { class: 'btn', type: 'button', 'aria-label': 'More', onclick: () => set(S[key] + step) }, '+'));
}
function selectField(key, options) {
  return h('select', { 'aria-label': key, onchange: (e) => (S[key] = isNaN(e.target.value) ? e.target.value : Number(e.target.value)) },
    options.map(([v, label]) => h('option', { value: v, selected: String(S[key]) === String(v) }, label)));
}

function normalisePhone(raw) {
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('0') && d.length === 11) d = '234' + d.slice(1);
  else if (d.length === 10) d = '234' + d;
  return d.length >= 11 && d.length <= 15 ? `${d}@s.whatsapp.net` : null;
}

function aiSection() {
  const provider = h('select', { 'aria-label': 'AI helper', onchange: (e) => { aiCfg.provider = e.target.value; aiCfg.model = aiCfg.defaults[aiCfg.provider]; draw(); } },
    Object.entries(aiCfg.providers).map(([k, v]) => h('option', { value: k, selected: aiCfg.provider === k }, v.label)));
  const key = h('input', { type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'AI key' });
  const model = h('input', { type: 'text', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Model name' });
  const hint = h('p', { class: 'muted' });
  const status = h('p', { class: 'muted', 'aria-live': 'polite' });
  const draw = () => {
    key.placeholder = aiCfg.hasKey[aiCfg.provider] ? 'Saved. Paste a new key to replace it' : 'Paste your key here';
    model.value = aiCfg.model;
    const p = aiCfg.providers[aiCfg.provider];
    hint.replaceChildren(
      aiCfg.provider === 'gemini'
        ? 'Free: sign in at '
        : 'Paid: create a key at ',
      h('a', { href: p.keyUrl, target: '_blank', rel: 'noopener' }, p.keyUrl.replace('https://', '')),
      aiCfg.provider === 'gemini'
        ? ', tap Create API key, and paste it here. The free tier has daily limits, and Google may use free-tier content to improve its products. Vendor pictures and captions are what get sent.'
        : ', add credit, and paste the key here.');
    status.textContent = aiCfg.hasKey[aiCfg.provider] ? 'A key is saved for this helper.' : 'No key saved yet for this helper.';
  };
  draw();
  return h('section', { class: 'card' },
    h('h2', {}, 'AI helper'),
    h('p', { class: 'muted' }, 'It reads each vendor post and writes your caption in fresh words. The vendor\'s own sentences are never reused.'),
    field('Which helper', provider),
    field('Key', key),
    field('Model', model, 'Leave as it is unless a model name stops working.'),
    hint,
    status,
    h('div', { class: 'actions' },
      h('button', {
        class: 'btn primary', type: 'button',
        onclick: () => guard(async () => {
          aiCfg = await api('/api/ai', { method: 'PUT', body: { provider: aiCfg.provider, key: key.value, model: model.value } });
          key.value = '';
          draw();
          const r = await api('/api/ai/test', { method: 'POST' });
          toast(`The AI helper works (${r.model}).`);
        }),
      }, 'Save and test')));
}

function updateSection() {
  const info = h('p', { 'aria-live': 'polite' });
  const actions = h('div', { class: 'actions' });
  const source = h('input', { type: 'text', inputmode: 'url', autocapitalize: 'off', spellcheck: 'false', placeholder: 'Optional: https://github.com/you/your-repo/archive/refs/heads/main.zip', 'aria-label': 'Update web address' });
  let poll = null;

  const draw = () => {
    const u = updateInfo || { version: '', state: 'idle', message: '', found: null };
    info.textContent = u.state === 'working' ? u.message : [`You have version ${u.version}.`, u.message].filter(Boolean).join(' ');
    const buttons = [];
    if (u.found && u.state !== 'working') {
      buttons.push(h('button', {
        class: 'btn primary', type: 'button',
        onclick: () => guard(async () => {
          if (!(await ask({ title: `Install version ${u.found.version}?`, body: 'Your settings, posts and WhatsApp login stay. The app restarts when it is done, which can take a few minutes.', confirm: 'Install' }))) return;
          updateInfo = await api('/api/update/install', { method: 'POST' });
          draw();
          watch();
        }),
      }, `Install version ${u.found.version}`));
    }
    buttons.push(h('button', {
      class: 'btn', type: 'button', disabled: u.state === 'working',
      onclick: () => guard(async () => {
        info.textContent = 'Looking…';
        updateInfo = await api('/api/update/check', { method: 'POST' });
        draw();
      }),
    }, 'Check for an update'));
    actions.replaceChildren(...buttons);
  };

  // While installing, keep asking how it is going. The app restarts at the end, so when it comes back, reload.
  const watch = () => {
    clearInterval(poll);
    poll = setInterval(async () => {
      try {
        const u = await api('/api/update');
        if (updateInfo && updateInfo.state === 'lost') { clearInterval(poll); location.reload(); return; }
        updateInfo = u;
        draw();
        if (u.state === 'done' && !u.canRestart) clearInterval(poll);
        if (u.state === 'error' || u.state === 'idle') clearInterval(poll);
      } catch {
        updateInfo = { ...(updateInfo || {}), state: 'lost', message: 'Restarting…' };
        draw();
      }
    }, 3000);
  };

  api('/api/update').then((u) => { source.value = u.source || ''; if (!updateInfo) { updateInfo = u; } draw(); if (u.state === 'working') watch(); }).catch(() => {});
  draw();

  return h('section', { class: 'card' },
    h('h2', {}, 'App updates'),
    h('p', { class: 'muted' }, 'When you get a new version, save the new whatsapp-poster.zip to your Downloads folder, then tap Check for an update. Nothing to type.'),
    info,
    actions,
    h('h3', {}, 'Update from a web address (optional)'),
    h('p', { class: 'muted' }, 'If you keep the app in a GitHub repository, paste the address of its zip download here and the check will look there too.'),
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, source),
      h('button', { class: 'btn', type: 'button', onclick: () => guard(async () => { await api('/api/update/source', { method: 'PUT', body: { url: source.value } }); toast('Saved.'); }) }, 'Save')));
}

function vendorSection() {
  const rows = h('div', { class: 'vendors' });
  const search = h('input', { type: 'search', placeholder: 'Search your chats by name', 'aria-label': 'Search chats', autocomplete: 'off' });
  const list = h('div', { class: 'picklist' });
  const phone = h('input', { type: 'text', inputmode: 'tel', placeholder: 'e.g. 0803 123 4567', 'aria-label': 'Vendor phone number' });

  const drawRows = () => {
    rows.replaceChildren(...(S.vendorChats.length
      ? S.vendorChats.map((v) => h('div', { class: 'vendor-row' },
          h('div', { class: 'grow' },
            h('strong', {}, v.name),
            h('div', { class: 'muted' }, 'Profit % for this vendor (empty = your normal profit)')),
          h('input', {
            type: 'number', inputmode: 'decimal', min: 0, max: 1000, step: 0.5, placeholder: String(S.profitPercent),
            value: v.profitPercent ?? '', 'aria-label': `Profit percent for ${v.name}`,
            onchange: (e) => { const t = e.target.value.trim(); if (t === '') delete v.profitPercent; else v.profitPercent = Number(t); },
          }),
          h('button', { class: 'chip-x', type: 'button', 'aria-label': `Remove ${v.name}`, onclick: () => { S.vendorChats = S.vendorChats.filter((x) => x.jid !== v.jid); drawRows(); checkDirty(); } }, '×')))
      : [h('p', { class: 'muted' }, 'No vendor chosen yet.')]));
  };
  const add = (jid, name) => {
    if (!jid || S.vendorChats.some((v) => v.jid === jid)) return;
    S.vendorChats.push({ jid, name });
    drawRows();
    checkDirty();
  };
  const drawList = () => {
    const q = search.value.trim().toLowerCase();
    const all = [...chats.groups.map((c) => ({ ...c, tag: 'Group' })), ...chats.people.map((c) => ({ ...c, tag: 'Chat' }))]
      .filter((c) => !q || (c.name || '').toLowerCase().includes(q));
    const shown = all.slice(0, 30);
    list.replaceChildren(...(shown.length
      ? [...shown.map((c) => h('button', { type: 'button', class: 'pick', onclick: () => add(c.jid, c.name || phoneOf(c.jid)) }, c.name || phoneOf(c.jid), h('small', {}, c.tag))),
         ...(all.length > shown.length ? [h('p', { class: 'muted' }, 'Keep typing to narrow the list.')] : [])]
      : [h('p', { class: 'muted' }, chats.groups.length || chats.people.length ? 'No chat matches.' : 'No chats yet. Connect WhatsApp first, or add a vendor by phone number below.')]));
  };
  search.addEventListener('input', drawList);
  drawRows();
  drawList();

  return h('section', { class: 'card' },
    h('h2', {}, 'Vendors to copy from'),
    h('p', { class: 'muted' }, 'Pictures and videos in these chats are picked up, priced with your profit, and queued. Pictures a vendor sends together become one post.'),
    rows,
    h('h3', {}, 'Add a vendor'),
    search,
    list,
    h('h3', {}, 'Or add by phone number'),
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, phone),
      h('button', { class: 'btn', type: 'button', onclick: () => { const jid = normalisePhone(phone.value); if (!jid) return toast('That phone number does not look right.', true); add(jid, phone.value.trim()); phone.value = ''; } }, 'Add')),
    h('p', { class: 'muted', style: 'margin-top:.6rem' }, 'A vendor missing from the list appears after they send one message.'));
}

let todayCat = null; // today's category as the app sees it, for the Settings screen
function categorySection() {
  const box = h('div');
  const quick = ['bags', 'shoes', 'sandals', 'clothes', 'jewellery', 'watches', 'wigs'];
  const draw = () => {
    const cats = S.categories;
    const move = (i, d) => { [cats[i], cats[i + d]] = [cats[i + d], cats[i]]; draw(); checkDirty(); };
    const remove = (c) => { S.categories = S.categories.filter((x) => x !== c); draw(); checkDirty(); };
    const add = (text) => {
      for (const w of String(text).split(',').map((x) => x.trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean)) {
        if (w === 'other') { toast('\"Other\" is already there for anything that fits none of your categories.', true); continue; }
        if (w.length >= 2 && !S.categories.includes(w)) S.categories.push(w);
      }
      draw();
      checkDirty();
    };
    const input = h('input', { type: 'text', placeholder: 'e.g. bags', 'aria-label': 'New category', autocapitalize: 'off', onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); add(input.value); } } });
    const current = S.rotationAnchorDay === '__today__' ? S.rotationAnchorName : (S.categories.includes(todayCat) ? todayCat : (S.categories.includes(S.rotationAnchorName) ? S.rotationAnchorName : S.categories[0]));

    box.replaceChildren(
      h('h3', {}, 'Your categories, in posting order'),
      ...(cats.length
        ? cats.map((c, i) => h('div', { class: 'catrow' },
            h('span', { class: 'catnum' }, String(i + 1)),
            h('strong', { class: 'grow' }, cap(c)),
            h('button', { class: 'chip-x', type: 'button', 'aria-label': `Move ${c} up`, disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
            h('button', { class: 'chip-x', type: 'button', 'aria-label': `Move ${c} down`, disabled: i === cats.length - 1, onclick: () => move(i, 1) }, '↓'),
            h('button', { class: 'chip-x', type: 'button', 'aria-label': `Remove ${c}`, onclick: () => remove(c) }, '×')))
        : [h('p', { class: 'muted' }, 'No categories yet. Add the kinds of items you sell.')]),
      h('div', { class: 'row', style: 'margin-top:.6rem' },
        h('div', { class: 'grow' }, input),
        h('button', { class: 'btn', type: 'button', onclick: () => { add(input.value); input.value = ''; } }, 'Add')),
      h('div', { class: 'tokens', style: 'margin-top:.6rem' }, quick.filter((q) => !S.categories.includes(q)).map((q) =>
        h('button', { class: 'chip-btn', type: 'button', onclick: () => add(q) }, `+ ${cap(q)}`))),
      cats.length ? h('div', {},
        switchRow('Post one category a day', 'Each day only one category goes out, then the app moves to the next one in the list, round and round.', S.rotateCategories, (v) => {
          S.rotateCategories = v;
          if (v) { S.rotationAnchorName = S.categories.includes(S.rotationAnchorName) ? S.rotationAnchorName : S.categories[0]; S.rotationAnchorDay = '__today__'; }
          draw();
          checkDirty();
        }),
        S.rotateCategories ? h('div', {},
          field('Category for today', h('select', {
            'aria-label': 'Category for today',
            onchange: (e) => { S.rotationAnchorName = e.target.value; S.rotationAnchorDay = '__today__'; draw(); checkDirty(); },
          }, S.categories.map((c) => h('option', { value: c, selected: c === current }, cap(c)))),
          'Tomorrow is the next one in the list. Change this to start the rotation somewhere else.'),
          switchRow('If today\'s category has nothing ready, post other items', 'Off means a day with nothing in its category is simply skipped. On fills the day with whatever else is ready.', S.categoryFallback, (v) => (S.categoryFallback = v)),
          h('p', { class: 'muted' }, 'The app only keeps posts from the last day, so each day\'s category is picked from what your vendors posted in the last 24 hours.')) : '') : '');
  };
  draw();
  return h('section', { class: 'card' },
    h('h2', {}, 'Categories'),
    h('p', { class: 'muted' }, 'The AI sorts every new vendor post into one of these, or \"Other\" if none fits. You can change a post\'s category in the Posts tab. Posts already waiting are sorted by the words in their captions.'),
    box);
}

function targetSection() {
  const search = h('input', { type: 'search', placeholder: 'Search groups', 'aria-label': 'Search groups', autocomplete: 'off' });
  const box = h('div', { class: 'picklist' });
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const known = new Map(chats.groups.map((g) => [g.jid, g.name]));
    for (const t of S.targetGroups) if (!known.has(t.jid)) known.set(t.jid, t.name);
    const rows = [...known].filter(([, name]) => !q || (name || '').toLowerCase().includes(q));
    box.replaceChildren(...(rows.length ? rows.map(([jid, name]) =>
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: S.targetGroups.some((t) => t.jid === jid), onchange: (e) => {
          S.targetGroups = e.target.checked ? [...S.targetGroups, { jid, name }] : S.targetGroups.filter((t) => t.jid !== jid);
        } }), name || jid))
      : [h('p', { class: 'muted' }, 'No groups yet. Connect WhatsApp, then tap "Refresh groups".')]));
  };
  search.addEventListener('input', draw);
  draw();
  return h('section', { class: 'card' },
    h('h2', {}, 'Where to post'),
    switchRow('Post to my status', 'Each post also goes to your WhatsApp status.', S.postToStatus, (v) => (S.postToStatus = v)),
    h('h3', {}, 'Groups'),
    search,
    box,
    h('div', { class: 'actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => guard(async () => { await api('/api/chats/refresh', { method: 'POST' }); chats = await api('/api/chats'); draw(); toast('Group list updated.'); }) }, 'Refresh groups')));
}

function textField(key, { multiline = false, rows = 3, placeholder = '', maxlength } = {}) {
  const common = { value: S[key], placeholder, maxlength, autocapitalize: 'off' };
  if (!multiline) return h('input', { type: 'text', ...common, onchange: (e) => (S[key] = e.target.value) });
  return h('textarea', { style: `min-height:${rows * 1.6}rem`, placeholder, maxlength, oninput: (e) => { S[key] = e.target.value; autosize(e.target); } }, S[key]);
}
const numberField = (key, min, max, step = 1) =>
  h('input', { type: 'number', inputmode: 'decimal', min, max, step, value: S[key], onchange: (e) => (S[key] = Number(e.target.value) || 0) });

const LAYOUTS = [
  ['Simple', '{description}\n\n{prices}\n\n{footer}'],
  ['With emojis', '🛍️ {title}\n🎨 Colours: {colours}\n📏 Size: {sizes}\n{details}\n\n💰 {prices}\n\n{footer}'],
  ['Clean', '{title}\n\n{details}\n\n{prices}\n\n{footer}'],
];

function removeSection() {
  const chips = h('div', { class: 'tokens' });
  const input = h('input', { type: 'text', placeholder: 'Type a word or phrase, then tap Add', 'aria-label': 'Word to remove', autocapitalize: 'off' });
  const draw = () => {
    chips.replaceChildren(...(S.removePhrases.length
      ? S.removePhrases.map((w) => h('span', { class: 'chip' }, w, h('button', { type: 'button', 'aria-label': `Stop removing ${w}`, onclick: () => { S.removePhrases = S.removePhrases.filter((x) => x !== w); draw(); checkDirty(); } }, '×')))
      : [h('span', { class: 'muted' }, 'Nothing is being removed yet.')]));
  };
  const add = (text) => {
    const words = String(text).split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
    for (const w of words) if (!S.removePhrases.includes(w)) S.removePhrases.push(w);
    draw();
    checkDirty();
  };
  draw();
  return h('section', { class: 'card' },
    h('h2', {}, 'Words to remove'),
    h('p', { class: 'muted' }, 'Vendors fill posts with hype. Anything you list here is cut out of every post, together with the emojis stuck to it.'),
    chips,
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, input),
      h('button', { class: 'btn', type: 'button', onclick: () => { add(input.value); input.value = ''; } }, 'Add')),
    h('h3', {}, 'Tap to add'),
    h('div', { class: 'tokens' }, ['new arrival', 'luxury', 'premium', 'hot sale', 'available now', 'restocked', 'limited stock', 'high quality', 'original', 'moq']
      .map((w) => h('button', { class: 'chip-btn', type: 'button', onclick: () => add(w) }, w))));
}

function layoutSection() {
  const area = h('textarea', { style: 'min-height:8rem', 'aria-label': 'Caption layout', oninput: (e) => { S.template = e.target.value; autosize(e.target); } }, S.template);
  const insert = (token) => {
    const start = area.selectionStart ?? area.value.length;
    area.value = area.value.slice(0, start) + token + area.value.slice(area.selectionEnd ?? start);
    area.focus();
    area.setSelectionRange(start + token.length, start + token.length);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  };
  return h('section', { class: 'card' },
    h('h2', {}, 'Caption layout'),
    h('p', { class: 'muted' }, 'Design how every post looks. Tap a piece to add it, and type any words, emojis or lines you like around them.'),
    h('h3', {}, 'Start from a ready-made layout'),
    h('div', { class: 'tokens' }, LAYOUTS.map(([label, tpl]) =>
      h('button', { class: 'chip-btn', type: 'button', onclick: () => { area.value = tpl; area.dispatchEvent(new Event('input', { bubbles: true })); } }, label))),
    h('h3', {}, 'Add a piece'),
    h('div', { class: 'tokens' }, [['{title}', 'Product name'], ['{colours}', 'Colours'], ['{sizes}', 'Sizes'], ['{details}', 'Other details'], ['{description}', 'Whole description'], ['{prices}', 'Your prices'], ['{business}', 'Business name'], ['{footer}', 'Ending text']]
      .map(([tok, label]) => h('button', { class: 'chip-btn', type: 'button', onclick: () => insert(tok) }, label))),
    area,
    h('p', { class: 'muted', style: 'margin:.3rem 0 1rem' }, 'A line whose pieces are empty (for example Sizes when the vendor gave none) is left out. Leave out {prices} and prices will not appear in your posts.'),
    switchRow('Always show sizes', 'When the vendor gives sizes (for example 37-41 on shoes), they are added to the caption even if your layout has no {sizes} line. Items without sizes get no sizes line.', S.showSizes, (v) => (S.showSizes = v)),
    field('One price looks like', textField('priceSingle', { placeholder: 'Price: {price}' }), 'Use {price} where the amount goes.'),
    field('Several prices look like (one line each)', textField('priceMulti', { placeholder: '{label}: {price}' }), 'Use {label} for the colour or size and {price} for the amount.'),
    field('Business name', textField('businessName', { placeholder: 'Used where you put {business}' })),
    field('Text added at the end of every post', textField('footer', { multiline: true, rows: 3, placeholder: 'For example: To order, message me on 0803…' }), 'Goes where you put {footer}.'));
}

function previewSection() {
  const single = h('pre', { class: 'bubble' }, '…');
  const multi = h('pre', { class: 'bubble' }, '…');
  let timer;
  const refresh = async () => {
    try {
      const r = await api('/api/preview', { method: 'POST', body: S });
      single.textContent = r.single || '(empty)';
      multi.textContent = r.multi || '(empty)';
    } catch { /* keep the old preview */ }
  };
  previewHook = () => { clearTimeout(timer); timer = setTimeout(refresh, 350); };
  refresh();
  return h('section', { class: 'card' },
    h('h2', {}, 'Preview'),
    h('p', { class: 'muted' }, 'How a post will look with your settings. The product words here are an example; the AI writes the real ones.'),
    h('h3', {}, 'One price'), single,
    h('h3', {}, 'A normal price plus a bulk price'), multi);
}

// ---------- your account, and (for the admin) the other people who use the app ----------
function accountSection() {
  const current = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Current password' });
  const next = h('input', { type: 'password', autocomplete: 'new-password', 'aria-label': meOpen ? 'Choose a password' : 'New password' });
  return h('section', { class: 'card' },
    h('h2', {}, 'Your account'),
    h('p', {}, h('strong', {}, me.username), me.role === 'admin' ? ' (admin)' : ''),
    meOpen ? h('p', { class: 'muted' }, 'Right now anyone who opens this address can use your app. Set a password to protect it. You need one before you can add other people.') : '',
    meOpen ? '' : field('Current password', current),
    field(meOpen ? 'Choose a password' : 'New password', next, 'At least 8 characters.'),
    h('button', { class: 'btn primary', type: 'button', onclick: () => guard(async () => {
      await api('/api/account/password', { method: 'PUT', body: { current: current.value, next: next.value } });
      toast('Password saved.');
      if (meOpen) location.reload();
      current.value = '';
      next.value = '';
    }) }, 'Save password'),
    meOpen ? '' : h('button', { class: 'btn', type: 'button', style: 'margin-left:.6rem', onclick: () => guard(async () => {
      await api('/api/logout', { method: 'POST' });
      location.reload();
    }) }, 'Sign out'));
}

const WA_WORDS = { open: 'WhatsApp connected', qr: 'waiting to link WhatsApp', connecting: 'connecting', reconnecting: 'reconnecting', logged_out: 'WhatsApp needs linking again', off: 'not started', starting: 'starting' };

function peopleSection() {
  const list = h('div', {}, h('p', { class: 'muted' }, 'Loading…'));
  const name = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'New username', placeholder: 'Username' });
  const pass = h('input', { type: 'text', autocomplete: 'off', 'aria-label': 'Their first password', placeholder: 'First password (8+ characters)' });
  const draw = async () => {
    const people = await api('/api/users');
    list.replaceChildren(...people.map((u) => {
      const reset = h('input', { type: 'text', autocomplete: 'off', 'aria-label': `New password for ${u.username}`, placeholder: 'New password (8+ characters)', hidden: true });
      const saveReset = h('button', { class: 'btn primary', type: 'button', hidden: true, onclick: () => guard(async () => {
        await api(`/api/users/${u.id}/password`, { method: 'PUT', body: { password: reset.value } });
        reset.value = ''; reset.hidden = true; saveReset.hidden = true;
        toast(`Password changed for ${u.username}.`);
      }) }, 'Save');
      return h('div', { class: 'catrow person' },
        h('strong', { class: 'grow' }, u.username, h('small', { class: 'muted' }, ` ${u.role === 'admin' ? 'admin · ' : ''}${WA_WORDS[u.whatsapp] || u.whatsapp}`)),
        u.role === 'admin' ? '' : h('button', { class: 'btn', type: 'button', onclick: () => { reset.hidden = !reset.hidden; saveReset.hidden = reset.hidden; reset.focus(); } }, 'New password'),
        u.role === 'admin' ? '' : h('button', { class: 'btn danger', type: 'button', onclick: () => guard(async () => {
          if (!(await ask({ title: `Remove ${u.username}?`, body: 'Their posts, settings and WhatsApp link are deleted for good. They cannot sign in any more.', confirm: 'Remove', danger: true }))) return;
          await api(`/api/users/${u.id}`, { method: 'DELETE' });
          toast(`${u.username} was removed.`);
          draw();
        }) }, 'Remove'),
        h('div', { class: 'person-reset' }, reset, saveReset));
    }));
  };
  guard(draw);
  return h('section', { class: 'card' },
    h('h2', {}, 'People'),
    h('p', { class: 'muted' }, 'Everyone you add gets their own WhatsApp link, vendors, groups, schedule, profit and AI key. They cannot see yours, and you cannot see theirs. Give them this web address with their username and password.'),
    list,
    h('h3', {}, 'Add someone'),
    h('div', { class: 'field' }, name), h('div', { class: 'field' }, pass),
    h('button', { class: 'btn primary', type: 'button', onclick: () => guard(async () => {
      await api('/api/users', { method: 'POST', body: { username: name.value, password: pass.value } });
      toast(`${name.value.trim().toLowerCase()} can sign in now.`);
      name.value = ''; pass.value = '';
      draw();
    }) }, 'Add person'));
}

async function renderSettings() {
  let status;
  [S, chats, aiCfg, status] = await Promise.all([api('/api/settings'), api('/api/chats'), api('/api/ai'), api('/api/status')]);
  todayCat = status.schedule.category;
  if (tab !== 'settings') return;
  savedJson = JSON.stringify(S);
  $('#savebar').hidden = true;
  previewHook = null;

  if (openAcc === null && !aiCfg.hasKey[aiCfg.provider]) openAcc = 'ai';
  const n = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const kinds = (count) => `${count} ${count === 1 ? 'category' : 'categories'}`;
  view.replaceChildren(
    fold('account', accountSection(), me.username),
    me.role === 'admin' ? fold('people', peopleSection(), 'Add people') : '',
    fold('ai', aiSection(), `${aiCfg.provider === 'gemini' ? 'Gemini' : 'Claude'} · ${aiCfg.hasKey[aiCfg.provider] ? 'ready' : 'add a key'}`),
    me.role === 'admin' ? fold('updates', updateSection(), updateInfo?.found ? `v${updateInfo.found.version} ready` : updateInfo?.version ? `v${updateInfo.version}` : '') : '',
    fold('vendors', vendorSection(), n(S.vendorChats.length, 'vendor')),
    fold('targets', targetSection(), `${n(S.targetGroups.length, 'group')}${S.postToStatus ? ' + status' : ''}`),
    fold('categories', categorySection(), S.rotateCategories && S.categories.length ? `${cap(todayCat || S.categories[0])} today · ${kinds(S.categories.length)}` : S.categories.length ? kinds(S.categories.length) : 'Off'),
    fold('schedule', h('section', {},
      h('h2', {}, 'Schedule'),
      switchRow('Posting is on', 'Turn off to pause. Vendor posts still queue up.', S.enabled, (v) => (S.enabled = v)),
      field('Post time each day', h('input', { type: 'time', value: S.postTime, onchange: (e) => (S.postTime = e.target.value) }), 'If the internet is off then, posts go out when it returns the same day.'),
      field('Items per day', stepper('itemsPerDay', 1, 500, 1), 'The most posts sent in one day. A post with several pictures counts as one. The rest wait for the next day.', true),
      field('Only post recent items (hours)', stepper('recentHours', 1, 24, 1), 'Posts older than this disappear from the app and are never posted, so you never post old stock. 24 is the longest: only the last day is kept.', true),
      field('Which first', selectField('pickOrder', [['newest', 'Newest first'], ['oldest', 'Oldest first']])),
      field('Wait between posts (minutes)', h('div', { class: 'row' },
        h('div', { class: 'grow' }, h('input', { type: 'number', inputmode: 'decimal', min: 0, max: 120, step: 0.5, value: S.gapMinMinutes, 'aria-label': 'Shortest wait', onchange: (e) => (S.gapMinMinutes = Number(e.target.value)) })),
        h('span', {}, 'to'),
        h('div', { class: 'grow' }, h('input', { type: 'number', inputmode: 'decimal', min: 0, max: 120, step: 0.5, value: S.gapMaxMinutes, 'aria-label': 'Longest wait', onchange: (e) => (S.gapMaxMinutes = Number(e.target.value)) }))),
        'Spacing posts out looks natural and lowers the risk of WhatsApp blocking the number.', true),
      field('Wait for the rest of a set (seconds)', numberField('bundleWaitSeconds', 10, 600), 'Pictures a vendor sends close together become one post. A message with a price ends the set, so pictures sent after it start a new post with their own price. This is how long to wait for the last picture and its text.'),
      field('Time zone', h('input', { type: 'text', value: S.timezone, autocapitalize: 'off', onchange: (e) => (S.timezone = e.target.value.trim()) }), 'Nigeria is Africa/Lagos.')), `${S.postTime} · ${S.itemsPerDay} a day`),
    fold('profit', h('section', {},
      h('h2', {}, 'Your profit'),
      field('Profit added (%)', stepper('profitPercent', 0, 1000, 1), 'Your normal profit. You can set a different one for each vendor above.', true),
      field('Plus a fixed amount', numberField('profitFixed', 0, 10000000, 50), 'Added after the percentage. Leave at 0 for none.'),
      field('Never earn less than', numberField('minProfit', 0, 10000000, 50), 'Cheap items still get at least this much profit. Leave at 0 for none.'),
      field('Round the price up to', selectField('roundUpTo', [[1, 'Nearest 1'], [10, 'Next 10'], [50, 'Next 50'], [100, 'Next 100'], [500, 'Next 500'], [1000, 'Next 1,000']])),
      field('Currency symbol', textField('currency', { maxlength: 5 })),
      switchRow('Post items with no price', 'Turn off to skip vendor posts where no price is found.', S.postItemsWithoutPrice, (v) => (S.postItemsWithoutPrice = v))), `${S.profitPercent}%${S.profitFixed ? ` + ${S.profitFixed}` : ''}`),
    fold('layout', layoutSection(), 'Your layout'),
    fold('remove', removeSection(), n(S.removePhrases.length, 'word')),
    fold('voice', h('section', {},
      h('h2', {}, 'How the words sound'),
      field('Language', textField('captionLanguage', { placeholder: 'English, Pidgin, Yoruba…' }), 'The AI writes the product description in this language.'),
      field('Emojis', selectField('emojiLevel', [['none', 'None'], ['few', 'A few'], ['lots', 'Lots']])),
      field('Length', selectField('captionLength', [['short', 'Short'], ['medium', 'Medium'], ['long', 'Long and detailed']])),
      switchRow('Add hashtags', 'The AI adds a few hashtags at the end of the description.', S.hashtags, (v) => (S.hashtags = v)),
      field('An example in your own style', textField('captionExample', { multiline: true, rows: 5, placeholder: 'Paste a post you wrote and like. The AI copies its tone, wording and layout.' }), 'Optional. Works best with a Claude key.'),
      field('Your own style notes', textField('captionStyle', { multiline: true, rows: 3, placeholder: 'For example: speak like a friendly big sister, never use capital letters' }), 'Anything else you want the AI to remember when it writes.'),
      field('Which pictures carry the caption', selectField('captionPlacement', [['all', 'Every picture'], ['last', 'Only the last picture'], ['first', 'Only the first picture']]), 'For posts with several pictures. Every picture is best, so each one shows the price.'),
      switchRow('Review every post first', 'Recommended at the start. Posts wait in the Posts tab until you approve them. Posts with an unclear price always wait.', S.reviewBeforeSending, (v) => (S.reviewBeforeSending = v)),
      field('Never post items with these words', h('input', { type: 'text', value: S.extraBlockedWords.join(', '), autocapitalize: 'off', onchange: (e) => (S.extraBlockedWords = e.target.value.split(',').map((w) => w.trim()).filter(Boolean)) }), 'Separate with commas. Bras, boxers, panties and similar underwear are always skipped.')), `${S.captionLanguage} · emojis: ${S.emojiLevel}`),
    fold('preview', previewSection(), 'Sample post'));
  view.querySelectorAll('textarea').forEach(autosize);
}

$('#save').addEventListener('click', () => guard(async () => {
  const wanted = S.timezone;
  const saved = await api('/api/settings', { method: 'PUT', body: S });
  if (saved.timezone !== wanted) toast('That time zone is not valid, so the old one was kept.', true);
  else toast('Settings saved.');
  S = saved;
  savedJson = JSON.stringify(S);
  $('#savebar').hidden = true;
  if (saved.timezone !== wanted) renderSettings();
}));
$('#discard').addEventListener('click', () => guard(renderSettings));

// ---------- Log ----------
async function renderLog() {
  const lines = await api('/api/log');
  if (tab !== 'log') return;
  view.replaceChildren(h('section', { class: 'card' },
    h('h2', {}, 'What the app has been doing'),
    lines.length ? lines.map((l) => h('div', { class: `logline ${l.level}` }, h('time', {}, when(l.ts)), h('span', {}, l.msg))) : h('p', { class: 'muted' }, 'Nothing yet.')));
}

// ---------- routing + refresh ----------
function show() {
  postsDirty = false;
  window.scrollTo(0, 0);
  const run = { home: renderHome, posts: renderPosts, settings: renderSettings, log: renderLog }[tab];
  guard(run);
}

setInterval(() => {
  if (document.hidden) return;
  if (tab === 'home') { if (!document.activeElement?.dataset?.keep) guard(renderHome); }
  else if (tab === 'posts' && !postsDirty) guard(renderPosts);
  else if (tab === 'log') guard(renderLog);
  else if (tab === 'settings') api('/api/status').then(updateHeader).catch(() => {});
}, 5000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && tab !== 'settings') show();
});

async function start() {
  let session;
  try {
    session = await (await fetch('/api/session')).json();
  } catch {
    session = { user: null };
  }
  if (!session.user) return showLogin();
  me = session.user;
  meOpen = !!session.open;
  syncTabs();
  show();
  if (me.role === 'admin') api('/api/update/check', { method: 'POST' }).then((u) => { updateInfo = u; if (tab === 'home') guard(renderHome); }).catch(() => {});
}
start();
