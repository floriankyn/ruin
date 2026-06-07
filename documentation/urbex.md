# Feature: Urbex

## Overview
A Google Earth-style map module for discovering, documenting, and investigating urban exploration locations. The map is the primary interface — everything the user does flows from it. Locations are surfaced automatically from open sources or submitted manually. Each location can be assessed, annotated, and escalated into a full Phantom report or OSINT investigation.

---

## Map Interface

Built on MapLibre GL JS with full Google Earth feature parity.

### Base Layers
- Satellite / aerial imagery
- Terrain / topographic
- Street map
- Dark / minimal basemap

### Google Earth Feature Parity
- 3D buildings (extruded from vector tiles)
- 3D terrain with tilt and rotation
- Elevation display
- Historical imagery time slider
- Measurement tools (distance, area, radius)
- Coordinate display on hover
- Fly-to animated navigation
- KML / KMZ / GeoJSON file import
- Place name and road labels toggle
- Grid overlay
- Sun position and shadow simulation
- Atmosphere and fog effects

### Layer Toggle Panel
All layers independently toggled from a side panel: buildings, terrain, roads, borders, labels, imported files, and any active thematic layer.

---

## Map Interactions

### Right-Click on Any Point
Opens a context menu to set a **checkpoint status**:
- Worth Exploring
- Not Interesting
- Inaccessible
- Demolished
- Visited
- Needs More Research

Each checkpoint is saved as a named location with coordinates, status, timestamp, and optional notes. Status colours are distinct on the map so the user can read the state of all locations at a glance.

### Draw a Polygon
- User draws a polygon around any building, site, or area
- Polygon is saved permanently on the map with a label
- Clicking the polygon opens the **Area Action Menu**

### Area Action Menu
Triggered by clicking a saved polygon:

**Set Status** — same statuses as a checkpoint point

**Phantom** — triggers the full Phantom pipeline: satellite history, YOLO AI analysis, news agency discovery, and AI narrative report

**Research Panel** — floating card with two tools:
- **Contextual Search** — Google search bar with location context (country, region, town, coordinates) pre-loaded. Toggle context on/off before searching.
- **Google Dork Helper** — pre-built Google dork queries using advanced operators (`site:`, `filetype:`, `inurl:`, `"exact phrase"`) auto-populated with location context. Examples: `"Usine du Nord" filetype:pdf`, `"abandoned factory Lille" site:reddit.com`. One-click launch.

**Scout** — launch a fast automated tile-by-tile sweep of the polygon. YOLO + satellite change detection scores each tile for abandonment probability. Results stream back as a colour-coded grid.

**Recon** — launch a full deep-analysis sweep. Runs the complete Phantom pipeline on every tile. Best used on a shortlisted area after Scout.

**Pipeline Launcher** — select which pipelines to run:
- News coverage scan — discover outlets covering the area + fetch relevant articles
- Full OSINT enrichment — all available tools run against this location
- **Create OSINT Case** — bridge to the Investigation module. Creates a new investigation case with this location as the starting entity, carrying over coordinates, polygon, name, and existing intel. Investigation begins immediately in the OSINT section.

---

## Street View

Street-level imagery fetched for any location via a zero-cost waterfall pipeline:

```
1. Check Mapillary API (free, 250k calls/month)
   → https://www.mapillary.com/developer/api-documentation
    ↓ no coverage
2. Check KartaView (fully open, free)
   → https://kartaview.org
    ↓ no coverage
3. Playwright screenshots Google Street View
   → Navigates to Google Maps Street View URL, captures 4 headings
     (North 0°, East 90°, South 180°, West 270°)
   → No API key, no cost, personal use
```

All screenshots stored in MinIO tagged by date, heading, and source. Displayed in the location profile as a navigable 4-direction viewer.

**Triggering:** Available as an on-demand button on any location profile or checkpoint. Not fetched automatically to avoid unnecessary load.

---

## Location Profiles
- Name and aliases
- Coordinates and address (reverse geocoded)
- Type: factory, hospital, asylum, bunker, residential, etc.
- Status (from checkpoint system)
- Access level: easy, moderate, difficult, dangerous
- **Street view** — 4-direction imagery (Mapillary → KartaView → Playwright fallback)
- Photo gallery (MinIO)
- Rich text notes (Tiptap)
- Date first documented
- Linked entities (people, events, organisations)
- Phantom report (if generated)
- Visit log with timestamps

---

## Thematic Layers

On-demand data layers from open sources. All processed through a standardised geospatial pipeline and served via a single PMTiles tile server. Adding a new layer = one ingestion adapter + one MapLibre style config.

### Physical & Terrain
| Layer | Source | URL |
|---|---|---|
| Elevation / DEM | Copernicus DEM (30m, free, global) | https://dataspace.copernicus.eu |
| Hillshade | Derived from Copernicus DEM | — |
| Land cover | ESA WorldCover (10m, free) | https://esa-worldcover.org |
| Forest cover | Global Forest Watch | https://www.globalforestwatch.org |
| Water bodies | HydroSHEDS + OpenStreetMap | https://www.hydrosheds.org |
| Flood zones | JRC Global Surface Water | https://global-surface-water.appspot.com |
| Earthquake risk | USGS Earthquake Hazards Program | https://earthquake.usgs.gov |
| Active wildfires | NASA FIRMS (real-time) | https://firms.modaps.eosdas.nasa.gov |

### Population & Demographics
| Layer | Source | URL |
|---|---|---|
| Population density | WorldPop (100m, free) | https://www.worldpop.org |
| Urban extent | GHSL Urban Centre Database | https://ghsl.jrc.ec.europa.eu |
| Night lights | NASA Black Marble / VIIRS | https://blackmarble.gsfc.nasa.gov |

### Infrastructure
| Layer | Source | URL |
|---|---|---|
| Roads, railways, buildings | OpenStreetMap | https://www.openstreetmap.org |
| Power grid | Global Power Plant Database | https://datasets.wri.org/dataset/globalpowerplantdatabase |
| Industrial sites | OpenStreetMap | https://www.openstreetmap.org |
| Military installations | OpenStreetMap + Wikidata | https://www.openstreetmap.org |
| Airports & ports | OurAirports | https://ourairports.com |

### Political & Administrative
| Layer | Source | URL |
|---|---|---|
| Country / region borders | Natural Earth + GADM | https://www.naturalearthdata.com · https://gadm.org |
| Disputed territories | Natural Earth | https://www.naturalearthdata.com |
| Time zones | timezone-boundary-builder | https://github.com/evansiroky/timezone-boundary-builder |

### Conflict & Security
| Layer | Source | URL |
|---|---|---|
| Conflict events | ACLED (free for researchers) | https://acleddata.com |
| Terrorism incidents | GTD (Global Terrorism Database) | https://www.start.umd.edu/gtd |
| Refugee / displacement | UNHCR data | https://data.unhcr.org |
| Sanctions lists | UN, EU, US OFAC | https://www.un.org/securitycouncil/sanctions/information |

### Environment
| Layer | Source | URL |
|---|---|---|
| Air quality (real-time) | OpenAQ | https://openaq.org |
| Protected areas | WDPA | https://www.protectedplanet.net |
| Climate zones | Köppen-Geiger | https://www.gloh2o.org/koppen |
| CO2 emissions | EDGAR | https://edgar.jrc.ec.europa.eu |

### Economic & Development
| Layer | Source | URL |
|---|---|---|
| GDP, poverty, development | World Bank Open Data | https://data.worldbank.org |

### Satellite & Remote Sensing
| Layer | Source | URL |
|---|---|---|
| Recent imagery (10m, 5-day cycle) | Sentinel-2 (ESA, free) | https://dataspace.copernicus.eu |
| Radar / cloud-penetrating | Sentinel-1 (ESA, free) | https://dataspace.copernicus.eu |
| Historical Landsat | USGS Earth Explorer | https://earthexplorer.usgs.gov |
| LiDAR — France | IGN LiDAR HD | https://geoservices.ign.fr/lidarhd |
| LiDAR — UK | Environment Agency | https://environment.data.gov.uk/survey |
| LiDAR — US | USGS 3DEP | https://www.usgs.gov/3d-elevation-program |
| LiDAR — Netherlands | AHN | https://www.ahn.nl |

### Historical
| Layer | Source | URL |
|---|---|---|
| Historical map overlays | David Rumsey Map Collection | https://www.davidrumsey.com |
| Historical map overlays | Old Maps Online | https://www.oldmapsonline.org |
| Historical map overlays | OpenHistoricalMap | https://www.openhistoricalmap.org |
| France historical maps | IGN Géoportail | https://www.geoportail.gouv.fr |
| US historical topo maps | USGS TopoView | https://ngmdb.usgs.gov/topoview |
| UK/Europe historical maps | National Library of Scotland | https://maps.nls.uk |
| Historical boundaries | CShapes Dataset | https://icr.ethz.ch/data/cshapes |
| Wartime aerial photography | NCAP (UK national archive) | https://ncap.org.uk |

### News & Events
| Layer | Source | URL |
|---|---|---|
| News event density by location | GDELT | https://www.gdeltproject.org |

---

## Geospatial Pipeline

All thematic layers go through a single normalised pipeline:

```
Source API / file download
    ↓
Ingestion adapter (one per source, ~50 lines Python)
    ↓
Normalize → GeoJSON (vector) or GeoTIFF (raster)
    ↓
tippecanoe / gdal2tiles → PMTiles
    ↓
Martin tile server (single endpoint)
    ↓
MapLibre renders via style definition
```

**Caching:** on-demand fetch + local cache. User selects a layer → pipeline fetches and tiles it → cached for instant reloading. Manual refresh available.

Layer catalogue stored in PostgreSQL (name, source, last updated, license, update frequency).

---

## Auto-Discovery
Scrapers monitor urbex forums, Reddit, Instagram hashtags, YouTube, and known urbex databases. New locations are geocoded, deduplicated via PostGIS proximity check, and surfaced as unconfirmed pins for review.

---

## Tech
- Frontend: React, MapLibre GL JS, TanStack Query, WebSockets
- Backend: TypeScript + Fastify (Geo/Urbex Service)
- Tile server: Martin (PMTiles)
- Geospatial processing: GDAL, tippecanoe, Rasterio (ruin repo)
- Scrapers: Scrapy + Playwright + Camoufox (ruin repo)
- DB: PostgreSQL + PostGIS
- Storage: MinIO (photos, cached tiles, satellite imagery)
- Queue: Kafka

---

## Related Features
- [Phantom](phantom.md) — full historical intelligence report for a selected area
- [Scout & Recon](scout-recon.md) — automated tile-by-tile area scanning and abandonment scoring
- [Investigation](investigation.md) — escalate a location into an OSINT case
- [OSINT Pipeline](osint-pipeline.md) — auto-discovery backbone
- [Alerts & Watches](alerts.md) — monitor a location for new intel

