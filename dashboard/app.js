// Signal Radar dashboard: reads window.RADAR from data.js and renders a sortable, filterable board,
// a live-token view and a per-protocol detail dialog. No network, no framework, no fetch.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return Math.round(d) + 'd';
  }
  function impliedOf(row, m) {
    var g = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var gm = 1 + (g / 100) * m.growth_weight;
    var age = row.age_days === null ? m.unknown_age_days : row.age_days;
    var om = m.overdue_floor + (Math.min(Math.max(age, 0), m.overdue_days) / m.overdue_days) * m.overdue_range;
    return Math.max(1, Math.round(row.tvl_usd * m.base * gm * om));
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) node.appendChild(x); });
      else if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    }
    return node;
  }
  function chainOf(p) { return p.chains && p.chains.length ? p.chains[0] : 'its main chain'; }
  function allChains(p) { return p.chains && p.chains.length ? p.chains.slice(0, 3).join(', ') : 'the chain it runs on'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 60;
    if (age < 180) return 90;
    if (age < 365) return 60;
    return 45;
  }
  function gasFor(p) {
    var c = chainOf(p).toLowerCase();
    if (c.indexOf('ethereum') >= 0 || c.indexOf('arbitrum') >= 0 || c.indexOf('optimism') >= 0 || c.indexOf('base') >= 0) return 6;
    if (c.indexOf('solana') >= 0 || c.indexOf('ton') >= 0 || c.indexOf('stellar') >= 0 || c.indexOf('algorand') >= 0) return 1;
    return 3;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var n = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0 || c.indexOf('uncollateralized') >= 0) return 'Supply $' + capital + ' of USDC to ' + n + ' on ' + chain + ' and let it accrue.';
    if (c.indexOf('dex') >= 0 || c.indexOf('amm') >= 0 || c.indexOf('liquidity') >= 0) return 'Provide $' + capital + ' of two-sided liquidity to ' + n + "'s main pool on " + chain + ' and keep the receipt.';
    if (c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('basis') >= 0) return 'Deposit $' + capital + " into " + n + "'s yield vault on " + chain + ' and keep the share tokens.';
    if (c.indexOf('bridge') >= 0 || c.indexOf('canonical') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + n + ', then use the bridged funds once in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0 || c.indexOf('pooling') >= 0) return "Stake $" + capital + " of the chain's liquid staking asset through " + n + ' and keep the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('perp') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + n + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + n + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('vault') >= 0) return 'Deposit $' + capital + ' into a ' + n + ' curated vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0 || c.indexOf('dual-token') >= 0) return 'Mint $' + capital + ' of the stable asset through ' + n + ' on ' + chain + ' and hold it.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of " + n + "'s on-chain yield asset on " + chain + ' and hold one distribution.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + n + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' to ' + n + ' on ' + chain + ' and make one transaction in its native app.';
    return 'Deposit $' + capital + ' of USDC into ' + n + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(s) {
    var out = s.text + ' Cost: ' + s.cost + '. Time: ' + s.time + '.';
    if (out.length > 600) out = out.slice(0, 596) + '...';
    if (out.length < 20) out += ' Keep the position until a snapshot records it.';
    return out;
  }
  function farmSteps(p) {
    var chain = chainOf(p), chains = allChains(p), capital = capitalFor(p);
    var gas = gasFor(p), hold = holdDaysFor(p.age_days), action = actionFor(p, capital, chain);
    return [
      { text: 'Open a fresh wallet funded with only the $' + capital + ' you plan to commit; keep its seed phrase offline and never reuse it elsewhere.', cost: '$' + capital + ' capital, no platform fee', time: '5 minutes' },
      { text: 'Connect that wallet to ' + p.name + ' on ' + chains + '; confirm you are on the protocol own app, not a search result or a DM link.', cost: 'one connection, about $' + gas + ' of gas', time: '10 minutes' },
      { text: action, cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes' },
      { text: 'Repeat one small qualifying action each week: a deposit, a borrow, a swap or a governance vote. Uneven weeks count as real use.', cost: 'about $' + Math.max(1, Math.round(gas / 2)) + ' of gas a week', time: '10 minutes a week' },
      { text: 'Keep the first position open for at least ' + hold + ' days so more than one weekly snapshot records the activity.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Check the protocol own points or rewards page before you withdraw, and claim only from the link the protocol publishes itself.", cost: 'no cost to check; never pay to claim', time: '10 minutes' },
      { text: 'Record the wallet address, each date and every transaction hash in a farm log, so you can prove the activity and unwind cleanly.', cost: 'nothing beyond the log', time: '5 minutes' },
      { text: 'Set a reminder to re-check ' + p.name + ' own announcements monthly; stop farming if the protocol says no token is planned.', cost: 'no capital at risk', time: 'monthly, 5 minutes' }
    ].map(stepText);
  }
  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    var p = new URLSearchParams(h);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('p')) state.selected = p.get('p');
    if (p.get('category')) state.category = p.get('category');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.selected) p.set('p', state.selected);
    var h = p.toString();
    if (h) window.history.replaceState(null, '', '#' + h);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var k = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (k === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (k === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (k === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (k === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Signal Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama index' }),
        el('span', { text: DATA.model_version })
      )
    );
  }
  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Find the token that does not exist yet' }),
        el('p', { text: 'A radar over protocols whose index entry records no token. The 40-record watchlist is the floor; the early radar adds pre-token protocols below it. Every row is ranked by an implied value computed from the snapshot, not from a hand-written name list.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early, below floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live, set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }
  function controls() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var sel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      cats.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    sel.addEventListener('change', function () { state.category = sel.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), sel),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live protocols' })
    );
  }
  function sortHeader(key, label) {
    return el('th', { scope: 'col' }, el('button', { type: 'button', onclick: function () {
      if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; }
      render();
    } }, label, state.sort === key ? el('span', { text: state.dir < 0 ? ' v' : ' ^' }) : null));
  }
  function boardTable() {
    var list = sortedRows(rows());
    if (!list.length) return el('div', { class: 'panel' }, el('div', { class: 'empty' },
      el('h2', { text: 'No protocol matches that filter' }),
      el('p', { text: 'Clear the search or pick another category.' }),
      el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })
    ));
    var max = list[0].implied_value_usd || 1;
    var body = el('tbody');
    list.forEach(function (r) {
      body.appendChild(el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar' }, el('i', { style: 'width:' + Math.max(3, Math.round(r.implied_value_usd / max * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }))),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      ));
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', null,
      el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
      el('thead', null, el('tr', null,
        sortHeader('implied', 'Rank'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'),
        sortHeader('growth', '7d'), sortHeader('age', 'No-token age'), sortHeader('implied', 'Implied value'),
        el('th', { scope: 'col', text: 'Token' })
      )), body
    )));
  }
  function liveTable() {
    var body = el('tbody');
    DATA.live.forEach(function (r) {
      body.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', null,
      el('caption', { class: 'sub', text: 'These protocols already trade, so the market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
      el('thead', null, el('tr', null, el('th', { text: 'Status' }), el('th', { text: 'Protocol' }), el('th', { text: 'TVL' }), el('th', { text: '7d' }), el('th', { text: 'Market cap' }), el('th', { text: 'Token' }))),
      body
    )));
  }
  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function, the same for every row. No protocol name is special-cased and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'base     = tvl_usd x ' + m.base + '\n' +
        'growth   = 1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + '\n' +
        'overdue  = ' + m.overdue_floor + ' + min(age_days, ' + m.overdue_days + ') / ' + m.overdue_days + ' x ' + m.overdue_range + '\n' +
        'implied  = max(1, round(base x growth x overdue))'
      ),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since DefiLlama began tracking the protocol, the best record available of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. A longer record with no token scores higher. The early radar adds pre-token protocols below the ' + fmtUsd(DATA.floor_usd) + ' floor by TVL. Live-token protocols are set aside with their market caps shown.' })
    );
  }
  var dialog = el('dialog', { class: 'detail', id: 'detail' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });
  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug; writeHash(); dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null, el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })),
      el('button', { class: 'close', type: 'button', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    var p = { name: row.name, category: row.category, chains: row.chains, tvl_usd: row.tvl_usd, age_days: row.age_days };
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'No-token age' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Base x TVL' }), el('b', { class: 'num', text: fmtUsd(row.base_value) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Overdue multiplier' }), el('b', { class: 'num', text: String(row.overdue_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the number board.json carries.' : ', which differs from the board; the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' }, el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, farmSteps(p).map(function (s) {
        var at = s.indexOf(' Cost: ');
        return el('li', null, el('b', { text: at >= 0 ? s.slice(0, at) : s }), el('span', { class: 'cost', text: at >= 0 ? s.slice(at + 1) : '' }));
      }))
    ));
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }
  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header()); shell.appendChild(lede()); shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }
  readHash(); render();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();
