# Tag Tree — Obsidian Plugin (Inner-test 1.0)

> A beautiful, animated, high-performance tag tree panel for Obsidian — tag counts, hierarchical tags, left-aligned overlay bars, smooth expand/collapse animations, and efficient hot-update (frontmatter + inline tags).
> Designed for power users who want a visual, compact and configurable tag overview.

---

## Table of contents

* [Features](#features)
* [Installation](#installation)
* [Usage](#usage)
* [Settings (all options & defaults)](#settings-all-options--defaults)
* [Behavior details & examples](#behavior-details--examples)
* [Performance & Hot-update](#performance--hot-update)
* [Developer notes / Architecture overview](#developer-notes--architecture-overview)
* [Troubleshooting & FAQ](#troubleshooting--faq)
* [Contributing](#contributing)
* [License](#license)

---

## Features

* Tree view of tags (supports hierarchical tags like `project/alpha`).
* Automatic tag counting across vault:

  * Counts both inline `#tag` occurrences and frontmatter `tags` entries.
* Visual overlay bars: each tag row shows a background bar indicating relative frequency.

  * Bars left-align to their parent tag (child bars align to the parent bar left edge).
  * Bars scale proportionally to the maximum tag count and automatically adapt to the container width.
  * Colors for four levels (configurable).
  * Rounded corners (configurable).
* Smooth animations:

  * Height (slide) animation for expand/collapse.
  * Horizontal bar expand/collapse with independent durations.
  * Bar fade in/out and transform origin set to **left** so expand is left→right and collapse is right→left visually (but implemented so net effect is left-anchored).
  * Preheat options allow fine tuning timing so bars and height animations feel stitched.
* Idle state:

  * After user-configurable idle timeout, text fades (becomes transparent) and bars show full (idle) colors.
  * Returning interaction fades bars back to active (muted) appearance and restores text.
* Hot update (real-time-ish):

  * Efficient detection of tag changes using `metadataCache`, `vault.modify` and optional read-from-disk fallback.
  * Difference-aware updates: only affected counts/bars/rows are updated when possible.
  * Supports both inline tags (in-body `#tag`) and frontmatter `tags:` entries (array, string, or short list).
* Click a tag name to open Obsidian search using the **official `tag:#<tag>` query** so both inline and frontmatter tags are matched.
* Settings panel with grouped sections and color pickers.

---

## Installation

1. Build and pack as a regular Obsidian plugin, or copy `main.js` + `manifest.json` into your plugin folder.
2. Alternatively clone the repo and build with the project's instructions:

```bash
# typical workflow in plugin dev env
npm install
npm run build
# then copy the dist/main.js and manifest.json to .obsidian/plugins/your-plugin-id/
```

(Adjust to your project scaffold.)

Open Obsidian → Settings → Community plugins → enable developer mode and load the plugin folder.

> **This README corresponds to release: `Inner-test 1.0`.**

---

## Usage

* Open the tag tree panel:

  * Use the command **"打开标签树状面板"** (Open tag tree view) from the command palette, or bind a hotkey to `open-tag-tree-view`.
* Click the triangle arrow to expand/collapse children.
* Click the tag name to open the global search with `tag:#<tag>`. This search matches both inline tags and frontmatter tags.
* Resize the plugin panel — bars automatically adapt to available width.

---

## Settings (all options & defaults)

All settings are exposed in the plugin setting tab, grouped for clarity.

**Heat Update (hot-update)**

* `metadataDebounceMs`: `40` — debounce for metadata change processing (ms).
* `frontmatterReadDelay`: `80` — when cache lacks frontmatter, wait this many ms before reading file to parse frontmatter.

**Animation**

* `expandDuration`: `320` — slide (height) expand/collapse duration (ms).
* `expandEasing`: `cubic-bezier(0.2, 0.8, 0.2, 1)` — easing for slide.
* `barExpandDuration`: `240` — horizontal bar expand duration (ms).
* `barCollapseDuration`: `200` — horizontal bar collapse duration (ms).
* `barFadeInDuration`: `160` — bar fade-in duration (ms).
* `barFadeOutDuration`: `120` — bar fade-out duration (ms).
* `barPreheatExpandMs`: `80` — how early bar animation starts relative to height expand (ms).
* `barPreheatCollapseMs`: `40` — preheat for collapse (ms).

**Layout**

* `sidePadding`: `16` px — left & right padding inside plugin container.
* `subTagIndent`: `9` px — indent for **tag names** of child levels (bar alignment does not indent).
* `rightPadding`: `12` px — spare padding used when computing bar max width.
* `rowHeight`: fixed (internal) `22px` — consistent row height used for overlays.

**Personalization (colors, radius, opacity)**

* `barColor0`..`barColor3`: hex strings (defaults):

  * `barColor0` — `#9BE9A8` (lowest)
  * `barColor1` — `#40C463`
  * `barColor2` — `#30A14E`
  * `barColor3` — `#216E39` (highest)
* `barCornerRadius`: `3` px — rounded corner for bars.
* `activeBarOpacity`: `0.30` — opacity used while user is active.
* `idleBarAlpha`: `0.95` — opacity used in idle (highlighted) state.

**Idle**

* `idleTimeout`: `8000` ms — time without interaction before entering idle visual state.

**Other**

* `maxBarWidth`: `150` px — maximum used bar width (subject to container width adaptation).
* `barAnimationDuration` and `barFadeDuration` — fallbacks / overall durations used in some flows.

> All the above are available and editable from the plugin settings with grouped sections and color pickers.

---

## Behavior details & examples

### Tag counting & hierarchy

* Tags are considered by their full path (eg. `project/alpha`). The tree is built by splitting on `/`, creating parent nodes as needed.
* Each node’s displayed count is the aggregated count of its subtree (i.e., parent node shows sum of itself + children).
* Bars are sized relative to the **largest** tag count in the vault. The largest gets the longest bar; others scale proportionally. Bars also adapt to current panel width so the longest won't overflow.

### Search behavior

* Clicking a tag sets search string to:
  `tag:#<tag>`
  e.g. `tag:#project/alpha`
  This mirrors Obsidian's search behavior and matches both inline `#project/alpha` and frontmatter `tags: [project/alpha]`.

### Animation sequencing

* Expand flow (configurable preheat):

  1. Click arrow → height animation starts.
  2. After `barPreheatExpandMs` (or at an optimized moment), bars for newly visible rows animate horizontally (left→right) and fade in.
  3. Overlay synchronizes continuously while animation window is active.
* Collapse flow:

  1. Click collapse → bars for affected child rows animate horizontally (left-anchored scaleX from 1→0) and fade out.
  2. After bar collapse animation completes (or sooner if configured), height animation reduces children container height to zero.
* These timings are configurable in settings.

---

## Performance & Hot-update

Key design choices for responsiveness and low CPU usage:

* **Cache-first detection**: first compare `metadataCache` tags to the stored per-file tag map. If different → update. If not, optionally fallback to reading the file (with short delay) for frontmatter parsing.
* **Debounce**: metadata updates are debounced (`metadataDebounceMs`) so rapid saves do not trigger multiple heavy renders.
* **Difference-aware updates**:

  * When a single file changes, the plugin computes added/removed tags and updates counts only for those tags (rather than re-scanning all files).
  * For tag addition/removal the UI only creates/animates the affected bars/rows when possible.
* **Overlay Bars**:

  * Bars are drawn in an absolute-position overlay so they do not affect DOM layout or cause reflow of the tag list.
  * When expanding/collapsing we avoid full rebuilds where possible; instead we update or create bars for only affected items (`createBarForFullpath`, `updateCountsAndBars`, `scheduleOverlayRebuild`).
* **Animation sync**:

  * A short animation-sync window (managed by RAF loop) keeps bar positions smoothly updated during layout transitions and avoids visible lag.

---

## Developer notes / Architecture overview

**Main components**

* `main.ts` — single-file plugin (for this project). Key classes:

  * `TagTreePlugin` — plugin bootstrap, settings load/save, register view & settings tab.
  * `TagTreeSettingTab` — the settings UI with grouped sections.
  * `TagTreeView` (extends `ItemView`) — main UI & logic:

    * builds `perFileTagMap`, `tagCounts`
    * reacts to vault events: `create`, `delete`, `rename`, `modify`
    * listens to `metadataCache.on("changed")` for fast reaction
    * renders `<ul><li>` tree DOM (text & count)
    * builds overlay (`barOverlay`) containing `.tag-tree-view-bg-bar` elements positioned absolutely
    * animations: `playBarsExpand`, `playBarsCollapse`, height animations with CSS transitions
    * synchronization: `rebuildOverlayBars()` invoked at RAF frequency while overlay sync window active (to keep bars aligned to moving rows).

**Core helpers**

* `getTagsFromFileAsync(path)` — robust parser that:

  * inspects `metadataCache.tags` (inline) and `cache.frontmatter.tags` (frontmatter)
  * if cache lacks frontmatter, reads file and parses frontmatter (supports YAML list, string, short array, etc.)
  * collects inline tags via regex.
* `parseFrontmatterTagsFromContent` — frontmatter parsing helper for fallback.
* `createBarForFullpathWithRetry` — attempt to create overlay bar when DOM is ready (useful during expand when li may not yet be measured).

**Build**

* Typical obsidian plugin dev:

  * `npm run build` (TypeScript → JS + bundling).
  * Ensure `manifest.json` points to `main.js` (built artifact) and proper `id`, `name`, `minAppVersion`.

---

## Troubleshooting & FAQ

**Q: Newly added tag appears in list but its bar is missing until another change**

* Cause: overlay creation depends on measured DOM positions. If the DOM update & overlay rebuild happen before the row is fully present/measureable, bar creation may be retried. This plugin uses `createBarForFullpathWithRetry` and `scheduleOverlayRebuild` to cover this. If you still see the issue:

  * Try slightly increasing `metadataDebounceMs` (tradeoff: responsiveness vs reliability), or increase `barPreheatExpandMs` to allow more time for bar creation after expand.
  * The plugin also does difference-aware updates; for some file operations there is a brief timing window. This has been minimized in recent revisions.

**Q: Remove a tag but it still shows in tree**

* The plugin updates counts and removes empty tags. If a tag persists, ensure frontmatter or inline occurrences were actually removed and saved. Also `metadataDebounceMs` influences the timing. A full reload of Obsidian or toggling plugin off/on refreshes all.

**Q: Bars lag or jump when expanding/collapsing**

* Bars are positioned in an overlay and animated via transform. If you see small jumps:

  * Make sure `expandDuration`, `barPreheat*`, and `barExpandDuration` values are not drastically different.
  * The plugin tries to lock bar position during certain transitions to avoid visual jumps; occasional race conditions may happen in edge cases. If you can provide a reproducible scenario, it helps debugging.

---

## Contributing

PRs welcome. Suggested areas:

* Move to multi-file TypeScript + React settings UI.
* Add unit tests for tag parsing (frontmatter variations).
* Add optional fade-only mode or accessibility-friendly styles.
* Add localization strings.

When contributing:

1. Fork repo.
2. Create branch, implement changes, keep API/backwards compatibility.
3. Run `npm run build`, test in Obsidian.
4. Submit PR with clear description.

---
