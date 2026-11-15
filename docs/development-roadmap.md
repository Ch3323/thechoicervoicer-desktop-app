# Development roadmap

1. **Project setup (complete):** Bun workspaces, Electron/React/Vite shell, strict TypeScript, Tailwind and shadcn/ui, Home and Settings navigation, tooling, Windows packaging configuration.
2. **Local projects and Dub Packs (complete):** folder and ZIP import, format validation, project metadata, video and original audio preview, timeline navigation, and local role selection.
3. **Single-player dubbing (complete):** microphone capture, multiple saved takes per dialogue, timing offsets, project resume, absolute-time audio timeline, and FFmpeg MP4 export with progress and missing-line guard.
4. **LAN collaboration (complete):** embedded Fastify and Socket.IO server, room discovery, matching local Dub Packs, authoritative role ownership, bounded take uploads, synchronized recording progress, session reconnection, and local preview and export on every player's device.
5. **Release hardening (future):** Windows installer validation, signing, updates, accessibility review, and hardware end-to-end testing.

Future phases should keep portable business logic independent of Electron and React where practical.
