/**
 * PROCESS ENGINE — process_dashboard/static/js/process_engine.js
 * 
 * LEARN: This is the brain of our dashboard. It does what a real
 * process mining tool (Celonis, Disco) does:
 * 
 * 1. SQL-style GROUP BY queries to compute statistics
 * 2. Graph construction: nodes = activities, edges = transitions
 * 3. Bottleneck detection via waiting time analysis
 * 4. Variant discovery: find distinct paths through the process
 * 
 * All operations here mirror what you'd do in SQL + Python (pandas):
 *   JS: events.filter(e => e.case_id === id)
 *   SQL: SELECT * FROM events WHERE case_id = 'id'
 *   Python: events[events['case_id'] == id]
 */

const ProcessEngine = {

  /** Raw event log (array of event objects) */
  events: [],

  /** Computed state — updated whenever events change */
  stats: null,

  /**
   * load(events)
   * 
   * Entry point: takes raw event log and computes all analytics.
   * This is called once when data is loaded, results are cached.
   */
  load(events) {
    console.group('[ProcessEngine] Computing analytics...');
    console.time('Total analysis time');

    this.events = events;

    // Step 1: Organize events by case
    console.log('Step 1: Grouping events by case...');
    const cases = this._groupByCase(events);

    // Step 2: Compute per-activity statistics (like SQL GROUP BY activity)
    console.log('Step 2: Computing activity statistics...');
    const activityStats = this._computeActivityStats(cases);

    // Step 3: Build the process graph (nodes + edges)
    console.log('Step 3: Building process graph...');
    const graph = this._buildProcessGraph(cases);

    // Step 4: Detect bottlenecks (transitions with highest avg wait time)
    console.log('Step 4: Detecting bottlenecks...');
    const bottlenecks = this._detectBottlenecks(graph, activityStats);

    // Step 5: Discover process variants (unique paths)
    console.log('Step 5: Discovering process variants...');
    const variants = this._discoverVariants(cases);

    // Step 6: Compute resource statistics
    console.log('Step 6: Analyzing resource workload...');
    const resourceStats = this._computeResourceStats(events);

    // Step 7: Time series (events per day — for the line chart)
    console.log('Step 7: Building time series...');
    const timeSeries = this._buildTimeSeries(events);

    // Step 8: Case duration distribution (for histogram)
    console.log('Step 8: Computing duration distribution...');
    const durationDist = this._computeDurationDistribution(cases);

    console.timeEnd('Total analysis time');
    console.groupEnd();

    this.stats = {
      totalCases:       cases.size,
      totalEvents:      events.length,
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
      avgCaseDuration:  this._computeAvgCaseDuration(cases),
      happyPath:        variants[0]?.path || [],
    };

    return this.stats;
  },

  // ============================================================
  // STEP 1: GROUP BY CASE
  // ============================================================
  /**
   * _groupByCase(events)
   * 
   * LEARN: This is like SQL:
   *   SELECT case_id, ... FROM events
   *   GROUP BY case_id
   *   ORDER BY timestamp
   * 
   * Each case gets:
   *   - Sorted events (chronological order is critical!)
   *   - start/end timestamps
   *   - total duration in hours
   */
  _groupByCase(events) {
    // LEARN: Map is like a dictionary/hashmap. Key = case_id, Value = case data.
    const cases = new Map();

    for (const event of events) {
      if (!cases.has(event.case_id)) {
        cases.set(event.case_id, {
          id: event.case_id,
          events: [],
          start: null,
          end: null,
          duration: 0,
          activities: [],
        });
      }
      cases.get(event.case_id).events.push(event);
    }

    // For each case: sort events chronologically, compute start/end/duration
    for (const [caseId, caseData] of cases) {
      // SORT: Ascending by timestamp (critical for correct transition detection)
      caseData.events.sort((a, b) => a.timestamp - b.timestamp);

      caseData.start = caseData.events[0].timestamp;
      caseData.end   = caseData.events[caseData.events.length - 1].timestamp;

      // LEARN: Duration in hours = (endTime - startTime) / milliseconds_per_hour
      caseData.duration = (caseData.end - caseData.start) / (1000 * 60 * 60);

      // Extract ordered activity sequence (this defines the process variant)
      caseData.activities = caseData.events.map(e => e.activity);
    }

    return cases;
  },

  // ============================================================
  // STEP 2: ACTIVITY STATISTICS (GROUP BY activity)
  // ============================================================
  /**
   * _computeActivityStats(cases)
   * 
   * LEARN: For each activity, we compute:
   *   - frequency: how many times it occurs
   *   - avgWaitTime: average time cases spend BEFORE this activity starts
   *   - minWait / maxWait: for range analysis
   * 
   * SQL equivalent:
   *   SELECT activity, COUNT(*) as freq, AVG(wait_time) as avg_wait
   *   FROM events
   *   GROUP BY activity
   *   ORDER BY avg_wait DESC
   */
  _computeActivityStats(cases) {
    const actStats = new Map();

    for (const [caseId, caseData] of cases) {
      const caseEvents = caseData.events;

      for (let i = 0; i < caseEvents.length; i++) {
        const event = caseEvents[i];
        const activity = event.activity;

        if (!actStats.has(activity)) {
          actStats.set(activity, {
            name: activity,
            frequency: 0,
            waitTimes: [],   // Array of wait durations (hours)
            resources: new Set(),
            cases: new Set(),
          });
        }

        const stat = actStats.get(activity);
        stat.frequency++;
        stat.resources.add(event.resource);
        stat.cases.add(caseId);

        // LEARN: Wait time = time between PREVIOUS event ending and THIS event starting
        if (i > 0) {
          const prevEvent = caseEvents[i - 1];
          const waitHours = (event.timestamp - prevEvent.timestamp) / (1000 * 60 * 60);
          stat.waitTimes.push(waitHours);
        }
      }
    }

    // Compute aggregated stats for each activity
    for (const [activity, stat] of actStats) {
      const waits = stat.waitTimes;

      if (waits.length > 0) {
        // LEARN: Reduce is like SQL's SUM() — it accumulates a running total
        stat.avgWait  = waits.reduce((a, b) => a + b, 0) / waits.length;
        stat.medWait  = this._median(waits);
        stat.maxWait  = Math.max(...waits);
        stat.minWait  = Math.min(...waits);
        stat.p90Wait  = this._percentile(waits, 90);  // 90th percentile
      } else {
        stat.avgWait = stat.medWait = stat.maxWait = stat.minWait = stat.p90Wait = 0;
      }

      // Clean up raw array to save memory (keep computed stats only)
      stat.caseCount    = stat.cases.size;
      stat.resourceList = [...stat.resources];

      delete stat.cases;
      delete stat.resources;
    }

    return actStats;
  },

  // ============================================================
  // STEP 3: BUILD PROCESS GRAPH
  // ============================================================
  /**
   * _buildProcessGraph(cases)
   * 
   * LEARN: A "Directly-Follows Graph" (DFG) is the most fundamental
   * structure in process mining. It shows:
   *   - NODES: each unique activity
   *   - EDGES: A → B means "activity B directly follows activity A"
   *   - EDGE WEIGHT: how many times this transition occurred
   * 
   * This is what the visual process map is built from!
   */
  _buildProcessGraph(cases) {
    const nodes = new Map();  // activity name → node data
    const edges = new Map();  // "A→B" → edge data

    for (const [caseId, caseData] of cases) {
      const events = caseData.events;

      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const activity = event.activity;

        // Add/update node
        if (!nodes.has(activity)) {
          nodes.set(activity, {
            id: activity,
            frequency: 0,
            isStart: false,
            isEnd: false,
            cases: new Set(),
          });
        }
        const node = nodes.get(activity);
        node.frequency++;
        node.cases.add(caseId);

        // Mark first and last activities in each case
        if (i === 0) node.isStart = true;
        if (i === events.length - 1) node.isEnd = true;

        // Add/update edge (TRANSITION from previous to current)
        if (i > 0) {
          const prevActivity = events[i - 1].activity;
          const edgeKey = `${prevActivity}→${activity}`;

          if (!edges.has(edgeKey)) {
            edges.set(edgeKey, {
              source: prevActivity,
              target: activity,
              frequency: 0,
              durations: [],
            });
          }

          const edge = edges.get(edgeKey);
          edge.frequency++;

          // Duration of this specific transition
          const durationHours = (event.timestamp - events[i-1].timestamp) / (1000 * 60 * 60);
          edge.durations.push(durationHours);
        }
      }
    }

    // Compute edge statistics
    for (const [key, edge] of edges) {
      const d = edge.durations;
      edge.avgDuration = d.reduce((a, b) => a + b, 0) / d.length;
      edge.maxDuration = Math.max(...d);
      edge.p90Duration = this._percentile(d, 90);
      delete edge.durations;
    }

    // Compute case counts for nodes
    for (const [name, node] of nodes) {
      node.caseCount = node.cases.size;
      delete node.cases;
    }

    return { nodes, edges };
  },

  // ============================================================
  // STEP 4: BOTTLENECK DETECTION
  // ============================================================
  /**
   * _detectBottlenecks()
   * 
   * LEARN: A bottleneck is identified by:
   *   1. HIGH average wait time (cases spend a long time waiting)
   *   2. HIGH frequency (many cases go through this step)
   *   3. HIGH variance (some cases wait much longer than others)
   * 
   * We combine wait time and frequency into a "bottleneck score".
   * Real tools like Celonis use more sophisticated ML models,
   * but this score already reveals the main problem areas.
   */
  _detectBottlenecks(graph, activityStats) {
    const bottlenecks = [];

    // Get the maximum values for normalization (0-1 scaling)
    let maxWait = 0, maxFreq = 0;
    for (const [, stat] of activityStats) {
      maxWait = Math.max(maxWait, stat.avgWait);
      maxFreq = Math.max(maxFreq, stat.frequency);
    }

    for (const [activity, stat] of activityStats) {
      if (stat.avgWait < 0.1) continue;  // Skip near-instant activities

      // LEARN: Normalization scales values to 0-1 range for fair comparison
      const normalizedWait = stat.avgWait / maxWait;
      const normalizedFreq = stat.frequency / maxFreq;

      // Bottleneck score: weighted combination (70% wait time, 30% frequency)
      // LEARN: Weighting means wait time matters more than frequency
      const score = normalizedWait * 0.7 + normalizedFreq * 0.3;

      bottlenecks.push({
        activity,
        avgWait:    stat.avgWait,
        p90Wait:    stat.p90Wait,
        maxWait:    stat.maxWait,
        frequency:  stat.frequency,
        caseCount:  stat.caseCount,
        score:      score,
        impact:     stat.avgWait * stat.frequency,  // Total hours wasted
        severity:   score > 0.7 ? 'critical' : score > 0.4 ? 'high' : 'medium',
      });
    }

    // Sort by score descending (worst bottlenecks first)
    bottlenecks.sort((a, b) => b.score - a.score);

    return bottlenecks;
  },

  // ============================================================
  // STEP 5: VARIANT DISCOVERY
  // ============================================================
  /**
   * _discoverVariants(cases)
   * 
   * LEARN: A "process variant" is a unique sequence of activities.
   * If 60% of orders follow: A→B→C→D
   * and 30% follow:          A→C→D
   * These are two distinct variants.
   * 
   * This is like SQL:
   *   SELECT activity_sequence, COUNT(*) as freq
   *   FROM cases
   *   GROUP BY activity_sequence
   *   ORDER BY freq DESC
   */
  _discoverVariants(cases) {
    const variantMap = new Map();

    for (const [caseId, caseData] of cases) {
      // The variant "fingerprint" is the activity sequence joined as a string
      const variantKey = caseData.activities.join(' → ');

      if (!variantMap.has(variantKey)) {
        variantMap.set(variantKey, {
          path: caseData.activities,
          caseIds: [],
          frequency: 0,
          durations: [],
        });
      }

      const variant = variantMap.get(variantKey);
      variant.caseIds.push(caseId);
      variant.frequency++;
      variant.durations.push(caseData.duration);
    }

    // Convert to array and compute stats
    const variants = [...variantMap.values()].map(v => ({
      path: v.path,
      frequency: v.frequency,
      percentage: (v.frequency / cases.size * 100).toFixed(1),
      avgDuration: v.durations.reduce((a, b) => a + b, 0) / v.durations.length,
      cases: v.caseIds.slice(0, 5),  // Sample case IDs for display
    }));

    // Sort by frequency (most common variant first = likely the "happy path")
    variants.sort((a, b) => b.frequency - a.frequency);

    console.log(`[ProcessEngine] Discovered ${variants.length} distinct process variants`);
    return variants;
  },

  // ============================================================
  // STEP 6: RESOURCE STATISTICS
  // ============================================================
  _computeResourceStats(events) {
    const resourceMap = new Map();

    for (const event of events) {
      const resource = event.resource || 'Unknown';
      if (!resourceMap.has(resource)) {
        resourceMap.set(resource, {
          name: resource,
          dept: event.dept || 'Unknown',
          events: 0,
          activities: new Map(),
          cases: new Set(),
          totalCost: 0,
        });
      }

      const stat = resourceMap.get(resource);
      stat.events++;
      stat.cases.add(event.case_id);
      stat.totalCost += event.cost || 0;

      const act = event.activity;
      stat.activities.set(act, (stat.activities.get(act) || 0) + 1);
    }

    const resources = [...resourceMap.values()].map(r => ({
      ...r,
      caseCount: r.cases.size,
      topActivity: [...r.activities.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A',
      activities: Object.fromEntries(r.activities),
      cases: undefined,
    }));

    // Sort by event count descending
    resources.sort((a, b) => b.events - a.events);
    return resources;
  },

  // ============================================================
  // STEP 7: TIME SERIES (events per day)
  // ============================================================
  /**
   * _buildTimeSeries(events)
   * 
   * LEARN: This groups events by date — like SQL:
   *   SELECT DATE(timestamp) as day, COUNT(*) as events
   *   FROM events
   *   GROUP BY DATE(timestamp)
   *   ORDER BY day
   */
  _buildTimeSeries(events) {
    const dayMap = new Map();

    for (const event of events) {
      // Format date as YYYY-MM-DD (ISO date string, first 10 chars)
      const day = event.timestamp.toISOString().substring(0, 10);
      dayMap.set(day, (dayMap.get(day) || 0) + 1);
    }

    // Sort days chronologically and return as parallel arrays (for Chart.js)
    const days = [...dayMap.keys()].sort();
    return {
      labels: days,
      values: days.map(d => dayMap.get(d)),
    };
  },

  // ============================================================
  // STEP 8: DURATION DISTRIBUTION (histogram bins)
  // ============================================================
  /**
   * _computeDurationDistribution(cases)
   * 
   * LEARN: A histogram groups continuous values into "bins" (ranges).
   * For case durations: bin 0-24h, 24-48h, 48-72h, etc.
   * Height of each bar = number of cases in that range.
   */
  _computeDurationDistribution(cases) {
    const durations = [...cases.values()].map(c => c.duration);

    if (durations.length === 0) return { labels: [], values: [] };

    const maxDuration = Math.max(...durations);
    const binCount = 12;
    const binSize = maxDuration / binCount;

    const bins = new Array(binCount).fill(0);
    const labels = [];

    for (let i = 0; i < binCount; i++) {
      const binStart = i * binSize;
      const binEnd = (i + 1) * binSize;
      labels.push(this._formatDuration(binStart) + ' – ' + this._formatDuration(binEnd));
    }

    for (const d of durations) {
      const binIdx = Math.min(Math.floor(d / binSize), binCount - 1);
      bins[binIdx]++;
    }

    return { labels, values: bins };
  },

  // ============================================================
  // UTILITY FUNCTIONS
  // ============================================================

  _computeAvgCaseDuration(cases) {
    const durations = [...cases.values()].map(c => c.duration);
    if (durations.length === 0) return 0;
    return durations.reduce((a, b) => a + b, 0) / durations.length;
  },

  /** Calculate median: sort array, take middle value */
  _median(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  },

  /** Calculate percentile: p=90 → "90% of values are below this" */
  _percentile(arr, p) {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  },

  /** Format hours into human-readable string */
  _formatDuration(hours) {
    if (hours < 1)    return `${Math.round(hours * 60)}m`;
    if (hours < 24)   return `${hours.toFixed(1)}h`;
    if (hours < 168)  return `${(hours / 24).toFixed(1)}d`;
    return `${(hours / 168).toFixed(1)}w`;
  },

  /** Get computed stats summary for display */
  getSummary() {
    if (!this.stats) return null;
    const s = this.stats;
    return {
      totalCases:      s.totalCases,
      totalEvents:     s.totalEvents,
      uniqueActivities: s.uniqueActivities,
      totalVariants:   s.totalVariants,
      avgDuration:     this._formatDuration(s.avgCaseDuration),
      topBottleneck:   s.bottlenecks[0]?.activity || 'N/A',
    };
  },

  /**
   * getCaseDetails(caseId)
   * 
   * Returns all events for a specific case with wait times between steps.
   * This powers the Case Explorer timeline view.
   */
  getCaseDetails(caseId) {
    const caseData = this.stats.cases.get(caseId);
    if (!caseData) return null;

    const enriched = caseData.events.map((event, i) => {
      const prev = caseData.events[i - 1];
      const waitHours = prev
        ? (event.timestamp - prev.timestamp) / (1000 * 60 * 60)
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
    };
  },

  /**
   * getTransitionHeatmap()
   * 
   * LEARN: Creates a matrix (2D grid) showing average duration
   * between each pair of activities. This is the "transition heatmap".
   * 
   * It's like a pivot table in Excel or:
   *   SELECT from_activity, to_activity, AVG(duration)
   *   FROM transitions
   *   GROUP BY from_activity, to_activity
   */
  getTransitionHeatmap() {
    if (!this.stats) return null;

    const activities = [...this.stats.activityStats.keys()];
    const { edges } = this.stats.graph;

    // Build matrix: matrix[from][to] = avg duration
    const matrix = {};
    for (const act of activities) {
      matrix[act] = {};
      for (const act2 of activities) {
        const edgeKey = `${act}→${act2}`;
        const edge = edges.get(edgeKey);
        matrix[act][act2] = edge ? edge.avgDuration : null;
      }
    }

    return { activities, matrix };
  }
};
