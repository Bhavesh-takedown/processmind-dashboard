/**
 * PROCESS MAP — process_dashboard/static/js/process_map.js
 * 
 * LEARN: This renders the "Directly-Follows Graph" (DFG) as an
 * interactive SVG diagram using D3.js.
 * 
 * D3.js is the industry-standard library for data visualizations.
 * It uses a "data join" pattern:
 *   1. Bind data to DOM elements
 *   2. Enter: create elements for new data
 *   3. Update: modify existing elements
 *   4. Exit: remove elements for removed data
 * 
 * The layout algorithm: Layered Graph Layout (Sugiyama style)
 *   - Group activities into "layers" (columns)
 *   - Layer = order in which activities typically occur
 *   - Minimize edge crossings
 */

const ProcessMap = {

  svg: null,
  g: null,         // Main group (for zoom/pan)
  zoom: null,
  nodes: [],
  edges: [],
  colorBy: 'frequency',
  minEdgeFreq: 1,

  /**
   * render(graphData, activityStats, options)
   * 
   * Main entry point. Takes the graph computed by ProcessEngine
   * and renders it as an interactive SVG.
   */
  render(graphData, activityStats, options = {}) {
    this.colorBy = options.colorBy || 'frequency';
    this.minEdgeFreq = options.minEdgeFreq || 1;

    const container = document.getElementById('processMapSVG');
    if (!container) return;

    const width  = container.clientWidth  || 900;
    const height = container.clientHeight || 500;

    // Clear previous render
    d3.select('#processMapSVG').selectAll('*').remove();

    this.svg = d3.select('#processMapSVG');

    // LEARN: Define an arrowhead marker — reused by all edges
    const defs = this.svg.append('defs');
    defs.append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '0 -4 8 8')
      .attr('refX', 8).attr('refY', 0)
      .attr('markerWidth', 6).attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
        .attr('d', 'M0,-4L8,0L0,4')
        .attr('fill', '#4f8ef7')
        .attr('opacity', 0.8);

    // Add bottleneck arrowhead variant
    defs.append('marker')
      .attr('id', 'arrowhead-red')
      .attr('viewBox', '0 -4 8 8')
      .attr('refX', 8).attr('refY', 0)
      .attr('markerWidth', 6).attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
        .attr('d', 'M0,-4L8,0L0,4')
        .attr('fill', '#ef4444')
        .attr('opacity', 0.8);

    // Main group — all content goes here for zoom/pan to work
    this.g = this.svg.append('g').attr('class', 'pm-main-group');

    // Setup zoom & pan behavior
    // LEARN: D3's zoom allows users to scroll to zoom and drag to pan
    this.zoom = d3.zoom()
      .scaleExtent([0.2, 3])
      .on('zoom', (event) => {
        this.g.attr('transform', event.transform);
      });

    this.svg.call(this.zoom);

    // Prepare graph data
    const filteredEdges = this._filterEdges(graphData.edges);
    const nodePositions = this._computeLayout(graphData.nodes, filteredEdges, width, height);

    this._renderEdges(filteredEdges, nodePositions, activityStats);
    this._renderNodes(graphData.nodes, nodePositions, activityStats);

    // Update stat pills below the map
    this._updateStats(graphData, activityStats);

    // Auto-fit the view
    this.fitView(width, height, nodePositions);
  },

  /**
   * _filterEdges(edges)
   * 
   * Filters edges below the minimum frequency threshold.
   * This is the slider control on the process map toolbar.
   */
  _filterEdges(edges) {
    const result = [];
    for (const [key, edge] of edges) {
      if (edge.frequency >= this.minEdgeFreq) {
        result.push({ ...edge, key });
      }
    }
    return result;
  },

  /**
   * _computeLayout(nodes, edges, width, height)
   * 
   * LEARN: Graph layout is NP-hard in general, but we use a simple
   * "topological sort" approach:
   *   1. Find which activities have no incoming edges → put in layer 0
   *   2. Their successors go in layer 1, and so on
   *   3. Within each layer, space nodes evenly vertically
   * 
   * This creates a left-to-right flow that mirrors the process timeline.
   */
  _computeLayout(nodes, edges, width, height) {
    const positions = new Map();
    const layers = new Map();
    const edgeSet = new Set(edges.map(e => `${e.source}→${e.target}`));

    // Count incoming edges for each node (needed for topological sort)
    const inDegree = new Map();
    for (const [name] of nodes) inDegree.set(name, 0);
    for (const edge of edges) {
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    }

    // Topological sort: BFS approach
    // LEARN: BFS = Breadth-First Search — processes nodes layer by layer
    const queue = [];
    const nodeLayer = new Map();

    // Start with nodes that have no incoming edges (layer 0)
    for (const [name, deg] of inDegree) {
      if (deg === 0) {
        queue.push(name);
        nodeLayer.set(name, 0);
      }
    }

    // Build adjacency list for forward traversal
    const adjList = new Map();
    for (const [name] of nodes) adjList.set(name, []);
    for (const edge of edges) {
      if (adjList.has(edge.source)) {
        adjList.get(edge.source).push(edge.target);
      }
    }

    while (queue.length > 0) {
      const current = queue.shift();
      const currentLayer = nodeLayer.get(current) || 0;

      const successors = adjList.get(current) || [];
      for (const next of successors) {
        const nextLayer = Math.max(nodeLayer.get(next) || 0, currentLayer + 1);
        nodeLayer.set(next, nextLayer);

        inDegree.set(next, (inDegree.get(next) || 1) - 1);
        if (inDegree.get(next) <= 0) {
          queue.push(next);
        }
      }
    }

    // Assign any remaining nodes (if disconnected) to a layer
    for (const [name] of nodes) {
      if (!nodeLayer.has(name)) nodeLayer.set(name, 0);
    }

    // Group nodes by layer
    const layerGroups = new Map();
    for (const [name, layer] of nodeLayer) {
      if (!layerGroups.has(layer)) layerGroups.set(layer, []);
      layerGroups.get(layer).push(name);
    }

    const numLayers = Math.max(...layerGroups.keys()) + 1;
    const padding = { x: 80, y: 60 };
    const nodeW = 160, nodeH = 48;

    // LEARN: Spacing formula — evenly distribute across available width
    const layerSpacing = Math.max(200, (width - padding.x * 2) / Math.max(1, numLayers - 1));

    for (const [layer, nodeNames] of layerGroups) {
      const nodesInLayer = nodeNames.length;
      const totalHeight = nodesInLayer * (nodeH + 20) - 20;
      const startY = (height - totalHeight) / 2;

      nodeNames.forEach((name, idx) => {
        positions.set(name, {
          x: padding.x + layer * layerSpacing,
          y: startY + idx * (nodeH + 20),
          w: nodeW,
          h: nodeH,
          layer,
        });
      });
    }

    return positions;
  },

  /**
   * _renderEdges(edges, positions, activityStats)
   * 
   * LEARN: Curved Bezier paths make the diagram easier to read.
   * Each edge connects the right side of source node to left side of target.
   * Edge thickness = how many cases take this path (frequency).
   * Edge color = how slow this transition is.
   */
  _renderEdges(edges, positions, activityStats) {
    const maxFreq = Math.max(...edges.map(e => e.frequency));
    const maxDuration = Math.max(...edges.map(e => e.avgDuration));

    const edgeGroup = this.g.append('g').attr('class', 'pm-edges');

    const tooltip = document.getElementById('mapTooltip');

    for (const edge of edges) {
      const src = positions.get(edge.source);
      const tgt = positions.get(edge.target);
      if (!src || !tgt) continue;

      // Edge endpoints: right-center of source, left-center of target
      const x1 = src.x + src.w;
      const y1 = src.y + src.h / 2;
      const x2 = tgt.x;
      const y2 = tgt.y + tgt.h / 2;

      // LEARN: Cubic Bezier curve control points for smooth arcs
      const cx1 = x1 + (x2 - x1) / 3;
      const cy1 = y1;
      const cx2 = x1 + (x2 - x1) * 2 / 3;
      const cy2 = y2;

      const pathD = `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;

      // Thickness proportional to frequency (1–8px range)
      const thickness = 1 + (edge.frequency / maxFreq) * 7;

      // Color: slow transitions are orange/red, fast are blue
      const slowness = maxDuration > 0 ? edge.avgDuration / maxDuration : 0;
      const edgeColor = this._interpolateColor('#4f8ef7', '#ef4444', slowness);
      const isBottleneck = slowness > 0.6;

      const edgeG = edgeGroup.append('g').attr('class', 'pm-edge');

      // Invisible wider path for easier hover
      edgeG.append('path')
        .attr('d', pathD)
        .attr('stroke', 'transparent')
        .attr('stroke-width', Math.max(thickness + 8, 16))
        .attr('fill', 'none')
        .style('cursor', 'pointer')
        .on('mouseover', (event) => {
          tooltip.style.display = 'block';
          tooltip.innerHTML = `
            <div style="font-weight:600;color:#e8ecf4;margin-bottom:6px;">
              ${edge.source} → ${edge.target}
            </div>
            <div style="color:#8892a4;font-size:0.78rem;">
              Frequency: <span style="color:#4f8ef7;font-weight:600;">${edge.frequency.toLocaleString()}</span><br/>
              Avg Duration: <span style="color:${isBottleneck ? '#ef4444' : '#10b981'};font-weight:600;">${edge.avgDuration.toFixed(1)}h</span><br/>
              P90 Duration: <span style="color:#f59e0b;font-weight:600;">${edge.p90Duration.toFixed(1)}h</span>
            </div>
          `;
          const rect = document.getElementById('processMapSVG').getBoundingClientRect();
          tooltip.style.left = (event.clientX - rect.left + 10) + 'px';
          tooltip.style.top  = (event.clientY - rect.top  + 10) + 'px';
        })
        .on('mousemove', (event) => {
          const rect = document.getElementById('processMapSVG').getBoundingClientRect();
          tooltip.style.left = (event.clientX - rect.left + 10) + 'px';
          tooltip.style.top  = (event.clientY - rect.top  + 10) + 'px';
        })
        .on('mouseout', () => { tooltip.style.display = 'none'; });

      // Visible edge path
      edgeG.append('path')
        .attr('d', pathD)
        .attr('stroke', edgeColor)
        .attr('stroke-width', thickness)
        .attr('fill', 'none')
        .attr('opacity', 0.75)
        .attr('marker-end', isBottleneck ? 'url(#arrowhead-red)' : 'url(#arrowhead)')
        .style('pointer-events', 'none');

      // Edge label: frequency count
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2 - 8;

      edgeG.append('text')
        .attr('x', midX).attr('y', midY)
        .attr('text-anchor', 'middle')
        .attr('font-size', '10px')
        .attr('fill', edgeColor)
        .attr('opacity', 0.8)
        .style('pointer-events', 'none')
        .text(edge.frequency.toLocaleString());
    }
  },

  /**
   * _renderNodes(nodes, positions, activityStats)
   * 
   * Each node is a rectangle with:
   * - Activity name as label
   * - Color based on wait time (green = fast, red = bottleneck)
   * - Border glow for start/end activities
   */
  _renderNodes(nodes, positions, activityStats) {
    const nodeGroup = this.g.append('g').attr('class', 'pm-nodes');
    const tooltip = document.getElementById('mapTooltip');

    const maxWait = Math.max(...[...activityStats.values()].map(s => s.avgWait));

    for (const [name, node] of nodes) {
      const pos = positions.get(name);
      if (!pos) continue;

      const stat = activityStats.get(name);
      const waitRatio = stat ? stat.avgWait / maxWait : 0;

      // Node color: green (fast) to red (slow bottleneck)
      let fillColor;
      if (node.isStart && !node.isEnd) {
        fillColor = '#10b981';  // Green for start
      } else if (node.isEnd && !node.isStart) {
        fillColor = '#8b5cf6';  // Purple for end
      } else {
        fillColor = this._interpolateColor('#1e4d80', '#ef4444', waitRatio);
      }

      const nodeG = nodeGroup.append('g')
        .attr('class', 'pm-node')
        .attr('transform', `translate(${pos.x}, ${pos.y})`)
        .style('cursor', 'pointer');

      // Glow effect for high-frequency nodes
      if (node.isStart || node.isEnd) {
        nodeG.append('rect')
          .attr('x', -3).attr('y', -3)
          .attr('width', pos.w + 6).attr('height', pos.h + 6)
          .attr('rx', 11).attr('ry', 11)
          .attr('fill', 'none')
          .attr('stroke', fillColor)
          .attr('stroke-width', 1.5)
          .attr('opacity', 0.4);
      }

      // Main node rectangle
      nodeG.append('rect')
        .attr('class', 'pm-node-rect')
        .attr('width', pos.w).attr('height', pos.h)
        .attr('rx', 8).attr('ry', 8)
        .attr('fill', fillColor)
        .attr('fill-opacity', 0.85)
        .attr('stroke', fillColor)
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.6);

      // Activity name (truncated if too long)
      nodeG.append('text')
        .attr('x', pos.w / 2).attr('y', pos.h / 2 - 5)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', '11px')
        .attr('font-weight', '600')
        .attr('fill', '#ffffff')
        .attr('font-family', 'Inter, sans-serif')
        .text(this._truncate(name, 20));

      // Frequency badge below name
      if (stat) {
        nodeG.append('text')
          .attr('x', pos.w / 2).attr('y', pos.h / 2 + 10)
          .attr('text-anchor', 'middle')
          .attr('font-size', '9px')
          .attr('fill', 'rgba(255,255,255,0.7)')
          .attr('font-family', 'JetBrains Mono, monospace')
          .text(`${stat.frequency.toLocaleString()} × | avg ${stat.avgWait.toFixed(1)}h wait`);
      }

      // Hover tooltip
      nodeG
        .on('mouseover', (event) => {
          tooltip.style.display = 'block';
          tooltip.innerHTML = `
            <div style="font-weight:700;color:#e8ecf4;margin-bottom:8px;">${name}</div>
            <div style="color:#8892a4;font-size:0.78rem;line-height:1.8;">
              Frequency: <span style="color:#4f8ef7;font-weight:600;">${stat?.frequency?.toLocaleString() || 'N/A'}</span><br/>
              Avg Wait: <span style="color:${waitRatio > 0.6 ? '#ef4444' : '#10b981'};font-weight:600;">${stat?.avgWait?.toFixed(1) || 0}h</span><br/>
              Max Wait: <span style="color:#f59e0b;font-weight:600;">${stat?.maxWait?.toFixed(1) || 0}h</span><br/>
              Cases: <span style="color:#e8ecf4;font-weight:600;">${stat?.caseCount?.toLocaleString() || 'N/A'}</span><br/>
              Resources: <span style="color:#00d4ff;">${stat?.resourceList?.slice(0,3).join(', ') || 'N/A'}</span>
            </div>
            ${node.isStart ? '<div style="margin-top:6px;color:#10b981;font-size:0.72rem;">▶ PROCESS START</div>' : ''}
            ${node.isEnd   ? '<div style="margin-top:6px;color:#8b5cf6;font-size:0.72rem;">⏹ PROCESS END</div>'   : ''}
          `;

          const rect = document.getElementById('processMapSVG').getBoundingClientRect();
          tooltip.style.left = (event.clientX - rect.left + 14) + 'px';
          tooltip.style.top  = (event.clientY - rect.top  - 10) + 'px';
        })
        .on('mousemove', (event) => {
          const rect = document.getElementById('processMapSVG').getBoundingClientRect();
          tooltip.style.left = (event.clientX - rect.left + 14) + 'px';
          tooltip.style.top  = (event.clientY - rect.top  - 10) + 'px';
        })
        .on('mouseout', () => {
          tooltip.style.display = 'none';
        });
    }
  },

  _updateStats(graphData, activityStats) {
    const totalCases = Math.max(...[...activityStats.values()].map(s => s.caseCount));
    document.getElementById('mapStatVariants').textContent =
      `📊 ${graphData.edges.size} unique transitions`;
    document.getElementById('mapStatEdges').textContent =
      `🔀 ${graphData.nodes.size} activities`;
    document.getElementById('mapStatHappyPath').textContent =
      `⚡ Happy path: most frequent route`;
  },

  fitView(width, height, positions) {
    if (positions.size === 0) return;

    const xs = [...positions.values()].map(p => p.x);
    const ys = [...positions.values()].map(p => p.y);
    const ws = [...positions.values()].map(p => p.w);
    const hs = [...positions.values()].map(p => p.h);

    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs.map((x, i) => x + ws[i]));
    const maxY = Math.max(...ys.map((y, i) => y + hs[i]));

    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const scale = Math.min(0.95 * width / contentW, 0.95 * height / contentH, 1.5);

    const tx = (width  - contentW * scale) / 2 - minX * scale;
    const ty = (height - contentH * scale) / 2 - minY * scale;

    this.svg.transition().duration(600)
      .call(this.zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  },

  reset() {
    if (this.svg && this.zoom) {
      this.svg.transition().duration(400)
        .call(this.zoom.transform, d3.zoomIdentity);
    }
  },

  /**
   * _interpolateColor(color1, color2, t)
   * 
   * LEARN: Linear color interpolation.
   * t=0 → color1, t=1 → color2, t=0.5 → midpoint color.
   * Used to create green→red gradient for bottleneck visualization.
   */
  _interpolateColor(color1, color2, t) {
    t = Math.max(0, Math.min(1, t));

    const r1 = parseInt(color1.slice(1, 3), 16);
    const g1 = parseInt(color1.slice(3, 5), 16);
    const b1 = parseInt(color1.slice(5, 7), 16);

    const r2 = parseInt(color2.slice(1, 3), 16);
    const g2 = parseInt(color2.slice(3, 5), 16);
    const b2 = parseInt(color2.slice(5, 7), 16);

    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);

    return `rgb(${r}, ${g}, ${b})`;
  },

  _truncate(str, maxLen) {
    return str.length <= maxLen ? str : str.slice(0, maxLen - 1) + '…';
  }
};
