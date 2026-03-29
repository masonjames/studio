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
| Automattic signing identity          | `Developer ID Application: Mason James (J5K2J3K4H7)`                 |
| `com.electron.studio` bundle ID     | `com.masonjames.studio`                                               |

## Current fork status

### Fully working

- macOS signing with Developer ID Application: Mason James (J5K2J3K4H7)
- macOS notarization via App Store Connect API key
- macOS bundle identifier: `com.masonjames.studio`
- Cloudflare R2 artifact storage and public URL resolution
- Buildkite agent (self-hosted macOS, `queue=mac`)
- Buildkite pipelines (`studio`, `studio-release-dispatch`)
- Fastlane match on R2 for certificate storage
- GitHub release creation via Fastlane lanes
- All release branch lanes (`code_freeze` through `publish_release`)

### Not yet provisioned

- Windows code-signing certificate
- Windows Buildkite agent (`queue=windows`)
- Fork updater service endpoint (auto-updates disabled for now)
- Microsoft Store submission identity

## Required external services

### 1. GitHub

Repository settings / secrets:

- secret: `BUILDKITE_API_ACCESS_TOKEN`
  - Buildkite API token with `write_builds`
  - 1Password: `buildkite-studio-api-token` in Platform Infra vault
- variable: `BUILDKITE_RELEASE_PIPELINE`
  - recommended value: `mason-james/studio-release-dispatch`

The repo contains a manual workflow:

- `.github/workflows/release-dispatch.yml`

Use it as the replacement for the upstream ReleasesV2 button flow.

The bootstrap Buildkite pipeline files are:

- `.buildkite/bootstrap-ci.yml`
- `.buildkite/bootstrap-release-dispatch.yml`

### 2. Buildkite

Two pipelines in the `mason-james` Buildkite org:

1. `studio`

   - repo: `masonjames/studio`
   - pipeline file: `.buildkite/bootstrap-ci.yml`
   - purpose: PR + trunk CI

2. `studio-release-dispatch`
   - repo: `masonjames/studio`
   - pipeline file: `.buildkite/bootstrap-release-dispatch.yml`
   - purpose: manual release entrypoint

Agent queues:

- `mac` — self-hosted macOS agents (created, verified)
- `windows` — Windows agents (not yet provisioned)

### 3. Cloudflare R2

Provisioned and verified:

- Bucket: `studio-releases`
- Endpoint: `https://92f5da74fcbbfb4e489277dcaa01658f.r2.cloudflarestorage.com`
- Public URL: `https://wpstudio.masonjames.com`
- 1Password: `studio-releases-r2-credentials` in Platform Infra vault

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

**Status: Fully working.**

Verified artifacts:

- `codesign -dv` shows `Identifier=com.masonjames.studio`
- `codesign -dv` shows `Authority=Developer ID Application: Mason James (J5K2J3K4H7)`
- `spctl -a -vvv` shows `source=Notarized Developer ID`

Configuration:

| Env var | Value |
|---------|-------|
| `STUDIO_SKIP_SIGNING` | `false` |
| `STUDIO_APPLE_TEAM_ID` | `J5K2J3K4H7` |
| `STUDIO_APPLE_BUNDLE_IDENTIFIER` | `com.masonjames.studio` |
| `STUDIO_APPLE_API_KEY_PATH` | `~/.configure/studio/secrets/app_store_connect_fastlane_api_key.json` |
| `STUDIO_MATCH_STORAGE` | `r2` |
| `STUDIO_MATCH_S3_BUCKET` | `studio-releases` |
| `STUDIO_MATCH_S3_OBJECT_PREFIX` | `signing` |
| `STUDIO_MATCH_S3_ENDPOINT` | `https://92f5da74fcbbfb4e489277dcaa01658f.r2.cloudflarestorage.com` |

The match storage reuses the same R2 bucket and credentials as release storage (under a `signing/` prefix).

Key file locations on macOS build agents:

- API key JSON: `~/.configure/studio/secrets/app_store_connect_fastlane_api_key.json`
- The `.p8` private key is embedded in the JSON; no separate AuthKey file needed at runtime

### 6. Windows signing

The repo supports unsigned Windows builds.

When you later enable Windows signing, you will need:

- `WINDOWS_CODE_SIGNING_CERT_PASSWORD`
- a `certificate.pfx` file at repo root during the build

Important upstream-specific dependency:

- the current Buildkite helper `setup_windows_code_signing.ps1` comes from Automattic's public CI toolkit plugin
- that helper expects an AWS Secrets Manager secret named `windows-code-signing-certificate`

For the fork, choose one of these paths:

1. keep that convention and provision the same secret name in your AWS account
2. replace that helper with your own secret download path later

## Exact GitHub + Buildkite env / secret matrix

### GitHub repository settings (`masonjames/studio`)

Secrets:

- `BUILDKITE_API_ACCESS_TOKEN`
  - Buildkite API token with permission to trigger builds
  - 1Password: `buildkite-studio-api-token` in Platform Infra vault

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
- `STUDIO_SKIP_SIGNING=false`
- `GITHUB_TOKEN`

Secrets:

- `STUDIO_R2_ACCESS_KEY_ID`
  - 1Password: `studio-releases-r2-credentials` → username
- `STUDIO_R2_SECRET_ACCESS_KEY`
  - 1Password: `studio-releases-r2-credentials` → credential

Optional:

- `SLACK_WEBHOOK`
- `STUDIO_UPDATER_BASE_URL`
- `STUDIO_AUTO_UPDATES_ENABLED=true`

### Apple signing / notarization values

Set on macOS Buildkite agents (already configured in `~/.buildkite-agent-studio.env`):

- `STUDIO_SKIP_SIGNING=false`
- `STUDIO_APPLE_TEAM_ID=J5K2J3K4H7`
- `STUDIO_APPLE_BUNDLE_IDENTIFIER=com.masonjames.studio`
- `STUDIO_APPLE_API_KEY_PATH=~/.configure/studio/secrets/app_store_connect_fastlane_api_key.json`
- `STUDIO_MATCH_STORAGE=r2`
- `STUDIO_MATCH_S3_BUCKET=studio-releases`
- `STUDIO_MATCH_S3_OBJECT_PREFIX=signing`
- `STUDIO_MATCH_S3_ENDPOINT=https://92f5da74fcbbfb4e489277dcaa01658f.r2.cloudflarestorage.com`
- `STUDIO_MATCH_S3_ACCESS_KEY_ID` (reuses R2 credentials)
- `STUDIO_MATCH_S3_SECRET_ACCESS_KEY` (reuses R2 credentials)

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

## 1Password vault inventory

All fork release secrets are stored in the **Platform Infra** vault (`cecouqf4ucde6ap376ffb4ggva`).

| Item | Contents |
|------|----------|
| `studio-releases-r2-credentials` | R2 access key ID, secret access key, bucket name, endpoint, public URL |
| `buildkite-studio-api-token` | Buildkite REST API token (`bkua_*`) for triggering builds |
| `buildkite-studio-agent-token` | Buildkite agent registration token (`bkct_*`) for self-hosted agents |

The Apple App Store Connect API key JSON is stored locally at `~/.configure/studio/secrets/app_store_connect_fastlane_api_key.json` on macOS build agents (not in 1Password — contains the embedded `.p8` private key).

## Local macOS agent setup

### Prerequisites

- Homebrew
- Ruby 3.2.2 via rbenv (`rbenv install 3.2.2`)
- Node.js (version per `.node-version`)
- Xcode Command Line Tools
- Buildkite agent (`brew install buildkite-agent`)

### Configuration files

| File | Purpose |
|------|---------|
| `/opt/homebrew/etc/buildkite-agent/buildkite-agent.cfg` | Agent config — token, queue tags, build path |
| `/opt/homebrew/etc/buildkite-agent/hooks/environment` | Sources `~/.buildkite-agent-studio.env` and sets PATH |
| `~/.buildkite-agent-studio.env` | All Studio-specific env vars and secrets |
| `~/.configure/studio/secrets/app_store_connect_fastlane_api_key.json` | Apple API key for notarization |

### Agent tags

```
queue=mac,os=macos,arch=arm64,role=studio
```

### Starting the agent

```bash
# One-off:
buildkite-agent start --config /opt/homebrew/etc/buildkite-agent/buildkite-agent.cfg

# As a persistent service:
brew services start buildkite-agent
```

### Ruby setup for Fastlane

```bash
rbenv install 3.2.2        # if not already installed
cd /path/to/studio
bundle install              # installs to vendor/bundle
eval "$(rbenv init - zsh)"  # ensure rbenv shims are in PATH
bundle exec fastlane <lane> # run any lane
```

The Buildkite hooks/environment file sets up PATH to include rbenv automatically.

## Buildkite environment checklist

### `studio` pipeline

- `STUDIO_RELEASE_STORAGE=r2`
- `STUDIO_R2_BUCKET=studio-releases`
- `STUDIO_R2_ENDPOINT=https://92f5da74fcbbfb4e489277dcaa01658f.r2.cloudflarestorage.com`
- `STUDIO_R2_ACCESS_KEY_ID` (secret)
- `STUDIO_R2_SECRET_ACCESS_KEY` (secret)
- `STUDIO_R2_PUBLIC_BASE_URL=https://wpstudio.masonjames.com`
- `STUDIO_SKIP_SIGNING=false`
- `GITHUB_TOKEN` (secret)

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

## Running a release

### First beta release

```bash
source ~/.buildkite-agent-studio.env
eval "$(rbenv init - zsh)"
bundle exec fastlane new_beta_release version:1.7.8-beta.1 skip_confirm:true
```

### Via Buildkite (recommended for CI)

Trigger the `studio-release-dispatch` pipeline with:

- `RELEASE_ACTION=new_beta_release`
- `RELEASE_VERSION=1.7.8-beta.1`

Or use the GitHub `Release Dispatch` workflow from the Actions tab.

### Full release flow

1. `code_freeze` — creates `release/<version>` branch, extracts strings, generates notes
2. `new_beta_release` — bumps version, builds, signs, notarizes, uploads to R2
3. `finalize_release` — merges release branch, prepares final version
4. `publish_release` — publishes the GitHub release, uploads final artifacts

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

## Fastfile notes

### S3ClientHelper monkey-patch

The Fastfile monkey-patches `Fastlane::Helper::S3ClientHelper` to support R2's S3-compatible endpoint. This uses `class_eval` with `::Fastlane` (top-level constant) because fastlane evaluates the Fastfile inside a `FastFile` instance binding — bare `module Fastlane` would create a nested module instead of reopening the existing one.

### Validate release configuration

`validate_release_configuration!` runs at Fastfile load time (all lanes). When `STUDIO_RELEASE_STORAGE=r2`, it requires all `STUDIO_R2_*` env vars. Use `DRY_RUN=true` to bypass validation for lanes that don't need R2 credentials (e.g., local notarization testing).

## ReleasesV2 audit

`https://releases.a8c.com/` is not usable as an external operator surface anymore; it currently redirects to Automattic's public site. Treat ReleasesV2 as unavailable to the fork.

The replacement flow for the fork is:

1. trigger the GitHub `Release Dispatch` workflow
2. that triggers the Buildkite `studio-release-dispatch` pipeline
3. that bootstraps the shared Buildkite variables and uploads `.buildkite/release-pipelines/manual-dispatch.yml`
4. that uploads one of the existing release pipeline YAMLs
5. that runs the existing Fastlane lane
6. finalize/publish continue to create GitHub releases the same way as upstream
