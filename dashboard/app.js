// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail drawer with
// the model's own arithmetic and the protocol's farm plan, the live-token view and the
// methodology with its peer-calibration table. No network: every byte it shows is in
// data.js. The page recomputes each row's implied value from the snapshot figures, so
// the page's code and board.json visibly carry the same number.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watchlist: false, tab: 'board', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return 'x' + n.toFixed(4); }

  // The model in one function: the page recomputes a row from the snapshot figures and
  // the peer multiple main.ts calibrated, and checks the number board.json carries.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * row.model.multiple * growthMult * maturity));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: the category's
  // family decides the action, the TVL the capital, the chain the gas, the age the
  // hold. No name is special-cased.
  function familyOf(category) {
    var c = (category || '').toLowerCase();
    if (c.indexOf('stak') >= 0 || c.indexOf('restak') >= 0) return 'stake';
    if (c.indexOf('bridge') >= 0) return 'bridge';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'lend';
    if (c.indexOf('dex') >= 0) return 'dex';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'derivatives';
    if (c.indexOf('prediction') >= 0) return 'prediction';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('liquidity manager') >= 0) return 'vault';
    if (c.indexOf('rwa') >= 0) return 'rwa';
    if (c.indexOf('insurance') >= 0) return 'insurance';
    if (c.indexOf('stable') >= 0 || c.indexOf('dual-token') >= 0) return 'stable';
    if (c.indexOf('basis') >= 0) return 'basis';
    if (c.indexOf('btc') >= 0 || c.indexOf('anchor') >= 0) return 'btc';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'payments';
    if (c.indexOf('index') >= 0) return 'index';
    if (c.indexOf('otc') >= 0) return 'otc';
    if (c.indexOf('governance') >= 0) return 'governance';
    if (c.indexOf('chain') >= 0) return 'chain';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0) return 'yield';
    return 'generic';
  }
  function mainAction(family, name, capital, chain) {
    var S = '$' + capital;
    switch (family) {
      case 'stake': return 'Stake ' + S + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the receipt token in your wallet.';
      case 'bridge': return 'Bridge ' + S + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
      case 'lend': return 'Supply ' + S + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
      case 'dex': return 'Provide ' + S + " of liquidity to " + name + "'s main pool on " + chain + ' and keep the position open.';
      case 'derivatives': return 'Deposit ' + S + ' of USDC as margin on ' + name + ' and open one small hedged position.';
      case 'prediction': return 'Fund your account with ' + S + ' and place one market position on ' + name + '.';
      case 'vault': return 'Deposit ' + S + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares.';
      case 'rwa': return 'Mint ' + S + " of the protocol's yield-bearing asset through " + name + ' on ' + chain + ' and hold it.';
      case 'insurance': return 'Buy ' + S + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
      case 'stable': return 'Mint or deposit ' + S + ' of the stable asset through ' + name + ' on ' + chain + '.';
      case 'basis': return 'Deposit ' + S + " into " + name + "'s basis-trading vault on " + chain + ' and keep the shares.';
      case 'btc': return 'Deposit ' + S + ' of BTC-backed collateral through ' + name + ' on ' + chain + ' and hold the receipt.';
      case 'payments': return 'Fund ' + S + ' through ' + name + ' and make one real payment with it.';
      case 'index': return 'Buy ' + S + ' of the ' + name + ' index on ' + chain + ' and hold it.';
      case 'otc': return 'Place one ' + S + ' OTC order through ' + name + ' on ' + chain + '.';
      case 'governance': return 'Deposit ' + S + " into " + name + "'s incentive pool on " + chain + ' and vote when a proposal opens.';
      case 'chain': return 'Move ' + S + " onto " + name + "'s chain and use its main app at least once.";
      case 'yield': return 'Deposit ' + S + " into " + name + "'s highest-yield vault on " + chain + ' and keep the shares.';
      default: return 'Deposit ' + S + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
    }
  }
  function weeklyAction(family, name) {
    switch (family) {
      case 'stake': return 'Restake or compound the staking rewards ' + name + ' pays you, so the position keeps growing.';
      case 'bridge': return 'Bridge a small amount back, or to a second chain, through ' + name + ' once a week so the bridge sees repeat use.';
      case 'lend': return 'Borrow a small amount against your deposit on ' + name + ', then repay it the same week.';
      case 'dex': return "Route one swap through " + name + "'s pool each week instead of another exchange.";
      case 'derivatives': return 'Open and close one small hedged position on ' + name + ' each week.';
      case 'prediction': return 'Place one small position on a new market on ' + name + ' each week.';
      case 'vault': return 'Top up the ' + name + " vault with a small amount each week and check the vault's yield.";
      case 'rwa': return 'Reinvest the yield ' + name + ' pays into the same asset once a week.';
      case 'insurance': return 'Renew or top up your cover on ' + name + ' when the policy nears expiry.';
      case 'stable': return 'Mint or redeem a small amount of the stable asset through ' + name + ' each week.';
      case 'basis': return "Check " + name + "'s funding-rate report each week and add to the vault when the rate is positive.";
      case 'btc': return 'Add a small amount of BTC-backed collateral to ' + name + ' each week.';
      case 'payments': return 'Make one real payment with ' + name + ' each week.';
      case 'index': return 'Add a small amount to the ' + name + ' index each week.';
      case 'otc': return 'Place one small OTC order through ' + name + ' each week.';
      case 'governance': return 'Vote on every ' + name + ' proposal that opens, and read its forum once a week.';
      case 'chain': return "Use " + name + "'s chain at least once a week: a swap, a transfer or a contract call.";
      case 'yield': return 'Claim the yield ' + name + ' pays you and re-deposit it once a week.';
      default: return 'Make one more deposit, swap or vote on ' + name + ' each week.';
    }
  }
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasFor(chain) {
    if (chain === 'Ethereum') return 'about $12 of gas';
    if (chain === 'Bitcoin' || chain === 'Tron') return 'about $4 of gas';
    return 'under $2 of gas';
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var gas = gasFor(chain);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var family = familyOf(p.category);
    return [
      { text: 'Set up a fresh wallet that holds only the funds you plan to farm with, and keep its seed phrase offline on paper.', cost: gas + ' for the first transaction', time: '5 minutes' },
      { text: mainAction(family, p.name, capital, chain), cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: weeklyAction(family, p.name), cost: gas + ' a week', time: '10 minutes a week' },
      { text: "Open " + p.name + "'s own points or rewards page once a week and confirm your activity still shows.", cost: 'no fee to check', time: '5 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so your activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'When a token or points claim opens, claim only from the link ' + p.name + ' publishes on its own page — never from a reply, a DM or an ad.', cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet address, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it cleanly.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('wl') === '1') state.watchlist = true;
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlist) params.set('wl', '1');
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlist && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'radar', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-name' }, 'TOKEN ', el('em', { text: 'RADAR' }))),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'DefiLlama protocol index'),
        el('span', null, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }

  function hero() {
    var top = DATA.rows.slice(0, 10);
    var metrics = [
      [fmtUsd(top.reduce(function (sum, r) { return sum + r.implied_value_usd; }, 0)), 'Top 10 implied value', 'Combined model estimate'],
      [String(DATA.rows.filter(function (r) { return r.watchlist; }).length), 'Watchlist protocols', 'Above the TVL floor'],
      [fmtMult(DATA.calibration.global_multiple), 'Median peer multiple', DATA.calibration.global_peers + ' live tokens calibrated'],
      [String(DATA.rows.length), 'Protocols ranked', 'Pre-token opportunity set']
    ];
    return el('section', { class: 'hero' },
      el('div', { class: 'hero-copy' },
        el('div', { class: 'eyebrow', text: 'PRE-TOKEN INTELLIGENCE / SEALED SNAPSHOT' }),
        el('h1', null, 'Find the signal. ', el('span', { text: 'Before the token.' })),
        el('p', { text: 'Discover pre-token DeFi protocols ranked by peer-calibrated implied value. Compare the opportunity, inspect the math, build your farm plan.' })),
      el('div', { class: 'stats' }, metrics.map(function (m, i) {
        return el('div', { class: 'stat' + (i === 0 ? ' hot' : '') }, el('span', { text: m[1] }), el('b', { text: m[0] }), el('small', { text: m[2] }));
      }))
    );
  }

  function topChart() {
    var top = DATA.rows.slice(0, 10);
    var max = top[0].implied_value_usd;
    return el('section', { class: 'panel leaders', 'aria-label': 'Top ten protocols by implied value' },
      el('div', { class: 'chart-heading' }, el('div', null, el('div', { class: 'eyebrow', text: 'THE LEADING SIGNALS' }), el('h2', { text: 'Top 10 · implied value' })), el('span', { class: 'sub', text: 'USD · peer-calibrated estimates, not token prices' })),
      el('div', { class: 'chart-grid' }, top.map(function (r) {
        return el('button', { type: 'button', class: 'chart-row', onclick: function () { openDetail(r.slug); }, 'aria-label': r.name + ': ' + fmtUsd(r.implied_value_usd) },
          el('span', { class: 'chart-rank', text: String(r.rank).padStart(2, '0') }),
          el('span', { class: 'chart-name', text: r.name }),
          el('span', { class: 'chart-track' }, el('i', { style: 'width:' + Math.max(2, r.implied_value_usd / max * 100) + '%' })),
          el('b', { class: 'num', text: fmtUsd(r.implied_value_usd) }));
      })), el('div', { class: 'chart-caption', text: '01—10 / Ranked by model estimate · Select any signal to investigate →' }));
  }

  function tabButton(name, label) {
    return el('button', { type: 'button', 'aria-pressed': state.tab === name ? 'true' : 'false', text: label, onclick: function () { state.tab = name; writeHash(); render(); } });
  }
  function tabs() {
    return el('div', { class: 'tabs', role: 'group', 'aria-label': 'View' },
      tabButton('board', 'Board'),
      tabButton('live', 'Live tokens'),
      tabButton('method', 'Method')
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chainCounts = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chainCounts[c] = (chainCounts[c] || 0) + 1; }); });
    var chains = Object.keys(chainCounts).sort(function (a, b) { return chainCounts[b] - chainCounts[a] || (a < b ? -1 : 1); });
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c + ' (' + DATA.rows.filter(function (r) { return (r.category || 'Other') === c; }).length + ')', selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c + ' (' + chainCounts[c] + ')', selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var wl = el('input', { type: 'checkbox', id: 'wl', checked: state.watchlist ? 'checked' : null });
    wl.addEventListener('change', function () { state.watchlist = wl.checked; writeHash(); render(); });
    var shown = rows();
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('label', { class: 'check', for: 'wl' }, wl, 'Watchlist only'),
      el('span', { class: 'count', text: shown.length + ' of ' + DATA.board_size + ' rows shown' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function chainsCell(r) {
    var cs = r.chains || [];
    if (cs.length === 0) return '—';
    if (cs.length <= 2) return cs.join(', ');
    return cs.slice(0, 2).join(', ') + ' +' + (cs.length - 2);
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlist = false; writeHash(); render(); } })
      ));
    }
    var max = list.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 1);
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', null, el('span', { class: 'rank rank-' + r.rank, text: String(r.rank).padStart(2, '0') })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }))),
        el('td', null, el('span', { class: 'category cat-' + familyOf(r.category), text: r.category || 'Other' })),
        el('td', { class: 'sub', text: chainsCell(r) }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'tag ' + (r.watchlist ? 'watch' : 'early'), text: r.watchlist ? 'Watchlist' : 'Early' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Chains' }),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Board' })
          )),
          tbody
        )
      ),
      el('div', { class: 'note' }, el('b', { text: 'Select a row' }), ' for its value breakdown, live peers and farm plan. Rank 1 is the board’s most valuable protocol; the bar is sized against the largest implied value shown.')
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }))),
        el('td', null, el('span', { class: 'category cat-' + familyOf(r.category), text: r.category || 'Other' })),
        el('td', { class: 'sub', text: chainsCell(r) }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtMult(r.ratio) }),
        el('td', null, el('span', { class: 'tag live', text: 'Already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Chains' }),
            el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'Mcap / TVL' }), el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      ),
      el('div', { class: 'note' }, 'The top ', el('b', { text: String(DATA.live_size) }), ' of ', el('b', { text: String(DATA.live_total) }),
        ' live-token protocols by market cap. Their market caps are facts, not a model — and their median mcap per dollar of TVL is what calibrates the pre-token board. They are set aside from the ranking, never mixed into it.')
    );
  }

  function methodView() {
    var m = DATA.model;
    var cal = DATA.calibration;
    var calibRows = cal.categories.map(function (c) {
      return el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: String(c.peers) }),
        el('td', { class: 'num', text: fmtMult(c.multiple) }),
        el('td', { class: 'sub', text: c.fallback ? 'Global median — under the ' + m.min_peers + '-peer bar' : 'Category median' })
      );
    });
    return el('section', { class: 'panel method' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', null, 'Every row is scored by one function of the snapshot figures. ',
        el('b', { text: 'No protocol name is special-cased, and no row is hand-picked.' }),
        ' The multiple is peer-calibrated: the market prices each category, and a protocol with no token inherits the median price of the tokens already trading in its own category.'),
      el('div', { class: 'formula', text:
        'multiple   = median mcap/TVL of the live tokens in the protocol’s category\n' +
        '             (at least ' + m.min_peers + ' live peers, else the global median ' + fmtMult(cal.global_multiple) + ' over ' + cal.global_peers + ' live tokens; capped at ' + fmtMult(m.multiple_cap) + ')\n' +
        'base       = tvl_usd × multiple\n' +
        'growth     = 1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 × ' + m.growth_weight + '\n' +
        'maturity   = ' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' × ' + m.maturity_range + '   (age unknown: ' + m.unknown_age_days + ' days)\n' +
        'implied    = round(base × growth × maturity)'
      }),
      el('div', { class: 'constants' },
        el('div', { class: 'const' }, el('b', { text: fmtMult(cal.global_multiple) }), el('span', { text: 'Global median mcap/TVL (' + cal.global_peers + ' live tokens)' })),
        el('div', { class: 'const' }, el('b', { text: String(m.min_peers) + ' peers' }), el('span', { text: 'Live peers a category needs for its own multiple' })),
        el('div', { class: 'const' }, el('b', { text: fmtMult(m.multiple_cap) }), el('span', { text: 'Cap on any category multiple' })),
        el('div', { class: 'const' }, el('b', { text: m.growth_floor + '% to +' + m.growth_cap + '%' }), el('span', { text: 'Seven-day growth, clamped' })),
        el('div', { class: 'const' }, el('b', { text: m.maturity_floor + ' to ' + (m.maturity_floor + m.maturity_range).toFixed(1) }), el('span', { text: 'Maturity over ' + m.maturity_days + ' days listed' })),
        el('div', { class: 'const' }, el('b', { text: DATA.as_of }), el('span', { text: 'Snapshot date: every age is measured from it' }))
      ),
      el('p', null, 'Ages are the time since DefiLlama began tracking the protocol, measured from the snapshot date — the best record of how long it has run with no token. ',
        'The early radar is every rankable pre-token protocol below the watchlist floor, scored by the same model and taken by implied value.'),
      el('h3', { text: 'Peer calibration by category' }),
      el('div', { class: 'calib-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Live peers' }),
            el('th', { scope: 'col', text: 'Median mcap/TVL' }), el('th', { scope: 'col', text: 'Source' })
          )),
          el('tbody', null, calibRows)
        )
      ),
      el('p', { class: 'sub', text: 'A category with fewer than ' + m.min_peers + ' live-token protocols with a market cap cannot price itself, so it inherits the global median. The median — never the mean — keeps one outlier token from moving a whole category. A protocol with no usable market cap (null, zero or negative — the snapshot carries one negative figure) is left out of the calibration entirely.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); render(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    var peers = DATA.peers[row.category || 'Other'] || [];
    var calRow = null;
    DATA.calibration.categories.forEach(function (c) { if (c.category === (row.category || 'Other')) calRow = c; });
    var multipleNote = row.model.multiple_source === 'category'
      ? 'Category median over ' + (calRow ? calRow.peers : 0) + ' live peers'
      : 'Global median — only ' + (calRow ? calRow.peers : 0) + ' live peer' + ((calRow && calRow.peers === 1) ? '' : 's') + ' in this category';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'sub', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' · Watchlist' : ' · Early') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('div', { class: 'eyebrow', text: 'VALUE DECOMPOSITION' }),
      el('div', { class: 'value-head', text: fmtUsd(row.implied_value_usd) }),
      el('div', { class: 'value-flow' }, [
        [fmtUsd(row.tvl_usd), 'TVL'],
        [fmtMult(row.model.multiple), 'Peer multiple'],
        ['x' + row.model.growth_multiplier.toFixed(3), 'Growth tilt'],
        ['x' + row.model.maturity_multiplier.toFixed(3), 'Maturity']
      ].map(function (v) { return el('div', null, el('b', { class: 'num', text: v[0] }), el('span', { text: v[1] })); })),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Peer multiple' }), el('b', { class: 'num', text: fmtMult(row.model.multiple) })),
        el('div', null, el('span', { text: 'Base value (TVL x multiple)' }), el('b', { class: 'num', text: fmtUsd(row.model.base_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth ' + fmtPct(row.change_7d) }), el('b', { class: 'num', text: 'x' + row.model.growth_multiplier.toFixed(4) })),
        el('div', null, el('span', { text: 'Age with no token (' + fmtAge(row.age_days) + ')' }), el('b', { class: 'num', text: 'x' + row.model.maturity_multiplier.toFixed(4) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Multiple source: ' + multipleNote + '.' }),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    var peersSection = peers.length === 0
      ? el('p', { class: 'sub', text: 'No live-token protocol in this category yet, so the global median calibrates this row.' })
      : el('div', { class: 'table-wrap' },
          el('table', { class: 'peers' },
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Live peer' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Mcap/TVL' }))),
            el('tbody', null, peers.map(function (pr) {
              return el('tr', null,
                el('td', { text: pr.name }),
                el('td', { class: 'num', text: fmtUsd(pr.mcap_usd) }),
                el('td', { class: 'num', text: fmtUsd(pr.tvl_usd) }),
                el('td', { class: 'num', text: fmtMult(pr.ratio) })
              );
            }))
          )
        );
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Calibration peers · ' + (row.category || 'this category') }),
      peersSection
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('span', { text: 'Data: ' + DATA.source + '. The snapshot is frozen; every age is measured from ' + DATA.as_of + '.' }),
      el('span', { text: 'A protocol is shown as pre-token when its DefiLlama record carries no token — the record is not proof it has none. Implied value is this entry’s own claim, never make.fun’s.' })
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    if (state.tab === 'board') shell.appendChild(topChart());
    shell.appendChild(tabs());
    if (state.tab === 'board') {
      shell.appendChild(controls());
      shell.appendChild(boardTable());
    } else if (state.tab === 'live') {
      shell.appendChild(el('div', { style: 'height:16px' }));
      shell.appendChild(liveTable());
    } else {
      shell.appendChild(el('div', { style: 'height:16px' }));
      shell.appendChild(methodView());
    }
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected && !dialog.open) openDetail(state.selected);
  }

  window.addEventListener('hashchange', function () {
    if (dialog.open) dialog.removeAttribute('open');
    state = { q: '', category: 'all', chain: 'all', watchlist: false, tab: 'board', sort: 'implied', dir: -1, selected: null };
    readHash();
    render();
  });
  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
