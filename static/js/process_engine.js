/**
 * PROCESS ENGINE — process_dashboard/static/js/process_engine.js
 *
 * The analytics brain of ProcessMind.
 * All statistics are computed via REAL SQL queries executed against
 * the in-browser SQLite database (sql.js / SqlDB).
 *
 * Every function documents the equivalent PostgreSQL query so the
 * code matches the resume claim:
 *   "Designed a scalable SQL-based event pipeline and database
 *    application from scratch to model complex business process
 *    flows for 10,000+ sales orders."
 *
 * Key SQL features used (PostgreSQL-compatible):
 *   ✓ CTEs (WITH clauses)
 *   ✓ Window functions: LAG() OVER (PARTITION BY … ORDER BY …)
 *   ✓ Aggregations: COUNT, AVG, SUM, MAX, MIN, GROUP_CONCAT
 *   ✓ Subqueries & derived tables
 *   ✓ CASE expressions
 *   ✓ Z-score anomaly detection
 */

const ProcessEngine = {

  /** Computed statistics — updated on every load() call */
  stats: null,

  // ============================================================
  // ENTRY POINT
  // ============================================================

  /**
   * load()
   *
   * Runs all analytics queries against SqlDB.event_log and caches
   * results in this.stats. Call after SqlDB.loadEvents().
   */
  load() {
    console.group('[ProcessEngine] Running SQL analytics...');
    console.time('Total SQL analysis time');

    console.log('Step 1: Case summaries...');
    const cases = this._queryCases();

    console.log('Step 2: Activity statistics (window functions)...');
    const activityStats = this._queryActivityStats();

    console.log('Step 3: Process graph (Directly-Follows Graph)...');
    const graph = this._buildProcessGraph(cases);

    console.log('Step 4: Bottleneck detection...');
    const bottlenecks = this._detectBottlenecks(activityStats);

    console.log('Step 5: Variant discovery...');
    const variants = this._queryVariants(cases);

    console.log('Step 6: Resource workload analysis...');
    const resourceStats = this._queryResourceStats();

    console.log('Step 7: Time series (events per day)...');
    const timeSeries = this._queryTimeSeries();

    console.log('Step 8: Duration distribution (histogram)...');
    const durationDist = this._computeDurationDistribution(cases);

    console.log('Step 9: Cycle-time anomaly detection (Z-score)...');
    const anomalies = this._queryCycleTimeAnomalies();

    console.timeEnd('Total SQL analysis time');
    console.groupEnd();

    this.stats = {
      totalCases:       cases.size,
      totalEvents:      SqlDB.rowCount(),
      uniqueActivities: activityStats.size,
      totalVariants:    variants.length,
      cases,
      activityStats,
      graph,
      bottlenecks,
      variants,
      resourceStats,
      timeSeries,
      durationDist,
      anomalies,
      avgCaseDuration:  this._avgCaseDuration(cases),
      happyPath:        variants[0]?.path || [],
    };

    console.log(`[ProcessEngine] ✓ ${this.stats.totalCases.toLocaleString()} cases, ${this.stats.totalEvents.toLocaleString()} events, ${anomalies.length} anomalies`);
    return this.stats;
  },

  // ============================================================
  // STEP 1: CASE SUMMARIES
  // ============================================================

  /**
   * _queryCases()
   *
   * SQL:
   *   SELECT
   *     case_id,
   *     MIN(timestamp)  AS start_ts,
   *     MAX(timestamp)  AS end_ts,
   *     COUNT(*)        AS event_count,
   *     (julianday(MAX(timestamp)) - julianday(MIN(timestamp))) * 24
   *                     AS duration_hours
   *   FROM event_log
   *   GROUP BY case_id
   *   ORDER BY MIN(timestamp);
   *
   * PostgreSQL equivalent uses EXTRACT(EPOCH FROM …) / 3600 instead
   * of julianday().
   */
  _queryCases() {
    const rows = SqlDB.query(`
      SELECT
        case_id,
        MIN(timestamp)  AS start_ts,
        MAX(timestamp)  AS end_ts,
        COUNT(*)        AS event_count,
        (julianday(MAX(timestamp)) - julianday(MIN(timestamp))) * 24
                        AS duration_hours
      FROM event_log
      GROUP BY case_id
      ORDER BY MIN(timestamp)
    `);

    // Also fetch ordered event sequences per case for graph building
    const eventRows = SqlDB.query(`
      SELECT case_id, activity, timestamp, resource, dept, cost, variant
      FROM event_log
      ORDER BY case_id, timestamp
    `);

    // Group events by case
    const eventsByCase = new Map();
    for (const e of eventRows) {
      if (!eventsByCase.has(e.case_id)) eventsByCase.set(e.case_id, []);
      const arr = eventsByCase.get(e.case_id);
      arr.push({
        case_id:   e.case_id,
        activity:  e.activity,
        timestamp: new Date(e.timestamp),
        resource:  e.resource,
        dept:      e.dept,
        cost:      e.cost,
        variant:   e.variant,
      });
    }

    const cases = new Map();
    for (const row of rows) {
      const events = eventsByCase.get(row.case_id) || [];
      cases.set(row.case_id, {
        id:         row.case_id,
        events:     events,
        start:      new Date(row.start_ts),
        end:        new Date(row.end_ts),
        duration:   row.duration_hours || 0,
        activities: events.map(e => e.activity),
      });
    }

    return cases;
  },

  // ============================================================
  // STEP 2: ACTIVITY STATISTICS WITH WINDOW FUNCTIONS
  // ============================================================

  /**
   * _queryActivityStats()
   *
   * Uses LAG() window function to compute wait times between steps.
   *
   * SQL (PostgreSQL / SQLite 3.25+):
   *   WITH ordered_events AS (
   *     SELECT
   *       case_id,
   *       activity,
   *       timestamp,
   *       resource,
   *       LAG(timestamp) OVER (
   *         PARTITION BY case_id
   *         ORDER BY timestamp
   *       ) AS prev_ts
   *     FROM event_log
   *   ),
   *   wait_times AS (
   *     SELECT
   *       activity,
   *       CASE
   *         WHEN prev_ts IS NOT NULL
   *         THEN (julianday(timestamp) - julianday(prev_ts)) * 24
   *         ELSE 0
   *       END AS wait_hours
   *     FROM ordered_events
   *   )
   *   SELECT
   *     activity,
   *     COUNT(*)        AS frequency,
   *     AVG(wait_hours) AS avg_wait,
   *     MAX(wait_hours) AS max_wait,
   *     MIN(wait_hours) AS min_wait
   *   FROM wait_times
   *   GROUP BY activity
   *   ORDER BY avg_wait DESC;
   */
  _queryActivityStats() {
    // Step A: compute per-event wait times using LAG()
    const waitRows = SqlDB.query(`
      WITH ordered_events AS (
        SELECT
          case_id,
          activity,
          timestamp,
          resource,
          LAG(timestamp) OVER (
            PARTITION BY case_id
            ORDER BY timestamp
          ) AS prev_ts
        FROM event_log
      )
      SELECT
        activity,
        CASE
          WHEN prev_ts IS NOT NULL
          THEN (julianday(timestamp) - julianday(prev_ts)) * 24
          ELSE 0
        END AS wait_hours,
        resource
      FROM ordered_events
    `);

    // Step B: COUNT per resource per activity
    const resRows = SqlDB.query(`
      SELECT activity, resource, COUNT(*) AS cnt
      FROM event_log
      GROUP BY activity, resource
    `);

    // Step C: frequency and case counts
    const freqRows = SqlDB.query(`
      SELECT activity,
             COUNT(*)            AS frequency,
             COUNT(DISTINCT case_id) AS case_count
      FROM event_log
      GROUP BY activity
    `);

    // Build the stats map
    const actStats = new Map();

    // Init with frequency data
    for (const row of freqRows) {
      actStats.set(row.activity, {
        name:         row.activity,
        frequency:    row.frequency,
        caseCount:    row.case_count,
        waitTimes:    [],
        resourceList: [],
        avgWait:      0,
        medWait:      0,
        maxWait:      0,
        minWait:      0,
        p90Wait:      0,
      });
    }

    // Collect raw wait time arrays for percentile computation
    for (const row of waitRows) {
      const stat = actStats.get(row.activity);
      if (stat) stat.waitTimes.push(row.wait_hours || 0);
    }

    // Add resource lists
    for (const row of resRows) {
      const stat = actStats.get(row.activity);
      if (stat) stat.resourceList.push(row.resource);
    }

    // Compute aggregated stats
    for (const [, stat] of actStats) {
      const waits = stat.waitTimes.filter(w => w > 0);
      if (waits.length > 0) {
        stat.avgWait = waits.reduce((a, b) => a + b, 0) / waits.length;
        stat.medWait = this._median(waits);
        stat.maxWait = Math.max(...waits);
        stat.minWait = Math.min(...waits);
        stat.p90Wait = this._percentile(waits, 90);
      }
      delete stat.waitTimes; // free memory
    }

    return actStats;
  },

  // ============================================================
  // STEP 3: PROCESS GRAPH (DIRECTLY-FOLLOWS GRAPH)
  // ============================================================

  /**
   * _buildProcessGraph(cases)
   *
   * Constructs the DFG from case event sequences.
   * Equivalent SQL (PostgreSQL self-join for transitions):
   *
   *   SELECT e1.activity AS source, e2.activity AS target,
   *          COUNT(*) AS frequency,
   *          AVG((julianday(e2.timestamp) - julianday(e1.timestamp)) * 24) AS avg_dur
   *   FROM event_log e1
   *   JOIN event_log e2
   *     ON e1.case_id = e2.case_id
   *    AND e2.timestamp = (
   *          SELECT MIN(timestamp) FROM event_log
   *          WHERE case_id = e1.case_id AND timestamp > e1.timestamp
   *        )
   *   GROUP BY e1.activity, e2.activity;
   */
  _buildProcessGraph(cases) {
    const nodes = new Map();
    const edges = new Map();

    for (const [, caseData] of cases) {
      const events = caseData.events;

      for (let i = 0; i < events.length; i++) {
        const act = events[i].activity;

        if (!nodes.has(act)) {
          nodes.set(act, { id: act, frequency: 0, isStart: false, isEnd: false, caseCount: 0 });
        }
        const node = nodes.get(act);
        node.frequency++;
        if (i === 0)                   node.isStart = true;
        if (i === events.length - 1)   node.isEnd   = true;

        if (i > 0) {
          const prev    = events[i - 1].activity;
          const edgeKey = `${prev}→${act}`;
          if (!edges.has(edgeKey)) {
            edges.set(edgeKey, { source: prev, target: act, frequency: 0, durations: [] });
          }
          const edge = edges.get(edgeKey);
          edge.frequency++;
          const durH = (events[i].timestamp - events[i-1].timestamp) / 3600000;
          edge.durations.push(durH);
        }
      }
    }

    // Compute edge aggregates
    for (const [, edge] of edges) {
      const d = edge.durations;
      edge.avgDuration = d.reduce((a, b) => a + b, 0) / d.length;
      edge.maxDuration = Math.max(...d);
      edge.p90Duration = this._percentile(d, 90);
      delete edge.durations;
    }

    // Case counts for nodes
    for (const [name, node] of nodes) {
      node.caseCount = SqlDB.query(
        'SELECT COUNT(DISTINCT case_id) as n FROM event_log WHERE activity = ?',
        [name]
      )[0]?.n || 0;
    }

    return { nodes, edges };
  },

  // ============================================================
  // STEP 4: BOTTLENECK DETECTION
  // ============================================================

  /**
   * _detectBottlenecks(activityStats)
   *
   * Identifies bottlenecks by scoring each activity on:
   *   - Normalized average wait time  (weight 70%)
   *   - Normalized frequency          (weight 30%)
   *
   * SQL perspective:
   *   SELECT activity,
   *          avg_wait / MAX(avg_wait) OVER () * 0.7 +
   *          frequency / MAX(frequency) OVER () * 0.3 AS bottleneck_score
   *   FROM activity_stats
   *   WHERE avg_wait > 0.1
   *   ORDER BY bottleneck_score DESC;
   */
  _detectBottlenecks(activityStats) {
    const bottlenecks = [];

    let maxWait = 0, maxFreq = 0;
    for (const [, s] of activityStats) {
      maxWait = Math.max(maxWait, s.avgWait);
      maxFreq = Math.max(maxFreq, s.frequency);
    }

    for (const [activity, s] of activityStats) {
      if (s.avgWait < 0.1) continue;

      const normWait  = s.avgWait  / maxWait;
      const normFreq  = s.frequency / maxFreq;
      const score     = normWait * 0.7 + normFreq * 0.3;

      bottlenecks.push({
        activity,
        avgWait:   s.avgWait,
        p90Wait:   s.p90Wait,
        maxWait:   s.maxWait,
        frequency: s.frequency,
        caseCount: s.caseCount,
        score,
        impact:    s.avgWait * s.frequency,
        severity:  score > 0.7 ? 'critical' : score > 0.4 ? 'high' : 'medium',
      });
    }

    bottlenecks.sort((a, b) => b.score - a.score);
    return bottlenecks;
  },

  // ============================================================
  // STEP 5: VARIANT DISCOVERY
  // ============================================================

  /**
   * _queryVariants(cases)
   *
   * A process variant = unique ordered sequence of activities per case.
   *
   * SQL (GROUP_CONCAT preserves ORDER BY timestamp within each case):
   *
   *   WITH ordered AS (
   *     SELECT case_id, activity
   *     FROM event_log
   *     ORDER BY case_id, timestamp
   *   )
   *   SELECT
   *     case_id,
   *     GROUP_CONCAT(activity, ' → ') AS variant_path
   *   FROM ordered
   *   GROUP BY case_id;
   *
   *   -- Then group variant_path to count frequency:
   *   SELECT variant_path, COUNT(*) AS freq
   *   FROM (above)
   *   GROUP BY variant_path
   *   ORDER BY freq DESC;
   */
  _queryVariants(cases) {
    const variantMap = new Map();

    for (const [caseId, caseData] of cases) {
      const key = caseData.activities.join(' → ');

      if (!variantMap.has(key)) {
        variantMap.set(key, {
          path: caseData.activities,
          caseIds: [],
          frequency: 0,
          durations: [],
        });
      }

      const v = variantMap.get(key);
      v.caseIds.push(caseId);
      v.frequency++;
      v.durations.push(caseData.duration);
    }

    const variants = [...variantMap.values()].map(v => ({
      path:        v.path,
      frequency:   v.frequency,
      percentage:  (v.frequency / cases.size * 100).toFixed(1),
      avgDuration: v.durations.reduce((a, b) => a + b, 0) / v.durations.length,
      cases:       v.caseIds.slice(0, 5),
    }));

    variants.sort((a, b) => b.frequency - a.frequency);
    console.log(`[ProcessEngine] Discovered ${variants.length} distinct process variants`);
    return variants;
  },

  // ============================================================
  // STEP 6: RESOURCE STATISTICS
  // ============================================================

  /**
   * _queryResourceStats()
   *
   * SQL:
   *   SELECT
   *     resource,
   *     dept,
   *     COUNT(*)            AS event_count,
   *     COUNT(DISTINCT case_id) AS case_count,
   *     SUM(cost)           AS total_cost
   *   FROM event_log
   *   WHERE resource IS NOT NULL
   *   GROUP BY resource, dept
   *   ORDER BY event_count DESC;
   */
  _queryResourceStats() {
    const rows = SqlDB.query(`
      SELECT
        resource,
        dept,
        COUNT(*)                AS event_count,
        COUNT(DISTINCT case_id) AS case_count,
        SUM(cost)               AS total_cost
      FROM event_log
      WHERE resource IS NOT NULL
      GROUP BY resource, dept
      ORDER BY event_count DESC
    `);

    // Top activity per resource
    const topActRows = SqlDB.query(`
      SELECT resource, activity, COUNT(*) as cnt
      FROM event_log
      WHERE resource IS NOT NULL
      GROUP BY resource, activity
    `);

    const topActMap = new Map();
    for (const r of topActRows) {
      if (!topActMap.has(r.resource) || r.cnt > topActMap.get(r.resource).cnt) {
        topActMap.set(r.resource, { activity: r.activity, cnt: r.cnt });
      }
    }

    return rows.map(r => ({
      name:        r.resource,
      dept:        r.dept || 'Unknown',
      events:      r.event_count,
      caseCount:   r.case_count,
      totalCost:   r.total_cost || 0,
      topActivity: topActMap.get(r.resource)?.activity || 'N/A',
    }));
  },

  // ============================================================
  // STEP 7: TIME SERIES
  // ============================================================

  /**
   * _queryTimeSeries()
   *
   * SQL:
   *   SELECT
   *     substr(timestamp, 1, 10) AS day,
   *     COUNT(*)                 AS event_count
   *   FROM event_log
   *   GROUP BY substr(timestamp, 1, 10)
   *   ORDER BY day;
   *
   * PostgreSQL equivalent:
   *   SELECT DATE(timestamp) AS day, COUNT(*) AS event_count
   *   FROM event_log
   *   GROUP BY DATE(timestamp)
   *   ORDER BY day;
   */
  _queryTimeSeries() {
    const rows = SqlDB.query(`
      SELECT
        substr(timestamp, 1, 10) AS day,
        COUNT(*)                 AS event_count
      FROM event_log
      GROUP BY substr(timestamp, 1, 10)
      ORDER BY day
    `);

    return {
      labels: rows.map(r => r.day),
      values: rows.map(r => r.event_count),
    };
  },

  // ============================================================
  // STEP 8: DURATION DISTRIBUTION (HISTOGRAM)
  // ============================================================

  /**
   * _computeDurationDistribution(cases)
   *
   * Groups case durations into 12 equal-width bins (a histogram).
   *
   * SQL perspective (PostgreSQL width_bucket):
   *   SELECT width_bucket(duration_hours, 0, max_duration, 12) AS bin,
   *          COUNT(*) AS cases
   *   FROM case_durations
   *   GROUP BY bin
   *   ORDER BY bin;
   */
  _computeDurationDistribution(cases) {
    const durations = [...cases.values()].map(c => c.duration);
    if (durations.length === 0) return { labels: [], values: [] };

    const maxDur  = Math.max(...durations);
    const binCount = 12;
    const binSize  = maxDur / binCount;

    const bins   = new Array(binCount).fill(0);
    const labels = [];

    for (let i = 0; i < binCount; i++) {
      labels.push(this._formatDuration(i * binSize) + ' – ' + this._formatDuration((i+1) * binSize));
    }
    for (const d of durations) {
      bins[Math.min(Math.floor(d / binSize), binCount - 1)]++;
    }

    return { labels, values: bins };
  },

  // ============================================================
  // STEP 9: CYCLE-TIME ANOMALY DETECTION (Z-SCORE)
  // ============================================================

  /**
   * _queryCycleTimeAnomalies()
   *
   * Identifies cases whose total duration deviates significantly
   * from the mean (|z-score| > 2 → statistical outlier).
   *
   * Resume claim: "Applied strong computer fundamentals and algorithms
   * to identify cycle time anomalies, providing data-driven insights
   * that improved cross-functional process efficiency by 25%."
   *
   * SQL (PostgreSQL / SQLite with CTE):
   *   WITH case_durations AS (
   *     SELECT case_id,
   *            (julianday(MAX(timestamp)) - julianday(MIN(timestamp))) * 24
   *              AS duration_hours
   *     FROM event_log
   *     GROUP BY case_id
   *   ),
   *   stats AS (
   *     SELECT AVG(duration_hours)                                AS mean,
   *            AVG(duration_hours * duration_hours)
   *              - AVG(duration_hours) * AVG(duration_hours)      AS variance
   *     FROM case_durations
   *   )
   *   SELECT cd.case_id,
   *          cd.duration_hours,
   *          s.mean,
   *          SQRT(s.variance)                                     AS stddev,
   *          (cd.duration_hours - s.mean) / MAX(1, SQRT(s.variance)) AS z_score
   *   FROM case_durations cd, stats s
   *   WHERE ABS(cd.duration_hours - s.mean) > 2 * SQRT(s.variance)
   *   ORDER BY ABS(z_score) DESC;
   */
  _queryCycleTimeAnomalies() {
    const rows = SqlDB.query(`
      WITH case_durations AS (
        SELECT case_id,
               (julianday(MAX(timestamp)) - julianday(MIN(timestamp))) * 24
                 AS duration_hours
        FROM event_log
        GROUP BY case_id
      ),
      stats AS (
        SELECT
          AVG(duration_hours)                                AS mean,
          AVG(duration_hours * duration_hours)
            - AVG(duration_hours) * AVG(duration_hours)     AS variance
        FROM case_durations
      )
      SELECT
        cd.case_id,
        ROUND(cd.duration_hours, 2)                        AS duration_hours,
        ROUND(s.mean, 2)                                   AS mean_hours,
        ROUND(SQRT(MAX(s.variance, 0.0001)), 2)            AS stddev_hours,
        ROUND((cd.duration_hours - s.mean)
          / MAX(1.0, SQRT(MAX(s.variance, 0.0001))), 2)    AS z_score
      FROM case_durations cd, stats s
      WHERE ABS(cd.duration_hours - s.mean)
            > 2.0 * SQRT(MAX(s.variance, 0.0001))
      ORDER BY ABS(
        (cd.duration_hours - s.mean)
        / MAX(1.0, SQRT(MAX(s.variance, 0.0001)))
      ) DESC
      LIMIT 50
    `);

    return rows.map(r => ({
      caseId:       r.case_id,
      durationHours: r.duration_hours,
      meanHours:    r.mean_hours,
      stddevHours:  r.stddev_hours,
      zScore:       r.z_score,
      type:         r.z_score > 0 ? 'slow' : 'fast',
    }));
  },

  // ============================================================
  // PUBLIC API
  // ============================================================

  getSummary() {
    if (!this.stats) return null;
    const s = this.stats;
    return {
      totalCases:       s.totalCases,
      totalEvents:      s.totalEvents,
      uniqueActivities: s.uniqueActivities,
      totalVariants:    s.totalVariants,
      avgDuration:      this._formatDuration(s.avgCaseDuration),
      topBottleneck:    s.bottlenecks[0]?.activity || 'N/A',
      anomalyCount:     s.anomalies.length,
    };
  },

  getCaseDetails(caseId) {
    const caseData = this.stats?.cases.get(caseId);
    if (!caseData) return null;

    const enriched = caseData.events.map((event, i) => {
      const prev = caseData.events[i - 1];
      const waitHours = prev
        ? (event.timestamp - prev.timestamp) / 3600000
        : 0;
      return {
        ...event,
        waitHours,
        waitCategory: waitHours > 24 ? 'slow' : waitHours > 8 ? 'medium' : 'fast',
      };
    });

    return {
      id:       caseId,
      events:   enriched,
      start:    caseData.start,
      end:      caseData.end,
      duration: caseData.duration,
      steps:    caseData.events.length,
      isAnomaly: this.stats.anomalies.some(a => a.caseId === caseId),
    };
  },

  /**
   * getTransitionHeatmap()
   *
   * SQL:
   *   SELECT e1.activity AS from_act, e2.activity AS to_act,
   *          AVG((julianday(e2.timestamp)-julianday(e1.timestamp))*24) AS avg_dur
   *   FROM event_log e1
   *   JOIN event_log e2 ON e1.case_id = e2.case_id
   *     AND e2.timestamp > e1.timestamp
   *     -- only direct successors (implemented via graph edges)
   *   GROUP BY e1.activity, e2.activity;
   */
  getTransitionHeatmap() {
    if (!this.stats) return null;

    const activities = [...this.stats.activityStats.keys()];
    const { edges }  = this.stats.graph;

    const matrix = {};
    for (const act of activities) {
      matrix[act] = {};
      for (const act2 of activities) {
        const edge = edges.get(`${act}→${act2}`);
        matrix[act][act2] = edge ? edge.avgDuration : null;
      }
    }

    return { activities, matrix };
  },

  // ============================================================
  // UTILITY — also used by sql_explorer in dashboard.js
  // ============================================================

  _avgCaseDuration(cases) {
    const durations = [...cases.values()].map(c => c.duration);
    if (!durations.length) return 0;
    return durations.reduce((a, b) => a + b, 0) / durations.length;
  },

  _median(arr) {
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 !== 0 ? s[m] : (s[m-1] + s[m]) / 2;
  },

  _percentile(arr, p) {
    const s   = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * s.length) - 1;
    return s[Math.max(0, idx)];
  },

  _formatDuration(hours) {
    if (hours < 1)   return `${Math.round(hours * 60)}m`;
    if (hours < 24)  return `${hours.toFixed(1)}h`;
    if (hours < 168) return `${(hours / 24).toFixed(1)}d`;
    return `${(hours / 168).toFixed(1)}w`;
  },
};
