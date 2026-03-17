/**
 * app.js — SolarCharge frontend controller
 * Handles routing, UI rendering, and API calls.
 */

/* ─── STATE ─── */
let currentPage     = 'home';
let allStations     = [];
let selectedSlot    = null;
let selectedStation = null;
let activeFilter    = 'all';
let liveInterval    = null;

/* ─── ROUTING ─── */
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name)?.classList.add('active');
  currentPage = name;
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (name === 'stations')  initStations();
  if (name === 'dashboard') initDashboard();
  if (name === 'booking')   initBooking();
}

/* ─── LIVE HERO TICKER ─── */
async function tickerUpdate() {
  const r = await API.live.getMetrics();
  if (!r.ok) return;
  const d = r.data;
  const el = id => document.getElementById(id);
  // pulsing ring
  const pct = 70 + Math.round(Math.random() * 10);
  const arc = el('ring-arc');
  if (arc) { arc.setAttribute('stroke-dashoffset', Math.round(251 * (1 - pct/100))); }
  const pctEl = el('live-pct'); if (pctEl) pctEl.textContent = pct + '%';
  const kw  = el('live-kw');   if (kw) kw.textContent = d.activeChargers > 10 ? '22 kW' : '11 kW';
  const sol = el('live-solar'); if (sol) sol.textContent = '☀ ' + d.solarPct + '%';
  const eta = el('live-eta');   if (eta) eta.textContent = '~' + (8 + Math.round(Math.random() * 10)) + ' min';
}

async function initHome() {
  // Network stats
  const r = await API.network.getStats();
  if (r.ok) {
    const d = r.data;
    setText('h-stations', d.totalStations.toLocaleString());
    setText('h-sessions', d.sessionsToday.toLocaleString());
    setText('h-co2', d.co2SavedTons.toLocaleString());
  }
  tickerUpdate();
  clearInterval(liveInterval);
  liveInterval = setInterval(tickerUpdate, 4000);
}

/* ─── STATIONS PAGE ─── */
async function initStations() {
  const r = await API.stations.getAll();
  if (!r.ok) return;
  allStations = r.data;
  renderStations(allStations);
  renderMapPins(allStations);
}

function renderStations(stations) {
  const list = document.getElementById('stations-list');
  if (!list) return;

  if (!stations.length) {
    list.innerHTML = '<p style="color:var(--text2);font-size:14px;padding:1rem 0">No stations match your filters.</p>';
    return;
  }

  list.innerHTML = stations.map(s => {
    const freeRatio = s.ports > 0 ? s.freePorts / s.ports : 0;
    const barColor  = freeRatio > 0.4 ? '' : 'amber';
    const badge     = s.status === 'available' ? 'badge-green' :
                      s.status === 'busy'      ? 'badge-amber' : 'badge-red';
    const statusLbl = s.status === 'available' ? 'Available' :
                      s.status === 'busy'      ? 'Busy' : 'Offline';

    return `
<div class="station-card" onclick="selectStation(${s.id})">
  <div class="station-card-top">
    <div>
      <div class="station-name">${s.name}</div>
      <div class="station-addr">📍 ${s.address} · ${s.distance} km away</div>
    </div>
    <span class="station-badge ${badge}">${statusLbl}</span>
  </div>
  <div class="station-meta">
    <span>⚡ ${s.power}</span>
    <span>☀ ${s.solarPct}% solar</span>
    <span>₹${s.tariff}/kWh</span>
    <span>${s.connectors.join(' · ')}</span>
  </div>
  <div class="station-ports">
    <div class="port-bar-wrap">
      <span>${s.freePorts}/${s.ports} ports free</span>
      <div class="port-bar"><div class="port-bar-fill ${barColor}" style="width:${freeRatio*100}%"></div></div>
    </div>
  </div>
</div>`;
  }).join('');
}

function renderMapPins(stations) {
  const container = document.getElementById('map-pins');
  if (!container) return;

  // Draw simple road lines
  container.innerHTML = `
    <div class="map-road-h" style="top:48%;height:12px"></div>
    <div class="map-road-h" style="top:68%;height:8px"></div>
    <div class="map-road-v" style="left:35%;width:10px"></div>
    <div class="map-road-v" style="left:65%;width:8px"></div>
  ` + stations.map(s => {
    const color = s.status === 'available' ? '#4ade80' :
                  s.status === 'busy'      ? '#fbbf24' : '#f87171';
    const left = s.lat; const top = s.top;
    return `<div class="map-pin-dot" style="background:${color};left:${left}%;top:${top}%"
              title="${s.name} — ${s.status}" onclick="selectStation(${s.id})"></div>`;
  }).join('');
}

function filterStations(query) {
  const q = query.toLowerCase().trim();
  let filtered = allStations;
  if (q) filtered = filtered.filter(s =>
    s.name.toLowerCase().includes(q) ||
    s.city.toLowerCase().includes(q) ||
    s.address.toLowerCase().includes(q)
  );
  applyChipFilter(filtered);
}

function toggleFilter(el, type) {
  activeFilter = type;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  const q = document.querySelector('.search-input')?.value || '';
  filterStations(q);
}

function applyChipFilter(stations) {
  let filtered = stations;
  if (activeFilter === 'available') filtered = filtered.filter(s => s.status === 'available');
  if (activeFilter === 'dc')        filtered = filtered.filter(s => s.connectors.some(c => c.toLowerCase().includes('dc') || c.toLowerCase().includes('chademo')));
  if (activeFilter === 'solar100')  filtered = filtered.filter(s => s.solarPct === 100);
  renderStations(filtered);
  renderMapPins(filtered);
}

function selectStation(id) {
  const s = allStations.find(x => x.id === id);
  if (!s) return;
  selectedStation = s;

  // Pre-fill booking
  showPage('booking');
  const sel = document.getElementById('book-station');
  if (sel) sel.value = id;
  initBooking();
  updateBookingCost();
}

/* ─── DASHBOARD PAGE ─── */
async function initDashboard() {
  const [statsRes, sessRes] = await Promise.all([
    API.sessions.getStats(),
    API.sessions.getAll(),
  ]);

  if (statsRes.ok) renderDashMetrics(statsRes.data);
  if (sessRes.ok)  renderSessionsTable(sessRes.data);
  renderBarChart(sessRes.ok ? sessRes.data : []);
}

function renderDashMetrics(d) {
  const el = document.getElementById('dash-metrics');
  if (!el) return;
  el.innerHTML = `
    <div class="dash-metric">
      <div class="dash-metric-val">${d.totalKwh} kWh</div>
      <div class="dash-metric-lbl">Total energy charged</div>
      <div class="dash-metric-sub">${d.sessionCount} sessions</div>
    </div>
    <div class="dash-metric">
      <div class="dash-metric-val">₹${d.totalCost.toLocaleString()}</div>
      <div class="dash-metric-lbl">Total spent</div>
      <div class="dash-metric-sub">₹${d.savedVsPetrol} saved vs petrol</div>
    </div>
    <div class="dash-metric">
      <div class="dash-metric-val" style="color:var(--amber)">${d.avgSolar}%</div>
      <div class="dash-metric-lbl">Avg solar share</div>
      <div class="dash-metric-sub">Per session</div>
    </div>
    <div class="dash-metric">
      <div class="dash-metric-val" style="color:var(--green)">${d.totalCo2} kg</div>
      <div class="dash-metric-lbl">CO₂ avoided</div>
      <div class="dash-metric-sub">≈ ${Math.round(d.totalCo2 / 21)} trees/month</div>
    </div>
  `;
}

function renderSessionsTable(sessions) {
  const tbody = document.getElementById('sessions-tbody');
  if (!tbody) return;
  tbody.innerHTML = sessions.map(s => {
    const solarColor = s.solarPct >= 90 ? '#4ade80' : s.solarPct >= 70 ? '#fbbf24' : '#f87171';
    return `<tr>
      <td>${formatDate(s.date)}</td>
      <td>${s.stationName}</td>
      <td>${s.kWh} kWh</td>
      <td>₹${s.cost}</td>
      <td><span class="solar-pill" style="background:${solarColor}22;color:${solarColor}">${s.solarPct}% ☀</span></td>
      <td>${s.co2} kg</td>
    </tr>`;
  }).join('');
}

function renderBarChart(sessions) {
  const el = document.getElementById('bar-chart');
  if (!el) return;

  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  // Map sessions to days-of-week
  const kwhByDay = Array(7).fill(0);
  sessions.forEach(s => {
    const d = new Date(s.date).getDay();
    kwhByDay[d === 0 ? 6 : d - 1] += s.kWh;
  });

  const max = Math.max(...kwhByDay, 10);
  el.innerHTML = days.map((day, i) => {
    const kwh = kwhByDay[i];
    const pct = Math.round((kwh / max) * 100);
    const isAmber = kwh > 25;
    return `<div class="bar-wrap">
      <div class="bar ${isAmber ? 'amber' : ''}" style="height:${pct}%;width:100%">
        ${kwh > 0 ? `<span class="bar-val">${kwh.toFixed(0)}</span>` : ''}
      </div>
      <div class="bar-lbl">${day}</div>
    </div>`;
  }).join('');
}

function switchPeriod(period, btn) {
  document.querySelectorAll('.seg').forEach(s => s.classList.remove('active'));
  btn.classList.add('active');
  // Re-render with slight variation for demo
  initDashboard();
}

function exportCSV() {
  API.sessions.getAll().then(r => {
    if (!r.ok) return;
    const rows = [['Date','Station','kWh','Cost (Rs)','Solar %','CO2 saved (kg)']];
    r.data.forEach(s => rows.push([s.date, s.stationName, s.kWh, s.cost, s.solarPct+'%', s.co2]));
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'solarcharge-sessions.csv'; a.click();
    URL.revokeObjectURL(url);
  });
}

/* ─── BOOKING PAGE ─── */
async function initBooking() {
  // 1. Fetch stations first (await so dropdown is ready before anything else runs)
  if (!allStations.length) {
    const r = await API.stations.getAll();
    if (r.ok) allStations = r.data;
  }

  // 2. Re-populate dropdown cleanly (avoids duplicate options on re-visit)
  const sel = document.getElementById('book-station');
  if (sel) {
    while (sel.options.length > 1) sel.remove(1);
    allStations.filter(s => s.status !== 'offline').forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.name} — ₹${s.tariff}/kWh`;
      sel.appendChild(opt);
    });
  }

  // 3. Apply pre-selected station (from map page) or auto-pick first
  if (selectedStation && sel) {
    sel.value = selectedStation.id;
  } else if (sel && (!sel.value || sel.value === '') && sel.options.length > 1) {
    sel.selectedIndex = 1; // auto-select first available station
  }

  // 4. Set today's date
  const dateEl = document.getElementById('book-date');
  if (dateEl) {
    const today = new Date().toISOString().split('T')[0];
    dateEl.min = today;
    if (!dateEl.value) dateEl.value = today;
  }

  // 5. Load slots — station + date are both set at this point
  await loadSlots();
  loadUpcomingBookings();
}

async function loadSlots() {
  const stationId = document.getElementById('book-station')?.value;
  const date      = document.getElementById('book-date')?.value;
  const grid      = document.getElementById('slots-grid');
  if (!grid) return;

  // Both must be non-empty — empty string means placeholder is selected
  if (!stationId || stationId === '' || !date) {
    grid.innerHTML = '<div class="slot-placeholder">Select a station and date first</div>';
    return;
  }

  grid.innerHTML = '<div class="slot-placeholder" style="color:var(--green)">⟳ Loading available slots…</div>';

  const r = await API.bookings.getSlots({ stationId, date });
  if (!r.ok) {
    grid.innerHTML = '<div class="slot-placeholder" style="color:var(--red)">Could not load slots — try again</div>';
    return;
  }

  selectedSlot = null;
  grid.innerHTML = r.data.map(slot => `
    <div class="slot ${slot.peak ? 'peak' : ''} ${!slot.available ? 'booked' : ''}"
         onclick="${slot.available ? `pickSlot('${slot.time}','${slot.label}',this)` : ''}">
      <span class="slot-time">${slot.label}</span>
      <span class="slot-hint">${slot.peak && slot.available ? '☀ peak solar' : slot.available ? 'Available' : 'Booked'}</span>
    </div>
  `).join('');

  updateBookingCost();
}

function pickSlot(time, label, el) {
  document.querySelectorAll('.slot').forEach(s => s.classList.remove('selected'));
  el.classList.add('selected');
  selectedSlot = { time, label };
  updateBookingCost();
}

function updateBookingCost() {
  const stationId = document.getElementById('book-station')?.value;
  const target    = parseInt(document.getElementById('book-target')?.value || 80);
  const est       = document.getElementById('cost-estimate');
  if (!est) return;

  if (!stationId || !selectedSlot) { est.style.display = 'none'; return; }

  const station    = allStations.find(s => s.id === Number(stationId));
  if (!station) return;

  const estimatedKwh  = +(station.maxPower * 0.65 * (target / 100)).toFixed(1);
  const isPeak        = selectedSlot && ['10:00','11:00','12:00','13:00','14:00'].includes(selectedSlot.time);
  const discount      = isPeak ? 0.15 : 0;
  const tariff        = station.tariff;
  const discountAmt   = Math.round(estimatedKwh * tariff * discount);
  const total         = Math.round(estimatedKwh * tariff - discountAmt);

  document.getElementById('est-kwh').textContent    = estimatedKwh + ' kWh';
  document.getElementById('est-tariff').textContent = '₹' + tariff + '/kWh';
  document.getElementById('est-disc').textContent   = isPeak ? `-₹${discountAmt} (peak solar)` : '—';
  document.getElementById('est-total').textContent  = '₹' + total;
  est.style.display = 'block';

  // Store for submit
  window._bookingEstimate = { estimatedKwh, estimatedCost: total };
}

async function submitBooking() {
  const stationId   = document.getElementById('book-station')?.value;
  const date        = document.getElementById('book-date')?.value;
  const vehicleName = document.getElementById('book-vehicle')?.value;
  const targetSoc   = document.getElementById('book-target')?.value;
  const name        = document.getElementById('book-name')?.value?.trim();
  const phone       = document.getElementById('book-phone')?.value?.trim();

  if (!stationId) return showToast('Please select a station');
  if (!date)      return showToast('Please select a date');
  if (!selectedSlot) return showToast('Please pick a time slot');
  if (!name)      return showToast('Please enter your name');
  if (!phone)     return showToast('Please enter your phone number');

  const station = allStations.find(s => s.id === Number(stationId));
  const payload = {
    stationId: Number(stationId),
    stationName: station?.name,
    date, slot: selectedSlot.time, slotLabel: selectedSlot.label,
    vehicleName, targetSoc: Number(targetSoc),
    estimatedKwh:  window._bookingEstimate?.estimatedKwh  || 20,
    estimatedCost: window._bookingEstimate?.estimatedCost || 120,
    name, phone,
  };

  const r = await API.bookings.create(payload);
  if (!r.ok) return showToast('❌ ' + r.error);

  // Reset form state
  selectedSlot = null;
  document.querySelectorAll('.slot').forEach(s => s.classList.remove('selected'));
  const ce = document.getElementById('cost-estimate');
  if (ce) ce.style.display = 'none';
  loadSlots();
  loadUpcomingBookings();

  // Show QR ticket immediately
  showTicketModal(r.data);
}

async function loadUpcomingBookings() {
  const r = await API.bookings.getAll();
  const el = document.getElementById('upcoming-list');
  if (!el || !r.ok) return;

  if (!r.data.length) {
    el.innerHTML = '<p style="color:var(--text3);font-size:13px">No upcoming bookings</p>';
    return;
  }

  el.innerHTML = r.data.map(b => `
    <div class="upcoming-booking">
      <div>
        <div style="font-weight:500;color:var(--text)">${b.stationName}</div>
        <div style="color:var(--text2)">${formatDate(b.date)} · ${b.slotLabel}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="ub-ticket" onclick="showTicketModalById(${b.id})">🎫 Ticket</button>
        <button class="ub-cancel" onclick="cancelBooking(${b.id})">Cancel</button>
      </div>
    </div>
  `).join('');
}

async function cancelBooking(id) {
  const r = await API.bookings.cancel(id);
  if (r.ok) { showToast('Booking cancelled'); loadUpcomingBookings(); }
}

/* ─── QR TICKET ─── */

function _genBookingId(b) {
  // Deterministic short ID from booking fields
  const raw = `SC-${b.stationId}-${b.date}-${b.slot}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  return 'SC' + Math.abs(hash).toString(36).toUpperCase().slice(0, 8);
}

function _buildQRPayload(b, bookingId) {
  return JSON.stringify({
    id:       bookingId,
    station:  b.stationName,
    port:     'A' + ((b.stationId % 4) + 1),
    date:     b.date,
    slot:     b.slotLabel || b.slot,
    vehicle:  b.vehicleName,
    target:   b.targetSoc + '%',
    est_kwh:  b.estimatedKwh,
    est_cost: '₹' + b.estimatedCost,
    name:     b.name,
    phone:    b.phone,
    issued:   new Date().toISOString().slice(0, 10),
  });
}

function showTicketModal(b) {
  const bookingId = _genBookingId(b);
  const isPeak    = ['10:00','11:00','12:00','13:00','14:00'].includes(b.slot);
  const portLabel = 'Port A' + ((b.stationId % 4) + 1);

  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  overlay.classList.add('open');

  content.innerHTML = `
    <div class="ticket-modal" style="margin:-36px">
      <div class="ticket-header">
        <div class="ticket-header-icon">⚡</div>
        <div class="ticket-header-text">
          <h2>Booking Confirmed!</h2>
          <p>Scan QR at the station to start charging</p>
        </div>
        <button onclick="closeModal()" style="margin-left:auto;background:none;border:none;font-size:20px;color:rgba(0,0,0,0.5);cursor:pointer">✕</button>
      </div>
      <div class="ticket-body">
        <div class="ticket-row">
          <span class="ticket-label">Booking ID</span>
          <span class="ticket-value">${bookingId} <span class="ticket-id-badge">CONFIRMED</span></span>
        </div>
        <div class="ticket-row">
          <span class="ticket-label">Station</span>
          <span class="ticket-value">${b.stationName}</span>
        </div>
        <div class="ticket-row">
          <span class="ticket-label">Port</span>
          <span class="ticket-value">${portLabel}</span>
        </div>
        <div class="ticket-row">
          <span class="ticket-label">Date &amp; Time</span>
          <span class="ticket-value">${formatDate(b.date)} · ${b.slotLabel || b.slot}${isPeak ? ' ☀' : ''}</span>
        </div>
        <div class="ticket-row">
          <span class="ticket-label">Vehicle</span>
          <span class="ticket-value">${b.vehicleName}</span>
        </div>
        <div class="ticket-row">
          <span class="ticket-label">Target SoC</span>
          <span class="ticket-value">${b.targetSoc}%</span>
        </div>
        <div class="ticket-row">
          <span class="ticket-label">Est. energy / cost</span>
          <span class="ticket-value">${b.estimatedKwh} kWh · ₹${b.estimatedCost}</span>
        </div>
        <div class="ticket-row">
          <span class="ticket-label">Name</span>
          <span class="ticket-value">${b.name}</span>
        </div>

        <hr class="ticket-divider">

        <div class="ticket-qr-section">
          <div class="ticket-qr-wrap" id="ticket-qr-canvas"></div>
          <div class="ticket-qr-label">Scan at the charging port to authenticate &amp; start</div>
        </div>
      </div>
      <div class="ticket-actions">
        <button class="btn-primary" style="flex:1;border-radius:var(--radius-sm)" onclick="printTicket('${bookingId}')">🖨 Print ticket</button>
        <button class="btn-ghost" style="flex:1;border-radius:var(--radius-sm)" onclick="closeModal()">Close</button>
      </div>
    </div>
  `;

  // Generate QR after DOM renders
  setTimeout(() => {
    const container = document.getElementById('ticket-qr-canvas');
    if (!container || typeof QRGen === 'undefined') return;
    const payload = _buildQRPayload(b, bookingId);
    container.dataset.payload = payload;
    QRGen.toDiv(payload, container, 180, '#0a0f0a', '#ffffff');
  }, 60);
}

async function showTicketModalById(id) {
  await DB.ready;
  const b = await DB.get('bookings', id);
  if (!b) return showToast('Booking not found');
  showTicketModal(b);
}

function printTicket(bookingId) {
  const qrEl  = document.getElementById('ticket-qr-canvas');
  const qrImg = qrEl?.querySelector('img')?.src
             || (typeof QRGen !== 'undefined' && qrEl
                 ? QRGen.toDataURL(qrEl.dataset.payload || bookingId, 200, '#0a0f0a', '#ffffff')
                 : '');
  const body  = document.querySelector('.ticket-body')?.innerHTML || '';

  const win = window.open('', '_blank');
  win.document.write(`
    <!DOCTYPE html><html><head>
    <title>SolarCharge Ticket — ${bookingId}</title>
    <style>
      body { font-family: 'DM Sans', Arial, sans-serif; background:#fff; color:#111; padding:32px; max-width:480px; margin:0 auto; }
      h1 { font-size:22px; margin-bottom:4px; color:#0a7a40; }
      p  { color:#555; font-size:13px; margin-bottom:24px; }
      .row { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #eee; font-size:14px; }
      .lbl { color:#888; }
      .val { font-weight:600; text-align:right; }
      .qr  { text-align:center; margin:24px 0 8px; }
      .qr img { border:4px solid #0a7a40; border-radius:8px; }
      .qr-hint { text-align:center; font-size:12px; color:#888; }
      .badge { background:#dcfce7; color:#166534; border-radius:999px; padding:2px 10px; font-size:11px; font-weight:700; }
      hr { border:none; border-top:2px dashed #ccc; margin:20px 0; }
      @media print { body { padding:0; } button { display:none; } }
    </style></head><body>
    <h1>⚡ SolarCharge — Charging Ticket</h1>
    <p>Present this ticket (QR or printout) at the station port</p>
    <div class="row"><span class="lbl">Booking ID</span><span class="val">${bookingId} <span class="badge">CONFIRMED</span></span></div>
    ${body.replace(/<div class="ticket-qr-section">[\s\S]*?<\/div>\s*<\/div>/, '')}
    <hr>
    <div class="qr">${qrImg ? `<img src="${qrImg}" width="180" height="180">` : '<p>QR not available</p>'}</div>
    <div class="qr-hint">Scan QR at the charging port to authenticate &amp; start session</div>
    <br><button onclick="window.print()" style="padding:10px 24px;background:#22c55e;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer">🖨 Print</button>
    </body></html>
  `);
  win.document.close();
}

/* ─── AUTH MODALS ─── */
function openModal(type) {
  const overlay = document.getElementById('modal-overlay');
  const content = document.getElementById('modal-content');
  overlay.classList.add('open');

  if (type === 'login') {
    content.innerHTML = `
      <h2>Welcome back</h2>
      <p>Sign in to your SolarCharge account</p>
      <div class="form-group"><label>Email</label><input type="email" id="m-email" placeholder="you@example.com" value="demo@solarcharge.in"></div>
      <div class="form-group"><label>Password</label><input type="password" id="m-pass" placeholder="••••••••" value="demo1234"></div>
      <button class="btn-primary btn-block" onclick="submitLogin()">Sign in</button>
      <div class="modal-footer">Don't have an account? <a onclick="openModal('register')">Sign up</a></div>
      <div style="margin-top:12px;font-size:12px;color:var(--text3);text-align:center">Demo: demo@solarcharge.in / demo1234</div>
    `;
  } else {
    content.innerHTML = `
      <h2>Create account</h2>
      <p>Join India's greenest EV charging network</p>
      <div class="form-group"><label>Full name</label><input type="text" id="m-name" placeholder="Arjun Mehta"></div>
      <div class="form-group"><label>Email</label><input type="email" id="m-email" placeholder="you@example.com"></div>
      <div class="form-group"><label>Password</label><input type="password" id="m-pass" placeholder="Min 6 characters"></div>
      <button class="btn-primary btn-block" onclick="submitRegister()">Create account</button>
      <div class="modal-footer">Already have an account? <a onclick="openModal('login')">Sign in</a></div>
    `;
  }
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

async function submitLogin() {
  const email    = document.getElementById('m-email').value;
  const password = document.getElementById('m-pass').value;
  const r = await API.auth.login({ email, password });
  if (!r.ok) return showToast('❌ ' + r.error);
  closeModal();
  showToast('✅ Welcome back, ' + r.data.user.name + '!');
  updateNavForUser(r.data.user);
}

async function submitRegister() {
  const name     = document.getElementById('m-name').value;
  const email    = document.getElementById('m-email').value;
  const password = document.getElementById('m-pass').value;
  const r = await API.auth.register({ name, email, password });
  if (!r.ok) return showToast('❌ ' + r.error);
  closeModal();
  showToast('✅ Account created! Welcome, ' + r.data.user.name + '!');
  updateNavForUser(r.data.user);
}

function updateNavForUser(user) {
  const actions = document.querySelector('.nav-actions');
  if (!actions) return;
  actions.innerHTML = `
    <span style="font-size:13px;color:var(--text2)">Hi, ${user.name.split(' ')[0]}</span>
    <button class="btn-ghost" onclick="handleLogout()">Log out</button>
  `;
}

async function handleLogout() {
  await API.auth.logout();
  showToast('Logged out');
  const actions = document.querySelector('.nav-actions');
  if (actions) actions.innerHTML = `
    <button class="btn-ghost" onclick="openModal('login')">Log in</button>
    <button class="btn-primary" onclick="openModal('register')">Sign up</button>
  `;
}

/* ─── MOBILE NAV ─── */
function toggleMobileNav() {
  const links = document.querySelector('.nav-links');
  const actions = document.querySelector('.nav-actions');
  if (!links) return;
  const open = links.style.display === 'flex';
  links.style.cssText = open ? '' : 'display:flex;flex-direction:column;position:fixed;top:64px;left:0;right:0;background:var(--bg2);padding:16px;border-bottom:1px solid var(--border);gap:12px;z-index:999';
  actions.style.cssText = open ? '' : 'display:flex;flex-direction:column;position:fixed;top:64px;left:0;right:0;background:var(--bg2);padding:8px 16px 16px;z-index:999;margin-top:160px';
}

/* ─── UTILITIES ─── */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ─── INIT ─── */
document.addEventListener('DOMContentLoaded', () => {
  initHome();

  // Set today's min date for booking
  const dateEl = document.getElementById('book-date');
  if (dateEl) dateEl.min = new Date().toISOString().split('T')[0];
});
