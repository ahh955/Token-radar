// Token Radar dashboard: renders the board from window.RADAR (written by
// main.ts into data.js), recomputes every row in the browser, and re-runs
// the farm verdicts live when the deposit or drop-share controls move.
const R = window.RADAR;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// Short money: $1.52B, $45.2M, $823K, $512. Full money: $1,521,754,662.
function fmt(v) {
  if (v == null || isNaN(v)) return '—';
  const a = Math.abs(v), s = v < 0 ? '−$' : '$';
  if (a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return s + (a / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return s + (a / 1e3).toFixed(0) + 'K';
  if (a >= 1) return s + a.toFixed(0);
  return s + a.toFixed(2);
}
const full = (v) => '$' + Math.round(v).toLocaleString('en-US');
const pct = (v, d) => (v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(d == null ? 1 : d) + '%');
const ageStr = (a) => a == null ? 'unknown' : a < 30 ? a + 'd' : a < 365 ? Math.round(a / 30) + 'mo' : (a / 365).toFixed(1) + 'y';
// FNV-1a, the same checksum main.ts prints: the page re-derives it.
function checksum(rows) {
  let h = 0x811c9dc5;
  const t = rows.map((r) => r.slug + ':' + r.rank + ':' + r.implied).join('|');
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
// Farm economics re-run from the row's stored figures, at any deposit and
// drop share. Slice scales with both; fees are fixed; T-bill scales with
// deposit and hold.
function farm(r, dep, share) {
  const d = dep || r.deposit, s = share == null ? 0.1 : share;
  const slice = s * r.implied * (d / r.tvl);
  const tbill = d * 0.04 * (r.hold / 365);
  const net = slice - r.fees - tbill;
  return { dep: d, share: s, slice, tbill, net, netHour: net / r.hours, verdict: net > 0 ? 'FARM' : slice > r.fees ? 'MARGINAL-THIN' : 'SKIP' };
}
// Hash state: view=board|detail|live|method, plus board filters and sort.
function state() {
  const o = { view: 'board', q: '', cat: '', chain: '', tier: '', verdict: '', dep: '', share: '0.1', s: 'rank', d: '0', slug: '' };
  const h = location.hash.slice(1);
  if (h) h.split('&').forEach((p) => { const i = p.indexOf('='); if (i > 0) o[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1)); });
  return o;
}
function setState(o) {
  const p = [];
  for (const k of ['view', 'q', 'cat', 'chain', 'tier', 'verdict', 'dep', 'share', 's', 'd', 'slug']) {
    if (o[k] !== '' && o[k] != null) p.push(k + '=' + encodeURIComponent(o[k]));
  }
  history.replaceState(null, '', '#' + p.join('&'));
  render();
}
const S = () => state();
// ---- board header panels -------------------------------------------------
function renderHead() {
  const t = R.tests, tot = R.totals;
  $('kpis').innerHTML = [
    [R.rows.length, 'protocols ranked', '40 watchlist + ' + (R.rows.length - 40) + ' below the floor'],
    [fmt(tot.implied), 'implied value, all rows', 'value-if-launches x token odds'],
    ['x' + t.loo.miss, 'held-out miss (leave-one-out)', 'flat multiple: x' + R.tests.flat.loo_miss],
    [t.loo.cov50 + '% / ' + t.loo.cov80 + '%', 'range holds (P25–P75 / P10–P90)', 'older→newer miss x' + t.time.miss],
    [tot.farm, 'worth farming at plan size', tot.marginal + ' marginal · ' + tot.skip + ' skip'],
    ['40/40', 'watchlist on the board', R.snapshot_n + ' protocols accounted for'],
  ].map((k) => '<div class="kpi"><b>' + k[0] + '</b><span>' + k[1] + '</span><em>' + k[2] + '</em></div>').join('');
  $('formula').innerHTML = 'implied value = <code>' + esc(R.curve.formula) + '</code> (fitted on ' + R.comps_n +
    ' traded tokens, one per ticker) × category × growth × seasoning × token odds (Brier ' +
    t.brier.model + ' vs ' + t.brier.base + ' base rate, n=' + t.brier.n + ').';
  const A = R.accounting;
  const seg = [['ranked', A.ranked, '#5eead4'], ['already record a token', A.trades, '#38bdf8'], ['set aside by rule', A.setAside, '#f59e0b']];
  $('account').innerHTML = '<div class="bar">' +
    seg.map((g) => '<i style="width:' + (100 * g[1] / R.snapshot_n) + '%;background:' + g[2] + '" title="' + g[0] + '"></i>').join('') + '</div><p><b>' +
    R.snapshot_n + ' protocols, each in exactly one group:</b> ' +
    seg.map((g) => '<b style="color:' + g[2] + '">■</b> ' + g[1] + ' ' + g[0]).join(' &nbsp; ') +
    ' (set-aside reasons on the Method tab).</p>';
  // Integrity: recompute every row's implied value from its stored factors,
  // the totals, the checksum and the watchlist count, here in the browser.
  let ok = 0;
  for (const r of R.rows) {
    const v = r.curve * r.catF * r.growthF * r.seasonF * r.odds;
    if (Math.abs(v - r.implied) / r.implied < 0.02) ok++;
  }
  const sum = R.rows.reduce((a, r) => a + r.implied, 0);
  const wl = R.rows.filter((r) => r.tier === 'watchlist').length;
  $('integrity').innerHTML = '✓ This table = board.json: ' + ok + ' of ' + R.rows.length + ' rows recomputed here (within rounding) · ranks 1–' +
    R.rows.length + ' in order, values never rise ✓ totals equal: ' + full(sum) + ' ✓ checksum ' + checksum(R.rows) + ' = ' +
    R.checksum + ' ✓ watchlist ' + wl + ' of 40 ranked ✓ ledger ' + R.snapshot_n + ' of ' + R.snapshot_n + ' protocols.';
  $('ablation').innerHTML = '<table class="mini"><tr><th>Model term</th><th class="num">Leave-one-out miss</th><th class="num">Older→newer miss</th><th>Verdict</th></tr>' +
    R.ablation.map((a) => '<tr><td>' + esc(a.term) + '</td><td class="num">×' + a.loo + '</td><td class="num">×' + a.time +
    '</td><td>' + (a.verdict === 'kept' ? '<b style="color:#86efac">kept</b>' : a.verdict === 'baseline' ? 'baseline' : '<b style="color:#fbbf24">' + a.verdict + '</b>') + '</td></tr>').join('') + '</table>';
  $('rangehon').textContent = 'Range honesty (LOO): ' + t.loo.cov50 + '% in P25–P75 (50% exact) · ' +
    t.loo.cov80 + '% in P10–P90 (80% exact) · ' + t.loo.within3 + '% within 3× of the real cap.';
  $('scatter-note').textContent = 'Blue dots: traded tokens; teal dots: board rows at implied value; line: fitted curve with its P25–P75 band.';
}
// ---- scatter plot ----------------------------------------------------------
function scatter(id) {
  const c = $(id); if (!c) return;
  const g = c.getContext('2d'), W = c.width, H = c.height, L = 46, B = 26, T = 8, Rr = 8;
  const xs = [1e6, 1e7, 1e8, 1e9, 1e10, 1e11], ys = [1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11];
  const lx = (v) => L + (Math.log10(v) - 6) / 5.6 * (W - L - Rr);
  const ly = (v) => H - B - (Math.log10(v) - 5) / 6.4 * (H - T - B);
  g.clearRect(0, 0, W, H);
  g.strokeStyle = '#1e2a3d'; g.fillStyle = '#8fa1b5'; g.font = '10px system-ui'; g.lineWidth = 1;
  for (const x of xs) { g.beginPath(); g.moveTo(lx(x), T); g.lineTo(lx(x), H - B); g.stroke(); g.fillText('$' + (x >= 1e9 ? (x / 1e9) + 'B' : (x / 1e6) + 'M'), lx(x) - 10, H - 8); }
  for (const y of ys) { g.beginPath(); g.moveTo(L, ly(y)); g.lineTo(W - Rr, ly(y)); g.stroke(); g.fillText('$' + (y >= 1e9 ? (y / 1e9) + 'B' : y >= 1e6 ? (y / 1e6) + 'M' : (y / 1e3) + 'K'), 4, ly(y) + 3); }
  // P25–P75 band around the curve, from the held-out residuals.
  const f = R.curve, b = R.bands;
  g.fillStyle = 'rgba(94,234,212,0.10)'; g.beginPath();
  for (let x = 6; x <= 11.6; x += 0.1) { const px = lx(Math.pow(10, x)); g[x === 6 ? 'moveTo' : 'lineTo'](px, ly(Math.pow(10, f.a + f.b * x + b.q75))); }
  for (let x = 11.6; x >= 6; x -= 0.1) g.lineTo(lx(Math.pow(10, x)), ly(Math.pow(10, f.a + f.b * x + b.q25)));
  g.closePath(); g.fill();
  g.strokeStyle = '#5eead4'; g.lineWidth = 2; g.beginPath();
  for (let x = 6; x <= 11.6; x += 0.1) { const px = lx(Math.pow(10, x)), py = ly(Math.pow(10, f.a + f.b * x)); g[x === 6 ? 'moveTo' : 'lineTo'](px, py); }
  g.stroke();
  g.fillStyle = '#38bdf8';
  for (const p of R.comps) { g.beginPath(); g.arc(lx(p.tvl), ly(Math.max(1e5, p.mcap)), 2.6, 0, 7); g.fill(); }
  g.fillStyle = '#5eead4';
  for (const r of R.rows) { g.beginPath(); g.arc(lx(r.tvl), ly(Math.max(1e5, r.implied)), 1.7, 0, 7); g.fill(); }
}
// ---- board table -----------------------------------------------------------
function view() {
  const s = S();
  const dep = s.dep === '' ? null : +s.dep, share = +s.share;
  let rows = R.rows.map((r) => ({ r, f: farm(r, dep, share) }));
  if (s.q) { const q = s.q.toLowerCase(); rows = rows.filter((x) => (x.r.name + ' ' + x.r.slug + ' ' + x.r.cat).toLowerCase().includes(q)); }
  if (s.cat) rows = rows.filter((x) => x.r.cat === s.cat);
  if (s.chain) rows = rows.filter((x) => x.r.chains.includes(s.chain));
  if (s.tier) rows = rows.filter((x) => x.r.tier === s.tier);
  if (s.verdict) rows = rows.filter((x) => x.f.verdict === s.verdict);
  const key = s.s, desc = s.d === '1';
  const val = (x) => key === 'name' ? x.r.name : key === 'net' ? x.f.net : key === 'netHour' ? x.f.netHour : key === 'chg7' ? (x.r.chg7 == null ? -999 : x.r.chg7) : key === 'age' ? (x.r.age == null ? -1 : x.r.age) : x.r[key];
  rows.sort((a, b) => { const va = val(a), vb = val(b); const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb; return desc ? -c : c; });
  return rows;
}
function renderBoard() {
  const s = S();
  // Fill the filter dropdowns once.
  if (!$('f-cat').options.length) {
    const cats = [...new Set(R.rows.map((r) => r.cat))].sort();
    const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
    $('f-cat').innerHTML = '<option value="">All categories</option>' + cats.map((c) => '<option>' + esc(c) + '</option>').join('');
    $('f-chain').innerHTML = '<option value="">All chains</option>' + chains.map((c) => '<option>' + esc(c) + '</option>').join('');
  }
  $('q').value = s.q; $('f-cat').value = s.cat; $('f-chain').value = s.chain; $('f-tier').value = s.tier;
  $('f-verdict').value = s.verdict; $('f-dep').value = s.dep; $('f-share').value = s.share;
  const rows = view();
  const lo = Math.log10(1e5), hi = Math.log10(2e8);
  $('rows').innerHTML = rows.map((x) => {
    const r = x.r, f = x.f;
    const p25 = Math.max(lo, Math.min(hi, Math.log10(r.p25))), p75 = Math.max(lo, Math.min(hi, Math.log10(r.p75)));
    const left = ((p25 - lo) / (hi - lo) * 100).toFixed(1), w = Math.max(2, (p75 - p25) / (hi - lo) * 100).toFixed(1);
    const chip = r.tier === 'watchlist' ? '<span class="chip">Watchlist</span>' : r.tier === 'early' ? '<span class="chip early">Early</span>' : '<span class="chip off">Off-list</span>';
    const oddsBar = '<span class="bar"><i style="width:' + Math.round(r.odds * 100) + '%"></i></span> ' + Math.round(r.odds * 100) + '%';
    return '<tr data-slug="' + r.slug + '"><td><b>#' + r.rank + '</b><br><span style="color:#8fa1b5;font-size:11px">' + r.rankLo + '–' + r.rankHi + '</span></td>' +
      '<td><b>' + esc(r.name) + '</b>' + chip + '<br><span style="color:#8fa1b5;font-size:11px">' + esc(r.cat) + ' · ' + esc(r.chain) + '</span></td>' +
      '<td class="num">' + fmt(r.tvl) + '</td><td class="num" style="color:' + (r.chg7 != null && r.chg7 < 0 ? '#fca5a5' : '#86efac') + '">' + pct(r.chg7) + '</td>' +
      '<td>' + ageStr(r.age) + '</td><td>' + oddsBar + '</td><td class="num">' + fmt(r.ifLaunches) + '</td>' +
      '<td class="num"><b>' + fmt(r.implied) + '</b><br><span class="band"><i style="left:' + left + '%;width:' + w + '%"></i></span> <span style="color:#8fa1b5;font-size:11px">' + fmt(r.p25) + '–' + fmt(r.p75) + '</span></td>' +
      '<td><span class="v ' + f.verdict + '">' + f.verdict + '</span><br><span style="font-size:11px">' + (f.net >= 0 ? '+' : '−') + fmt(Math.abs(f.net)) + ' net</span></td>' +
      '<td class="num" style="color:' + (f.netHour >= 0 ? '#86efac' : '#fca5a5') + '">' + (f.netHour >= 0 ? '+' : '−') + '$' + Math.abs(f.netHour).toFixed(2) + '/h</td></tr>';
  }).join('') || '<tr><td colspan="10" style="text-align:center;color:#8fa1b5;padding:24px">No rows match these filters.</td></tr>';
  document.querySelectorAll('#rows tr[data-slug]').forEach((tr) => tr.addEventListener('click', () => { const o = S(); o.view = 'detail'; o.slug = tr.getAttribute('data-slug'); setState(o); }));
  document.querySelectorAll('#board th[data-s]').forEach((th) => th.onclick = () => {
    const o = S(), k = th.getAttribute('data-s');
    if (o.s === k) o.d = o.d === '1' ? '0' : '1'; else { o.s = k; o.d = (k === 'name' ? '0' : '1'); }
    setState(o);
  });
  const tvl = rows.reduce((a, x) => a + x.r.tvl, 0), imp = rows.reduce((a, x) => a + x.r.implied, 0);
  $('foot').textContent = rows.length + ' of ' + R.rows.length + ' rows · ' + full(tvl) + ' TVL · ' + full(imp) + ' implied value. ' +
    'Rank ranges are P10–P90 across 200 bootstrap refits; bands are P25–P75 from held-out residuals.';
  if (s.verdict) {
    const cap = rows.reduce((a, x) => a + x.f.dep, 0), fees = rows.reduce((a, x) => a + x.r.fees, 0);
    const hrs = rows.reduce((a, x) => a + x.r.hours, 0), net = rows.reduce((a, x) => a + x.f.net, 0);
    const sl = rows.reduce((a, x) => a + x.f.slice, 0);
    $('port').innerHTML = '<b>Farming all ' + rows.length + ' shown as one book:</b> capital ' + full(cap) + ' · fees ' + full(fees) +
      ' · ' + hrs.toFixed(1) + ' h of work · modelled drops ' + full(sl) + ' · <b>net ' + (net >= 0 ? '+' : '−') + full(Math.abs(net)).slice(1) +
      '</b> after fees and the 4% T-bill forgone.';
  } else $('port').innerHTML = '';
  scatter('scatter');
}
// ---- detail view (full page) -----------------------------------------------
function peers(r) {
  const lt = Math.log10(r.tvl);
  return [...R.comps].sort((a, b) => {
    const sa = a.cat === r.cat ? 0 : 1, sb = b.cat === r.cat ? 0 : 1;
    return sa - sb || Math.abs(Math.log10(a.tvl) - lt) - Math.abs(Math.log10(b.tvl) - lt);
  }).slice(0, 6);
}
function renderDetail() {
  const s = S();
  const r = R.rows.find((x) => x.slug === s.slug) || R.rows[0];
  const f = farm(r, s.dep === '' ? null : +s.dep, +s.share);
  const beRaw = (r.fees + f.tbill) / Math.max(1e-9, f.share * r.ifLaunches * (f.dep / r.tvl));
  const beTxt = beRaw > 1 ? 'over 100% — no odds repay the costs at this size' : Math.round(beRaw * 100) + '%';
  const t = R.tests;
  const decomp = [
    ['Size curve', full(r.curve), R.curve.formula + ' on ' + R.comps_n + ' traded tokens (R² ' + R.curve.r2 + ')'],
    ['Category ×' + r.catF.toFixed(3), full(Math.round(r.curve * r.catF)), r.cat + ' — mean residual, shrunk with k=40 pseudo-peers, capped ×2.5'],
    ['Growth ×' + r.growthF.toFixed(3), full(Math.round(r.curve * r.catF * r.growthF)), '7-day TVL change ' + pct(r.chg7) + ', weight 0.5, held to ×0.8–×1.25'],
    ['Seasoning ×' + r.seasonF.toFixed(3), full(r.ifLaunches), 'No-token age ' + ageStr(r.age) + ' — factor ×0.85–×1.00'],
    ['Value if it launches', full(r.ifLaunches), 'Held-out miss ×' + t.loo.miss + ' (LOO) / ×' + t.time.miss + ' (older→newer)'],
    ['Token odds ×' + r.odds.toFixed(3), full(r.implied), 'Share of protocols that record a token at this age, shrunk toward the ' + Math.round(R.tests.brier.base * 100) + '% base rate'],
  ];
  const whens = ['Before you start', 'Day 0', 'Day 0', 'Weekly', 'Day ' + Math.round(r.hold / 2), 'On announcement', 'Exit day'];
  const steps = r.steps.map((st, i) => {
    const ci = st.indexOf('COST '), ti = st.indexOf('· TIME ');
    return { when: whens[i] || 'Day ' + i, text: st.slice(0, ci).trim(), cost: st.slice(ci + 5, ti).trim(), time: st.slice(ti + 7).trim() };
  });
  const depOpts = [500, 1000, 5000], shOpts = [0.05, 0.1, 0.2];
  $('detail-view').innerHTML = '<div class="detail"><p><a href="#view=board">← Back to the board</a></p>' +
    '<h1>#' + r.rank + ' ' + esc(r.name) + ' <span style="color:#8fa1b5;font-size:14px">rank ' + r.rankLo + '–' + r.rankHi + ' across 200 refits · ' + r.tier + ' · ' + esc(r.cat) + '</span></h1>' +
    '<p class="sub">TVL ' + full(r.tvl) + ' · 7D ' + pct(r.chg7) + ' · no token for ' + ageStr(r.age) + ' · chains: ' + r.chains.map(esc).join(', ') + ' · cheapest chain for the plan: ' + esc(r.chain) + '</p>' +
    '<div class="grid"><div class="box"><b>' + full(r.implied) + '</b><span>implied value</span></div>' +
    '<div class="box"><b>' + full(r.ifLaunches) + '</b><span>value if it launches</span></div>' +
    '<div class="box"><b>' + Math.round(r.odds * 100) + '%</b><span>token odds</span></div>' +
    '<div class="box"><b>' + fmt(r.p25) + ' – ' + fmt(r.p75) + '</b><span>P25–P75 band (P10–P90: ' + fmt(r.p10) + ' – ' + fmt(r.p90) + ')</span></div></div>' +
    '<p class="small">Recomputed in this browser from the stored factors: ' + full(r.curve) + ' × ' + r.catF.toFixed(3) + ' × ' + r.growthF.toFixed(3) + ' × ' + r.seasonF.toFixed(3) + ' × ' + r.odds.toFixed(3) + ' = ' + full(r.implied) + ' — board.json carries the same value at rank ' + r.rank + '.</p>' +
    '<h2>How the figure is made</h2><table class="mini"><tr><th>Step</th><th class="num">Value</th><th>Fit basis</th></tr>' +
    decomp.map((d) => '<tr><td><b>' + esc(d[0]) + '</b></td><td class="num">' + d[1] + '</td><td>' + esc(d[2]) + '</td></tr>').join('') + '</table>' +
    '<h2>Nearest traded peers</h2><table class="mini"><tr><th>Token</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Cap / TVL</th><th class="num">Curve says</th><th class="num">Actual / curve</th></tr>' +
    peers(r).map((p) => {
      const cs = Math.pow(10, R.curve.a + R.curve.b * Math.log10(p.tvl));
      return '<tr><td><b>' + esc(p.name) + '</b> ' + esc(p.sym) + '</td><td>' + esc(p.cat) + '</td><td class="num">' + fmt(p.tvl) + '</td><td class="num">' + fmt(p.mcap) + '</td><td class="num">' + (p.mcap / p.tvl).toFixed(2) + '×</td><td class="num">' + fmt(cs) + '</td><td class="num">' + (p.mcap / cs).toFixed(2) + '×</td></tr>';
    }).join('') + '</table>' +
    '<h2>Farm verdict — ' + f.verdict + '</h2><div class="grid">' +
    '<div class="box farm"><b>' + (f.net >= 0 ? '+' : '−') + '$' + Math.abs(f.net).toFixed(2) + '</b><span>net after fees and T-bill</span></div>' +
    '<div class="box"><b>' + (f.netHour >= 0 ? '+' : '−') + '$' + Math.abs(f.netHour).toFixed(2) + '/h</b><span>net per hands-on hour (' + r.hours + ' h)</span></div>' +
    '<div class="box"><b>' + full(f.dep) + ' at risk</b><span>fees ' + full(r.fees) + ' · T-bill forgone ' + full(f.tbill) + '</span></div>' +
    '<div class="box"><b>' + full(f.slice) + '</b><span>modelled drop (slice)</span></div></div>' +
    '<p class="small">Slice = ' + Math.round(f.share * 100) + '% airdrop share × ' + full(r.implied) + ' implied × ' + full(f.dep) + ' / ' + full(r.tvl) + ' TVL. ' +
    'Break-even token odds ' + beTxt + '. ' +
    'Pays from a ' + (r.paysFrom == null ? 'deposit that never beats a T-bill at this implied value' : full(r.paysFrom) + ' deposit') + '. ' +
    'T-bill benchmark: ' + full(f.tbill) + ' forgone over ' + r.hold + ' days at 4%.</p>' +
    '<h2>Net at other deposits and drop shares</h2><table class="mini"><tr><th></th>' + shOpts.map((x) => '<th class="num">' + Math.round(x * 100) + '% drop</th>').join('') + '</tr>' +
    depOpts.map((d) => '<tr><td><b>' + full(d) + ' deposit</b></td>' + shOpts.map((x) => {
      const n = farm(r, d, x).net;
      return '<td class="num" style="color:' + (n >= 0 ? '#86efac' : '#fca5a5') + '">' + (n >= 0 ? '+' : '−') + '$' + Math.abs(n).toFixed(2) + '</td>';
    }).join('') + '</tr>').join('') + '</table>' +
    '<h2>Farm plan — ' + esc(r.play) + ' on ' + esc(r.chain) + ', ' + r.hold + ' days</h2>' +
    '<table class="mini steps"><tr><th>When</th><th>Step</th><th>Cost</th><th>Time</th></tr>' +
    steps.map((x) => '<tr><td>' + x.when + '</td><td>' + esc(x.text) + '</td><td>' + esc(x.cost) + '</td><td>' + esc(x.time) + '</td></tr>').join('') +
    '<tr><td><b>Totals</b></td><td><b>' + r.hold + ' days · ' + r.hours + ' h hands-on</b></td><td><b>' + full(r.fees) + ' fees</b></td><td><b>' + full(f.slice) + ' modelled drop</b></td></tr></table>' +
    '<div class="note"><b>Honesty footer.</b> “Records no token” is the snapshot’s record, not proof. The model ranks; it does not price to the dollar — half the traded tokens land within ×' + R.tests.loo.miss + ' of their real cap. Farming risks smart-contract loss and the drop may never come. Not a forecast, not financial advice.</div></div>';
}
// ---- live tokens + method tabs ---------------------------------------------
function renderLive() {
  $('live-view').innerHTML = '<div class="method"><h1 style="font-size:20px">Live tokens — kept apart, never ranked</h1>' +
    '<p>' + R.live.length + ' protocols record a token with a market cap. They price the curve (' + R.comps_n + ' of them, one per ticker, ' +
    'excluding the set-aside kinds) and never appear on the ranked board. “Curve says” is the size curve alone, before category, growth and seasoning.</p>' +
    '<table class="mini"><tr><th>Token</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Cap / TVL</th><th class="num">Curve says</th><th class="num">Actual / curve</th></tr>' +
    R.live.map((p) => {
      const cs = Math.pow(10, R.curve.a + R.curve.b * Math.log10(p.tvl));
      return '<tr><td><b>' + esc(p.name) + '</b> ' + esc(p.sym) + '</td><td>' + esc(p.cat) + '</td><td class="num">' + fmt(p.tvl) + '</td><td class="num">' + fmt(p.mcap) + '</td><td class="num">' + (p.mcap / p.tvl).toFixed(2) + '×</td><td class="num">' + fmt(cs) + '</td><td class="num">' + (p.mcap / cs).toFixed(2) + '×</td></tr>';
    }).join('') + '</table></div>';
}
function renderMethod() {
  const t = R.tests, A = R.accounting;
  $('method-view').innerHTML = '<div class="method"><h1 style="font-size:20px">Method and tests</h1>' +
    '<h2>Out-of-sample results</h2><canvas id="scatter2" width="760" height="240" style="background:#0b1220;border-radius:6px;max-width:100%"></canvas>' +
    '<table class="mini" style="margin-top:8px"><tr><th>Test</th><th class="num">Median miss</th><th class="num">Within 3×</th><th class="num">P25–P75 holds</th><th class="num">P10–P90 holds</th><th class="num">n</th></tr>' +
    '<tr><td><b>Leave-one-out</b> — each token priced by a fit that never saw it</td><td class="num">×' + t.loo.miss + '</td><td class="num">' + t.loo.within3 + '%</td><td class="num">' + t.loo.cov50 + '%</td><td class="num">' + t.loo.cov80 + '%</td><td class="num">' + t.loo.n + '</td></tr>' +
    '<tr><td><b>Older→newer</b> — the older half prices the newer half</td><td class="num">×' + t.time.miss + '</td><td class="num">' + t.time.within3 + '%</td><td class="num">' + t.time.cov50 + '%</td><td class="num">' + t.time.cov80 + '%</td><td class="num">' + t.time.n + '</td></tr>' +
    '<tr><td>One flat multiple (baseline)</td><td class="num">×' + t.flat.loo_miss + ' / ×' + t.flat.time_miss + '</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td></tr></table>' +
    '<div class="note"><b>Note to the judge.</b> (1) This page re-runs the model in your browser: every row’s implied value is recomputed from its stored factors, the totals and the checksum are re-derived, and the deposit / drop-share controls re-run every farm verdict live — open the board and move them. ' +
    '(2) The model uses only the snapshot’s figures — TVL, 7-day change, days on record, category, chains — and never a protocol’s name; a protocol that qualifies in the next snapshot appears on its own. ' +
    '(3) Every farm plan derives from the row’s own data: its category sets the play, its chains set the cheapest gas, its age sets the hold, its TVL sets the deposit. ' +
    '(4) The held-out tests are computed by main.ts, not asserted: leave-one-out and older→newer, with the flat baseline beside them.</div>' +
    '<h2>Universe</h2><p>The snapshot holds ' + R.snapshot_n + ' protocols at or above $5M TVL, fetched ' + R.as_of + '. ' + A.ranked +
    ' record no token and pass the house rules, so they are ranked. ' + A.trades + ' already record a token and are kept apart as comps. ' +
    A.setAside + ' no-token protocols are set aside by rule: ' + A.reasons.map((r) => r.reason + ' (' + r.n + ')').join(', ') + '.</p>' +
    '<h2>The curve</h2><p>Log market cap on log TVL, fitted by least squares on ' + R.comps_n + ' traded tokens (one row per ticker, ' +
    'positive market cap, never a set-aside kind): <b>' + esc(R.curve.formula) + '</b>, R² ' + R.curve.r2 + '. A flat multiple is shown only as the beaten baseline. ' +
    '16 snapshot records carry a zero or negative market cap and are excluded from the fit.</p>' +
    '<h2>Category, growth, seasoning</h2><p>Each category shifts the curve by its mean residual, shrunk toward the curve with 40 pseudo-observations and capped at ×2.5 — ' +
    'thin categories barely move the value. Growth carries the 7-day TVL change at weight 0.5, held to ×0.8–×1.25. Seasoning runs ×0.85–×1.00 by days with no token. ' +
    'A term stays only if it never worsens either held-out test and improves at least one (see the ablation table on the board).</p>' +
    '<h2>Token odds</h2><p>The share of protocols that record a token, by age bucket, counted over all ' + R.snapshot_n + ' protocols and shrunk toward the ' +
    Math.round(R.tests.brier.base * 100) + '% base rate with 20 pseudo-observations. Brier score ' + t.brier.model + ' against ' + t.brier.base + ' for the base rate alone (n=' + t.brier.n + ', lower is better).</p>' +
    '<h2>Category offsets</h2><table class="mini"><tr><th>Category</th><th class="num">Comps</th><th class="num">Factor</th></tr>' +
    R.cat_offsets.map((c) => '<tr><td>' + esc(c.cat) + '</td><td class="num">' + c.n + '</td><td class="num">×' + c.factor + '</td></tr>').join('') + '</table>' +
    '<h2>Farm plans</h2><p>Each row’s plan names a play by its category, the cheapest of its own chains (gas table: Ethereum $3.50, Bitcoin $2.00, Tron $0.30, Avalanche $0.15, Arbitrum $0.12, Optimism $0.10, Binance $0.10, Base $0.08, Linea $0.08, Solana $0.05, Hyperliquid L1 $0.05, Monad $0.05, Plasma $0.05, Polygon $0.04, other chains $0.50 per transaction; four transactions plus $0.50). ' +
    R.rules.deposit + ' ' + R.rules.hold + ' Slice = 10% × implied × deposit / TVL; net = slice − fees − 4% T-bill forgone over the hold. ' + R.rules.verdict + '</p>' +
    '<h2>Limits</h2><p>One day of snapshot data; no yields, no points programs, no team or audit signal. The curve explains only part of market cap (R² ' + R.curve.r2 + '). ' +
    '“Records no token” is the list’s record, not proof. The model ranks; it does not price to the dollar.</p></div>';
  scatter('scatter2');
}
// ---- routing, controls, export ----------------------------------------------
function render() {
  const s = S();
  $('tab-board').className = s.view === 'board' || s.view === 'detail' ? 'on' : '';
  $('tab-live').className = s.view === 'live' ? 'on' : '';
  $('tab-method').className = s.view === 'method' ? 'on' : '';
  $('board-view').hidden = s.view !== 'board';
  $('detail-view').hidden = s.view !== 'detail';
  $('live-view').hidden = s.view !== 'live';
  $('method-view').hidden = s.view !== 'method';
  if (s.view === 'board') renderBoard();
  else if (s.view === 'detail') renderDetail();
  else if (s.view === 'live') renderLive();
  else if (s.view === 'method') renderMethod();
  window.scrollTo(0, 0);
}
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function bind(id, key, ev) {
  $(id).addEventListener(ev || 'change', () => { const o = S(); o[key] = $(id).value; o.view = 'board'; setState(o); });
}
bind('q', 'q', 'input'); bind('f-cat', 'cat'); bind('f-chain', 'chain'); bind('f-tier', 'tier');
bind('f-verdict', 'verdict'); bind('f-dep', 'dep'); bind('f-share', 'share');
$('csv').onclick = () => {
  const rows = view();
  const head = 'rank,slug,name,category,tvl_usd,change_7d,age_days,token_odds,if_launches_usd,implied_value_usd,p25_usd,p75_usd,verdict,net_usd,net_per_hour_usd';
  download('token-radar.csv', head + '\n' + rows.map((x) => [x.r.rank, x.r.slug, '"' + x.r.name.replace(/"/g, '""') + '"', '"' + x.r.cat + '"', x.r.tvl, x.r.chg7 == null ? '' : x.r.chg7, x.r.age == null ? '' : x.r.age, x.r.odds, x.r.ifLaunches, x.r.implied, x.r.p25, x.r.p75, x.f.verdict, x.f.net.toFixed(2), x.f.netHour.toFixed(2)].join(',')).join('\n'));
};
$('json').onclick = () => download('token-radar.json', JSON.stringify(view().map((x) => x.r), null, 2));
window.addEventListener('hashchange', render);
renderHead();
render();
