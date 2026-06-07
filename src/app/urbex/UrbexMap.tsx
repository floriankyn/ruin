"use client"

import { useEffect, useRef, useState, useCallback } from "react"
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

interface Checkpoint {
  id: string
  lngLat: { lng: number; lat: number }
  status: StatusKey
  label: string
  notes: string
  timestamp: Date
}

interface DrawnPolygon {
  id: string
  geometry: GeoJSON.Polygon
  label: string
  status: StatusKey | null
  timestamp: Date
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

// Z-order: hillshade → SV coverage → cadastre → buildings → labels → draw
function applyActiveOverlays(
  map: maplibregl.Map,
  terrain: boolean, streetview: boolean, cadastre: boolean, buildings: boolean, labels: boolean
) {
  if (terrain) addTerrainOverlay(map)
  if (streetview) addStreetViewOverlay(map)
  if (cadastre) addCadastreOverlay(map)
  if (buildings) addBuildingsOverlay(map)
  if (labels) addLabelsOverlay(map)
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
  const streetViewModeRef = useRef(false)
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
  // Overlays
  const [terrainOverlay, setTerrainOverlay] = useState(false)
  const [streetViewOverlay, setStreetViewOverlay] = useState(false)
  const [cadastreOverlay, setCadastreOverlay] = useState(false)
  const [buildingsOverlay, setBuildingsOverlay] = useState(false)
  const [labelsOverlay, setLabelsOverlay] = useState(false)
  const [overlaysOpen, setOverlaysOpen] = useState(false)
  const [streetViewMode, setStreetViewMode] = useState(false)
  // Search
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([])
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => { polygonsRef.current = polygons }, [polygons])

  const showToast = useCallback((msg: string) => {
    setToast(msg); setTimeout(() => setToast(null), 3000)
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
    map.on("mousemove", (e) => setCoords({ lng: e.lngLat.lng, lat: e.lngLat.lat }))
    map.on("contextmenu", (e) => {
      if (streetViewModeRef.current) return
      e.preventDefault()
      setContextMenu({ x: e.point.x, y: e.point.y, lngLat: { lng: e.lngLat.lng, lat: e.lngLat.lat } })
      setSelectedCheckpoint(null); setSelectedPolygon(null); setAreaMenuPos(null)
    })
    map.on("click", (e) => {
      if (streetViewModeRef.current) {
        const { lat, lng } = e.lngLat
        window.open(
          `https://www.google.com/maps/@${lat},${lng},3a,75y,0h,90t/data=!3m1!1e1`,
          "_blank", "noopener,noreferrer"
        )
        return
      }
      setContextMenu(null)
    })
    map.once("load", () => {
      if (!mapRef.current) return
      map.resize()
      applyActiveOverlays(map, terrainRef.current, streetViewRef.current, cadastreRef.current, buildingsRef.current, labelsRef.current)
      const draw = new MapboxDraw({ displayControlsDefault: false, controls: {}, defaultMode: "simple_select", styles: DRAW_STYLES })
      map.addControl(draw as unknown as maplibregl.IControl)
      drawRef.current = draw
      map.on("draw.create", (e: { features: GeoJSON.Feature[] }) => {
        const feature = e.features[0]
        if (!feature || feature.geometry.type !== "Polygon") return
        const poly: DrawnPolygon = { id: String(feature.id), geometry: feature.geometry as GeoJSON.Polygon, label: `Area ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, status: null, timestamp: new Date() }
        setPolygons((prev) => [...prev, poly])
        const [lng, lat] = computeCentroid(poly.geometry)
        const labelEl = document.createElement("div")
        Object.assign(labelEl.style, { background: "rgba(0,0,0,0.72)", color: "#d4d4d8", fontSize: "11px", fontFamily: "ui-sans-serif, system-ui, sans-serif", padding: "2px 8px", borderRadius: "4px", whiteSpace: "nowrap", pointerEvents: "none", border: "1px solid rgba(255,255,255,0.1)" })
        labelEl.textContent = poly.label
        labelMarkersRef.current.set(poly.id, new maplibregl.Marker({ element: labelEl }).setLngLat([lng, lat]).addTo(map))
        draw.changeMode("simple_select")
      })
      map.on("draw.selectionchange", (e: { features: GeoJSON.Feature[] }) => {
        if (!e.features.length) return
        const feature = e.features[0]
        if (feature.geometry.type !== "Polygon") return
        const poly = polygonsRef.current.find((p) => p.id === String(feature.id))
        if (!poly) return
        const [lng, lat] = computeCentroid(poly.geometry)
        const pt = map.project([lng, lat])
        setSelectedPolygon(poly)
        setAreaMenuPos({ x: clamp(pt.x - 112, 8, window.innerWidth - 240), y: clamp(pt.y - 20, 8, window.innerHeight - 420) })
        setSelectedCheckpoint(null); setContextMenu(null)
      })
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
        const versions = waybackVersionsRef.current
        if (idx !== null && versions[idx]) {
          const src = map.getSource("tiles") as maplibregl.RasterTileSource | undefined
          src?.setTiles([waybackTileUrl(versions[idx].id)])
        }
      }
      applyActiveOverlays(map, terrainRef.current, streetViewRef.current, cadastreRef.current, buildingsRef.current, labelsRef.current)
      const newDraw = new MapboxDraw({ displayControlsDefault: false, controls: {}, defaultMode: "simple_select", styles: DRAW_STYLES })
      map.addControl(newDraw as unknown as maplibregl.IControl)
      drawRef.current = newDraw
      if (savedFeatures && savedFeatures.features.length > 0) newDraw.set(savedFeatures)
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
    src.setTiles(waybackIdx === null ? ESRI_SATELLITE_TILES : [waybackTileUrl(waybackVersions[waybackIdx]?.id ?? "")])
  }, [waybackIdx, baseLayer, waybackVersions])

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
    streetViewModeRef.current = streetViewMode
    const canvas = mapRef.current?.getCanvas()
    if (canvas) canvas.style.cursor = streetViewMode ? "crosshair" : ""
  }, [streetViewMode])

  // ── Checkpoint ────────────────────────────────────────────────────────────
  const addCheckpoint = useCallback((lngLat: { lng: number; lat: number }, status: StatusKey) => {
    const cfg = STATUSES.find((s) => s.key === status)!
    const id = crypto.randomUUID()
    const cp: Checkpoint = { id, lngLat, status, label: "", notes: "", timestamp: new Date() }
    setCheckpoints((prev) => [...prev, cp])
    const el = makeMarkerEl(cfg.color)
    const marker = new maplibregl.Marker({ element: el }).setLngLat([lngLat.lng, lngLat.lat]).addTo(mapRef.current!)
    el.addEventListener("click", (e) => { e.stopPropagation(); setSelectedCheckpoint(cp); setContextMenu(null); setSelectedPolygon(null); setAreaMenuPos(null) })
    markersRef.current.set(id, marker)
    setContextMenu(null)
  }, [])

  const startDraw = useCallback(() => { drawRef.current?.changeMode("draw_polygon") }, [])

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

  const maxIdx = waybackVersions.length - 1
  const sliderVal = waybackIdx ?? maxIdx
  const stepOlder = () => setWaybackIdx((i) => i === null ? maxIdx : Math.max(0, i - 1))
  const stepNewer = () => setWaybackIdx((i) => (i === null || i >= maxIdx) ? null : i + 1)

  const anyOverlayActive = terrainOverlay || streetViewOverlay || cadastreOverlay || buildingsOverlay || labelsOverlay

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: "fixed", inset: 0, background: "#09090b" }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      {/* ── Search + Draw — top left ────────────────────────────────────────── */}
      <div className="absolute top-4 left-4 z-20 flex flex-col gap-2">
        <div className="relative">
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
        <button onClick={startDraw} className="flex items-center gap-2 w-fit bg-zinc-900/90 backdrop-blur-sm text-zinc-200 text-sm px-3 py-2 rounded-lg border border-zinc-700/60 hover:bg-zinc-800 hover:text-white transition-colors shadow-lg">
          <PolygonIcon /> Draw Area
        </button>
        <button
          onClick={() => setStreetViewMode((v) => !v)}
          title={streetViewMode ? "Click the map to open Street View at that point" : "Enable Street View click mode"}
          className={`flex items-center gap-2 w-fit text-sm px-3 py-2 rounded-lg border transition-colors shadow-lg ${
            streetViewMode
              ? "bg-blue-500 text-white border-blue-400 hover:bg-blue-600"
              : "bg-zinc-900/90 backdrop-blur-sm text-zinc-200 border-zinc-700/60 hover:bg-zinc-800 hover:text-white"
          }`}
        >
          <StreetViewIcon /> Street View{streetViewMode && <span className="text-xs opacity-75">· click map</span>}
        </button>
      </div>

      {/* ── Layer switcher + Overlays — top right ───────────────────────────── */}
      <div className="absolute top-4 right-4 z-20 flex flex-col gap-2 items-end">
        {/* Layer picker */}
        <div className="bg-zinc-900/90 backdrop-blur-sm border border-zinc-700/60 rounded-xl shadow-lg overflow-hidden w-44">
          {/* Standard group */}
          <div className="px-2 pt-2 pb-1.5">
            <div className="text-[9px] uppercase tracking-widest font-semibold text-zinc-600 px-1.5 mb-1">Standard</div>
            {STANDARD_LAYERS.map(({ key, label }) => (
              <LayerButton key={key} active={baseLayer === key} onClick={() => setBaseLayer(key)}>{label}</LayerButton>
            ))}
          </div>
          <div className="border-t border-zinc-800" />
          {/* Esri group */}
          <div className="px-2 pt-2 pb-2 max-h-56 overflow-y-auto">
            <div className="text-[9px] uppercase tracking-widest font-semibold text-zinc-600 px-1.5 mb-1">Esri</div>
            {ESRI_LAYERS.map(({ key, label }) => (
              <LayerButton key={key} active={baseLayer === key} onClick={() => setBaseLayer(key)}>{label}</LayerButton>
            ))}
          </div>
        </div>

        {/* Overlays toggle */}
        <button
          onClick={() => setOverlaysOpen((v) => !v)}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border shadow transition-colors ${
            overlaysOpen || anyOverlayActive
              ? "bg-zinc-100 text-zinc-900 border-zinc-300 font-semibold"
              : "bg-zinc-900/90 backdrop-blur-sm text-zinc-400 border-zinc-700/60 hover:text-zinc-200 hover:bg-zinc-800"
          }`}
        >
          <LayersIcon active={overlaysOpen || anyOverlayActive} />
          Overlays
          {anyOverlayActive && <span className="ml-0.5 text-[10px] opacity-70">{[terrainOverlay, streetViewOverlay, cadastreOverlay, buildingsOverlay, labelsOverlay].filter(Boolean).length}</span>}
          <span className="ml-0.5 opacity-50 text-[10px]">{overlaysOpen ? "▲" : "▼"}</span>
        </button>

        {/* Overlays panel */}
        {overlaysOpen && (
          <div className="bg-zinc-900/95 backdrop-blur-sm border border-zinc-700/60 rounded-xl shadow-2xl overflow-hidden w-56">
            <div className="px-3 py-2 border-b border-zinc-800">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Map Overlays</span>
            </div>
            <div className="p-2 flex flex-col gap-0.5">
              <OverlayToggle label="Labels" description="City, street & place names" checked={labelsOverlay} onChange={setLabelsOverlay} />
              <OverlayToggle label="Buildings" description="OSM building footprints" checked={buildingsOverlay} onChange={setBuildingsOverlay} />
              <OverlayToggle label="Cadastre (France)" description="IGN parcel boundaries · zoom 12+" checked={cadastreOverlay} onChange={setCadastreOverlay} />
              <OverlayToggle label="Street View coverage" description="Google SV blue lines" checked={streetViewOverlay} onChange={setStreetViewOverlay} />
              <OverlayToggle label="Terrain & Hillshade" description="3D elevation · right-drag to tilt" checked={terrainOverlay} onChange={setTerrainOverlay} />
            </div>
          </div>
        )}
      </div>

      {/* ── Coord readout ─────────────────────────────────────────────────────── */}
      <div className="absolute bottom-4 left-4 z-10 select-none bg-zinc-900/80 backdrop-blur-sm font-mono text-[11px] text-zinc-400 px-3 py-1.5 rounded-lg border border-zinc-700/60 shadow">
        {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
      </div>

      {/* ── Satellite timeline ── bottom center, satellite only ──────────────── */}
      {baseLayer === "satellite" && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-zinc-900/90 backdrop-blur-sm border border-zinc-700/60 rounded-xl px-4 py-3 shadow-lg select-none" style={{ minWidth: 340 }}>
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[10px] uppercase tracking-wider font-medium text-zinc-500">Esri Imagery Timeline</span>
            <button onClick={() => setWaybackIdx(null)} className={`text-xs px-2 py-0.5 rounded-md transition-colors font-medium ${waybackIdx === null ? "bg-zinc-100 text-zinc-900" : "text-zinc-400 hover:text-zinc-200"}`}>
              Latest
            </button>
          </div>
          {waybackLoading ? (
            <div className="text-[11px] text-zinc-500 text-center py-1">Loading versions…</div>
          ) : waybackVersions.length > 0 ? (
            <>
              <div className="flex items-center gap-2">
                <button onClick={stepOlder} disabled={waybackIdx === 0} className="w-6 h-6 flex items-center justify-center rounded-md bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-300 transition-colors flex-shrink-0 text-sm" title="Older">‹</button>
                <input
                  type="range" min={0} max={maxIdx} value={sliderVal}
                  onChange={(e) => { const v = Number(e.target.value); setWaybackIdx(v >= maxIdx ? null : v) }}
                  className="flex-1 h-1.5 appearance-none bg-zinc-700 rounded-full outline-none cursor-pointer"
                  style={{ accentColor: "#3b82f6" }}
                />
                <button onClick={stepNewer} disabled={waybackIdx === null} className="w-6 h-6 flex items-center justify-center rounded-md bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-300 transition-colors flex-shrink-0 text-sm" title="Newer">›</button>
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-[10px] text-zinc-600">{waybackVersions[0]?.label}</span>
                <span className={`text-xs font-semibold tabular-nums ${waybackIdx === null ? "text-zinc-400" : "text-blue-400"}`}>
                  {waybackIdx === null ? "Current · Live Esri" : `${waybackVersions[waybackIdx]?.label ?? ""} · Esri Wayback`}
                </span>
                <span className="text-[10px] text-zinc-600">{waybackVersions[maxIdx]?.label}</span>
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
            <button key={s.key} onClick={() => addCheckpoint(contextMenu.lngLat, s.key)} className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 transition-colors">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Checkpoint profile ───────────────────────────────────────────────── */}
      {selectedCheckpoint && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-4 w-72">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: STATUSES.find((s) => s.key === selectedCheckpoint.status)?.color }} />
              <span className="text-sm font-semibold text-zinc-100">{STATUSES.find((s) => s.key === selectedCheckpoint.status)?.label}</span>
            </div>
            <button onClick={() => setSelectedCheckpoint(null)} className="text-zinc-500 hover:text-zinc-300 leading-none w-6 h-6 flex items-center justify-center text-xl">×</button>
          </div>
          <div className="text-xs font-mono text-zinc-400 mb-1">{selectedCheckpoint.lngLat.lat.toFixed(5)}, {selectedCheckpoint.lngLat.lng.toFixed(5)}</div>
          <div className="text-xs text-zinc-600">{selectedCheckpoint.timestamp.toLocaleString()}</div>
        </div>
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

function OverlayToggle({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-2 py-2 rounded-lg hover:bg-zinc-800/60 transition-colors">
      <div className="min-w-0">
        <div className="text-xs font-medium text-zinc-200 leading-tight">{label}</div>
        {description && <div className="text-[10px] text-zinc-600 mt-0.5 leading-tight">{description}</div>}
      </div>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`relative flex-shrink-0 w-9 h-5 rounded-full transition-colors focus:outline-none ${checked ? "bg-blue-500" : "bg-zinc-600"}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
      </button>
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