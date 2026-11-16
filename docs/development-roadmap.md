# Development roadmap

1. **Project setup (complete):** Bun workspaces, Electron/React/Vite shell, strict TypeScript, Tailwind and shadcn/ui, Home and Settings navigation, tooling, Windows packaging configuration.
2. **Local projects and Dub Packs (complete):** folder and ZIP import, format validation, project metadata, video and original audio preview, timeline navigation, and local role selection.
3. **Single-player dubbing (complete):** microphone capture, multiple saved takes per dialogue, timing offsets, project resume, absolute-time audio timeline, and FFmpeg MP4 export with progress and missing-line guard.
4. **LAN collaboration (complete):** embedded Fastify and Socket.IO server, room discovery, matching local Dub Packs, authoritative role ownership, bounded take uploads, synchronized recording progress, session reconnection, and local preview and export on every player's device.
5. **Release hardening (future):** Windows installer validation, signing, updates, accessibility review, and hardware end-to-end testing.
6. **Optional Google Drive exports (future):** connect an account and folder, upload an exported MP4, and remove the temporary render. The implementation is parked behind `googleDriveExportsEnabled = false` for v1.1; the controls, IPC handlers, and automatic upload path are inactive until the OAuth setup and end-to-end Drive flow are ready to ship.

Future phases should keep portable business logic independent of Electron and React where practical.
