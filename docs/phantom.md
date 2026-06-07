# Feature: Phantom ✦

## Overview
Phantom is the flagship urbex intelligence feature. Given a user-selected area on the map, Phantom automatically builds a full historical intelligence report by combining satellite imagery analysis, AI object detection, historical identity research, and a location-aware news coverage pipeline. The result is a narrative history of the site — what it was, when it changed, and what the world recorded about it.

---

## User Flow

1. User draws a polygon on the Urbex map around a building or site
2. User clicks the polygon → Area Action Menu → selects **Phantom**
3. App runs the full pipeline in the background with real-time progress indicator
4. Report is delivered as an interactive page within the app and exportable as PDF

---

## Pipeline

### 1. Satellite Imagery Collection
- Fetches all available historical satellite imagery for the selected area
- **Sentinel-2** (10m resolution, every 5 days, free) → https://dataspace.copernicus.eu
- **Landsat archive** (1972 → present) → https://earthexplorer.usgs.gov
- **Sentinel Hub** for programmatic access → https://www.sentinel-hub.com
- Images retrieved at multiple dates spanning as far back as available
- Stored in MinIO, indexed by date

### 2. LiDAR — See Through the Trees
- Fetches airborne LiDAR point cloud data for the selected area (where available)
- Strips vegetation returns to produce a bare-earth Digital Terrain Model (DTM)
- Renders as hillshade overlay — reveals foundations, roads, earthworks invisible to cameras
- Sources by country:
  - France IGN LiDAR HD → https://geoservices.ign.fr/lidarhd
  - UK Environment Agency → https://environment.data.gov.uk/survey
  - US USGS 3DEP → https://www.usgs.gov/3d-elevation-program
  - Netherlands AHN → https://www.ahn.nl
- Processing: PDAL (point cloud) + GDAL (DTM generation) + Rasterio

### 3. SAR Radar Analysis
- Fetches Sentinel-1 SAR imagery — radar penetrates cloud cover and partially penetrates forest canopy
- Runs coherence analysis between two SAR dates to detect anomalies under vegetation
- Metal structures, concrete, disturbed soil have distinct radar signatures
- Source: Copernicus Data Space → https://dataspace.copernicus.eu

### 4. AI Image Analysis (YOLO + GDAL)
- YOLO runs object detection on each optical image: identifies structures, vehicles, vegetation, infrastructure
- GDAL + Rasterio performs change detection between dates — highlights what appeared or disappeared and when
- Results annotated on each image with bounding boxes and labels
- Change events logged with dates (e.g. "large structure disappeared between 2014-03 and 2014-09")
- Also runs on historical aerial photos and wartime photography

### 5. Historical Maps & Aerial Photography
- Fetches and georeferences historical topographic maps for the area:
  - David Rumsey Map Collection → https://www.davidrumsey.com
  - Old Maps Online → https://www.oldmapsonline.org
  - OpenHistoricalMap → https://www.openhistoricalmap.org
  - France IGN Géoportail → https://www.geoportail.gouv.fr
  - USGS TopoView (US) → https://ngmdb.usgs.gov/topoview
  - National Library of Scotland (UK/Europe) → https://maps.nls.uk
- Wartime aerial photography (WWII reconnaissance):
  - NCAP UK national archive → https://ncap.org.uk
- YOLO detects structures on historical maps, tagged with coordinates and estimated dates

### 6. Historical Identity Search
- Reverse geocodes the selected area to get current and historical addresses
- Searches cadastral records and land registry databases for historical parcel ownership and use
- Cross-references structure names found on old maps → feeds into OSINT search pipeline
- Example output: "Formerly known as Usine Métallurgique du Nord, operational 1923–1991"

### 7. News Agency Discovery
- Identifies the geographic region of the selected area
- Queries GDELT → https://www.gdeltproject.org and media registry sources
- Builds a ranked list of news agencies, local newspapers, TV stations, and online outlets that cover that region

### 8. News Archive Cross-Reference
- For each outlet in the list, searches their archives for articles mentioning the location, its historical names, or the immediate area
- Cross-references article dates against the satellite change timeline
- Example match: "structural collapse detected in satellite 2019-04, local outlet Le Courrier Picard published article on factory demolition 2019-04-17"
- Surfaces matched articles with title, date, outlet, and link

### 9. AI Synthesis
- LlamaIndex + Ollama synthesises all collected data into a coherent narrative history
- Covers: what the site was, its operational period, key events, when it became abandoned, what physical changes occurred and when, media coverage history
- Highlights confidence levels where data is sparse or conflicting
- Example: "1924 topographic map shows a brick works. 1944 aerial photo confirms large industrial complex. LiDAR DTM reveals foundation outlines still present under current forest."

---

## Report Output

The Phantom report contains:

- **Site identity** — name, historical names, type, operational period
- **Satellite timeline** — visual slider showing optical imagery across dates with YOLO annotations
- **LiDAR DTM hillshade** — bare-earth terrain model revealing ground features under vegetation
- **SAR anomaly layer** — radar-detected anomalies under canopy overlaid on the map
- **Historical map overlay** — georeferenced historical maps with detected structures annotated
- **Change log** — dated list of detected structural/environmental changes across all sources
- **News coverage map** — list of outlets covering the area with article count and date range
- **Matched articles** — articles cross-referenced against the satellite timeline
- **AI narrative** — full synthesised history of the site with confidence indicators
- **Sources** — all data points linked to their origin

---

## Tech
- Frontend: Next.js, MapLibre GL JS (polygon draw tool), D3.js (timeline), TanStack Query
- Backend: TypeScript + Fastify (Geo/Urbex Service orchestrates the pipeline)
- AI/Processing: Python (ruin repo) — YOLO, GDAL, PDAL, Rasterio, LlamaIndex, Ollama
- Data pipelines: ruin repo — Kafka, Polars
- Satellite: Copernicus Data Space (Sentinel-1 & 2), USGS EarthExplorer (Landsat)
- LiDAR: IGN, Environment Agency, USGS 3DEP, AHN (country-dependent — pipeline checks coverage before attempting fetch, gracefully skips if unavailable and notes it in the report)
- Historical maps: David Rumsey, Old Maps Online, IGN Géoportail, USGS TopoView, NLS, NCAP
- News: GDELT Project API
- Storage: MinIO (satellite images, LiDAR tiles, report assets)
- DB: PostgreSQL + PostGIS, Elasticsearch (article index), Neo4j (entity links)

---

## Related Features
- [Urbex](urbex.md) — parent module
- [AI Assistant](ai-assistant.md) — chat over the Phantom report
- [Investigation](investigation.md) — link a Phantom report to a broader case
