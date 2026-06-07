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

type BaseLayer = "dark" | "satellite" | "terrain" | "street"

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
  boundingbox: [string, string, string, string] // [minLat, maxLat, minLng, maxLng]
}

// ─── Constants ────────────────────────────────────────────────────────────────

function rasterStyle(
  tiles: string[],
  attribution: string,
  background = "#aadaff"
): StyleSpecification {
  return {
    version: 8,
    sources: {
      tiles: { type: "raster", tiles, tileSize: 256, attribution, maxzoom: 19 },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": background } },
      { id: "raster-tiles", type: "raster", source: "tiles" },
    ],
  }
}

const CURRENT_YEAR = new Date().getFullYear()
const MIN_SAT_YEAR = 2002  // MODIS Terra TrueColor archive start
const MAX_SAT_YEAR = CURRENT_YEAR - 1  // current year archive is incomplete mid-year

const ESRI_SATELLITE_TILES = [
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
]

// NASA GIBS WMTS — free, no API key. Mid-June chosen for clearest NH-summer imagery.
function gibsTiles(year: number): string[] {
  return [
    `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${year}-06-15/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
  ]
}

const STYLES: Record<BaseLayer, StyleSpecification> = {
  dark: rasterStyle(
    [
      "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
      "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
      "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
    ],
    "© OpenStreetMap contributors, © CARTO",
    "#1a1a2e"
  ),
  street: rasterStyle(
    ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    "© OpenStreetMap contributors",
    "#c8d8c8"
  ),
  terrain: rasterStyle(
    ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
    "© OpenStreetMap contributors, © OpenTopoMap",
    "#d8e8d0"
  ),
  // "Latest" = Esri World Imagery. Historical years switch to NASA GIBS MODIS Terra via setTiles().
  satellite: rasterStyle(
    ESRI_SATELLITE_TILES,
    "© Esri, Maxar, Earthstar Geographics",
    "#1a2a1a"
  ),
}

// MapLibre GL v5 rejects ["get", "prop"] arrays inside legacy filters — use bare string "prop" instead.
// Split the single "lines" layer into active/inactive so line-dasharray can be a static value.
const DRAW_STYLES = [
  {
    id: "gl-draw-polygon-fill",
    type: "fill",
    filter: ["all", ["==", "$type", "Polygon"]],
    paint: {
      "fill-color": ["case", ["==", ["get", "active"], "true"], "#fbb03b", "#3bb2d0"],
      "fill-opacity": 0.1,
    },
  },
  {
    id: "gl-draw-lines-active",
    type: "line",
    filter: ["all", ["any", ["==", "$type", "LineString"], ["==", "$type", "Polygon"]], ["==", "active", "true"]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#fbb03b", "line-dasharray": [0.2, 2], "line-width": 2 },
  },
  {
    id: "gl-draw-lines-inactive",
    type: "line",
    filter: ["all", ["any", ["==", "$type", "LineString"], ["==", "$type", "Polygon"]], ["!=", "active", "true"]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#3bb2d0", "line-dasharray": [2, 0], "line-width": 2 },
  },
  {
    id: "gl-draw-point-outer",
    type: "circle",
    filter: ["all", ["==", "$type", "Point"], ["==", "meta", "feature"]],
    paint: {
      "circle-radius": ["case", ["==", ["get", "active"], "true"], 7, 5],
      "circle-color": "#fff",
    },
  },
  {
    id: "gl-draw-point-inner",
    type: "circle",
    filter: ["all", ["==", "$type", "Point"], ["==", "meta", "feature"]],
    paint: {
      "circle-radius": ["case", ["==", ["get", "active"], "true"], 5, 3],
      "circle-color": ["case", ["==", ["get", "active"], "true"], "#fbb03b", "#3bb2d0"],
    },
  },
  {
    id: "gl-draw-vertex-outer",
    type: "circle",
    filter: ["all", ["==", "$type", "Point"], ["==", "meta", "vertex"], ["!=", "mode", "simple_select"]],
    paint: {
      "circle-radius": ["case", ["==", ["get", "active"], "true"], 7, 5],
      "circle-color": "#fff",
    },
  },
  {
    id: "gl-draw-vertex-inner",
    type: "circle",
    filter: ["all", ["==", "$type", "Point"], ["==", "meta", "vertex"], ["!=", "mode", "simple_select"]],
    paint: {
      "circle-radius": ["case", ["==", ["get", "active"], "true"], 5, 3],
      "circle-color": "#fbb03b",
    },
  },
  {
    id: "gl-draw-midpoint",
    type: "circle",
    filter: ["all", ["==", "meta", "midpoint"]],
    paint: { "circle-radius": 3, "circle-color": "#fbb03b" },
  },
]

const STATUSES: { key: StatusKey; label: string; color: string }[] = [
  { key: "worth-exploring", label: "Worth Exploring", color: "#22c55e" },
  { key: "not-interesting", label: "Not Interesting", color: "#71717a" },
  { key: "inaccessible", label: "Inaccessible", color: "#ef4444" },
  { key: "demolished", label: "Demolished", color: "#f97316" },
  { key: "visited", label: "Visited", color: "#3b82f6" },
  { key: "needs-more-research", label: "Needs More Research", color: "#a855f7" },
]

const BASE_LAYERS: { key: BaseLayer; label: string }[] = [
  { key: "satellite", label: "Satellite" },
  { key: "terrain", label: "Terrain" },
  { key: "street", label: "Street" },
  { key: "dark", label: "Dark" },
]

const DORKS: { label: string; template: (loc: string) => string }[] = [
  { label: "Abandoned", template: (loc) => `"${loc}" abandoned` },
  { label: "Flickr photos", template: (loc) => `"${loc}" site:flickr.com` },
  { label: "Reddit urbex", template: (loc) => `"${loc}" site:reddit.com urbex` },
  { label: "History & plans", template: (loc) => `"${loc}" history plans blueprints filetype:pdf` },
]

// ─── Map helpers ───────────────────────────────────────────────────────────────

function computeCentroid(geometry: GeoJSON.Polygon): [number, number] {
  const ring = geometry.coordinates[0]
  const n = ring.length - 1
  let sumLng = 0
  let sumLat = 0
  for (let i = 0; i < n; i++) {
    sumLng += ring[i][0]
    sumLat += ring[i][1]
  }
  return [sumLng / n, sumLat / n]
}

function makeMarkerEl(color: string): HTMLDivElement {
  const el = document.createElement("div")
  Object.assign(el.style, {
    width: "16px",
    height: "16px",
    borderRadius: "50%",
    background: color,
    border: "2px solid rgba(255,255,255,0.75)",
    boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
    cursor: "pointer",
    transition: "transform 0.1s",
  })
  el.addEventListener("mouseenter", () => { el.style.transform = "scale(1.35)" })
  el.addEventListener("mouseleave", () => { el.style.transform = "scale(1)" })
  return el
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

// Terrain overlay: raster-dem source (Terrarium encoding, AWS elevation tiles, free)
// + hillshade layer (2D shading) + 3D terrain extrusion via map.setTerrain().
// Must be added BEFORE draw layers so hillshade sits below draw annotations.
function addTerrainOverlay(map: maplibregl.Map) {
  if (map.getSource("terrain-dem")) return
  map.addSource("terrain-dem", {
    type: "raster-dem",
    tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
    encoding: "terrarium",
    tileSize: 256,
    maxzoom: 15,
  })
  // Insert before the first draw layer so hillshade is rendered below draw annotations
  const firstDrawLayer = map.getStyle()?.layers?.find((l) => l.id.startsWith("gl-draw-"))?.id
  map.addLayer(
    {
      id: "terrain-hillshade",
      type: "hillshade",
      source: "terrain-dem",
      paint: {
        "hillshade-illumination-direction": 335,
        "hillshade-exaggeration": 0.5,
        "hillshade-shadow-color": "#000000",
        "hillshade-highlight-color": "#ffffff",
        "hillshade-accent-color": "#000000",
      },
    },
    firstDrawLayer
  )
  try {
    // 3D terrain — extrudes the map surface; user can tilt (right-drag) to see the effect
    map.setTerrain({ source: "terrain-dem", exaggeration: 1.5 })
  } catch {
    // setTerrain may fail on some style configs; hillshade still provides the 2D effect
  }
}

function removeTerrainOverlay(map: maplibregl.Map) {
  try { map.setTerrain(null) } catch { /* */ }
  if (map.getLayer("terrain-hillshade")) map.removeLayer("terrain-hillshade")
  if (map.getSource("terrain-dem")) map.removeSource("terrain-dem")
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
  // Prevents React 19 Strict Mode's double-invoke from creating two map instances
  const initRef = useRef(false)
  // Refs kept in sync with their state counterparts for use inside map event callbacks
  const satelliteYearRef = useRef<number | null>(null)
  const terrainOverlayRef = useRef(false)
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
  const [satelliteYear, setSatelliteYear] = useState<number | null>(null)
  const [terrainOverlay, setTerrainOverlay] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([])
  const [searchOpen, setSearchOpen] = useState(false)

  // Keep ref in sync so event handlers inside init useEffect always see latest polygons
  useEffect(() => { polygonsRef.current = polygons }, [polygons])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }, [])

  // ── Map initialisation ──────────────────────────────────────────────────────
  useEffect(() => {
    if (initRef.current || !containerRef.current) return
    initRef.current = true

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLES["dark"],
      center: [2.3522, 48.8566],
      zoom: 11,
      scrollZoom: true,
      dragPan: true,
      dragRotate: true,
      doubleClickZoom: true,
      touchZoomRotate: true,
    })

    mapRef.current = map

    map.on("mousemove", (e) => {
      setCoords({ lng: e.lngLat.lng, lat: e.lngLat.lat })
    })

    map.on("contextmenu", (e) => {
      e.preventDefault()
      setContextMenu({ x: e.point.x, y: e.point.y, lngLat: { lng: e.lngLat.lng, lat: e.lngLat.lat } })
      setSelectedCheckpoint(null)
      setSelectedPolygon(null)
      setAreaMenuPos(null)
    })

    map.on("click", () => {
      setContextMenu(null)
    })

    map.once("load", () => {
      if (!mapRef.current) return
      map.resize()

      // Terrain overlay added before draw so hillshade sits below draw layers
      if (terrainOverlayRef.current) addTerrainOverlay(map)

      const draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: {},
        defaultMode: "simple_select",
        styles: DRAW_STYLES,
      })
      map.addControl(draw as unknown as maplibregl.IControl)
      drawRef.current = draw

      map.on("draw.create", (e: { features: GeoJSON.Feature[] }) => {
        const feature = e.features[0]
        if (!feature || feature.geometry.type !== "Polygon") return

        const poly: DrawnPolygon = {
          id: String(feature.id),
          geometry: feature.geometry as GeoJSON.Polygon,
          label: `Area ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
          status: null,
          timestamp: new Date(),
        }
        setPolygons((prev) => [...prev, poly])

        const [lng, lat] = computeCentroid(poly.geometry)
        const labelEl = document.createElement("div")
        Object.assign(labelEl.style, {
          background: "rgba(0,0,0,0.72)",
          color: "#d4d4d8",
          fontSize: "11px",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          padding: "2px 8px",
          borderRadius: "4px",
          whiteSpace: "nowrap",
          pointerEvents: "none",
          border: "1px solid rgba(255,255,255,0.1)",
        })
        labelEl.textContent = poly.label

        const labelMarker = new maplibregl.Marker({ element: labelEl })
          .setLngLat([lng, lat])
          .addTo(map)
        labelMarkersRef.current.set(poly.id, labelMarker)

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
        const x = clamp(pt.x - 112, 8, window.innerWidth - 240)
        const y = clamp(pt.y - 20, 8, window.innerHeight - 420)

        setSelectedPolygon(poly)
        setAreaMenuPos({ x, y })
        setSelectedCheckpoint(null)
        setContextMenu(null)
      })
    })

    return () => {
      initRef.current = false
      map.remove()
      mapRef.current = null
      drawRef.current = null
    }
  }, [])

  // ── Base layer switching ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || baseLayer === baseLayerRef.current) return
    baseLayerRef.current = baseLayer

    const oldDraw = drawRef.current
    let savedFeatures: ReturnType<typeof oldDraw.getAll> | null = null
    if (oldDraw) {
      try { savedFeatures = oldDraw.getAll() } catch { /* ctx already null */ }
      try { map.removeControl(oldDraw as unknown as maplibregl.IControl) } catch { /* */ }
    }
    drawRef.current = null

    map.setStyle(STYLES[baseLayer])

    map.once("style.load", () => {
      // Apply historical GIBS tiles if a year was selected in satellite mode
      if (baseLayer === "satellite" && satelliteYearRef.current !== null) {
        const src = map.getSource("tiles") as maplibregl.RasterTileSource | undefined
        src?.setTiles(gibsTiles(satelliteYearRef.current))
      }

      // Re-apply terrain overlay (hillshade before draw layers for correct z-order)
      if (terrainOverlayRef.current) addTerrainOverlay(map)

      const newDraw = new MapboxDraw({
        displayControlsDefault: false,
        controls: {},
        defaultMode: "simple_select",
        styles: DRAW_STYLES,
      })
      map.addControl(newDraw as unknown as maplibregl.IControl)
      drawRef.current = newDraw

      if (savedFeatures && savedFeatures.features.length > 0) {
        newDraw.set(savedFeatures)
      }
      // draw.create / draw.selectionchange stay registered on the map object
    })
  }, [baseLayer])

  // ── Satellite year tile swap ────────────────────────────────────────────────
  useEffect(() => {
    satelliteYearRef.current = satelliteYear
    if (baseLayer !== "satellite") return
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return

    const src = map.getSource("tiles") as maplibregl.RasterTileSource | undefined
    if (!src) return

    src.setTiles(satelliteYear === null ? ESRI_SATELLITE_TILES : gibsTiles(satelliteYear))
  }, [satelliteYear, baseLayer])

  // ── Terrain overlay toggle ──────────────────────────────────────────────────
  useEffect(() => {
    terrainOverlayRef.current = terrainOverlay
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return

    if (terrainOverlay) {
      addTerrainOverlay(map)
    } else {
      removeTerrainOverlay(map)
    }
  }, [terrainOverlay])

  // ── Add checkpoint ──────────────────────────────────────────────────────────
  const addCheckpoint = useCallback((lngLat: { lng: number; lat: number }, status: StatusKey) => {
    const cfg = STATUSES.find((s) => s.key === status)!
    const id = crypto.randomUUID()
    const cp: Checkpoint = { id, lngLat, status, label: "", notes: "", timestamp: new Date() }

    setCheckpoints((prev) => [...prev, cp])

    const el = makeMarkerEl(cfg.color)
    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([lngLat.lng, lngLat.lat])
      .addTo(mapRef.current!)

    el.addEventListener("click", (e) => {
      e.stopPropagation()
      setSelectedCheckpoint(cp)
      setContextMenu(null)
      setSelectedPolygon(null)
      setAreaMenuPos(null)
    })

    markersRef.current.set(id, marker)
    setContextMenu(null)
  }, [])

  const startDraw = useCallback(() => {
    drawRef.current?.changeMode("draw_polygon")
  }, [])

  // ── Place search (Nominatim, debounced 400ms) ───────────────────────────────
  const handleSearchInput = useCallback((query: string) => {
    setSearchQuery(query)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    if (!query.trim()) {
      setSearchResults([])
      setSearchOpen(false)
      return
    }
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=6`,
          { headers: { "Accept-Language": "en" } }
        )
        const data: NominatimResult[] = await res.json()
        setSearchResults(data)
        setSearchOpen(data.length > 0)
      } catch { /* ignore network errors */ }
    }, 400)
  }, [])

  const handleSearchSelect = useCallback((result: NominatimResult) => {
    const map = mapRef.current
    if (!map) return
    const [minLat, maxLat, minLon, maxLon] = result.boundingbox
    map.fitBounds(
      [[parseFloat(minLon), parseFloat(minLat)], [parseFloat(maxLon), parseFloat(maxLat)]],
      { padding: 40, maxZoom: 16 }
    )
    setSearchQuery(result.display_name)
    setSearchResults([])
    setSearchOpen(false)
  }, [])

  const contextCoordString = selectedPolygon
    ? `${computeCentroid(selectedPolygon.geometry)[1].toFixed(4)},${computeCentroid(selectedPolygon.geometry)[0].toFixed(4)}`
    : ""

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: "fixed", inset: 0, background: "#09090b" }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      {/* ── Search bar + Draw button — top left ────────────────────────────── */}
      <div className="absolute top-4 left-4 z-20 flex flex-col gap-2">
        {/* Place search */}
        <div className="relative">
          <div className="flex items-center gap-2 bg-zinc-900/90 backdrop-blur-sm border border-zinc-700/60 rounded-lg px-3 py-2 shadow-lg w-64">
            <SearchIcon />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchInput(e.target.value)}
              onFocus={() => { if (searchResults.length > 0) setSearchOpen(true) }}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              placeholder="Search place…"
              className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-500 outline-none min-w-0"
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(""); setSearchResults([]); setSearchOpen(false) }}
                className="text-zinc-500 hover:text-zinc-300 text-lg leading-none flex-shrink-0"
              >
                ×
              </button>
            )}
          </div>
          {searchOpen && searchResults.length > 0 && (
            <div className="absolute top-full mt-1 left-0 w-64 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden max-h-60 overflow-y-auto">
              {searchResults.map((r) => (
                <button
                  key={r.place_id}
                  onMouseDown={() => handleSearchSelect(r)}
                  className="w-full text-left px-3 py-2.5 text-xs text-zinc-300 hover:bg-zinc-800 border-b border-zinc-800/60 last:border-0 transition-colors truncate"
                >
                  {r.display_name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Draw polygon */}
        <button
          onClick={startDraw}
          className="flex items-center gap-2 w-fit bg-zinc-900/90 backdrop-blur-sm text-zinc-200 text-sm px-3 py-2 rounded-lg border border-zinc-700/60 hover:bg-zinc-800 hover:text-white transition-colors shadow-lg"
        >
          <PolygonIcon />
          Draw Area
        </button>
      </div>

      {/* ── Base layer switcher — top right ──────────────────────────────────── */}
      <div className="absolute top-4 right-4 z-10 flex flex-col gap-0.5 bg-zinc-900/90 backdrop-blur-sm border border-zinc-700/60 rounded-xl p-1.5 shadow-lg">
        {BASE_LAYERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setBaseLayer(key)}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors text-left whitespace-nowrap ${
              baseLayer === key
                ? "bg-zinc-100 text-zinc-900 font-semibold"
                : "text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Coordinate readout — bottom left ─────────────────────────────────── */}
      <div className="absolute bottom-4 left-4 z-10 select-none bg-zinc-900/80 backdrop-blur-sm font-mono text-[11px] text-zinc-400 px-3 py-1.5 rounded-lg border border-zinc-700/60 shadow">
        {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
      </div>

      {/* ── Satellite controls — bottom center, satellite mode only ──────────── */}
      {baseLayer === "satellite" && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-zinc-900/90 backdrop-blur-sm border border-zinc-700/60 rounded-xl px-4 py-3 shadow-lg select-none" style={{ minWidth: 320 }}>
          {/* Timeline header */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-wider font-medium text-zinc-500">Imagery Timeline</span>
            <button
              onClick={() => setSatelliteYear(null)}
              className={`text-xs px-2 py-0.5 rounded-md transition-colors font-medium ${
                satelliteYear === null
                  ? "bg-zinc-100 text-zinc-900"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Latest
            </button>
          </div>

          {/* Year slider */}
          <div className="flex items-center gap-2.5">
            <span className="text-[11px] text-zinc-500 w-8 text-right tabular-nums">{MIN_SAT_YEAR}</span>
            <input
              type="range"
              min={MIN_SAT_YEAR}
              max={MAX_SAT_YEAR}
              value={satelliteYear ?? MAX_SAT_YEAR}
              onChange={(e) => setSatelliteYear(Number(e.target.value))}
              className="flex-1 h-1.5 appearance-none bg-zinc-700 rounded-full outline-none cursor-pointer"
              style={{ accentColor: "#3b82f6" }}
            />
            <span className="text-[11px] text-zinc-500 w-8 tabular-nums">{MAX_SAT_YEAR}</span>
          </div>

          {/* Current selection label */}
          <div className="text-center mt-1.5 h-4">
            {satelliteYear !== null ? (
              <span className="text-xs font-semibold text-blue-400 tabular-nums">{satelliteYear} · NASA GIBS MODIS Terra</span>
            ) : (
              <span className="text-xs text-zinc-500">Current imagery · Esri World</span>
            )}
          </div>

          {/* Terrain overlay toggle */}
          <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-zinc-800">
            <div>
              <span className="text-[11px] font-medium text-zinc-300">Terrain &amp; Hillshade</span>
              <p className="text-[10px] text-zinc-600 mt-0.5">Hillshade + 3D extrusion · right-drag to tilt</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={terrainOverlay}
              onClick={() => setTerrainOverlay((v) => !v)}
              className={`relative flex-shrink-0 w-9 h-5 rounded-full transition-colors focus:outline-none ${terrainOverlay ? "bg-blue-500" : "bg-zinc-600"}`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${terrainOverlay ? "translate-x-4" : "translate-x-0.5"}`}
              />
            </button>
          </div>
        </div>
      )}

      {/* ── Context menu (right-click) ────────────────────────────────────── */}
      {contextMenu && (
        <div
          className="absolute z-20 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden min-w-[196px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div className="px-3 py-2 border-b border-zinc-800">
            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Mark location</span>
          </div>
          {STATUSES.map((s) => (
            <button
              key={s.key}
              onClick={() => addCheckpoint(contextMenu.lngLat, s.key)}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 transition-colors"
            >
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Checkpoint profile panel ──────────────────────────────────────── */}
      {selectedCheckpoint && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-4 w-72">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ background: STATUSES.find((s) => s.key === selectedCheckpoint.status)?.color }}
              />
              <span className="text-sm font-semibold text-zinc-100">
                {STATUSES.find((s) => s.key === selectedCheckpoint.status)?.label}
              </span>
            </div>
            <button
              onClick={() => setSelectedCheckpoint(null)}
              className="text-zinc-500 hover:text-zinc-300 leading-none w-6 h-6 flex items-center justify-center text-xl"
            >
              ×
            </button>
          </div>
          <div className="text-xs font-mono text-zinc-400 mb-1">
            {selectedCheckpoint.lngLat.lat.toFixed(5)}, {selectedCheckpoint.lngLat.lng.toFixed(5)}
          </div>
          <div className="text-xs text-zinc-600">
            {selectedCheckpoint.timestamp.toLocaleString()}
          </div>
        </div>
      )}

      {/* ── Area Action Menu ──────────────────────────────────────────────── */}
      {selectedPolygon && areaMenuPos && !researchOpen && (
        <div
          className="absolute z-20 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-56 overflow-hidden"
          style={{ left: areaMenuPos.x, top: areaMenuPos.y }}
        >
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800">
            <span className="text-sm font-semibold text-zinc-100 truncate">{selectedPolygon.label}</span>
            <button
              onClick={() => { setSelectedPolygon(null); setAreaMenuPos(null) }}
              className="text-zinc-500 hover:text-zinc-300 leading-none ml-2 flex-shrink-0 w-5 h-5 flex items-center justify-center text-xl"
            >
              ×
            </button>
          </div>

          <div className="px-3 pt-2.5 pb-2 border-b border-zinc-800/60">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Set Status</div>
            <div className="grid grid-cols-2 gap-1">
              {STATUSES.map((s) => (
                <button
                  key={s.key}
                  onClick={() => {
                    const updated = polygons.map((p) =>
                      p.id === selectedPolygon.id ? { ...p, status: s.key } : p
                    )
                    setPolygons(updated)
                    setSelectedPolygon(updated.find((p) => p.id === selectedPolygon.id)!)
                  }}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] transition-colors leading-tight"
                  style={{
                    background: selectedPolygon.status === s.key ? s.color + "25" : "transparent",
                    color: s.color,
                    border: `1px solid ${s.color}${selectedPolygon.status === s.key ? "70" : "28"}`,
                  }}
                >
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
              <button
                key={label}
                onClick={cb}
                className="text-sm text-left px-3 py-2 rounded-lg text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Research Panel ────────────────────────────────────────────────── */}
      {selectedPolygon && researchOpen && (
        <div className="absolute top-4 right-4 z-30 w-80 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
            <button
              onClick={() => setResearchOpen(false)}
              className="text-zinc-500 hover:text-zinc-300 text-sm leading-none flex-shrink-0"
            >
              ←
            </button>
            <span className="text-sm font-semibold text-zinc-100">Research Panel</span>
            <button
              onClick={() => { setResearchOpen(false); setSelectedPolygon(null); setAreaMenuPos(null) }}
              className="ml-auto text-zinc-500 hover:text-zinc-300 leading-none w-5 h-5 flex items-center justify-center text-xl"
            >
              ×
            </button>
          </div>

          <div className="p-4 space-y-5 overflow-y-auto max-h-[calc(100vh-6rem)]">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Contextual Search</span>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <span className="text-[11px] text-zinc-500">Context</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={useCtx}
                    onClick={() => setUseCtx((v) => !v)}
                    className={`relative w-8 h-4 rounded-full transition-colors focus:outline-none ${useCtx ? "bg-blue-500" : "bg-zinc-600"}`}
                  >
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${useCtx ? "translate-x-4" : "translate-x-0.5"}`} />
                  </button>
                </label>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const q = useCtx ? `${researchQuery} ${contextCoordString}` : researchQuery
                  window.open(`https://www.google.com/search?q=${encodeURIComponent(q)}`, "_blank", "noopener,noreferrer")
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={researchQuery}
                  onChange={(e) => setResearchQuery(e.target.value)}
                  placeholder={contextCoordString || "Search query…"}
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-zinc-500 transition-colors"
                />
                <button
                  type="submit"
                  className="bg-zinc-700 hover:bg-zinc-600 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium flex-shrink-0"
                >
                  Go
                </button>
              </form>
            </div>

            <div>
              <div className="text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2">Google Dork Helper</div>
              <div className="flex flex-col gap-1.5">
                {DORKS.map(({ label, template }) => {
                  const q = template(contextCoordString || "location")
                  return (
                    <button
                      key={label}
                      onClick={() =>
                        window.open(
                          `https://www.google.com/search?q=${encodeURIComponent(q)}`,
                          "_blank",
                          "noopener,noreferrer"
                        )
                      }
                      className="text-left px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700/50 hover:border-zinc-600 hover:bg-zinc-700/80 transition-colors group"
                    >
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

      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      {toast && (
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-50 pointer-events-none bg-zinc-800/95 backdrop-blur-sm border border-zinc-700 text-zinc-200 text-sm px-4 py-2.5 rounded-xl shadow-xl whitespace-nowrap">
          {toast}
        </div>
      )}

      <span className="hidden">{checkpoints.length}</span>
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
      <circle cx="5.5" cy="5.5" r="4" />
      <line x1="8.5" y1="8.5" x2="12" y2="12" />
    </svg>
  )
}