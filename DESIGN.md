# Design

<!-- impeccable:design-schema 1 -->

## Visual System

### Palette

- **Background**: `#0c0c0e` (near-black), `#131318` (card), `#1a1a22` (elevated)
- **Accent**: `#e8ff47` (chartreuse) — primary action, active states, highlights
- **Accent dim**: `#e8ff47` at 7% opacity — hover states, subtle emphasis
- **Borders**: `#1e1e28` (default), `#2a2a35` (elevated)
- **Text**: `#e4e4f0` (primary), `#8a8aa0` (secondary), `#6a6a80` (tertiary), `#505060` (quaternary)
- **Semantic**: `#22c55e` (success/ok), `#ef4444` (error/danger), `#3b82f6` (info), `#ff6b35` (Blender), `#a78bfa` (Substance), `#47c5ff` (Unity), `#fbbf24` (Resonite)

### Typography

- **Primary**: Syne (headings, UI labels)
- **Monospace**: Space Mono (file names, codes, technical data)
- **Base size**: 14px
- **Scale**: 9px (micro) → 10px → 11px → 12px → 13px → 14px (base) → 16px → 18px → 20px
- **Minimum**: 10px (hard floor)

### Spacing

20px grid: 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40

### Components

- **Buttons**: `.btn` base + `.btn-primary`/`.btn-secondary`/`.btn-ghost`/`.btn-danger`
- **Chips**: `.chip` for filter/selection states
- **Cards**: `.pcard` with left accent border on active
- **Folder tiles**: Gradient borders with `color-mix()` per-folder accent, wireframe corner handles
- **Pipeline bar**: Horizontal nodes with connectors, color-coded stages
- **Toasts**: Stacked vertically with 8px gap, 2s lifetime
- **Modals**: Single overlay system with `.overlay`/`.modal`/`.mhead`/`.mbody`/`.mfoot`

### Motion

- `fadeUp`: 250ms ease-out entrance animation
- `lift`: 150ms hover elevation
- `pulse`: 2s infinite accent glow on active elements
- Transitions: 150ms default, 200ms for layout changes

### Layout

- Left sidebar (240px): project list + pipeline
- Main area (flex): file browser with folder tiles
- Right panel (320px): info, checklist, releases
- Overlays: full-screen with centered content

## Voice

Technical, precise, domain-specific. Uses 3D artist terminology (bases, exports, textures). Direct and scannable — no marketing language. Error messages are specific and actionable.

## Design Principles

1. **Dark by default** — technical tools are used in dim studios
2. **Accent for action** — chartreuse means "interactive" or "active"
3. **Tool identity** — each tool gets its brand color
4. **Dense but scannable** — more information per pixel, clear hierarchy
