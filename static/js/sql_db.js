/**
 * SQL_DB — process_dashboard/static/js/sql_db.js
 *
 * A thin wrapper around sql.js (SQLite compiled to WebAssembly).
 * This gives us a REAL SQL database running entirely in the browser.
 *
 * Schema mirrors a PostgreSQL event_log table so that every query
 * written here is valid PostgreSQL syntax (SQLite is a strict subset).
 *
 * Resume claim: "Designed a scalable SQL-based event pipeline and
 * database application from scratch to model complex business process
 * flows for 10,000+ sales orders."
 *
 * ──────────────────────────────────────────────────────────────────
 *  TABLE: event_log
 * ──────────────────────────────────────────────────────────────────
 *  id        INTEGER  PRIMARY KEY AUTOINCREMENT
 *  case_id   TEXT     NOT NULL        — e.g. ORD-00001
 *  activity  TEXT     NOT NULL        — e.g. "Credit Check"
 *  timestamp TEXT     NOT NULL        — ISO 8601 string
 *  resource  TEXT                     — who performed the step
 *  dept      TEXT                     — department
 *  cost      REAL     DEFAULT 0       — step cost in USD
 *  variant   TEXT                     — process variant label
 * ──────────────────────────────────────────────────────────────────
 */

const SqlDB = {

  /** sql.js constructor (set after WASM loads) */
  SQL: null,

  /** The live in-memory SQLite Database instance */
  db: null,

  /** True once init() has been called */
  ready: false,

  /**
   * init()
   *
   * Loads the sql.js WASM binary from CDN and creates the database.
   * Must be awaited before any other method is called.
   */
  async init() {
    if (this.ready) return;

    console.log('[SqlDB] Loading sql.js WASM...');

    // sql.js fetches its .wasm file from the same CDN
    this.SQL = await initSqlJs({
      locateFile: file =>
        `https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/${file}`
    });

    this.db = new this.SQL.Database();
    this._createSchema();
    this.ready = true;

    console.log('[SqlDB] SQLite database ready ✓');
  },

  // ──────────────────────────────────────────────────────────────────
  // SCHEMA
  // ──────────────────────────────────────────────────────────────────

  /**
   * _createSchema()
   *
   * Creates the event_log table and performance indexes.
   *
   * PostgreSQL equivalent:
   *   CREATE TABLE event_log (
   *     id        SERIAL PRIMARY KEY,
   *     case_id   TEXT    NOT NULL,
   *     activity  TEXT    NOT NULL,
   *     timestamp TIMESTAMPTZ NOT NULL,
   *     resource  TEXT,
   *     dept      TEXT,
   *     cost      NUMERIC(10,2) DEFAULT 0,
   *     variant   TEXT
   *   );
   *   CREATE INDEX idx_case_id   ON event_log(case_id);
   *   CREATE INDEX idx_activity  ON event_log(activity);
   *   CREATE INDEX idx_timestamp ON event_log(timestamp);
   */
  _createSchema() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS event_log (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id   TEXT    NOT NULL,
        activity  TEXT    NOT NULL,
        timestamp TEXT    NOT NULL,
        resource  TEXT,
        dept      TEXT,
        cost      REAL    DEFAULT 0,
        variant   TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_case_id   ON event_log(case_id);
      CREATE INDEX IF NOT EXISTS idx_activity  ON event_log(activity);
      CREATE INDEX IF NOT EXISTS idx_timestamp ON event_log(timestamp);
    `);
  },

  // ──────────────────────────────────────────────────────────────────
  // DATA LOADING
  // ──────────────────────────────────────────────────────────────────

  /**
   * loadEvents(events)
   *
   * Bulk-inserts an array of event objects into event_log.
   * Uses a single transaction for performance (critical at 10,000+ rows).
   *
   * PostgreSQL equivalent:
   *   BEGIN;
   *   INSERT INTO event_log (case_id, activity, timestamp, ...)
   *   VALUES ($1,$2,$3,...), ...;
   *   COMMIT;
   *
   * @param {Array} events   — array of event objects from DataGenerator
   * @returns {number}       — number of rows inserted
   */
  loadEvents(events) {
    if (!this.ready) throw new Error('SqlDB not initialized. Call await SqlDB.init() first.');

    // Clear existing data
    this.db.run('DELETE FROM event_log');

    // Wrap ALL inserts in one transaction — 100× faster than auto-commit
    this.db.run('BEGIN TRANSACTION');

    const stmt = this.db.prepare(`
      INSERT INTO event_log (case_id, activity, timestamp, resource, dept, cost, variant)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const e of events) {
      const ts = e.timestamp instanceof Date
        ? e.timestamp.toISOString()
        : String(e.timestamp);

      stmt.run([
        e.case_id,
        e.activity,
        ts,
        e.resource  || null,
        e.dept      || null,
        e.cost      || 0,
        e.variant   || null,
      ]);
    }

    stmt.free();
    this.db.run('COMMIT');

    console.log(`[SqlDB] Loaded ${events.length} events into event_log`);
    return events.length;
  },

  // ──────────────────────────────────────────────────────────────────
  // QUERYING
  // ──────────────────────────────────────────────────────────────────

  /**
   * query(sql, params)
   *
   * Runs a SELECT query and returns an array of plain row objects.
   * Column names become object keys (same as PostgreSQL's pg library).
   *
   * Example:
   *   SqlDB.query("SELECT COUNT(*) as n FROM event_log")
   *   // → [{ n: 10000 }]
   *
   * @param {string} sql     — SQL query string (use ? for parameters)
   * @param {Array}  params  — positional parameter values
   * @returns {Array}        — array of row objects
   */
  query(sql, params = []) {
    if (!this.ready) throw new Error('SqlDB not initialized.');

    const stmt = this.db.prepare(sql);
    if (params.length) stmt.bind(params);

    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  },

  /**
   * exec(sql)
   *
   * Runs one or more SQL statements (DDL, INSERT, UPDATE, DELETE).
   * Returns the raw sql.js result array (useful for multi-statement DDL).
   */
  exec(sql) {
    if (!this.ready) throw new Error('SqlDB not initialized.');
    return this.db.exec(sql);
  },

  /**
   * queryOne(sql, params)
   *
   * Like query() but returns only the first row (or null).
   * Mirrors PostgreSQL's fetchone() / LIMIT 1 pattern.
   */
  queryOne(sql, params = []) {
    const rows = this.query(sql + ' LIMIT 1', params);
    return rows.length ? rows[0] : null;
  },

  /**
   * getSchema()
   *
   * Returns the CREATE TABLE statement for documentation / SQL Explorer.
   */
  getSchema() {
    return `-- ProcessMind Event Log Schema
-- PostgreSQL-compatible (also runs on SQLite via sql.js)

CREATE TABLE event_log (
  id        SERIAL PRIMARY KEY,
  case_id   TEXT    NOT NULL,           -- Business case identifier (e.g. ORD-00001)
  activity  TEXT    NOT NULL,           -- Process step name
  timestamp TIMESTAMPTZ NOT NULL,       -- When the step occurred (UTC)
  resource  TEXT,                       -- Person/system that executed the step
  dept      TEXT,                       -- Department (Sales, Finance, Warehouse...)
  cost      NUMERIC(10,2) DEFAULT 0,    -- Step cost in USD
  variant   TEXT                        -- Process variant (Happy Path, Rework Loop...)
);

-- Indexes for query performance at 10,000+ rows
CREATE INDEX idx_case_id   ON event_log(case_id);
CREATE INDEX idx_activity  ON event_log(activity);
CREATE INDEX idx_timestamp ON event_log(timestamp);`;
  },

  /**
   * rowCount()
   *
   * Quick count of all events in the database.
   */
  rowCount() {
    const row = this.queryOne('SELECT COUNT(*) as n FROM event_log');
    return row ? (row.n || 0) : 0;
  },
};
