# Feature: Dashboard

## Overview
The home screen of the application. Gives the user an at-a-glance overview of everything active — open cases, recent alerts, live OSINT feed, system health, and quick access to both modules.

---

## Layout

```
┌─────────────────────────────────────────────────────┐
│  Quick Search                    System Status bar  │
├──────────────┬──────────────────────────────────────┤
│              │                                      │
│  Active      │   Live OSINT Feed                    │
│  Cases       │   (streaming results)                │
│              │                                      │
├──────────────┼──────────────────────────────────────┤
│              │                                      │
│  Recent      │   Recent Urbex Activity              │
│  Alerts      │   (new locations, Scout results)     │
│              │                                      │
└──────────────┴──────────────────────────────────────┘
```

---

## Functionalities

### Quick Search
- Central search bar — searches across all entities, cases, locations, and documents
- Autocomplete from existing Neo4j nodes and Elasticsearch index
- Hitting enter opens the Investigation module with that query pre-loaded

### Active Cases
- List of open investigation cases sorted by last activity
- Each card shows: case name, entity count, last update, active alert count
- Click to open the case in the Investigation module

### Recent Alerts
- Latest triggered alerts from all watches
- Shows: trigger source, entity/location, timestamp, confidence
- Click to navigate directly to the alert detail
- Dismiss or escalate inline

### Live OSINT Feed
- Real-time stream of new intelligence collected by active watchers
- Colour-coded by source type (Telegram, news, social, leak DB, etc.)
- Filterable by source, entity, confidence threshold
- Click any item to open its linked case or entity profile

### Recent Urbex Activity
- New locations discovered by auto-discovery scrapers
- Scout / Recon jobs in progress or recently completed
- New Phantom reports generated
- Click to open on the Urbex map

### System Status Bar
- VPN connection status (OpenVPN — connected / disconnected)
- Active Celery workers count
- Kafka consumer lag (pipeline health)
- Active Scout / Recon jobs running
- Last pipeline run timestamp
- Storage usage (MinIO)

---

## Tech
- Frontend: React, TanStack Query, WebSockets (live feed)
- Backend: TypeScript + Fastify (all services contribute status data)
- DB: PostgreSQL (case/alert state), Elasticsearch (feed), Redis (system metrics)

---

## Related Features
- [Investigation](investigation.md) — open cases
- [Urbex](urbex.md) — recent location activity
- [Alerts & Watches](alerts.md) — recent alerts
- [OSINT Pipeline](osint-pipeline.md) — live feed source
- [Settings](settings.md) — system configuration
