# Feature: Scout & Recon

## Overview
An automated area scanning system that divides a user-selected region into a grid of tiles and processes each tile in parallel to identify potentially abandoned locations. Two modes are available: **Scout** for a fast lightweight sweep, and **Recon** for a deep full-pipeline analysis. The natural workflow is Scout first to identify candidates, then Recon on the most promising tiles.

---

## User Flow

1. User draws a large polygon on the Urbex map (city or region scale)
2. User selects mode: **Scout** or **Recon**
3. User configures tile size and launches the job
4. System divides the polygon into a grid of tiles and queues parallel jobs
5. Tiles are processed in the background — results stream back in real time via WebSockets
6. Map tiles colour-code as they complete (green → amber → red by abandonment probability)
7. Ranked list panel builds up alongside the map
8. User clicks any tile to investigate further or escalate to Phantom / full Recon

---

## Scout Mode

**Purpose:** Fast, lightweight sweep of a wide area. Identifies visual candidates quickly without deep analysis. Run this first.

**What it does per tile:**
- Fetches latest Sentinel-2 optical imagery
- Fetches Landsat archive to detect changes over the past 5–10 years
- Runs YOLO object detection for abandonment signals:
  - Overgrown vegetation encroaching on structures
  - Roof degradation or collapse
  - Broken or boarded windows
  - No vehicle presence across multiple image dates
  - Structural deterioration patterns
- Quick LiDAR check if data is available for the region (terrain anomalies only)
- No news pipeline, no historical maps, no SAR, no AI narrative

**Probability scoring (Scout):**

| Signal | Weight |
|---|---|
| Vegetation encroachment (YOLO) | 30% |
| Structural deterioration (YOLO) | 25% |
| No movement across satellite dates | 25% |
| LiDAR terrain anomaly (if available) | 20% |

**Processing time:** Minutes per tile. A city-scale area (100km²) at 500m tiles (~400 tiles) runs in a few hours in the background.

---

## Recon Mode

**Purpose:** Full deep-analysis pipeline per tile. Includes everything in Scout plus the complete Phantom pipeline. Run this on high-probability tiles identified by Scout, or directly on a smaller area.

**What it does per tile (Scout pipeline +):**
- Sentinel-1 SAR radar analysis (canopy penetration, anomaly detection)
- Full LiDAR processing — bare-earth DTM, structure detection, hillshade render
- Historical map overlay — fetches and georeferences historical topographic maps
- Wartime aerial photography search (where available)
- Historical identity search — cadastral records, old names, parcel history
- News agency discovery — which outlets cover this tile's region (GDELT)
- News archive cross-reference — articles matched against satellite change dates
- Full AI synthesis (LlamaIndex + Ollama) — narrative history of the tile
- Full Phantom report generated and linked to the tile

**Probability scoring (Recon):**

| Signal | Weight |
|---|---|
| Vegetation encroachment (YOLO) | 20% |
| Structural deterioration (YOLO) | 15% |
| No movement across satellite dates | 15% |
| LiDAR terrain anomaly | 15% |
| SAR anomaly under canopy | 15% |
| Historical identity as industrial/institutional | 10% |
| No recent news or activity | 10% |

**Processing time:** Much heavier per tile. Best used on a shortlist of high-probability Scout tiles rather than a full city grid.

---

## Tile Configuration

Before launching, the user configures:
- **Tile size**: 250m, 500m, 1km (smaller = finer detail, more tiles, longer processing)
- **Mode**: Scout or Recon
- **LiDAR**: enable/disable (some regions have no coverage)
- **Priority queue**: run high-probability tiles first as they're identified

The system warns the user about estimated processing time before launching based on area size, tile size, and mode.

---

## Results Interface

### Map View
- Grid overlay on the selected area
- Each tile colour-coded as it completes:
  - 🟢 Green — low probability (0–30%)
  - 🟡 Amber — moderate (30–60%)
  - 🔴 Red — high probability (60–100%)
  - ⬜ Grey — not yet processed
- Click any tile to open its result card

### Ranked List Panel
- Sidebar listing all completed tiles sorted by probability score (highest first)
- Each entry shows: thumbnail, score, top signal, coordinates
- Click to jump to tile on map

### Tile Result Card
- Probability score and contributing signals breakdown
- YOLO-annotated satellite image
- LiDAR DTM thumbnail (if available)
- **Street view** — auto-fetched for tiles scoring above 60%. 4-direction imagery via Mapillary → KartaView → Playwright fallback. Displayed as a navigable viewer directly in the card.
- Quick action buttons:
  - **Open Phantom** — run or view full Phantom report for this tile
  - **Escalate to OSINT** — create an investigation case for this location
  - **Mark as checkpoint** — save with a status (Worth Exploring, Not Interesting, etc.)
  - **Run Recon** — upgrade a Scout tile to full Recon
  - **Fetch Street View** — manually trigger street view if not auto-fetched

---

## Two-Stage Workflow

The intended workflow for investigating an unknown region:

```
1. Draw large polygon over region of interest
    ↓
2. Launch Scout
   → Fast sweep, tiles colour-code in real time
   → Identify red/amber tiles (high probability candidates)
    ↓
3. Select high-probability tiles
   → Launch Recon on selected tiles only
   → Full pipeline runs on shortlist
    ↓
4. Review Recon results
   → Open Phantom reports
   → Escalate to OSINT cases
   → Mark checkpoints on the map
```

## Historical Diff (Recurring Scans)

When a Scout or Recon job is run over an area that was previously scanned, the system automatically compares results against the previous run:

- Tiles that changed score significantly are flagged (e.g. a tile that was green is now amber)
- New structures or vegetation changes detected since last scan are highlighted
- Demolished or cleared structures noted
- Diff summary shown at the top of the results panel: "14 tiles changed since last scan on 2025-11-03"

Users can schedule recurring Scout runs on a saved polygon via the [Alerts & Watches](alerts.md) system — e.g. re-scan this area every 30 days and alert on significant changes.

---

## Tech
- Frontend: Next.js, MapLibre GL JS (grid overlay, tile colour-coding), TanStack Query, WebSockets
- Backend: TypeScript + Fastify (Geo/Urbex Service — job orchestration)
- Workers: Python + Celery (ruin repo) — YOLO, GDAL, PDAL, LiDAR processing
- Data pipelines: ruin repo — Kafka (tile job queue), Polars (batch scoring)
- Satellite: Copernicus Data Space → https://dataspace.copernicus.eu
- LiDAR: IGN, Environment Agency, USGS 3DEP, AHN
- News: GDELT → https://www.gdeltproject.org
- Street view: Mapillary API → https://www.mapillary.com/developer/api-documentation
- Street view fallback: KartaView → https://kartaview.org
- Street view final fallback: Playwright screenshot of Google Street View
- DB: PostgreSQL + PostGIS (tile results, scores, job state)
- Queue: Kafka (tile jobs) + Redis (real-time job status)
- Storage: MinIO (tile imagery, LiDAR tiles, Recon reports)

---

## Related Features
- [Urbex](urbex.md) — parent module, map interaction
- [Phantom](phantom.md) — Recon mode runs Phantom per tile
- [Investigation](investigation.md) — escalate tiles into OSINT cases
- [Alerts & Watches](alerts.md) — schedule recurring Scout runs on an area
