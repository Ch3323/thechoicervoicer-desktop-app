# Repository guide

- This repository has completed Phase 3: local Dub Pack import, microphone recording, take management, project persistence, and video export. Do not add LAN hosting or multiplayer without an explicit request.
- Use Bun exclusively for dependencies, workspace scripts, and lockfile changes. Keep `bun.lock` as the only dependency lockfile.
- Keep renderer code free of Node.js and Electron imports. Add a narrowly typed preload method and a validated main-process handler when privileged access is required.
- Put logic intended for reuse by a future LAN server in a platform-independent package. Do not create empty packages for planned modules.
- Use `@/` for desktop renderer imports and `@studio/shared` for cross-process contracts.
- Before finishing changes, run `bun run typecheck`, `bun run lint`, `bun run test`, and `bun run build`. Report commands that cannot run.
- Preserve `contextIsolation: true`, `nodeIntegration: false`, and the renderer sandbox.
- Keep the format parser, role rules, and absolute-time audio timeline in `packages/shared`; keep filesystem, ZIP, FFmpeg, and IPC access in `apps/desktop/electron`. Keep microphone capture in the browser renderer with only audio device permission.
- Store takes under Electron user data, validate take metadata, and maintain at most one selected take per project dialogue. Do not mix source video audio into exports.
- Never alter an imported Dub Pack's source files. ZIP imports may create a private snapshot and OGV previews may be cached under Electron user data.
