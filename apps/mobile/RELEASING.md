# Releasing the Android app

Releases are signed APKs attached to GitHub Releases. Play Store comes later.

## Cut a release

Push a tag named `mobile-vX.Y.Z`:

```sh
git tag mobile-v1.2.3
git push origin mobile-v1.2.3
```

Or run **Mobile Release** from the Actions tab with `version` set to `1.2.3`
(this builds the branch you run it from and tags the release at its commit).
The `.github/workflows/mobile-release.yml` workflow then:

1. prebuilds the `production` variant (`dev.jontitor.ralphmeet`),
2. runs `./gradlew assembleRelease` (one universal APK),
3. fails unless the APK is signed with the release certificate,
4. uploads `ralph-meet-X.Y.Z.apk` to the `mobile-vX.Y.Z` release and as a workflow artifact.

## Versioning

`X.Y.Z` becomes `version`, and `versionCode = X*10000 + Y*100 + Z`
(`1.2.3` -> `10203`). It rises with every semver bump, so Android accepts each
release as an update, and it is identical on a rebuild of the same tag. Keep
minor and patch below 100; the workflow rejects anything else. Override locally
with `RALPH_APP_VERSION` and `RALPH_VERSION_CODE`.

## Signing

`plugins/withReleaseSigning.cjs` adds a `release` signing config to the
generated `android/app/build.gradle`. It reads `RALPH_UPLOAD_STORE_FILE`,
`RALPH_UPLOAD_STORE_PASSWORD`, `RALPH_UPLOAD_KEY_ALIAS` and
`RALPH_UPLOAD_KEY_PASSWORD` from the environment (or gradle properties) at
build time. Without them a release build falls back to debug signing.

The keystore (PKCS12, alias `ralphmeet`) lives at
`C:\Users\jon\.config\ralph-meet\android-signing\ralph-meet-release.p12`, with
its password in `keystore-password.txt` beside it. CI gets it from the
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`,
`ANDROID_KEY_ALIAS` and `GOOGLE_SERVICES_JSON_BASE64` repository secrets.

**Back the keystore up somewhere off this machine.** If it is lost, installed
apps can never be updated: users would have to uninstall and reinstall under a
new key. Never commit it or `google-services.json`.

## Install and update

Open the release on GitHub from the phone, download `ralph-meet-X.Y.Z.apk` and
open it (allow installs from the browser when Android asks). Install a newer
APK over the old one to update; data is kept because the signing key is the
same.
