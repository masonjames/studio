# Remote Provider Expansion PRD

## About this doc

This product requirements document defines the next phase of remote-hosting integrations for our WordPress Studio fork.

- **Status:** Draft
- **Last updated:** 2026-03-31
- **Primary repo:** `studio`
- **Related repos:** `studio-hetzner-bridge`, `platform-infra`, `wpremote`, `mainwp`, `mainwp-hetzner-backup`

## Decision summary

This phase expands the **Choose a hosting provider** flow in Studio so the app presents the provider lineup we actually intend to support next.

The working product decisions are:

- Make **WP Remote** the top provider choice and the primary new integration target.
- Keep **MainWP** available as the current regression baseline and fallback bridge-backed provider.
- Remove **Hetzner** and **DigitalOcean** from the provider picker.
- Replace them with **Flywheel** and **WP Engine**.
- Standardize on **one bridge surface** for remote-provider orchestration by extending the existing `studio-hetzner-bridge` contract instead of creating a second remote bridge.
- Keep the existing repo and deployment name for now to reduce operational churn; defer naming cleanup until after a second provider is live.

## Context

The current Studio fork already has a provider-selection flow, but only one provider is truly actionable.

Relevant code paths today:

- Provider picker UI: `apps/studio/src/modules/add-site/components/select-remote-provider.tsx`
- Provider pull screen: `apps/studio/src/modules/add-site/components/pull-provider-remote-site.tsx`
- Add-site flow orchestration: `apps/studio/src/modules/add-site/index.tsx`
- Provider registry: `apps/studio/src/modules/sync/providers/registry.ts`
- Provider account/site/pull IPC: `apps/studio/src/modules/sync/providers/ipc-handlers.ts`
- Current bridge-backed provider UI/client: `apps/studio/src/modules/sync/providers/mainwp-bridge/*`
- Pull orchestration: `apps/studio/src/stores/sync/sync-operations-slice.ts`

Current platform reality:

- **MainWP** is the only external provider with a working Studio-side flow today.
- The existing bridge service in `studio-hetzner-bridge` already provides reusable patterns for auth, inventory, jobs, artifacts, and capability checks.
- The local `wpremote` codebase suggests a **signed callback + connection-key** model rather than a simple OAuth flow.
- The bundled `Contents` directory from Local confirms the Flywheel/WP Engine ecosystem relationship, but it does **not** yet prove a Studio-ready auth or site-list contract.

## Problem statement

Our Studio fork needs a more useful external-provider story than the current partially implemented placeholder lineup.

Today:

- The provider picker shows options that do not match the next planned roadmap.
- The renderer, IPC, and sync models are narrow and effectively hard-coded around `mainwpBridge`.
- WP Remote, Flywheel, and WP Engine cannot be added cleanly without generalizing the provider model and deciding how the shared bridge should evolve.
- The app is not yet documented well enough to coordinate product, app, bridge, and infrastructure work across repositories.

## Product goals

### Primary goals

1. Show the correct provider lineup in Studio: **WP Remote**, **MainWP**, **Flywheel**, **WP Engine**.
2. Make **WP Remote** the highest-priority integration and the most reliable non-WP.com provider path.
3. Preserve **MainWP** support during the refactor and use it as the regression baseline.
4. Define a clear architecture for adding more providers without coupling the desktop app to provider-specific backend logic.
5. Prepare the app for local testing and phased implementation across the app, bridge, and infrastructure repos.

### Secondary goals

- Reduce future upstream-merge friction by containing this work to existing provider seams.
- Keep account management, site selection, and pull behavior consistent across bridge-backed providers.
- Make the roadmap explicit enough for phased implementation across `studio`, `studio-hetzner-bridge`, and `platform-infra`.

## Non-goals

This phase does **not** include:

- A redesign of WP.com auth, deeplink, or account management flows.
- Selective sync or push support for new external providers.
- Renaming the `studio-hetzner-bridge` repository or infrastructure on day one.
- Editing WordPress core inside local site directories.
- Committing to Flywheel or WP Engine implementation before discovery confirms a viable auth + inventory + export path.

## Users and jobs to be done

### Local WordPress developer

- Wants to authenticate against a hosting/control platform.
- Wants to see available remote sites.
- Wants to pull a site into Studio with minimal setup.
- Needs predictable errors when auth, inventory, or export fails.

### Agency or platform operator

- Wants one stable bridge pattern for multiple providers.
- Wants MainWP to keep working while new providers are added.
- Wants operational clarity for deployment, secrets, and debugging.

## User journeys

### 1. Pull a site from WP Remote

> Target-state Phase 5 journey. Current builds still discovery-gate WP Remote until live callback validation is complete.

1. User opens **Add site** and chooses **Pull from hosting provider**.
2. Studio shows WP Remote first in the provider picker.
3. User chooses WP Remote and connects to a shared provider bridge account.
4. Studio validates the bridge account against the shared bridge contract.
5. User sees WP Remote sites that have already been paired and registered on that bridge.
6. User selects a site, creates the local site, and Studio performs the remote export + import pipeline.
7. The local site is created and ready to run in Studio.

### 2. Continue pulling from MainWP

1. User chooses MainWP.
2. Existing bridge-backed account and site selection behavior still works.
3. Studio uses the generalized provider flow without breaking current MainWP expectations.

### 3. Discover Flywheel and WP Engine

1. User sees Flywheel and WP Engine in the provider picker instead of Hetzner and DigitalOcean.
2. If discovery is incomplete, Studio shows them as planned or gated providers with clear messaging.
3. Once supported, user can authenticate, browse sites, and pull into Studio using the same overall flow.

## Functional requirements

### Provider picker and ordering

- Studio must replace the current placeholder provider lineup with:
  1. **WP Remote**
  2. **MainWP**
  3. **Flywheel**
  4. **WP Engine**
- WP Remote must appear first and be visually framed as the primary new integration.
- Hetzner and DigitalOcean must no longer appear on the chooser page.

### Provider availability states

- The provider picker must support at least these states:
  - **Available**
  - **Discovery / Coming soon**
  - **Disabled / Unsupported**
- Providers that are not yet ready must not route the user into broken account or site selection flows.

### Account management

- Bridge-backed providers must use a shared account-validation pattern where possible.
- The app must preserve existing `mainwpBridge` persisted accounts for backward compatibility.
- The app must support additive provider-specific metadata without breaking old local data.
- Phase 4 discovery resolves the initial WP Remote account model to the same shared bridge URL/token entry flow already used for bridge-backed providers.
- WP Remote connection keys, callback signing keys, and runtime secrets must remain bridge-owned and must not be stored in Studio appdata.

### Site inventory and pull

- For actionable providers, users must be able to:
  - authenticate or configure access,
  - list eligible remote sites,
  - choose a site,
  - trigger a pull that imports into the existing Studio site-import pipeline.
- The initial generalized pull model remains **full-site archive import**.
- The app must surface provider, site-inventory, export, and download failures before or during pull with clear messages.

### Bridge strategy

- Studio must prefer a single remote-provider bridge contract instead of bespoke provider orchestration inside Electron.
- The bridge must be capable of advertising provider support and capability support to the app.
- Provider-specific secrets and request signing that do not belong on the client should live on the bridge side.

### Flywheel and WP Engine target requirement

The intended end state is that Flywheel and WP Engine users can:

- log in or connect their accounts,
- browse available sites,
- select a site,
- pull it into Studio.

Because we do not yet have a confirmed contract from the local evidence available in this planning pass, this requirement is gated by discovery and may need a staged rollout.

## UX requirements

- The chooser page must clearly communicate which providers are ready now and which are still being verified.
- Provider-specific errors should be normalized into friendly product language.
- MainWP and WP Remote should feel like part of one coherent Studio flow even if the bridge adapters differ.
- Flywheel and WP Engine should not be misleadingly interactive before they are actually supported.
- The initial WP Remote empty state should clearly say that no WP Remote sites are paired on the selected bridge yet when inventory is empty.

## Technical requirements and constraints

### In-scope Studio seams

The implementation should primarily work through these existing seams:

- `apps/studio/src/modules/add-site/*`
- `apps/studio/src/modules/sync/providers/*`
- `apps/studio/src/stores/sync/*`
- `apps/studio/src/preload.ts`
- `apps/studio/src/ipc-handlers.ts`
- `apps/studio/src/ipc-types.d.ts`

### Constraints

- All main-process IPC handlers must remain async and Promise-based.
- Main-process changes require a full Electron restart during local development.
- Provider account persistence must remain compatible with current appdata.
- The bridge contract must evolve additively so existing MainWP consumers do not break.
- Post-change verification should follow the existing repo contribution guidance in `docs/code-contributions.md`:
  - lint only modified files,
  - run `npm run typecheck`,
  - run relevant tests.

## Success criteria

### Product success

- Studio loads with the new provider lineup visible on the chooser page.
- WP Remote is documented and prioritized as the next reliable external-provider integration.
- MainWP remains the regression baseline and is not regressed by provider-model changes.
- Flywheel and WP Engine are represented accurately in the roadmap and UI strategy.

### Engineering success

- We have one approved architecture for provider expansion across app + bridge.
- We have a clear phased plan and backlog for cross-repo implementation.
- The app remains locally testable with `npm start`.
- The cross-repo implementation path is explicit enough to sequence app, bridge, and infrastructure work safely.

## Risks

- WP Remote may require bridge-side capabilities that are not yet implemented.
- Flywheel and WP Engine may not expose practical auth or export contracts for this workflow.
- Generalizing the current bridge inventory model could regress current MainWP integrations if done carelessly.
- New provider IDs could create backward-compatibility issues if rollout is not staged.

## Open questions

- Which exact callback envelope and signing bootstrap details must be proven against a real WP Remote-managed site before Phase 5 starts?
- Can Flywheel and WP Engine provide account login, site inventory, and export in a way Studio can support reliably?
- Should discovery-only providers be visible by default or feature-flagged until their contracts are proven?
- When should the bridge be renamed from `studio-hetzner-bridge` to a provider-neutral identity?

## Milestone framing

### Milestone A

- New chooser lineup lands in Studio.
- MainWP remains working.
- Shared provider-bridge strategy is approved.
- WP Remote contract discovery is completed.

### Milestone B

- WP Remote becomes fully actionable through the shared bridge.
- Flywheel and WP Engine discovery concludes with either implementation approval or explicit deferral.

### Milestone C

- The provider-expansion work is hardened with clear rollout, validation, and operational documentation.

## Operational follow-on note

Future packaging and distribution work, including any Cloudflare R2-backed release-artifact publishing, should be treated as a separate operational stream after provider functionality is validated locally and the bridge/provider contracts are stable.

## References

- `studio/docs/design-docs/sync.md`
- `studio/apps/studio/src/modules/add-site/components/select-remote-provider.tsx`
- `studio/apps/studio/src/modules/sync/providers/registry.ts`
- `studio/apps/studio/src/modules/sync/providers/ipc-handlers.ts`
- `studio/apps/studio/src/stores/sync/sync-operations-slice.ts`
- `studio-hetzner-bridge/src/app.ts`
- `platform-infra/docs/services/studio-hetzner-bridge.md`
- `wpremote/callback/request.php`
