# Windows releases and updates

The desktop application uses an x64 NSIS installer. It bundles Electron, application assets, production dependencies, and `ffmpeg-static`; users do not need Bun or Node.js. The app ID and package name remain stable across versions, so changing the displayed product name in 1.0.1 keeps the same `%APPDATA%\@studio\desktop` user data directory. Library metadata, private imported ZIP snapshots, recordings, previews, room cache, and Chromium settings live there, outside the installation directory. Updates replace the application, not that data directory.

## Unsigned hobby release

No certificate is needed for this route. Keep the GitHub repository public, commit the source, and push a tag named `tcvah-v<version>` (for the current source: `tcvah-v1.0.3`). The separate `hobby-release.yml` workflow runs the same checks and publishes the NSIS installer, blockmap, and `latest.yml` to a public GitHub Release. Do not mark it as a prerelease: the update client reads the latest public release.

Windows may display an unknown publisher or SmartScreen warning. The unsigned build skips the updater's Authenticode signature check, so anyone able to replace the GitHub release assets could distribute a malicious update to users of this channel. Protect GitHub access and use this route only for trusted hobby testers. Do not mix signed production and unsigned hobby releases in the same update feed; existing signed installs should stay on a signed feed.

## Signed production release

1. Use a **public** GitHub repository. GitHub Releases and `latest.yml` must be anonymously downloadable by installed clients. The workflow checks repository visibility.
2. Add repository secrets `WIN_CSC_LINK` (a base64 encoded PFX certificate or supported certificate link) and `WIN_CSC_KEY_PASSWORD`. The workflow requires signing and verifies the installer signature. Keep certificate material and passwords only in CI secrets.
3. Set the same version in the root and desktop `package.json`, then run `bun install` to update `bun.lock`. Tag the commit `v<version>` and push the tag. Normal commits do not publish releases. `v*` tags use only the signed workflow; `tcvah-v*` tags use only the unsigned workflow.
4. The workflow installs with `bun install --frozen-lockfile`, runs typecheck, lint, tests, and build, and creates a signed NSIS installer. It uploads the installer, its `.blockmap`, and `latest.yml` to a public GitHub Release. The workflow gets repository identity from `GITHUB_REPOSITORY`; no GitHub token or certificate is packaged in the application.

For a local installer smoke build, run `bun run dist:win`. This has no GitHub update feed unless `GITHUB_REPOSITORY` is set. Local builds without signing credentials are unsigned and may trigger Windows SmartScreen warnings. Do not distribute unsigned local builds as production updates or install them over a signed production release.

## Update behavior

Installed Windows releases check shortly after startup and every four hours. A new version produces an in-app notice; the user chooses Download or Later. Download progress appears in the notice. Installation requires a separate confirmation and is blocked while recording, saving a take, or rendering/exporting video. Settings shows the installed version, update state, and a manual check button. Development runs have updates disabled.

The release must contain `latest.yml`, the x64 NSIS installer, and its `.blockmap` under the same tag. Keep releases public. Do not delete old releases needed for upgrades.

## Upgrade acceptance test

This requires two public releases from the same signing channel and a Windows machine. It has **not** been performed in this workspace.

1. Publish `hobby-v1.0.0` or signed `v1.0.0`, install it, and create an imported Dub Pack, project, recording, and saved microphone setting. Record their presence and the displayed version.
2. Publish 1.0.1 from the same public repository and channel (`tcvah-v1.0.1` or signed `v1.0.1` with the same signing identity).
3. Start installed 1.0.0 and verify the update notice. Choose Download, watch progress, then choose Install and restart and confirm.
4. Verify Settings shows 1.0.1 and that the Dub Pack, project, selected recording, and microphone setting remain available.
5. Repeat installation while a recording or export is active and verify restart is deferred until the work finishes.

The local NSIS build verifies packaging only. It does not prove update detection or data preservation across an installed upgrade.
