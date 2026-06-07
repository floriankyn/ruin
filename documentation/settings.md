# Feature: Settings

## Overview
The configuration panel for the application. Covers API key management, VPN setup, source toggles, notification preferences, and system maintenance. Accessible from the top navigation bar.

---

## Sections

### Network & Privacy
- **VPN profile** — upload and select OpenVPN config files (.ovpn)
- **Kill switch** — toggle on/off. When on, all outbound traffic blocked if VPN drops
- **Per-pipeline routing** — configure each pipeline to route via VPN, Tor, or direct:
  - Scraping workers: VPN / Tor / direct
  - Satellite fetches: VPN / direct
  - News / GDELT queries: VPN / direct
- **Tor proxy** — enable/disable, configure SOCKS5 port
- **Connection test** — verify VPN and Tor are working, show current exit IP

### API Keys
Securely stored in HashiCorp Vault, never exposed in the UI after saving.

| Service | Used for |
|---|---|
| Shodan | Infrastructure OSINT |
| Censys | Infrastructure OSINT |
| Have I Been Pwned | Leak database queries |
| Mapillary | Street view imagery (primary) |
| Sentinel Hub | Satellite imagery (optional, higher resolution) |
| Planet API | Satellite imagery (optional, commercial) |
| GDELT | News event queries (free, no key needed) |

### Source Configuration
- Enable / disable individual OSINT sources per pipeline
- Configure polling frequency per source (real-time / hourly / daily)
- Add custom RSS feeds or news sources
- Configure Telegram: add bot token + channel list
- Configure social media scraping targets

### LLM Configuration
- Select active Ollama model (Llama 3, Mistral, etc.)
- Pull new models from Ollama registry
- Configure context window size and temperature
- Toggle AI enrichment on/off per pipeline

### Notifications
- In-app notifications: enable/disable per alert type
- Notification sound toggle
- Alert confidence threshold — only notify above X%
- Digest mode — batch alerts into a daily summary instead of real-time

### Storage & Maintenance
- View storage usage breakdown (MinIO: satellite tiles, photos, reports)
- Clear cached tile data by layer or date range
- Export all data (full backup)
- Delete a case or location with all associated data
- View database sizes (Neo4j, PostgreSQL, Elasticsearch, Qdrant)

### System Information
- Docker service health overview
- Kafka consumer lag per topic
- Active Celery workers
- Last pipeline run per source
- Application version and update check

---

## Tech
- Frontend: Next.js, React Hook Form, Zod (settings validation)
- Backend: TypeScript + Fastify
- Secrets: HashiCorp Vault (API keys never stored in plaintext)
- DB: PostgreSQL (user preferences, source config)

---

## Related Features
- [Dashboard](dashboard.md) — system status overview
- [OSINT Pipeline](osint-pipeline.md) — source configuration applied here
- [AI Assistant](ai-assistant.md) — LLM model configuration
- [Infrastructure](../wiki/Infrastructure.md) — VPN and Vault details
