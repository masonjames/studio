#!/bin/bash -eu

# Prepares the CI environment to successfully build the macOS app.
# Building the app is done via npm run make:macos-*.

echo "--- :rubygems: Setting up Gems"
install_gems

if [ "${STUDIO_SKIP_SIGNING:-false}" = "true" ]; then
  echo "--- :information_source: Skipping signing setup because STUDIO_SKIP_SIGNING=true"
else
  # configure_apply downloads secrets from Automattic's .configure infrastructure.
  # On fork builds the Apple API key and signing certs are placed manually on the
  # build agent, so skip this step when STUDIO_RELEASE_STORAGE=r2 (fork indicator).
  if [ "${STUDIO_RELEASE_STORAGE:-appscdn}" != "r2" ]; then
    echo "--- :closed_lock_with_key: Installing Secrets"
    bundle exec fastlane run configure_apply
  else
    echo "--- :information_source: Skipping configure_apply (fork build — secrets are pre-installed on agent)"
  fi

  # On fork builds, check if the Developer ID cert is already in the keychain.
  # If so, skip match (which downloads from R2) since Electron Forge will find
  # the cert directly. Match should be initialized for clean CI agents.
  if [ "${STUDIO_RELEASE_STORAGE:-appscdn}" = "r2" ]; then
    CERT_IDENTITY="${STUDIO_APPLE_BUNDLE_IDENTIFIER:-com.masonjames.studio}"
    if security find-identity -v -p codesigning | grep -q "Developer ID Application.*${STUDIO_APPLE_TEAM_ID:-J5K2J3K4H7}"; then
      echo "--- :white_check_mark: Developer ID cert already in keychain — skipping match"
    else
      echo "--- :testflight: Fetching Signing Certificates"
      bundle exec fastlane set_up_signing
    fi
  else
    echo "--- :testflight: Fetching Signing Certificates"
    bundle exec fastlane set_up_signing
  fi
fi
