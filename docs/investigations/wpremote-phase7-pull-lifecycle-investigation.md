# Investigation: WP Remote Phase 7 Pull Lifecycle

## Summary
The observed "app quit before completion" during Phase 7 validation was partly test-harness behavior and partly a real Studio lifecycle gap. The validation script force-closes Electron in `finally`, but Studio also cannot recover an in-flight provider pull after quit/restart because provider pull orchestration is renderer-owned and `initializeSyncStatesThunk` restores only WordPress.com push state.

## Symptoms
- Studio add-site can create and connect a WP Remote local site scaffold, but durable pull completion is not observed.
- `connectedRemoteSites[].lastPullTimestamp` remains `null` while the bridge-side WP Remote job continues running.
- During validation, the Electron app closes before the provider-pull completion tail writes the final timestamp.

## Investigation Log

### Initial Assessment
**Hypothesis:** The add-site flow starts pull asynchronously and Studio can lose lifecycle ownership before the provider-pull success path writes completion state.
**Findings:** Confirmed.
**Evidence:**
- `studio/apps/studio/src/hooks/use-add-site.ts:296-305` dispatches `syncOperationsThunks.pullSite(...)` with `void dispatch(...)` after connecting the site.
- `studio/apps/studio/src/hooks/use-add-site.ts:305` immediately switches back to the sync tab instead of waiting for pull completion.
**Conclusion:** Add-site kickoff is intentionally fire-and-forget.

### Renderer-owned provider pull lifecycle
**Hypothesis:** Provider pulls only complete if the renderer/store stays alive long enough to keep polling and run the local import tail.
**Findings:** Confirmed.
**Evidence:**
- `studio/apps/studio/src/stores/sync/sync-operations-slice.ts:557-649` starts a provider pull by calling `getIpcApi().startRemotePull(...)` and stores the returned `providerOperation` in Redux state.
- `studio/apps/studio/src/stores/sync/sync-operations-slice.ts:911-1018` polls provider progress via `getIpcApi().pollRemotePull(...)`.
- In the same block, Studio only writes completion after the full local tail succeeds: download artifact → import backup locally → `updateSiteTimestamp(...)` → mark `finished`.
- `studio/apps/studio/src/stores/sync/sync-operations-slice.ts:27-54` shows `lastPullTimestamp` is written by `updateConnectedRemoteSites(...)`, not when the remote job starts.
**Conclusion:** A provider pull is not durably complete until the local import tail runs inside `pollPullBackupThunk`.

### Active sync tracking is driven by renderer state, not durable main-process state
**Hypothesis:** Quit protection and progress tracking depend on transient renderer updates.
**Findings:** Confirmed.
**Evidence:**
- `studio/apps/studio/src/stores/index.ts:104-148` mirrors `updatePullState` / `clearPullState` into IPC `addSyncOperation` / `clearSyncOperation`.
- `studio/apps/studio/src/lib/active-sync-operations.ts:9-18` stores active sync operations in an in-memory `Map`.
- `studio/apps/studio/src/modules/sync/lib/ipc-handlers.ts:111-140` mutates only in-memory `ACTIVE_SYNC_OPERATIONS` and abort-controller maps.
**Conclusion:** Active provider pulls are tracked in-memory and depend on the renderer continually emitting state updates.

### Startup recovery covers WordPress.com push, not provider pulls
**Hypothesis:** Restarting Studio does not resume an in-flight WP Remote provider pull.
**Findings:** Confirmed.
**Evidence:**
- `studio/apps/studio/src/components/app.tsx:42-46` dispatches `syncOperationsThunks.initializeSyncStates()` on startup when a wp.com client exists.
- `studio/apps/studio/src/stores/sync/sync-operations-slice.ts:1164-1209` restores only in-progress WordPress.com push/import state.
- `studio/apps/studio/src/stores/sync/sync-operations-slice.ts:1168-1170` returns early with no wp.com client.
- `studio/apps/studio/src/stores/sync/sync-operations-slice.ts:1177-1179` explicitly skips non-WP.com connected sites with `if ( ! isWpcomSyncSite( connectedSite ) ) { continue; }`.
- Git blame ties the external-provider guard lines to `a573282f` (`add external provider sync flow`, 2026-03-28), while the recovery thunk itself originated in `53bbfb6e` (2026-03-03).
**Conclusion:** Provider pulls have no restart recovery path.

### Quit behavior and messaging are not accurate for provider pulls
**Hypothesis:** Studio’s quit UX implies provider pull completion is safe across quit even though the local completion tail is not.
**Findings:** Confirmed.
**Evidence:**
- `studio/apps/studio/src/index.ts:363-398` shows a quit dialog that says, for non-uploading sync work, "The sync process will continue running remotely after you quit Studio."
- `studio/apps/studio/src/index.ts:463-476` then proceeds through `will-quit`, unregisters listeners/watchers, and calls `stopAllServers( true, 6000 )`.
- `studio/apps/studio/src/site-server.ts:33-59` implements `stopAllServers(...)` by spawning `site stop --all`.
- `studio/apps/studio/src/modules/cli/lib/execute-command.ts:191-228` registers an `app.will-quit` handler that kills child CLI processes.
**Conclusion:** The current quit copy is incorrect for pull operations. The remote backup/export may continue, but Studio’s local polling/import/finalization path does not.

### Eliminated hypothesis: timestamp persistence merge is clearing the result
**Hypothesis:** `lastPullTimestamp` is written and later overwritten back to `null` by a persistence merge.
**Findings:** Eliminated.
**Evidence:**
- `studio/apps/studio/src/modules/sync/lib/ipc-handlers.ts:548-577` merges updates by preserving non-null timestamps:
  - `lastPullTimestamp: updatedSite.lastPullTimestamp ?? currentSite.lastPullTimestamp`
  - `lastPushTimestamp: updatedSite.lastPushTimestamp ?? currentSite.lastPushTimestamp`
**Conclusion:** Missing completion is caused by the completion tail not running, not by a later merge resetting timestamps.

### Separate harness finding: the validation script closes the app itself
**Hypothesis:** The observed app close during validation may be a harness artifact rather than a product crash.
**Findings:** Confirmed.
**Evidence:**
- `/tmp/phase7-live-validation.cjs:140-172` waits for `connectedRemoteSites[].lastPullTimestamp` and throws after timeout.
- `/tmp/phase7-live-validation.cjs:381-384` gives the pull up to `60 * 60 * 1000` ms.
- `/tmp/phase7-live-validation.cjs:423-426` always runs `await app.close()` in `finally`.
**Conclusion:** The validation harness can manufacture the exact interruption we are trying to diagnose. The observed close is not, by itself, proof of an Electron crash.

## Root Cause
The core product issue is a lifecycle design gap in provider pulls:

1. Add-site starts provider pull asynchronously (`use-add-site.ts:296-305`).
2. Provider pull state and active-sync tracking live in renderer-driven Redux / IPC mirroring (`stores/index.ts:104-148`, `active-sync-operations.ts:9-18`).
3. Provider pull completion only happens in the renderer-owned success tail of `pollPullBackupThunk`, where Studio downloads, imports, timestamps, and marks finished (`sync-operations-slice.ts:911-1018`).
4. Startup recovery restores only WordPress.com push state and explicitly skips provider sites (`sync-operations-slice.ts:1164-1209`).

As a result, if Studio quits, closes, reloads, or loses the renderer before that success tail runs, the remote bridge job can keep progressing, but Studio will not automatically resume polling/import/finalization. `lastPullTimestamp` correctly remains `null` because the local completion path never ran.

A separate but important investigation result is that the validation harness also force-closes Electron in `finally`, so the observed Phase 7 run was interrupted by the test harness itself after waiting for completion.

## Recommendations
1. **Smallest safe Phase 7 fix:** add provider-pull-specific quit protection and correct quit copy.
   - File: `studio/apps/studio/src/lib/active-sync-operations.ts`
   - File: `studio/apps/studio/src/index.ts`
   - Treat active pull states (`in-progress`, `downloading`, `importing`) as unsafe to quit.
   - Change the dialog copy to state that remote backup/export may continue, but local import/finalization will not finish automatically if Studio quits.
   - Default the dialog to **Cancel** for active pulls.

2. **Validation harness fix:** do not unconditionally close Electron while a pull is still active.
   - File: `/tmp/phase7-live-validation.cjs`
   - Otherwise the test itself can create a false-negative by interrupting the app before completion.

3. **Robust architectural fix:** move provider-pull orchestration into a durable main-process state machine.
   - Candidate files: `studio/apps/studio/src/modules/sync/lib/ipc-handlers.ts`, `studio/apps/studio/src/stores/sync/sync-operations-slice.ts`, related persistence layer.
   - Persist in-flight provider operation state (`providerAccountId`, `remoteSiteId`, `providerOperation`, local phase).
   - Resume/reconcile on startup.

4. **Do not paper over the bug by writing `lastPullTimestamp` earlier.**
   - That would make the completion timestamp lie about the local import actually finishing.

## Preventive Measures
- Add a lifecycle test that starts a provider pull, simulates quit/restart, and verifies either:
  - Studio blocks quit during the unsafe phase, or
  - Studio recovers and completes the pull after restart.
- Add a focused test for `initializeSyncStatesThunk` covering external providers so future changes cannot silently remain WP.com-only.
- Keep quit messaging split by operation type:
  - uploading push = aborts on quit
  - remote-only push finalization = may continue remotely
  - pull = remote export may continue, but local completion is interrupted
