"use client"

import { useEffect, useRef, useState, useCallback, type ReactNode } from "react"
import maplibregl, { type StyleSpecification } from "maplibre-gl"
// @ts-ignore — @mapbox/mapbox-gl-draw ships no types; @types/mapbox__mapbox-gl-draw references mapbox-gl
import MapboxDraw from "@mapbox/mapbox-gl-draw"
// CSS for both libraries is loaded globally via globals.css

// ─── Types ────────────────────────────────────────────────────────────────────

type StatusKey =
  | "worth-exploring"
  | "not-interesting"
  | "inaccessible"
  | "demolished"
  | "visited"
  | "needs-more-research"

type BaseLayer =
  // Non-Esri
  | "dark" | "street" | "terrain"
  // Esri
  | "satellite" | "esri-topo" | "esri-street" | "esri-natgeo"
  | "esri-ocean" | "esri-relief" | "esri-physical"
  | "esri-light-gray" | "esri-dark-gray"
  // Historical
  | "ign-cassini" | "ign-etatmajor"
  | "nls-os6inch" | "nls-os1inch"
  | "openhistoricalmap" | "usgs-topo"

interface Checkpoint {
  id: string
  lngLat: { lng: number; lat: number }
  status: StatusKey
  label: string
  notes: string
  timestamp: Date
  tags: string[]
  customColor?: string
}

interface DrawnPolygon {
  id: string
  geometry: GeoJSON.Polygon
  label: string
  status: StatusKey | null
  timestamp: Date
  tags: string[]
}

type ToolMode = "off" | "distance" | "area" | "radius" | "placemark" | "draw-polygon"

interface SavedMeasurement {
  id: string
  type: "distance" | "area" | "radius"
  points: [number, number][]
  value: number
  label: string
  tags: string[]
  timestamp: Date
}

interface CheckpointDialogState {
  lngLat: { lng: number; lat: number }
  status: StatusKey
  screen: { x: number; y: number }
}

interface ContextMenuState {
  x: number
  y: number
  lngLat: { lng: number; lat: number }
}

interface NominatimResult {
  place_id: number
  display_name: string
  lat: string
  lon: string
  boundingbox: [string, string, string, string]
}

interface WaybackVersion {
  id: string
  date: string
  label: string
}

interface CadastreParcel {
  idu: string
  numero: string
  section: string
  nom_com: string
  code_dep: string
  code_insee: string
  contenance: number
  lngLat: { lng: number; lat: number }
}

interface CadastreCard {
  pos: { x: number; y: number }
  loading: boolean
  data: CadastreParcel | null
  error: boolean
}

interface DvfMutation {
  id_mutation: string
  date_mutation: string
  nature_mutation: string
  valeur_fonciere: string | null
  l_acheteur_denomination_usuelle: string[]
  l_acheteur_personne_physique: boolean[]
}

interface OwnerPipeline {
  parcel: CadastreParcel
  loading: boolean
  mutations: DvfMutation[]
  dvfError: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WAYBACK_CONFIG_URL =
  "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json"

function waybackTileUrl(id: string) {
  return `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${id}/{z}/{y}/{x}`
}

function formatWaybackDate(iso: string) {
  try {
    return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
      month: "short", year: "numeric", timeZone: "UTC",
    })
  } catch { return iso }
}

function formatArea(m2: number): string {
  const m2s = m2.toLocaleString("fr-FR") + " m²"
  if (m2 >= 10000) return `${(m2 / 10000).toFixed(3)} ha · ${m2s}`
  if (m2 >= 100) return `${(m2 / 100).toFixed(1)} a · ${m2s}`
  return m2s
}

// Esri Wayback availability: MapServer/1 is the "local changes" feature layer.
// Querying it with the current viewport returns roll_date values for versions
// that actually have updated imagery in that area.
const WAYBACK_AVAIL_URL =
  "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/1/query"

function lngLatToWebMercator(lng: number, lat: number) {
  return {
    x: lng * (Math.PI / 180) * 6378137,
    y: Math.log(Math.tan((90 + lat) * Math.PI / 360)) * 6378137,
  }
}

async function queryWaybackAvailability(
  west: number, south: number, east: number, north: number,
  allVersions: WaybackVersion[]
): Promise<WaybackVersion[]> {
  const sw = lngLatToWebMercator(west, south)
  const ne = lngLatToWebMercator(east, north)
  const envelope = { xmin: sw.x, ymin: sw.y, xmax: ne.x, ymax: ne.y, spatialReference: { wkid: 102100 } }
  const qs = new URLSearchParams({
    f: "json",
    geometry: JSON.stringify(envelope),
    geometryType: "esriGeometryEnvelope",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "roll_date",
    returnGeometry: "false",
    where: "1=1",
    resultRecordCount: "1000",
  })
  const res = await fetch(`${WAYBACK_AVAIL_URL}?${qs}`)
  if (!res.ok) return allVersions
  const data = await res.json()
  const features: { attributes: { roll_date?: string } }[] = data.features ?? []
  if (features.length === 0) return allVersions
  const availDates = new Set(features.map(f => f.attributes.roll_date ?? "").filter(Boolean))
  const filtered = allVersions.filter(v => availDates.has(v.date))
  return filtered.length > 0 ? filtered : allVersions
}

// IGN Géoplateforme WMTS helper — CORS open, free, France coverage only
const IGN_WMTS = (layer: string, fmt = "image%2Fpng", tms = "PM") =>
  `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&TILEMATRIXSET=${tms}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=${fmt}`

const NLS_S3 = "https://mapseries-tilesets.s3.amazonaws.com"

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services"
const ESRI_SATELLITE_TILES = [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`]

function rasterStyle(tiles: string[], attribution: string, background = "#aadaff"): StyleSpecification {
  return {
    version: 8,
    sources: { tiles: { type: "raster", tiles, tileSize: 256, attribution, maxzoom: 19 } },
    layers: [
      { id: "background", type: "background", paint: { "background-color": background } },
      { id: "raster-tiles", type: "raster", source: "tiles" },
    ],
  }
}

const ESRI_ATTR = "© Esri and the GIS Community"
const OSM_ATTR = "© OpenStreetMap contributors"

const STYLES: Record<BaseLayer, StyleSpecification> = {
  dark: rasterStyle(
    ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
     "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
     "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png"],
    `${OSM_ATTR}, © CARTO`, "#1a1a2e"
  ),
  street: rasterStyle(["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], OSM_ATTR, "#c8d8c8"),
  terrain: rasterStyle(["https://tile.opentopomap.org/{z}/{x}/{y}.png"], `${OSM_ATTR}, © OpenTopoMap`, "#d8e8d0"),
  // Esri basemaps — all free, no API key required
  satellite:        rasterStyle(ESRI_SATELLITE_TILES,                                                        ESRI_ATTR, "#1a2a1a"),
  "esri-topo":      rasterStyle([`${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`],                       ESRI_ATTR, "#d8e8d0"),
  "esri-street":    rasterStyle([`${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`],                     ESRI_ATTR, "#f0e8d0"),
  "esri-natgeo":    rasterStyle([`${ESRI}/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}`],                     ESRI_ATTR, "#e8d8c0"),
  "esri-ocean":     rasterStyle([`${ESRI}/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}`],               ESRI_ATTR, "#1a3a5c"),
  "esri-relief":    rasterStyle([`${ESRI}/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}`],                  ESRI_ATTR, "#d8d0c0"),
  "esri-physical":  rasterStyle([`${ESRI}/World_Physical_Map/MapServer/tile/{z}/{y}/{x}`],                   ESRI_ATTR, "#a8c8e8"),
  "esri-light-gray":rasterStyle([`${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`],         ESRI_ATTR, "#f5f5f0"),
  "esri-dark-gray": rasterStyle([`${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`],          ESRI_ATTR, "#2a2a2a"),
  // Historical — IGN France (data.geopf.fr, CORS open, free)
  // Layer IDs and TileMatrixSets from GetCapabilities; format must match each layer's offering
  "ign-cassini":   rasterStyle([IGN_WMTS("BNF-IGNF_GEOGRAPHICALGRIDSYSTEMS.CASSINI",  "image%2Fpng",  "PM_6_14")], "© IGN Géoplateforme", "#f5f0e4"),
  "ign-etatmajor": rasterStyle([IGN_WMTS("GEOGRAPHICALGRIDSYSTEMS.ETATMAJOR40",        "image%2Fjpeg", "PM_6_15")], "© IGN Géoplateforme", "#ede8d8"),
  // Historical — NLS (National Library of Scotland) public S3 tile sets — CORS enabled on GET
  "nls-os6inch":   rasterStyle([`${NLS_S3}/os/6inchsecond/{z}/{x}/{y}.png`],  "© National Library of Scotland", "#e8e0cc"),
  "nls-os1inch":   rasterStyle([`${NLS_S3}/1inch_2nd_ed/{z}/{x}/{y}.png`],    "© National Library of Scotland", "#e4dcc8"),
  // Historical — Bartholomew World Atlas c.1880–1920, NLS S3 (replaces OHM tile servers, which are down)
  "openhistoricalmap": rasterStyle([`${NLS_S3}/bartholomew-world/{z}/{x}/{y}.png`], "© National Library of Scotland / Bartholomew", "#f0ead8"),
  // USGS National Map Topo (US coverage, topographic style)
  "usgs-topo":      rasterStyle(["https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}"], "© USGS National Map", "#e4f0e4"),
}

// MapLibre GL v5: legacy filter arrays reject ["get","prop"] sub-arrays — use bare strings.
const DRAW_STYLES = [
  { id: "gl-draw-polygon-fill", type: "fill", filter: ["all", ["==", "$type", "Polygon"]], paint: { "fill-color": ["case", ["==", ["get", "active"], "true"], "#fbb03b", "#3bb2d0"], "fill-opacity": 0.1 } },
  { id: "gl-draw-lines-active", type: "line", filter: ["all", ["any", ["==", "$type", "LineString"], ["==", "$type", "Polygon"]], ["==", "active", "true"]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fbb03b", "line-dasharray": [0.2, 2], "line-width": 2 } },
  { id: "gl-draw-lines-inactive", type: "line", filter: ["all", ["any", ["==", "$type", "LineString"], ["==", "$type", "Polygon"]], ["!=", "active", "true"]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#3bb2d0", "line-dasharray": [2, 0], "line-width": 2 } },
  { id: "gl-draw-point-outer", type: "circle", filter: ["all", ["==", "$type", "Point"], ["==", "meta", "feature"]], paint: { "circle-radius": ["case", ["==", ["get", "active"], "true"], 7, 5], "circle-color": "#fff" } },
  { id: "gl-draw-point-inner", type: "circle", filter: ["all", ["==", "$type", "Point"], ["==", "meta", "feature"]], paint: { "circle-radius": ["case", ["==", ["get", "active"], "true"], 5, 3], "circle-color": ["case", ["==", ["get", "active"], "true"], "#fbb03b", "#3bb2d0"] } },
  { id: "gl-draw-vertex-outer", type: "circle", filter: ["all", ["==", "$type", "Point"], ["==", "meta", "vertex"], ["!=", "mode", "simple_select"]], paint: { "circle-radius": ["case", ["==", ["get", "active"], "true"], 7, 5], "circle-color": "#fff" } },
  { id: "gl-draw-vertex-inner", type: "circle", filter: ["all", ["==", "$type", "Point"], ["==", "meta", "vertex"], ["!=", "mode", "simple_select"]], paint: { "circle-radius": ["case", ["==", ["get", "active"], "true"], 5, 3], "circle-color": "#fbb03b" } },
  { id: "gl-draw-midpoint", type: "circle", filter: ["all", ["==", "meta", "midpoint"]], paint: { "circle-radius": 3, "circle-color": "#fbb03b" } },
]

const STATUSES: { key: StatusKey; label: string; color: string }[] = [
  { key: "worth-exploring", label: "Worth Exploring", color: "#22c55e" },
  { key: "not-interesting", label: "Not Interesting", color: "#71717a" },
  { key: "inaccessible", label: "Inaccessible", color: "#ef4444" },
  { key: "demolished", label: "Demolished", color: "#f97316" },
  { key: "visited", label: "Visited", color: "#3b82f6" },
  { key: "needs-more-research", label: "Needs More Research", color: "#a855f7" },
]

type RegionFilter = "all" | "fr" | "uk"

const STANDARD_LAYERS: { key: BaseLayer; label: string }[] = [
  { key: "dark", label: "Dark" },
  { key: "street", label: "Street (OSM)" },
  { key: "terrain", label: "Terrain (OSM)" },
]

const ESRI_LAYERS: { key: BaseLayer; label: string }[] = [
  { key: "satellite",         label: "Imagery" },
  { key: "esri-topo",         label: "Topo" },
  { key: "esri-street",       label: "Street" },
  { key: "esri-natgeo",       label: "Nat. Geo" },
  { key: "esri-ocean",        label: "Ocean" },
  { key: "esri-relief",       label: "Shaded Relief" },
  { key: "esri-physical",     label: "Physical" },
  { key: "esri-light-gray",   label: "Light Gray" },
  { key: "esri-dark-gray",    label: "Dark Gray" },
]

const HISTORICAL_LAYERS: { key: BaseLayer; label: string; note: string; regions: RegionFilter[] }[] = [
  { key: "ign-cassini",       label: "Cassini",     note: "FR · 18th c.",        regions: ["all", "fr"] },
  { key: "ign-etatmajor",     label: "État-Major",  note: "FR · 1820–1866",      regions: ["all", "fr"] },
  { key: "nls-os6inch",       label: "OS 6-inch",   note: "UK · 2nd ed.",        regions: ["all", "uk"] },
  { key: "nls-os1inch",       label: "OS 1-inch",   note: "UK · 1840s–1900s",    regions: ["all", "uk"] },
  { key: "openhistoricalmap", label: "Bartholomew", note: "Global · c.1880–1920", regions: ["all", "uk"] },
  { key: "usgs-topo",         label: "USGS Topo",   note: "US · national map",   regions: ["all"] },
]

const DORKS: { label: string; template: (loc: string) => string }[] = [
  { label: "Abandoned", template: (loc) => `"${loc}" abandoned` },
  { label: "Flickr photos", template: (loc) => `"${loc}" site:flickr.com` },
  { label: "Reddit urbex", template: (loc) => `"${loc}" site:reddit.com urbex` },
  { label: "History & plans", template: (loc) => `"${loc}" history plans blueprints filetype:pdf` },
]

// ─── Overlay helpers ───────────────────────────────────────────────────────────
//
// Z-order (bottom → top): raster-tiles → hillshade → buildings-fill → labels-overlay → draw layers → HTML markers
//
// Each add* function inserts before the first layer from the priority list so that
// toggling in any order always produces the correct visual stack.

function firstExistingLayer(map: maplibregl.Map, ...candidates: string[]): string | undefined {
  const ids = new Set(map.getStyle()?.layers?.map((l) => l.id) ?? [])
  for (const id of candidates) { if (ids.has(id)) return id }
  return map.getStyle()?.layers?.find((l) => l.id.startsWith("gl-draw-"))?.id
}

function addTerrainOverlay(map: maplibregl.Map) {
  if (map.getSource("terrain-dem")) return
  map.addSource("terrain-dem", {
    type: "raster-dem",
    tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
    encoding: "terrarium", tileSize: 256, maxzoom: 15,
  })
  map.addLayer(
    { id: "terrain-hillshade", type: "hillshade", source: "terrain-dem",
      paint: { "hillshade-illumination-direction": 335, "hillshade-exaggeration": 0.5, "hillshade-shadow-color": "#000", "hillshade-highlight-color": "#fff", "hillshade-accent-color": "#000" } },
    firstExistingLayer(map, "streetview-overlay", "cadastre-overlay", "buildings-fill", "labels-overlay")
  )
  try { map.setTerrain({ source: "terrain-dem", exaggeration: 1.5 }) } catch { /* */ }
}

function removeTerrainOverlay(map: maplibregl.Map) {
  try { map.setTerrain(null) } catch { /* */ }
  if (map.getLayer("terrain-hillshade")) map.removeLayer("terrain-hillshade")
  if (map.getSource("terrain-dem")) map.removeSource("terrain-dem")
}

// Building footprints via OpenFreeMap (free, no API key, OSM data, source-layer "building").
// Two layers: fill (area tint) + separate line (thick outline) — fill-outline-color only draws 1px.
// minzoom:13 because building geometry only appears in tiles at z13+.
function addBuildingsOverlay(map: maplibregl.Map) {
  if (map.getSource("buildings-vector")) return
  map.addSource("buildings-vector", { type: "vector", url: "https://tiles.openfreemap.org/planet" })
  const before = firstExistingLayer(map, "labels-overlay")
  map.addLayer(
    { id: "buildings-fill", type: "fill", source: "buildings-vector", "source-layer": "building",
      minzoom: 13,
      paint: { "fill-color": "rgba(255,200,50,0.18)", "fill-outline-color": "rgba(0,0,0,0)" } },
    before
  )
  map.addLayer(
    { id: "buildings-outline", type: "line", source: "buildings-vector", "source-layer": "building",
      minzoom: 13,
      paint: { "line-color": "rgba(255,215,50,0.95)", "line-width": 1.5 } },
    before
  )
}

function removeBuildingsOverlay(map: maplibregl.Map) {
  if (map.getLayer("buildings-outline")) map.removeLayer("buildings-outline")
  if (map.getLayer("buildings-fill")) map.removeLayer("buildings-fill")
  if (map.getSource("buildings-vector")) map.removeSource("buildings-vector")
}

// French cadastre parcels — IGN Géoplateforme WMTS, free, CORS open.
// TILEMATRIX={z}, TILEROW={y}, TILECOL={x} — MapLibre substitutes these in query strings.
// Only meaningful in France; tiles outside France return empty/transparent images.
function addCadastreOverlay(map: maplibregl.Map) {
  if (map.getSource("cadastre-raster")) return
  map.addSource("cadastre-raster", {
    type: "raster",
    tiles: ["https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=CADASTRALPARCELS.PARCELLAIRE_EXPRESS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image%2Fpng"],
    tileSize: 256,
    attribution: "© IGN Géoplateforme",
    minzoom: 12,
    maxzoom: 20,
  })
  map.addLayer(
    { id: "cadastre-overlay", type: "raster", source: "cadastre-raster",
      paint: { "raster-opacity": 0.85 } },
    firstExistingLayer(map, "buildings-fill", "labels-overlay")
  )
}

function removeCadastreOverlay(map: maplibregl.Map) {
  if (map.getLayer("cadastre-overlay")) map.removeLayer("cadastre-overlay")
  if (map.getSource("cadastre-raster")) map.removeSource("cadastre-raster")
}

// Google Street View coverage — shows blue lines/dots where SV imagery exists.
// Uses internal Google Maps tile endpoint (no API key, same as embedded Google Maps).
function addStreetViewOverlay(map: maplibregl.Map) {
  if (map.getSource("streetview-raster")) return
  map.addSource("streetview-raster", {
    type: "raster",
    // lyrs=svv|cb_client:apiv3 = Street View coverage + connected roads overlay
    tiles: ["https://mts0.googleapis.com/vt?hl=en-US&lyrs=svv|cb_client:apiv3&style=40,18&x={x}&y={y}&z={z}"],
    tileSize: 256,
    attribution: "© Google",
  })
  map.addLayer(
    { id: "streetview-overlay", type: "raster", source: "streetview-raster",
      paint: { "raster-opacity": 0.75 } },
    firstExistingLayer(map, "cadastre-overlay", "buildings-fill", "labels-overlay")
  )
}

function removeStreetViewOverlay(map: maplibregl.Map) {
  if (map.getLayer("streetview-overlay")) map.removeLayer("streetview-overlay")
  if (map.getSource("streetview-raster")) map.removeSource("streetview-raster")
}

// Labels overlay via CARTO voyager_only_labels — transparent tiles, text only, halos for readability
function addLabelsOverlay(map: maplibregl.Map) {
  if (map.getSource("labels-raster")) return
  map.addSource("labels-raster", {
    type: "raster",
    tiles: [
      "https://a.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png",
      "https://b.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png",
      "https://c.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png",
    ],
    tileSize: 256, attribution: "© CARTO",
  })
  map.addLayer(
    { id: "labels-overlay", type: "raster", source: "labels-raster" },
    map.getStyle()?.layers?.find((l) => l.id.startsWith("gl-draw-"))?.id
  )
}

function removeLabelsOverlay(map: maplibregl.Map) {
  if (map.getLayer("labels-overlay")) map.removeLayer("labels-overlay")
  if (map.getSource("labels-raster")) map.removeSource("labels-raster")
}

// Night lights — NASA GIBS VIIRS SNPP Day/Night Band ENCC, 2023 annual composite
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best"
const GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi"

function addNightLightsOverlay(map: maplibregl.Map) {
  if (map.getSource("nightlights-raster")) return
  map.addSource("nightlights-raster", {
    type: "raster",
    tiles: [`${GIBS}/VIIRS_SNPP_DayNightBand_ENCC/default/2023-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`],
    tileSize: 256, attribution: "© NASA GIBS / VIIRS SNPP", maxzoom: 8,
  })
  map.addLayer(
    { id: "nightlights-overlay", type: "raster", source: "nightlights-raster",
      paint: { "raster-opacity": 0.85 } },
    firstExistingLayer(map, "streetview-overlay", "cadastre-overlay", "buildings-fill", "labels-overlay")
  )
}
function removeNightLightsOverlay(map: maplibregl.Map) {
  if (map.getLayer("nightlights-overlay")) map.removeLayer("nightlights-overlay")
  if (map.getSource("nightlights-raster")) map.removeSource("nightlights-raster")
}

// Active wildfires — NASA GIBS MODIS Combined Thermal Anomalies via WMS (today's date)
function addFiresOverlay(map: maplibregl.Map) {
  if (map.getSource("fires-raster")) return
  const date = new Date().toISOString().slice(0, 10)
  map.addSource("fires-raster", {
    type: "raster",
    tiles: [`${GIBS_WMS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=MODIS_Combined_Thermal_Anomalies_All&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&SRS=EPSG:3857&FORMAT=image/png&TRANSPARENT=TRUE&TIME=${date}`],
    tileSize: 256, attribution: "© NASA GIBS / MODIS",
  })
  map.addLayer(
    { id: "fires-overlay", type: "raster", source: "fires-raster",
      paint: { "raster-opacity": 0.9 } },
    firstExistingLayer(map, "labels-overlay")
  )
}
function removeFiresOverlay(map: maplibregl.Map) {
  if (map.getLayer("fires-overlay")) map.removeLayer("fires-overlay")
  if (map.getSource("fires-raster")) map.removeSource("fires-raster")
}

// Flood extent — NASA GIBS VIIRS Combined Flood 3-Day (today's date)
function addFloodsOverlay(map: maplibregl.Map) {
  if (map.getSource("floods-raster")) return
  const date = new Date().toISOString().slice(0, 10)
  map.addSource("floods-raster", {
    type: "raster",
    tiles: [`${GIBS}/VIIRS_Combined_Flood_3-Day/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`],
    tileSize: 256, attribution: "© NASA GIBS / VIIRS Flood", maxzoom: 9,
  })
  map.addLayer(
    { id: "floods-overlay", type: "raster", source: "floods-raster",
      paint: { "raster-opacity": 0.75 } },
    firstExistingLayer(map, "fires-overlay", "labels-overlay")
  )
}
function removeFloodsOverlay(map: maplibregl.Map) {
  if (map.getLayer("floods-overlay")) map.removeLayer("floods-overlay")
  if (map.getSource("floods-raster")) map.removeSource("floods-raster")
}

// Permanent water bodies — JRC Global Surface Water 2021 occurrence tiles
function addWaterOverlay(map: maplibregl.Map) {
  if (map.getSource("water-jrc-raster")) return
  map.addSource("water-jrc-raster", {
    type: "raster",
    tiles: ["https://storage.googleapis.com/global-surface-water/tiles2021/occurrence/{z}/{x}/{y}.png"],
    tileSize: 256, attribution: "© JRC / Global Surface Water", maxzoom: 13,
  })
  map.addLayer(
    { id: "water-jrc-overlay", type: "raster", source: "water-jrc-raster",
      paint: { "raster-opacity": 0.7 } },
    firstExistingLayer(map, "streetview-overlay", "cadastre-overlay", "buildings-fill", "labels-overlay")
  )
}
function removeWaterOverlay(map: maplibregl.Map) {
  if (map.getLayer("water-jrc-overlay")) map.removeLayer("water-jrc-overlay")
  if (map.getSource("water-jrc-raster")) map.removeSource("water-jrc-raster")
}

// Tree cover & forest loss — Global Forest Watch Hansen/UMD dataset
function addForestOverlay(map: maplibregl.Map) {
  if (map.getSource("forest-raster")) return
  map.addSource("forest-raster", {
    type: "raster",
    tiles: ["https://tiles.globalforestwatch.org/umd_tree_cover_loss/v1.8/tcd_30/{z}/{x}/{y}.png"],
    tileSize: 256, attribution: "© Global Forest Watch / Hansen·UMD", maxzoom: 12,
  })
  map.addLayer(
    { id: "forest-overlay", type: "raster", source: "forest-raster",
      paint: { "raster-opacity": 0.7 } },
    firstExistingLayer(map, "streetview-overlay", "cadastre-overlay", "buildings-fill", "labels-overlay")
  )
}
function removeForestOverlay(map: maplibregl.Map) {
  if (map.getLayer("forest-overlay")) map.removeLayer("forest-overlay")
  if (map.getSource("forest-raster")) map.removeSource("forest-raster")
}

// OSM infrastructure — industrial zones, military areas (OpenFreeMap planet vector tiles)
const INFRA_LAYERS = ["infra-industrial-fill","infra-industrial-line","infra-military-fill","infra-military-line","infra-aerodrome-fill"] as const
function addInfraOverlay(map: maplibregl.Map) {
  if (map.getSource("infra-vector")) return
  map.addSource("infra-vector", { type: "vector", url: "https://tiles.openfreemap.org/planet" })
  const before = firstExistingLayer(map, "labels-overlay")
  map.addLayer({ id: "infra-industrial-fill", type: "fill", source: "infra-vector", "source-layer": "landuse",
    filter: ["==", ["get", "class"], "industrial"], minzoom: 8,
    paint: { "fill-color": "rgba(255,140,0,0.22)" } }, before)
  map.addLayer({ id: "infra-industrial-line", type: "line", source: "infra-vector", "source-layer": "landuse",
    filter: ["==", ["get", "class"], "industrial"], minzoom: 8,
    paint: { "line-color": "rgba(255,165,40,0.85)", "line-width": 1 } }, before)
  map.addLayer({ id: "infra-military-fill", type: "fill", source: "infra-vector", "source-layer": "landuse",
    filter: ["==", ["get", "class"], "military"], minzoom: 6,
    paint: { "fill-color": "rgba(200,30,30,0.22)" } }, before)
  map.addLayer({ id: "infra-military-line", type: "line", source: "infra-vector", "source-layer": "landuse",
    filter: ["==", ["get", "class"], "military"], minzoom: 6,
    paint: { "line-color": "rgba(220,50,50,0.85)", "line-width": 1.5, "line-dasharray": [4, 2] } }, before)
  map.addLayer({ id: "infra-aerodrome-fill", type: "fill", source: "infra-vector", "source-layer": "landuse",
    filter: ["==", ["get", "class"], "aerodrome"], minzoom: 6,
    paint: { "fill-color": "rgba(80,160,255,0.22)" } }, before)
}
function removeInfraOverlay(map: maplibregl.Map) {
  for (const id of INFRA_LAYERS) { if (map.getLayer(id)) map.removeLayer(id) }
  if (map.getSource("infra-vector")) map.removeSource("infra-vector")
}

// Z-order: hillshade → SV coverage → cadastre → buildings → labels → draw
function applyActiveOverlays(
  map: maplibregl.Map,
  terrain: boolean, streetview: boolean, cadastre: boolean, buildings: boolean, labels: boolean,
  nightLights: boolean, fires: boolean, floods: boolean, water: boolean, forest: boolean, infra: boolean
) {
  if (terrain) addTerrainOverlay(map)
  if (streetview) addStreetViewOverlay(map)
  if (cadastre) addCadastreOverlay(map)
  if (buildings) addBuildingsOverlay(map)
  if (labels) addLabelsOverlay(map)
  if (nightLights) addNightLightsOverlay(map)
  if (fires) addFiresOverlay(map)
  if (floods) addFloodsOverlay(map)
  if (water) addWaterOverlay(map)
  if (forest) addForestOverlay(map)
  if (infra) addInfraOverlay(map)
}

// ─── Misc helpers ──────────────────────────────────────────────────────────────

function computeCentroid(geometry: GeoJSON.Polygon): [number, number] {
  const ring = geometry.coordinates[0]; const n = ring.length - 1
  let sumLng = 0; let sumLat = 0
  for (let i = 0; i < n; i++) { sumLng += ring[i][0]; sumLat += ring[i][1] }
  return [sumLng / n, sumLat / n]
}

function makeMarkerEl(color: string): HTMLDivElement {
  const el = document.createElement("div")
  Object.assign(el.style, { width: "16px", height: "16px", borderRadius: "50%", background: color, border: "2px solid rgba(255,255,255,0.75)", boxShadow: "0 2px 6px rgba(0,0,0,0.5)", cursor: "pointer", transition: "transform 0.1s" })
  el.addEventListener("mouseenter", () => { el.style.transform = "scale(1.35)" })
  el.addEventListener("mouseleave", () => { el.style.transform = "scale(1)" })
  return el
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }

// ─── Measurement helpers ───────────────────────────────────────────────────────

function segmentDist(p1: [number, number], p2: [number, number]): number {
  return new maplibregl.LngLat(p1[0], p1[1]).distanceTo(new maplibregl.LngLat(p2[0], p2[1]))
}

function pathLength(pts: [number, number][]): number {
  let d = 0
  for (let i = 0; i < pts.length - 1; i++) d += segmentDist(pts[i], pts[i + 1])
  return d
}

// Spherical shoelace (Girard's theorem approximation) — adequate for <500 km² areas
function sphericalArea(pts: [number, number][]): number {
  if (pts.length < 3) return 0
  const R = 6371000
  let area = 0
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const [lng1, lat1] = pts[i]
    const [lng2, lat2] = pts[(i + 1) % n]
    area += (lng2 - lng1) * (Math.PI / 180) *
      (2 + Math.sin(lat1 * Math.PI / 180) + Math.sin(lat2 * Math.PI / 180))
  }
  return Math.abs(area * R * R / 2)
}

function circleRing(center: [number, number], radiusM: number, n = 64): [number, number][] {
  const R = 6371000
  const [lng0, lat0] = center
  const lat0r = lat0 * Math.PI / 180
  const ring: [number, number][] = []
  for (let i = 0; i <= n; i++) {
    const angle = (i / n) * 2 * Math.PI
    const dLat = (radiusM / R) * Math.cos(angle)
    const dLng = (radiusM / R) * Math.sin(angle) / Math.cos(lat0r)
    ring.push([lng0 + dLng * 180 / Math.PI, lat0 + dLat * 180 / Math.PI])
  }
  return ring
}

function fmtDist(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`
  return `${Math.round(m)} m`
}

function fmtMeasureArea(m2: number): string {
  if (m2 >= 1_000_000) return `${(m2 / 1_000_000).toFixed(2)} km²`
  if (m2 >= 10_000) return `${(m2 / 10_000).toFixed(2)} ha`
  return `${Math.round(m2)} m²`
}

// ─── Persistent user-data layers (polygons + saved measurements) ──────────────

const USER_POLY_SOURCE  = "user-polygons"
const SAVED_MEAS_SOURCE = "saved-measures"

function initUserLayers(map: maplibregl.Map) {
  if (!map.getSource(USER_POLY_SOURCE)) {
    map.addSource(USER_POLY_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } })
    map.addLayer({ id: "user-poly-fill", type: "fill", source: USER_POLY_SOURCE,
      paint: { "fill-color": ["coalesce", ["get", "fillColor"], "#3bb2d0"], "fill-opacity": 0.18 } })
    map.addLayer({ id: "user-poly-outline", type: "line", source: USER_POLY_SOURCE,
      paint: { "line-color": ["coalesce", ["get", "strokeColor"], "#3bb2d0"], "line-width": 2 } })
  }
  if (!map.getSource(SAVED_MEAS_SOURCE)) {
    map.addSource(SAVED_MEAS_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } })
    map.addLayer({ id: "saved-meas-fill", type: "fill", source: SAVED_MEAS_SOURCE,
      filter: ["match", ["get", "t"], ["area-fill", "radius-fill"], true, false],
      paint: { "fill-color": "#38bdf8", "fill-opacity": 0.12 } })
    map.addLayer({ id: "saved-meas-line", type: "line", source: SAVED_MEAS_SOURCE,
      filter: ["match", ["get", "t"], ["line", "area-outline", "radius-outline", "radius-spoke"], true, false],
      paint: { "line-color": "#38bdf8", "line-width": 1.5, "line-dasharray": [4, 2] } })
  }
}

function updateUserPolygons(map: maplibregl.Map, polygons: DrawnPolygon[]) {
  const src = map.getSource(USER_POLY_SOURCE) as maplibregl.GeoJSONSource | undefined
  if (!src) return
  src.setData({
    type: "FeatureCollection",
    features: polygons.map(p => {
      const statusColors: Record<string, string> = {
        "worth-exploring": "#22c55e", "not-interesting": "#71717a", "inaccessible": "#ef4444",
        "demolished": "#f97316", "visited": "#3b82f6", "needs-more-research": "#a855f7",
      }
      const base = p.status ? (statusColors[p.status] ?? "#3bb2d0") : "#3bb2d0"
      return {
        type: "Feature" as const,
        id: p.id,
        geometry: p.geometry,
        properties: { polyId: p.id, fillColor: base, strokeColor: base },
      }
    }),
  })
}

function buildSavedMeasureFeatures(measurements: SavedMeasurement[]): GeoJSON.Feature[] {
  const out: GeoJSON.Feature[] = []
  for (const m of measurements) {
    const pts = m.points
    if (pts.length < 2) continue
    if (m.type === "distance") {
      out.push({ type: "Feature", geometry: { type: "LineString", coordinates: pts }, properties: { t: "line", id: m.id } })
    } else if (m.type === "area" && pts.length >= 3) {
      const ring = [...pts, pts[0]]
      out.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: { t: "area-fill", id: m.id } })
      out.push({ type: "Feature", geometry: { type: "LineString", coordinates: ring }, properties: { t: "area-outline", id: m.id } })
    } else if (m.type === "radius") {
      const ring = circleRing(pts[0], segmentDist(pts[0], pts[1]))
      out.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: { t: "radius-fill", id: m.id } })
      out.push({ type: "Feature", geometry: { type: "LineString", coordinates: ring }, properties: { t: "radius-outline", id: m.id } })
      out.push({ type: "Feature", geometry: { type: "LineString", coordinates: [pts[0], pts[1]] }, properties: { t: "radius-spoke", id: m.id } })
    }
  }
  return out
}

function updateSavedMeasures(map: maplibregl.Map, measurements: SavedMeasurement[]) {
  const src = map.getSource(SAVED_MEAS_SOURCE) as maplibregl.GeoJSONSource | undefined
  if (!src) return
  src.setData({ type: "FeatureCollection", features: buildSavedMeasureFeatures(measurements) })
}

// ─── Measure map layers ────────────────────────────────────────────────────────

const MEASURE_SOURCE = "measure-source"

function initMeasureLayers(map: maplibregl.Map) {
  if (map.getSource(MEASURE_SOURCE)) return
  map.addSource(MEASURE_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } })
  map.addLayer({ id: "measure-fill", type: "fill", source: MEASURE_SOURCE,
    filter: ["match", ["get", "t"], ["area-fill", "radius-fill"], true, false],
    paint: { "fill-color": "#38bdf8", "fill-opacity": 0.15 } })
  map.addLayer({ id: "measure-line", type: "line", source: MEASURE_SOURCE,
    filter: ["match", ["get", "t"], ["line", "area-outline", "radius-outline", "radius-spoke"], true, false],
    paint: { "line-color": "#38bdf8", "line-width": 2, "line-dasharray": [3, 1.5] } })
  map.addLayer({ id: "measure-pts", type: "circle", source: MEASURE_SOURCE,
    filter: ["==", ["get", "t"], "pt"],
    paint: { "circle-radius": 5, "circle-color": "#38bdf8", "circle-stroke-width": 2, "circle-stroke-color": "#fff" } })
  // Snap-to-close ring on first vertex (draw-polygon only)
  map.addLayer({ id: "measure-pts-close", type: "circle", source: MEASURE_SOURCE,
    filter: ["==", ["get", "t"], "pt-close"],
    paint: { "circle-radius": 10, "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": 2, "circle-stroke-color": "#38bdf8" } })
}

function updateMeasureLayers(
  map: maplibregl.Map, mode: ToolMode,
  pts: [number, number][], preview: [number, number] | null
) {
  const src = map.getSource(MEASURE_SOURCE) as maplibregl.GeoJSONSource | undefined
  if (!src) return
  // For radius: once 2 pts are placed, ignore preview so the circle stays fixed
  const effectivePreview = (mode === "radius" && pts.length >= 2) ? null : preview
  const all = effectivePreview ? [...pts, effectivePreview] : pts
  const features: GeoJSON.Feature[] = []

  // Placed vertex dots — all modes including draw-polygon
  for (const p of pts) {
    features.push({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: { t: "pt" } })
  }

  if (mode === "distance" && all.length >= 2) {
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: all }, properties: { t: "line" } })
  } else if ((mode === "area" || mode === "draw-polygon") && all.length >= 3) {
    const ring = [...all, all[0]]
    features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: { t: "area-fill" } })
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: ring }, properties: { t: "area-outline" } })
  } else if ((mode === "area" || mode === "draw-polygon") && all.length === 2) {
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: all }, properties: { t: "area-outline" } })
  } else if (mode === "radius") {
    if (pts.length >= 1 && all.length >= 2) {
      const center = pts[0]
      const edgePt = pts.length >= 2 ? pts[1] : all[all.length - 1]
      const radius = segmentDist(center, edgePt)
      const ring = circleRing(center, radius)
      features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: { t: "radius-fill" } })
      features.push({ type: "Feature", geometry: { type: "LineString", coordinates: ring }, properties: { t: "radius-outline" } })
      features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [center, edgePt] }, properties: { t: "radius-spoke" } })
    }
  }

  // Snap-to-close ring on first vertex once polygon is closeable
  if (mode === "draw-polygon" && pts.length >= 3) {
    features.push({ type: "Feature", geometry: { type: "Point", coordinates: pts[0] }, properties: { t: "pt-close" } })
  }

  src.setData({ type: "FeatureCollection", features })
}

function removeMeasureLayers(map: maplibregl.Map) {
  for (const id of ["measure-pts-close", "measure-pts", "measure-line", "measure-fill"]) {
    if (map.getLayer(id)) map.removeLayer(id)
  }
  if (map.getSource(MEASURE_SOURCE)) map.removeSource(MEASURE_SOURCE)
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function UrbexMap() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drawRef = useRef<any>(null)
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const labelMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const polygonsRef = useRef<DrawnPolygon[]>([])
  const baseLayerRef = useRef<BaseLayer>("dark")
  const initRef = useRef(false)
  // Refs for values used inside async style.load callbacks
  const waybackIdxRef = useRef<number | null>(null)
  const waybackVersionsRef = useRef<WaybackVersion[]>([])
  const terrainRef = useRef(false)
  const streetViewRef = useRef(false)
  const cadastreRef = useRef(false)
  const buildingsRef = useRef(false)
  const labelsRef = useRef(false)
  const nightLightsRef = useRef(false)
  const firesRef = useRef(false)
  const floodsRef = useRef(false)
  const waterRef = useRef(false)
  const forestRef = useRef(false)
  const infraRef = useRef(false)
  const streetViewModeRef = useRef(false)
  const globeModeRef = useRef(false)
  const toolModeRef = useRef<ToolMode>("off")
  const measurePointsRef = useRef<[number, number][]>([])
  const savedMeasurementsRef = useRef<SavedMeasurement[]>([])
  const filteredVersionsRef = useRef<WaybackVersion[]>([])
  const selectedVersionIdRef = useRef<string | null>(null)
  const availCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [coords, setCoords] = useState({ lng: 2.3522, lat: 48.8566 })
  const [baseLayer, setBaseLayer] = useState<BaseLayer>("dark")
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const [polygons, setPolygons] = useState<DrawnPolygon[]>([])
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<Checkpoint | null>(null)
  const [selectedPolygon, setSelectedPolygon] = useState<DrawnPolygon | null>(null)
  const [areaMenuPos, setAreaMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [researchOpen, setResearchOpen] = useState(false)
  const [researchQuery, setResearchQuery] = useState("")
  const [useCtx, setUseCtx] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  // Wayback
  const [waybackVersions, setWaybackVersions] = useState<WaybackVersion[]>([])
  const [waybackIdx, setWaybackIdx] = useState<number | null>(null)
  const [waybackLoading, setWaybackLoading] = useState(false)
  const [filteredVersions, setFilteredVersions] = useState<WaybackVersion[]>([])
  const [waybackAvailLoading, setWaybackAvailLoading] = useState(false)
  // Overlays
  const [terrainOverlay, setTerrainOverlay] = useState(false)
  const [streetViewOverlay, setStreetViewOverlay] = useState(false)
  const [cadastreOverlay, setCadastreOverlay] = useState(false)
  const [buildingsOverlay, setBuildingsOverlay] = useState(false)
  const [labelsOverlay, setLabelsOverlay] = useState(false)
  const [nightLightsOverlay, setNightLightsOverlay] = useState(false)
  const [firesOverlay, setFiresOverlay] = useState(false)
  const [floodsOverlay, setFloodsOverlay] = useState(false)
  const [waterOverlay, setWaterOverlay] = useState(false)
  const [forestOverlay, setForestOverlay] = useState(false)
  const [infraOverlay, setInfraOverlay] = useState(false)
  const [overlaysOpen, setOverlaysOpen] = useState(false)
  const [regionFilter, setRegionFilter] = useState<RegionFilter>("all")
  const [streetViewMode, setStreetViewMode] = useState(false)
  const [globeMode, setGlobeMode] = useState(false)
  const [cadastreCard, setCadastreCard] = useState<CadastreCard | null>(null)
  const [ownerPipeline, setOwnerPipeline] = useState<OwnerPipeline | null>(null)
  // Search
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([])
  const [searchOpen, setSearchOpen] = useState(false)

  // Tool mode + measurement
  const [toolMode, setToolMode] = useState<ToolMode>("off")
  const [measurePoints, setMeasurePoints] = useState<[number, number][]>([])
  const [measurePreview, setMeasurePreview] = useState<[number, number] | null>(null)
  const [savedMeasurements, setSavedMeasurements] = useState<SavedMeasurement[]>([])

  // Checkpoint dialog (shown after right-click status pick)
  const [checkpointDialog, setCheckpointDialog] = useState<CheckpointDialogState | null>(null)
  const [checkpointName, setCheckpointName] = useState("")
  const [checkpointTagInput, setCheckpointTagInput] = useState("")

  // Locations panel
  const [locationsOpen, setLocationsOpen] = useState(false)
  const [locationsPanelPos, setLocationsPanelPos] = useState({ x: 16, y: 320 })
  const [locationsSearch, setLocationsSearch] = useState("")
  const [locationsTypeFilter, setLocationsTypeFilter] = useState<"all" | "checkpoint" | "polygon" | "measurement">("all")
  const [locationsTagFilter, setLocationsTagFilter] = useState<string | null>(null)
  const locationsDragRef = useRef<{ startX: number; startY: number; startPX: number; startPY: number } | null>(null)

  useEffect(() => { polygonsRef.current = polygons }, [polygons])

  // Sync polygons → persistent map layer
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    updateUserPolygons(map, polygons)
  }, [polygons])

  // Sync saved measurements → persistent map layer
  useEffect(() => {
    savedMeasurementsRef.current = savedMeasurements
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    updateSavedMeasures(map, savedMeasurements)
  }, [savedMeasurements])

  const showToast = useCallback((msg: string) => {
    setToast(msg); setTimeout(() => setToast(null), 3000)
  }, [])

  const checkWaybackAvailability = useCallback(async () => {
    const map = mapRef.current
    const versions = waybackVersionsRef.current
    if (!map || versions.length === 0) return
    setWaybackAvailLoading(true)
    try {
      const b = map.getBounds()
      const filtered = await queryWaybackAvailability(
        b.getWest(), b.getSouth(), b.getEast(), b.getNorth(), versions
      )
      setFilteredVersions(filtered)
    } catch {
      setFilteredVersions(waybackVersionsRef.current)
    } finally {
      setWaybackAvailLoading(false)
    }
  }, [])

  // ── Map init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (initRef.current || !containerRef.current) return
    initRef.current = true
    const map = new maplibregl.Map({
      container: containerRef.current, style: STYLES["dark"],
      center: [2.3522, 48.8566], zoom: 11,
      scrollZoom: true, dragPan: true, dragRotate: true, doubleClickZoom: true, touchZoomRotate: true,
    })
    mapRef.current = map
    map.on("mousemove", (e) => {
      setCoords({ lng: e.lngLat.lng, lat: e.lngLat.lat })
      const tm = toolModeRef.current
      const radiusDone = tm === "radius" && measurePointsRef.current.length >= 2
      if (tm !== "off" && tm !== "placemark" && !radiusDone) {
        setMeasurePreview([e.lngLat.lng, e.lngLat.lat])
      }
    })
    map.on("contextmenu", (e) => {
      if (streetViewModeRef.current) return
      if (toolModeRef.current !== "off") return
      e.preventDefault()
      setContextMenu({ x: e.point.x, y: e.point.y, lngLat: { lng: e.lngLat.lng, lat: e.lngLat.lat } })
      setSelectedCheckpoint(null); setSelectedPolygon(null); setAreaMenuPos(null)
    })
    map.on("click", (e) => {
      // Measure / placemark tool intercepts all clicks
      const tm = toolModeRef.current
      if (tm !== "off") {
        if (tm === "placemark") {
          const { x, y } = e.point
          setCheckpointDialog({ lngLat: { lng: e.lngLat.lng, lat: e.lngLat.lat }, status: "worth-exploring", screen: { x, y } })
          setCheckpointName("")
          setCheckpointTagInput("")
          return
        }
        // draw-polygon: check close-on-first-vertex
        if (tm === "draw-polygon") {
          const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat]
          const pts = measurePointsRef.current
          if (pts.length >= 3) {
            const firstScreen = map.project([pts[0][0], pts[0][1]])
            const dist = Math.hypot(e.point.x - firstScreen.x, e.point.y - firstScreen.y)
            if (dist < 14) {
              // close the shape
              const id = crypto.randomUUID()
              const ring: [number, number][] = [...pts, pts[0]]
              const geometry: GeoJSON.Polygon = { type: "Polygon", coordinates: [ring] }
              const label = `Area ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              const poly: DrawnPolygon = { id, geometry, label, status: null, timestamp: new Date(), tags: [] }
              setPolygons(prev => [...prev, poly])
              const [clng, clat] = computeCentroid(geometry)
              const labelEl = document.createElement("div")
              Object.assign(labelEl.style, { background: "rgba(0,0,0,0.72)", color: "#d4d4d8", fontSize: "11px", fontFamily: "ui-sans-serif, system-ui, sans-serif", padding: "2px 8px", borderRadius: "4px", whiteSpace: "nowrap", pointerEvents: "none", border: "1px solid rgba(255,255,255,0.1)" })
              labelEl.textContent = label
              labelMarkersRef.current.set(id, new maplibregl.Marker({ element: labelEl }).setLngLat([clng, clat]).addTo(map))
              toolModeRef.current = "off"; setToolMode("off")
              measurePointsRef.current = []; setMeasurePoints([]); setMeasurePreview(null)
              return
            }
          }
          const newPts = [...pts, pt]
          measurePointsRef.current = newPts; setMeasurePoints(newPts)
          return
        }

        // measure modes
        const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat]
        const newPts = [...measurePointsRef.current, pt]
        measurePointsRef.current = newPts
        setMeasurePoints(newPts)
        // radius: auto-finish after 2 points — preview cleared by effect (effectivePreview handles it)
        return
      }

      if (streetViewModeRef.current) {
        const { lat, lng } = e.lngLat
        window.open(
          `https://www.google.com/maps/@${lat},${lng},3a,75y,0h,90t/data=!3m1!1e1`,
          "_blank", "noopener,noreferrer"
        )
        return
      }
      setContextMenu(null)
      if (cadastreRef.current) {
        const { x, y } = e.point
        const { lng, lat } = e.lngLat
        setCadastreCard({ pos: { x, y }, loading: true, data: null, error: false })
        fetch(`https://apicarto.ign.fr/api/cadastre/parcelle?lon=${lng.toFixed(6)}&lat=${lat.toFixed(6)}`)
          .then((r) => { if (!r.ok) throw new Error("http"); return r.json() })
          .then((data) => {
            const props = data.features?.[0]?.properties
            if (!props) { setCadastreCard((prev) => prev ? { ...prev, loading: false, error: true } : null); return }
            setCadastreCard((prev) => prev ? {
              ...prev, loading: false,
              data: {
                idu: props.idu ?? "",
                numero: props.numero ?? "",
                section: props.section ?? "",
                nom_com: props.nom_com ?? "",
                code_dep: props.code_dep ?? "",
                code_insee: props.code_insee ?? "",
                contenance: props.contenance ?? 0,
                lngLat: { lng, lat },
              },
            } : null)
          })
          .catch(() => { setCadastreCard((prev) => prev ? { ...prev, loading: false, error: true } : null) })
        return
      }
    })
    map.on("moveend", () => {
      if (baseLayerRef.current !== "satellite") return
      if (availCheckTimeoutRef.current) clearTimeout(availCheckTimeoutRef.current)
      availCheckTimeoutRef.current = setTimeout(() => { checkWaybackAvailability() }, 500)
    })
    map.once("load", () => {
      if (!mapRef.current) return
      map.resize()
      applyActiveOverlays(map, terrainRef.current, streetViewRef.current, cadastreRef.current, buildingsRef.current, labelsRef.current, nightLightsRef.current, firesRef.current, floodsRef.current, waterRef.current, forestRef.current, infraRef.current)
      initUserLayers(map)
      // Click on a drawn polygon → show area action menu
      map.on("click", "user-poly-fill", (e) => {
        if (toolModeRef.current !== "off") return
        const feat = e.features?.[0]
        if (!feat) return
        const polyId = feat.properties?.polyId as string | undefined
        const poly = polygonsRef.current.find(p => p.id === polyId)
        if (!poly) return
        const [lng, lat] = computeCentroid(poly.geometry)
        const pt = map.project([lng, lat])
        setSelectedPolygon(poly)
        setAreaMenuPos({ x: clamp(pt.x - 112, 8, window.innerWidth - 240), y: clamp(pt.y - 20, 8, window.innerHeight - 420) })
        setSelectedCheckpoint(null); setContextMenu(null)
      })
      map.on("mouseenter", "user-poly-fill", () => { if (toolModeRef.current === "off") map.getCanvas().style.cursor = "pointer" })
      map.on("mouseleave", "user-poly-fill", () => { if (toolModeRef.current === "off") map.getCanvas().style.cursor = "" })
      const draw = new MapboxDraw({ displayControlsDefault: false, controls: {}, defaultMode: "simple_select", styles: DRAW_STYLES })
      map.addControl(draw as unknown as maplibregl.IControl)
      drawRef.current = draw
    })
    return () => { initRef.current = false; map.remove(); mapRef.current = null; drawRef.current = null }
  }, [])

  // ── Base layer switch ──────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || baseLayer === baseLayerRef.current) return
    baseLayerRef.current = baseLayer
    const oldDraw = drawRef.current
    let savedFeatures: ReturnType<typeof oldDraw.getAll> | null = null
    if (oldDraw) {
      try { savedFeatures = oldDraw.getAll() } catch { /* */ }
      try { map.removeControl(oldDraw as unknown as maplibregl.IControl) } catch { /* */ }
    }
    drawRef.current = null
    map.setStyle(STYLES[baseLayer])
    map.once("style.load", () => {
      // Restore Wayback tile if returning to satellite with a version selected
      if (baseLayer === "satellite") {
        const idx = waybackIdxRef.current
        const activeVersions = filteredVersionsRef.current.length > 0
          ? filteredVersionsRef.current
          : waybackVersionsRef.current
        if (idx !== null && activeVersions[idx]) {
          const src = map.getSource("tiles") as maplibregl.RasterTileSource | undefined
          src?.setTiles([waybackTileUrl(activeVersions[idx].id)])
        }
        // Re-check availability for the current view when returning to satellite
        if (waybackVersionsRef.current.length > 0) checkWaybackAvailability()
      }
      applyActiveOverlays(map, terrainRef.current, streetViewRef.current, cadastreRef.current, buildingsRef.current, labelsRef.current, nightLightsRef.current, firesRef.current, floodsRef.current, waterRef.current, forestRef.current, infraRef.current)
      initUserLayers(map)
      updateUserPolygons(map, polygonsRef.current)
      updateSavedMeasures(map, savedMeasurementsRef.current)
      if (globeModeRef.current) {
        map.setProjection({ type: "globe" })
        map.setSky({ "sky-color": "#0d1f4a", "horizon-color": "#b0d0f0", "atmosphere-blend": 0.85 })
      }
      const newDraw = new MapboxDraw({ displayControlsDefault: false, controls: {}, defaultMode: "simple_select", styles: DRAW_STYLES })
      map.addControl(newDraw as unknown as maplibregl.IControl)
      drawRef.current = newDraw
    })
  }, [baseLayer])

  // ── Wayback catalog (lazy fetch on first satellite select) ─────────────────
  useEffect(() => {
    if (baseLayer !== "satellite" || waybackVersions.length > 0 || waybackLoading) return
    setWaybackLoading(true)
    fetch(WAYBACK_CONFIG_URL)
      .then((r) => r.json())
      .then((data: Record<string, { itemTitle: string }>) => {
        const versions: WaybackVersion[] = Object.entries(data)
          .map(([id, v]) => { const m = v.itemTitle.match(/(\d{4}-\d{2}-\d{2})/); return m ? { id, date: m[1], label: formatWaybackDate(m[1]) } : null })
          .filter(Boolean) as WaybackVersion[]
        versions.sort((a, b) => a.date.localeCompare(b.date)) // oldest first → slider left=old right=new
        waybackVersionsRef.current = versions
        setWaybackVersions(versions)
        checkWaybackAvailability()
      })
      .catch(() => { /* silently fall back to Latest */ })
      .finally(() => setWaybackLoading(false))
  }, [baseLayer, waybackVersions.length, waybackLoading])

  // ── Wayback tile swap ──────────────────────────────────────────────────────
  useEffect(() => {
    waybackIdxRef.current = waybackIdx
    if (baseLayer !== "satellite") return
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const src = map.getSource("tiles") as maplibregl.RasterTileSource | undefined
    if (!src) return
    const activeVersions = filteredVersions.length > 0 ? filteredVersions : waybackVersions
    src.setTiles(waybackIdx === null ? ESRI_SATELLITE_TILES : [waybackTileUrl(activeVersions[waybackIdx]?.id ?? "")])
  }, [waybackIdx, baseLayer, waybackVersions, filteredVersions])

  // ── Sync filteredVersionsRef; recover selected version after filter change ──
  useEffect(() => {
    filteredVersionsRef.current = filteredVersions
    const currentId = selectedVersionIdRef.current
    if (currentId === null) return // on Latest, nothing to do
    const newList = filteredVersions.length > 0 ? filteredVersions : waybackVersionsRef.current
    const newIdx = newList.findIndex(v => v.id === currentId)
    setWaybackIdx(newIdx >= 0 ? newIdx : null)
    if (newIdx < 0) selectedVersionIdRef.current = null
  }, [filteredVersions])

  // ── Overlay effects ────────────────────────────────────────────────────────
  useEffect(() => {
    terrainRef.current = terrainOverlay
    const map = mapRef.current; if (!map || !map.isStyleLoaded()) return
    terrainOverlay ? addTerrainOverlay(map) : removeTerrainOverlay(map)
  }, [terrainOverlay])

  useEffect(() => {
    streetViewRef.current = streetViewOverlay
    const map = mapRef.current; if (!map || !map.isStyleLoaded()) return
    streetViewOverlay ? addStreetViewOverlay(map) : removeStreetViewOverlay(map)
  }, [streetViewOverlay])

  useEffect(() => {
    cadastreRef.current = cadastreOverlay
    const map = mapRef.current; if (!map || !map.isStyleLoaded()) return
    cadastreOverlay ? addCadastreOverlay(map) : removeCadastreOverlay(map)
  }, [cadastreOverlay])

  useEffect(() => {
    buildingsRef.current = buildingsOverlay
    const map = mapRef.current; if (!map || !map.isStyleLoaded()) return
    buildingsOverlay ? addBuildingsOverlay(map) : removeBuildingsOverlay(map)
  }, [buildingsOverlay])

  useEffect(() => {
    labelsRef.current = labelsOverlay
    const map = mapRef.current; if (!map || !map.isStyleLoaded()) return
    labelsOverlay ? addLabelsOverlay(map) : removeLabelsOverlay(map)
  }, [labelsOverlay])

  useEffect(() => {
    nightLightsRef.current = nightLightsOverlay
    const map = mapRef.current; if (!map || !map.isStyleLoaded()) return
    nightLightsOverlay ? addNightLightsOverlay(map) : removeNightLightsOverlay(map)
  }, [nightLightsOverlay])

  useEffect(() => {
    firesRef.current = firesOverlay
    const map = mapRef.current; if (!map || !map.isStyleLoaded()) return
    firesOverlay ? addFiresOverlay(map) : removeFiresOverlay(map)
  }, [firesOverlay])

  useEffect(() => {
    floodsRef.current = floodsOverlay
    const map = mapRef.current; if (!map || !map.isStyleLoaded()) return
    floodsOverlay ? addFloodsOverlay(map) : removeFloodsOverlay(map)
  }, [floodsOverlay])

  useEffect(() => {
    waterRef.current = waterOverlay
    const map = mapRef.current; if (!map || !map.isStyleLoaded()) return
    waterOverlay ? addWaterOverlay(map) : removeWaterOverlay(map)
  }, [waterOverlay])

  useEffect(() => {
    forestRef.current = forestOverlay
    const map = mapRef.current; if (!map || !map.isStyleLoaded()) return
    forestOverlay ? addForestOverlay(map) : removeForestOverlay(map)
  }, [forestOverlay])

  useEffect(() => {
    infraRef.current = infraOverlay
    const map = mapRef.current; if (!map || !map.isStyleLoaded()) return
    infraOverlay ? addInfraOverlay(map) : removeInfraOverlay(map)
  }, [infraOverlay])

  // If the active historical layer is filtered out by the region selector, fall back to dark
  useEffect(() => {
    const isHistorical = HISTORICAL_LAYERS.some(l => l.key === baseLayer)
    if (!isHistorical) return
    const visible = HISTORICAL_LAYERS.filter(l => l.regions.includes(regionFilter))
    if (!visible.some(l => l.key === baseLayer)) setBaseLayer("dark")
  }, [regionFilter, baseLayer])

  useEffect(() => {
    streetViewModeRef.current = streetViewMode
    const canvas = mapRef.current?.getCanvas()
    if (canvas) canvas.style.cursor = streetViewMode ? "crosshair" : ""
  }, [streetViewMode])

  useEffect(() => {
    globeModeRef.current = globeMode
    const map = mapRef.current; if (!map || !map.isStyleLoaded()) return
    if (globeMode) {
      map.setProjection({ type: "globe" })
      map.setSky({ "sky-color": "#0d1f4a", "horizon-color": "#b0d0f0", "atmosphere-blend": 0.85 })
    } else {
      map.setProjection({ type: "mercator" })
      map.setSky({})
    }
  }, [globeMode])

  useEffect(() => {
    if (!cadastreOverlay) setCadastreCard(null)
  }, [cadastreOverlay])

  // ── Tool mode ──────────────────────────────────────────────────────────────
  useEffect(() => {
    toolModeRef.current = toolMode
    const map = mapRef.current
    const canvas = map?.getCanvas()
    if (canvas) {
      if (toolMode === "off") canvas.style.cursor = streetViewModeRef.current ? "crosshair" : ""
      else if (toolMode === "placemark") canvas.style.cursor = "cell"
      else canvas.style.cursor = "crosshair"
    }
    const needsLayers = toolMode !== "off" && toolMode !== "placemark"
    if (toolMode === "off" && map && map.isStyleLoaded()) {
      removeMeasureLayers(map)
      measurePointsRef.current = []
      setMeasurePoints([])
      setMeasurePreview(null)
    } else if (needsLayers && map && map.isStyleLoaded()) {
      initMeasureLayers(map)
    }
  }, [toolMode])

  // ── Measure layers update ──────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    if (toolMode === "off" || toolMode === "placemark") return

    if (!map.getSource(MEASURE_SOURCE)) initMeasureLayers(map)
    updateMeasureLayers(map, toolMode, measurePoints, measurePreview)
  }, [toolMode, measurePoints, measurePreview])

  // ── Locations panel drag ───────────────────────────────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!locationsDragRef.current) return
      const { startX, startY, startPX, startPY } = locationsDragRef.current
      setLocationsPanelPos({
        x: clamp(startPX + e.clientX - startX, 0, window.innerWidth - 320),
        y: clamp(startPY + e.clientY - startY, 0, window.innerHeight - 100),
      })
    }
    const onUp = () => { locationsDragRef.current = null }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp) }
  }, [])

  // ── Checkpoint ────────────────────────────────────────────────────────────
  const addCheckpoint = useCallback((
    lngLat: { lng: number; lat: number }, status: StatusKey,
    name = "", tags: string[] = [], customColor?: string
  ) => {
    const cfg = STATUSES.find((s) => s.key === status)!
    const color = customColor ?? cfg.color
    const id = crypto.randomUUID()
    const cp: Checkpoint = { id, lngLat, status, label: name, notes: "", timestamp: new Date(), tags, customColor }
    setCheckpoints((prev) => [...prev, cp])
    const el = makeMarkerEl(color)
    const marker = new maplibregl.Marker({ element: el }).setLngLat([lngLat.lng, lngLat.lat]).addTo(mapRef.current!)
    el.addEventListener("click", (e) => { e.stopPropagation(); setSelectedCheckpoint(cp); setContextMenu(null); setSelectedPolygon(null); setAreaMenuPos(null) })
    markersRef.current.set(id, marker)
    setContextMenu(null)
  }, [])

  const startDraw = useCallback(() => { drawRef.current?.changeMode("draw_polygon") }, [])

  const finishPolygon = useCallback((pts: [number, number][]) => {
    if (pts.length < 3) return
    const id = crypto.randomUUID()
    const ring: [number, number][] = [...pts, pts[0]]
    const geometry: GeoJSON.Polygon = { type: "Polygon", coordinates: [ring] }
    const label = `Area ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    const poly: DrawnPolygon = { id, geometry, label, status: null, timestamp: new Date(), tags: [] }
    setPolygons(prev => [...prev, poly])
    const map = mapRef.current
    if (map) {
      const [lng, lat] = computeCentroid(geometry)
      const labelEl = document.createElement("div")
      Object.assign(labelEl.style, { background: "rgba(0,0,0,0.72)", color: "#d4d4d8", fontSize: "11px", fontFamily: "ui-sans-serif, system-ui, sans-serif", padding: "2px 8px", borderRadius: "4px", whiteSpace: "nowrap", pointerEvents: "none", border: "1px solid rgba(255,255,255,0.1)" })
      labelEl.textContent = label
      labelMarkersRef.current.set(id, new maplibregl.Marker({ element: labelEl }).setLngLat([lng, lat]).addTo(map))
    }
    toolModeRef.current = "off"
    setToolMode("off")
    measurePointsRef.current = []
    setMeasurePoints([])
    setMeasurePreview(null)
  }, [])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tm = toolModeRef.current
      if (tm === "off") return
      if (e.key === "Escape") {
        e.preventDefault()
        if (tm === "placemark") {
          toolModeRef.current = "off"; setToolMode("off"); setCheckpointDialog(null); return
        }
        const pts = measurePointsRef.current
        if (pts.length === 0) {
          toolModeRef.current = "off"; setToolMode("off")
        } else {
          const next = pts.slice(0, -1)
          measurePointsRef.current = next
          setMeasurePoints(next)
        }
      }
      if ((e.key === "Enter" || e.key === "f") && tm === "draw-polygon") {
        e.preventDefault()
        finishPolygon(measurePointsRef.current)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [finishPolygon])

  const clearMeasure = useCallback(() => {
    measurePointsRef.current = []
    setMeasurePoints([])
    setMeasurePreview(null)
    const map = mapRef.current
    if (map && map.isStyleLoaded() && map.getSource(MEASURE_SOURCE)) {
      updateMeasureLayers(map, toolModeRef.current, [], null)
    }
  }, [])

  const saveMeasurement = useCallback((pts: [number, number][], mode: ToolMode) => {
    if (pts.length < 2) return
    let value = 0
    if (mode === "distance") value = pathLength(pts)
    else if (mode === "area") value = sphericalArea(pts)
    else if (mode === "radius") value = segmentDist(pts[0], pts[1])
    const label = mode === "distance"
      ? `Path ${fmtDist(value)}`
      : mode === "area"
      ? `Area ${fmtMeasureArea(value)}`
      : `Radius ${fmtDist(value)}`
    const m: SavedMeasurement = { id: crypto.randomUUID(), type: mode as "distance" | "area" | "radius", points: pts, value, label, tags: [], timestamp: new Date() }
    const next = [...savedMeasurementsRef.current, m]
    savedMeasurementsRef.current = next
    // Update the persistent map layer BEFORE clearing the in-progress layer so
    // there is no frame where the measurement is invisible.
    const map = mapRef.current
    if (map && map.isStyleLoaded()) updateSavedMeasures(map, next)
    setSavedMeasurements(next)
    clearMeasure()
  }, [clearMeasure])

  // Derived tag list from all saved items
  const allTags = Array.from(new Set([
    ...checkpoints.flatMap(c => c.tags),
    ...polygons.flatMap(p => p.tags),
    ...savedMeasurements.flatMap(m => m.tags),
  ])).sort()

  // ── Search ────────────────────────────────────────────────────────────────
  const handleSearchInput = useCallback((query: string) => {
    setSearchQuery(query)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    if (!query.trim()) { setSearchResults([]); setSearchOpen(false); return }
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=6`, { headers: { "Accept-Language": "en" } })
        const data: NominatimResult[] = await res.json()
        setSearchResults(data); setSearchOpen(data.length > 0)
      } catch { /* */ }
    }, 400)
  }, [])

  const handleSearchSelect = useCallback((result: NominatimResult) => {
    const map = mapRef.current; if (!map) return
    const [minLat, maxLat, minLon, maxLon] = result.boundingbox
    map.fitBounds([[parseFloat(minLon), parseFloat(minLat)], [parseFloat(maxLon), parseFloat(maxLat)]], { padding: 40, maxZoom: 16 })
    setSearchQuery(result.display_name); setSearchResults([]); setSearchOpen(false)
  }, [])

  const contextCoordString = selectedPolygon
    ? `${computeCentroid(selectedPolygon.geometry)[1].toFixed(4)},${computeCentroid(selectedPolygon.geometry)[0].toFixed(4)}`
    : ""

  const displayedVersions = filteredVersions.length > 0 ? filteredVersions : waybackVersions
  const maxIdx = displayedVersions.length - 1
  const sliderVal = waybackIdx ?? maxIdx

  const selectVersion = (idx: number | null) => {
    selectedVersionIdRef.current = idx === null ? null : (displayedVersions[idx]?.id ?? null)
    setWaybackIdx(idx)
  }
  const stepOlder = () => {
    const i = waybackIdxRef.current
    selectVersion(i === null ? maxIdx : Math.max(0, i - 1))
  }
  const stepNewer = () => {
    const i = waybackIdxRef.current
    selectVersion(i === null || i >= maxIdx ? null : i + 1)
  }

  const launchOwnerPipeline = useCallback((parcel: CadastreParcel) => {
    setOwnerPipeline({ parcel, loading: true, mutations: [], dvfError: false })
    const url =
      `https://apidf.cerema.fr/dvf_opendata/mutations/` +
      `?section=${encodeURIComponent(parcel.section)}` +
      `&numero_plan=${encodeURIComponent(parcel.numero)}` +
      `&code_commune=${parcel.code_insee}` +
      `&ordering=-date_mutation&limit=10`
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error("http"); return r.json() })
      .then((data) => {
        const mutations: DvfMutation[] = Array.isArray(data.results) ? data.results : []
        setOwnerPipeline((prev) => prev ? { ...prev, loading: false, mutations } : null)
      })
      .catch(() => {
        setOwnerPipeline((prev) => prev ? { ...prev, loading: false, dvfError: true } : null)
      })
  }, [])

  const allOverlays = [terrainOverlay, streetViewOverlay, cadastreOverlay, buildingsOverlay, labelsOverlay, nightLightsOverlay, firesOverlay, floodsOverlay, waterOverlay, forestOverlay, infraOverlay]
  const anyOverlayActive = allOverlays.some(Boolean)

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: "fixed", inset: 0, background: "#09090b" }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      {/* ── Search + Draw — top left ────────────────────────────────────────── */}
      <div className="absolute top-4 left-4 z-20 flex flex-col gap-2">
        <div className="relative z-10">
          <div className="flex items-center gap-2 bg-zinc-900/90 backdrop-blur-sm border border-zinc-700/60 rounded-lg px-3 py-2 shadow-lg w-64">
            <SearchIcon />
            <input
              type="text" value={searchQuery}
              onChange={(e) => handleSearchInput(e.target.value)}
              onFocus={() => { if (searchResults.length > 0) setSearchOpen(true) }}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              placeholder="Search place…"
              className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-500 outline-none min-w-0"
            />
            {searchQuery && (
              <button onClick={() => { setSearchQuery(""); setSearchResults([]); setSearchOpen(false) }} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none flex-shrink-0">×</button>
            )}
          </div>
          {searchOpen && searchResults.length > 0 && (
            <div className="absolute top-full mt-1 left-0 w-64 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden max-h-60 overflow-y-auto">
              {searchResults.map((r) => (
                <button key={r.place_id} onMouseDown={() => handleSearchSelect(r)} className="w-full text-left px-3 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 border-b border-zinc-800/60 last:border-0 transition-colors truncate">
                  {r.display_name}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Draw / tools group */}
        <div className="bg-zinc-900/90 backdrop-blur-sm border border-zinc-700/60 rounded-xl shadow-lg overflow-hidden">
          <div className="px-2 pt-2 pb-1">
            <div className="text-[9px] uppercase tracking-widest font-semibold text-zinc-600 px-1.5 mb-1">Draw</div>
            <button
              onClick={() => setToolMode(v => v === "draw-polygon" ? "off" : "draw-polygon")}
              className={`flex items-center gap-2 w-full text-sm px-2 py-1.5 rounded-lg transition-colors ${toolMode === "draw-polygon" ? "bg-sky-500/20 text-sky-300 font-semibold" : "text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"}`}>
              <PolygonIcon /> Area
            </button>
            <button
              onClick={() => setToolMode((v) => v === "placemark" ? "off" : "placemark")}
              className={`flex items-center gap-2 w-full text-sm px-2 py-1.5 rounded-lg transition-colors ${toolMode === "placemark" ? "bg-amber-500/20 text-amber-300 font-semibold" : "text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"}`}>
              <PlacemarkIcon /> Placemark
            </button>
          </div>
          <div className="border-t border-zinc-800 mx-2" />
          <div className="px-2 pt-1 pb-2">
            <div className="text-[9px] uppercase tracking-widest font-semibold text-zinc-600 px-1.5 mt-1 mb-1">Measure</div>
            {(["distance", "area", "radius"] as const).map(m => (
              <button key={m}
                onClick={() => setToolMode((v) => v === m ? "off" : m)}
                className={`flex items-center gap-2 w-full text-sm px-2 py-1.5 rounded-lg transition-colors ${toolMode === m ? "bg-sky-500/20 text-sky-300 font-semibold" : "text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"}`}>
                <MeasureIcon type={m} />
                {m === "distance" ? "Distance" : m === "area" ? "Area" : "Radius"}
              </button>
            ))}
          </div>
        </div>

        {/* View buttons */}
        <button
          onClick={() => setStreetViewMode((v) => !v)}
          className={`flex items-center gap-2 w-fit text-sm px-3 py-2 rounded-lg border transition-colors shadow-lg ${
            streetViewMode ? "bg-blue-500 text-white border-blue-400 hover:bg-blue-600"
              : "bg-zinc-900/90 backdrop-blur-sm text-zinc-200 border-zinc-700/60 hover:bg-zinc-800 hover:text-white"
          }`}>
          <StreetViewIcon /> Street View{streetViewMode && <span className="text-xs opacity-75">· click</span>}
        </button>
        <button
          onClick={() => setGlobeMode((v) => !v)}
          className={`flex items-center gap-2 w-fit text-sm px-3 py-2 rounded-lg border transition-colors shadow-lg ${
            globeMode ? "bg-indigo-500 text-white border-indigo-400 hover:bg-indigo-600"
              : "bg-zinc-900/90 backdrop-blur-sm text-zinc-200 border-zinc-700/60 hover:bg-zinc-800 hover:text-white"
          }`}>
          <GlobeIcon /> {globeMode ? "Flat Map" : "3D Globe"}
        </button>

        {/* Saved locations */}
        <button
          onClick={() => setLocationsOpen((v) => !v)}
          className={`flex items-center gap-2 w-fit text-sm px-3 py-2 rounded-lg border transition-colors shadow-lg ${
            locationsOpen ? "bg-zinc-100 text-zinc-900 border-zinc-300 font-semibold"
              : "bg-zinc-900/90 backdrop-blur-sm text-zinc-200 border-zinc-700/60 hover:bg-zinc-800 hover:text-white"
          }`}>
          <LocationsIcon active={locationsOpen} />
          Locations
          {(checkpoints.length + polygons.length + savedMeasurements.length) > 0 && (
            <span className="bg-zinc-700 text-zinc-300 text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none">
              {checkpoints.length + polygons.length + savedMeasurements.length}
            </span>
          )}
        </button>
      </div>

      {/* ── Layer switcher + Overlays — top right ───────────────────────────── */}
      <div className="absolute top-4 right-4 z-20 flex flex-row gap-2 items-start">

        {/* Overlays column — left of layer picker */}
        <div className="flex flex-col gap-2 items-end">
          {/* Overlays toggle */}
          <button onClick={() => setOverlaysOpen((v) => !v)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border shadow transition-colors whitespace-nowrap ${
              overlaysOpen || anyOverlayActive
                ? "bg-zinc-100 text-zinc-900 border-zinc-300 font-semibold"
                : "bg-zinc-900/90 backdrop-blur-sm text-zinc-400 border-zinc-700/60 hover:text-zinc-200 hover:bg-zinc-800"
            }`}>
            <LayersIcon active={overlaysOpen || anyOverlayActive} />
            Overlays
            {anyOverlayActive && (
              <span className="ml-0.5 bg-blue-500 text-white text-[9px] font-bold px-1 py-0.5 rounded leading-none">
                {allOverlays.filter(Boolean).length}
              </span>
            )}
            <span className="opacity-40 text-[10px]">{overlaysOpen ? "▲" : "▼"}</span>
          </button>

          {/* Overlays panel */}
          {overlaysOpen && (
            <div className="bg-zinc-900/95 backdrop-blur-sm border border-zinc-700/60 rounded-xl shadow-2xl w-64 max-h-[80vh] flex flex-col">
              <div className="px-3 py-2 border-b border-zinc-800 flex-shrink-0">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Map Overlays</span>
              </div>
              <div className="overflow-y-auto flex-1 p-2 flex flex-col gap-0.5">

                {/* Base */}
                <div className="text-[9px] uppercase tracking-widest font-semibold text-zinc-600 px-2 pt-1 pb-0.5">Base</div>
                <OverlayToggle label="Labels"    dot="#a0a0a0" description="City, street & place names"        checked={labelsOverlay}    onChange={setLabelsOverlay} />
                <OverlayToggle label="Buildings" dot="#ffd700" description="OSM footprints · zoom 13+"         checked={buildingsOverlay} onChange={setBuildingsOverlay} />
                <OverlayToggle label="Terrain"   dot="#8d6e63" description="3D elevation · right-drag to tilt" checked={terrainOverlay}   onChange={setTerrainOverlay} />

                <div className="border-t border-zinc-800 my-1 mx-1" />

                {/* Location */}
                <div className="text-[9px] uppercase tracking-widest font-semibold text-zinc-600 px-2 pb-0.5">Location</div>
                <OverlayToggle label="Cadastre"    dot="#e91e63" description="IGN parcel boundaries · FR · zoom 12+" checked={cadastreOverlay}    onChange={setCadastreOverlay} />
                <OverlayToggle label="Street View" dot="#4285f4" description="Google SV coverage lines"              checked={streetViewOverlay} onChange={setStreetViewOverlay} />

                <div className="border-t border-zinc-800 my-1 mx-1" />

                {/* Environment */}
                <div className="text-[9px] uppercase tracking-widest font-semibold text-zinc-600 px-2 pb-0.5">Environment</div>
                <OverlayToggle label="Night Lights"       dot="#f5d060" description="NASA VIIRS · 2023 composite"         checked={nightLightsOverlay} onChange={setNightLightsOverlay} />
                <OverlayToggle label="Active Fires"       dot="#ff5722" description="NASA MODIS thermal anomalies"        checked={firesOverlay}       onChange={setFiresOverlay}       live />
                <OverlayToggle label="Flood Extent"       dot="#1e88e5" description="NASA VIIRS · 3-day composite"        checked={floodsOverlay}      onChange={setFloodsOverlay}      live />
                <OverlayToggle label="Water Bodies"       dot="#00bcd4" description="JRC permanent surface water 2021"   checked={waterOverlay}       onChange={setWaterOverlay} />
                <OverlayToggle label="Forest Cover"       dot="#4caf50" description="GFW tree cover loss · 2001–present" checked={forestOverlay}      onChange={setForestOverlay} />

                <div className="border-t border-zinc-800 my-1 mx-1" />

                {/* Infrastructure */}
                <div className="text-[9px] uppercase tracking-widest font-semibold text-zinc-600 px-2 pb-0.5">Infrastructure</div>
                <OverlayToggle label="Industrial & Military" dot="#ff9800" description="OSM · zones + aerodromes · zoom 6+" checked={infraOverlay} onChange={setInfraOverlay} />

              </div>
            </div>
          )}
        </div>

        {/* Layer picker column — right */}
        <div className="bg-zinc-900/90 backdrop-blur-sm border border-zinc-700/60 rounded-xl shadow-lg overflow-hidden w-48">
          {/* Standard group */}
          <div className="px-2 pt-2 pb-1.5">
            <div className="text-[9px] uppercase tracking-widest font-semibold text-zinc-600 px-1.5 mb-1">Standard</div>
            {STANDARD_LAYERS.map(({ key, label }) => (
              <LayerButton key={key} active={baseLayer === key} onClick={() => setBaseLayer(key)}>{label}</LayerButton>
            ))}
          </div>
          <div className="border-t border-zinc-800" />
          {/* Esri group */}
          <div className="px-2 pt-2 pb-2 max-h-44 overflow-y-auto">
            <div className="text-[9px] uppercase tracking-widest font-semibold text-zinc-600 px-1.5 mb-1">Esri</div>
            {ESRI_LAYERS.map(({ key, label }) => (
              <LayerButton key={key} active={baseLayer === key} onClick={() => setBaseLayer(key)}>{label}</LayerButton>
            ))}
          </div>
          <div className="border-t border-zinc-800" />
          {/* Historical group with region filter */}
          <div className="px-2 pt-2 pb-2">
            <div className="flex items-center justify-between mb-1.5 px-1.5">
              <span className="text-[9px] uppercase tracking-widest font-semibold text-zinc-600">Historical</span>
              <div className="flex items-center bg-zinc-800 rounded-md p-0.5 gap-0.5">
                {(["all", "fr", "uk"] as const).map(r => (
                  <button key={r} onClick={() => setRegionFilter(r)}
                    className={`text-[9px] px-1.5 py-0.5 rounded transition-colors font-medium leading-none ${
                      regionFilter === r ? "bg-zinc-600 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                    }`}>
                    {r === "all" ? "ALL" : r.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-52 overflow-y-auto flex flex-col gap-0.5">
              {HISTORICAL_LAYERS.filter(l => l.regions.includes(regionFilter)).map(({ key, label, note }) => (
                <button key={key} onClick={() => setBaseLayer(key)}
                  className={`w-full text-left px-2 py-1.5 rounded-lg transition-colors ${
                    baseLayer === key
                      ? "bg-amber-900/60 text-amber-200 font-semibold"
                      : "text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                  }`}>
                  <div className="text-xs leading-tight">{label}</div>
                  <div className="text-[9px] text-zinc-600 leading-tight mt-0.5">{note}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

      </div>

      {/* ── Coord readout ─────────────────────────────────────────────────────── */}
      <div className="absolute bottom-4 left-4 z-10 select-none bg-zinc-900/80 backdrop-blur-sm font-mono text-[11px] text-zinc-400 px-3 py-1.5 rounded-lg border border-zinc-700/60 shadow">
        {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
      </div>

      {/* ── Satellite timeline ── bottom center, satellite only ──────────────── */}
      {baseLayer === "satellite" && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-zinc-900/90 backdrop-blur-sm border border-zinc-700/60 rounded-xl px-4 py-3 shadow-lg select-none" style={{ minWidth: 340 }}>
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider font-medium text-zinc-500">Esri Imagery Timeline</span>
              {waybackAvailLoading && <span className="text-[10px] text-zinc-600 animate-pulse">·· scanning</span>}
              {!waybackAvailLoading && filteredVersions.length > 0 && filteredVersions.length < waybackVersions.length && (
                <span className="text-[10px] text-blue-500 font-medium">{filteredVersions.length} dates</span>
              )}
            </div>
            <button onClick={() => { selectedVersionIdRef.current = null; setWaybackIdx(null) }} className={`text-xs px-2 py-0.5 rounded-md transition-colors font-medium ${waybackIdx === null ? "bg-zinc-100 text-zinc-900" : "text-zinc-400 hover:text-zinc-200"}`}>
              Latest
            </button>
          </div>
          {waybackLoading ? (
            <div className="text-[11px] text-zinc-500 text-center py-1">Loading versions…</div>
          ) : displayedVersions.length > 0 ? (
            <>
              <div className="flex items-center gap-2">
                <button onClick={stepOlder} disabled={waybackIdx === 0} className="w-6 h-6 flex items-center justify-center rounded-md bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-300 transition-colors flex-shrink-0 text-sm" title="Older">‹</button>
                <input
                  type="range" min={0} max={maxIdx} value={sliderVal}
                  onChange={(e) => { const v = Number(e.target.value); selectVersion(v >= maxIdx ? null : v) }}
                  className="flex-1 h-1.5 appearance-none bg-zinc-700 rounded-full outline-none cursor-pointer"
                  style={{ accentColor: "#3b82f6" }}
                />
                <button onClick={stepNewer} disabled={waybackIdx === null} className="w-6 h-6 flex items-center justify-center rounded-md bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-300 transition-colors flex-shrink-0 text-sm" title="Newer">›</button>
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-[10px] text-zinc-600">{displayedVersions[0]?.label}</span>
                <span className={`text-xs font-semibold tabular-nums ${waybackIdx === null ? "text-zinc-400" : "text-blue-400"}`}>
                  {waybackIdx === null ? "Current · Live Esri" : `${displayedVersions[waybackIdx]?.label ?? ""} · Esri Wayback`}
                </span>
                <span className="text-[10px] text-zinc-600">{displayedVersions[maxIdx]?.label}</span>
              </div>
            </>
          ) : (
            <div className="text-[11px] text-zinc-500 text-center py-1">Unable to load history</div>
          )}
        </div>
      )}

      {/* ── Context menu ────────────────────────────────────────────────────── */}
      {contextMenu && (
        <div className="absolute z-20 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden min-w-[196px]" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <div className="px-3 py-2 border-b border-zinc-800">
            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Mark location</span>
          </div>
          {STATUSES.map((s) => (
            <button key={s.key}
              onClick={() => {
                setContextMenu(null)
                setCheckpointDialog({ lngLat: contextMenu.lngLat, status: s.key, screen: { x: contextMenu.x, y: contextMenu.y } })
                setCheckpointName("")
                setCheckpointTagInput("")
              }}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 transition-colors">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Cadastre parcel card ─────────────────────────────────────────────── */}
      {cadastreCard && (
        <div
          className="absolute z-30 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-64 overflow-hidden pointer-events-auto"
          style={{
            left: clamp(cadastreCard.pos.x + 14, 8, window.innerWidth - 272),
            top: clamp(cadastreCard.pos.y - 28, 8, window.innerHeight - 340),
          }}
        >
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800">
            <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Parcelle cadastrale</span>
            <button onClick={() => setCadastreCard(null)} className="text-zinc-500 hover:text-zinc-300 leading-none w-5 h-5 flex items-center justify-center text-xl">×</button>
          </div>
          {cadastreCard.loading ? (
            <div className="px-3 py-5 text-xs text-zinc-500 text-center">Chargement…</div>
          ) : cadastreCard.error || !cadastreCard.data ? (
            <div className="px-3 py-5 text-xs text-zinc-500 text-center">Aucune parcelle à cet endroit</div>
          ) : (
            <div className="p-3 space-y-2.5">
              <div>
                <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-0.5">Identifiant (IDU)</div>
                <div className="text-xs font-mono text-zinc-300 leading-tight">{cadastreCard.data.idu}</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-0.5">Section</div>
                  <div className="text-xs text-zinc-300">{cadastreCard.data.section}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-0.5">Numéro</div>
                  <div className="text-xs text-zinc-300">{cadastreCard.data.numero}</div>
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-0.5">Commune</div>
                <div className="text-xs text-zinc-300">{cadastreCard.data.nom_com} <span className="text-zinc-600">({cadastreCard.data.code_insee})</span></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-0.5">Département</div>
                  <div className="text-xs text-zinc-300">{cadastreCard.data.code_dep}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-0.5">Surface</div>
                  <div className="text-xs text-zinc-300 leading-tight">{formatArea(cadastreCard.data.contenance)}</div>
                </div>
              </div>
              <div className="flex gap-1.5 pt-2 border-t border-zinc-800">
                <a
                  href={`https://www.geoportail.gouv.fr/carte?c=${cadastreCard.data.lngLat.lng},${cadastreCard.data.lngLat.lat}&z=18&l0=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2::GEOPORTAIL:OGC:WMTS(1)&l1=CADASTRALPARCELS.PARCELLAIRE_EXPRESS::GEOPORTAIL:OGC:WMTS(0.7)&permalink=yes`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex-1 text-center text-[11px] text-blue-400 hover:text-blue-300 transition-colors py-0.5"
                >
                  Géoportail →
                </a>
                <div className="w-px bg-zinc-800" />
                <button
                  onClick={() => launchOwnerPipeline(cadastreCard.data!)}
                  className="flex-1 text-center text-[11px] text-amber-400 hover:text-amber-300 transition-colors py-0.5 font-medium"
                >
                  Propriétaire →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Owner Pipeline panel ─────────────────────────────────────────────── */}
      {ownerPipeline && (
        <div className="absolute top-4 right-4 z-30 w-80 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
            <span className="text-sm font-semibold text-zinc-100 flex-1 truncate">Recherche propriétaire</span>
            <button onClick={() => setOwnerPipeline(null)} className="text-zinc-500 hover:text-zinc-300 leading-none w-5 h-5 flex items-center justify-center text-xl flex-shrink-0">×</button>
          </div>

          <div className="p-3 border-b border-zinc-800/60 bg-zinc-900/60">
            <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">Parcelle</div>
            <div className="text-xs font-mono text-zinc-400">{ownerPipeline.parcel.idu}</div>
            <div className="text-xs text-zinc-500 mt-0.5">
              Section {ownerPipeline.parcel.section} n°{ownerPipeline.parcel.numero} — {ownerPipeline.parcel.nom_com}
            </div>
          </div>

          <div className="p-3 border-b border-zinc-800/60 overflow-y-auto max-h-56">
            <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-2">Historique DVF (transactions)</div>
            {ownerPipeline.loading ? (
              <div className="text-xs text-zinc-500 py-2 text-center">Interrogation DVF CEREMA…</div>
            ) : ownerPipeline.dvfError ? (
              <div className="text-xs text-zinc-600 py-2 text-center">
                DVF indisponible (CORS ou hors couverture).<br />
                <span className="text-zinc-700">Utilisez les liens ci-dessous.</span>
              </div>
            ) : ownerPipeline.mutations.length === 0 ? (
              <div className="text-xs text-zinc-600 py-2 text-center">Aucune transaction trouvée pour cette parcelle.</div>
            ) : (
              <div className="flex flex-col gap-2">
                {ownerPipeline.mutations.map((m) => {
                  const buyers = m.l_acheteur_denomination_usuelle?.filter(Boolean) ?? []
                  const hasCompany = buyers.length > 0
                  const isPhysical = m.l_acheteur_personne_physique?.[0] === true
                  return (
                    <div key={m.id_mutation} className="rounded-lg bg-zinc-800/60 border border-zinc-700/40 px-3 py-2 space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-zinc-400">{new Date(m.date_mutation).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}</span>
                        <span className="text-[10px] text-zinc-500 bg-zinc-700/60 px-1.5 py-0.5 rounded">{m.nature_mutation}</span>
                      </div>
                      {m.valeur_fonciere && (
                        <div className="text-xs text-zinc-300 font-medium">
                          {Number(m.valeur_fonciere).toLocaleString("fr-FR")} €
                        </div>
                      )}
                      {hasCompany ? (
                        <div className="text-xs text-amber-300/80">{buyers.join(", ")}</div>
                      ) : isPhysical ? (
                        <div className="text-[10px] text-zinc-600 italic">Personne physique (anonymisé)</div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="p-3 overflow-y-auto max-h-64">
            <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-2">Liens de recherche</div>
            <div className="flex flex-col gap-1">
              {[
                {
                  label: "DVF Explorer · Etalab",
                  desc: "Carte des transactions immobilières",
                  url: `https://dvf.etalab.gouv.fr/?lon=${ownerPipeline.parcel.lngLat.lng.toFixed(5)}&lat=${ownerPipeline.parcel.lngLat.lat.toFixed(5)}&zoom=15`,
                },
                {
                  label: "Google · IDU",
                  desc: `Recherche "${ownerPipeline.parcel.idu}"`,
                  url: `https://www.google.com/search?q="${ownerPipeline.parcel.idu}"`,
                },
                {
                  label: "Pappers · Commune",
                  desc: `Sociétés à ${ownerPipeline.parcel.nom_com}`,
                  url: `https://www.pappers.fr/recherche?q=${encodeURIComponent(ownerPipeline.parcel.nom_com)}`,
                },
                {
                  label: "BODACC",
                  desc: "Annonces légales & judiciaires",
                  url: `https://www.bodacc.fr/pages/annonces-commerciales-encours/?q=${encodeURIComponent(ownerPipeline.parcel.nom_com)}`,
                },
                {
                  label: "Géoportail · Fiche parcellaire",
                  desc: `Section ${ownerPipeline.parcel.section} n°${ownerPipeline.parcel.numero}`,
                  url: `https://www.geoportail.gouv.fr/carte?c=${ownerPipeline.parcel.lngLat.lng},${ownerPipeline.parcel.lngLat.lat}&z=18&l0=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2::GEOPORTAIL:OGC:WMTS(1)&l1=CADASTRALPARCELS.PARCELLAIRE_EXPRESS::GEOPORTAIL:OGC:WMTS(0.7)&permalink=yes`,
                },
                {
                  label: "Infogreffe",
                  desc: "Registre du commerce & sociétés",
                  url: `https://www.infogreffe.fr/`,
                },
              ].map(({ label, desc, url }) => (
                <a
                  key={label}
                  href={url}
                  target="_blank" rel="noopener noreferrer"
                  className="block px-3 py-2 rounded-lg bg-zinc-800/50 border border-zinc-700/30 hover:border-zinc-600 hover:bg-zinc-700/60 transition-colors group"
                >
                  <div className="text-[10px] text-zinc-400 font-medium group-hover:text-zinc-300 transition-colors">{label} →</div>
                  <div className="text-[9px] text-zinc-600 mt-0.5 leading-tight truncate">{desc}</div>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Checkpoint profile ───────────────────────────────────────────────── */}
      {selectedCheckpoint && (
        <CheckpointPanel
          checkpoint={selectedCheckpoint}
          allTags={allTags}
          onClose={() => setSelectedCheckpoint(null)}
          onUpdate={(updated) => {
            setCheckpoints(prev => prev.map(c => c.id === updated.id ? updated : c))
            setSelectedCheckpoint(updated)
            // Re-color the marker
            const marker = markersRef.current.get(updated.id)
            if (marker) {
              const s = STATUSES.find(s => s.key === updated.status)
              const color = updated.customColor ?? s?.color ?? "#888"
              const el = marker.getElement()
              if (el) el.style.background = color
            }
          }}
          onDelete={() => {
            markersRef.current.get(selectedCheckpoint.id)?.remove()
            markersRef.current.delete(selectedCheckpoint.id)
            setCheckpoints(prev => prev.filter(c => c.id !== selectedCheckpoint.id))
            setSelectedCheckpoint(null)
          }}
          onFlyTo={() => mapRef.current?.flyTo({ center: [selectedCheckpoint.lngLat.lng, selectedCheckpoint.lngLat.lat], zoom: 16, duration: 1000 })}
        />
      )}

      {/* ── Area Action Menu ─────────────────────────────────────────────────── */}
      {selectedPolygon && areaMenuPos && !researchOpen && (
        <div className="absolute z-20 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-56 overflow-hidden" style={{ left: areaMenuPos.x, top: areaMenuPos.y }}>
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800">
            <span className="text-sm font-semibold text-zinc-100 truncate">{selectedPolygon.label}</span>
            <button onClick={() => { setSelectedPolygon(null); setAreaMenuPos(null) }} className="text-zinc-500 hover:text-zinc-300 leading-none ml-2 flex-shrink-0 w-5 h-5 flex items-center justify-center text-xl">×</button>
          </div>
          <div className="px-3 pt-2.5 pb-2 border-b border-zinc-800/60">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Set Status</div>
            <div className="grid grid-cols-2 gap-1">
              {STATUSES.map((s) => (
                <button key={s.key} onClick={() => { const updated = polygons.map((p) => p.id === selectedPolygon.id ? { ...p, status: s.key } : p); setPolygons(updated); setSelectedPolygon(updated.find((p) => p.id === selectedPolygon.id)!) }}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] transition-colors leading-tight"
                  style={{ background: selectedPolygon.status === s.key ? s.color + "25" : "transparent", color: s.color, border: `1px solid ${s.color}${selectedPolygon.status === s.key ? "70" : "28"}` }}>
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
                  <span className="truncate">{s.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="px-2 py-1.5 flex flex-col">
            {[
              { label: "Phantom", cb: () => showToast("Phantom pipeline not yet implemented") },
              { label: "Research Panel", cb: () => setResearchOpen(true) },
              { label: "Scout", cb: () => showToast("Scout not yet implemented") },
              { label: "Recon", cb: () => showToast("Recon not yet implemented") },
              { label: "Pipeline Launcher", cb: () => showToast("Pipeline Launcher not yet implemented") },
            ].map(({ label, cb }) => (
              <button key={label} onClick={cb} className="text-sm text-left px-3 py-2 rounded-lg text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors">{label}</button>
            ))}
          </div>
        </div>
      )}

      {/* ── Research Panel ───────────────────────────────────────────────────── */}
      {selectedPolygon && researchOpen && (
        <div className="absolute top-4 right-4 z-30 w-80 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
            <button onClick={() => setResearchOpen(false)} className="text-zinc-500 hover:text-zinc-300 text-sm leading-none flex-shrink-0">←</button>
            <span className="text-sm font-semibold text-zinc-100">Research Panel</span>
            <button onClick={() => { setResearchOpen(false); setSelectedPolygon(null); setAreaMenuPos(null) }} className="ml-auto text-zinc-500 hover:text-zinc-300 leading-none w-5 h-5 flex items-center justify-center text-xl">×</button>
          </div>
          <div className="p-4 space-y-5 overflow-y-auto max-h-[calc(100vh-6rem)]">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Contextual Search</span>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <span className="text-[11px] text-zinc-500">Context</span>
                  <button type="button" role="switch" aria-checked={useCtx} onClick={() => setUseCtx((v) => !v)} className={`relative w-8 h-4 rounded-full transition-colors focus:outline-none ${useCtx ? "bg-blue-500" : "bg-zinc-600"}`}>
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${useCtx ? "translate-x-4" : "translate-x-0.5"}`} />
                  </button>
                </label>
              </div>
              <form onSubmit={(e) => { e.preventDefault(); window.open(`https://www.google.com/search?q=${encodeURIComponent(useCtx ? `${researchQuery} ${contextCoordString}` : researchQuery)}`, "_blank", "noopener,noreferrer") }} className="flex gap-2">
                <input type="text" value={researchQuery} onChange={(e) => setResearchQuery(e.target.value)} placeholder={contextCoordString || "Search query…"} className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-500 transition-colors" />
                <button type="submit" className="bg-zinc-700 hover:bg-zinc-600 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium flex-shrink-0">Go</button>
              </form>
            </div>
            <div>
              <div className="text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2">Google Dork Helper</div>
              <div className="flex flex-col gap-1.5">
                {DORKS.map(({ label, template }) => {
                  const q = template(contextCoordString || "location")
                  return (
                    <button key={label} onClick={() => window.open(`https://www.google.com/search?q=${encodeURIComponent(q)}`, "_blank", "noopener,noreferrer")} className="text-left px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700/50 hover:border-zinc-600 hover:bg-zinc-700/80 transition-colors group">
                      <div className="text-[10px] text-zinc-500 mb-0.5 group-hover:text-zinc-400 transition-colors uppercase tracking-wide">{label}</div>
                      <div className="text-xs text-zinc-300 font-mono break-all leading-snug">{q}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Checkpoint dialog ───────────────────────────────────────────────── */}
      {checkpointDialog && (() => {
        const s = STATUSES.find(s => s.key === checkpointDialog.status)!
        const sx = clamp(checkpointDialog.screen.x, 8, (typeof window !== "undefined" ? window.innerWidth : 800) - 280)
        const sy = clamp(checkpointDialog.screen.y + 8, 8, (typeof window !== "undefined" ? window.innerHeight : 600) - 220)
        return (
          <div className="absolute z-30 w-64 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden" style={{ left: sx, top: sy }}>
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-800">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
              <span className="text-xs font-semibold text-zinc-300">{s.label}</span>
              <button onClick={() => setCheckpointDialog(null)} className="ml-auto text-zinc-500 hover:text-zinc-300 text-xl leading-none">×</button>
            </div>
            <div className="p-3 flex flex-col gap-2">
              <input autoFocus type="text" value={checkpointName} onChange={e => setCheckpointName(e.target.value)}
                placeholder="Name (optional)"
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-500 w-full"
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    const tags = checkpointTagInput.split(",").map(t => t.trim()).filter(Boolean)
                    addCheckpoint(checkpointDialog.lngLat, checkpointDialog.status, checkpointName, tags)
                    setCheckpointDialog(null)
                  }
                  if (e.key === "Escape") setCheckpointDialog(null)
                }}
              />
              <input type="text" value={checkpointTagInput} onChange={e => setCheckpointTagInput(e.target.value)}
                placeholder="Tags (comma separated)"
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-500 w-full"
              />
              {allTags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {allTags.slice(0, 8).map(t => (
                    <button key={t} onClick={() => setCheckpointTagInput(v => v ? `${v}, ${t}` : t)}
                      className="text-[10px] bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200 px-1.5 py-0.5 rounded-md transition-colors">
                      {t}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <button onClick={() => setCheckpointDialog(null)} className="flex-1 text-xs text-zinc-500 hover:text-zinc-300 py-1.5 transition-colors">Cancel</button>
                <button
                  onClick={() => {
                    const tags = checkpointTagInput.split(",").map(t => t.trim()).filter(Boolean)
                    addCheckpoint(checkpointDialog.lngLat, checkpointDialog.status, checkpointName, tags)
                    setCheckpointDialog(null)
                  }}
                  className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-100 text-xs font-semibold py-1.5 rounded-lg transition-colors">
                  Add
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Measure / Draw HUD ──────────────────────────────────────────────── */}
      {toolMode !== "off" && toolMode !== "placemark" && (
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-20 bg-zinc-900/95 backdrop-blur-sm border border-zinc-700/60 rounded-xl shadow-xl px-4 py-3 flex items-center gap-4 select-none">
          <div className="flex flex-col items-center gap-0.5 min-w-[120px]">
            <span className="text-[9px] uppercase tracking-widest text-zinc-500">
              {toolMode === "distance" ? "Distance" : toolMode === "area" ? "Area" : toolMode === "radius" ? "Radius" : "Draw Area"}
            </span>
            <span className="text-sm font-semibold tabular-nums text-sky-300">
              {toolMode === "draw-polygon"
                ? measurePoints.length === 0
                  ? "Click to start"
                  : measurePoints.length < 3
                  ? `${measurePoints.length} pt${measurePoints.length > 1 ? "s" : ""} — need 3`
                  : `${measurePoints.length} pts · click ● to close`
                : toolMode === "distance" && measurePoints.length >= 2
                ? fmtDist(pathLength(measurePoints))
                : toolMode === "distance" && measurePoints.length === 1
                ? measurePreview ? fmtDist(segmentDist(measurePoints[0], measurePreview)) : "—"
                : toolMode === "area" && measurePoints.length >= 3
                ? fmtMeasureArea(sphericalArea([...measurePoints, ...(measurePreview ? [measurePreview] : [])]))
                : toolMode === "radius" && measurePoints.length >= 2
                ? fmtDist(segmentDist(measurePoints[0], measurePoints[1]))
                : toolMode === "radius" && measurePoints.length === 1
                ? measurePreview ? fmtDist(segmentDist(measurePoints[0], measurePreview)) : "—"
                : measurePoints.length === 0 ? "Click to start" : "—"
              }
            </span>
            {toolMode === "draw-polygon" && measurePoints.length > 0 && (
              <span className="text-[9px] text-zinc-600">Esc = undo · Enter = finish</span>
            )}
          </div>
          <div className="flex gap-2">
            {toolMode === "draw-polygon" && measurePoints.length >= 3 && (
              <button onClick={() => finishPolygon(measurePoints)}
                className="text-xs bg-sky-600 hover:bg-sky-500 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors">
                Finish
              </button>
            )}
            {toolMode !== "draw-polygon" && measurePoints.length >= 2 && (
              <button onClick={() => saveMeasurement(measurePoints, toolMode)}
                className="text-xs bg-sky-600 hover:bg-sky-500 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors">
                Save
              </button>
            )}
            <button onClick={clearMeasure}
              className="text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-200 px-3 py-1.5 rounded-lg transition-colors">
              Clear
            </button>
            <button onClick={() => { setToolMode("off"); clearMeasure() }}
              className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1.5 transition-colors">
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Placemark mode indicator */}
      {toolMode === "placemark" && (
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-20 bg-zinc-900/95 backdrop-blur-sm border border-amber-500/30 rounded-xl shadow-xl px-4 py-2.5 flex items-center gap-3 select-none">
          <PlacemarkIcon />
          <span className="text-xs text-amber-300 font-medium">Click map to place a marker</span>
          <button onClick={() => setToolMode("off")} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none ml-1">×</button>
        </div>
      )}

      {/* ── Locations panel ─────────────────────────────────────────────────── */}
      {locationsOpen && (
        <LocationsPanel
          pos={locationsPanelPos}
          onDragStart={(e) => {
            locationsDragRef.current = { startX: e.clientX, startY: e.clientY, startPX: locationsPanelPos.x, startPY: locationsPanelPos.y }
          }}
          onClose={() => setLocationsOpen(false)}
          checkpoints={checkpoints}
          polygons={polygons}
          measurements={savedMeasurements}
          search={locationsSearch}
          onSearchChange={setLocationsSearch}
          typeFilter={locationsTypeFilter}
          onTypeFilterChange={setLocationsTypeFilter}
          tagFilter={locationsTagFilter}
          onTagFilterChange={setLocationsTagFilter}
          allTags={allTags}
          onFlyTo={(lngLat) => {
            mapRef.current?.flyTo({ center: [lngLat.lng, lngLat.lat], zoom: 15, duration: 1200 })
          }}
          onFlyToPolygon={(geom) => {
            const ring = geom.coordinates[0]
            if (!ring?.length) return
            const lngs = ring.map(c => c[0])
            const lats = ring.map(c => c[1])
            mapRef.current?.fitBounds(
              [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
              { padding: 80, maxZoom: 17, duration: 1200 }
            )
          }}
          onFlyToMeasurement={(m) => {
            if (m.points.length === 0) return
            const [lng, lat] = m.points[0]
            mapRef.current?.flyTo({ center: [lng, lat], zoom: 14, duration: 1200 })
          }}
          onDeleteCheckpoint={(id) => {
            markersRef.current.get(id)?.remove()
            markersRef.current.delete(id)
            setCheckpoints(prev => prev.filter(c => c.id !== id))
          }}
          onDeletePolygon={(id) => {
            labelMarkersRef.current.get(id)?.remove()
            labelMarkersRef.current.delete(id)
            setPolygons(prev => prev.filter(p => p.id !== id))
          }}
          onDeleteMeasurement={(id) => setSavedMeasurements(prev => prev.filter(m => m.id !== id))}
          onAddTag={(type, id, tag) => {
            if (type === "checkpoint") setCheckpoints(prev => prev.map(c => c.id === id ? { ...c, tags: [...new Set([...c.tags, tag])] } : c))
            else if (type === "polygon") setPolygons(prev => prev.map(p => p.id === id ? { ...p, tags: [...new Set([...p.tags, tag])] } : p))
            else setSavedMeasurements(prev => prev.map(m => m.id === id ? { ...m, tags: [...new Set([...m.tags, tag])] } : m))
          }}
          onRemoveTag={(type, id, tag) => {
            if (type === "checkpoint") setCheckpoints(prev => prev.map(c => c.id === id ? { ...c, tags: c.tags.filter(t => t !== tag) } : c))
            else if (type === "polygon") setPolygons(prev => prev.map(p => p.id === id ? { ...p, tags: p.tags.filter(t => t !== tag) } : p))
            else setSavedMeasurements(prev => prev.map(m => m.id === id ? { ...m, tags: m.tags.filter(t => t !== tag) } : m))
          }}
        />
      )}

      {/* ── Toast ───────────────────────────────────────────────────────────── */}
      {toast && (
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-50 pointer-events-none bg-zinc-800/95 backdrop-blur-sm border border-zinc-700 text-zinc-200 text-sm px-4 py-2.5 rounded-xl shadow-xl whitespace-nowrap">
          {toast}
        </div>
      )}

      <span className="hidden">{checkpoints.length}</span>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function LayerButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-xs px-2 py-1.5 rounded-lg transition-colors text-left whitespace-nowrap ${
        active ? "bg-zinc-100 text-zinc-900 font-semibold" : "text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  )
}

function OverlayToggle({ label, description, checked, onChange, dot, live }: {
  label: string; description?: string; checked: boolean; onChange: (v: boolean) => void
  dot?: string   // CSS color for indicator dot
  live?: boolean // show "LIVE" badge (NRT data)
}) {
  return (
    <div className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg transition-colors cursor-pointer ${checked ? "bg-zinc-800/80" : "hover:bg-zinc-800/40"}`}
      onClick={() => onChange(!checked)}>
      <div className="flex items-center gap-2 min-w-0">
        {dot && (
          <span className="flex-shrink-0 w-2 h-2 rounded-full" style={{ background: dot, opacity: checked ? 1 : 0.4 }} />
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`text-xs font-medium leading-tight ${checked ? "text-zinc-100" : "text-zinc-400"}`}>{label}</span>
            {live && <span className="text-[8px] font-bold tracking-wide text-amber-500 leading-none">LIVE</span>}
          </div>
          {description && <div className="text-[10px] text-zinc-600 mt-0.5 leading-tight">{description}</div>}
        </div>
      </div>
      <div role="switch" aria-checked={checked}
        className={`relative flex-shrink-0 w-8 h-4 rounded-full transition-colors pointer-events-none ${checked ? "bg-blue-500" : "bg-zinc-700"}`}>
        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
      </div>
    </div>
  )
}

function PolygonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <polygon points="6.5,1 12,11 1,11" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500 flex-shrink-0">
      <circle cx="5.5" cy="5.5" r="4" /><line x1="8.5" y1="8.5" x2="12" y2="12" />
    </svg>
  )
}

function LayersIcon({ active }: { active: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" className={active ? "text-zinc-900" : "text-zinc-400"}>
      <polygon points="6,1 11,4 6,7 1,4" /><polyline points="1,7 6,10 11,7" />
    </svg>
  )
}

function StreetViewIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6.5" cy="4" r="2.2" />
      <path d="M3 12c0-2 1.6-3.5 3.5-3.5S10 10 10 12" />
      <line x1="6.5" y1="8.5" x2="6.5" y2="12" />
    </svg>
  )
}

function GlobeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6.5" cy="6.5" r="5.5" />
      <ellipse cx="6.5" cy="6.5" rx="2.5" ry="5.5" />
      <line x1="1" y1="6.5" x2="12" y2="6.5" />
      <line x1="2" y1="3.5" x2="11" y2="3.5" />
      <line x1="2" y1="9.5" x2="11" y2="9.5" />
    </svg>
  )
}

function PlacemarkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 1.5C4.57 1.5 3 3.07 3 5c0 2.63 3.5 6.5 3.5 6.5S10 7.63 10 5c0-1.93-1.57-3.5-3.5-3.5z"/>
      <circle cx="6.5" cy="5" r="1.2"/>
    </svg>
  )
}

function MeasureIcon({ type }: { type: "distance" | "area" | "radius" }) {
  if (type === "distance") return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="1.5" y1="6.5" x2="11.5" y2="6.5" />
      <line x1="1.5" y1="4.5" x2="1.5" y2="8.5" />
      <line x1="11.5" y1="4.5" x2="11.5" y2="8.5" />
    </svg>
  )
  if (type === "area") return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="6.5,1.5 11.5,10.5 1.5,10.5" />
    </svg>
  )
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="6.5" cy="6.5" r="4" />
      <line x1="6.5" y1="6.5" x2="10.5" y2="6.5" />
    </svg>
  )
}

function LocationsIcon({ active }: { active: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={active ? "text-zinc-900" : "text-zinc-400"}>
      <line x1="2" y1="4" x2="11" y2="4" />
      <line x1="2" y1="7" x2="11" y2="7" />
      <line x1="2" y1="10" x2="7" y2="10" />
      <circle cx="10" cy="10" r="2" />
    </svg>
  )
}

// ─── CheckpointPanel component ────────────────────────────────────────────────

function CheckpointPanel({ checkpoint, allTags, onClose, onUpdate, onDelete, onFlyTo }: {
  checkpoint: Checkpoint
  allTags: string[]
  onClose: () => void
  onUpdate: (c: Checkpoint) => void
  onDelete: () => void
  onFlyTo: () => void
}) {
  const [name, setName] = useState(checkpoint.label)
  const [notes, setNotes] = useState(checkpoint.notes)
  const [tagInput, setTagInput] = useState("")

  const s = STATUSES.find(s => s.key === checkpoint.status)!

  const save = (patch: Partial<Checkpoint>) => onUpdate({ ...checkpoint, ...patch })

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-80 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-800">
        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: checkpoint.customColor ?? s.color }} />
        <span className="text-xs font-semibold text-zinc-300 flex-1 truncate">{checkpoint.label || s.label}</span>
        <button onClick={onFlyTo} title="Fly to" className="text-zinc-500 hover:text-sky-400 text-sm transition-colors">⌖</button>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none ml-1">×</button>
      </div>

      <div className="p-3 flex flex-col gap-3 max-h-[70vh] overflow-y-auto">
        {/* Name */}
        <div>
          <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">Name</div>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            onBlur={() => save({ label: name })}
            onKeyDown={e => e.key === "Enter" && save({ label: name })}
            placeholder="Unnamed"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-500" />
        </div>

        {/* Status */}
        <div>
          <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1.5">Status</div>
          <div className="grid grid-cols-2 gap-1">
            {STATUSES.map(st => (
              <button key={st.key}
                onClick={() => save({ status: st.key })}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] transition-colors leading-tight"
                style={{
                  background: checkpoint.status === st.key ? st.color + "22" : "transparent",
                  color: st.color,
                  border: `1px solid ${checkpoint.status === st.key ? st.color + "60" : st.color + "25"}`
                }}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: st.color }} />
                <span className="truncate">{st.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Tags */}
        <div>
          <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">Tags</div>
          <div className="flex flex-wrap gap-1 mb-1.5">
            {checkpoint.tags.map(t => (
              <span key={t} className="flex items-center gap-1 text-[10px] bg-zinc-800 border border-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded-full">
                {t}
                <button onClick={() => save({ tags: checkpoint.tags.filter(x => x !== t) })} className="text-zinc-600 hover:text-red-400 transition-colors">×</button>
              </span>
            ))}
          </div>
          <div className="flex gap-1.5">
            <input type="text" value={tagInput} onChange={e => setTagInput(e.target.value)}
              placeholder="Add tag…"
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1 text-[11px] text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-500"
              onKeyDown={e => {
                if (e.key === "Enter" && tagInput.trim()) {
                  save({ tags: [...new Set([...checkpoint.tags, tagInput.trim()])] })
                  setTagInput("")
                }
              }} />
            {tagInput.trim() && (
              <button onClick={() => { save({ tags: [...new Set([...checkpoint.tags, tagInput.trim()])] }); setTagInput("") }}
                className="text-[11px] bg-zinc-700 hover:bg-zinc-600 text-zinc-200 px-2 rounded-lg transition-colors">
                +
              </button>
            )}
          </div>
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {allTags.filter(t => !checkpoint.tags.includes(t)).slice(0, 6).map(t => (
                <button key={t} onClick={() => save({ tags: [...checkpoint.tags, t] })}
                  className="text-[9px] bg-zinc-800 border border-zinc-700/50 text-zinc-500 hover:text-zinc-300 px-1.5 py-0.5 rounded-full transition-colors">
                  + {t}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Notes */}
        <div>
          <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">Notes</div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            onBlur={() => save({ notes })}
            placeholder="Add notes…"
            rows={3}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-500 resize-none" />
        </div>

        {/* Meta */}
        <div className="text-[10px] text-zinc-600 font-mono">
          {checkpoint.lngLat.lat.toFixed(5)}, {checkpoint.lngLat.lng.toFixed(5)}<br />
          {checkpoint.timestamp.toLocaleString()}
        </div>

        {/* Delete */}
        <button onClick={onDelete}
          className="w-full text-xs text-red-500 hover:text-red-400 hover:bg-red-500/10 py-1.5 rounded-lg transition-colors border border-red-500/20 hover:border-red-500/40">
          Delete checkpoint
        </button>
      </div>
    </div>
  )
}

function openLocationSearch(label: string, lat: number, lng: number) {
  const parts: string[] = []
  if (label.trim()) parts.push(`"${label.trim()}"`)
  parts.push(`${lat.toFixed(5)},${lng.toFixed(5)}`)
  window.open(`https://www.google.com/search?q=${encodeURIComponent(parts.join(' '))}`, '_blank', 'noopener,noreferrer')
}

// ─── LocationsPanel component ──────────────────────────────────────────────────

interface LocationsPanelProps {
  pos: { x: number; y: number }
  onDragStart: (e: React.MouseEvent) => void
  onClose: () => void
  checkpoints: Checkpoint[]
  polygons: DrawnPolygon[]
  measurements: SavedMeasurement[]
  search: string
  onSearchChange: (v: string) => void
  typeFilter: "all" | "checkpoint" | "polygon" | "measurement"
  onTypeFilterChange: (v: "all" | "checkpoint" | "polygon" | "measurement") => void
  tagFilter: string | null
  onTagFilterChange: (v: string | null) => void
  allTags: string[]
  onFlyTo: (lngLat: { lng: number; lat: number }) => void
  onFlyToPolygon: (geom: GeoJSON.Polygon) => void
  onFlyToMeasurement: (m: SavedMeasurement) => void
  onDeleteCheckpoint: (id: string) => void
  onDeletePolygon: (id: string) => void
  onDeleteMeasurement: (id: string) => void
  onAddTag: (type: "checkpoint" | "polygon" | "measurement", id: string, tag: string) => void
  onRemoveTag: (type: "checkpoint" | "polygon" | "measurement", id: string, tag: string) => void
}

function LocationsPanel({
  pos, onDragStart, onClose,
  checkpoints, polygons, measurements,
  search, onSearchChange,
  typeFilter, onTypeFilterChange,
  tagFilter, onTagFilterChange,
  allTags,
  onFlyTo, onFlyToPolygon, onFlyToMeasurement,
  onDeleteCheckpoint, onDeletePolygon, onDeleteMeasurement,
  onAddTag, onRemoveTag,
}: LocationsPanelProps) {
  const [tagInputId, setTagInputId] = useState<string | null>(null)
  const [tagInputVal, setTagInputVal] = useState("")

  const q = search.toLowerCase()
  const items: { type: "checkpoint" | "polygon" | "measurement"; id: string }[] = [
    ...checkpoints.filter(c =>
      (typeFilter === "all" || typeFilter === "checkpoint") &&
      (!q || c.label.toLowerCase().includes(q) || c.tags.some(t => t.toLowerCase().includes(q))) &&
      (!tagFilter || c.tags.includes(tagFilter))
    ).map(c => ({ type: "checkpoint" as const, id: c.id })),
    ...polygons.filter(p =>
      (typeFilter === "all" || typeFilter === "polygon") &&
      (!q || p.label.toLowerCase().includes(q) || p.tags.some(t => t.toLowerCase().includes(q))) &&
      (!tagFilter || p.tags.includes(tagFilter))
    ).map(p => ({ type: "polygon" as const, id: p.id })),
    ...measurements.filter(m =>
      (typeFilter === "all" || typeFilter === "measurement") &&
      (!q || m.label.toLowerCase().includes(q) || m.tags.some(t => t.toLowerCase().includes(q))) &&
      (!tagFilter || m.tags.includes(tagFilter))
    ).map(m => ({ type: "measurement" as const, id: m.id })),
  ]

  const cpMap = Object.fromEntries(checkpoints.map(c => [c.id, c]))
  const polyMap = Object.fromEntries(polygons.map(p => [p.id, p]))
  const measMap = Object.fromEntries(measurements.map(m => [m.id, m]))

  const STATUSES_MAP = Object.fromEntries(STATUSES.map(s => [s.key, s]))

  return (
    <div
      className="absolute z-30 w-80 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col overflow-hidden"
      style={{ left: pos.x, top: pos.y, maxHeight: "calc(100vh - 80px)" }}
    >
      {/* Header — draggable */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-800 cursor-move select-none bg-zinc-900/80 flex-shrink-0"
        onMouseDown={onDragStart}
      >
        <span className="text-xs font-semibold text-zinc-300 flex-1">Saved Locations</span>
        <span className="text-[10px] text-zinc-600">{items.length} / {checkpoints.length + polygons.length + measurements.length}</span>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none ml-1">×</button>
      </div>

      {/* Search */}
      <div className="px-3 pt-2.5 pb-2 border-b border-zinc-800/60 flex-shrink-0">
        <div className="flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-zinc-500 flex-shrink-0">
            <circle cx="4.5" cy="4.5" r="3.5" /><line x1="7.5" y1="7.5" x2="10" y2="10" />
          </svg>
          <input type="text" value={search} onChange={e => onSearchChange(e.target.value)}
            placeholder="Filter locations…"
            className="flex-1 bg-transparent text-xs text-zinc-200 placeholder-zinc-600 outline-none" />
          {search && <button onClick={() => onSearchChange("")} className="text-zinc-500 hover:text-zinc-300 text-sm leading-none">×</button>}
        </div>

        {/* Type filter tabs */}
        <div className="flex gap-1 mt-2">
          {(["all", "checkpoint", "polygon", "measurement"] as const).map(t => (
            <button key={t} onClick={() => onTypeFilterChange(t)}
              className={`text-[10px] px-2 py-0.5 rounded-md font-medium transition-colors ${typeFilter === t ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}>
              {t === "all" ? "All" : t === "checkpoint" ? "Pins" : t === "polygon" ? "Areas" : "Measures"}
            </button>
          ))}
        </div>

        {/* Active tag filter */}
        {tagFilter && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="text-[9px] text-zinc-600">Tag:</span>
            <button onClick={() => onTagFilterChange(null)}
              className="flex items-center gap-1 text-[10px] bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded-full hover:bg-zinc-600 transition-colors">
              {tagFilter} <span className="text-zinc-500">×</span>
            </button>
          </div>
        )}
      </div>

      {/* Tag chips (if any tags exist) */}
      {allTags.length > 0 && !tagFilter && (
        <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-zinc-800/60 flex-shrink-0">
          {allTags.map(t => (
            <button key={t} onClick={() => onTagFilterChange(t)}
              className="text-[9px] bg-zinc-800 border border-zinc-700/60 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 px-1.5 py-0.5 rounded-full transition-colors">
              {t}
            </button>
          ))}
        </div>
      )}

      {/* Item list */}
      <div className="overflow-y-auto flex-1 p-2 flex flex-col gap-1">
        {items.length === 0 && (
          <div className="text-[11px] text-zinc-600 text-center py-8">No locations saved yet.</div>
        )}

        {items.map(({ type, id }) => {
          if (type === "checkpoint") {
            const c = cpMap[id]; if (!c) return null
            const s = STATUSES_MAP[c.status]
            return (
              <LocationItem key={id}
                color={c.customColor ?? s?.color ?? "#888"}
                icon={<span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: c.customColor ?? s?.color ?? "#888" }} />}
                label={c.label || s?.label || "Checkpoint"}
                sublabel={`${c.lngLat.lat.toFixed(4)}, ${c.lngLat.lng.toFixed(4)}`}
                tags={c.tags}
                tagInputId={tagInputId}
                tagInputVal={tagInputVal}
                itemId={id}
                onFlyTo={() => onFlyTo(c.lngLat)}
                onSearch={() => openLocationSearch(c.label || s?.label || "", c.lngLat.lat, c.lngLat.lng)}
                onDelete={() => onDeleteCheckpoint(id)}
                onSetTagInput={setTagInputId}
                onTagInputVal={setTagInputVal}
                onAddTag={(tag) => onAddTag("checkpoint", id, tag)}
                onRemoveTag={(tag) => onRemoveTag("checkpoint", id, tag)}
                onTagClick={onTagFilterChange}
              />
            )
          }
          if (type === "polygon") {
            const p = polyMap[id]; if (!p) return null
            const s = p.status ? STATUSES_MAP[p.status] : null
            return (
              <LocationItem key={id}
                color={s?.color ?? "#3bb2d0"}
                icon={<svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke={s?.color ?? "#3bb2d0"} strokeWidth="1.5" strokeLinejoin="round"><polygon points="5.5,1 10,9 1,9" /></svg>}
                label={p.label}
                sublabel={`Polygon · ${p.tags.length > 0 ? "" : "no tags"}`}
                tags={p.tags}
                tagInputId={tagInputId}
                tagInputVal={tagInputVal}
                itemId={id}
                onFlyTo={() => onFlyToPolygon(p.geometry)}
                onSearch={() => { const [clng, clat] = computeCentroid(p.geometry); openLocationSearch(p.label, clat, clng) }}
                onDelete={() => onDeletePolygon(id)}
                onSetTagInput={setTagInputId}
                onTagInputVal={setTagInputVal}
                onAddTag={(tag) => onAddTag("polygon", id, tag)}
                onRemoveTag={(tag) => onRemoveTag("polygon", id, tag)}
                onTagClick={onTagFilterChange}
              />
            )
          }
          if (type === "measurement") {
            const m = measMap[id]; if (!m) return null
            const icon = m.type === "distance" ? "━" : m.type === "area" ? "▲" : "◎"
            return (
              <LocationItem key={id}
                color="#38bdf8"
                icon={<span className="text-sky-400 text-[11px] font-bold leading-none">{icon}</span>}
                label={m.label}
                sublabel={m.type === "distance" ? `${m.points.length} pts` : m.type === "radius" ? `Circle` : `${m.points.length} pts`}
                tags={m.tags}
                tagInputId={tagInputId}
                tagInputVal={tagInputVal}
                itemId={id}
                onFlyTo={() => onFlyToMeasurement(m)}
                onSearch={() => openLocationSearch(m.label, m.points[0][1], m.points[0][0])}
                onDelete={() => onDeleteMeasurement(id)}
                onSetTagInput={setTagInputId}
                onTagInputVal={setTagInputVal}
                onAddTag={(tag) => onAddTag("measurement", id, tag)}
                onRemoveTag={(tag) => onRemoveTag("measurement", id, tag)}
                onTagClick={onTagFilterChange}
              />
            )
          }
          return null
        })}
      </div>
    </div>
  )
}

interface LocationItemProps {
  color: string
  icon: ReactNode
  label: string
  sublabel: string
  tags: string[]
  tagInputId: string | null
  tagInputVal: string
  itemId: string
  onFlyTo: () => void
  onSearch: () => void
  onDelete: () => void
  onSetTagInput: (id: string | null) => void
  onTagInputVal: (v: string) => void
  onAddTag: (tag: string) => void
  onRemoveTag: (tag: string) => void
  onTagClick: (tag: string) => void
}

function LocationItem({
  icon, label, sublabel, tags,
  tagInputId, tagInputVal, itemId,
  onFlyTo, onSearch, onDelete, onSetTagInput, onTagInputVal, onAddTag, onRemoveTag, onTagClick,
}: LocationItemProps) {
  const showTagInput = tagInputId === itemId

  return (
    <div className="group rounded-lg bg-zinc-800/50 border border-zinc-700/30 hover:border-zinc-600/60 transition-colors px-2.5 py-2 flex flex-col gap-1.5 cursor-pointer" onClick={onFlyTo}>
      <div className="flex items-center gap-2">
        <div className="flex-shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-zinc-200 font-medium truncate">{label || <span className="text-zinc-500 italic">unnamed</span>}</div>
          <div className="text-[10px] text-zinc-600 truncate">{sublabel}</div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={(e) => { e.stopPropagation(); onSearch() }} title="Search on Google" className="w-5 h-5 flex items-center justify-center text-zinc-500 hover:text-blue-400 transition-colors opacity-0 group-hover:opacity-100">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="4.5" cy="4.5" r="3.2"/><line x1="7" y1="7" x2="10" y2="10"/></svg>
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete() }} title="Delete" className="w-5 h-5 flex items-center justify-center text-zinc-500 hover:text-red-400 transition-colors text-sm opacity-0 group-hover:opacity-100">×</button>
        </div>
      </div>

      {/* Tags */}
      {(tags.length > 0 || showTagInput) && (
        <div className="flex flex-wrap gap-1 items-center" onClick={e => e.stopPropagation()}>
          {tags.map(t => (
            <button key={t} onClick={() => onTagClick(t)}
              className="group/tag flex items-center gap-0.5 text-[9px] bg-zinc-700/60 border border-zinc-600/40 text-zinc-400 hover:text-zinc-200 px-1.5 py-0.5 rounded-full transition-colors">
              {t}
              <span onClick={(e) => { e.stopPropagation(); onRemoveTag(t) }} className="opacity-0 group-hover/tag:opacity-100 text-zinc-500 hover:text-red-400 ml-0.5 transition-opacity">×</span>
            </button>
          ))}
          {showTagInput ? (
            <input autoFocus type="text" value={tagInputVal}
              onChange={e => onTagInputVal(e.target.value)}
              placeholder="tag name"
              className="text-[10px] bg-zinc-700 border border-zinc-600 rounded-full px-2 py-0.5 text-zinc-300 outline-none w-20"
              onKeyDown={e => {
                if (e.key === "Enter" && tagInputVal.trim()) {
                  onAddTag(tagInputVal.trim()); onTagInputVal(""); onSetTagInput(null)
                }
                if (e.key === "Escape") { onTagInputVal(""); onSetTagInput(null) }
              }}
              onBlur={() => { if (tagInputVal.trim()) onAddTag(tagInputVal.trim()); onTagInputVal(""); onSetTagInput(null) }}
            />
          ) : (
            <button onClick={() => { onSetTagInput(itemId); onTagInputVal("") }}
              className="text-[9px] text-zinc-600 hover:text-zinc-400 px-1.5 py-0.5 rounded-full border border-zinc-700/40 hover:border-zinc-600 transition-colors">
              + tag
            </button>
          )}
        </div>
      )}

      {/* Add tag button when no tags yet */}
      {tags.length === 0 && !showTagInput && (
        <button onClick={(e) => { e.stopPropagation(); onSetTagInput(itemId); onTagInputVal("") }}
          className="self-start text-[9px] text-zinc-600 hover:text-zinc-400 transition-colors">
          + add tag
        </button>
      )}
    </div>
  )
}