/**
 * api.js — SolarCharge simulated backend API
 * Mimics a RESTful Node.js/Express backend with async responses.
 * Each call reads/writes to IndexedDB (window.DB) and adds realistic latency.
 */

const API = (() => {

  // Simulate network latency (50–250 ms)
  const delay = (ms = 120) => new Promise(r => setTimeout(r, ms + Math.random() * 130));

  // Auth state (in-memory session)
  let _currentUser = null;

  // ─── UTILITY ───
  function _success(data) { return { ok: true, data }; }
  function _error(msg)    { return { ok: false, error: msg }; }

  // ─── AUTH ENDPOINTS ───

  /**
   * POST /api/auth/register
   */
  async function register({ name, email, password }) {
    await delay();
    if (!name || !email || !password) return _error('All fields required');
    if (!email.includes('@')) return _error('Invalid email address');
    if (password.length < 6) return _error('Password must be at least 6 characters');

    // Check duplicate
    await DB.ready;
    const all = await DB.getAll('users');
    if (all.find(u => u.email === email)) return _error('Email already registered');

    const user = { name, email, passwordHash: btoa(password), wallet: 500, createdAt: new Date().toISOString() };
    const id = await DB.put('users', user);
    _currentUser = { ...user, id };
    return _success({ user: _sanitizeUser(_currentUser) });
  }

  /**
   * POST /api/auth/login
   */
  async function login({ email, password }) {
    await delay();
    if (!email || !password) return _error('Email and password required');

    await DB.ready;
    const all = await DB.getAll('users');
    const user = all.find(u => u.email === email);

    // Demo: allow demo@solarcharge.in / demo1234
    if (email === 'demo@solarcharge.in' && password === 'demo1234') {
      _currentUser = { id: 1, name: 'Arjun Mehta', email, wallet: 500 };
      return _success({ user: _sanitizeUser(_currentUser) });
    }

    if (!user) return _error('No account found with that email');
    if (btoa(password) !== user.passwordHash) return _error('Incorrect password');

    _currentUser = user;
    return _success({ user: _sanitizeUser(user) });
  }

  /**
   * POST /api/auth/logout
   */
  async function logout() {
    await delay(50);
    _currentUser = null;
    return _success({ message: 'Logged out' });
  }

  function _sanitizeUser(u) {
    const { passwordHash, ...safe } = u;
    return safe;
  }

  function getCurrentUser() { return _currentUser; }

  // ─── STATIONS ENDPOINTS ───

  /**
   * GET /api/stations
   */
  async function getStations({ city, status, connector } = {}) {
    await delay();
    await DB.ready;
    let stations = await DB.getAll('stations');

    // Simulate live port updates
    stations = stations.map(s => ({
      ...s,
      freePorts: s.status === 'offline' ? 0 : Math.max(0, s.freePorts + Math.floor(Math.random() * 3) - 1),
    }));

    if (city)       stations = stations.filter(s => s.city.toLowerCase().includes(city.toLowerCase()));
    if (status)     stations = stations.filter(s => s.status === status);
    if (connector)  stations = stations.filter(s => s.connectors.some(c => c.toLowerCase().includes(connector.toLowerCase())));

    return _success(stations);
  }

  /**
   * GET /api/stations/:id
   */
  async function getStation(id) {
    await delay(80);
    await DB.ready;
    const station = await DB.get('stations', Number(id));
    if (!station) return _error('Station not found');
    return _success(station);
  }

  // ─── SESSIONS ENDPOINTS ───

  /**
   * GET /api/sessions (for current user)
   */
  async function getSessions() {
    await delay();
    await DB.ready;
    const userId = _currentUser?.id || 1;
    const sessions = await DB.getByIndex('sessions', 'userId', userId);
    sessions.sort((a, b) => new Date(b.date) - new Date(a.date));
    return _success(sessions);
  }

  /**
   * GET /api/sessions/stats — aggregated stats
   */
  async function getSessionStats() {
    await delay(80);
    await DB.ready;
    const userId = _currentUser?.id || 1;
    const sessions = await DB.getByIndex('sessions', 'userId', userId);

    const totalKwh  = sessions.reduce((s, x) => s + x.kWh, 0);
    const totalCost = sessions.reduce((s, x) => s + x.cost, 0);
    const totalCo2  = sessions.reduce((s, x) => s + x.co2, 0);
    const avgSolar  = sessions.length ? Math.round(sessions.reduce((s, x) => s + x.solarPct, 0) / sessions.length) : 0;
    const savedVsPetrol = Math.round(totalKwh * 6.2); // rough petrol cost equivalent

    return _success({ totalKwh: +totalKwh.toFixed(1), totalCost: Math.round(totalCost), totalCo2: +totalCo2.toFixed(1), avgSolar, savedVsPetrol, sessionCount: sessions.length });
  }

  // ─── BOOKINGS ENDPOINTS ───

  /**
   * GET /api/bookings (for current user)
   */
  async function getBookings() {
    await delay();
    await DB.ready;
    const userId = _currentUser?.id || 1;
    const bookings = await DB.getByIndex('bookings', 'userId', userId);
    bookings.sort((a, b) => new Date(a.date + ' ' + a.slot) - new Date(b.date + ' ' + b.slot));
    // Return only upcoming
    const now = new Date();
    return _success(bookings.filter(b => new Date(b.date) >= new Date(now.toDateString())));
  }

  /**
   * GET /api/bookings/slots?stationId=&date=
   */
  async function getSlots({ stationId, date }) {
    await delay();
    await DB.ready;

    // All bookings for this station on this date
    const stationBookings = await DB.getByIndex('bookings', 'stationId', Number(stationId));
    const booked = stationBookings.filter(b => b.date === date).map(b => b.slot);

    const allSlots = [
      { time: '07:00', label: '7 AM',  peak: false },
      { time: '09:00', label: '9 AM',  peak: false },
      { time: '10:00', label: '10 AM', peak: true },
      { time: '11:00', label: '11 AM', peak: true },
      { time: '12:00', label: '12 PM', peak: true },
      { time: '13:00', label: '1 PM',  peak: true },
      { time: '14:00', label: '2 PM',  peak: true },
      { time: '15:00', label: '3 PM',  peak: false },
      { time: '17:00', label: '5 PM',  peak: false },
      { time: '19:00', label: '7 PM',  peak: false },
      { time: '21:00', label: '9 PM',  peak: false },
    ];

    return _success(allSlots.map(s => ({ ...s, available: !booked.includes(s.time) })));
  }

  /**
   * POST /api/bookings
   */
  async function createBooking({ stationId, stationName, date, slot, slotLabel, vehicleName, targetSoc, estimatedKwh, estimatedCost, name, phone }) {
    await delay(200);
    if (!stationId || !date || !slot) return _error('Station, date, and slot are required');
    if (!name)  return _error('Name is required');
    if (!phone) return _error('Phone is required');

    await DB.ready;
    // Double-check slot not taken
    const existing = await DB.getByIndex('bookings', 'stationId', Number(stationId));
    const conflict = existing.find(b => b.date === date && b.slot === slot);
    if (conflict) return _error('That slot was just taken — please pick another');

    const userId = _currentUser?.id || 1;
    const booking = {
      userId, stationId: Number(stationId), stationName, date, slot, slotLabel,
      vehicleName, targetSoc, estimatedKwh, estimatedCost, name, phone,
      createdAt: new Date().toISOString(), status: 'confirmed'
    };
    const id = await DB.put('bookings', booking);
    return _success({ ...booking, id, message: 'Booking confirmed!' });
  }

  /**
   * DELETE /api/bookings/:id
   */
  async function cancelBooking(id) {
    await delay(100);
    await DB.ready;
    await DB.delete('bookings', Number(id));
    return _success({ message: 'Booking cancelled' });
  }

  // ─── LIVE DATA ENDPOINTS ───

  /**
   * GET /api/live — simulated real-time station metrics
   */
  async function getLiveMetrics() {
    await delay(60);
    return _success({
      solarKw:    +(3.8 + Math.random() * 1.2).toFixed(1),
      gridKw:     +(0.2 + Math.random() * 0.6).toFixed(1),
      batteryPct: Math.round(72 + Math.random() * 20),
      activeChargers: Math.round(8 + Math.random() * 6),
      solarPct:   Math.round(78 + Math.random() * 18),
      timestamp:  new Date().toISOString(),
    });
  }

  // ─── NETWORK STATS ───

  /**
   * GET /api/network — global platform stats
   */
  async function getNetworkStats() {
    await delay(80);
    return _success({
      totalStations: 248,
      sessionsToday:  18420 + Math.round(Math.random() * 200),
      co2SavedTons:   94.2,
      activeChargers: 1842,
    });
  }

  // Public interface
  return {
    auth: { register, login, logout, getCurrentUser },
    stations: { getAll: getStations, getOne: getStation },
    sessions: { getAll: getSessions, getStats: getSessionStats },
    bookings: { getAll: getBookings, getSlots, create: createBooking, cancel: cancelBooking },
    live: { getMetrics: getLiveMetrics },
    network: { getStats: getNetworkStats },
  };
})();

window.API = API;
