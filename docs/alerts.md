# Feature: Alerts & Watches

## Overview
Users can set watches on any entity, location, or keyword. When new intelligence matching a watch is collected by the pipeline, an alert is triggered and surfaced in the UI. Supports saved searches, alert history, and configurable rules.

---

## User Flow

1. User opens an entity, location, or search result
2. User sets a watch — defines what to monitor and under what conditions
3. OSINT pipeline runs continuously against configured watches
4. When a match is found, an alert appears in the notification centre
5. User reviews the alert and navigates to the relevant case or location

---

## Functionalities

### Watches
- Watch any entity (person, org, event, location)
- Watch a keyword or phrase across all sources
- Watch a geographic area (feeds into Phantom for location changes)
- Configure watch frequency: real-time, hourly, daily

### Alert Rules
- Trigger on: new mention, new relationship detected, new media, structural change (geo), breach detected
- Threshold rules: "alert only if confidence score > 0.8"
- Source filter: "only alert from news sources, ignore social media"

### Notification Centre
- In-app notification panel — list of all active alerts sorted by date
- Each alert shows: what triggered it, source, date, confidence, link to data
- Mark as read, dismiss, or escalate to a case

### Saved Searches
- Save any search query for reuse
- Run a saved search on demand or on a schedule
- Results diff — shows only what's new since last run

### Alert History
- Full log of all past alerts
- Filterable by entity, source, date, type
- Useful for tracking how an entity's coverage evolves over time

---

## Tech
- Backend: TypeScript + Fastify (Search & Notify Service)
- Queue: Kafka (alert events published as topics)
- DB: PostgreSQL (watch configs, alert history), Elasticsearch (search matching)
- Real-time: WebSockets (push alerts to UI instantly)

---

## Related Features
- [Investigation](investigation.md) — escalate alerts into cases
- [OSINT Pipeline](osint-pipeline.md) — generates the data alerts match against
- [Urbex](urbex.md) — geographic watches for location changes
- [Scout & Recon](scout-recon.md) — schedule recurring Scout runs on a saved polygon
- [Dashboard](dashboard.md) — recent alerts shown on home screen
