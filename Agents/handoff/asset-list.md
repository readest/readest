# Citadel — Asset List for Python Compiler

# Every file your build pipeline needs to bundle.

# Paths are relative to the project root.

## ── Images ──────────────────────────────────────────────────────────────────

assets/citadel-logo.png
• Usage : Splash screen + TopBar logo mark
• Format: PNG with transparency
• Size : display at 480px wide (splash), 26–28px tall (topbar)

assets/comet.png
• Usage : Shooting-star animation over the castle in the splash sequence
• Format: PNG with transparency
• Size : display at ~140px wide, scaled by animation

## ── Textures (fantasy mode) ─────────────────────────────────────────────────

# These are NOT in the repo yet — your pipeline must supply them.

# The JS controller emits them via --citadel-fantasy-chapter-texture-url.

assets/parchment.jpg ← aged parchment / paper texture (recommended ≥ 1024×1024)
• Usage : .chr-chapter-texture background-image (fantasy reader bg)
• Blend : CSS background-blend-mode: multiply on top of --hp-bg (#0c0906)
• Source: supply a seamlessly-tileable warm paper scan or generate procedurally

## ── Fonts (Google Fonts CDN — no local file needed unless offline build) ────

Inter weights 300 400 500 600 700
https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700

IM Fell English weights 400 (regular + italic)
https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1

Cinzel weights 400 600 700
https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700

# Combined single-request URL:

https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=IM+Fell+English:ital@0;1&family=Cinzel:wght@400;600;700&display=swap

## ── CSS ─────────────────────────────────────────────────────────────────────

handoff/fantasy-mode.css
• Scope: drop on <body class="fantasy"> for fantasy skin
• Deps : fonts above; no other external deps

## ── Icons (inline SVG — no file assets needed) ──────────────────────────────

# All icons are hand-coded inline SVG (stroke-based, 2px stroke-width).

# No icon font, no sprite sheet. The following shapes are used:

Close 24×24 M18 6 6 18M6 6l12 12
Back arrow 24×24 M19 12H5M12 5l-7 7 7 7
Chevron R 24×24 M9 18l6-6-6-6
Search 24×24 circle cx11 cy11 r8 + path m21 21-4.35-4.35
Settings 24×24 gear path (see TopBar.jsx)
Play 10×10 polygon points 2,1 9,5 2,9
Pause 10×10 two rects 1,1 3×8 and 6,1 3×8

## ── CSS Custom Properties set by JS controller ──────────────────────────────

--citadel-fantasy-chapter-texture-url url("assets/parchment.jpg")
--citadel-audio-mid 0.0 … 1.0 (Web Audio analyser midrange, per frame)
--char-color #hexcode (per character, set on row / avatar)
--entry-color #hexcode (per journal entry stripe + meta)
--entry-bg rgba(...) (per journal entry blockquote bg)
--pill-color #hexcode (per colour-filter pill)

## ── No assets needed ────────────────────────────────────────────────────────

# The following are generated at runtime and require no bundled file:

# • Ambient glow behind hero (radial-gradient from cover color via JS)

# • Noise grain overlay (inline SVG data-uri in fantasy-mode.css)

# • Vignette (CSS radial-gradient pseudo-element)

# • Candlelight glow (CSS radial-gradient pseudo-element)

# • Waveform bars in audiobook player (SVG drawn by JS)

# • Ember / sparkle particles in splash (JS-generated divs)

# • Comet arc + sparkle burst (JS-generated, CSS keyframes)
