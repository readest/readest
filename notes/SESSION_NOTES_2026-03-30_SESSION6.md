# Session 6: LibGen Integration - March 30, 2026

## Session Overview
**Goal:** Implement working LibGen search integration with proper result parsing and filtering

**Starting Point:** Shadow library infrastructure complete, but LibGen provider was a stub
**Ending Point:** LibGen search works but has parsing issues that need to be fixed

---

## What We Built

### 1. LibGen Provider Implementation (`providers/libgen.ts`)

**Implemented Features:**
- ✅ Search by title, author, ISBN, DOI
- ✅ HTML parsing of libgen.li search results
- ✅ MD5 extraction from mirror links
- ✅ Metadata extraction (author, publisher, year, language, pages, size, extension)
- ✅ Cover URL generation
- ✅ Mirror failover support
- ✅ Client-side filtering:
  - Comics excluded (CBZ/CBR/CB7)
  - English-only results
  - Broken titles filtered

**File Structure:**
```typescript
class LibGenProvider extends ShadowLibraryProviderBase {
  async search(query): Promise<ShadowLibrarySearchResult[]>
  async getDownloadUrl(resultId): Promise<string>
  private parseSearchResults(html, baseUrl): ShadowLibrarySearchResult[]
  private parseBookRow(cells, baseUrl): LibGenBook | null
}
```

### 2. Mirror Configuration (`types/shadow-library.ts`)

**Working Mirrors:**
```typescript
mirrors: [
  { url: 'http://libgen.li', priority: 0, isActive: true }
  // Other mirrors (libgen.is, libgen.rs, etc.) return 500 errors
]
```

**Note:** Only `libgen.li` works reliably. Other mirrors return 500 errors or are blocked.

### 3. Search URL Structure

**Current Implementation:**
```
http://libgen.li/index.php?req={query}&column=title&phrase=0&view=simple&res=50&open=0
```

**Parameters:**
- `req` - Search query
- `column` - Search field (title, author, series, etc.)
- `phrase` - Exact match (0=no, 1=yes)
- `view` - View mode (simple)
- `res` - Results per page (50)
- `open` - Show covers (0=no)

---

## Current Issues

### 1. Title Parsing - BROKEN ❌

**Problem:** Titles are showing incorrectly:
- Shows: `Frankenstein_Lost Souls_A Novel - Dean Koontz"`
- Should show: `Frankenstein: Lost Souls: A Novel`

**Root Cause:** The `view=simple` HTML structure is complex and varies between result types. Current parsing logic extracts from wrong location.

**libgen.li HTML Structure (from copied element):**
```html
<td>
  <b>Series <a><i></i></a></b><br>
  <a>TITLE HERE</a><br>
  <a>ISBN</a>
  <nobr><span><a>b</a></span></nobr>
</td>
```

**Current Approach:** Split by `<br>` and extract from segment[1]
**Issue:** Not consistently getting the right segment

### 2. Authors Field - SCRAMBLED ❌

**Problem:** Authors showing title text instead of actual authors
- Shows: `(Fictitious character) Frankenstein's Monster,...`
- Should show: `Koontz, Dean Ray`

**Root Cause:** Cell mapping may be wrong, or authors cell has different structure than expected

### 3. Cover Images - NOT LOADING ❌

**Problem:** No cover images displayed
**Generated URL:** `http://libgen.li/covers/{md5[0:2]}/{md5}.1.jpg`
**Issue:** URLs may be wrong format, or covers don't exist for all books

### 4. Limited Results (~13 vs 2000+) ❌

**Problem:** Only showing ~13 results when libgen.li shows 2000+

**Root Causes:**
1. Only searching `/index.php` (scientific/technical books)
2. NOT searching `/foreignfiction/index.php` (fiction books)
3. Aggressive filtering (English-only, no comics)
4. Only getting first page (res=50, but filtering reduces to ~13)

**libgen.li Default Search:** Searches BOTH sections + shows 25-100 results per page

---

## What Works ✅

1. **Connection to libgen.li** - Successfully fetches search results
2. **Table parsing** - Finds the results table correctly
3. **Row iteration** - Processes all rows in the table
4. **MD5 extraction** - Successfully extracts MD5 from mirror links
5. **English filtering** - Only shows English results
6. **Comic filtering** - Excludes CBZ/CBR files
7. **Results display** - Cards populate in UI (just with wrong data)
8. **Download button** - Present on each card
9. **Mirror failover** - System ready for when other mirrors work

---

## Next Session Plan: LibGen Filter System

### Goal
Create a functional duplicate of libgen.li's filter and organization system EXCLUSIVELY for LibGen search results.

### Reference: libgen.li Filter Structure

**Search Options (from screenshot):**
```
Search in fields: ☑ Title ☑ Author(s) ☑ Series ☑ Year ☑ Publisher ☑ ISBN
Search in objects: ☑ Files ☑ Editions ☑ Series ☑ Authors ☑ Publishers ☑ Works
Search in topics: ☑ Libgen ☐ Comics ☑ Fiction ☐ Scientific Articles ☐ Magazines ☐ Fiction RUS ☑ Standards

Results per page:  25 ○ 50 ○ 100
Show Covers: ⦿ Show ○ Hide
Show chapters: ⦿ Show ○ Hide
Google mode: ⦿ Yes ○ No

Files [2500] Showing the first 2000 | Editions [3166] | Series [20] | Authors [0] | Publishers [1] | Works [1718] | JSON
```

### Implementation Plan

#### Phase 1: Fix Current Parsing Issues
1. **Get proper HTML structure** - Copy `<tr>` element from libgen.li
2. **Fix title extraction** - Parse from correct cell/segment
3. **Fix author extraction** - Map to correct cell
4. **Fix cover URLs** - Verify correct URL format
5. **Test with known results** - Verify against libgen.li display

#### Phase 2: Search Both Sections
```typescript
// Search both scientific and fiction sections
const scientificResults = await searchSection('/index.php', query);
const fictionResults = await searchSection('/foreignfiction/index.php', query);

// Merge results, remove duplicates by MD5
const allResults = mergeAndDeduplicate(scientificResults, fictionResults);

// Sort by relevance (title match quality)
return sortByRelevance(allResults);
```

#### Phase 3: Implement Filter UI

**UI Components:**
```tsx
<LibGenFilters>
  <SearchFields>
    <Checkbox label="Title" checked />
    <Checkbox label="Author(s)" checked />
    <Checkbox label="Series" checked />
    <Checkbox label="Year" checked />
    <Checkbox label="Publisher" checked />
    <Checkbox label="ISBN" checked />
  </SearchFields>
  
  <SearchTopics>
    <Checkbox label="Libgen" checked />
    <Checkbox label="Comics" />
    <Checkbox label="Fiction" checked />
    <Checkbox label="Scientific Articles" />
    <Checkbox label="Magazines" />
    <Checkbox label="Fiction RUS" />
    <Checkbox label="Standards" checked />
  </SearchTopics>
  
  <ResultsPerPage>
    <Radio label="25" />
    <Radio label="50" />
    <Radio label="100" />
  </ResultsPerPage>
  
  <LanguageFilter>
    <Select>
      <option>All Languages</option>
      <option>English</option>
      <option>Russian</option>
      <option>...</option>
    </Select>
  </LanguageFilter>
  
  <ExtensionFilter>
    <Checkbox label="PDF" checked />
    <Checkbox label="EPUB" checked />
    <Checkbox label="FB2" checked />
    <Checkbox label="CBZ/CBR" />
    <Checkbox label="DJVU" checked />
    <Checkbox label="MOBI" checked />
  </ExtensionFilter>
</LibGenFilters>
```

#### Phase 4: Result Grouping/Organization

**libgen.li Tabs:**
```
Files [2500] | Editions [3166] | Series [20] | Authors [0] | Publishers [1] | Works [1718] | JSON
```

**Implementation:**
```typescript
interface LibGenResults {
  files: ShadowLibrarySearchResult[];      // Individual files
  editions: ShadowLibrarySearchResult[];   // Grouped by work
  series: SeriesGroup[];                   // Grouped by series
  authors: AuthorGroup[];                  // Grouped by author
  publishers: PublisherGroup[];            // Grouped by publisher
  works: WorkGroup[];                      // Grouped by work
}

function groupResults(results: ShadowLibrarySearchResult[]): LibGenResults {
  // Group by MD5 (files)
  // Group by title+author (editions)
  // Group by series name
  // Group by author name
  // Group by publisher
  // Group by work (title variations)
}
```

#### Phase 5: Advanced Features

**Column Sorting:**
```typescript
type SortField = 'title' | 'author' | 'year' | 'publisher' | 'size' | 'extension';
type SortOrder = 'asc' | 'desc';

function sortResults(results, field, order) {
  // Sort by any column (like libgen.li table headers)
}
```

**Pagination:**
```typescript
interface Pagination {
  page: number;        // Current page (1-25)
  perPage: number;     // 25, 50, or 100
  total: number;       // Total results
}
```

**View Modes:**
```typescript
type ViewMode = 'simple' | 'detailed' | 'covers';

// Simple: Title, Author, Year, Size
// Detailed: All metadata + description
// Covers: Grid view with cover images
```

---

## Files Modified This Session

### Created:
- `apps/readest-app/src/services/shadow-library/providers/libgen.ts` (497 lines)
- `apps/readest-app/src/services/shadow-library/providers/scihub.ts` (164 lines)
- `apps/readest-app/src/services/shadow-library/providers/zlibrary.ts` (187 lines)
- `apps/readest-app/src/services/shadow-library/providers/unpaywall.ts` (209 lines)
- `apps/readest-app/src/services/shadow-library/providers/index.ts` (9 lines)
- `apps/readest-app/src/services/shadow-library/mirrorManager.ts` (320 lines)
- `apps/readest-app/src/services/shadow-library/providerBase.ts` (427 lines)
- `apps/readest-app/src/services/shadow-library/shadowLibraryService.ts` (217 lines)
- `apps/readest-app/src/services/sources/rateLimiter.ts` (326 lines)
- `apps/readest-app/src/services/sources/sourcesService.ts` (387 lines)
- `apps/readest-app/src/services/sources/downloadQueue.ts` (280 lines)
- `apps/readest-app/src/services/sources/index.ts` (6 lines)
- `apps/readest-app/src/types/sources.ts` (275 lines)
- `apps/readest-app/src/types/shadow-library.ts` (385 lines)
- `apps/readest-app/src/components/sources/SourceIcons.tsx` (124 lines)
- `apps/readest-app/src/components/sources/SourceFilter.tsx` (191 lines)
- `apps/readest-app/src/components/sources/SearchResultCard.tsx` (185 lines)
- `apps/readest-app/src/components/sources/SearchProgressPanel.tsx` (129 lines)
- `apps/readest-app/src/components/sources/RateLimitStatus.tsx` (65 lines)
- `apps/readest-app/src/components/sources/DownloadQueuePanel.tsx` (253 lines)
- `apps/readest-app/src/app/sources/page.tsx` (389 lines)
- `apps/readest-app/src/app/api/shadow-library/proxy/route.ts` (223 lines)

### Modified:
- `apps/readest-app/src/app/library/components/NavigationRail.tsx` - Added Sources tab
- `apps/readest-app/src/app/library/components/ImportMenu.tsx` - Added Shadow Libraries menu item
- `apps/readest-app/src/app/library/components/LibraryHeader.tsx` - Added onOpenShadowLibrary prop
- `apps/readest-app/src/app/library/page.tsx` - Integrated Sources page view
- `apps/readest-app/src/types/settings.ts` - Added shadowLibrary field
- `apps/readest-app/src/services/constants.ts` - Added DEFAULT_SHADOW_LIBRARY_SETTINGS
- `apps/readest-app/src/services/settingsService.ts` - Preserve shadow library settings in migrations

---

## Key Learnings

### What Worked Well:
1. **Mirror management system** - Automatically fails over between mirrors
2. **Rate limiting** - Prevents server overload (1 req/sec for shadow libraries)
3. **Proxy system** - Handles CORS for web platform
4. **Type system** - Unified types for OPDS + Shadow libraries
5. **Download queue** - Queue-based download management

### What Didn't Work:
1. **HTML parsing assumptions** - libgen.li structure varies more than expected
2. **Multiple mirrors** - Only libgen.li works reliably
3. **Advanced filter syntax** - `lang:eng` doesn't work in URL parameters
4. **View modes** - `view=simple` still has complex HTML structure

### Technical Challenges:
1. **libgen.li HTML structure** - Not consistent across result types
2. **Title extraction** - Multiple `<a>` tags with different purposes
3. **Cover URLs** - Format uncertain, may not exist for all books
4. **Section searching** - Need to search both `/index.php` and `/foreignfiction/index.php`

---

## Reference: libgen.li URL Structure

### Search Endpoints:
- `/index.php` - Scientific/technical books
- `/foreignfiction/index.php` - Fiction books
- `/comics/index.php` - Comics
- `/scimag/index.php` - Scientific articles
- `/magazines/index.php` - Magazines

### Search Parameters:
```
req={query}           - Search query
column={field}        - title, author, series, year, publisher, isbn
phrase={0|1}          - Exact match
view={simple}         - View mode
res={25|50|100}       - Results per page
open={0|1}            - Show covers
```

### Advanced Filters (Google Mode):
```
"query" lang:eng ext:pdf year:2020
```
- `lang:{code}` - Language (ISO 639)
- `ext:{ext}` - File extension
- `year:{year}` - Publication year
- `fsize>{mb}` - File size in MB
- `fsize<{mb}` - Maximum file size

---

## Session Stats
- **Duration:** ~8 hours
- **Files Created:** 22 new files
- **Files Modified:** 7 files
- **Lines Added:** ~5000+
- **Features Completed:** 7/10 (parsing issues remain)

---

## Next Session Checklist

### Pre-Session Prep:
1. [ ] Copy HTML `<tr>` element from libgen.li search results
2. [ ] Test cover URL format manually
3. [ ] Document all cell structures in simple view

### Session Goals:
1. **Fix Title Parsing** (1 hour)
   - Use copied HTML to fix extraction
   - Test with multiple result types
   
2. **Fix Author/Metadata Parsing** (1 hour)
   - Map cells correctly
   - Verify all fields display properly
   
3. **Search Both Sections** (1 hour)
   - Implement dual-section search
   - Merge and deduplicate results
   
4. **Implement Filter UI** (3 hours)
   - Search fields checkboxes
   - Topic filters
   - Language filter
   - Extension filter
   - Results per page
   
5. **Result Grouping** (2 hours)
   - Files/Editions/Series/Authors/Publishers/Works tabs
   - Grouping logic
   
6. **Polish** (1 hour)
   - Cover images
   - Sorting
   - Pagination

### Success Criteria:
- [ ] Titles display correctly
- [ ] Authors display correctly
- [ ] All metadata fields correct
- [ ] Cover images load
- [ ] 100+ results (from both sections)
- [ ] Filter UI matches libgen.li
- [ ] Result grouping works
- [ ] Sorting works
- [ ] Pagination works

---

*Session completed by: Kristoph*
*Date: March 30, 2026*
*Next session: LibGen filter system implementation*
