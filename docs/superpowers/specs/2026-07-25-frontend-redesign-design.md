# Frontend redesign design

## Purpose

Refresh Git Wasp's desktop interface to follow the proposed redesign in
`_assets/redesign/screen 1.png`, while retaining every existing frontend and
backend capability. The result should be a compact, information-first Git
client with a persistent repository rail, a command-oriented top bar, a ledger
history view, and a clear context inspector.

The redesign changes presentation and component boundaries. It must not change
Git-operation semantics, Tauri command contracts, or persisted application
state.

## Fixed constraints

- Preserve the existing canvas commit graph, its lanes and nodes, virtualization,
  range selection, drag/drop, search, focus mode, density preference, and both
  ledger and split graph variants. The redesign may restyle its DOM columns,
  headers, and row backgrounds, but must not replace the canvas renderer.
- Keep CodeMirror 6 as every diff and edit surface.
- Retain all Sidebar capabilities: worktrees, local and remote branches,
  ahead/behind status, remotes, stashes, tags, recent repositories, cloning,
  branch actions, and destructive-action confirmations.
- Retain all HistoryToolbar actions, including push/pull, branch creation,
  column configuration, density, graph layout, search, focus, refresh, and
  jump-to-HEAD.
- Keep the existing `OperationRunner`-backed merge flow and full-screen merge
  editor behavior unchanged.
- Preserve built-in dark/light themes and custom theme compatibility. New visual
  values must be CSS tokens, never one-off hardcoded component colours or
  spacing.
- Do not import the reference HTML's CDN Tailwind, Google fonts, or Material
  Symbols. Reuse the project's local icon set and font configuration.

## Visual direction

The reference establishes four visual principles:

1. **Persistent context.** The repository rail carries identity, repository
   switching, and repository navigation. It should be visible by default and
   remain collapsible and resizable.
2. **Compact command chrome.** Repository tabs occupy the topmost strip.
   Push, Pull, branch creation, primary views, and utility actions sit beneath
   in one predictable command bar.
3. **Ledger history.** The history header and data cells are compact, columnar,
   and scannable. Selection is a restrained accent band with a leading marker.
4. **Inspectable detail.** The right panel has a strong metadata header,
   grouped changed files, a readable description, and a persistent primary diff
   action.

The reference's blue-and-pale-surface palette is a direction for the light
theme, not a new fixed palette. Dark and imported themes receive the same
semantic hierarchy through tokens.

## Target shell

```text
AppShell
├── RepoTabStrip
├── CommandBar
└── WorkspaceLayout
    ├── RepositoryRail
    ├── ContentArea
    │   ├── HistoryWorkspace
    │   │   ├── HistoryCommandStrip
    │   │   └── CommitGraph (existing canvas subsystem)
    │   ├── PullRequestWorkspace
    │   └── SettingsWorkspace
    └── ContextInspector
        ├── CommitDetail
        └── UncommittedPanel
```

`App.tsx` remains the owner of view selection, right-panel mode, boot state,
merge takeover, and top-level state subscriptions. The new shell components
are presentational composition boundaries; they must not duplicate Zustand or
Tauri data ownership.

## Component design

### RepoTabStrip

Restyle `TabBar` as the narrow top strip shown in the reference. It continues
to activate and close open repositories and create a new tab. A tab's worktree
indicator, active state, truncation, and accessibility roles remain intact.

### CommandBar

Evolve `NavBar` into a single command bar below the tab strip.

- Place Push, Pull, and New branch in prominent positions.
- Render History and PRs as the primary view tabs; make Settings a utility icon
  at the trailing edge while preserving its accessible tab semantics.
- Keep the sidebar visibility control.
- Move repository identity/branch switching into the RepositoryRail by default.
  Retain an accessible compact fallback in the CommandBar when the rail is
  collapsed.
- Integrate `HistoryToolbar` actions into the history command area without
  dropping controls. Wider layouts may show common actions directly; secondary
  graph controls may live in an accessible overflow menu.

### RepositoryRail

Recompose `Sidebar`, rather than replace it. The top contains app identity and
a compact repository/branch switcher. Its scrollable content uses the reference
section treatment for Worktrees, Branches, Remotes, Stashes, Tags, and Recent.

Existing virtualized local/remote branch lists, row menus, worktree actions,
clone flow, and confirmation dialogs are preserved. The rail footer contains
Feedback and Help only if those actions exist; otherwise it is omitted rather
than presenting inert controls.

The rail has a 260px default width, retains the existing 160--400px persisted
resize range, and remains keyboard-collapsible.

### HistoryWorkspace and CommitGraph

`CommitGraph` retains its existing canvas drawing and data/interaction model.
Only its surrounding visual treatment changes:

- use a compact ledger header with the existing configurable columns;
- use the existing density setting, with the reference density available as a
  compact preset rather than a forced value;
- align hash, branch, author, and date cells consistently with the reference;
- use shared row states for default, hovered, HEAD, search-match, selected, and
  muted rows;
- retain the graph-on-left/right variants and frozen graph behavior.

The graph canvas must continue to own graph backgrounds that need pixel-perfect
alignment with its rows. Shared tokens supply those colours; CSS must not paint
over or recreate graph lanes/nodes.

### ContextInspector

Restyle `CommitDetail` as a structured inspector. The header contains the
commit subject, close action where applicable, author/avatar/date, copyable
hash, and branch/tag metadata. The body contains a grouped changed-files list
and description. The footer owns a sticky `View Diff` primary action.

Selecting a changed file still opens the existing read-only CodeMirror diff in
the content area. The inspector must continue to handle loading, empty, stale
response, and error states.

`UncommittedPanel` uses the same inspector shell when the working-tree node is
selected. Staging actions, commit form, hunk/file behavior, and discard safety
remain unchanged.

### Other surfaces

PRs, settings, welcome, splash, hook output/status, CodeMirror staging views,
dialogs, toasts, and the merge editor inherit the shared primitives and token
contract. Their application state and control flows are unchanged. The merge
editor remains a dedicated full-screen takeover.

## Token and primitive system

Extend `src/styles/tokens.css` with semantic, theme-overridable tokens for:

- app chrome, repository rail, command bar, content canvas, inspector, and
  inset-card surfaces;
- default, hover, active, selected, and disabled interactive states;
- compact/standard control and row heights;
- section-label typography, ledger-header typography, metadata typography, and
  mono hash/branch typography;
- divider, active-rail-indicator, inspector-footer, and focus-ring treatments.

Create small reusable presentational primitives under `src/components/ui/` only
where more than one surface needs the same behavior: for example `AppSurface`,
`SectionHeader`, `PanelCard`, and `ToolbarGroup`. Existing `Button`,
`IconButton`, `Input`, `Tooltip`, and `ResizeHandle` are evolved rather than
duplicated.

Components consume tokens and primitives; they do not encode palette choices.
All interactive controls preserve visible focus, tooltips or labels for icon
actions, and keyboard access.

## Responsive behavior

The target desktop layout is three panes: rail, content, inspector. At reduced
window width:

1. the rail and inspector retain their persisted width within existing bounds;
2. the history data area scrolls horizontally as it does today, while the graph
   remains frozen;
3. the rail can collapse via the existing control; repository and branch
   switching remain reachable from CommandBar fallback controls;
4. the inspector can be resized or closed without losing selected-commit state;
5. no graph column, action, or destructive confirmation becomes unreachable.

Mobile-specific layouts are not in scope for the desktop application.

## Error handling and state preservation

The redesign must preserve current error-to-toast handling, loading states,
confirmation dialogs, persisted pane widths, graph preferences, and repository
tab/session restoration. A UI migration must not introduce additional backend
requests, alter command argument shapes, or move Git state into React.

## Testing strategy

Use TDD for every phase. Add or update focused component tests before each UI
change, then run the affected tests and full frontend checks.

- Test shell composition, view switching, sidebar collapse, and tab behavior.
- Test command availability and disabled states with/without a repo or remote.
- Test keyboard and accessible roles/labels for tab strips, navigation, menus,
  and icon-only controls.
- Test that history interactions still select commits, open working-tree mode,
  launch diffs, and retain graph settings.
- Test inspector file selection, empty/loading states, and the working-tree
  inspector substitution.
- Test each built-in theme for token presence and legible interactive states.
- Retain existing performance-sensitive graph tests and add no DOM replacement
  for its canvas lanes/nodes.

Visual regression snapshots may be added after the component contracts are
stable, but they supplement rather than replace behavioral tests.

## Multi-phase implementation

### Phase 0: Baseline and contracts

Record screenshots of representative states (light and dark history, selected
commit, working tree, PRs, settings, merge editor) and run the existing
frontend test suite. Inventory existing inline surface styles and identify
which map to the new semantic tokens. Add regression tests for the fixed graph
contract before changing styling.

Exit criterion: baseline is documented, tests pass, and graph behavior has
explicit coverage.

### Phase 1: Design tokens and primitives

Add the semantic token layer and theme overrides. Refine shared controls and
introduce only the reusable presentational primitives justified above. Migrate
a small representative set of existing controls to prove the token contract in
both light and dark themes.

Exit criterion: no new hardcoded visual values are introduced; all built-in
themes render the new chrome and control states legibly.

### Phase 2: Application shell and repository rail

Restructure and restyle `TabBar`, `NavBar`, and `Sidebar` into the target shell.
Move primary repository context to the rail, add the collapsed-rail fallback,
and preserve all sidebar sections and dialogs. Keep persisted resize/collapse
behavior.

Exit criterion: every repository, worktree, branch, remote, stash, tag, recent,
and clone action remains reachable in both expanded and collapsed rail states.

### Phase 3: History workspace and command consolidation

Restyle the graph header/data cells and integrate history controls into the new
command hierarchy. Do not alter `useCommitGraph`, graph canvas drawing, graph
layout data, virtualized row positioning, or interaction semantics.

Exit criterion: all graph controls and interaction modes work at all densities
and both graph variants; canvas output remains behaviorally unchanged.

### Phase 4: Inspector and working-tree continuity

Implement the structured commit inspector, sticky diff affordance, and matching
working-tree inspector styling. Preserve CodeMirror diff/staging routes,
commit-file selection, commit form, staging, stash, discard, and hook output.

Exit criterion: a commit, changed file, and working-tree file can each be
selected and returned from without losing state or actions.

### Phase 5: Secondary workspaces and overlays

Apply the shared design language to PRs, Settings, Welcome, Splash, dialogs,
toasts, hook UI, staging editor, and merge editor. Verify no screen assumes the
old panel hierarchy.

Exit criterion: all app views and modal/takeover states use coherent surfaces
and maintain their established workflows.

### Phase 6: Accessibility, responsiveness, and release verification

Audit keyboard navigation, focus order, contrast in every built-in theme,
window-width behavior, overflow menus, and persisted layout restoration. Run
lint, unit tests, production frontend build, and Tauri build/tests appropriate
to the branch.

Exit criterion: accessibility and resize findings are resolved, all checks pass,
and a manual smoke test covers each retained feature area.

## Non-goals

- Rewriting the commit graph canvas or graph-layout Rust code.
- Changing backend commands, Git semantics, `OperationRunner`, or persistence
  formats.
- Adding a new editor, icon library, remote font dependency, or CSS framework.
- Implementing new Git features as part of the visual redesign.
- Treating the static reference HTML as shippable application code.

## Acceptance criteria

The redesign is complete when Git Wasp matches the reference's desktop
hierarchy and visual intent, while users can still perform every currently
available operation from an accessible interface. The commit graph must remain
the existing high-quality canvas graph, visually integrated into the new shell
but mechanically untouched.
