// Admin dashboard. All data comes from /api/admin, which holds the service
// role key server-side — the browser never sees it.

const gate = document.getElementById('gate');
const gateForm = document.getElementById('gateForm');
const gateError = document.getElementById('gateError');
const gateSubmit = document.getElementById('gateSubmit');
const adminEl = document.getElementById('admin');

let ANSWER = '';
let REGISTRATIONS = [];
let SESSIONS = [];

const INR = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/* ------------------------------- auth ---------------------------------- */

gateForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const answer = document.getElementById('gateAnswer').value.trim();
  gateError.textContent = '';
  gateSubmit.disabled = true;
  gateSubmit.textContent = 'Checking…';

  try {
    await load(answer);
    ANSWER = answer;
    sessionStorage.setItem('uc_admin', answer);
    gate.hidden = true;
    adminEl.hidden = false;
    render();
  } catch (err) {
    if (String(err?.message) !== 'unauthorized') console.error('[admin]', err);
    gateError.textContent = friendlyError(err);
  } finally {
    gateSubmit.disabled = false;
    gateSubmit.textContent = 'Unlock';
  }
});

function friendlyError(err) {
  const msg = String(err?.message || err);
  if (msg === 'unauthorized') return 'Not quite. Try again.';
  if (msg.includes('PGRST205') || msg.includes('schema cache')) {
    return 'Database tables not set up yet — run supabase/schema.sql in the Supabase SQL editor.';
  }
  if (msg.includes('credentials')) return 'Server is missing its Supabase keys.';
  return 'Could not load data. Check the console for details.';
}

async function load(answer) {
  const res = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer }),
  });

  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  const data = await res.json();
  REGISTRATIONS = data.registrations || [];
  SESSIONS = data.sessions || [];
}

// Resume an unlocked session on reload
const saved = sessionStorage.getItem('uc_admin');
if (saved) {
  load(saved)
    .then(() => {
      ANSWER = saved;
      gate.hidden = true;
      adminEl.hidden = false;
      render();
    })
    .catch(() => sessionStorage.removeItem('uc_admin'));
}

/* ------------------------------ controls -------------------------------- */

const volFilter = document.getElementById('volFilter');
const searchInput = document.getElementById('searchInput');

volFilter.addEventListener('change', render);
searchInput.addEventListener('input', renderRegTable);

document.getElementById('refreshBtn').addEventListener('click', async () => {
  await load(ANSWER);
  render();
});

document.getElementById('exportCsv').addEventListener('click', exportCsv);

function currentVolume() {
  return volFilter.value === 'all' ? 'all' : Number(volFilter.value);
}

function filtered() {
  const vol = currentVolume();
  return vol === 'all' ? REGISTRATIONS : REGISTRATIONS.filter((r) => r.volume_number === vol);
}

/* ------------------------------- render --------------------------------- */

function render() {
  // Populate the volume dropdown once, preserving the current pick.
  const volumes = [...new Set([
    ...SESSIONS.map((s) => s.volume_number),
    ...REGISTRATIONS.map((r) => r.volume_number),
  ])].filter((v) => v != null).sort((a, b) => b - a);

  const prev = volFilter.value;
  volFilter.innerHTML = '<option value="all">All volumes</option>' +
    volumes.map((v) => `<option value="${v}">Volume ${v}</option>`).join('');
  if (prev && [...volFilter.options].some((o) => o.value === prev)) volFilter.value = prev;

  renderKpis();
  renderVolumeChart();
  renderRevenueChart();
  renderSplitChart();
  renderAgeChart();
  renderPaymentChart();
  renderVolumeTable();
  renderRegTable();
}

function statsFor(rows) {
  const performers = rows.filter((r) => r.tier === 'performer').length;
  const listeners = rows.filter((r) => r.tier === 'listener').length;
  const expected = rows.reduce((sum, r) => sum + (r.amount || 0), 0);
  const collected = rows
    .filter((r) => r.payment_status === 'paid')
    .reduce((sum, r) => sum + (r.amount || 0), 0);
  const ages = rows.map((r) => r.age).filter((a) => typeof a === 'number');
  return {
    total: rows.length,
    performers,
    listeners,
    expected,
    collected,
    paid: rows.filter((r) => r.payment_status === 'paid').length,
    pending: rows.filter((r) => r.payment_status === 'pending').length,
    avgAge: ages.length ? (ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1) : '—',
  };
}

function renderKpis() {
  const rows = filtered();
  const s = statsFor(rows);
  const vol = currentVolume();

  // Compare against the previous volume when one is selected.
  let deltaHtml = '';
  if (vol !== 'all') {
    const prevRows = REGISTRATIONS.filter((r) => r.volume_number === vol - 1);
    if (prevRows.length) {
      const diff = s.total - prevRows.length;
      const pct = Math.round((diff / prevRows.length) * 100);
      const cls = diff >= 0 ? 'kpi-up' : 'kpi-down';
      const arrow = diff >= 0 ? '▲' : '▼';
      deltaHtml = `<span class="${cls}">${arrow} ${Math.abs(pct)}%</span> vs Vol ${vol - 1}`;
    } else {
      deltaHtml = 'No previous volume';
    }
  } else {
    deltaHtml = `${SESSIONS.length} session${SESSIONS.length === 1 ? '' : 's'} total`;
  }

  const session = vol === 'all' ? null : SESSIONS.find((x) => x.volume_number === vol);
  const capacity = session?.capacity;
  const fill = capacity ? Math.round((s.total / capacity) * 100) : null;

  const tiles = [
    { label: 'Registrations', value: s.total, sub: deltaHtml },
    { label: 'Performers', value: s.performers, sub: `${s.total ? Math.round((s.performers / s.total) * 100) : 0}% of the room` },
    { label: 'Listeners', value: s.listeners, sub: `${s.total ? Math.round((s.listeners / s.total) * 100) : 0}% of the room` },
    { label: 'Revenue expected', value: INR(s.expected), sub: `${INR(s.collected)} collected` },
    { label: 'Paid', value: `${s.paid}/${s.total}`, sub: `${s.pending} pending` },
    { label: 'Average age', value: s.avgAge, sub: capacity ? `${fill}% of ${capacity} seats` : 'Capacity not set' },
  ];

  document.getElementById('kpiRow').innerHTML = tiles.map((t) => `
    <div class="kpi">
      <p class="kpi-label">${t.label}</p>
      <p class="kpi-value">${t.value}</p>
      <p class="kpi-sub">${t.sub}</p>
    </div>`).join('');
}

function barRow(label, value, max, valueText, cls = '') {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return `
    <div class="bar-row">
      <span class="bar-label">${label}</span>
      <div class="bar-track"><div class="bar-fill ${cls}" style="width:${pct}%"></div></div>
      <span class="bar-value">${valueText ?? value}</span>
    </div>`;
}

function renderVolumeChart() {
  const byVol = groupByVolume();
  const el = document.getElementById('chartVolumes');
  if (!byVol.length) return void (el.innerHTML = emptyNote());

  const max = Math.max(...byVol.map((v) => v.total), 1);
  el.innerHTML = byVol.map((v) => {
    const pPct = (v.performers / max) * 100;
    const lPct = (v.listeners / max) * 100;
    return `
      <div class="bar-row">
        <span class="bar-label">Volume ${v.volume}</span>
        <div class="bar-track">
          <div class="bar-stack">
            <div class="bar-fill alt" style="width:${pPct}%"></div>
            <div class="bar-fill" style="width:${lPct}%"></div>
          </div>
        </div>
        <span class="bar-value">${v.total}</span>
      </div>`;
  }).join('') + `
    <div class="legend">
      <span><i style="background:var(--accent)"></i> Performers</span>
      <span><i style="background:var(--ink)"></i> Listeners</span>
    </div>`;
}

function renderRevenueChart() {
  const byVol = groupByVolume();
  const el = document.getElementById('chartRevenue');
  if (!byVol.length) return void (el.innerHTML = emptyNote());

  const max = Math.max(...byVol.map((v) => v.expected), 1);
  el.innerHTML = byVol.map((v) => `
    <div class="bar-row">
      <span class="bar-label">Vol ${v.volume}</span>
      <div class="bar-track">
        <div class="bar-fill tint" style="width:${(v.expected / max) * 100}%"></div>
        <div class="bar-fill alt" style="width:${(v.collected / max) * 100}%;margin-top:-26px"></div>
      </div>
      <span class="bar-value">${INR(v.expected)}</span>
    </div>`).join('') + `
    <div class="legend">
      <span><i style="background:#8aa596"></i> Expected</span>
      <span><i style="background:var(--accent)"></i> Collected</span>
    </div>`;
}

function renderSplitChart() {
  const s = statsFor(filtered());
  const el = document.getElementById('chartSplit');
  if (!s.total) return void (el.innerHTML = emptyNote());

  const pPct = (s.performers / s.total) * 100;
  el.innerHTML = `
    <div class="donut-wrap">
      <div class="donut" style="background:conic-gradient(var(--accent) 0 ${pPct}%, var(--ink) ${pPct}% 100%)">
        <div class="donut-center" style="background:radial-gradient(circle, var(--ground) 54%, transparent 55%)">
          <span style="font-family:var(--font-serif);font-size:26px;font-weight:600">${s.total}</span>
        </div>
      </div>
      <div class="legend" style="flex-direction:column;gap:10px">
        <span><i style="background:var(--accent)"></i> Performers — ${s.performers} (${Math.round(pPct)}%)</span>
        <span><i style="background:var(--ink)"></i> Listeners — ${s.listeners} (${Math.round(100 - pPct)}%)</span>
      </div>
    </div>`;
}

function renderAgeChart() {
  const rows = filtered();
  const el = document.getElementById('chartAge');
  if (!rows.length) return void (el.innerHTML = emptyNote());

  const buckets = [
    ['Under 18', (a) => a < 18],
    ['18–21', (a) => a >= 18 && a <= 21],
    ['22–25', (a) => a >= 22 && a <= 25],
    ['26–30', (a) => a >= 26 && a <= 30],
    ['31–40', (a) => a >= 31 && a <= 40],
    ['41+', (a) => a > 40],
  ].map(([label, test]) => ({ label, count: rows.filter((r) => test(r.age)).length }));

  const max = Math.max(...buckets.map((b) => b.count), 1);
  el.innerHTML = buckets.map((b) => barRow(b.label, b.count, max, b.count)).join('');
}

function renderPaymentChart() {
  const rows = filtered();
  const el = document.getElementById('chartPayment');
  if (!rows.length) return void (el.innerHTML = emptyNote());

  const statuses = ['paid', 'pending', 'refunded', 'cancelled'].map((st) => ({
    label: st[0].toUpperCase() + st.slice(1),
    count: rows.filter((r) => r.payment_status === st).length,
  }));

  const max = Math.max(...statuses.map((s) => s.count), 1);
  el.innerHTML = statuses
    .map((s) => barRow(s.label, s.count, max, `${s.count} · ${INR(
      rows.filter((r) => r.payment_status === s.label.toLowerCase())
        .reduce((sum, r) => sum + (r.amount || 0), 0)
    )}`))
    .join('');
}

function groupByVolume() {
  const volumes = [...new Set(REGISTRATIONS.map((r) => r.volume_number))]
    .filter((v) => v != null)
    .sort((a, b) => a - b);

  return volumes.map((volume) => {
    const rows = REGISTRATIONS.filter((r) => r.volume_number === volume);
    const s = statsFor(rows);
    return { volume, ...s };
  });
}

function renderVolumeTable() {
  const byVol = [...groupByVolume()].reverse();
  const table = document.getElementById('volumeTable');

  if (!byVol.length) {
    table.innerHTML = `<tbody><tr><td class="empty-note">No registrations yet.</td></tr></tbody>`;
    return;
  }

  table.innerHTML = `
    <thead>
      <tr>
        <th>Volume</th><th>Date</th><th>Venue</th>
        <th class="num">Total</th><th class="num">Perf.</th><th class="num">List.</th>
        <th class="num">Avg age</th><th class="num">Expected</th><th class="num">Collected</th>
        <th class="num">Fill</th><th class="num">Growth</th>
      </tr>
    </thead>
    <tbody>
      ${byVol.map((v) => {
        const session = SESSIONS.find((s) => s.volume_number === v.volume);
        const prev = byVol.find((x) => x.volume === v.volume - 1);
        let growth = '—';
        if (prev && prev.total) {
          const pct = Math.round(((v.total - prev.total) / prev.total) * 100);
          growth = `<span class="${pct >= 0 ? 'kpi-up' : 'kpi-down'}">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}%</span>`;
        }
        const fill = session?.capacity
          ? `${Math.round((v.total / session.capacity) * 100)}%`
          : '—';
        return `
          <tr>
            <td><strong>Volume ${v.volume}</strong></td>
            <td>${session?.event_date ? esc(session.event_date) : '—'}</td>
            <td>${esc(session?.venue || '—')}</td>
            <td class="num">${v.total}</td>
            <td class="num">${v.performers}</td>
            <td class="num">${v.listeners}</td>
            <td class="num">${v.avgAge}</td>
            <td class="num">${INR(v.expected)}</td>
            <td class="num">${INR(v.collected)}</td>
            <td class="num">${fill}</td>
            <td class="num">${growth}</td>
          </tr>`;
      }).join('')}
    </tbody>`;
}

function renderRegTable() {
  const q = (searchInput.value || '').trim().toLowerCase();
  let rows = filtered();

  if (q) {
    rows = rows.filter((r) =>
      [r.full_name, r.phone, r.instagram, r.tier, r.payment_status]
        .some((f) => String(f ?? '').toLowerCase().includes(q))
    );
  }

  document.getElementById('tableCount').textContent =
    `${rows.length} record${rows.length === 1 ? '' : 's'}${q ? ' matching your search' : ''}`;

  const table = document.getElementById('regTable');
  if (!rows.length) {
    table.innerHTML = `<tbody><tr><td class="empty-note">Nothing here yet.</td></tr></tbody>`;
    return;
  }

  table.innerHTML = `
    <thead>
      <tr>
        <th>Name</th><th class="num">Age</th><th>Phone</th><th>Instagram</th>
        <th>Tier</th><th class="num">Amount</th><th>Payment</th><th class="num">Vol</th><th>Booked</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map((r) => `
        <tr>
          <td><strong>${esc(r.full_name)}</strong></td>
          <td class="num">${esc(r.age)}</td>
          <td class="num">${esc(r.phone)}</td>
          <td><a href="https://instagram.com/${encodeURIComponent(String(r.instagram || '').replace(/^@/, ''))}" target="_blank" rel="noopener">@${esc(String(r.instagram || '').replace(/^@/, ''))}</a></td>
          <td><span class="pill pill-${esc(r.tier)}">${esc(r.tier)}</span></td>
          <td class="num">${INR(r.amount)}</td>
          <td><span class="pill pill-${esc(r.payment_status)}">${esc(r.payment_status)}</span></td>
          <td class="num">${esc(r.volume_number)}</td>
          <td>${r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
        </tr>`).join('')}
    </tbody>`;
}

function emptyNote() {
  return `<p class="empty-note">No data yet — bookings will show up here.</p>`;
}

function exportCsv() {
  const rows = filtered();
  if (!rows.length) return;

  const cols = ['volume_number', 'full_name', 'age', 'phone', 'instagram', 'tier', 'amount', 'payment_status', 'attended', 'created_at'];
  const csv = [
    cols.join(','),
    ...rows.map((r) => cols.map((c) => {
      const val = String(r[c] ?? '');
      return /[",\n]/.test(val) ? `"${val.replace(/"/g, '""')}"` : val;
    }).join(',')),
  ].join('\n');

  const vol = currentVolume();
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `unplug-registrations-${vol === 'all' ? 'all' : `vol-${vol}`}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}
