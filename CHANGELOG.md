# Changelog

All notable changes to **ProcessMind** are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Planned
- Dark / light theme toggle
- Export filtered case list as CSV
- Shareable URL state (encode active filters in query string)
- Conformance checking against a reference process model

---

## [1.2.0] — 2026-07-20

### Added
- `data/sample_order_to_cash.csv` — ready-to-upload 10-case event log
  covering all 5 process variants for immediate testing without generating data
- `.gitignore` — prevents OS, editor, and build artifacts from being committed

### Fixed
- `DataGenerator.VARIANTS` — each variant was missing a `name` property,
  causing all generated events to show `variant: "Standard"` instead of
  the correct label (Happy Path, Fast Track, Credit Rejection, Rework Loop, Express)

---

## [1.1.0] — 2026-07-19

### Added
- Performance: 5 JS optimisations — event delegation on sidebar, RAF-based
  counter animations, memoised sort key, lazy view rendering, early-bail guard
- `code_guide.html` — comprehensive in-browser codebase walkthrough

### Changed
- Project reorganised into `process_dashboard/` submodule structure

---

## [1.0.0] — 2026-07-15

### Added
- Initial release of ProcessMind Business Process Analytics dashboard
- CSV upload with automatic header detection (comma and semicolon separators)
- **Overview** — KPI cards (cases, events, throughput time, bottleneck score)
- **Process Map** — interactive SVG flow diagram with edge thickness by frequency
- **Bottleneck Analysis** — ranked activity wait times with bar chart
- **Case Explorer** — sortable, filterable table of individual process instances
- **Resource Analysis** — workload distribution chart per team member
- `DataGenerator.generateEventLog()` — synthetic Order-to-Cash event log
  (500 cases, 5 variants, Box-Muller distributed durations)
- Pure frontend — 100% client-side, zero backend required
