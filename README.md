# RUIN — Feature Summary


A self-hosted urbex intelligence platform. Explore, document, and investigate abandoned locations using satellite imagery, AI analysis, and open-source intelligence. Built for solo use.


## Modules

### Investigation
Search-first intelligence gathering. A user inputs a name, entity, event, or place and the app automatically collects and correlates intelligence from open sources. Results are visualised as an interactive entity-relationship graph with a parallel timeline view. Cases are saved and enriched over time.

→ [Full spec](documentation/investigation.md)

### Urbex
A Google Earth-style map module for discovering, documenting, and investigating urban exploration locations. The map is the primary interface — users roam freely, right-click to set checkpoint statuses, draw polygons around sites, and trigger tools directly from the map. Supports full Google Earth feature parity, a rich thematic layer catalogue from open data sources, and a standardised geospatial pipeline. Locations can be escalated into Phantom reports or full OSINT investigations.

→ [Full spec](documentation/urbex.md)

### Phantom ✦
The flagship urbex intelligence feature. The user selects an area on the map — a building, factory, or site — and Phantom automatically builds a full historical intelligence report: satellite imagery changes over time, LiDAR terrain analysis, SAR radar, AI object detection, historical identity search (old names, cadastral records), and a news coverage pipeline that discovers which outlets cover the area and cross-references their archives against the satellite timeline.

→ [Full spec](documentation/phantom.md)

### Scout & Recon
Automated area scanning system. The user draws a large polygon (city or region scale) and the system divides it into a grid of tiles, processing each in parallel to score abandonment probability. **Scout** runs a fast lightweight sweep (satellite change detection + YOLO). **Recon** runs the full Phantom pipeline per tile. The natural workflow: Scout a wide area first, then Recon the high-probability tiles. Results displayed as a colour-coded map grid and a ranked list panel.

→ [Full spec](documentation/scout-recon.md)

---

## Cross-Cutting Features

### AI Assistant
A RAG-powered chat interface available throughout the app. Ask natural language questions about any case, entity, or location. Backed by a local LLM (Ollama) with embeddings stored in Qdrant. Also handles entity extraction from text, translation, and media analysis.

→ [Full spec](documentation/ai-assistant.md)

### OSINT Pipeline
The data collection backbone. Continuous source watchers (Telegram, news feeds, social media, APIs) stream into Kafka topics. Workers process, translate, and enrich the data before storing it across Neo4j, PostgreSQL, and Elasticsearch. Results surface in real time via WebSockets.

→ [Full spec](documentation/osint-pipeline.md)

### Alerts & Watches
Users can set watches on any entity, location, or keyword. When new intel matches a watch, an alert is triggered. Supports saved searches, notification history, and configurable alert rules. Also powers recurring scheduled Scout runs on saved polygons.

→ [Full spec](documentation/alerts.md)

### Dashboard
The home screen. Shows active cases, recent alerts, live OSINT feed, recent Urbex activity, and system status (VPN, workers, pipeline health). Entry point to both modules.

→ [Full spec](documentation/dashboard.md)

### Settings
Application configuration panel. Covers API key management (Shodan, Mapillary, etc.), VPN profile and kill switch, per-pipeline routing, source toggles, LLM model selection, notification preferences, and storage maintenance.

→ [Full spec](documentation/settings.md)

