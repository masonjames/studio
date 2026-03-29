# Fork Release Process

This document describes the release path for `masonjames/studio`.

The upstream `docs/release-process.md` flow depends on Automattic-only infrastructure:

- ReleasesV2 (`releases.a8c.com`)
- WordPress.com Apps CDN
- WordPress.com updater endpoint
- GlotPress import automation
- internal Git/CI helpers such as `use-bot-for-git`

The fork keeps the same **release branch + Fastlane + Buildkite** model, but replaces the entrypoint and artifact host.

## What is mirrored

The fork still uses the same release lanes and release branch flow:

- `code_freeze`
- `new_beta_release`
- `finalize_release`
- `publish_release`
- `new_hotfix_release`

The branch model stays the same:

- `trunk`
- `release/<version>`

## What is replaced

| Upstream piece                       | Fork replacement                                                      |
| ------------------------------------ | --------------------------------------------------------------------- |
| ReleasesV2 milestone buttons         | GitHub manual workflow + Buildkite `studio-release-dispatch` pipeline |
| WordPress.com Apps CDN               | Cloudflare R2                                                         |
| WordPress.com updater endpoint       | fork-owned update service backed by R2                                |
| mandatory signing/notarization in CI | env-gated; can be skipped until credentials exist                     |

## Current fork status

The repo now supports an initial unsigned/manual-install release flow.

### Supported now

- Build release branches with the existing Fastlane lanes
- Upload artifacts to Cloudflare R2
- Create draft/published GitHub releases that link to fork-hosted artifacts
- Disable auto-updates for forked packaged builds until a fork updater endpoint exists
- Run unsigned macOS/Windows release builds by setting `STUDIO_SKIP_SIGNING=true`

### Not complete until external infra is provisioned

- Apple Developer ID signing
- Apple notarization
- Windows code-signing certificate provisioning
- fork updater service endpoint
- Microsoft Store submission identity

## Required external services

### 1. GitHub

Repository settings / secrets:

- secret: `BUILDKITE_API_ACCESS_TOKEN`
  - Buildkite API token with `write_builds`
- variable: `BUILDKITE_RELEASE_PIPELINE`
  - recommended value: `mason-james/studio-release-dispatch`

The repo contains a manual workflow:

- `.github/workflows/release-dispatch.yml`

Use it as the replacement for the upstream ReleasesV2 button flow.

The bootstrap Buildkite pipeline files are:

- `.buildkite/bootstrap-ci.yml`
- `.buildkite/bootstrap-release-dispatch.yml`

### 2. Buildkite

Create **two** pipelines in the `mason-james` Buildkite org:

1. `studio`

   - repo: `masonjames/studio`
   - pipeline file: `.buildkite/bootstrap-ci.yml`
   - purpose: PR + trunk CI

2. `studio-release-dispatch`
   - repo: `masonjames/studio`
   - pipeline file: `.buildkite/bootstrap-release-dispatch.yml`
   - purpose: manual release entrypoint

You need Buildkite agents/queues compatible with the repo YAML:

- `mac`
- `windows`

### 3. Cloudflare R2

Provision:

- one R2 bucket for Studio release artifacts
- one public/custom domain in front of that bucket

Recommended env vars for Buildkite pipelines:

- `STUDIO_RELEASE_STORAGE=r2`
- `STUDIO_R2_BUCKET`
- `STUDIO_R2_ENDPOINT`
- `STUDIO_R2_ACCESS_KEY_ID`
- `STUDIO_R2_SECRET_ACCESS_KEY`
- `STUDIO_R2_PUBLIC_BASE_URL`

The release upload code writes immutable artifacts under:

- `studio/stable/<version>/...`
- `studio/beta/<version>/...`
- `studio/nightly/<version>/...`

It also writes per-platform rolling metadata under:

- `studio/<channel>/latest/darwin/x64/metadata.json`
- `studio/<channel>/latest/darwin/arm64/metadata.json`
- `studio/<channel>/latest/win32/x64/metadata.json`
- `studio/<channel>/latest/win32/arm64/metadata.json`

These `metadata.json` files are intended to be consumed by the fork updater endpoint.

### 4. Updater endpoint

The app no longer has to talk to WordPress.com, but it still needs a fork-owned update service.

Build-time config is written into `apps/studio/src/release-config.ts`.

Relevant env vars:

- `STUDIO_UPDATER_BASE_URL`
- `STUDIO_AUTO_UPDATES_ENABLED`

Current behavior:

- upstream/default builds keep using `https://public-api.wordpress.com/wpcom/v2/studio-app/updates`
- fork builds using `STUDIO_RELEASE_STORAGE=r2` will disable auto-updates unless `STUDIO_UPDATER_BASE_URL` is also set

Recommended next infra step:

- implement a small Cloudflare Worker in `platform-infra`
- have it read the latest metadata objects from R2
- have it translate them into the Electron/Squirrel response format expected by Studio

Until that exists, keep auto-updates disabled for fork releases.

### 5. Apple signing / notarization

The repo now supports skipping signing with:

- `STUDIO_SKIP_SIGNING=true`

When you are ready to enable signing, you will need at minimum:

- `STUDIO_APPLE_TEAM_ID`
- `STUDIO_APPLE_BUNDLE_IDENTIFIER`
- `STUDIO_APPLE_API_KEY_PATH`
- `STUDIO_MATCH_STORAGE`
- `STUDIO_MATCH_S3_BUCKET`

Notes:

- upstream uses `~/.configure/studio/secrets/app_store_connect_fastlane_api_key.json`
- upstream pulls Developer ID certs with `fastlane match` from S3 bucket `a8c-fastlane-match`
- the fork can keep `fastlane match` on Cloudflare R2 by setting `STUDIO_MATCH_STORAGE=r2`
- when using R2-backed match storage, keep signing assets under a separate prefix such as `signing/`

### 6. Windows signing

The repo now supports unsigned Windows builds.

When you later enable Windows signing, you will need:

- `WINDOWS_CODE_SIGNING_CERT_PASSWORD`
- a `certificate.pfx` file at repo root during the build

Important upstream-specific dependency:

- the current Buildkite helper `setup_windows_code_signing.ps1` comes from Automattic’s public CI toolkit plugin
- that helper expects an AWS Secrets Manager secret named `windows-code-signing-certificate`

For the fork, choose one of these paths:

1. keep that convention and provision the same secret name in your AWS account
2. replace that helper with your own secret download path later

## Exact GitHub + Buildkite env / secret matrix

### GitHub repository settings (`masonjames/studio`)

Secrets:

- `BUILDKITE_API_ACCESS_TOKEN`
  - Buildkite API token with permission to trigger builds

Variables:

- `BUILDKITE_RELEASE_PIPELINE=mason-james/studio-release-dispatch`

### Buildkite shared environment (`studio` and `studio-release-dispatch`)

Non-secret values:

- `STUDIO_GITHUB_REPO=masonjames/studio`
- `STUDIO_MAIN_BRANCH=trunk`
- `STUDIO_BUILDKITE_ORG=mason-james`
- `STUDIO_BUILDKITE_PIPELINE=studio`
- `STUDIO_RELEASE_STORAGE=r2`
- `STUDIO_R2_BUCKET=studio-releases`
- `STUDIO_R2_ENDPOINT=https://92f5da74fcbbfb4e489277dcaa01658f.r2.cloudflarestorage.com`
- `STUDIO_R2_PUBLIC_BASE_URL=https://wpstudio.masonjames.com`
- `STUDIO_RELEASE_PRODUCT_NAME=WP Studio`
- `STUDIO_RELEASE_WEBSITE_URL=https://wpstudio.masonjames.com`
- `STUDIO_WINDOWS_ICON_URL=https://wpstudio.masonjames.com/studio-app-icon.ico`
- `STUDIO_SKIP_SIGNING=true` for the initial unsigned flow
- `GITHUB_TOKEN`

Secrets:

- `STUDIO_R2_ACCESS_KEY_ID`
- `STUDIO_R2_SECRET_ACCESS_KEY`

Optional:

- `SLACK_WEBHOOK`
- `STUDIO_UPDATER_BASE_URL`
- `STUDIO_AUTO_UPDATES_ENABLED=true`

### Apple signing / notarization values

Set these on macOS Buildkite agents when you are ready to turn signing on:

- `STUDIO_SKIP_SIGNING=false`
- `STUDIO_APPLE_TEAM_ID=J5K2J3K4H7`
- `STUDIO_APPLE_BUNDLE_IDENTIFIER=com.masonjames.studio`
- `STUDIO_APPLE_API_KEY_PATH=/Users/buildkite/.configure/studio/secrets/app_store_connect_fastlane_api_key.json`
- `STUDIO_MATCH_STORAGE=r2`
- `STUDIO_MATCH_S3_BUCKET=studio-releases`
- `STUDIO_MATCH_S3_OBJECT_PREFIX=signing`
- optional `STUDIO_MATCH_S3_ENDPOINT=https://92f5da74fcbbfb4e489277dcaa01658f.r2.cloudflarestorage.com`
- optional `STUDIO_MATCH_S3_ACCESS_KEY_ID` / `STUDIO_MATCH_S3_SECRET_ACCESS_KEY` if you want match storage credentials separate from release-storage credentials

By default the fork will reuse the `STUDIO_R2_*` credentials for R2-backed match storage when the match-specific access key and secret are not set.

### Windows signing / AppX values

Set these on Windows Buildkite agents when you are ready to enable signed builds:

- `STUDIO_SKIP_SIGNING=false`
- `WINDOWS_CODE_SIGNING_CERT_PASSWORD`
- `STUDIO_WINDOWS_PACKAGE_DISPLAY_NAME=WP Studio`
- `STUDIO_WINDOWS_PUBLISHER_DISPLAY_NAME=Mason James`
- `STUDIO_WINDOWS_IDENTITY_NAME=MasonJames.WPStudio`
- `STUDIO_WINDOWS_STORE_PUBLISHER=CN=Mason James`
- `STUDIO_WINDOWS_SIGNED_PUBLISHER=<exact X.509 subject from the Windows signing certificate>`

The current Buildkite helper still expects a `certificate.pfx` file at repo root during the build.

## Buildkite environment checklist

### `studio` pipeline

Recommended baseline:

- `STUDIO_RELEASE_STORAGE=r2`
- `STUDIO_R2_BUCKET=studio-releases`
- `STUDIO_R2_ENDPOINT=https://92f5da74fcbbfb4e489277dcaa01658f.r2.cloudflarestorage.com`
- `STUDIO_R2_ACCESS_KEY_ID`
- `STUDIO_R2_SECRET_ACCESS_KEY`
- `STUDIO_R2_PUBLIC_BASE_URL=https://wpstudio.masonjames.com`
- `STUDIO_SKIP_SIGNING=true` (initially)
- `GITHUB_TOKEN`

Optional:

- `SLACK_WEBHOOK`
- `STUDIO_UPDATER_BASE_URL`
- `STUDIO_AUTO_UPDATES_ENABLED=true`

### `studio-release-dispatch` pipeline

Use the same env vars as above.

The manual release dispatcher requires these build env vars at trigger time:

- `RELEASE_ACTION`
- `RELEASE_VERSION`
- optional `GITHUB_USERNAME`

The GitHub `Release Dispatch` workflow sends these automatically.

## First fork release

For the first release, use the minimal working configuration:

- `STUDIO_RELEASE_STORAGE=r2`
- `STUDIO_SKIP_SIGNING=true`
- no `STUDIO_UPDATER_BASE_URL` yet
- no `STUDIO_AUTO_UPDATES_ENABLED` override

That gives you:

- unsigned macOS artifacts
- unsigned Windows artifacts
- GitHub release with R2 download links
- no auto-update polling in packaged fork builds

## Recommended branch protection for `trunk`

Apply to `masonjames/studio:trunk` only:

- require pull requests
- require 1 approval
- dismiss stale approvals
- require conversation resolution
- block force-pushes
- block deletion
- require status checks:
  - `Lint`
  - `Unit Tests`
  - `E2E Tests`

Do **not** require by default:

- `Performance Metrics`
- `Distribute Dev Builds`

Do **not** apply the same protection to `release/*` branches, because the release lanes push version and translation commits directly to those branches.

## ReleasesV2 audit

`https://releases.a8c.com/` is not usable as an external operator surface anymore; it currently redirects to Automattic’s public site. Treat ReleasesV2 as unavailable to the fork.

The replacement flow for the fork is:

1. trigger the GitHub `Release Dispatch` workflow
2. that triggers the Buildkite `studio-release-dispatch` pipeline
3. that bootstraps the shared Buildkite variables and uploads `.buildkite/release-pipelines/manual-dispatch.yml`
4. that uploads one of the existing release pipeline YAMLs
5. that runs the existing Fastlane lane
6. finalize/publish continue to create GitHub releases the same way as upstream
