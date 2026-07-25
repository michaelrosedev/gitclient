# Git Wasp

[![CI](https://github.com/Git-Wasp/git-wasp-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/Git-Wasp/git-wasp-desktop/actions/workflows/ci.yml)

A Git desktop client built with Tauri v2 + React + TypeScript.

**Status:** Phase 1 (Foundation) — opens a repository, displays a virtualised commit graph, shows diffs.

---

## Prerequisites

| Tool      | Minimum        | Notes                                   |
| --------- | -------------- | --------------------------------------- |
| Rust      | stable (1.80+) | Install via [rustup](https://rustup.rs) |
| Node.js   | 20.17+         |                                         |
| npm       | 10+            | Bundled with Node                       |
| Xcode CLT | latest         | macOS only — `xcode-select --install`   |

> **No system OpenSSL or libgit2 required.** Both are vendored into the Rust build automatically.

---

## Getting started

```sh
# Clone and install JS dependencies
git clone <repo-url> gitclient
cd gitclient
npm install

# Start the app in development mode
npm run dev
```

`npm run dev` starts Tauri dev, which:

1. Starts the Vite dev server on `http://localhost:1420`
2. Compiles the Rust backend
3. Opens the app window with hot-reload

The first run compiles vendored libgit2 and OpenSSL — this takes a few minutes. Subsequent runs use the Cargo cache and start in seconds.

---

## Available commands

| Command              | What it does                                                                       |
| -------------------- | ---------------------------------------------------------------------------------- |
| `npm run dev`        | Start the full app in development mode (Tauri + Vite HMR)                          |
| `npm run dev:web`    | Start only the Vite frontend (no Tauri window, browser at `http://localhost:1420`) |
| `npm run build`      | Build the Tauri app for distribution                                               |
| `npm run build:web`  | Build only the frontend (`dist/`)                                                  |
| `npm run test:unit`  | Run all unit tests (Vitest + Rust)                                                 |
| `npm run test:watch` | Run frontend tests in watch mode                                                   |
| `npm run lint`       | ESLint check across `src/`                                                         |

### Running Rust tests independently

```sh
cd src-tauri
cargo test
```

---

## Performance on managed / corporate devices

If the app feels sluggish — slow to open large repositories, laggy refreshes,
high CPU while idle — the most common cause on corporate hardware is
**real-time antivirus scanning**. Endpoint protection (Microsoft Defender for
Endpoint, common on Intune-joined devices) intercepts every file read. Git is
I/O-heavy: a single `git status` on a large monorepo stats tens of thousands of
files, and the app also runs a file watcher over the working tree. When each of
those reads is scanned synchronously, throughput can drop several-fold — enough
that a fast machine (e.g. an M4 Pro) performs _worse_ than an unmanaged one.

Excluding your repositories and toolchain from real-time scanning usually
restores native performance. Exclude:

- The directories where your Git repositories live (the working trees that get
  scanned/watched)
- Build output that churns constantly: `target/` (Rust), `node_modules/`,
  `dist/`
- Optionally, the `git`, `node`, and `cargo` binaries as _process_ exclusions

> **Managed devices:** on an Intune-joined machine these settings are typically
> controlled by your organisation's policy and you may not be able to change
> them yourself. Ask IT to add the exclusions above via Intune, or to grant a
> local exception.

### macOS (Microsoft Defender)

If the `mdatp` CLI is available and local exclusions are permitted:

```sh
mdatp exclusion folder add --path ~/dev        # your repos root
mdatp exclusion folder add --path ~/.cargo
mdatp health --field real_time_protection_enabled   # check current state
```

### Windows (Microsoft Defender)

In an elevated PowerShell (or via **Windows Security → Virus & threat
protection → Exclusions**):

```powershell
Add-MpPreference -ExclusionPath "C:\dev"            # your repos root
Add-MpPreference -ExclusionProcess "git.exe"
```

After adding exclusions, reopen a large repository and compare — the difference
is usually immediately obvious.

---

## Project structure

```
gitclient/
├── src/                        # React frontend (TypeScript)
│   ├── styles/
│   │   ├── tokens.css          # CSS custom properties token layer (theme contract)
│   │   └── globals.css         # Tailwind + base reset
│   ├── components/
│   │   ├── CommitGraph/        # Canvas-rendered virtualised graph
│   │   ├── CommitDetail/       # Commit metadata + CodeMirror 6 diff viewer
│   │   └── Sidebar/            # Repo picker, branch list, recent repos
│   ├── hooks/
│   │   └── useCommitGraph.ts   # Canvas draw loop
│   ├── stores/                 # Zustand state (repoStore, graphStore)
│   └── types/                  # TypeScript types mirroring Rust structs
├── src-tauri/                  # Rust backend
│   ├── src/
│   │   ├── repo_manager/       # Open repos, config persistence, branch checkout
│   │   ├── graph/              # DAG layout algorithm (lane assignment, edges)
│   │   ├── diff_engine/        # Commit diffs via git2
│   │   ├── commands/           # Tauri command handlers
│   │   ├── operation_runner/   # Stub — pauseable state machine (Phase 4)
│   │   └── file_watcher/       # Stub — notify crate integration (Phase 2)
│   └── Cargo.toml
├── .github/workflows/ci.yml    # Three-target CI (macOS arm64, Linux, Windows)
└── CLAUDE.md                   # Project context and architectural decisions
```

---

## Architecture

The Rust backend owns all Git state. The frontend never reads `.git` directly — all interaction is via Tauri `invoke()` calls.

```
React frontend
    │  invoke("open_repo", ...)
    │  invoke("get_graph_viewport", { offset, limit })
    │  invoke("get_commit_diff", { oid })
    ▼
Tauri command layer (Rust)
    ├── RepoManager   — open/persist repos, branch checkout
    ├── graph::layout — DAG lane assignment, viewport slicing
    └── DiffEngine    — file diffs via git2
```

### Key constraints (see CLAUDE.md for rationale)

- All styling uses CSS custom property tokens from `src/styles/tokens.css` — never hardcoded values
- The commit graph renders to a `<canvas>` element, not the DOM; DAG layout is computed in Rust
- All diff viewing uses CodeMirror 6 only
- Multi-step Git operations will route through `OperationRunner` (Phase 4)

---

## CI

GitHub Actions runs on every push and PR across three targets in parallel:

| Target      | Runner           |
| ----------- | ---------------- |
| macOS arm64 | `macos-latest`   |
| Linux x64   | `ubuntu-latest`  |
| Windows x64 | `windows-latest` |

Each job runs frontend tests (`vitest`), Rust tests (`cargo test`), and a build check (`tauri build --no-bundle`).

---

## Git hooks

Running `npm install` installs the repository's tracked Git hooks through Husky.

- **Pre-commit:** formats staged frontend and Rust files, then lints staged frontend source files. Partially staged files keep their unstaged edits out of the commit.
- **Pre-push:** runs the complete frontend and Rust test suites and blocks the push if either suite fails.

Git's standard `--no-verify` option bypasses these checks when an operator deliberately needs the emergency escape hatch.

---

## Recommended IDE setup

[VS Code](https://code.visualstudio.com/) with:

- [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
