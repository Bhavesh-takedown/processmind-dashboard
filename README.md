# ⚡ ProcessMind — Business Process Analytics

> Upload event logs (CSV) and automatically discover bottlenecks, visualize process flows, and optimize your business processes entirely within the browser.

![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black)
![Chart.js](https://img.shields.io/badge/Chart.js-FF6384?logo=chartdotjs&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)
![Contributions Welcome](https://img.shields.io/badge/contributions-welcome-brightgreen)

---

## What It Does

ProcessMind is a pure frontend **Process Mining Dashboard** that lets you:
- **Upload event logs** in CSV format directly in the browser
- **Visualize interactive process maps** of activities
- **Automatically identify bottlenecks** with wait times and execution times
- **Explore individual cases/traces** to understand specific paths and anomalies
- **Analyze resource workload** distribution
- Keep your data private — **100% client-side processing**, no data sent to a backend server

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend UI | HTML5 + Semantic Elements |
| Styling | Custom CSS3 (Variables, Flexbox/Grid) |
| Core Logic & State | Vanilla JavaScript (ES6+) |
| Analytics Engine | Custom built `process_engine.js` |
| Data Visualization | Chart.js |

## Architecture

```
User uploads CSV → FileReader API loads data in-memory
         → process_engine.js parses and computes stats (frequencies, bottlenecks)
         → dashboard.js updates application state
         → Chart.js & process_map.js render the dashboard UI
```

## Project Structure

```
process_dashboard/
├── index.html               # Main entry point / Single Page App
├── code_guide.html          # Comprehensive codebase explanation
├── CHANGELOG.md             # Version history
├── static/
│   ├── css/
│   │   └── dashboard.css    # All styles and themes
│   └── js/
│       ├── dashboard.js     # Controller: State and UI events
│       ├── process_engine.js# Model: CSV parsing and analytics
│       ├── process_map.js   # View logic for the interactive map
│       └── data_generator.js# Generates mock event logs
└── data/
    └── sample_order_to_cash.csv  # Ready-to-upload sample dataset
```

## Setup

### 1. Clone and run
Since this is a pure frontend application, no build tools or installations are required!

```bash
git clone <your-repo-url>
cd process_dashboard
```

### 2. Open the App
You can simply double-click `index.html` to open it in any modern browser.

*Note: For the best experience (to avoid strict browser security restrictions on local files if you modify them), you can run a simple local server:*
```bash
# Python 3
python -m http.server 8000
```
Then open **http://localhost:8000** in your browser.

### 3. Try it immediately
- Click **"✨ Load Sample Data"** in the top right to generate a synthetic 500-case event log in seconds, **or**
- Upload the included **`data/sample_order_to_cash.csv`** file to explore a real pre-built dataset covering all 5 process variants.

## Data Format

To upload your own data, use a CSV file with the following headers:
- `case_id` (Required): A unique identifier for a single process instance (e.g., Order ID).
- `activity` (Required): The name of the step or task being performed.
- `timestamp` (Required): The date and time when the activity occurred.
- `resource` (Optional): The person or system performing the activity.
- `cost` (Optional): Any cost associated with the activity.

Both comma (`,`) and semicolon (`;`) delimiters are supported.

## Notes

- All processing happens in your browser's memory. Very large CSV files (e.g., >50MB) may cause the browser to slow down.
- If you don't have an event log handy, click **"✨ Load Sample Data"** in the top right of the dashboard to try it out immediately.

## Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository and create a feature branch: `git checkout -b feat/your-feature`
2. Make your changes — keep each commit focused and descriptive
3. Ensure the app still works by opening `index.html` in a browser and testing all views
4. Open a **Pull Request** with a clear description of what changed and why

### Commit message format
This project uses [Conventional Commits](https://www.conventionalcommits.org/):
```
feat: add export to CSV button
fix: correct timestamp parsing for ISO 8601 with timezone
docs: update README setup instructions
chore: add .gitignore
refactor: extract chart helpers into utils module
perf: memoize bottleneck sort result
```

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for a full version history.

---

## License

MIT © Bhavesh — built as an AI portfolio project demonstrating: Data Visualization · Process Mining · Vanilla JS · Single Page Applications
