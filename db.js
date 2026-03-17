/**
 * db.js — SolarCharge IndexedDB layer
 * Simulates a persistent database in the browser.
 * Stores: users, sessions, bookings, stations (cache)
 */

const DB_NAME = 'SolarChargeDB';
const DB_VERSION = 1;

class Database {
  constructor() {
    this.db = null;
    this.ready = this._init();
  }

  _init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        // Users table
        if (!db.objectStoreNames.contains('users')) {
          const users = db.createObjectStore('users', { keyPath: 'id', autoIncrement: true });
          users.createIndex('email', 'email', { unique: true });
        }

        // Charging sessions table
        if (!db.objectStoreNames.contains('sessions')) {
          const sessions = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
          sessions.createIndex('userId', 'userId');
          sessions.createIndex('date', 'date');
        }

        // Bookings table
        if (!db.objectStoreNames.contains('bookings')) {
          const bookings = db.createObjectStore('bookings', { keyPath: 'id', autoIncrement: true });
          bookings.createIndex('userId', 'userId');
          bookings.createIndex('stationId', 'stationId');
          bookings.createIndex('slot', 'slot');
        }

        // Stations cache
        if (!db.objectStoreNames.contains('stations')) {
          db.createObjectStore('stations', { keyPath: 'id' });
        }
      };

      req.onsuccess = (e) => {
        this.db = e.target.result;
        this._seed();
        resolve(this.db);
      };

      req.onerror = () => reject(req.error);
    });
  }

  // Generic helpers
  _tx(store, mode = 'readonly') {
    return this.db.transaction(store, mode).objectStore(store);
  }

  _wrap(req) {
    return new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror  = () => rej(req.error);
    });
  }

  async put(store, record) {
    await this.ready;
    return this._wrap(this._tx(store, 'readwrite').put(record));
  }

  async get(store, key) {
    await this.ready;
    return this._wrap(this._tx(store).get(key));
  }

  async getAll(store) {
    await this.ready;
    return this._wrap(this._tx(store).getAll());
  }

  async getByIndex(store, index, value) {
    await this.ready;
    const tx = this.db.transaction(store, 'readonly');
    const idx = tx.objectStore(store).index(index);
    return this._wrap(idx.getAll(value));
  }

  async delete(store, key) {
    await this.ready;
    return this._wrap(this._tx(store, 'readwrite').delete(key));
  }

  // ─── SEED DATA ───
  async _seed() {
    // Seed stations if not already present
    const existing = await this.getAll('stations');
    if (existing.length > 0) return;

    const stations = [
      { id: 1, name: 'MSEDCL Solar Hub', address: 'Bhiwandi, Thane', city: 'Bhiwandi', lat: 57, top: 48, connectors: ['CCS2','Type-2'], power: '22 kW AC', maxPower: 22, solarPct: 94, ports: 6, freePorts: 4, status: 'available', tariff: 6, distance: 1.2 },
      { id: 2, name: 'Kalher DC Fast',   address: 'Kalher, Bhiwandi', city: 'Bhiwandi', lat: 39, top: 62, connectors: ['DC Fast','CHAdeMO'], power: '50 kW DC', maxPower: 50, solarPct: 78, ports: 4, freePorts: 1, status: 'busy', tariff: 8, distance: 3.4 },
      { id: 3, name: 'Navi Mumbai Hub',  address: 'Vashi, Navi Mumbai', city: 'Navi Mumbai', lat: 72, top: 72, connectors: ['CCS2','Type-2'], power: '22 kW AC', maxPower: 22, solarPct: 100, ports: 8, freePorts: 6, status: 'available', tariff: 6.5, distance: 18 },
      { id: 4, name: 'Pune Solar Park',  address: 'Hinjewadi, Pune', city: 'Pune', lat: 25, top: 80, connectors: ['DC Fast','CCS2'], power: '150 kW DC', maxPower: 150, solarPct: 88, ports: 10, freePorts: 7, status: 'available', tariff: 7.5, distance: 74 },
      { id: 5, name: 'Nashik Green EV',  address: 'Satpur, Nashik', city: 'Nashik', lat: 82, top: 30, connectors: ['Type-2'], power: '7.4 kW AC', maxPower: 7.4, solarPct: 82, ports: 4, freePorts: 0, status: 'offline', tariff: 5.5, distance: 160 },
    ];

    for (const s of stations) await this.put('stations', s);

    // Seed demo session history for current user (userId=1)
    const sessionData = [
      { userId: 1, stationId: 1, stationName: 'MSEDCL Solar Hub', date: '2026-03-17', kWh: 22.4, cost: 134, solarPct: 89, co2: 8.1 },
      { userId: 1, stationId: 2, stationName: 'Kalher DC Fast',   date: '2026-03-15', kWh: 30.2, cost: 242, solarPct: 72, co2: 10.9 },
      { userId: 1, stationId: 1, stationName: 'MSEDCL Solar Hub', date: '2026-03-13', kWh: 18.6, cost: 112, solarPct: 94, co2: 6.7 },
      { userId: 1, stationId: 3, stationName: 'Navi Mumbai Hub',  date: '2026-03-11', kWh: 24.0, cost: 156, solarPct: 100, co2: 8.6 },
      { userId: 1, stationId: 1, stationName: 'MSEDCL Solar Hub', date: '2026-03-08', kWh: 20.1, cost: 121, solarPct: 87, co2: 7.2 },
    ];
    for (const s of sessionData) await this.put('sessions', s);
  }
}

// Singleton DB
window.DB = new Database();
