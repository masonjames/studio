# Remote Provider Expansion Backlog

## About this doc

This backlog tracks the work required to ship the remote-provider expansion roadmap described in:

- `remote-provider-expansion-prd.md`
- `remote-provider-architecture-and-phases.md`

- **Status:** In progress
- **Last updated:** 2026-04-01

## Tracking conventions

- Use `[ ]` for not started.
- Use `[-]` for in progress.
- Use `[x]` for completed.
- Keep implementation notes under the relevant task instead of adding separate scratch docs when possible.
- Do not store secrets, tokens, or credential values in this file.

## Progress snapshot - 2026-03-31

- Studio provider-model generalization is complete.
- Shared bridge-backed provider plumbing is complete.
- Provider-aware bridge contract generalization is complete.
- WP Remote bootstrap/discovery is now manually validated on a real Flywheel-hosted Avenue941 test site.
- WP Remote remains intentionally discovery-only in Studio.
- Bridge-side WP Remote export is implemented in code and under live verification.
- Flywheel now has a separate native-support track because unpatched Flywheel WP Remote filesystem export is not reliable.

## Phase 1 - Studio provider model and chooser updates

### Goal

Get the Studio UI and provider type model ready for the new lineup: WP Remote, MainWP, Flywheel, and WP Engine.

### Exit criteria

- The provider chooser shows the new order.
- Hetzner and DigitalOcean are gone from the chooser.
- Discovery providers do not route into broken flows.
- MainWP still works as the current actionable baseline.

### Tasks

- [x] **P1-1 | studio | Generalize provider identities in `apps/studio/src/modules/sync/types.ts`**
  - Add support for `wpRemote`, `flywheel`, and `wpEngine` while preserving `mainwpBridge` compatibility.
  - Confirm existing stored MainWP accounts remain representable.

- [x] **P1-2 | studio | Redesign `apps/studio/src/modules/sync/providers/registry.ts`**
  - Replace Hetzner and DigitalOcean entries.
  - Add provider ordering and availability metadata.
  - Put WP Remote first.

- [x] **P1-3 | studio | Update chooser UI in `select-remote-provider.tsx` and related add-site screens**
  - Render provider availability states.
  - Ensure discovery providers show accurate messaging.
  - Confirm chooser copy reflects the new roadmap.

- [x] **P1-4 | studio | Replace MainWP-specific branching in `pull-provider-remote-site.tsx`**
  - Move to a provider selector registry or equivalent dispatch pattern.
  - Route unsupported/discovery providers to a shared unavailable state.

- [x] **P1-5 | studio | Add or update tests for the chooser lineup**
  - Cover ordering.
  - Cover availability rendering.
  - Cover discovery-provider click behavior.

## Phase 2 - Shared Studio bridge abstraction

### Goal

Refactor the existing MainWP plumbing into shared bridge-backed provider infrastructure that compatible providers can reuse, while keeping WP Remote account-shape decisions gated behind discovery.

### Exit criteria

- MainWP still validates accounts, lists sites, and pulls successfully.
- Shared bridge-backed code exists outside a MainWP-only naming boundary.
- Provider IPC is driven by provider lookup instead of hard-coded MainWP behavior.

### Tasks

- [x] **P2-1 | studio | Extract bridge-generic HTTP client from `modules/sync/providers/mainwp-bridge/client.ts`**
  - Create shared bridge client and schema modules.
  - Keep any MainWP-only copy or presentation concerns separate.

- [x] **P2-2 | studio | Extract shared bridge-backed account form for compatible providers**
  - Move common bridge URL/token inputs into a provider-neutral component.
  - Leave provider-specific copy in wrapper components.
  - Do not assume WP Remote uses this exact input shape until discovery confirms it.

- [x] **P2-3 | studio | Add provider-client delegation in `modules/sync/providers/ipc-handlers.ts`**
  - Replace MainWP-only lookup and operation branching.
  - Keep appdata persistence and locking behavior intact.

- [ ] **P2-4 | studio | Align `preload.ts`, top-level `ipc-handlers.ts`, and `ipc-types.d.ts`**
  - Keep renderer and main-process signatures synchronized.
  - Confirm all handlers remain async.

- [x] **P2-5 | studio | Generalize remote pull handling in `stores/sync/sync-operations-slice.ts`**
  - Treat bridge-backed providers generically.
  - Keep WP.com behavior unchanged.

- [x] **P2-6 | studio | Add regression tests for MainWP after the refactor**
  - Cover account validation path.
  - Cover site listing path.
  - Cover pull-operation state transitions where practical.

## Phase 3 - Shared bridge contract generalization

### Goal

Make the existing bridge contract provider-aware while keeping MainWP stable.

### Exit criteria

- Bridge health/capability responses can advertise provider support.
- Public site records include provider identity.
- Current bridge consumers remain additive and compatible, with MainWP retained as the Studio-side regression baseline.

### Tasks

- [x] **P3-1 | studio-hetzner-bridge | Generalize site inventory in `src/site-inventory.ts`**
  - Add provider identity.
  - Preserve the current Hetzner/Dokploy-backed inventory behavior for existing bridge consumers as the first supported case.

- [x] **P3-2 | studio-hetzner-bridge | Update `src/app.ts` provider-facing responses**
  - Add provider support metadata to health/capability checks.
  - Keep changes additive.

- [x] **P3-3 | studio-hetzner-bridge | Generalize execution seams in `src/execution.ts`**
  - Route by provider or adapter type as needed.
  - Avoid hard-coding WP Remote logic into the desktop app.
  - Landed as a non-activating provider dispatch seam with explicit unsupported adapters for non-MainWP providers.

- [x] **P3-4 | studio-hetzner-bridge | Update README and internal docs**
  - Describe the service as the shared provider bridge.
  - Keep the repo name unchanged for now.

- [x] **P3-5 | platform-infra | Update service and rollout documentation**
  - Revise Hetzner-only language where needed.
  - Keep deployment instructions accurate for current operations.

## Phase 4 - WP Remote discovery spike

### Goal

Prove the exact contract required for WP Remote before implementation begins.

### Exit criteria

- We know how WP Remote pairing works.
- We know how site inventory is derived.
- We know how export/pull should be executed.
- We have a go/no-go recommendation for implementation.

### Tasks

- [x] **P4-1 | research | Inspect `wpremote` plugin pairing and auth primitives**
  - Focus on connection-key flows.
  - Focus on signed callback behavior.
  - Document what the bridge must own.
  - Discovery conclusion: the connection key is a pairing seed only; the bridge must own runtime callback credentials, signing material, and replay-safe request dispatch.

- [-] **P4-2 | research | Validate WP Remote assumptions against available fixtures**
  - Use the available WP Remote codebases and approved test environments.
  - Capture implementation constraints without storing secrets.
  - Completed so far: pairing bootstrap, signed callback validation, bridge site registration, and Studio discovery were proven against a real Flywheel-hosted Avenue941 fixture on 2026-03-31.
  - Remaining gate: prove DB access, filesystem export, and artifact-assembly feasibility.

- [x] **P4-3 | studio-hetzner-bridge | Draft WP Remote bridge adapter contract**
  - Map WP Remote onto the existing site/job/artifact lifecycle if possible.
  - Document any contract gaps.

- [x] **P4-4 | studio | Draft WP Remote selector UX requirements**
  - Define account copy.
  - Define empty states.
  - Define failure states.

- [x] **P4-5 | planning | Record go/no-go decision**
  - If go: convert findings into implementation tasks.
  - If no-go: document why and update the roadmap.
  - Current decision: go. Discovery is sufficient to start a bridge-first export implementation phase while keeping Studio pull disabled.

## Phase 5 - WP Remote bootstrap and discovery implementation

### Goal

Ship the first real WP Remote runtime slice:

- bridge bootstrap,
- bridge validation,
- discovered-site listing,
- Studio-side account save,
- discovery-only pull gating.

### Exit criteria

- Users can validate a WP Remote bridge account and list a real discovered site in Studio.
- The bridge can bootstrap and validate at least one real WP Remote site.
- Studio keeps WP Remote discovery-only until export support lands.
- MainWP still works.

### Tasks

- [x] **P5-1 | studio | Add WP Remote provider selector container**
  - Reused shared bridge account UI.
  - Added WP Remote-specific selector copy and discovery messaging.

- [x] **P5-2 | studio-hetzner-bridge | Implement WP Remote bootstrap and discovery adapter**
  - Handles connection-key bootstrap, runtime credential persistence, callback signing, validation, and bridge-managed site registration.
  - Keeps secrets and signing server-side.

- [x] **P5-3 | studio | Wire WP Remote through provider IPC and discovery flow**
  - Validates site listing.
  - Intentionally blocks pull start/poll/download in this phase.

- [x] **P5-4 | studio | Add tests for WP Remote renderer and IPC behavior**
  - Added targeted provider, bridge-client, and bridge-side contract coverage.
  - Existing `use-add-site` / add-site harness failures remain pre-existing repo issues outside the Phase 5 files.

- [x] **P5-5 | validation | Run end-to-end WP Remote manual verification**
  - Confirmed chooser order.
  - Confirmed bridge bootstrap and account validation.
  - Confirmed discovered-site listing in Studio.
  - Confirmed discovery-only gating remains in place.

## Phase 6 - WP Remote export support

### Goal

Implement real bridge-side WP Remote backup/export support for **compatible hosts** while keeping Studio pull disabled until artifact correctness and runtime compatibility are both proven.

### Exit criteria

Detailed bridge implementation notes for this phase live in `studio-hetzner-bridge/docs/wpremote-export-support-plan.md`.

- The bridge can create a durable WP Remote backup record.
- Backup inventory is visible for validated WP Remote sites.
- The bridge can export a downloadable Studio-compatible artifact.
- Studio can manually import that artifact through the existing import path.
- Known-incompatible runtimes can be kept discovery-only before Studio pull is enabled.

### Tasks

- [x] **P6-1 | studio-hetzner-bridge | Add WP Remote export rollout/config gates**
  - Added `WPREMOTE_EXPORT_ENABLED`.
  - Projects `backupCreate: true` / `backupsRead: true` while keeping `pull: false`.
  - Export route no longer depends on `site.capabilities.pull`.

- [x] **P6-2 | studio-hetzner-bridge | Extend WP Remote transport with streamed response support**
  - Parses framed stream responses.
  - Validates checksums.
  - Preserves the final terminal envelope.

- [x] **P6-3 | studio-hetzner-bridge | Add staged snapshot assembly for WP Remote backup jobs**
  - Builds `database.sql` from DB wing responses.
  - Reconstructs `wp-content` locally from FS wing responses.
  - Writes snapshot metadata under the backup directory.

- [x] **P6-4 | studio-hetzner-bridge | Replace the WP Remote unsupported executor with real backup/export execution**
  - `runBackup()` creates the staged snapshot and manifest metadata.
  - `runExport()` packages the staged snapshot into the standard Studio artifact.
  - `runImport()` and `runRestore()` remain unsupported.

- [x] **P6-5 | studio-hetzner-bridge | Add bridge tests for WP Remote backup/export**
  - Covers transport stream parsing.
  - Covers staged snapshot creation and cleanup.
  - Covers export artifact creation.
  - Covers route/capability behavior with `pull: false`.

- [-] **P6-6 | validation | Run real-site WP Remote export verification**
  - Live reruns against the patched Avenue941 fixture now reach:
    - DB completion,
    - full FS inventory,
    - active file download and local snapshot growth.
  - Remaining gates:
    - backup completion,
    - backup inventory visibility,
    - export artifact generation,
    - manual Studio import.

- [ ] **P6-7 | studio-hetzner-bridge | Add WP Remote runtime compatibility canary and capability downgrade**
  - Detect sites where WP Remote validation succeeds but filesystem export does not.
  - Keep those sites discovery-only with a concrete unsupported reason.
  - Do not advertise backup/export for known-incompatible runtimes such as unpatched Flywheel WP Remote.

## Phase 7 - WP Remote pull activation for compatible hosts

### Goal

Enable WP Remote pull in Studio only for sites that pass both export verification and runtime compatibility checks.

### Exit criteria

- A compatibility-validated WP Remote site becomes pullable in Studio.
- The produced artifact is proven importable through the existing Studio pipeline.
- Unsupported WP Remote runtimes remain discovery-only with actionable messaging.

### Tasks

- [ ] **P7-1 | studio-hetzner-bridge | Project pull capability only for compatibility-validated WP Remote sites**
  - Keep export-capable-but-incompatible sites non-pullable.

- [ ] **P7-2 | studio | Relax the current WP Remote guard for validated sites only**
  - Preserve discovery-only behavior for incompatible runtimes.

- [ ] **P7-3 | validation | Confirm end-to-end Studio pull/import on a compatible WP Remote fixture**
  - Select site in Studio.
  - Complete pull.
  - Confirm local site boots.

## Phase 8 - Flywheel native support

### Goal

Deliver a Flywheel-native path that works whether or not WP Remote is installed, and prefer it for Flywheel-hosted sites when both providers can see the same site.

### Exit criteria

- Flywheel auth/account connection is defined.
- Flywheel site inventory is available in Studio.
- A Flywheel-hosted site can be exported/pulled through a native Flywheel path.
- Studio has a provider-preference rule for Flywheel-vs-WP Remote overlap.

### Tasks

- [ ] **P8-1 | research | Inspect Local app artifacts in `Contents` for Flywheel connected-account clues**
  - Focus on user-facing account states and likely product expectations.
  - Treat this as directional, not as a substitute for real API discovery.

- [ ] **P8-2 | research | Investigate Flywheel auth, site inventory, and export options**
  - Use the available Flywheel environment and approved access paths.
  - Record whether a native bridge-backed implementation is viable.

- [ ] **P8-3 | planning | Define host-aware provider preference and duplicate-site policy**
  - Prefer Flywheel-native over WP Remote for Flywheel-hosted sites.
  - Define how the same canonical site is represented when multiple providers can discover it.

- [ ] **P8-4 | implementation | Build the Flywheel-native bridge/account path if viable**
  - Add provider-specific account validation and site listing.
  - Add export/pull orchestration.

- [ ] **P8-5 | studio | Wire Flywheel-native UX and pull flow**
  - Keep chooser semantics honest.
  - Route Flywheel-hosted sites through the native provider when applicable.

## Phase 9 - WP Engine discovery and support decision

### Goal

Determine whether WP Engine can support the same Studio workflow reliably and sequence it after Flywheel.

### Exit criteria

WP Engine ends in one of two states:

- approved for implementation with a concrete contract, or
- explicitly deferred with rationale.

### Tasks

- [ ] **P9-1 | research | Investigate WP Engine auth, site inventory, and export options**
  - Identify likely account/login and site-selection patterns.
  - Record contract feasibility and open questions.

- [ ] **P9-2 | planning | Decide WP Engine implementation priority after Flywheel**
  - Confirm whether it follows the same bridge model.
  - Confirm whether Studio UX should mirror Flywheel-native behavior.

## Phase 10 - Hardening and rollout support

### Goal

Prepare the app and supporting docs for stable testing, rollout, and ongoing maintenance of the provider-expansion work.

### Exit criteria

- The app boots locally with the new provider chooser.
- Validation steps are documented and repeatable.
- Rollout and operational assumptions are updated for the new provider strategy.

### Tasks

- [ ] **P10-1 | studio | Normalize provider error codes and user-facing messages**
  - Ensure similar failures render consistently across MainWP and WP Remote.

- [ ] **P10-2 | studio | Add provider rollout flags if needed**
  - Use flags for newly shipped providers, not for already-stable MainWP behavior.

- [ ] **P10-3 | studio-hetzner-bridge | Add provider-tagged audit and telemetry fields**
  - Improve debugging for multi-provider behavior.

- [ ] **P10-4 | validation | Run required repo verification on implementation branches**
  - `npx eslint --fix <modified files>`
  - `npm run typecheck`
  - `npm test -- <relevant test path>`
  - `npm start`

- [ ] **P10-5 | docs | Update cross-repo runbooks as implementation lands**
  - `studio`
  - `studio-hetzner-bridge`
  - `platform-infra`

## Notes and decisions log

### Assumptions currently in force

- “WP Remove” means **WP Remote**.
- `mainwpBridge` stays as the stored provider identity for compatibility.
- The existing bridge remains the single provider-bridge surface.
- WP Remote is the preferred provider for compatible non-WP.com hosts.
- Flywheel requires a native support track regardless of WP Remote because unpatched Flywheel WP Remote filesystem export is not reliable.
- WP Engine remains discovery-gated until a real contract is confirmed.
- Packaging and Cloudflare R2 release-artifact work are follow-on operational concerns, not core provider-expansion scope.

### To record as work progresses

- Decision date for WP Remote compatible-host rollout:
- Decision date for Flywheel native implementation viability:
- Decision date for WP Engine implementation viability:
- Decision date for bridge renaming, if ever approved:
