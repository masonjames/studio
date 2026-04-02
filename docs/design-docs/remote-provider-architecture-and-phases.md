# Remote Provider Architecture and Phased Implementation Plan

## About this doc

This document translates the remote-provider product direction into an implementation strategy across the Studio app, the shared bridge, and supporting infrastructure.

- **Status:** In progress
- **Last updated:** 2026-04-01
- **Primary repo:** `studio`
- **Companion docs:** `remote-provider-expansion-prd.md`, `remote-provider-backlog.md`

## Scope of this plan

This plan covers:

- the Studio provider picker and add-site flow,
- the external-provider account and site-selection path,
- the shared bridge strategy for MainWP and WP Remote,
- discovery work for Flywheel and WP Engine,
- hardening and rollout support for the provider-expansion stream.

This plan does **not** redesign WP.com auth or the existing WP.com sync flow.

## Progress update - 2026-04-01

The provider-expansion work is no longer purely architectural.

Completed and validated:

- chooser/provider-model generalization in Studio,
- shared bridge-backed provider plumbing in Studio,
- provider-aware bridge contract generalization,
- WP Remote bridge bootstrap and discovery against a real Flywheel-hosted Avenue941 test site,
- Studio-side WP Remote account save and discovered-site listing in discovery-only mode,
- bridge-side WP Remote backup/export and compatibility gating on a compatible host,
- successful manual Studio import of the real WP Remote export artifact.

Phase 6 is now complete for compatible-host export support. The remaining WP Remote work moves to Phase 7 pull activation, while a separate Flywheel-native track is planned for Flywheel-hosted sites that cannot rely on unpatched WP Remote filesystem export.

## Current architecture

### Current Studio call chain

The current provider pull path is:

1. `apps/studio/src/modules/add-site/components/options.tsx`
2. `apps/studio/src/modules/add-site/index.tsx`
3. `apps/studio/src/modules/add-site/components/select-remote-provider.tsx`
4. `apps/studio/src/modules/add-site/components/pull-provider-remote-site.tsx`
5. `apps/studio/src/modules/sync/providers/bridge/site-selector.tsx`
6. `apps/studio/src/hooks/use-add-site.ts` (`handleCreateSite()` plus `connectSite` handoff)
7. `apps/studio/src/stores/sync/connected-sites.ts`
8. `apps/studio/src/stores/sync/sync-operations-slice.ts`
9. `apps/studio/src/preload.ts`
10. `apps/studio/src/modules/sync/providers/ipc-handlers.ts`
11. `apps/studio/src/modules/sync/providers/bridge/client.ts`
12. bridge HTTP endpoints implemented in `studio-hetzner-bridge/src/app.ts`
13. existing site import pipeline

### Current implementation reality

- `registry.ts` now models the shipped provider lineup: `wpRemote`, `mainwpBridge`, `flywheel`, and `wpEngine`.
- provider selection is routed through shared bridge-backed plumbing rather than a MainWP-only client path.
- `modules/sync/types.ts`, the bridge client, and provider IPC now handle bridge-backed providers additively while preserving MainWP compatibility.
- the bridge repo name remains Hetzner-specific, but the HTTP contract and provider metadata are now provider-aware.
- WP Remote still requires bridge-side handling because its plugin contract depends on connection-key bootstrap, signed callbacks, and server-side secret custody.

## Key architectural decisions

### 1. Keep one provider-bridge surface

We will extend the existing bridge contract instead of building a separate WP Remote-specific bridge.

Why:

- The current bridge already owns auth, capabilities, jobs, artifacts, and execution seams.
- MainWP already depends on this pattern.
- A second bridge would duplicate job, secret, polling, and operational logic.

### 2. Preserve `mainwpBridge` persisted identity for compatibility

Even if we rename folders or shared modules internally, we should keep the stored provider identity as `mainwpBridge` until a dedicated migration is justified.

Why:

- Existing appdata and connected-site state should keep working.
- This reduces rollback and release risk.

### 3. Treat WP Remote as a bridge-backed provider

Studio should not own private-key custody or signed callback composition for WP Remote in the Electron client.

Why:

- The local `wpremote` codebase suggests a signed request model.
- Bridge-side execution is safer and easier to standardize.

### 4. Split Flywheel from WP Engine in the roadmap

The product goal remains full support for both, but the engineering posture is now different:

- **Flywheel** needs a native support track because unpatched Flywheel WP Remote filesystem export is not reliable.
- **WP Engine** remains discovery-gated until a viable contract is proven.

## Target Studio architecture

### Provider lineup

The chooser should support this order:

1. `wpRemote`
2. `mainwpBridge`
3. `flywheel`
4. `wpEngine`

Before Phase 7 implementation landed:

- `mainwpBridge` was the only `available` provider,
- `wpRemote` remained `discovery` until Phase 7 pull activation,
- `flywheel` and `wpEngine` remained discovery entries.

Current code state as of 2026-04-02:

- `mainwpBridge` remains `available`,
- `wpRemote` is now `available` in the top-level picker,
- only compatibility-validated WP Remote sites are pullable,
- incompatible or rollout-disabled WP Remote sites stay visible but unsupported with a concrete disabled reason,
- `flywheel` and `wpEngine` remain discovery entries.

### Provider availability model

The provider registry should move from a simple available flag to an availability model such as:

- `available`
- `discovery`
- `disabled`

This lets the same chooser render:

- real providers,
- discovery entries,
- temporarily disabled providers.

That discovery-only picker state was the correct Phase 6 posture. As of 2026-04-02, the Phase 7 code path now makes WP Remote selectable in the top-level picker while keeping pull site-gated to compatibility-validated registrations.

### Provider definition shape

The provider registry should become the single source of truth for:

- label and description,
- provider order,
- availability state,
- pull transport,
- which selector UI to render.

An illustrative direction:

```ts
type ProviderAvailability = 'available' | 'discovery' | 'disabled';

type RemoteProviderDefinition = {
  id: RemoteProvider;
  label: string;
  description: string;
  availability: ProviderAvailability;
  pullTransport: 'bridge' | 'wpcom';
  selectorKind: 'mainwp' | 'wpremote' | 'discovery';
};
```

### Account model

The remote provider account model should be widened without breaking old stored accounts.

Principles:

- keep `mainwpBridge` readable,
- add provider metadata additively,
- keep account validation inside provider IPC,
- reuse shared bridge-backed account fields only where discovery proves the provider can support them.

Likely account concerns for providers that fit the current bridge pattern:

- bridge URL,
- token mode,
- read token,
- mutate token,
- supported providers,
- validation timestamp.

WP Remote is explicitly not locked to that shape yet; Phase 4 discovery may require a different provider-specific account input model.

### Site selection model

`pull-provider-remote-site.tsx` should stop hard-coding MainWP and instead resolve a provider-specific selector from a small registry.

Expected behavior:

- MainWP uses shared bridge plumbing plus MainWP-specific copy.
- WP Remote uses shared bridge plumbing plus WP Remote-specific copy and validation.
- Flywheel and WP Engine use a discovery state until a real adapter exists.

### Pull operation model

The current remote pull operation should be generalized from “MainWP pull” to “bridge-backed pull.”

The important runtime concerns stay the same:

- start remote export/backup,
- poll for readiness,
- download artifact,
- hand off to the existing import pipeline,
- update progress and error state in Redux.

## Target bridge architecture

### What stays the same

The bridge should continue to own:

- auth and token scope checks,
- site inventory exposure,
- async job creation and polling,
- artifact generation and download,
- route-support and capability reporting.

### What changes

The bridge should evolve from “Hetzner-oriented inventory + execution” to “provider-aware adapters behind one contract.”

That means:

- site inventory records need provider identity,
- `/healthz` or equivalent capability responses need provider support metadata,
- execution should route by provider or adapter type,
- provider-specific secrets stay on the bridge.

### Provider adapters

The bridge should ultimately support an adapter pattern such as:

- `mainwpBridge` -> current bridge-backed flow
- `wpRemote` -> signed callback / connection-key flow
- `flywheel` -> native support track required
- `wpEngine` -> discovery result pending

We should avoid encoding provider-specific orchestration logic directly into Studio wherever the bridge can own it.

## Cross-repo impact

### `studio`

Primary implementation areas:

- `apps/studio/src/modules/add-site/*`
- `apps/studio/src/modules/sync/providers/*`
- `apps/studio/src/modules/sync/types.ts`
- `apps/studio/src/stores/sync/*`
- `apps/studio/src/preload.ts`
- `apps/studio/src/ipc-types.d.ts`
- `apps/studio/src/ipc-handlers.ts`

### `studio-hetzner-bridge`

Primary implementation areas:

- `src/app.ts`
- `src/site-inventory.ts`
- `src/execution.ts`
- `src/config.ts`
- `README.md`

### `platform-infra`

Primary documentation and rollout areas:

- `docs/services/studio-hetzner-bridge.md`
- `docs/plans/*`
- any deployment/runbook material tied to bridge rollout, access, and secrets

### Research inputs

- `wpremote/*` for plugin pairing and callback contract discovery
- `Contents/*` for Flywheel/WP Engine ecosystem comparison and Local-app behavior
- existing MainWP environments as regression fixtures

## What should stay unchanged initially

These paths should remain out of scope for the first implementation tranche:

- `apps/studio/src/components/auth-provider.tsx`
- `apps/studio/src/hooks/use-auth.ts`
- `apps/studio/src/hooks/sync-sites/use-listen-deep-link-connection.ts`
- `apps/studio/src/modules/user-settings/components/account-tab.tsx`

Reason: they are WP.com-specific and do not need to change to deliver external-provider expansion.

## Phased delivery plan

## Phase 1 - Studio provider model generalization

### Objective

Make the chooser and type model capable of representing the planned provider lineup without yet committing to every provider implementation.

### Expected changes

- widen provider types in `modules/sync/types.ts`
- update `registry.ts`
- update chooser and provider-selection rendering
- replace Hetzner/DigitalOcean UI entries with WP Remote/Flywheel/WP Engine

### Exit criteria

- the chooser reflects the new lineup and order,
- MainWP still renders correctly,
- discovery providers do not lead users into broken screens.

## Phase 2 - Shared Studio bridge abstraction

### Objective

Move MainWP onto bridge-generic client, schema, and account-form plumbing so other compatible providers can reuse it and WP Remote can opt in only if discovery supports that shape.

### Expected changes

- extract shared bridge client and schema code from `mainwp-bridge/*`
- extract shared bridge-backed account form for providers that fit the current bridge credential model
- add a provider-client registry in provider IPC
- keep preload and IPC typings aligned

### Exit criteria

- MainWP still validates accounts, lists sites, and pulls successfully,
- provider-specific branching in Studio is limited to selector UI and copy.

## Phase 3 - Bridge contract generalization

### Objective

Make the bridge contract provider-aware without breaking MainWP.

### Expected changes

- add provider identity to public site payloads,
- add provider support metadata to bridge health or capability checks,
- generalize inventory and execution seams.

### Exit criteria

- Studio can validate whether a bridge supports a requested provider,
- current MainWP bridge behavior remains functional.

## Phase 4 - WP Remote discovery and contract definition

### Objective

Lock the exact bridge-owned contract needed for WP Remote without turning runtime support on yet.

### Phase 4 conclusions

This discovery pass resolves the core WP Remote shape:

- Studio should keep talking only to the shared bridge.
- WP Remote should be implemented as a **bridge-managed per-site callback adapter**.
- The shared bridge account form remains the initial Studio-side account model for WP Remote.
- The WP Remote plugin connection key should be treated as a **pairing seed**, not as a durable runtime credential.
- Runtime callback credentials, request signing, and provider secrets must stay on the bridge.
- The existing bridge job/artifact lifecycle should be reused:
  - `backup` creates a logical manifest,
  - `export` assembles the downloadable Studio import artifact.

### Pairing and auth model

The local plugin code indicates a signed callback protocol based on:

- `bvplugname=wpremote`,
- a bridge-owned `pubkey`,
- a bridge-owned shared secret used for request MAC validation,
- a `pubkeyname` whose matching private key must live on the bridge,
- timestamp/replay protection,
- callback wing dispatch.

The bridge must therefore own:

- connection-key bootstrap,
- runtime account creation or update,
- callback request signing,
- secret storage,
- replay-safe request dispatch.

### Inventory model

The local plugin code does not prove a cloud-side multi-site listing API. The safe model is:

- the bridge maintains WP Remote site registrations,
- `/v1/sites` exposes those bridge-managed registrations,
- provider identity must be explicit as `wpRemote`,
- canonical site identity is derived from callback data such as `siteurl`, `homeurl`, `wpurl`, `abspath`, `dbsig`, and `serversig`.

### Export model

The local code exposes callback primitives for:

- site/system metadata,
- database reads,
- filesystem reads,
- streamed responses,
- account updates.

It does not expose one obvious single-call archive export. The bridge should therefore treat WP Remote export as an orchestration problem behind the existing bridge routes.

### Safe implementation scope for this phase

Phase 4 may ship:

- architecture and backlog updates,
- a dedicated WP Remote adapter contract doc in the bridge repo,
- internal non-activating bridge scaffolding for provider dispatch.

Phase 4 must not ship:

- `wpRemote` activation in `/healthz`,
- Studio runtime client activation,
- live bridge inventory for WP Remote,
- claims of support before real callback validation succeeds.

### Exit criteria

- a bridge-mediated contract is documented,
- Studio-side UX expectations are defined,
- internal bridge seams are ready for a future WP Remote adapter,
- a conditional go/no-go decision exists for Phase 5.

## Phase 5 - WP Remote bootstrap and discovery implementation

### Objective

Ship the first real WP Remote runtime slice:

- bridge-owned bootstrap,
- bridge-owned validation,
- provider-aware site registration,
- Studio account save and site discovery,
- explicit discovery-only gating so pull cannot start yet.

### Delivered changes

- shared WP Remote selector UI on top of shared bridge-backed account plumbing,
- bridge-side connection-key bootstrap and runtime credential persistence,
- bridge-side callback signing and validation transport,
- bridge-side validated site registration and `/v1/sites` exposure,
- Studio runtime guards that kept WP Remote non-pullable in Phase 5,
- shipped picker gating that kept WP Remote discovery-only through Phase 6,
- manual verification against a real Flywheel-hosted Avenue941 WP Remote site.

### Exit criteria

- internal validation can save a WP Remote bridge account,
- the bridge can bootstrap and validate at least one real WP Remote site,
- `/healthz.providerSupport.wpRemote` turns on when validated sites exist,
- Studio lists the discovered site in validation paths but keeps the shipped top-level picker discovery-only,
- MainWP regression coverage remains intact.

## Phase 6 - WP Remote export support

### Objective

Add real bridge-side WP Remote backup/export support for **compatible hosts** without yet enabling Studio pull.

### Scope

This phase remains **bridge-first**:

- implement a real WP Remote `runBackup()` path,
- implement a real WP Remote `runExport()` path,
- expose backup inventory for validated WP Remote sites,
- keep Studio-side `pull` disabled and the shipped top-level picker discovery-only through Phase 6, then activate pull deliberately in Phase 7 only for compatibility-validated sites.

### Design summary

Detailed bridge implementation notes for this phase live in `studio-hetzner-bridge/docs/wpremote-export-support-plan.md`.

The bridge preserves its existing semantics:

- `POST /v1/sites/:siteId/backup` creates a durable bridge-owned backup record,
- `POST /v1/sites/:siteId/backups/:backupId/export` turns that record into the standard downloadable Studio artifact.

For WP Remote, that means:

- `runBackup()` creates a **bridge-owned staged snapshot** under the backup directory,
- `runExport()` packages that staged snapshot into the normal tar.gz artifact,
- in Phase 6, rollout-enabled, compatibility-validated WP Remote sites advertised:
  - `backupCreate: true`
  - `backupsRead: true`
  - `pull: false`
- as of 2026-04-02, Phase 7 code now projects `pull: true` for those same compatibility-validated sites and keeps incompatible sites non-pullable.

### Compatibility finding - 2026-04-01

The real Avenue941 Flywheel fixture has now shown two different truths:

- on a **patched** WP Remote plugin, bridge-side DB export, FS inventory, and active file download work,
- on an **unpatched** Flywheel WP Remote plugin, filesystem export cannot be treated as reliable due an upstream FS-wing bug.

This means Phase 6 should complete WP Remote export for **compatible hosts**, but it must not treat unpatched Flywheel WP Remote as generally supported.

Phase 6 is now complete for compatible-host WP Remote export support. The bridge-side rollout flag, route gating, stream parser, staged snapshot assembly, real executor, compatibility downgrade, and Studio-side import-path hardening are all implemented and live-validated.

### Implemented bridge changes

The current bridge code now includes:

- `WPREMOTE_EXPORT_ENABLED` rollout/config gating,
- streamed callback parsing in `src/providers/wpremote/transport.ts`,
- framed checksum-validating stream decoding in `src/providers/wpremote/stream-parser.ts`,
- staged SQL + `wp-content` snapshot assembly in `src/providers/wpremote/backup-session.ts`,
- SQL dump synthesis in `src/providers/wpremote/sql-dump.ts`,
- a real WP Remote executor in `src/providers/wpremote/executor.ts`,
- export route gating that no longer depends on `site.capabilities.pull`,
- a runtime compatibility canary so DB-valid / FS-invalid sites stay discovery-only,
- import/restore remaining unsupported.

### Completed validation milestones

The following were verified on 2026-04-01 against the compatible Avenue941 fixture:

1. backup job `c4263561-bbc1-4b2a-9a46-1397f7c9663d` wrote a staged snapshot and manifest,
2. backup inventory exposed that staged backup from the bridge,
3. export job `294cceb6-b4fd-4e04-8fb9-33e188c7564b` created a downloadable artifact,
4. the artifact extracted into the expected `sql/`, `wp-content/`, and `meta.json` layout,
5. Studio manually imported that artifact successfully through `JetpackImporter`,
6. deployed rollout posture was verified from live runtime and Dokploy evidence,
7. incompatible runtimes still remain discovery-only before pull activation.

### Remaining work after Phase 6

Phase 7 implementation is now in progress in repo code as of 2026-04-02:

- bridge-side pull capability projection is implemented for compatibility-validated sites,
- Studio now trusts per-site pullability instead of a provider-wide WP Remote block,
- the top-level picker now allows WP Remote selection while site-level gating remains intact.

The remaining work is operational validation:

- validate the end-to-end selectable Studio pull flow on a compatible fixture,
- confirm unsupported WP Remote runtimes still surface actionable messaging in real workflows,
- verify MainWP regression safety in the full shipped app flow.

### Out of scope

- universal WP Remote support on unpatched Flywheel runtimes,
- enabling Studio WP Remote pull before compatibility gating exists,
- WP Remote import support,
- WP Remote restore support,
- Flywheel/WP Engine account integration.

## Phase 7 - WP Remote compatibility gating and Studio pull activation

### Objective

Enable WP Remote pull in Studio only after the bridge export artifact has been validated and the site passes runtime compatibility checks.

### Implemented code changes as of 2026-04-02

- bridge-side compatibility signals now drive per-site `pull` capability for validated WP Remote sites,
- Studio no longer uses a provider-wide WP Remote pull block,
- export-capable-but-incompatible runtimes remain unsupported with concrete disabled reasons,
- the top-level picker now allows WP Remote selection while site-level gating decides whether pull can continue.

### Remaining validation work

- validate end-to-end add-site pull/import behavior on a compatible fixture.

### Exit criteria

- a user can select a compatibility-validated WP Remote site in Studio and complete a local pull/import flow,
- the generated artifact is proven compatible with Studio import,
- incompatible WP Remote runtimes remain non-pullable with actionable errors.

## Phase 8 - Flywheel native support

### Objective

Deliver a Flywheel-native path that works whether or not WP Remote is installed, and prefer it for Flywheel-hosted sites when both providers can see the same site.

### Research and implementation inputs

- Local app behavior under Connected accounts,
- any available Flywheel auth, site-list, and export mechanisms,
- hands-on testing against approved Flywheel environments,
- host-aware duplicate-site and provider-preference policy.

### Exit criteria

- Flywheel ends with a concrete native contract and implementation path,
- Studio can prefer Flywheel-native over WP Remote for Flywheel-hosted sites,
- Flywheel-hosted sites no longer depend on patched WP Remote behavior to be actionable.

## Phase 9 - WP Engine discovery and support decision

### Objective

Confirm whether WP Engine can support a reliable Studio workflow after the Flywheel-native track is defined.

### Exit criteria

WP Engine ends in one of two states:

- approved for implementation with a concrete contract, or
- explicitly deferred with rationale.

## Phase 10 - Hardening and rollout support

### Objective

Ensure the provider-expansion work is validated locally, instrumented well enough to debug, and documented clearly for rollout.

### Expected changes

- validate app startup and chooser behavior with `npm start`,
- run relevant lint, typecheck, and tests,
- add error, telemetry, and runbook follow-through required for rollout.

### Exit criteria

- the app boots locally,
- the new provider page is visible,
- provider rollout and operational documentation are documented and unblocked.

## Validation strategy

### Studio validation

For implementation phases, use the validation flow already documented in `docs/code-contributions.md` plus the repo-specific commands captured in our working instructions:

1. `npx eslint --fix <modified files>`
2. `npm run typecheck`
3. `npm test -- <relevant test path>`
4. `npm start` for local manual verification

### Bridge validation

- unit or contract tests for provider support and site payload changes,
- health/capability checks against real bridge deployments,
- additive rollout so MainWP remains available during transition.

### End-to-end validation fixtures

Use real environments where available, without storing secrets in docs:

- existing MainWP instance currently used with Studio,
- WP Remote fixture(s) available in RepoPrompt and approved installs,
- approved Flywheel fixture once identified and confirmed,
- any approved WP Engine test site once available.

## Risks and mitigations

### Risk: WP Remote cannot map cleanly onto the current bridge contract

**Mitigation:** make Phase 4 a hard discovery gate before full implementation.

### Risk: Flywheel or WP Engine support remains speculative

**Mitigation:** represent them honestly as discovery-driven until contracts are proven.

### Risk: provider generalization regresses MainWP

**Mitigation:** preserve persisted identities, keep route changes additive, and use MainWP as the regression baseline in every phase.

### Risk: bridge naming causes confusion

**Mitigation:** keep the deployment stable now, but document the bridge as the provider-bridge surface in all new planning material.

## Final recommended deliverables for this planning pass

This planning pass should land these files in `studio/docs/design-docs/`:

- `remote-provider-expansion-prd.md`
- `remote-provider-architecture-and-phases.md`
- `remote-provider-backlog.md`

Optional follow-on companion docs once implementation begins:

- `studio-hetzner-bridge/docs/provider-bridge-generalization-plan.md`
- `platform-infra/docs/plans/studio-provider-bridge-rollout.md`

Packaging and distribution follow-on work, including any Cloudflare R2-backed release-artifact stream, should stay separate from the core provider-expansion implementation plan until provider functionality is stable.
