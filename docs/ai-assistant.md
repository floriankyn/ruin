# Feature: AI Assistant

## Overview
A RAG-powered AI assistant available throughout the app. Users can ask natural language questions about any case, entity, or location. The assistant is grounded in the actual investigation data — it doesn't hallucinate; it reasons over what has been collected. Also handles entity extraction, translation, and media analysis across the platform.

---

## User Flow

1. User opens the AI assistant panel (available in Investigation and Urbex views)
2. User asks a question in natural language
3. Assistant retrieves relevant data from Qdrant (vector search) and answers with citations
4. User can ask follow-up questions, drill into specific entities, or request a summary

---

## Functionalities

### RAG Chat
- Natural language interface over all investigation and location data
- Example queries:
  - "Who are the key connections of this person?"
  - "Summarise all events linked to this organisation"
  - "What changed at this location between 2015 and 2020?"
  - "Which sources mention this entity most often?"
- Every answer cites the source data points it reasoned over
- Powered by Ollama (local LLM) + LlamaIndex + Qdrant

### Entity & Relationship Extraction
- Automatically extracts named entities (persons, organisations, locations, events) from any ingested text
- Detects relationships between extracted entities
- Proposes new nodes and edges to add to the Neo4j graph
- User reviews and confirms before committing

### Translation
- Translates any content in the app to the user's language
- Powered by LibreTranslate (self-hosted)
- Critical for non-English content: Russian, Ukrainian, Arabic, French, etc.
- Applied automatically during OSINT ingestion so all content is searchable in English

### Media Analysis
- **Images**: YOLO object detection + PaddleOCR text extraction
- **Video**: FFmpeg frame extraction → image analysis pipeline
- **Audio**: Whisper transcription
- Results attached to the relevant entity or location profile

---

## Tech
- LLM: Ollama (Llama 3 / Mistral, self-hosted)
- RAG orchestration: LlamaIndex
- Vector DB: Qdrant
- Entity extraction: spaCy + GLiNER
- Translation: LibreTranslate
- Image analysis: YOLO + PaddleOCR
- Video/audio: FFmpeg + Whisper
- Backend: Python (ruin repo)

---

## Related Features
- [Investigation](investigation.md) — primary context for the assistant
- [Phantom](phantom.md) — chat over a location intelligence report
- [Scout & Recon](scout-recon.md) — chat over tile results and scoring
- [OSINT Pipeline](osint-pipeline.md) — source of the data the assistant reasons over
- [Settings](settings.md) — LLM model configuration
