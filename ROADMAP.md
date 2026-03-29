# Readest Academic - Development Roadmap

> A research-focused fork of Readest, optimized for academic articles and scholarly reading.

## Vision

Transform Readest from a general-purpose ebook reader into a powerful tool for academic research, with features tailored for researchers, students, and academics who work with scholarly articles and citations.

---

### 1.1 RSS Feed Reader (IN PROGRESS)
**Goal:** Stay updated with new publications in your field

#### Phase 1.1.1: RSS Infrastructure ✅ COMPLETE
- [x] **RSS Types & Interfaces** (`src/types/rss.ts`)
  - [x] RSSFeed, RSSItem, RSSEnclosure types
  - [x] RSSCatalog for managing feed sources
  - [x] Pre-configured academic feeds (arXiv, Nature, Science, PLOS, etc.)
  
- [x] **RSS Fetcher** (`src/services/rss/rssFetcher.ts`)
  - [x] Parse RSS/Atom feeds
  - [x] DOI extraction from content
  - [x] PDF URL detection
  - [x] Proxy support for web platform

- [x] **RSS Components** (`src/app/rss/`)
  - [x] `page.tsx` - Main RSS browser
  - [x] `FeedView.tsx` - Display feed items
  - [x] `ItemView.tsx` - Article details with DOI
  - [x] `RSSManager.tsx` - Add/manage feeds

- [x] **Integration with Library**
  - [x] RSS menu option in ImportMenu
  - [x] RSS state in settings
  - [x] RSS manager dialog in library page

#### Phase 1.1.2: RSS Sources
- [ ] **Pre-configured Academic Feeds**
  - [ ] arXiv categories (cs.AI, physics, q-bio, etc.)
  - [ ] Nature journals
  - [ ] Science journals
  - [ ] PLOS ONE
  - [ ] PubMed Central
  - [ ] bioRxiv / medRxiv

- [ ] **Custom Feed Support**
  - [ ] Add feed by URL
  - [ ] OPML import/export
  - [ ] Feed categories/tags

#### Phase 1.1.3: DOI Integration
- [ ] **DOI Extraction**
  - [ ] Parse DOI from RSS item description
  - [ ] Extract from metadata if available
  
- [ ] **DOI Resolution**
  - [ ] Crossref API integration for metadata
  - [ ] Unpaywall API for open access PDFs
  - [ ] Sci-Hub integration (optional, user-configured)

### 1.2 Shadow Library Integration
**Goal:** Enable importing academic papers from shadow libraries

- [ ] **Library Genesis (LibGen)**
  - [ ] Search API integration
  - [ ] Import by DOI/ISBN/Title
  - [ ] Batch import support
  - [ ] Download progress tracking

- [ ] **Sci-Hub**
  - [ ] DOI resolver integration
  - [ ] Automatic PDF fetch from DOI
  - [ ] Fallback mirror selection
  - [ ] Rate limiting & error handling

- [ ] **Anna's Archive**
  - [ ] Search API integration
  - [ ] Multi-source metadata aggregation
  - [ ] Import to library

- [ ] **Z-Library**
  - [ ] Authentication handling (if required)
  - [ ] Search and import
  - [ ] Download queue management

---

## Phase 2: Academic Features

### 2.1 DOI & Metadata Enhancement
**Goal:** Rich metadata display for academic papers

- [ ] **DOI Display**
  - [ ] Prominent DOI display in reader header
  - [ ] Clickable DOI links (doi.org resolver)
  - [ ] DOI badge/QR code for sharing

- [ ] **Metadata Enrichment**
  - [ ] Auto-fetch metadata from Crossref API
  - [ ] Display: authors, affiliations, journal, impact factor
  - [ ] Publication date, volume, issue, pages
  - [ ] Subject categories/keywords

- [ ] **Citation Information**
  - [ ] Pre-formatted citations (APA, MLA, Chicago, IEEE, BibTeX)
  - [ ] One-click copy citation
  - [ ] Export citations to reference managers (Zotero, Mendeley)

### 2.2 Citation Tools
**Goal:** Make citing and referencing seamless

- [ ] **In-Text Citation Detection**
  - [ ] Highlight citations in text (e.g., [1], (Smith et al., 2023))
  - [ ] Click citations to jump to references section
  - [ ] Hover preview of cited paper metadata

- [ ] **Reference List Enhancement**
  - [ ] Parse and extract references from PDF
  - [ ] Link references to DOIs where available
  - [ ] Open references in new tab/library

- [ ] **Citation Export**
  - [ ] Export all references as BibTeX/RIS
  - [ ] Integration with Zotero (via Better BibTeX)
  - [ ] Integration with Mendeley API

### 2.3 Research Workflow Tools
**Goal:** Support the academic reading workflow

- [ ] **Reading Notes**
  - [ ] Structured note templates (summary, methods, findings, limitations)
  - [ ] Link notes to specific passages
  - [ ] Export notes as Markdown/PDF

- [ ] **Literature Matrix**
  - [ ] Compare papers side-by-side
  - [ ] Extract key attributes (methods, sample size, results)
  - [ ] Export comparison table

- [ ] **Keyword Extraction**
  - [ ] Auto-extract keywords from paper
  - [ ] Generate tag cloud
  - [ ] Filter library by keywords

- [ ] **Reading Progress**
  - [ ] Track sections read (Abstract, Intro, Methods, etc.)
  - [ ] Reading time estimates
  - [ ] Session tracking

---

## Phase 3: Advanced Features

### 3.1 AI-Powered Tools
**Goal:** Leverage AI for research assistance

- [ ] **Paper Summarization**
  - [ ] TL;DR generation
  - [ ] Section-by-section summaries
  - [ ] Key findings extraction

- [ ] **Concept Explanation**
  - [ ] Define technical terms in context
  - [ ] Link to Wikipedia/domain glossaries

- [ ] **Related Papers**
  - [ ] Semantic similarity search
  - [ ] "Papers citing this" integration
  - [ ] Connected Papers / Litmaps integration

### 3.2 Collaboration & Sync
**Goal:** Enable research collaboration

- [ ] **Shared Libraries**
  - [ ] Share paper collections with collaborators
  - [ ] Shared annotations and notes

- [ ] **Cloud Sync**
  - [ ] Sync library, annotations, reading progress
  - [ ] Multi-device support

### 3.3 Advanced Search
**Goal:** Powerful search for academic content

- [ ] **Full-Text Search**
  - [ ] Search across all papers in library
  - [ ] Filter by metadata (author, journal, year)
  - [ ] Boolean operators

- [ ] **External Search**
  - [ ] Search Google Scholar, Semantic Scholar, PubMed
  - [ ] Import results directly to library

---

## Technical Considerations

### Architecture
- Keep changes modular and non-destructive to upstream
- Use feature flags for experimental features
- Maintain compatibility with regular ebook formats (EPUB, etc.)

### APIs to Integrate
- **Crossref API** - DOI resolution, metadata
- **OpenAlex** - Academic metadata, citations
- **Semantic Scholar API** - Paper recommendations
- **arXiv API** - Preprint search
- **PubMed API** - Biomedical literature
- **Unpaywall API** - Open access PDF discovery

### Privacy & Security
- Respect rate limits on all APIs
- Cache metadata locally to reduce API calls
- Secure storage for any API keys
- Clear user data controls

---

## Priorities (Personal Use)

### High Priority
1. [ ] DOI display and metadata enrichment
2. [ ] Citation tools (copy/export)
3. [ ] RSS feeds for journal tracking
4. [ ] LibGen/Sci-Hub import

### Medium Priority
1. [ ] Reference list parsing
2. [ ] Reading notes with templates
3. [ ] arXiv integration
4. [ ] Citation detection in text

### Low Priority
1. [ ] AI summarization
2. [ ] Collaboration features
3. [ ] Literature matrix

---

## Notes

- This roadmap is for a **personal fork** - features may be added based on individual needs
- If there's community interest, selected features could be upstreamed or released publicly
- All modifications remain under AGPL-3.0 license

---

*Last updated: 2026-03-29*
