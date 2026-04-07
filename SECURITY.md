# Security Policy

## Threat Model

### Overview

Readest is a cross-platform e-reader (macOS, Windows, Linux, Android, iOS, Web) built on Next.js and Tauri. It processes user-supplied ebook files, syncs data to the cloud, integrates with external services (OPDS catalogs, KOReader, DeepL, Yandex), and handles user authentication.

### Assets

| Asset                          | Description                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| Ebook files                    | User-uploaded EPUB, MOBI, PDF, and other formats stored locally and in cloud storage |
| Reading progress & annotations | Highlights, bookmarks, and notes synced across devices                               |
| User credentials               | Authentication tokens and session data for cloud sync                                |
| User preferences & settings    | Reading preferences, custom fonts, theme configurations                              |
| External API keys              | Translation service credentials (DeepL, Yandex) configured by users                  |

### Threat Actors

| Actor                   | Motivation                                                 |
| ----------------------- | ---------------------------------------------------------- |
| Malicious ebook author  | Craft a malformed file to exploit the parser or renderer   |
| Network attacker (MitM) | Intercept sync traffic to steal credentials or inject data |
| Malicious OPDS server   | Serve crafted catalog responses to exploit the client      |
| Compromised dependency  | Supply chain attack via npm or Cargo ecosystem             |
| Unauthorized user       | Access another user's synced library or annotations        |

### Attack Surfaces & Mitigations

#### 1. Ebook File Parsing

- **Risk:** Malformed EPUB/MOBI/PDF files could trigger parser bugs, path traversal, or script injection via embedded HTML/JS.
- **Mitigations:** Ebook content is rendered in a sandboxed iframe. External script execution is blocked. File parsing is isolated from the main process.

#### 2. Cloud Sync & Authentication

- **Risk:** Credential theft, session hijacking, or unauthorized access to another user's library data.
- **Mitigations:** All sync traffic uses HTTPS/TLS. Authentication tokens are stored securely (OS keychain/secure storage). Server-side authorization ensures users can only access their own data.

#### 3. OPDS / External Catalog Integration

- **Risk:** A malicious OPDS server could serve crafted XML to exploit the parser, or redirect downloads to malicious files.
- **Mitigations:** OPDS responses are parsed defensively. Users explicitly add catalog sources. Downloaded files are treated as untrusted user content.

#### 4. Rendered HTML/JS in Ebook Content

- **Risk:** Embedded JavaScript in EPUB files could attempt XSS or data exfiltration.
- **Mitigations:** Book content is rendered in a sandboxed iframe with scripting restrictions. Navigation outside the book context is blocked.

#### 5. Supply Chain

- **Risk:** Compromised npm or Cargo packages could introduce malicious code.
- **Mitigations:** Dependencies are pinned via `pnpm-lock.yaml` and `Cargo.lock`. Dependabot and GitHub's dependency review are enabled for automated vulnerability detection.

#### 6. Desktop Native Code (Tauri)

- **Risk:** Tauri IPC commands could be abused by malicious web content to access the filesystem or OS APIs.
- **Mitigations:** Tauri's allowlist restricts which IPC commands are exposed. File system access is scoped to the application data directory.

### Out of Scope

- Vulnerabilities in user's operating system or browser outside of Readest's control
- Physical access attacks to a user's device
- Issues in third-party services (DeepL, Yandex, Calibre) themselves

## Supported Versions

Readest does not currently maintain separate release channels. Security updates are provided only for the latest release series.

| Version | Supported          |
| ------- | ------------------ |
| 0.10.x  | :white_check_mark: |
| < 0.10  | :x:                |

## Reporting a Vulnerability

Please report suspected vulnerabilities privately. Do not open a public GitHub
issue or discussion for security-sensitive reports.

Use GitHub's private vulnerability reporting for this repository:

<https://github.com/readest/readest/security/advisories/new>

When submitting a report, include:

- A clear description of the issue and the affected component
- Steps to reproduce, proof of concept, or a minimal test case
- The versions, platforms, or environments you tested
- Any suggested remediation or mitigating details, if available

What to expect after you report:

- We will aim to acknowledge receipt within 3 business days.
- We may contact you for additional details, reproduction steps, or validation.
- If the report is accepted, we will work on a fix and coordinate disclosure.
- If the report is declined, we will explain why, for example if the behavior is
  expected, unsupported, or not reproducible.

Please keep vulnerability details private until a fix is available and the
maintainers have approved disclosure.

## Incident Response Plan

When a security vulnerability is confirmed, we follow this process:

### 1. Triage (Day 1–2)

- Assign a severity level (Critical / High / Medium / Low) based on impact and exploitability.
- Identify affected versions, components, and users.
- Assign an owner responsible for coordinating the response.

### 2. Containment (Day 1–3)

- Assess whether an immediate mitigation or workaround can be published.
- Limit further exposure where possible (e.g., disable affected features, update dependencies).

### 3. Remediation (Day 3–14, depending on severity)

- Develop and internally review a fix.
- Validate the fix does not introduce regressions.
- Prepare a patched release and update changelog.

### 4. Disclosure & Release

- Coordinate disclosure timing with the reporter.
- Publish a GitHub Security Advisory with CVE if applicable.
- Release the patched version and notify users via release notes.

### 5. Post-Incident Review

- Document the root cause, timeline, and resolution.
- Update processes or controls to prevent recurrence.

### Severity Definitions

| Severity | Description                                                           |
| -------- | --------------------------------------------------------------------- |
| Critical | Remote code execution, full data compromise, or authentication bypass |
| High     | Significant data exposure, privilege escalation, or denial of service |
| Medium   | Limited data exposure or functionality disruption                     |
| Low      | Minor issues with minimal security impact                             |
