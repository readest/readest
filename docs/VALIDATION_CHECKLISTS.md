# Citadel Validation Checklists

Use these checklists in Verify Mode before reporting any task complete.
Run the automated commands. For manual items, mark each as verified or explicitly as not verified.

---

## 1. General Validation (All Tasks)

**Automated:**

```powershell
# Working tree state
git status --short

# Lint and type check
pnpm.cmd --filter @readest/readest-app lint

# Changed file summary
git diff --stat

# Relevant unit tests (adjust glob to your area)
pnpm.cmd --filter @readest/readest-app exec vitest run src/__tests__/<area>/
```

**Manual:**

- [ ] No unexpected files in `git status --short`
- [ ] No unrelated formatting changes
- [ ] No generated Tauri permission noise committed unless intentional

---

## 2. Audiobook Sync Validation

**Automated:**

```powershell
pnpm.cmd --filter @readest/readest-app lint

pnpm.cmd --filter @readest/readest-app exec vitest run src/__tests__/utils/audiobookTranscript.test.ts
pnpm.cmd --filter @readest/readest-app exec vitest run src/__tests__/utils/transcriptSync.test.ts
pnpm.cmd --filter @readest/readest-app exec vitest run src/__tests__/utils/audiobookSync.test.ts
```

**Manual proof required (run the Tauri app with an audiobook-attached EPUB):**

- [ ] Press Play produces a playback diagnostic log (`[SyncPlayback] useAudiobookPlayer MOUNTED`)
- [ ] Timeupdate logs appear (`[SyncPlayback] timeupdate`)
- [ ] Active sync entry is found (`[SyncPlayback] tick ... — no entry found` does NOT appear)
- [ ] View is resolved (`[AudiobookSync] Could not resolve view` does NOT appear)
- [ ] Marker application result is logged
- [ ] Visible highlight appears on the current spoken word
- [ ] Page turns near spoken section transitions
- [ ] Seek updates highlight to the new position
- [ ] Close and reopen preserves sync state

**If agent cannot visually verify highlight:**
Report **"not verified"** and include the first failing log line. Do not claim sync works.

---

## 3. Visual / UI Validation

**Automated:**

```powershell
pnpm.cmd --filter @readest/readest-app lint
```

**Manual proof required (run the Tauri app):**

- [ ] Homepage featured book uses correct asset/presentation (not broken image or fallback)
- [ ] Featured book frame is visible and not clipped at any viewport size
- [ ] Background texture is visible but subtle (does not overpower content)
- [ ] Reader page ornaments visible on chapter openings
- [ ] GOT sigil size, position, and color match design reference
- [ ] Drop cap wraps correctly (first letter styled, rest flows around)
- [ ] Non-themed fallback still works (no broken ornament injection on plain books)
- [ ] Dark mode: textures and ornaments adjust or remain readable
- [ ] Library shelf book cards render with correct art and no layout shifts

---

## 4. Reader Core Validation

**Automated:**

```powershell
pnpm.cmd --filter @readest/readest-app lint
```

**Manual proof required (run the Tauri app):**

- [ ] Reader opens from library (book loads without white screen or error)
- [ ] Page navigation works (next/prev, keyboard arrows, swipe)
- [ ] Resize / maximize / minimize does not lose reading position
- [ ] CFI / location recovery works (close and reopen same book lands on same page)
- [ ] Page turns do not break audio/highlight if sync exists
- [ ] Scroll mode and paginated mode both work
- [ ] Sidebar opens/closes without breaking reader layout

---

## 5. Infra Validation

**Automated:**

```powershell
pnpm.cmd --filter @readest/readest-app lint
pnpm.cmd --filter @readest/readest-app exec vitest run
```

**Manual:**

- [ ] Lint passes with zero issues
- [ ] Relevant tests pass (acknowledge any pre-existing failures)
- [ ] No unrelated files changed (`git diff --stat` only shows expected paths)
- [ ] No generated Tauri permission noise committed unless intentional
- [ ] No submodule dirty markers committed
- [ ] `git status --short` is clean except for intended changes
