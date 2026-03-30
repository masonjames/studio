# Fork Release Process

This document describes the release path for `masonjames/studio`.

The upstream `docs/release-process.md` flow depends on Automattic-only infrastructure:

- ReleasesV2 (`releases.a8c.com`)
- WordPress.com Apps CDN
- WordPress.com updater endpoint
- GlotPress import automation
- internal Git/CI helpers such as `use-bot-for-git`
- `configure_apply` (Automattic secret management)

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
| `use-bot-for-git` CI helper         | Inline `git config` in pipeline YAML                                  |
| `configure_apply` secret download   | Secrets pre-installed on build agents; skipped when `STUDIO_RELEASE_STORAGE=r2` |

## Current fork status

### Fully working (verified 2026-03-30)

- macOS arm64 build via `npm run make:macos-arm64`
- macOS signing with Developer ID Application: Mason James (J5K2J3K4H7)
- macOS notarization via App Store Connect API key (stapled)
- macOS bundle identifier: `com.masonjames.studio`
- Cloudflare R2 artifact storage and public URL resolution
- Public download via `https://wpstudio.masonjames.com`
- Buildkite agents (self-hosted macOS local + hosted, `queue=mac`)
- Buildkite pipelines (`studio`, `studio-release-dispatch`)
- Fastlane R2 upload with S3-compatible monkey-patch
- GitHub release creation via Fastlane lanes
- All release branch lanes (`code_freeze` through `publish_release`)
- `distribute_builds` gracefully skips missing Windows artifacts

### Verified build chain (2026-03-30)

Full end-to-end local test completed:

```
npm run make:macos-arm64
  → Signed: Developer ID Application: Mason James (J5K2J3K4H7)
  → Bundle ID: com.masonjames.studio

bundle exec fastlane notarize_binary
  → Notarized and stapled (Apple notary service)
  → spctl: source=Notarized Developer ID

R2 upload test
  → 401 MB zip uploaded to studio-releases bucket
  → Public URL returned HTTP 200 via wpstudio.masonjames.com
  → Test artifact cleaned up
```

### Not yet provisioned

- Windows code-signing certificate
- Windows Buildkite agent (`queue=windows`)
- Fork updater service endpoint (auto-updates disabled for now)
- Microsoft Store submission identity
- Fastlane `match` R2 initialization (certs in local keychain; not yet uploaded to R2 for remote CI agents)

## Fork-specific pipeline changes

### `use-bot-for-git` replaced

All release pipeline YAML files use inline git config instead of the Automattic CI toolkit `use-bot-for-git` helper:

```bash
git config user.name "Studio Release Bot"
git config user.email "studio-bot@masonjames.com"
```

Affected files:
- `.buildkite/release-build-and-distribute.yml`
- `.buildkite/release-pipelines/code-freeze.yml`
- `.buildkite/release-pipelines/new-beta-release.yml`
- `.buildkite/release-pipelines/finalize-release.yml`
- `.buildkite/release-pipelines/publish-release.yml`
- `.buildkite/release-pipelines/new-hotfix-release.yml`

### `configure_apply` skipped on fork

`prepare-environment.sh` skips `bundle exec fastlane run configure_apply` when `STUDIO_RELEASE_STORAGE=r2` because fork secrets are pre-installed on build agents.

### Windows builds disabled in release pipeline

`release-build-and-distribute.yml` has the Windows build group commented out and the publish step depends only on `release-mac`. The Windows group and `release-windows` dependency should be uncommented when a Windows agent and signing cert are provisioned.

### `distribute_builds` is platform-aware

The Fastfile's `distribute_builds` function:
- Only includes Windows entries when their artifact files exist on disk
- Filters out any builds with missing `binary_path` before uploading
- Fails with a clear error if zero artifacts are found

### Developer ID cert detection in `prepare-environment.sh`

When running on the fork (`STUDIO_RELEASE_STORAGE=r2`), the script checks if the Developer ID cert is already in the local keychain. If found, it skips the `fastlane set_up_signing` (match download) step. This avoids requiring match to be initialized in R2 for agents that already have the cert installed locally.

## Required external services

### 1. GitHub

Repository settings / secrets:

- secret: `BUILDKITE_API_ACCESS_TOKEN`
  - Buildkite API token with `write_builds`
  - 1Password: `buildkite-studio-api-token` in Platform Infra vault
- variable: `BUILDKITE_RELEASE_PIPELINE`
  - value: `mason-james/studio-release-dispatch`

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
- Location: Eastern North America (ENAM)
- Created: 2026-03-28
- Endpoint: `https://92f5da74fcbbfb4e489277dcaa01658f.r2.cloudflarestorage.com`
- Custom domain: `wpstudio.masonjames.com` (Active, Enabled)
- Public Development URL: Disabled (not needed — custom domain is the production path)
- DNS: CNAME `wpstudio.masonjames.com` → `public.r2.dev` (Cloudflare proxied)
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

**Status: Fully working (verified 2026-03-30).**

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

### 6. Match (code signing certificate storage)

**Status: Not initialized — deferred.**

The `signing/` prefix in R2 is empty. The Developer ID cert is installed directly in the local macOS keychain. `prepare-environment.sh` detects this and skips the match download step.

When you set up a new CI agent that doesn't have the cert in its keychain, you'll need to initialize match:

```bash
# Export the cert and private key from Keychain Access as .cer and .p12 files
# Then import into match:
eval "$(rbenv init - zsh)"
source ~/.buildkite-agent-studio.env
bundle exec fastlane match import \
  --type developer_id \
  --platform macos \
  --team_id J5K2J3K4H7 \
  --app_identifier com.masonjames.studio \
  --storage_mode s3 \
  --s3_bucket studio-releases \
  --s3_region auto \
  --s3_access_key "$STUDIO_MATCH_S3_ACCESS_KEY_ID" \
  --s3_secret_access_key "$STUDIO_MATCH_S3_SECRET_ACCESS_KEY"
```

This will prompt for the .cer and .p12 file paths and a match encryption password.

### 7. Windows signing

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

- `BUILDKITE_API_ACCESS_TOKEN` (set, verified)
  - Buildkite API token with permission to trigger builds
  - 1Password: `buildkite-studio-api-token` in Platform Infra vault

Variables:

- `BUILDKITE_RELEASE_PIPELINE=mason-james/studio-release-dispatch` (set, verified)

### Buildkite pipeline environment (`studio` pipeline)

Non-secret values:

- `STUDIO_RELEASE_STORAGE=r2`
- `STUDIO_R2_BUCKET=studio-releases`
- `STUDIO_R2_ENDPOINT=https://92f5da74fcbbfb4e489277dcaa01658f.r2.cloudflarestorage.com`
- `STUDIO_R2_PUBLIC_BASE_URL=https://wpstudio.masonjames.com`
- `STUDIO_SKIP_SIGNING=true` (pipeline level — overridden to `false` on agent for release builds)

Secrets (set in pipeline env):

- `STUDIO_R2_ACCESS_KEY_ID`
- `STUDIO_R2_SECRET_ACCESS_KEY`

### Buildkite agent environment (`~/.buildkite-agent-studio.env`)

Non-secret values:

- `STUDIO_GITHUB_REPO=masonjames/studio`
- `STUDIO_MAIN_BRANCH=trunk`
- `STUDIO_BUILDKITE_ORG=mason-james`
- `STUDIO_BUILDKITE_PIPELINE=studio`
- `STUDIO_RELEASE_STORAGE=r2`
- `STUDIO_R2_BUCKET=studio-releases`
- `STUDIO_R2_ENDPOINT=https://92f5da74fcbbfb4e489277dcaa01658f.r2.cloudflarestorage.com`
- `STUDIO_R2_PUBLIC_BASE_URL=https://wpstudio.masonjames.com`
- `STUDIO_SKIP_SIGNING=false`
- `STUDIO_APPLE_TEAM_ID=J5K2J3K4H7`
- `STUDIO_APPLE_BUNDLE_IDENTIFIER=com.masonjames.studio`
- `STUDIO_APPLE_API_KEY_PATH=~/.configure/studio/secrets/app_store_connect_fastlane_api_key.json`
- `STUDIO_MATCH_STORAGE=r2`
- `STUDIO_MATCH_S3_BUCKET=studio-releases`
- `STUDIO_MATCH_S3_OBJECT_PREFIX=signing`
- `STUDIO_MATCH_S3_ENDPOINT=https://92f5da74fcbbfb4e489277dcaa01658f.r2.cloudflarestorage.com`
- `STUDIO_MATCH_S3_FORCE_PATH_STYLE=true`

Secrets (in env file, sourced from 1Password):

- `STUDIO_R2_ACCESS_KEY_ID`
- `STUDIO_R2_SECRET_ACCESS_KEY`
- `STUDIO_MATCH_S3_ACCESS_KEY_ID` (same as R2)
- `STUDIO_MATCH_S3_SECRET_ACCESS_KEY` (same as R2)
- `BUILDKITE_API_ACCESS_TOKEN`
- `BUILDKITE_AGENT_TOKEN`

Dynamic:

- `GITHUB_TOKEN=$(gh auth token 2>/dev/null)`

### Apple signing / notarization values

Set on macOS Buildkite agents (already configured in `~/.buildkite-agent-studio.env`).

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

### Important: rbenv must be initialized

The system Ruby (2.6) does NOT work with the project's Gemfile. Always run `eval "$(rbenv init - zsh)"` before any `bundle` or `fastlane` command. The Buildkite agent hooks handle this automatically.

## Running a release

### Quick local build test (no Buildkite)

```bash
eval "$(rbenv init - zsh)"
source ~/.buildkite-agent-studio.env

# Build arm64 (Apple Silicon)
npm run make:macos-arm64

# Notarize
bundle exec fastlane notarize_binary

# Verify
codesign -dv "apps/studio/out/WP Studio-darwin-arm64/WP Studio.app"
spctl -a -vvv "apps/studio/out/WP Studio-darwin-arm64/WP Studio.app"
```

### First beta release

```bash
source ~/.buildkite-agent-studio.env
eval "$(rbenv init - zsh)"
bundle exec fastlane code_freeze version:1.7.8 skip_confirm:true
bundle exec fastlane new_beta_release version:1.7.8 skip_confirm:true
```

### Via Buildkite (recommended for CI)

Trigger the `studio-release-dispatch` pipeline with:

- `RELEASE_ACTION=new_beta_release`
- `RELEASE_VERSION=1.7.8`

Or use the GitHub `Release Dispatch` workflow from the Actions tab.

### Full release flow

1. `code_freeze` — creates `release/<version>` branch, extracts strings, generates notes
2. `new_beta_release` — bumps version, builds, signs, notarizes, uploads to R2
3. `finalize_release` — merges release branch, prepares final version
4. `publish_release` — publishes the GitHub release, uploads final artifacts

## Buildkite environment checklist

### `studio` pipeline

- `STUDIO_RELEASE_STORAGE=r2`
- `STUDIO_R2_BUCKET=studio-releases`
- `STUDIO_R2_ENDPOINT=https://92f5da74fcbbfb4e489277dcaa01658f.r2.cloudflarestorage.com`
- `STUDIO_R2_ACCESS_KEY_ID` (secret)
- `STUDIO_R2_SECRET_ACCESS_KEY` (secret)
- `STUDIO_R2_PUBLIC_BASE_URL=https://wpstudio.masonjames.com`
- `STUDIO_SKIP_SIGNING=true` (CI default; overridden on agent for releases)

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

### Platform-aware distribute_builds

The `distribute_builds` function conditionally includes Windows entries only when their artifact files exist on disk. It also applies a final filter (`File.exist?`) on all builds before uploading, so a macOS-only build run won't crash on missing Windows artifacts.

## ReleasesV2 audit

`https://releases.a8c.com/` is not usable as an external operator surface anymore; it currently redirects to Automattic's public site. Treat ReleasesV2 as unavailable to the fork.

The replacement flow for the fork is:

1. trigger the GitHub `Release Dispatch` workflow
2. that triggers the Buildkite `studio-release-dispatch` pipeline
3. that bootstraps the shared Buildkite variables and uploads `.buildkite/release-pipelines/manual-dispatch.yml`
4. that uploads one of the existing release pipeline YAMLs
5. that runs the existing Fastlane lane
6. finalize/publish continue to create GitHub releases the same way as upstream

## Troubleshooting

### Ruby version mismatch

If you see errors about bundler version or Ruby 2.6, you're using the system Ruby. Fix:

```bash
eval "$(rbenv init - zsh)"
ruby --version  # should show 3.2.2
```

### Notarization fails

Verify the API key file exists and is readable:

```bash
ls -la ~/.configure/studio/secrets/app_store_connect_fastlane_api_key.json
```

The file must contain the embedded `.p8` private key in JSON format.

### R2 upload fails

Test R2 credentials:

```bash
source ~/.buildkite-agent-studio.env
bundle exec ruby -r aws-sdk-s3 -e '
  client = Aws::S3::Client.new(
    region: "auto",
    endpoint: ENV["STUDIO_R2_ENDPOINT"],
    access_key_id: ENV["STUDIO_R2_ACCESS_KEY_ID"],
    secret_access_key: ENV["STUDIO_R2_SECRET_ACCESS_KEY"],
    force_path_style: true
  )
  puts client.list_objects_v2(bucket: ENV["STUDIO_R2_BUCKET"], max_keys: 5).contents.count
'
```

### Build output paths

The app name in build output uses the `productName` from package.json:

- App: `apps/studio/out/WP Studio-darwin-arm64/WP Studio.app`
- Zip: `apps/studio/out/make/zip/darwin/arm64/WP Studio-darwin-arm64-<version>.zip`

Note: the Fastfile's `distribute_builds` references `Studio-darwin-*` paths (without "WP " prefix). If the product name doesn't match, uploads will fail with missing file errors. The `File.exist?` filter will catch this gracefully.
