# Things still to do

Living backlog of work still outstanding. Keep this current as work progresses:
add new ideas under the right heading, and when an item is finished move it (with
its full description) to [DONE.md](./DONE.md) rather than leaving it ticked here.
Items marked **(v1 scope)** were in the original CLAUDE.md feature set but aren't
built yet; **(Phase 6)** are from the polish/hardening phase.

## Repository management

- [ ] Add support for worktrees
- [ ] Bug - warning shown on open relating to inability to load stashes because "no repository open". Let's not try to load stashes when no repo is open...

## Commit graph & branches

- [ ] **Cherry-pick (single or range)** (v1 scope)
- [ ] Rebase as a merge strategy with conflict-resolution UI — confirm whether
      it's wired up as a first-class action (v1 scope)

## Working tree & committing

- [ ] Line consistency in console output window - new lines should always be rendered from a new line at column 0.
- [ ] Auto-close hooks console when completed

## GitHub integration

- [ ] Issue reference linking in commit messages (v1 scope)
- [ ] **Refresh-token support isn't actually implemented** — despite the item above,
      the device-flow code only captures the `access_token` (`AccessTokenResponse`
      has `access_token` + `error`; the `expires_in` fields are the _device-code_
      lifetime, not token expiry) and stores that single string in the keychain. This
      is fine _only_ while the OAuth App has "Expire user authorization tokens" turned
      **OFF** (non-expiring token). If token expiry is ever enabled (8h access token +
      refresh token) the app would break at 8h and force re-auth. To support it:
      capture `refresh_token` + `expires_in`/`refresh_token_expires_in` from the
      access-token response, persist both (keychain), and refresh via
      `grant_type=refresh_token` on 401 / before expiry. Decide first whether to stay
      an OAuth App (coarse `repo` scope, current) or move to a **GitHub App**
      (fine-grained per-repo permissions, always rotating tokens — also the proper fix
      for the earlier "GitHub App lacks PR permissions" item). Registration/ownership
      is now tracked in the CLAUDE.md pre-public checklist (re-register as "Git Wasp"
      under the `gitwasp` org, Homepage gitwasp.com).

## Config & settings

- [ ] Commit signing config (GPG / SSH) (v1 scope)
- [ ] SSH key management UI (add, view, associate with GitHub accounts) (v1 scope)
- [ ] `.gitconfig` viewer/editor (v1 scope)
- [ ] Keyboard shortcut configuration (v1 scope)
- [ ] Embedded terminal pane scoped to the repo working dir, toggleable (Phase 6)
- [ ] Auto-detect new releases and notifiy user on boot with a toast containing a link to download

## Engineering & tooling

- [ ] Determine a versioning mechanism (commit hash, semantic versioning, etc.). Implement it and link it to release process.
- [ ] GitHub Actions release workflow — tag-triggered matrix, artifacts to Release (Phase 6)
- [ ] `cargo-deny` / licence audit in CI (Phase 6)
- [ ] Error-handling audit — every git failure surfaces a clear, actionable message (Phase 6)
- [ ] Graph performance profiling against large repos (10k+ commits) (Phase 6)
- [ ] Implement rustfmt on save + pre-commit hook
- [ ] Consider implementing a CSP for the frontend (bear in mind we need to support data img or find alternative for user icons)
- [ ] Add ability to open a repo from the commandline e.g. `gitwasp .` to open current directory, `gitwasp /path/to/repo` to open a repo at a different path
- [ ] Add git hooks for commit and push. Commit for linting/formatting consistency, and push to run tests.

## General UX

- [ ] Change default font. Don't want "Inter" - it's an AI dead giveaway and we want this app to feel more professional. Let's update the font list to have some additional font choices NOT including Inter and NOT including Georgia. I want modern sans-serif fonts that don't have licensing restrictions.
- [ ] Don't show "HEAD" pill - it's currently included with the branch / tag pills and feels unnecessary
- [ ] Include section in settings to view open source packages used. Perhaps an "about" section that also includes the app version, it's latest commit, a link to the repo etc.?
- [ ] Add a "notifications" button (bell) to the top menu bar. When notifications are fired (currently toasts) append a notification to a floating panel that opens from the right when clicking the "notifications" icon. Allow notifications to be dismissed one at a time or all at once. Notifications should have scope - either to a repo or global. If per-repo, the repo name should be shown in the notification details. All notifications should include a timestamp.
- [ ] Add "pin" functionality to left-hand sidebar panels that allow "pinning" a branch to the top, pinning a remote branch to the top, or pinning a recent repo to the top. The pinned items should persist between restarts. Pinning should be via a "pin" icon shown on hover - if not already pinned, the icon only shows on hover. If already pinned a solid pin icon is shown when not hovering, and changes to an "unfilled" pin icon on hover. A pinned item can be unpinned by clicking the pin icon again. Pinned items appear at the top. Give more spacing around the existing buttons at the top of this panel too (prune / new branch)
- [ ] Add an integrated terminal that can be shown by clicking a button above the graph view. Should open automatically in the directory that contains the currently opened git repo.
- [ ] Improve toast design. Add icons (e.g. info, warning, error) in the right colour, add a "title" as well as the text
- [ ] Consider a "conventional commits" config option. If enabled, this provides a dropdown for suitable conventional commit prefixes for commit messages (e.g. fix:, ux:, chore:, etc.). Discuss and plan value and implementation before we change any code.
- [ ] Add min width to branch pills. Ensure that when rendered pills overflow the available horizontal width that the UX is better e.g. "[branch] [other-branch] 2 more..."
- [ ] PR editor view doesn't fill the viewport - could be wider
- [ ] Auto-theme switching. Allow user to choose a "default dark" and a "default light" theme and switch between them automatically when the OS theme is "light" or "dark"
- [ ] On MacOS, the app logo seems larger than other apps' logos. Is this an issue on our end, or is it a Tauri issue?
- [ ] Click "interactivity" on elements such as buttons, "ellipsis" menu buttons etc (something _like_ Material Design) that makes user interactions with elements obvious
- [ ] Update stashes sidebar menu so that buttons are removed and the buttons' functionality is in a menu triggered by an "ellipsis" menu. Add a "view" option to the menu - choosing this option should select the stash in the commit graph and scroll the viewport to it automatically.
- [ ] Use GitHub URLs to get avatars rather than gravatar.com. URL path should be `https://github.com/{user}.png` with optional size (e.g. `?size=50`). Same efficiencies and caching should be honoured.
- [ ] Consider building in a "todo list" capability with statuses like "todo", "doing", "done" to track small items of work per repository from in the app (rather than having to use github issues). Might be a terrible idea.

## Other issues

- [ ] Perf on large monorepos — findings from profiling the render paths:
      • Commit graph **is** already virtualised (windowed slice via
      `get_graph_viewport` offset/limit + buffer; canvas draws only the slice;
      a full-height spacer drives the scrollbar). Backend layout is cached and
      only re-walks the full history when refs/HEAD actually move — scrolling
      just slices cached nodes. So the graph isn't the main cost.
      • [x] **Sidebar Local/Remote branch lists now virtualised.** Pulled in
      `react-window` v2 (React 19-compatible) behind a small `VirtualList`
      wrapper (so the lib stays swappable). `CollapsibleSection` now accepts a
      render-function child that receives its resizable height cap; the branch
      lists render a `react-window` `List` sized to `min(count × 32px, cap)` —
      short lists stay compact, long ones cap and window (only the visible slice + overscan mount). Row height fixed at 32px (fits the 24px ⋮ menu button).
      Tests: `VirtualList` (compact vs capped height; renders a slice not all
      1000 rows); existing Sidebar tests still green.
      • [x] **De-duped the double working-tree `status` scan.** Each combined
      refresh (poll / focus / file-watcher / revert) used to run two full
      `repo.statuses()` scans — `get_working_tree_status` (detailed lists) plus
      `changed_file_count` (graph dirty count). New `refresh_working_tree`
      command scans once: it returns the detailed status _and_ updates the graph
      cache's dirty count from that same scan, via
      `WorkingTreeStatus::distinct_change_count()` (unions paths, so a file both
      staged and modified counts once — matches the old `statuses().len()`, and
      now the untracked count matches the staging panel too). Frontend
      `refreshAll` and `revertCommit` call the one command; the old
      `refresh_graph_working_tree_status` command + `graph::refresh_working_tree_status`
      were replaced by `graph::set_change_count(cache, count)`. Halves the
      dominant `git status` cost on a large monorepo. Tests: backend
      (`distinct_change_count` dedup + clean tree; `set_change_count` updates
      the cached count with no rebuild); frontend (refreshAll/watcher do one
      `refresh_working_tree` then the viewport, no second scan). Suites green
      (backend 230, frontend 606).
      • [x] **8s poll now skips the `git status` scan when the watcher saw no
      change.** The Rust file watcher already emits `working-tree-changed`
      (git-ignored churn filtered out backend-side) whenever the tree or
      `.git` moves. App now carries an app-level subscription that flags the
      tree dirty on every such event (on _all_ views — the StagingPanel keeps
      its own subscription for the live sub-second refresh there). The poll
      consults `shouldScanWorkingTree(dirty, tick)` (`lib/workingTreeSync`):
      a clean tick skips the expensive `refreshAll` scan entirely; a backstop
      forces a scan every 8th tick (~64s) to recover any dropped watcher
      event. `syncHead` still runs every tick (cheap). A freshly opened repo
      starts dirty so the first tick re-affirms the graph's dirty-file
      baseline. On an idle large monorepo this drops the per-tick `git status`
      to roughly one scan per minute. Tests: `shouldScanWorkingTree` (dirty
      scans; clean non-backstop skips; backstop cadence; custom interval).
      Also added a README "Performance on managed / corporate devices"
      section — real-time AV scanning (Defender/Intune) intercepting Git's
      file I/O is the likely reason a managed M4 Pro underperforms; documents
      folder/process exclusions for macOS (`mdatp`) and Windows
      (`Add-MpPreference`).
- [ ] Perhaps we could create a small local test repo for me to manually test the app's functionality.
      Its contents don't really matter as long as it's somewhat realistic code inside it. We can then do whatever we need
      to that local repo in terms of forcing merge conflicts etc. We could even clone some small open source project
      locally to have some realistic existing history.

## Website

- [ ] Domain gitwasp.com now owned. Create a "showcase" website on-brand. Should include details of features, how to download, and usage documentation. Links to the github repo (to be renamed) to allow people to log issues etc. Should be based on a popular static website framework ideally and should be suitable for including "docs" for the tool. Similar sites would include <https://aspire.dev/docs/>, <https://docs.usebruno.com/introduction/getting-started>, <https://docs.stripe.com/stripe-cli>

## Pre-release

- [ ] Fix all rust formatting/clippy
- [ ] Architectural review of entire backend
- [ ] Architectural review of entire frontend
- [ ] Performance review of frontend
- [ ] Performance review of backend
- [ ] Removal of unnecessary implementation detail tests (did we take TDD too far?)
- [ ] Remove comments that litter the codebase. "Public" functions should be documented according to language standards (ts / rust) but inline comments are included too frequently and are a maintenance burden.
- [ ] Internationalisation. Tokenize strings, and allow users to change language. Initial supported languages to include British English, American English, and Dutch.
- [ ] Rewrite README.md
- [ ] Remove TODO.md and DONE.md
- [ ] Rewrite CLAUDE.md based on "final" (v1.0.0) implementation
