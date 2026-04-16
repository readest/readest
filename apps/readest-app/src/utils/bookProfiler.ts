export type ProfileMark =
  | 'initViewState-start'
  | 'loadBookContent-done'
  | 'documentLoader-done'
  | 'loadBookConfig-done'
  | 'loadBookNav-done'
  | 'openBook-start'
  | 'foliate-import-done'
  | 'view-open-done'
  | 'view-init-done'
  | 'stabilized';

export interface ProfileEntry {
  mark: string;
  indent: number; // 0 = top-level, 1 = sub-mark
  wallMs: number;
  elapsedMs: number;
  deltaMs: number;
}

export interface ProfileSession {
  bookName: string;
  startWall: number;
  entries: ProfileEntry[];
}

let sessionCounter = 0;

class BookProfiler {
  private sessions: Map<string, ProfileSession> = new Map();
  private completedSessions: ProfileSession[] = [];
  private activeBookName: string | null = null;
  private sessionId = 0;

  startSession(bookName: string): void {
    this.sessionId = ++sessionCounter;
    this.activeBookName = bookName;
    this.sessions.set(bookName, {
      bookName,
      startWall: performance.now(),
      entries: [],
    });
  }

  mark(checkpoint: ProfileMark): void {
    if (!this.activeBookName) return;
    const session = this.sessions.get(this.activeBookName);
    if (!session) return;

    const wallMs = performance.now();
    const elapsedMs = wallMs - session.startWall;
    const prev = session.entries[session.entries.length - 1];
    const deltaMs = prev ? wallMs - prev.wallMs : 0;

    session.entries.push({ mark: checkpoint, indent: 0, wallMs, elapsedMs, deltaMs });

    // Prefix with session ID so DevTools timeline doesn't accumulate duplicates
    performance.mark(`[book-open:${this.sessionId}] ${checkpoint}`);
  }

  /**
   * Harvests `performance.mark()` entries whose name starts with `prefix + ' '`
   * and appends them as indented sub-entries after the last top-level mark (the
   * parent). Call this immediately after `mark('documentLoader-done')` (or
   * whichever parent mark covers the instrumented block) so the sub-marks are
   * displayed as children of that mark in the tree.
   *
   * The time window searched is between the second-to-last top-level mark
   * (lower bound, exclusive) and the last top-level mark (upper bound,
   * inclusive), which corresponds exactly to the delta shown on the parent row.
   */
  injectSubMarks(prefix: string): void {
    if (!this.activeBookName) return;
    const session = this.sessions.get(this.activeBookName);
    if (!session) return;

    const topLevel = session.entries.filter((e) => e.indent === 0);
    const parent = topLevel[topLevel.length - 1];
    if (!parent) return;

    const prev = topLevel[topLevel.length - 2];
    const lowerBound = prev ? prev.wallMs : session.startWall;
    const upperBound = parent.wallMs;

    const subMarks = performance
      .getEntriesByType('mark')
      .filter(
        (e) =>
          e.name.startsWith(prefix + ' ') && e.startTime > lowerBound && e.startTime <= upperBound,
      )
      .sort((a, b) => a.startTime - b.startTime);

    let prevWall = lowerBound;
    for (const entry of subMarks) {
      const label = entry.name.slice(prefix.length + 1);
      const wallMs = entry.startTime;
      const elapsedMs = wallMs - session.startWall;
      const deltaMs = wallMs - prevWall;
      session.entries.push({ mark: label, indent: 1, wallMs, elapsedMs, deltaMs });
      prevWall = wallMs;
    }
  }

  endSession(): ProfileSession | null {
    if (!this.activeBookName) return null;
    const session = this.sessions.get(this.activeBookName);
    if (!session) return null;

    this.completedSessions.push(session);
    this.sessions.delete(this.activeBookName);
    this.activeBookName = null;
    return session;
  }

  getSessions(): ProfileSession[] {
    return [...this.completedSessions];
  }

  formatSession(session: ProfileSession): string {
    const NUM_COL = 12;
    const MARK_COL = Math.max(
      26,
      ...session.entries.map((e) => {
        const label = e.indent > 0 ? `  ── ${e.mark}` : e.mark;
        return label.length + 2;
      }),
    );

    const title = `  Book: ${session.bookName}`;
    const totalMs = session.entries[session.entries.length - 1]?.elapsedMs ?? 0;

    const topBorder = `┌${'─'.repeat(MARK_COL + NUM_COL * 2 + 3)}┐`;
    const titleLine = `│ ${title.padEnd(MARK_COL + NUM_COL * 2 + 1)} │`;
    const divider = `├${'─'.repeat(MARK_COL)}┬${'─'.repeat(NUM_COL)}┬${'─'.repeat(NUM_COL + 1)}┤`;
    const header = `│ ${'Checkpoint'.padEnd(MARK_COL - 2)} │ ${'Elapsed'.padEnd(NUM_COL - 2)} │ ${'Delta'.padEnd(NUM_COL - 1)} │`;
    const rowDivider = `├${'─'.repeat(MARK_COL)}┼${'─'.repeat(NUM_COL)}┼${'─'.repeat(NUM_COL + 1)}┤`;
    const bottomBorder = `└${'─'.repeat(MARK_COL)}┴${'─'.repeat(NUM_COL)}┴${'─'.repeat(NUM_COL + 1)}┘`;

    const rows = session.entries.map((entry, i) => {
      const elapsed = `${entry.elapsedMs.toFixed(1)} ms`.padStart(NUM_COL - 2);

      if (entry.indent > 0) {
        const nextEntry = session.entries[i + 1];
        const isLast = !nextEntry || nextEntry.indent === 0;
        const treeChar = isLast ? '└─' : '├─';
        const label = `  ${treeChar} ${entry.mark}`;
        const delta = `+${entry.deltaMs.toFixed(1)} ms`.padStart(NUM_COL - 1);
        return `│ ${label.padEnd(MARK_COL - 2)} │ ${elapsed} │ ${delta} │`;
      }

      const delta =
        i === 0
          ? '—'.padStart(NUM_COL - 1)
          : `+${entry.deltaMs.toFixed(1)} ms`.padStart(NUM_COL - 1);
      return `│ ${entry.mark.padEnd(MARK_COL - 2)} │ ${elapsed} │ ${delta} │`;
    });

    const totalRow = `│ ${'TOTAL'.padEnd(MARK_COL - 2)} │ ${`${totalMs.toFixed(1)} ms`.padStart(NUM_COL - 2)} │ ${''.padEnd(NUM_COL - 1)} │`;

    return [
      topBorder,
      titleLine,
      divider,
      header,
      rowDivider,
      ...rows,
      rowDivider,
      totalRow,
      bottomBorder,
    ].join('\n');
  }

  formatReport(): string {
    if (this.completedSessions.length === 0) return '(no profiler sessions recorded)';
    return this.completedSessions.map((s) => this.formatSession(s)).join('\n\n');
  }

  clear(): void {
    this.sessions.clear();
    this.completedSessions = [];
    this.activeBookName = null;
  }
}

export const bookProfiler = new BookProfiler();

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>)['__bookProfiler'] = bookProfiler;
}
