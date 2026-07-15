/**
 * DASHBOARD CONTROLLER — process_dashboard/static/js/dashboard.js
 * 
 * LEARN: This is the "controller" in MVC (Model-View-Controller) pattern:
 *   - Model: ProcessEngine (data & analytics)
 *   - View: HTML + CSS
 *   - Controller: THIS FILE — responds to user actions, updates the view
 * 
 * Key concepts used:
 *   - Event Listeners: React to user clicks/input
 *   - DOM Manipulation: Update HTML content dynamically
 *   - Chart.js: Render bar charts, line charts, histograms
 *   - State management: Track which view is active, what data is loaded
 */

// ============================================================
// GLOBAL STATE
// LEARN: State = current data + UI state of the app
// ============================================================
const State = {
  dataLoaded: false,
  currentView: 'upload',
  charts: {},           // Stores Chart.js instances (to destroy before re-rendering)
  stats: null,          // Cached ProcessEngine.stats
  counterRAFs: {},      // perf: tracks active requestAnimationFrame IDs per element
  lastCaseSort: null,   // perf: memoize last sort key to skip redundant re-renders
};

// ============================================================
// INITIALIZATION
// LEARN: DOMContentLoaded fires when HTML is fully parsed.
// Always initialize JS after the DOM is ready.
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Dashboard] Initializing ProcessMind...');

  initNavigation();
  initUpload();
  initMapControls();
  initCaseExplorer();

  // Start on upload view
  switchView('upload');

  console.log('[Dashboard] Ready. Click "Load Sample Data" to begin.');
});

// ============================================================
// NAVIGATION
// ============================================================
function initNavigation() {
  // perf: use event delegation on the sidebar container instead of attaching
  // individual listeners to every .nav-item — fewer event handler objects.
  const sidebar = document.querySelector('.sidebar') || document;
  sidebar.addEventListener('click', (e) => {
    const item = e.target.closest('.nav-item');
    if (!item) return;
    e.preventDefault();

    const view = item.dataset.view;  // Read data-view attribute

    if (view !== 'upload' && !State.dataLoaded) {
      showNoDataMessage();
      return;
    }

    switchView(view);
  });

  // Top-bar "Load Sample Data" button
  document.getElementById('loadSampleBtn')?.addEventListener('click', loadSampleData);
}

/**
 * switchView(viewName)
 * 
 * LEARN: This implements a "single-page app" navigation.
 * Instead of loading a new page, we just:
 *   1. Hide all sections
 *   2. Show only the requested section
 *   3. Update active state on sidebar links
 */
function switchView(viewName) {
  // Hide all views
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  // Show requested view
  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) {
    targetView.classList.add('active');
  }

  // Update nav item active state
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === viewName);
  });

  // Update page title
  const titles = {
    'upload':      ['Load Event Log',       'Import your business process data'],
    'overview':    ['Overview',              'Key metrics and trends at a glance'],
    'process-map': ['Process Map',           'Interactive flow diagram of your process'],
    'bottlenecks': ['Bottleneck Analysis',   'Identify where your process slows down'],
    'cases':       ['Case Explorer',         'Drill into individual process instances'],
    'resources':   ['Resource Analysis',     'Workload distribution across your team'],
  };

  const [title, subtitle] = titles[viewName] || ['Dashboard', ''];
  document.getElementById('pageTitle').textContent = title;
  document.getElementById('pageSubtitle').textContent = subtitle;

  // perf: bail early if we are already on this view — avoids redundant chart
  // destruction / recreation cycles when the user clicks the active nav item.
  if (State.currentView === viewName && State.dataLoaded) return;

  State.currentView = viewName;

  // Render the active view if data is available
  if (State.dataLoaded) {
    renderCurrentView(viewName);
  }
}

/**
 * renderCurrentView(viewName)
 * 
 * Dispatches to the appropriate render function for each view.
 * LEARN: This "lazy rendering" pattern only builds the view when needed,
 * saving computation on views the user hasn't visited.
 */
function renderCurrentView(viewName) {
  switch (viewName) {
    case 'overview':    renderOverview();    break;
    case 'process-map': renderProcessMap(); break;
    case 'bottlenecks': renderBottlenecks(); break;
    case 'cases':       renderCaseExplorer(); break;
    case 'resources':   renderResources();  break;
  }
}

// ============================================================
// DATA LOADING
// ============================================================

/**
 * loadSampleData()
 * 
 * LEARN: async/await makes asynchronous code read like synchronous code.
 * We await the loading animation steps so the user sees progress.
 */
async function loadSampleData() {
  showLoading('Generating sample event log...');

  try {
    await updateLoadingStep('Generating 500 order cases...', 0);
    // Generate in a "microtask" so the UI can update (setTimeout trick)
    await sleep(50);

    const events = DataGenerator.generateEventLog(500);

    await updateLoadingStep('Running SQL-style aggregations...', 1);
    await sleep(80);

    await updateLoadingStep('Building process graph...', 2);
    await sleep(80);

    await updateLoadingStep('Detecting bottlenecks...', 3);
    await sleep(80);

    const stats = ProcessEngine.load(events);

    await updateLoadingStep('Discovering process variants...', 4);
    await sleep(60);

    State.stats = stats;
    State.dataLoaded = true;

    // Update sidebar status indicator
    document.querySelector('.status-dot').className = 'status-dot active';
    document.querySelector('.data-status span').textContent =
      `${stats.totalCases.toLocaleString()} cases loaded`;

    hideLoading();

    // Navigate to overview
    switchView('overview');

  } catch (err) {
    hideLoading();
    console.error('[Dashboard] Error loading data:', err);
    alert(`Error: ${err.message}`);
  }
}

// ============================================================
// FILE UPLOAD (CSV)
// ============================================================
function initUpload() {
  const zone    = document.getElementById('uploadZone');
  const fileInput = document.getElementById('fileInput');
  const loadBtn2  = document.getElementById('loadSampleBtn2');

  loadBtn2?.addEventListener('click', loadSampleData);

  // LEARN: Drag & Drop API — browser fires dragover/drop events
  zone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });

  zone?.addEventListener('dragleave', () => zone.classList.remove('dragover'));

  zone?.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) processCSVFile(file);
  });

  zone?.addEventListener('click', () => fileInput.click());

  fileInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) processCSVFile(file);
  });
}

async function processCSVFile(file) {
  showLoading(`Parsing ${file.name}...`);

  try {
    // LEARN: FileReader reads file contents. readAsText() gives us the CSV string.
    const text = await readFileAsText(file);

    await updateLoadingStep('Parsing CSV...', 0);
    await sleep(50);

    const events = DataGenerator.parseCSV(text);

    await updateLoadingStep('Analyzing process flows...', 1);
    await sleep(100);

    const stats = ProcessEngine.load(events);

    State.stats = stats;
    State.dataLoaded = true;

    document.querySelector('.status-dot').className = 'status-dot active';
    document.querySelector('.data-status span').textContent =
      `${stats.totalCases.toLocaleString()} cases loaded`;

    hideLoading();
    switchView('overview');

  } catch (err) {
    hideLoading();
    console.error('[Dashboard] CSV error:', err);
    alert(`CSV Error: ${err.message}`);
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

// ============================================================
// OVERVIEW VIEW: KPI CARDS + CHARTS
// ============================================================
function renderOverview() {
  if (!State.stats) return;
  const { stats } = State;
  const summary = ProcessEngine.getSummary();

  // ---------- KPI Cards ----------
  animateCounter('kpiTotalCases',    stats.totalCases);
  animateCounter('kpiTotalEvents',   stats.totalEvents);
  animateCounter('kpiActivities',    stats.uniqueActivities);
  animateCounter('kpiVariants',      stats.totalVariants);

  document.getElementById('kpiAvgDuration').textContent = summary.avgDuration;
  document.getElementById('kpiBottleneckActivity').textContent =
    summary.topBottleneck.length > 12
      ? summary.topBottleneck.slice(0, 12) + '…'
      : summary.topBottleneck;

  // ---------- Chart 1: Cases Over Time (Line Chart) ----------
  renderLineChart('chartCasesOverTime', stats.timeSeries.labels, stats.timeSeries.values, {
    label: 'Events per Day',
    color: '#4f8ef7',
  });

  // ---------- Chart 2: Activity Frequency (Horizontal Bar) ----------
  const actEntries = [...stats.activityStats.entries()]
    .sort((a, b) => b[1].frequency - a[1].frequency);

  renderBarChart('chartActivityFreq',
    actEntries.map(([name]) => name),
    actEntries.map(([, s]) => s.frequency),
    { label: 'Occurrences', color: '#8b5cf6', horizontal: true }
  );

  // ---------- Chart 3: Duration Distribution (Histogram) ----------
  renderBarChart('chartDurationDist',
    stats.durationDist.labels,
    stats.durationDist.values,
    { label: 'Cases', color: '#00d4ff' }
  );

  // ---------- Chart 4: Avg Wait Time per Activity ----------
  const sortedWait = [...stats.activityStats.entries()]
    .filter(([, s]) => s.avgWait > 0)
    .sort((a, b) => b[1].avgWait - a[1].avgWait);

  const waitColors = sortedWait.map(([, s]) => {
    const maxWait = sortedWait[0][1].avgWait;
    const ratio = s.avgWait / maxWait;
    return ratio > 0.6 ? '#ef4444' : ratio > 0.35 ? '#f59e0b' : '#10b981';
  });

  renderBarChart('chartWaitTime',
    sortedWait.map(([name]) => name),
    sortedWait.map(([, s]) => parseFloat(s.avgWait.toFixed(2))),
    { label: 'Avg Wait (hours)', colors: waitColors, horizontal: true }
  );
}

// ============================================================
// PROCESS MAP VIEW
// ============================================================
function renderProcessMap() {
  if (!State.stats) return;

  const minFreq = parseInt(document.getElementById('edgeFreqSlider').value) || 1;
  const colorBy = document.getElementById('colorBySelect').value;

  ProcessMap.render(State.stats.graph, State.stats.activityStats, {
    minEdgeFreq: minFreq,
    colorBy: colorBy,
  });
}

function initMapControls() {
  const slider = document.getElementById('edgeFreqSlider');
  const sliderVal = document.getElementById('edgeFreqValue');

  slider?.addEventListener('input', () => {
    sliderVal.textContent = slider.value;
    if (State.dataLoaded && State.currentView === 'process-map') {
      renderProcessMap();
    }
  });

  document.getElementById('colorBySelect')?.addEventListener('change', () => {
    if (State.dataLoaded && State.currentView === 'process-map') {
      renderProcessMap();
    }
  });

  document.getElementById('resetMapBtn')?.addEventListener('click', () => ProcessMap.reset());
  document.getElementById('fitMapBtn')?.addEventListener('click', () => {
    const svg = document.getElementById('processMapSVG');
    ProcessMap.fitView(svg.clientWidth, svg.clientHeight, ProcessMap.g?._groups?.[0]?.[0] ? new Map() : new Map());
    renderProcessMap();
  });
}

// ============================================================
// BOTTLENECK VIEW
// ============================================================
function renderBottlenecks() {
  if (!State.stats) return;
  const { bottlenecks, activityStats } = State.stats;

  // ---------- Bottleneck Cards ----------
  const grid = document.getElementById('bottleneckGrid');
  const top6 = bottlenecks.slice(0, 6);

  grid.innerHTML = top6.map((b, i) => `
    <div class="bottleneck-card" style="animation-delay:${i * 0.08}s">
      <div class="bottleneck-rank">#${i+1} ${b.severity.toUpperCase()} BOTTLENECK</div>
      <div class="bottleneck-name">${b.activity}</div>
      
      <div class="bottleneck-metric">
        <span class="bottleneck-metric-label">Avg Wait Time</span>
        <span class="bottleneck-metric-value" style="color:#ef4444">${b.avgWait.toFixed(1)}h</span>
      </div>
      <div class="bottleneck-metric">
        <span class="bottleneck-metric-label">90th Percentile</span>
        <span class="bottleneck-metric-value" style="color:#f59e0b">${b.p90Wait.toFixed(1)}h</span>
      </div>
      <div class="bottleneck-metric">
        <span class="bottleneck-metric-label">Max Wait Time</span>
        <span class="bottleneck-metric-value">${b.maxWait.toFixed(1)}h</span>
      </div>
      <div class="bottleneck-metric">
        <span class="bottleneck-metric-label">Affected Cases</span>
        <span class="bottleneck-metric-value">${b.caseCount.toLocaleString()}</span>
      </div>
      <div class="bottleneck-metric">
        <span class="bottleneck-metric-label">Total Hours Lost</span>
        <span class="bottleneck-metric-value" style="color:#ef4444">${Math.round(b.impact).toLocaleString()}h</span>
      </div>
      
      <div class="severity-bar">
        <div class="severity-fill" style="width:${(b.score * 100).toFixed(0)}%"></div>
      </div>
      <div style="font-size:0.7rem;color:#4a5568;text-align:right;margin-top:2px;">
        Bottleneck Score: ${(b.score * 100).toFixed(0)}%
      </div>
    </div>
  `).join('');

  // ---------- Transition Heatmap ----------
  renderTransitionHeatmap();

  // ---------- Rework Detection Chart ----------
  renderReworkChart();
}

function renderTransitionHeatmap() {
  const heatmapData = ProcessEngine.getTransitionHeatmap();
  if (!heatmapData) return;

  const { activities, matrix } = heatmapData;

  // Find max duration for color scaling
  let maxVal = 0;
  for (const from of activities) {
    for (const to of activities) {
      if (matrix[from][to] !== null) maxVal = Math.max(maxVal, matrix[from][to]);
    }
  }

  // Build HTML table
  let html = '<table class="heatmap-table"><thead><tr><th>FROM \\ TO</th>';
  for (const act of activities) {
    html += `<th title="${act}">${act.split(' ')[0]}</th>`;  // Abbreviated column headers
  }
  html += '</tr></thead><tbody>';

  for (const from of activities) {
    html += `<tr><td style="color:#8892a4;text-align:left;padding:6px 10px;font-size:0.72rem;white-space:nowrap;">${from}</td>`;
    for (const to of activities) {
      const val = matrix[from][to];
      if (val === null) {
        html += `<td style="background:rgba(255,255,255,0.02);color:#2a3040;">—</td>`;
      } else {
        const intensity = maxVal > 0 ? val / maxVal : 0;
        // Color: low = dark blue, high = bright red
        const alpha = 0.1 + intensity * 0.85;
        const r = Math.round(10  + intensity * 229);
        const g = Math.round(50  - intensity * 50);
        const b = Math.round(130 - intensity * 130);
        const textColor = intensity > 0.5 ? '#ffffff' : '#8892a4';

        html += `<td style="background:rgba(${r},${g},${b},${alpha});color:${textColor};" 
                     title="${from} → ${to}: ${val.toFixed(1)}h avg">${val.toFixed(0)}h</td>`;
      }
    }
    html += '</tr>';
  }

  html += '</tbody></table>';
  document.getElementById('heatmapContainer').innerHTML = html;
}

function renderReworkChart() {
  // LEARN: "Rework" = same activity appears more than once in a case.
  // This indicates errors, re-approvals, or loops in the process.
  if (!State.stats) return;

  const reworkCounts = new Map();

  for (const [, caseData] of State.stats.cases) {
    const seen = new Map();
    for (const act of caseData.activities) {
      seen.set(act, (seen.get(act) || 0) + 1);
    }
    for (const [act, count] of seen) {
      if (count > 1) {
        reworkCounts.set(act, (reworkCounts.get(act) || 0) + (count - 1));
      }
    }
  }

  if (reworkCounts.size === 0) {
    document.getElementById('chartRework').parentElement.innerHTML +=
      '<div class="no-data" style="height:200px;"><div class="no-data-icon">✅</div><p>No rework detected!</p></div>';
    return;
  }

  const sorted = [...reworkCounts.entries()].sort((a, b) => b[1] - a[1]);
  renderBarChart('chartRework',
    sorted.map(([name]) => name),
    sorted.map(([, count]) => count),
    { label: 'Rework Occurrences', color: '#f59e0b', horizontal: true }
  );
}

// ============================================================
// CASE EXPLORER VIEW
// ============================================================
function initCaseExplorer() {
  const searchInput = document.getElementById('caseSearch');
  searchInput?.addEventListener('input', () => {
    filterCaseList(searchInput.value);
  });

  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (State.dataLoaded) renderCaseExplorer(btn.dataset.sort);
    });
  });
}

function renderCaseExplorer(sortBy = 'duration-desc') {
  if (!State.stats) return;

  // perf: skip the sort + DOM rebuild when the sort key hasn't changed
  if (State.lastCaseSort === sortBy && document.getElementById('caseList').childElementCount > 0) return;
  State.lastCaseSort = sortBy;

  let cases = [...State.stats.cases.values()];

  // LEARN: Array.sort() with a comparator function
  switch (sortBy) {
    case 'duration-desc': cases.sort((a, b) => b.duration - a.duration); break;
    case 'duration-asc':  cases.sort((a, b) => a.duration - b.duration); break;
    case 'events-desc':   cases.sort((a, b) => b.events.length - a.events.length); break;
  }

  // Compute max duration for color scaling
  const maxDuration = cases[0]?.duration || 1;

  const list = document.getElementById('caseList');

  // perf: build all markup as one string then set innerHTML once to minimise
  // layout thrashing from repeated DOM mutations.
  list.innerHTML = cases.slice(0, 200).map(c => {
    const ratio = c.duration / maxDuration;
    const dotColor = ratio > 0.7 ? '#ef4444' : ratio > 0.4 ? '#f59e0b' : '#10b981';

    return `
      <div class="case-item" data-case-id="${c.id}" onclick="showCaseDetail('${c.id}')">
        <div class="case-duration-dot" style="background:${dotColor};box-shadow:0 0 6px ${dotColor}40;"></div>
        <div class="case-item-id">${c.id}</div>
        <div class="case-item-steps">${c.events.length} steps</div>
        <div class="case-item-duration">${formatDuration(c.duration)}</div>
      </div>
    `;
  }).join('');
}

// perf: debounce so DOM mutations only happen after the user pauses typing
// rather than on every single keystroke (avoids expensive style recalcs).
const filterCaseList = (() => {
  let _timer = null;
  return function filterCaseList(query) {
    clearTimeout(_timer);
    _timer = setTimeout(() => {
      const lowerQ = query.toLowerCase();
      document.querySelectorAll('.case-item').forEach(item => {
        const id = item.dataset.caseId || '';
        item.style.display = id.toLowerCase().includes(lowerQ) ? '' : 'none';
      });
    }, 120); // 120 ms debounce — fast enough to feel instant
  };
})();

function showCaseDetail(caseId) {
  // Update active state in list
  document.querySelectorAll('.case-item').forEach(item => {
    item.classList.toggle('active', item.dataset.caseId === caseId);
  });

  const detail = ProcessEngine.getCaseDetails(caseId);
  if (!detail) return;

  const panel = document.getElementById('caseDetailPanel');

  panel.innerHTML = `
    <div class="case-detail-header">
      <div class="case-detail-id">${detail.id}</div>
      <div class="case-detail-badges">
        <span class="badge badge-blue">${detail.steps} steps</span>
        <span class="badge badge-orange">${formatDuration(detail.duration)}</span>
        <span class="badge badge-green">${formatDate(detail.start)}</span>
      </div>
    </div>

    <h3 style="margin-bottom:16px;color:#8892a4;font-size:0.85rem;font-weight:500;">PROCESS TIMELINE</h3>

    <div class="case-timeline">
      ${detail.events.map((event, i) => `
        <div class="timeline-event" style="animation-delay:${i * 0.05}s">
          <div class="timeline-dot" style="border-color:${getActivityColor(event.waitCategory)}"></div>
          <div class="timeline-card">
            <div class="timeline-activity">${event.activity}</div>
            <div class="timeline-meta">
              <span>📅 ${formatDateTime(event.timestamp)}</span>
              <span>👤 ${event.resource}</span>
              ${event.cost > 0 ? `<span>💰 $${event.cost}</span>` : ''}
            </div>
            ${event.waitHours > 0 ? `
              <div class="timeline-wait ${event.waitCategory}">
                ⏳ ${formatDuration(event.waitHours)} waiting before this step
                ${event.waitCategory === 'slow' ? ' ⚠️ BOTTLENECK' : ''}
              </div>
            ` : '<div class="timeline-wait fast">▶ Process Start</div>'}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function getActivityColor(category) {
  return { slow: '#ef4444', medium: '#f59e0b', fast: '#10b981' }[category] || '#4f8ef7';
}

// ============================================================
// RESOURCES VIEW
// ============================================================
function renderResources() {
  if (!State.stats) return;
  const { resourceStats } = State.stats;

  const maxEvents = resourceStats[0]?.events || 1;
  const avatarColors = ['#4f8ef7', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#00d4ff'];

  // Resource cards
  const grid = document.getElementById('resourceGrid');
  grid.innerHTML = resourceStats.slice(0, 8).map((r, i) => {
    const loadPct = (r.events / maxEvents * 100).toFixed(0);
    const initials = r.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const color = avatarColors[i % avatarColors.length];
    const loadColor = loadPct > 70 ? '#ef4444' : loadPct > 40 ? '#f59e0b' : '#10b981';

    return `
      <div class="resource-card">
        <div class="resource-avatar" style="background:${color}20;color:${color};border:2px solid ${color}40;">
          ${initials}
        </div>
        <div class="resource-name">${r.name}</div>
        <div style="font-size:0.75rem;color:#8892a4;margin-bottom:8px;">${r.dept}</div>
        <div class="resource-events">${r.events.toLocaleString()}</div>
        <div style="font-size:0.7rem;color:#4a5568;">events</div>
        <div class="resource-load-bar">
          <div class="resource-load-fill" style="width:${loadPct}%;background:${loadColor};"></div>
        </div>
        <div class="resource-label">Workload: ${loadPct}%</div>
        <div style="font-size:0.72rem;color:#4a5568;margin-top:6px;">
          Main: ${r.topActivity}
        </div>
      </div>
    `;
  }).join('');

  // Events per resource bar chart
  renderBarChart('chartResourceLoad',
    resourceStats.slice(0, 10).map(r => r.name.split(' ')[0]),
    resourceStats.slice(0, 10).map(r => r.events),
    { label: 'Total Events', color: '#4f8ef7', horizontal: true }
  );

  // Resource × Activity matrix
  renderResourceMatrix(resourceStats.slice(0, 6));
}

function renderResourceMatrix(resources) {
  // Get all unique activities across these resources
  const allActivities = new Set();
  resources.forEach(r => Object.keys(r.activities).forEach(a => allActivities.add(a)));
  const activities = [...allActivities];

  const maxVal = Math.max(...resources.flatMap(r => Object.values(r.activities)));

  let html = `
    <table class="resource-matrix">
      <thead>
        <tr>
          <th style="text-align:left;">Resource</th>
          ${activities.map(a => `<th title="${a}">${a.split(' ')[0]}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${resources.map(r => `
          <tr>
            <td style="text-align:left;color:#8892a4;white-space:nowrap;padding:5px 10px;">${r.name.split(' ')[0]}</td>
            ${activities.map(a => {
              const val = r.activities[a] || 0;
              const intensity = maxVal > 0 ? val / maxVal : 0;
              const alpha = val > 0 ? 0.1 + intensity * 0.8 : 0;
              return `<td style="background:rgba(79,142,247,${alpha});color:${val > 0 ? '#e8ecf4' : '#2a3040'};">
                ${val > 0 ? val : '—'}
              </td>`;
            }).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  document.getElementById('resourceMatrixContainer').innerHTML = html;
}

// ============================================================
// CHART RENDERING (Chart.js wrappers)
// ============================================================

/**
 * LEARN: Chart.js requires you to destroy a chart before re-creating it
 * on the same canvas. We store chart instances in State.charts for this.
 */
function renderLineChart(canvasId, labels, data, opts = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  if (State.charts[canvasId]) {
    State.charts[canvasId].destroy();
  }

  State.charts[canvasId] = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: opts.label || 'Value',
        data,
        borderColor: opts.color || '#4f8ef7',
        backgroundColor: opts.color ? opts.color + '18' : '#4f8ef718',
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.4,
        fill: true,
      }]
    },
    options: chartDefaults(opts)
  });
}

function renderBarChart(canvasId, labels, data, opts = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  if (State.charts[canvasId]) {
    State.charts[canvasId].destroy();
  }

  State.charts[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: opts.label || 'Value',
        data,
        backgroundColor: opts.colors || (opts.color ? opts.color + 'cc' : '#4f8ef7cc'),
        borderColor: opts.colors || opts.color || '#4f8ef7',
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      ...chartDefaults(opts),
      indexAxis: opts.horizontal ? 'y' : 'x',
    }
  });
}

/**
 * chartDefaults(opts)
 * 
 * LEARN: Chart.js "options" object controls everything about how a chart
 * looks. We set consistent defaults to match our dark theme.
 */
function chartDefaults(opts = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    // resizeDelay prevents Chart.js from entering a resize feedback loop
    // where it keeps measuring a growing container and re-drawing
    resizeDelay: 200,
    animation: { duration: 600, easing: 'easeOutQuart' },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(10,13,20,0.95)',
        titleColor: '#e8ecf4',
        bodyColor: '#8892a4',
        borderColor: 'rgba(79,142,247,0.3)',
        borderWidth: 1,
        padding: 10,
        displayColors: false,
      }
    },
    scales: {
      x: {
        grid:  { color: 'rgba(255,255,255,0.04)', drawBorder: false },
        ticks: { color: '#4a5568', font: { size: 10, family: 'Inter' }, maxRotation: 45 }
      },
      y: {
        grid:  { color: 'rgba(255,255,255,0.04)', drawBorder: false },
        ticks: { color: '#4a5568', font: { size: 10, family: 'Inter' } }
      }
    }
  };
}

// ============================================================
// LOADING OVERLAY
// ============================================================
const LOADING_STEPS = [
  'Generating event data...',
  'Running SQL aggregations...',
  'Building process graph...',
  'Detecting bottlenecks...',
  'Discovering variants...',
];

function showLoading(msg = 'Analyzing...') {
  const overlay = document.getElementById('loadingOverlay');
  document.getElementById('loadingMsg').textContent = msg;

  const stepsEl = document.getElementById('loadingSteps');
  stepsEl.innerHTML = LOADING_STEPS.map((s, i) =>
    `<div class="loading-step" id="lstep-${i}">⬜ ${s}</div>`
  ).join('');

  overlay.style.display = 'flex';
}

async function updateLoadingStep(msg, stepIdx) {
  document.getElementById('loadingMsg').textContent = msg;

  // Mark previous steps as done
  for (let i = 0; i < stepIdx; i++) {
    const el = document.getElementById(`lstep-${i}`);
    if (el) {
      el.textContent = `✅ ${LOADING_STEPS[i]}`;
      el.className = 'loading-step done';
    }
  }

  // Mark current step as active
  const current = document.getElementById(`lstep-${stepIdx}`);
  if (current) {
    current.textContent = `⚡ ${LOADING_STEPS[stepIdx]}`;
    current.className = 'loading-step active';
  }

  return sleep(10);
}

function hideLoading() {
  document.getElementById('loadingOverlay').style.display = 'none';
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * animateCounter(elementId, targetValue)
 * 
 * LEARN: requestAnimationFrame creates smooth 60fps animations.
 * We interpolate the number from 0 to target over ~600ms.
 */
function animateCounter(elementId, target) {
  const el = document.getElementById(elementId);
  if (!el) return;

  // perf: cancel any in-flight animation on this element before starting a
  // new one — prevents multiple overlapping RAF loops writing to the same node.
  if (State.counterRAFs[elementId]) {
    cancelAnimationFrame(State.counterRAFs[elementId]);
  }

  const duration = 800;
  const start = performance.now();
  const startVal = 0;

  const tick = (now) => {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // easeOutQuart easing for snappy feel
    const eased = 1 - Math.pow(1 - progress, 4);
    const current = Math.round(startVal + (target - startVal) * eased);

    el.textContent = current.toLocaleString();

    if (progress < 1) {
      State.counterRAFs[elementId] = requestAnimationFrame(tick);
    } else {
      delete State.counterRAFs[elementId];
    }
  };

  State.counterRAFs[elementId] = requestAnimationFrame(tick);
}

function formatDuration(hours) {
  if (hours < 1)   return `${Math.round(hours * 60)}m`;
  if (hours < 24)  return `${hours.toFixed(1)}h`;
  if (hours < 168) return `${(hours / 24).toFixed(1)}d`;
  return `${(hours / 168).toFixed(1)}w`;
}

function formatDate(date) {
  return date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
}

function formatDateTime(date) {
  return date ? date.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }) : 'N/A';
}

function showNoDataMessage() {
  // Flash the "Load Sample Data" button to guide user
  const btn = document.getElementById('loadSampleBtn');
  if (btn) {
    btn.style.animation = 'none';
    btn.style.boxShadow = '0 0 30px rgba(79,142,247,0.8)';
    setTimeout(() => { btn.style.boxShadow = ''; }, 1200);
  }

  // Navigate to upload view
  switchView('upload');
}
