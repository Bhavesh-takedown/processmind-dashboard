# Changelog

All notable changes to **ProcessMind** are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Planned
- Export filtered case list as CSV
- Shareable URL state (encode active filters in query string)
- Conformance checking against a reference process model

---

## [1.5.0] — 2026-08-02

### Added
- **Copy Timeline button** — 📋 button in the Case Explorer detail panel copies
  the full activity timeline (step number, activity, timestamp, resource, cost,
  wait time, bottleneck flag) as formatted plain text to the clipboard
- `copyTimeline(caseId)` helper in `dashboard.js` builds the text report and
  calls the Clipboard API asynchronously
- `showCopyToast(message)` utility renders a green slide-in toast notification
  that auto-dismisses after 2.8 s — reusable for future copy operations
- CSS for `.copy-timeline-btn` (ghost button, hover lift, green ✓ state) and
  `@keyframes slideInToast` in `index.html`

---

## [1.4.0] — 2026-08-01

### Added
- **Dark / light theme toggle** — 🌙/☀️ button in the top-bar switches between
  the existing dark palette and a clean light palette (`[data-theme="light"]`
  CSS attribute pattern); preference is persisted in `localStorage`
- `T` keyboard shortcut to toggle the theme from anywhere in the dashboard
- Smooth CSS colour transition (`var(--ease-normal)`) on the `<html>` element
  so the switch animates gracefully instead of hard-cutting
- New shortcut row added to the ⌨️ Keyboard Shortcuts modal

---

## [1.3.0] — 2026-07-29

### Added
- **Keyboard shortcuts modal** — press `?` or click the new `?` badge in the
  top-bar to open an animated panel listing all navigation and action shortcuts
  (`1`–`5` to switch views, `U` for upload, `S` to load sample data, `Esc` to close)
- Shortcuts are safely disabled when focus is inside an `<input>`, `<textarea>`,
  or `<select>` to prevent accidental triggering while typing

### Changed
- Top-bar now renders a circular `?` help button alongside the existing controls

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
