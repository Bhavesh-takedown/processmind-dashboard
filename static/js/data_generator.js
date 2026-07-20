/**
 * DATA GENERATOR — process_dashboard/static/js/data_generator.js
 * 
 * LEARN: This file generates realistic synthetic event log data.
 * In a real system, this data comes from your ERP (SAP, Oracle),
 * CRM (Salesforce), or ticket system (Jira, ServiceNow).
 * 
 * The "Order-to-Cash" (O2C) process is one of the most analyzed
 * business processes — it covers the full lifecycle of a sales order:
 *   Order Received → Credit Check → Approved → Packed → Shipped → Invoice → Payment
 */

const DataGenerator = {

  /**
   * LEARN: Business process activities are typically named as
   * "verb + noun" actions in past or present tense.
   * Each activity is performed by a specific department (resource).
   */
  ACTIVITIES: [
    { name: 'Order Received',      dept: 'Sales',       avgDuration: 0,   stdDev: 0 },    // Start
    { name: 'Credit Check',        dept: 'Finance',     avgDuration: 8,   stdDev: 6 },    // Takes 0-14h
    { name: 'Order Approved',      dept: 'Management',  avgDuration: 24,  stdDev: 20 },   // BOTTLENECK
    { name: 'Inventory Check',     dept: 'Warehouse',   avgDuration: 4,   stdDev: 2 },
    { name: 'Packed',              dept: 'Warehouse',   avgDuration: 6,   stdDev: 3 },
    { name: 'Shipped',             dept: 'Logistics',   avgDuration: 48,  stdDev: 36 },   // BOTTLENECK
    { name: 'Invoice Sent',        dept: 'Finance',     avgDuration: 2,   stdDev: 1 },
    { name: 'Payment Received',    dept: 'Finance',     avgDuration: 72,  stdDev: 48 },   // BOTTLENECK
    { name: 'Order Closed',        dept: 'Sales',       avgDuration: 1,   stdDev: 0.5 },  // End
  ],

  /** 
   * LEARN: Process "variants" are different paths through the process.
   * The "happy path" is the most common, ideal route.
   * Deviations happen due to: credit failures, stockouts, returns, etc.
   */
  VARIANTS: [
    // Happy path (60% of cases): all steps in order
    {
      name: 'Happy Path',
      weight: 0.60,
      path: [0, 1, 2, 3, 4, 5, 6, 7, 8]
    },
    // Fast track (15%): skip credit check for trusted customers
    {
      name: 'Fast Track',
      weight: 0.15,
      path: [0, 2, 3, 4, 5, 6, 7, 8]
    },
    // Credit rejection (10%): order rejected after credit check
    {
      name: 'Credit Rejection',
      weight: 0.10,
      path: [0, 1, 2]  // Ends early with "Order Closed" manually
    },
    // Rework loop (10%): inventory check fails, recheck needed
    {
      name: 'Rework Loop',
      weight: 0.10,
      path: [0, 1, 2, 3, 3, 4, 5, 6, 7, 8]  // Note: activity 3 repeats!
    },
    // Express (5%): minimal steps for priority orders
    {
      name: 'Express',
      weight: 0.05,
      path: [0, 4, 5, 6, 7, 8]
    }
  ],

  RESOURCES: {
    'Sales':       ['Alice Johnson', 'Bob Chen', 'Carol Smith'],
    'Finance':     ['Dave Patel',    'Eve Kumar',  'Frank Lee'],
    'Management':  ['Grace Wong',    'Harry Singh'],
    'Warehouse':   ['Ivan Cruz',     'Julia Park',  'Kevin Ng'],
    'Logistics':   ['Linda Zhao',    'Mike Torres'],
  },

  /**
   * generateEventLog()
   * 
   * LEARN: This function generates a realistic event log with:
   * - Multiple cases (business transactions)
   * - Each case follows a process variant
   * - Timestamps increase chronologically
   * - Some activities are "slow" (bottlenecks) on purpose
   * 
   * Returns: Array of event objects (rows in the event log table)
   */
  generateEventLog(numCases = 500, startDate = new Date('2024-01-01')) {
    const events = [];
    
    for (let i = 1; i <= numCases; i++) {
      const caseId = `ORD-${String(i).padStart(4, '0')}`;
      
      // LEARN: Math.random() < weight selects a variant with probability = weight
      const variant = this._selectVariant();
      
      // Each case starts at a slightly different time (spread across weeks)
      let currentTime = new Date(startDate.getTime() + 
        Math.random() * 90 * 24 * 60 * 60 * 1000);  // Random day in 90-day window
      
      // Walk through each activity in the selected variant
      for (let stepIdx = 0; stepIdx < variant.path.length; stepIdx++) {
        const activityIdx = variant.path[stepIdx];
        const activity = this.ACTIVITIES[activityIdx];
        
        // Add wait time BEFORE the activity starts (this is what creates bottlenecks!)
        // LEARN: Math.abs(normal()) generates a bell-curve distributed random number
        const waitHours = Math.max(0, 
          activity.avgDuration + this._normalRandom() * activity.stdDev
        );
        
        currentTime = new Date(currentTime.getTime() + waitHours * 60 * 60 * 1000);
        
        // Pick a resource from the department that handles this activity
        const deptResources = this.RESOURCES[activity.dept];
        const resource = deptResources[Math.floor(Math.random() * deptResources.length)];
        
        // Cost is higher for bottleneck activities (more resource time spent)
        const cost = Math.round((waitHours * 15 + Math.random() * 50));
        
        events.push({
          case_id:   caseId,
          activity:  activity.name,
          timestamp: new Date(currentTime),
          resource:  resource,
          dept:      activity.dept,
          cost:      cost,
          variant:   variant.name || 'Standard',
        });
        
        // Move time forward for next step
        currentTime = new Date(currentTime.getTime() + 30 * 60 * 1000); // +30 min processing
      }
    }
    
    // LEARN: Sorting by timestamp then case_id mimics how real ERP systems export logs
    events.sort((a, b) => a.timestamp - b.timestamp || a.case_id.localeCompare(b.case_id));
    
    console.log(`[DataGenerator] Generated ${events.length} events for ${numCases} cases`);
    return events;
  },

  /** Weighted random variant selection */
  _selectVariant() {
    const rand = Math.random();
    let cumulative = 0;
    for (const v of this.VARIANTS) {
      cumulative += v.weight;
      if (rand < cumulative) return v;
    }
    return this.VARIANTS[0];
  },

  /**
   * Box-Muller transform: generates normally distributed random numbers.
   * LEARN: Normal distribution (bell curve) is used because most real-world
   * durations cluster around an average, with fewer very fast/slow outliers.
   */
  _normalRandom() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  },

  /**
   * parseCSV(text)
   * 
   * LEARN: Parsing a CSV (Comma-Separated Values) file means:
   * 1. Split by lines
   * 2. First line is the header row (column names)
   * 3. Remaining lines are data rows
   * 4. Split each row by commas to get cell values
   * 5. Map column names to values → objects
   */
  parseCSV(text) {
    const lines = text.trim().split('\n').filter(l => l.trim());
    if (lines.length < 2) throw new Error('CSV must have at least a header row and one data row');
    
    // Detect separator: comma or semicolon
    const sep = lines[0].includes(';') ? ';' : ',';
    
    // Parse header row
    const headers = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/\s+/g, '_').replace(/"/g, ''));
    
    // Validate required columns
    const required = ['case_id', 'activity', 'timestamp'];
    for (const col of required) {
      if (!headers.includes(col)) {
        throw new Error(`Missing required column: "${col}". Found: ${headers.join(', ')}`);
      }
    }
    
    const events = [];
    
    for (let i = 1; i < lines.length; i++) {
      // LEARN: CSV values can contain commas if wrapped in quotes
      const values = this._parseCSVLine(lines[i], sep);
      if (values.length < required.length) continue;
      
      const row = {};
      headers.forEach((h, idx) => {
        row[h] = (values[idx] || '').trim().replace(/"/g, '');
      });
      
      // LEARN: Date parsing — JavaScript Date() handles many formats
      const ts = new Date(row.timestamp);
      if (isNaN(ts.getTime())) {
        console.warn(`[CSV] Row ${i+1}: invalid timestamp "${row.timestamp}", skipping`);
        continue;
      }
      
      events.push({
        case_id:   row.case_id,
        activity:  row.activity,
        timestamp: ts,
        resource:  row.resource || row.resource_name || 'Unknown',
        dept:      row.department || row.dept || row.resource || 'Unknown',
        cost:      parseFloat(row.cost || row.amount || 0),
        variant:   row.variant || 'Unknown',
      });
    }
    
    if (events.length === 0) throw new Error('No valid events found in CSV');
    
    console.log(`[DataGenerator] Parsed ${events.length} events from CSV`);
    return events;
  },

  _parseCSVLine(line, sep) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; }
      else if (char === sep && !inQuotes) { result.push(current); current = ''; }
      else { current += char; }
    }
    result.push(current);
    return result;
  }
};
