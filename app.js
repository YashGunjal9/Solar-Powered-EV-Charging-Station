/**
 * app.js — SolarCharge frontend controller (clean rewrite)
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

/* ─── HOME ─── */
async function tickerUpdate() {
  const r = await API.live.getMetrics();
  if (!r.ok) return;
  const d   = r.data;
  const pct = 70 + Math.round(Math.random() * 10);
  const arc = document.getElementById('ring-arc');
  if (arc) arc.setAttribute('stroke-dashoffset', Math.round(251 * (1 - pct / 100)));
  setText('live-pct',   pct + '%');
  setText('live-kw',    d.activeChargers > 10 ? '22 kW' : '11 kW');
  setText('live-solar', '☀ ' + d.solarPct + '%');
  setText('live-eta',   '~' + (8 + Math.round(Math.random() * 10)) + ' min');
}

async function initHome() {
  const r = await API.network.getStats();
  if (r.ok) {
    setText('h-stations', r.data.totalStations.toLocaleString());
    setText('h-sessions',  r.data.sessionsToday.toLocaleString());
    setText('h-co2',       r.data.co2SavedTons.toLocaleString());
  }
  tickerUpdate();
  clearInterval(liveInterval);
  liveInterval = setInterval(tickerUpdate, 4000);
}

/* ─── STATIONS ─── */
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
    const badge     = s.status === 'available' ? 'badge-green' : s.status === 'busy' ? 'badge-amber' : 'badge-red';
    const statusLbl = s.status === 'available' ? 'Available' : s.status === 'busy' ? 'Busy' : 'Offline';
    return '<div class="station-card" onclick="selectStation(' + s.id + ')">'
      + '<div class="station-card-top">'
      + '<div><div class="station-name">' + s.name + '</div>'
      + '<div class="station-addr">📍 ' + s.address + ' · ' + s.distance + ' km away</div></div>'
      + '<span class="station-badge ' + badge + '">' + statusLbl + '</span></div>'
      + '<div class="station-meta">'
      + '<span>⚡ ' + s.power + '</span><span>☀ ' + s.solarPct + '% solar</span>'
      + '<span>₹' + s.tariff + '/kWh</span><span>' + s.connectors.join(' · ') + '</span></div>'
      + '<div class="station-ports"><div class="port-bar-wrap"><span>' + s.freePorts + '/' + s.ports + ' ports free</span>'
      + '<div class="port-bar"><div class="port-bar-fill ' + barColor + '" style="width:' + (freeRatio * 100) + '%"></div></div></div></div>'
      + '</div>';
  }).join('');
}

function renderMapPins(stations) {
  const container = document.getElementById('map-pins');
  if (!container) return;
  container.innerHTML =
    '<div class="map-road-h" style="top:48%;height:12px"></div>'
    + '<div class="map-road-h" style="top:68%;height:8px"></div>'
    + '<div class="map-road-v" style="left:35%;width:10px"></div>'
    + '<div class="map-road-v" style="left:65%;width:8px"></div>'
    + stations.map(s => {
      const color = s.status === 'available' ? '#4ade80' : s.status === 'busy' ? '#fbbf24' : '#f87171';
      return '<div class="map-pin-dot" style="background:' + color + ';left:' + s.lat + '%;top:' + s.top + '%"'
        + ' title="' + s.name + '" onclick="selectStation(' + s.id + ')"></div>';
    }).join('');
}

function filterStations(query) {
  const q = query.toLowerCase().trim();
  let filtered = allStations;
  if (q) filtered = filtered.filter(s =>
    s.name.toLowerCase().includes(q) || s.city.toLowerCase().includes(q) || s.address.toLowerCase().includes(q)
  );
  applyChipFilter(filtered);
}

function toggleFilter(el, type) {
  activeFilter = type;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  filterStations(document.querySelector('.search-input') ? document.querySelector('.search-input').value : '');
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
  showPage('booking');
}

/* ─── DASHBOARD ─── */
async function initDashboard() {
  const statsRes = await API.sessions.getStats();
  const sessRes  = await API.sessions.getAll();
  if (statsRes.ok) renderDashMetrics(statsRes.data);
  if (sessRes.ok)  renderSessionsTable(sessRes.data);
  renderBarChart(sessRes.ok ? sessRes.data : []);
}

function renderDashMetrics(d) {
  const el = document.getElementById('dash-metrics');
  if (!el) return;
  el.innerHTML =
    '<div class="dash-metric"><div class="dash-metric-val">' + d.totalKwh + ' kWh</div><div class="dash-metric-lbl">Total energy charged</div><div class="dash-metric-sub">' + d.sessionCount + ' sessions</div></div>'
    + '<div class="dash-metric"><div class="dash-metric-val">₹' + d.totalCost.toLocaleString() + '</div><div class="dash-metric-lbl">Total spent</div><div class="dash-metric-sub">₹' + d.savedVsPetrol + ' saved vs petrol</div></div>'
    + '<div class="dash-metric"><div class="dash-metric-val" style="color:var(--amber)">' + d.avgSolar + '%</div><div class="dash-metric-lbl">Avg solar share</div><div class="dash-metric-sub">Per session</div></div>'
    + '<div class="dash-metric"><div class="dash-metric-val" style="color:var(--green)">' + d.totalCo2 + ' kg</div><div class="dash-metric-lbl">CO₂ avoided</div><div class="dash-metric-sub">≈ ' + Math.round(d.totalCo2 / 21) + ' trees/month</div></div>';
}

function renderSessionsTable(sessions) {
  const tbody = document.getElementById('sessions-tbody');
  if (!tbody) return;
  tbody.innerHTML = sessions.map(s => {
    const sc = s.solarPct >= 90 ? '#4ade80' : s.solarPct >= 70 ? '#fbbf24' : '#f87171';
    return '<tr><td>' + formatDate(s.date) + '</td><td>' + s.stationName + '</td><td>' + s.kWh + ' kWh</td><td>₹' + s.cost + '</td>'
      + '<td><span class="solar-pill" style="background:' + sc + '22;color:' + sc + '">' + s.solarPct + '% ☀</span></td><td>' + s.co2 + ' kg</td></tr>';
  }).join('');
}

function renderBarChart(sessions) {
  const el = document.getElementById('bar-chart');
  if (!el) return;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const kwhByDay = Array(7).fill(0);
  sessions.forEach(s => { const d = new Date(s.date).getDay(); kwhByDay[d === 0 ? 6 : d - 1] += s.kWh; });
  const max = Math.max.apply(null, kwhByDay.concat([10]));
  el.innerHTML = days.map((day, i) => {
    const kwh = kwhByDay[i];
    const pct = Math.round((kwh / max) * 100);
    return '<div class="bar-wrap"><div class="bar ' + (kwh > 25 ? 'amber' : '') + '" style="height:' + pct + '%;width:100%">'
      + (kwh > 0 ? '<span class="bar-val">' + kwh.toFixed(0) + '</span>' : '')
      + '</div><div class="bar-lbl">' + day + '</div></div>';
  }).join('');
}

function switchPeriod(period, btn) {
  document.querySelectorAll('.seg').forEach(s => s.classList.remove('active'));
  btn.classList.add('active');
  initDashboard();
}

function exportCSV() {
  API.sessions.getAll().then(function(r) {
    if (!r.ok) return;
    var rows = [['Date', 'Station', 'kWh', 'Cost (Rs)', 'Solar %', 'CO2 saved (kg)']];
    r.data.forEach(function(s) { rows.push([s.date, s.stationName, s.kWh, s.cost, s.solarPct + '%', s.co2]); });
    var csv  = rows.map(function(r) { return r.join(','); }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url; a.download = 'solarcharge-sessions.csv'; a.click();
    URL.revokeObjectURL(url);
  });
}

/* ─── BOOKING ─── */
async function initBooking() {
  if (!allStations.length) {
    const r = await API.stations.getAll();
    if (r.ok) allStations = r.data;
  }

  const sel = document.getElementById('book-station');
  if (sel) {
    while (sel.options.length > 1) sel.remove(1);
    allStations.filter(function(s) { return s.status !== 'offline'; }).forEach(function(s) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name + ' — ₹' + s.tariff + '/kWh';
      sel.appendChild(opt);
    });
  }

  if (selectedStation && sel) {
    sel.value = selectedStation.id;
  } else if (sel && (!sel.value || sel.value === '') && sel.options.length > 1) {
    sel.selectedIndex = 1;
  }

  const dateEl = document.getElementById('book-date');
  if (dateEl) {
    const today = new Date().toISOString().split('T')[0];
    dateEl.min = today;
    if (!dateEl.value) dateEl.value = today;
  }

  await loadSlots();
  loadUpcomingBookings();
}

async function loadSlots() {
  const stationId = document.getElementById('book-station') ? document.getElementById('book-station').value : '';
  const date      = document.getElementById('book-date')    ? document.getElementById('book-date').value    : '';
  const grid      = document.getElementById('slots-grid');
  if (!grid) return;

  if (!stationId || stationId === '' || !date) {
    grid.innerHTML = '<div class="slot-placeholder">Select a station and date first</div>';
    return;
  }

  grid.innerHTML = '<div class="slot-placeholder" style="color:var(--green)">⟳ Loading available slots…</div>';
  const r = await API.bookings.getSlots({ stationId: stationId, date: date });
  if (!r.ok) {
    grid.innerHTML = '<div class="slot-placeholder" style="color:var(--red)">Could not load slots — try again</div>';
    return;
  }

  selectedSlot   = null;
  /* Adapt grid columns to screen width */
  var slotCols = window.innerWidth < 380 ? 2 : window.innerWidth < 600 ? 3 : 4;
  grid.style.gridTemplateColumns = 'repeat(' + slotCols + ', 1fr)';
  grid.innerHTML = r.data.map(function(slot) {
    return '<div class="slot ' + (slot.peak ? 'peak' : '') + ' ' + (!slot.available ? 'booked' : '') + '"'
      + (slot.available ? ' onclick="pickSlot(\'' + slot.time + '\',\'' + slot.label + '\',this)"' : '')
      + '><span class="slot-time">' + slot.label + '</span>'
      + '<span class="slot-hint">' + (slot.peak && slot.available ? '☀ peak solar' : slot.available ? 'Available' : 'Booked') + '</span></div>';
  }).join('');

  updateBookingCost();
}

function pickSlot(time, label, el) {
  document.querySelectorAll('.slot').forEach(function(s) { s.classList.remove('selected'); });
  el.classList.add('selected');
  selectedSlot = { time: time, label: label };
  updateBookingCost();
}

function updateBookingCost() {
  const stationId = document.getElementById('book-station') ? document.getElementById('book-station').value : '';
  const target    = parseInt((document.getElementById('book-target') ? document.getElementById('book-target').value : '80') || 80);
  const est       = document.getElementById('cost-estimate');
  if (!est) return;
  if (!stationId || !selectedSlot) { est.style.display = 'none'; return; }

  const station = allStations.find(function(s) { return s.id === Number(stationId); });
  if (!station) return;

  const estimatedKwh = parseFloat((station.maxPower * 0.65 * (target / 100)).toFixed(1));
  const isPeak       = ['10:00', '11:00', '12:00', '13:00', '14:00'].indexOf(selectedSlot.time) !== -1;
  const discountAmt  = isPeak ? Math.round(estimatedKwh * station.tariff * 0.15) : 0;
  const total        = Math.round(estimatedKwh * station.tariff - discountAmt);

  document.getElementById('est-kwh').textContent    = estimatedKwh + ' kWh';
  document.getElementById('est-tariff').textContent = '₹' + station.tariff + '/kWh';
  document.getElementById('est-disc').textContent   = isPeak ? '-₹' + discountAmt + ' (peak solar)' : '—';
  document.getElementById('est-total').textContent  = '₹' + total;
  est.style.display = 'block';

  window._bookingEstimate = { estimatedKwh: estimatedKwh, estimatedCost: total };
}

async function submitBooking() {
  const stationId   = document.getElementById('book-station') ? document.getElementById('book-station').value : '';
  const date        = document.getElementById('book-date')    ? document.getElementById('book-date').value    : '';
  var vehicleSel  = document.getElementById('book-vehicle');
  var vehicleName = vehicleSel ? vehicleSel.options[vehicleSel.selectedIndex].text : '';
  const targetSoc   = document.getElementById('book-target')  ? document.getElementById('book-target').value  : '80';
  const name        = document.getElementById('book-name')    ? document.getElementById('book-name').value.trim()  : '';
  const phone       = document.getElementById('book-phone')   ? document.getElementById('book-phone').value.trim() : '';

  if (!stationId)    return showToast('Please select a station');
  if (!date)         return showToast('Please select a date');
  if (!selectedSlot) return showToast('Please pick a time slot');
  if (!name)         return showToast('Please enter your name');
  if (!phone)        return showToast('Please enter your phone number');

  const station = allStations.find(function(s) { return s.id === Number(stationId); });
  const payload = {
    stationId:     Number(stationId),
    stationName:   station ? station.name : '',
    date:          date,
    slot:          selectedSlot.time,
    slotLabel:     selectedSlot.label,
    vehicleName:   vehicleName,
    targetSoc:     Number(targetSoc),
    estimatedKwh:  window._bookingEstimate ? window._bookingEstimate.estimatedKwh  : 20,
    estimatedCost: window._bookingEstimate ? window._bookingEstimate.estimatedCost : 120,
    name:          name,
    phone:         phone,
  };

  const r = await API.bookings.create(payload);
  if (!r.ok) return showToast('❌ ' + r.error);

  selectedSlot = null;
  document.querySelectorAll('.slot').forEach(function(s) { s.classList.remove('selected'); });
  const ce = document.getElementById('cost-estimate');
  if (ce) ce.style.display = 'none';
  loadSlots();
  loadUpcomingBookings();
  showTicketModal(r.data);
}

async function loadUpcomingBookings() {
  const r  = await API.bookings.getAll();
  const el = document.getElementById('upcoming-list');
  if (!el || !r.ok) return;
  if (!r.data.length) {
    el.innerHTML = '<p style="color:var(--text3);font-size:13px">No upcoming bookings</p>';
    return;
  }
  el.innerHTML = r.data.map(function(b) {
    return '<div class="upcoming-booking">'
      + '<div><div style="font-weight:500;color:var(--text)">' + b.stationName + '</div>'
      + '<div style="color:var(--text2)">' + formatDate(b.date) + ' · ' + b.slotLabel + '</div></div>'
      + '<div style="display:flex;gap:8px;align-items:center">'
      + '<button class="ub-ticket" onclick="showTicketModalById(' + b.id + ')">🎫 Ticket</button>'
      + '<button class="ub-cancel" onclick="cancelBooking(' + b.id + ')">Cancel</button>'
      + '</div></div>';
  }).join('');
}

async function cancelBooking(id) {
  const r = await API.bookings.cancel(id);
  if (r.ok) { showToast('Booking cancelled'); loadUpcomingBookings(); }
}

/* ─── QR TICKET ─── */
function _genBookingId(b) {
  const raw = 'SC-' + b.stationId + '-' + b.date + '-' + b.slot;
  let hash  = 0;
  for (let i = 0; i < raw.length; i++) hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  return 'SC' + Math.abs(hash).toString(36).toUpperCase().slice(0, 8);
}

function _buildQRPayload(b, bookingId) {
  return JSON.stringify({
    id: bookingId, station: b.stationName,
    port: 'A' + ((b.stationId % 4) + 1),
    date: b.date, slot: b.slotLabel || b.slot,
    vehicle: b.vehicleName, target: b.targetSoc + '%',
    est_kwh: b.estimatedKwh, est_cost: '₹' + b.estimatedCost,
    name: b.name, phone: b.phone,
    issued: new Date().toISOString().slice(0, 10),
  });
}

function showTicketModal(b) {
  const bookingId = _genBookingId(b);
  const isPeak    = ['10:00', '11:00', '12:00', '13:00', '14:00'].indexOf(b.slot) !== -1;
  const portLabel = 'Port A' + ((b.stationId % 4) + 1);

  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('modal-content').innerHTML =
    '<div class="ticket-modal" style="margin:-36px">'
    + '<div class="ticket-header">'
    + '<div class="ticket-header-icon">⚡</div>'
    + '<div class="ticket-header-text"><h2>Booking Confirmed!</h2><p>Scan QR at the station to start charging</p></div>'
    + '<button onclick="closeModal()" style="margin-left:auto;background:none;border:none;font-size:20px;color:rgba(0,0,0,0.5);cursor:pointer">✕</button>'
    + '</div>'
    + '<div class="ticket-body">'
    + '<div class="ticket-row"><span class="ticket-label">Booking ID</span><span class="ticket-value">' + bookingId + ' <span class="ticket-id-badge">CONFIRMED</span></span></div>'
    + '<div class="ticket-row"><span class="ticket-label">Station</span><span class="ticket-value">' + b.stationName + '</span></div>'
    + '<div class="ticket-row"><span class="ticket-label">Port</span><span class="ticket-value">' + portLabel + '</span></div>'
    + '<div class="ticket-row"><span class="ticket-label">Date &amp; Time</span><span class="ticket-value">' + formatDate(b.date) + ' · ' + (b.slotLabel || b.slot) + (isPeak ? ' ☀' : '') + '</span></div>'
    + '<div class="ticket-row"><span class="ticket-label">Vehicle</span><span class="ticket-value">' + b.vehicleName + '</span></div>'
    + '<div class="ticket-row"><span class="ticket-label">Target SoC</span><span class="ticket-value">' + b.targetSoc + '%</span></div>'
    + '<div class="ticket-row"><span class="ticket-label">Est. energy / cost</span><span class="ticket-value">' + b.estimatedKwh + ' kWh · ₹' + b.estimatedCost + '</span></div>'
    + '<div class="ticket-row"><span class="ticket-label">Name</span><span class="ticket-value">' + b.name + '</span></div>'
    + '<hr class="ticket-divider">'
    + '<div class="ticket-qr-section">'
    + '<div class="ticket-qr-wrap" id="ticket-qr-canvas"></div>'
    + '<div class="ticket-qr-label">Scan at the charging port to authenticate &amp; start</div>'
    + '</div>'
    + '</div>'
    + '<div class="ticket-actions">'
    + '<button class="btn-primary" style="flex:1;border-radius:var(--radius-sm)" onclick="downloadTicket()">⬇ Download</button>'
    + '<button class="btn-ghost" style="flex:1;border-radius:var(--radius-sm)" onclick="printTicket(\'' + bookingId + '\')">🖨 Print</button>'
    + '<button class="btn-ghost" style="padding:12px 14px;border-radius:var(--radius-sm)" onclick="closeModal()">✕</button>'
    + '</div></div>';

  /* Screen-adaptive QR size */
  var qrSize = window.innerWidth < 380 ? 100 : window.innerWidth < 600 ? 120 : 140;

  setTimeout(function() {
    var container = document.getElementById('ticket-qr-canvas');
    if (!container || typeof QRGen === 'undefined') return;
    var payload = _buildQRPayload(b, bookingId);
    container.dataset.payload   = payload;
    container.dataset.bookingId = bookingId;
    QRGen.toDiv(payload, container, qrSize, '#0a0f0a', '#ffffff');
  }, 60);
}

async function showTicketModalById(id) {
  await DB.ready;
  const b = await DB.get('bookings', id);
  if (!b) return showToast('Booking not found');
  showTicketModal(b);
}

/* ─── DOWNLOAD TICKET PNG ─── */
function downloadTicket() {
  var rows = [];
  document.querySelectorAll('.ticket-row').forEach(function(r) {
    var lbl = r.querySelector('.ticket-label') ? r.querySelector('.ticket-label').textContent.trim() : '';
    var val = r.querySelector('.ticket-value') ? r.querySelector('.ticket-value').textContent.trim().replace('CONFIRMED', '').trim() : '';
    if (lbl) rows.push({ lbl: lbl, val: val });
  });

  var qrEl      = document.getElementById('ticket-qr-canvas');
  var qrImg     = qrEl ? qrEl.querySelector('img') : null;
  var bookingId = (qrEl && qrEl.dataset.bookingId) ? qrEl.dataset.bookingId : 'SC-TICKET';

  var W = 600, PAD = 36, ROW_H = 44, HEADER_H = 90, QR_SIZE = 200;
  var DIVIDER_Y = HEADER_H + PAD + rows.length * ROW_H + 20;
  var H = DIVIDER_Y + 30 + QR_SIZE + 80 + PAD;

  var cv = document.createElement('canvas');
  cv.width = W * 2; cv.height = H * 2;
  var ctx = cv.getContext('2d');
  ctx.scale(2, 2);

  // Background
  ctx.fillStyle = '#0f1a0f'; ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = '#4ade80'; _rrect(ctx, 0, 0, W, HEADER_H, 0); ctx.fill();
  ctx.font = '26px serif'; ctx.fillStyle = '#0a0f0a'; ctx.fillText('⚡', PAD, 48);
  ctx.font = 'bold 17px Arial'; ctx.fillText('Booking Confirmed!', PAD + 38, 40);
  ctx.font = '13px Arial'; ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillText('Scan QR at the charging port to start', PAD + 38, 62);
  ctx.fillStyle = 'rgba(0,0,0,0.15)'; _rrect(ctx, W - 122, 28, 90, 26, 13); ctx.fill();
  ctx.font = 'bold 11px Arial'; ctx.fillStyle = '#0a3a15';
  ctx.textAlign = 'center'; ctx.fillText('CONFIRMED', W - 77, 45); ctx.textAlign = 'left';

  // Rows
  var y = HEADER_H + PAD;
  rows.forEach(function(item, i) {
    if (i % 2 === 0) { ctx.fillStyle = 'rgba(74,222,128,0.04)'; ctx.fillRect(PAD - 8, y - 6, W - (PAD - 8) * 2, ROW_H); }
    ctx.font = '13px Arial'; ctx.fillStyle = '#7a9a7a'; ctx.fillText(item.lbl, PAD, y + 16);
    ctx.font = 'bold 14px Arial'; ctx.fillStyle = '#e8f5e9';
    ctx.textAlign = 'right'; ctx.fillText(item.val, W - PAD, y + 16); ctx.textAlign = 'left';
    ctx.strokeStyle = 'rgba(74,222,128,0.1)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(PAD, y + ROW_H - 2); ctx.lineTo(W - PAD, y + ROW_H - 2); ctx.stroke();
    y += ROW_H;
  });

  // Dashed divider
  ctx.setLineDash([6, 5]); ctx.strokeStyle = 'rgba(74,222,128,0.25)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(PAD, DIVIDER_Y); ctx.lineTo(W - PAD, DIVIDER_Y); ctx.stroke();
  ctx.setLineDash([]);

  // QR card
  var qrTop = DIVIDER_Y + 24, qrX = (W - QR_SIZE) / 2;
  ctx.fillStyle = '#ffffff'; _rrect(ctx, qrX - 14, qrTop - 14, QR_SIZE + 28, QR_SIZE + 28, 14); ctx.fill();
  ctx.strokeStyle = 'rgba(74,222,128,0.4)'; ctx.lineWidth = 2;
  _rrect(ctx, qrX - 14, qrTop - 14, QR_SIZE + 28, QR_SIZE + 28, 14); ctx.stroke();

  if (qrImg && qrImg.complete && qrImg.naturalWidth > 0) {
    ctx.drawImage(qrImg, qrX, qrTop, QR_SIZE, QR_SIZE);
  } else if (typeof QRGen !== 'undefined' && qrEl && qrEl.dataset.payload) {
    var tmpCv = document.createElement('canvas');
    QRGen.toCanvas(qrEl.dataset.payload, tmpCv, QR_SIZE, '#0a0f0a', '#ffffff');
    ctx.drawImage(tmpCv, qrX, qrTop, QR_SIZE, QR_SIZE);
  }

  ctx.font = '12px Arial'; ctx.fillStyle = '#556655'; ctx.textAlign = 'center';
  ctx.fillText('Scan at the charging port to authenticate & start', W / 2, qrTop + QR_SIZE + 34);
  ctx.font = 'bold 13px monospace'; ctx.fillStyle = '#4ade80';
  ctx.fillText(bookingId, W / 2, qrTop + QR_SIZE + 56); ctx.textAlign = 'left';

  // Footer
  ctx.fillStyle = 'rgba(74,222,128,0.07)'; ctx.fillRect(0, H - 28, W, 28);
  ctx.font = '11px Arial'; ctx.fillStyle = '#4a6a4a'; ctx.textAlign = 'center';
  ctx.fillText('SolarCharge · Solar EV Charging Network · solarcharge.in', W / 2, H - 10);
  ctx.textAlign = 'left';

  var link = document.createElement('a');
  link.download = 'SolarCharge-Ticket-' + bookingId + '.png';
  link.href = cv.toDataURL('image/png');
  link.click();
  showToast('✅ Ticket downloaded!');
}

function _rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);     ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.lineTo(x + r, y + h);     ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.lineTo(x, y + r);         ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

/* ─── PRINT TICKET ─── */
function printTicket(bookingId) {
  var qrEl  = document.getElementById('ticket-qr-canvas');
  var qrSrc = '';
  if (qrEl) {
    var img = qrEl.querySelector('img');
    if (img) qrSrc = img.src;
    else if (typeof QRGen !== 'undefined' && qrEl.dataset.payload) {
      qrSrc = QRGen.toDataURL(qrEl.dataset.payload, 200, '#0a0f0a', '#ffffff');
    }
  }
  var body = document.querySelector('.ticket-body') ? document.querySelector('.ticket-body').innerHTML : '';

  var win = window.open('', '_blank');
  if (!win) { showToast('Allow popups to print'); return; }
  win.document.write('<!DOCTYPE html><html><head><title>SolarCharge Ticket</title>'
    + '<style>body{font-family:Arial,sans-serif;background:#fff;color:#111;padding:32px;max-width:480px;margin:0 auto}'
    + 'h1{font-size:22px;margin-bottom:4px;color:#0a7a40}p{color:#555;font-size:13px;margin-bottom:24px}'
    + '.ticket-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee;font-size:14px}'
    + '.ticket-label{color:#888}.ticket-value{font-weight:600;text-align:right}'
    + '.ticket-id-badge{background:#dcfce7;color:#166534;border-radius:999px;padding:2px 10px;font-size:11px;font-weight:700;margin-left:6px}'
    + '.ticket-divider{border:none;border-top:2px dashed #ccc;margin:20px 0}'
    + '.ticket-qr-section{text-align:center;margin:20px 0}.ticket-qr-wrap img{border:4px solid #0a7a40;border-radius:8px}'
    + '.ticket-qr-label{font-size:12px;color:#888;margin-top:8px}@media print{button{display:none}}'
    + '</style></head><body>'
    + '<h1>⚡ SolarCharge — Charging Ticket</h1>'
    + '<p>Present this ticket (QR or printout) at the station port</p>'
    + body
    + '<br><button onclick="window.print()" style="padding:10px 24px;background:#22c55e;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer">🖨 Print</button>'
    + '</body></html>');
  win.document.close();
}

/* ─── AUTH ─── */
function openModal(type) {
  document.getElementById('modal-overlay').classList.add('open');
  var content = document.getElementById('modal-content');
  if (type === 'login') {
    content.innerHTML = '<h2>Welcome back</h2><p>Sign in to your SolarCharge account</p>'
      + '<div class="form-group"><label>Email</label><input type="email" id="m-email" placeholder="you@example.com" value="demo@solarcharge.in"></div>'
      + '<div class="form-group"><label>Password</label><input type="password" id="m-pass" placeholder="••••••••" value="demo1234"></div>'
      + '<button class="btn-primary btn-block" onclick="submitLogin()">Sign in</button>'
      + '<div class="modal-footer">No account? <a onclick="openModal(\'register\')">Sign up</a></div>'
      + '<div style="margin-top:12px;font-size:12px;color:var(--text3);text-align:center">Demo: demo@solarcharge.in / demo1234</div>';
  } else {
    content.innerHTML = '<h2>Create account</h2><p>Join India\'s greenest EV charging network</p>'
      + '<div class="form-group"><label>Full name</label><input type="text" id="m-name" placeholder="Arjun Mehta"></div>'
      + '<div class="form-group"><label>Email</label><input type="email" id="m-email" placeholder="you@example.com"></div>'
      + '<div class="form-group"><label>Password</label><input type="password" id="m-pass" placeholder="Min 6 characters"></div>'
      + '<button class="btn-primary btn-block" onclick="submitRegister()">Create account</button>'
      + '<div class="modal-footer">Have an account? <a onclick="openModal(\'login\')">Sign in</a></div>';
  }
}

function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); }

async function submitLogin() {
  var email = document.getElementById('m-email').value;
  var pass  = document.getElementById('m-pass').value;
  var r = await API.auth.login({ email: email, password: pass });
  if (!r.ok) return showToast('❌ ' + r.error);
  closeModal(); showToast('✅ Welcome back, ' + r.data.user.name + '!');
  updateNavForUser(r.data.user);
}

async function submitRegister() {
  var name  = document.getElementById('m-name').value;
  var email = document.getElementById('m-email').value;
  var pass  = document.getElementById('m-pass').value;
  var r = await API.auth.register({ name: name, email: email, password: pass });
  if (!r.ok) return showToast('❌ ' + r.error);
  closeModal(); showToast('✅ Account created! Welcome, ' + r.data.user.name + '!');
  updateNavForUser(r.data.user);
}

function updateNavForUser(user) {
  var actions = document.querySelector('.nav-actions');
  if (!actions) return;
  actions.innerHTML = '<span style="font-size:13px;color:var(--text2)">Hi, ' + user.name.split(' ')[0] + '</span>'
    + '<button class="btn-ghost" onclick="handleLogout()">Log out</button>';
}

async function handleLogout() {
  await API.auth.logout();
  showToast('Logged out');
  var actions = document.querySelector('.nav-actions');
  if (actions) actions.innerHTML = '<button class="btn-ghost" onclick="openModal(\'login\')">Log in</button>'
    + '<button class="btn-primary" onclick="openModal(\'register\')">Sign up</button>';
}

/* ─── MOBILE NAV ─── */
function toggleMobileNav() {
  var links   = document.querySelector('.nav-links');
  var actions = document.querySelector('.nav-actions');
  if (!links) return;
  var open = links.style.display === 'flex';
  links.style.cssText   = open ? '' : 'display:flex;flex-direction:column;position:fixed;top:64px;left:0;right:0;background:var(--bg2);padding:16px;border-bottom:1px solid var(--border);gap:12px;z-index:999';
  actions.style.cssText = open ? '' : 'display:flex;flex-direction:column;position:fixed;top:64px;left:0;right:0;background:var(--bg2);padding:8px 16px 16px;z-index:999;margin-top:160px';
}

/* ─── UTILS ─── */
function setText(id, text) { var el = document.getElementById(id); if (el) el.textContent = text; }

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

var toastTimer;
function showToast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { t.classList.remove('show'); }, 3200);
}

/* ─── INIT ─── */
document.addEventListener('DOMContentLoaded', function() {
  initHome();
  var dateEl = document.getElementById('book-date');
  if (dateEl) dateEl.min = new Date().toISOString().split('T')[0];
});
