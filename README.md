# PCOMPOSITE

A desktop **asset pipeline manager** for 3D avatar creators. Organise, track, and publish your assets across the full content creation pipeline — from modelling to upload.

---

## Screenshots

| | |
|---|---|
| ![img1](media/img1.jpg) | ![img2](media/img2.jpg) |
| ![img3](media/img3.jpg) | |

## Features

- **Project-based workflow** — each project gets its own folder structure (blender, subs, unity, fbx, pictures, promo art, resonite, export) with automatic progress tracking
- **Pipeline tracker** — a visual 5-step bar (Blender → Painter → Unity → Package → Upload) that moves forward as you complete checklist items
- **File browser** — browse files per folder or all at once, with thumbnails, list/grid toggle, and one-click open in the right app
- **Smart drag & drop** — drag files from your file explorer; they are automatically sorted into the correct folder by file type
- **Checklist + session notes** — a per-project checklist that controls the pipeline, plus auto-saving text notes for each session
- **Export management** — track FBX export versions by target avatar base, collapse old versions, mark the current one
- **Gallery** — full-screen overview of all your projects in grid or calendar view, with search and stage filters
- **Avatar bases** — browse a configured bases folder and import base files directly into the current project
- **Settings** — configure your projects root path, app executables (Blender, Painter, Unity), and avatar bases location

## Getting Started

1. Download the latest release from the **Releases** page
2. Launch PCOMPOSITE — you'll see an empty project list
3. Click **+ NEW** in the titlebar to create your first project
4. Drag files into the drop zone — they'll be sorted automatically
5. Use the checklist to track your progress through the pipeline

---

## For Developers

### Tech Stack

| Layer | |
|---|---|
| Desktop shell | [Tauri v2](https://v2.tauri.app) (Rust) |
| Frontend | Vanilla JavaScript (ES modules) |
| Bundler | [Vite](https://vitejs.dev) 5.x |
| CSS | Pure CSS with custom properties |
| Fonts | [Syne](https://fonts.google.com/specimen/Syne) + [Space Mono](https://fonts.google.com/specimen/Space+Mono) |
| Storage | JSON files in the OS app data directory |

### Build & Run

Requires **Node.js 18+** and the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server (browser preview)
npm run build        # Build frontend for production
npm run tauri dev    # Launch the desktop app in dev mode
```

### Project Structure

```
pcomposite/
├── src/                    # Frontend source
│   ├── main.js             # Entry point, imports, event wiring
│   ├── state.js            # Shared state
│   ├── constants.js        # Folder definitions, app icons
│   ├── helpers.js          # Utility functions
│   ├── projects.js         # Project CRUD, card rendering
│   ├── files.js            # File browser (list + grid), thumbnails
│   ├── folders.js          # Folder tile grid
│   ├── ui.js               # Tab switching, modals, panels
│   ├── pipeline.js         # Pipeline step logic
│   ├── checklist.js        # Checklist + session notes
│   ├── gallery.js          # Gallery overlay
│   ├── exports.js          # Export version management
│   ├── bases.js            # Avatar bases browser
│   ├── settings.js         # Settings overlay
│   ├── thumbnail.js        # Thumbnail generation
│   └── *.css               # Domain-specific stylesheets
├── src-tauri/              # Tauri Rust backend
│   ├── src/lib.rs          # Tauri commands
│   ├── Cargo.toml
│   └── tauri.conf.json
├── public/                 # Static assets
├── media/                  # Screenshots and media
├── index.html
├── vite.config.js
└── package.json
```

## License

MIT
