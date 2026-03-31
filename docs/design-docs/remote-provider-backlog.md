# Remote Provider Expansion Backlog

## About this doc

This backlog tracks the work required to ship the remote-provider expansion roadmap described in:

- `remote-provider-expansion-prd.md`
- `remote-provider-architecture-and-phases.md`

- **Status:** In progress
- **Last updated:** 2026-03-31

## Tracking conventions

- Use `[ ]` for not started.
- Use `[-]` for in progress.
- Use `[x]` for completed.
- Keep implementation notes under the relevant task instead of adding separate scratch docs when possible.
- Do not store secrets, tokens, or credential values in this file.

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

- [ ] **P4-2 | research | Validate WP Remote assumptions against available fixtures**
  - Use the available WP Remote codebases and approved test environments.
  - Capture implementation constraints without storing secrets.
  - Remaining gate: prove pairing bootstrap, signed callback reads, DB access, filesystem access, and artifact-assembly feasibility against at least one real WP Remote-managed site.

- [x] **P4-3 | studio-hetzner-bridge | Draft WP Remote bridge adapter contract**
  - Map WP Remote onto the existing site/job/artifact lifecycle if possible.
  - Document any contract gaps.

- [x] **P4-4 | studio | Draft WP Remote selector UX requirements**
  - Define account copy.
  - Define empty states.
  - Define failure states.

- [-] **P4-5 | planning | Record go/no-go decision**
  - If go: convert findings into implementation tasks.
  - If no-go: document why and update the roadmap.
  - Current decision: go for docs plus non-activating bridge scaffolding; do not start Phase 5 runtime activation until `P4-2` succeeds.

## Phase 5 - WP Remote implementation

### Goal

Ship WP Remote as the top actionable provider in Studio.

### Exit criteria

- Users can validate access, list sites, select a site, and pull it into Studio.
- MainWP still works.
- Provider-specific errors are normalized.

### Tasks

- [ ] **P5-1 | studio | Add WP Remote provider selector container**
  - Reuse shared bridge account UI only if discovery confirms compatible inputs.
  - Otherwise implement a WP Remote-specific account entry flow on the same provider-selection surface.
  - Render WP Remote-specific copy and validation states.

- [ ] **P5-2 | studio-hetzner-bridge | Implement WP Remote adapter**
  - Handle pairing/lookup/export.
  - Keep secrets and signing server-side.

- [ ] **P5-3 | studio | Wire WP Remote through provider IPC and pull flow**
  - Validate site listing.
  - Validate pull start/poll/download.
  - Confirm import handoff.

- [ ] **P5-4 | studio | Add tests for WP Remote renderer and IPC behavior**
  - Cover account state.
  - Cover inventory states.
  - Cover failure states where practical.

- [ ] **P5-5 | validation | Run end-to-end WP Remote manual verification**
  - Confirm chooser order.
  - Confirm account validation.
  - Confirm pull completion.

## Phase 6 - Flywheel and WP Engine discovery

### Goal

Determine whether Flywheel and WP Engine can support the same Studio workflow reliably.

### Exit criteria

Each provider ends with either an approved implementation contract or a documented deferral decision.

### Tasks

- [ ] **P6-1 | research | Inspect Local app artifacts in `Contents` for connected-account clues**
  - Focus on user-facing account states and likely product expectations.
  - Treat this as directional, not as a substitute for real API discovery.

- [ ] **P6-2 | research | Investigate Flywheel auth, site inventory, and export options**
  - Use the available Flywheel environment and approved access paths.
  - Record whether a bridge-backed implementation is viable.

- [ ] **P6-3 | research | Investigate WP Engine auth, site inventory, and export options**
  - Identify likely account/login and site-selection patterns.
  - Record contract feasibility and open questions.

- [ ] **P6-4 | planning | Decide discovery-provider UI policy**
  - Keep visible as coming soon,
  - hide behind flags,
  - or defer completely until real support exists.

## Phase 7 - Hardening and rollout support

### Goal

Prepare the app and supporting docs for stable testing, rollout, and ongoing maintenance of the provider-expansion work.

### Exit criteria

- The app boots locally with the new provider chooser.
- Validation steps are documented and repeatable.
- Rollout and operational assumptions are updated for the new provider strategy.

### Tasks

- [ ] **P7-1 | studio | Normalize provider error codes and user-facing messages**
  - Ensure similar failures render consistently across MainWP and WP Remote.

- [ ] **P7-2 | studio | Add provider rollout flags if needed**
  - Use flags for newly shipped providers, not for already-stable MainWP behavior.

- [ ] **P7-3 | studio-hetzner-bridge | Add provider-tagged audit and telemetry fields**
  - Improve debugging for multi-provider behavior.

- [ ] **P7-4 | validation | Run required repo verification on implementation branches**
  - `npx eslint --fix <modified files>`
  - `npm run typecheck`
  - `npm test -- <relevant test path>`
  - `npm start`

- [ ] **P7-5 | docs | Update cross-repo runbooks as implementation lands**
  - `studio`
  - `studio-hetzner-bridge`
  - `platform-infra`

## Notes and decisions log

### Assumptions currently in force

- “WP Remove” means **WP Remote**.
- `mainwpBridge` stays as the stored provider identity for compatibility.
- The existing bridge remains the single provider-bridge surface.
- Flywheel and WP Engine are discovery-gated until a real contract is confirmed.
- Packaging and Cloudflare R2 release-artifact work are follow-on operational concerns, not core provider-expansion scope.

### To record as work progresses

- Decision date for WP Remote go/no-go:
- Decision date for Flywheel implementation viability:
- Decision date for WP Engine implementation viability:
- Decision date for bridge renaming, if ever approved:
