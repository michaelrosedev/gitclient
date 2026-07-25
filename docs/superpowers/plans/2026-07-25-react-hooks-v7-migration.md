# React Hooks v7 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the complete `eslint-plugin-react-hooks` v7 recommended preset with zero diagnostics, without changing user-visible behavior.

**Architecture:** Replace effect-driven state resets with keyed, input-scoped components or render-derived values. Replace render-time mutable refs with effect-owned subscriptions and closures. Characterize every affected transition first, then make the smallest behavior-preserving refactor.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, Testing Library, ESLint 10, `eslint-plugin-react-hooks` 7.

## Global Constraints

- Preserve existing user-visible behavior; this is a lint-compatibility refactor.
- Follow TDD: extend a focused colocated test, observe it fail, then implement the smallest passing change.
- Restore `...reactHooks.configs.recommended.rules` in `eslint.config.js`; do not add suppressions/exclusions for production code.
- Retain existing non-hook lint policy, including `react-refresh` and project-specific no-drift rules.
- Final verification: lint, unit tests, production build, and audit must pass.

---

## File Structure

| Area               | Files                                                                       | Responsibility                                                      |
| ------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Lint policy        | `eslint.config.js`                                                          | Enable all Hooks v7 recommended rules.                              |
| App lifecycle      | `src/App.tsx`, `src/App.test.tsx`                                           | Preserve merge latching and repository-change reset behavior.       |
| Data panels        | `CommitDetail/*`, `PRPanel/*`                                               | Avoid stale fetched data, errors, and PR-form visibility.           |
| Settings           | `Settings/{GitHooksSettings,GitIdentitySettings,GithubSettings}.*`          | Preserve loading, form initialization, and reconnect UI.            |
| Working tree       | `StashPanel.*`, `WorkingTree/{ChangeOverview,CommitForm,StageFileEditor}.*` | Preserve repo-scoped state, scrolling, and editor behavior.         |
| Shared interaction | `GitHooks/HookOutputPane.*`, `common/ResizeHandle.*`, `ui/Dropdown.*`       | Keep global listeners, terminal following, and positioning current. |

## Task 1: Restore the complete Hooks v7 policy

**Files:**

- Modify: `eslint.config.js:47-52`

**Produces:** All `reactHooks.configs.recommended.rules` apply to TypeScript/TSX source.

- [ ] **Step 1: Re-enable the preset**

```ts
rules: {
  ...reactHooks.configs.recommended.rules,
  "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
  "no-restricted-syntax": ["error", ...noDriftRules],
  "@typescript-eslint/no-floating-promises": "error",
}
```

- [ ] **Step 2: Establish the red baseline**

Run: `npm run lint`

Expected: the known 27 Hooks v7 diagnostics fail lint; ESLint configuration itself loads successfully.

- [ ] **Step 3: Keep this uncommitted until all diagnostics are fixed**

Do not accept a temporarily red branch unless explicitly requested.

## Task 2: Remove App lifecycle setter diagnostics

**Files:**

- Modify: `src/App.tsx:92-113, 206-213`
- Test: `src/App.test.tsx`

**Consumes:** `operationStatus`, `repoPath`, `historyRightMode`.

**Produces:** A merge that ever reports conflicts stays in the merge editor until it ends; a repository change starts the right panel in commit mode.

- [ ] **Step 1: Write failing tests**

Add tests for (a) a merge that gains then resolves conflicts remaining in editor mode, and (b) switching repository while the right panel displays a selection resetting it to commit mode.

- [ ] **Step 2: Run the focused test**

Run: `npm run test:unit -- --dir src src/App.test.tsx --testTimeout=15000`

Expected: new tests fail before refactoring.

- [ ] **Step 3: Implement input-scoped state**

Extract repo-scoped right-panel state into a keyed child:

```tsx
<RepositoryView key={repoPath ?? "no-repository"} repoPath={repoPath} />
```

Use a transition-aware reducer or operation-status-derived merge decision, with no synchronous setter inside an effect. Preserve the existing conflict-latching invariant.

- [ ] **Step 4: Verify and commit**

Run: `npm run test:unit -- --dir src src/App.test.tsx --testTimeout=15000 && npm run lint`

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "refactor: make app lifecycle hooks compiler-safe"
```

## Task 3: Make commit detail and PR state input-scoped

**Files:**

- Modify: `src/components/CommitDetail/CommitDetail.tsx:20-43`
- Modify: `src/components/PRPanel/PRPanel.tsx:9-37`
- Test: `src/components/CommitDetail/CommitDetail.test.tsx`
- Test: `src/components/PRPanel/PRPanel.test.tsx`

**Produces:** No stale commit data, PR error, or closed draft form when selected inputs change.

- [ ] **Step 1: Write failing tests**

Cover clearing an OID returning immediately to empty detail; a repository change clearing a previous PR-load error while reload starts; and a PR draft rendering the form.

- [ ] **Step 2: Run focused tests**

Run: `npm run test:unit -- --dir src src/components/CommitDetail/CommitDetail.test.tsx src/components/PRPanel/PRPanel.test.tsx --testTimeout=15000`

Expected: newly added tests fail before the change.

- [ ] **Step 3: Implement keyed children**

Key commit data by OID and PR view state by the remote/repository identity. Keep asynchronous loading in effects, but initialize scoped state via `useState` in a newly keyed child, not setters at the top of an effect. Make draft visibility derived from `prDraft` or controlled by explicit close/create events.

- [ ] **Step 4: Verify and commit**

Run: `npm run test:unit -- --dir src src/components/CommitDetail/CommitDetail.test.tsx src/components/PRPanel/PRPanel.test.tsx --testTimeout=15000 && npm run lint`

```bash
git add src/components/CommitDetail src/components/PRPanel
git commit -m "refactor: scope detail and PR panel state"
```

## Task 4: Scope Git hook and identity settings forms

**Files:**

- Modify: `src/components/Settings/GitHooksSettings.tsx:21-57`
- Modify: `src/components/Settings/GitIdentitySettings.tsx:64-80`
- Test: `src/components/Settings/GitHooksSettings.test.tsx`
- Test: `src/components/Settings/GitIdentitySettings.test.tsx`

**Produces:** Loading/disabled states and identity prefill behavior identical to the current UI.

- [ ] **Step 1: Write failing tests**

Test a repository switch while the first hook-preferences request is pending; assert its response cannot populate the new repo. Test scope switching/config reload preserving `scopeIdentity(config, scope) ?? config.effective`.

- [ ] **Step 2: Run focused tests**

Run: `npm run test:unit -- --dir src src/components/Settings/GitHooksSettings.test.tsx src/components/Settings/GitIdentitySettings.test.tsx --testTimeout=15000`

Expected: new assertions fail before implementation.

- [ ] **Step 3: Implement keyed form boundaries**

Create repo-keyed hook-preferences and scope-keyed identity-form children. Preserve request-ID stale-response protection; promise completions may set state. Keep saving and errors unchanged.

- [ ] **Step 4: Verify and commit**

Run: `npm run test:unit -- --dir src src/components/Settings/GitHooksSettings.test.tsx src/components/Settings/GitIdentitySettings.test.tsx --testTimeout=15000 && npm run lint`

```bash
git add src/components/Settings/GitHooksSettings.* src/components/Settings/GitIdentitySettings.*
git commit -m "refactor: scope settings form initialization"
```

## Task 5: Replace GitHub settings’ render-time cache

**Files:**

- Modify: `src/components/Settings/GithubSettings.tsx:55-83`
- Test: `src/components/Settings/GithubSettings.test.tsx`

**Produces:** Last resolved connection remains visible while checking, with existing spinner/disabled controls.

- [ ] **Step 1: Write a failing transition test**

Render a connected state, transition to `checking`, assert prior login/status remains with spinner, then resolve an error and assert it replaces the cached view.

- [ ] **Step 2: Run focused test**

Run: `npm run test:unit -- --dir src src/components/Settings/GithubSettings.test.tsx --testTimeout=15000`

Expected: new test fails before implementation.

- [ ] **Step 3: Implement effect-synchronized resolved state**

Initialize state from `conn`; update it in an effect only when `conn.state !== "checking"`; render that state while checking. Do not read/write `.current` during render.

- [ ] **Step 4: Verify and commit**

Run: `npm run test:unit -- --dir src src/components/Settings/GithubSettings.test.tsx --testTimeout=15000 && npm run lint`

```bash
git add src/components/Settings/GithubSettings.*
git commit -m "refactor: make GitHub connection view compiler-safe"
```

## Task 6: Refactor stash, detached-head, and staged-row resets

**Files:**

- Modify: `src/components/Sidebar/StashPanel.tsx:16-30`
- Modify: `src/components/WorkingTree/CommitForm.tsx:63-73`
- Modify: `src/components/WorkingTree/StageFileEditor.tsx:708-715`
- Test: their colocated `.test.tsx` files.

**Produces:** Repository-local drop confirmation, valid fast-forward branch list, and fresh staged rows when a file/mode changes.

- [ ] **Step 1: Write failing tests**

Cover pending stash confirmation disappearing on repository change; leaving detached HEAD clearing recovery branches; and a stage editor file/mode change reseeding staged rows without stale selections.

- [ ] **Step 2: Run focused tests**

Run: `npm run test:unit -- --dir src src/components/Sidebar/StashPanel.test.tsx src/components/WorkingTree/CommitForm.test.tsx src/components/WorkingTree/StageFileEditor.test.tsx --testTimeout=15000`

Expected: new assertions fail.

- [ ] **Step 3: Implement keyed boundaries**

Key confirmation state by repo, fast-forward state by detached-head OID, and staged rows by stable diff/mode identity. Effects remain only for external fetching/editor wiring.

- [ ] **Step 4: Verify and commit**

Run: `npm run test:unit -- --dir src src/components/Sidebar/StashPanel.test.tsx src/components/WorkingTree/CommitForm.test.tsx src/components/WorkingTree/StageFileEditor.test.tsx --testTimeout=15000 && npm run lint`

```bash
git add src/components/Sidebar/StashPanel.* src/components/WorkingTree/CommitForm.* src/components/WorkingTree/StageFileEditor.*
git commit -m "refactor: scope working tree lifecycle state"
```

## Task 7: Preserve merge-editor and dropdown behavior without effect resets

**Files:**

- Modify: `src/components/Merge/ConflictFileEditor.tsx:210-216`
- Modify: `src/components/ui/Dropdown.tsx:108-136`
- Test: their colocated `.test.tsx` files.

**Produces:** A newly selected conflict file starts fresh; dropdowns measure correctly only while open.

- [ ] **Step 1: Write failing tests**

Test selecting a second conflict file starts with its seeded result and no selections from the first. Test close/reopen measures and positions the portal panel correctly.

- [ ] **Step 2: Run focused tests**

Run: `npm run test:unit -- --dir src src/components/Merge/ConflictFileEditor.test.tsx src/components/ui/Dropdown.test.tsx --testTimeout=15000`

Expected: new assertions fail.

- [ ] **Step 3: Implement input-keyed editor and open-only positioning**

Key the stateful conflict-editor body by file path and seeded-result revision. Render no panel while closed and eliminate the `setPos(null)` effect branch; retain layout measurement while open.

- [ ] **Step 4: Verify and commit**

Run: `npm run test:unit -- --dir src src/components/Merge/ConflictFileEditor.test.tsx src/components/ui/Dropdown.test.tsx --testTimeout=15000 && npm run lint`

```bash
git add src/components/Merge/ConflictFileEditor.* src/components/ui/Dropdown.*
git commit -m "refactor: scope editor and dropdown state"
```

## Task 8: Eliminate latest-prop refs in shared drag UI

**Files:**

- Modify: `src/components/common/ResizeHandle.tsx:20-50`
- Modify: `src/components/WorkingTree/ChangeOverview.tsx:70-103`
- Test: their colocated `.test.tsx` files.

**Produces:** Existing global drag listeners use the latest resize callback and overview geometry.

- [ ] **Step 1: Write failing listener-update tests**

Rerender with replacement callbacks/viewport values, dispatch the active global pointer/mouse event, and assert only current callback/geometry is used.

- [ ] **Step 2: Run focused tests**

Run: `npm run test:unit -- --dir src src/components/common/ResizeHandle.test.tsx src/components/WorkingTree/ChangeOverview.test.tsx --testTimeout=15000`

Expected: new assertions fail.

- [ ] **Step 3: Implement closure-owned subscriptions**

Make listener effects depend on the values they use; React should tear down/re-register them on change. Retain only refs read in event handlers. Remove render assignments to `onResizeRef.current` and `stateRef.current`.

- [ ] **Step 4: Verify and commit**

Run: `npm run test:unit -- --dir src src/components/common/ResizeHandle.test.tsx src/components/WorkingTree/ChangeOverview.test.tsx --testTimeout=15000 && npm run lint`

```bash
git add src/components/common/ResizeHandle.* src/components/WorkingTree/ChangeOverview.*
git commit -m "refactor: update shared drag listeners safely"
```

## Task 9: Remove terminal and CodeMirror render-time refs

**Files:**

- Modify: `src/components/GitHooks/HookOutputPane.tsx:31-86`
- Modify: `src/components/WorkingTree/StageFileEditor.tsx:322-335`
- Test: their colocated `.test.tsx` files.

**Produces:** Terminal following updates the current repo; wrapping reconfigures CodeMirror without losing scroll or staged state.

- [ ] **Step 1: Write failing regression tests**

Test terminal scrolling after a repo rerender updates following only for the current repo. Test wrapping toggle preserves scroll and stage selection.

- [ ] **Step 2: Run focused tests**

Run: `npm run test:unit -- --dir src src/components/GitHooks/HookOutputPane.test.tsx src/components/WorkingTree/StageFileEditor.test.tsx --testTimeout=15000`

Expected: new tests fail.

- [ ] **Step 3: Implement closure/effect-owned values**

Make terminal setup depend on `repoPath` so its scroll listener closes over it. Make the wrapping reconfiguration effect depend on `wrap` and dispatch to the live compartment. Remove render assignment to `wrapRef.current`.

- [ ] **Step 4: Verify and commit**

Run: `npm run test:unit -- --dir src src/components/GitHooks/HookOutputPane.test.tsx src/components/WorkingTree/StageFileEditor.test.tsx --testTimeout=15000 && npm run lint`

```bash
git add src/components/GitHooks/HookOutputPane.* src/components/WorkingTree/StageFileEditor.*
git commit -m "refactor: make editor and terminal refs compiler-safe"
```

## Task 10: Verify the complete migration

**Files:**

- Modify if needed: `eslint.config.js`

**Produces:** Every v7 recommended Hooks rule is enabled and passes.

- [ ] **Step 1: Confirm the policy is complete**

Run: `rg -n 'react-hooks/(refs|set-state-in-effect)|configs\.recommended' eslint.config.js src`

Expected: config uses `...reactHooks.configs.recommended.rules`; production code has no migration-rule suppression.

- [ ] **Step 2: Run full verification**

```bash
npm run lint
npm run test:unit -- --dir src --testTimeout=15000
npm run build:web
npm audit --json
```

Expected: lint/build exit 0; the unit suite has 937 or more passing tests; audit reports `"total": 0`.

- [ ] **Step 3: Review final scope**

Run: `git diff main...HEAD --check && git diff main...HEAD -- eslint.config.js src`

Expected: only behavior-preserving lifecycle/refactoring and regression-test changes; no disabled Hooks v7 rules.

- [ ] **Step 4: Commit final policy change**

```bash
git add eslint.config.js src
git commit -m "refactor: satisfy React Hooks v7 migration rules"
```

## Plan Self-Review

- **Coverage:** Tasks 2–9 cover the 27 observed diagnostics: 12 `set-state-in-effect` and 15 `refs` reports.
- **No bypasses:** Task 1 requires the full preset and Task 10 rejects production suppressions.
- **Regression safety:** Each affected component has a colocated test file and receives an explicit transition test before implementation.
- **Scope:** The plan does not enable React Compiler or introduce product changes.

## Execution Progress — 2026-07-25

- [x] **Task 1:** Restored the complete Hooks v7 preset as an intentional uncommitted `eslint.config.js` change. Its 27-diagnostic lint baseline was confirmed; the policy will be committed only with the final green migration.
- [x] **Task 2:** Removed App lifecycle diagnostics and preserved repository-scoped history state across non-history views. Commits: `50f639b`, `241212a`. Approved after re-review.
- [x] **Task 3:** Scoped commit-detail and PR panel state; added the late-arriving PR-draft regression test. Commits: `5c90aac`, `d13c381`. Functionally approved.
- [x] **Task 4:** Scoped Git Hooks and Git Identity forms; added a regression test that distinguishes requested identity values from backend-confirmed reload values. Commits: `ea06ef3`, `4df4f5d`. Approved after re-review.
- [ ] **Task 5:** Replace the GitHub settings render-time connection cache.
- [ ] **Task 6:** Refactor stash, detached-head, and staged-row lifecycle resets.
- [ ] **Task 7:** Preserve merge-editor and dropdown behavior without effect resets.
- [ ] **Task 8:** Eliminate latest-prop refs in shared drag UI.
- [ ] **Task 9:** Remove terminal and CodeMirror render-time refs.
- [ ] **Task 10:** Complete full-policy verification and commit the green `eslint.config.js` change.
