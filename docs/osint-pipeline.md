# Feature: OSINT Pipeline

## Overview
The data collection backbone of the platform. Continuous source watchers stream intelligence from open sources into Kafka topics. Workers process, translate, and enrich the data before storing it across the databases. Results surface in the UI in real time via WebSockets.

---

## Architecture

```
External Sources
    ↓
Scrapy / Playwright+Camoufox (via Tor)
    ↓
Kafka (one topic per source type)
    ↓
Celery Workers
    ├── LibreTranslate (translation)
    ├── spaCy + GLiNER (entity extraction)
    ├── Whisper / YOLO / PaddleOCR (media)
    └── Polars (deduplication, bulk processing)
    ↓
Neo4j / PostgreSQL / Elasticsearch / Qdrant
    ↓
WebSockets → Frontend (real-time updates)
```

---

## Sources

| Source | Method | Data collected |
|---|---|---|
| Shodan / Censys | API | IP, domain, infrastructure, open ports |
| WHOIS / DNS | API | Domain registration, DNS records |
| Certificate Transparency | API | SSL certs, subdomains |
| Have I Been Pwned | API | Leaked credentials, breach data |
| Telegram | Telethon (Python) | Channel messages, media, members |
| Social media | Playwright + Camoufox | Profiles, posts, connections |
| LinkedIn | Playwright + Camoufox | Professional profiles, org structure |
| GitHub | API + Playwright | Leaked keys, user profiles, org repos |
| News / RSS feeds | Scrapy | Articles, dates, locations |
| Wayback Machine | API | Archived pages, historical snapshots |
| Pastebin / paste sites | Scrapy | Leaked data, credentials, dumps |
| Dark web / .onion sites | Playwright + Tor | Hidden forums, leaks, markets |
| Company registries | API | Companies House, EDGAR, national equivalents |
| GDELT | API | Geotagged news events, outlet discovery |
| Urbex forums / Reddit | Scrapy + Playwright | Location mentions, photos |

---

## Functionalities

### Source Watchers
- User configures watches on specific sources for a given entity or keyword
- Watcher runs continuously, polling or streaming from the source
- New data published to the relevant Kafka topic

### On-Demand Queries
- User can trigger a one-off OSINT query from the Investigation UI
- Results streamed back in real time via WebSockets
- Progress shown per source in the UI

### Processing Workers
- Celery workers consume from Kafka topics
- Translation applied first (LibreTranslate) for non-English content
- Entity extraction runs on all text (spaCy + GLiNER)
- Media analysis for images/video/audio (YOLO, Whisper, PaddleOCR)
- Deduplication via Polars before writing to DB

### Anonymisation
- All scraping routed through Tor proxy
- User-agent rotation and request throttling via Camoufox
- Prevents IP blocking and attribution

---

## Tech
- Scrapers: Scrapy, Playwright + Camoufox, Tor proxy (ruin repo)
- Queue: Kafka
- Workers: Celery + Python
- Processing: Polars, spaCy, GLiNER, LibreTranslate, YOLO, Whisper, PaddleOCR
- DB: Neo4j, PostgreSQL, Elasticsearch, Qdrant
- Real-time: WebSockets

---

## Related Features
- [Investigation](investigation.md) — consumes pipeline output
- [Alerts & Watches](alerts.md) — triggers pipeline jobs
- [AI Assistant](ai-assistant.md) — reasons over pipeline output
