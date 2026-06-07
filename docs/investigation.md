# Feature: Investigation

## Overview
The core module of the platform. A user inputs a name, entity, event, or place and the app automatically collects, correlates, and visualises intelligence from open sources. Results are built in real time into an interactive entity-relationship graph.

---

## User Flow

1. User enters a search query (person name, organisation, event, place)
2. App dispatches OSINT workers across all configured sources
3. Results stream back in real time via WebSockets and appear on the graph
4. User explores the graph, opens entity profiles, and saves the case
5. AI assistant is available at any point to answer questions about the case

---

## Functionalities

### Search & Dispatch
- Global search bar accepting any entity type: person, organisation, event, place
- On submit, dispatches parallel OSINT worker jobs via Kafka
- Real-time progress indicator showing which sources are being queried

### Entity Graph View
- Interactive node-link graph powered by Sigma.js (WebGL)
- Nodes: Person, Organisation, Event, Location, Document
- Edges: MEMBER_OF, INVOLVED_IN, LOCATED_AT, LINKED_TO, MENTIONED_IN
- Controls: zoom, pan, filter by entity type, highlight connections, expand node
- Clicking a node opens the entity profile panel

### Entity Profiles
- Dedicated profile for each entity with all gathered intel
- Fields vary by entity type:
  - **Person**: name, aliases, social profiles, known associates, locations, timeline
  - **Organisation**: name, members, activity, associated events, locations
  - **Event**: date, location, actors involved, sources, media
  - **Place**: coordinates, names, linked entities, media, Phantom report (if urbex)
- All data points linked to their source

### Timeline View
- D3.js horizontal timeline of all events related to the current case
- Filterable by entity, date range, source
- Click an event to highlight it on the graph and open its source

### Case Management
- Save any investigation as a named case
- Add rich text notes via Tiptap editor
- Tag cases and entities
- Case history — all changes and additions tracked

### Source Tracking
- Every piece of intel linked to its origin (Shodan, WHOIS, Telegram, news article, etc.)
- Source credibility indicator
- Direct link to original source where available

### Graph Intelligence (Neo4j GDS)
Powered by the Neo4j Graph Data Science library — surfaces structural insights directly in the UI:
- **Shortest path** — find the shortest connection chain between any two entities ("how is person A connected to organisation B?")
- **Community detection** — automatically clusters the graph into groups of tightly connected entities
- **Centrality** — highlights the most connected / influential nodes in the case graph
- **Link prediction** — suggests likely relationships that haven't been confirmed yet

### Entity Deduplication
The same entity may be discovered via multiple sources (Shodan finds a domain, Telegram mentions a name, a news article references the same person). Deduplication pipeline:
- Fuzzy name matching via Polars + string similarity
- Cross-source identifier matching (same email, IP, username across sources)
- AI-assisted merge suggestion — user reviews and confirms before nodes are merged in Neo4j
- Merged nodes retain all source attributions

### Open Location in Urbex
If an investigated entity is a place (coordinates, address, or known physical location), a **"Open in Urbex"** button appears on its profile — opens the location directly on the Urbex map, pinned and ready for Phantom or Scout.

### Export
- Export full case as PDF report
- Export entity data as CSV
- Export graph as image (PNG/SVG)

---

## OSINT Sources
- Shodan / Censys — IP, domain, infrastructure, open ports
- WHOIS / DNS / certificate transparency
- Have I Been Pwned — leaked credentials and breach data
- Telegram — channels, groups, messages, media
- Social media — profiles, posts, connections (Playwright)
- LinkedIn — profile scraping (Playwright)
- GitHub — leaked keys, user profiles, org repos (technical OSINT)
- News and RSS feeds
- Wayback Machine — archived pages and historical snapshots
- Pastebin / paste sites — common leak vector
- Dark web / .onion sites — via Tor proxy
- Company registries — Companies House (UK), EDGAR (US), national equivalents

---

## Tech
- Frontend: Next.js, Sigma.js, D3.js, TanStack Query, WebSockets
- Backend: TypeScript + Fastify (Investigation Service)
- Workers: Python + Celery (ruin repo)
- Graph DB: Neo4j + GDS
- Search: Elasticsearch
- Queue: Kafka

---

## Related Features
- [AI Assistant](ai-assistant.md) — chat over case data
- [OSINT Pipeline](osint-pipeline.md) — data collection backbone
- [Alerts & Watches](alerts.md) — monitor entities over time
- [Urbex](urbex.md) — open a place entity directly on the map
- [Dashboard](dashboard.md) — active cases overview
- [Scout & Recon](scout-recon.md) — escalate a location tile into an investigation
