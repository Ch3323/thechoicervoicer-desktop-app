# Architecture

## Current boundaries

```text
Electron main (apps/desktop/electron/main.ts)
  └── allowlisted IPC channel ── preload (electron/preload.ts)
                                  └── typed window.studio API ── React renderer (src/)

Shared domain (packages/shared/src/)
  ├── Zod models and Dub Pack format parser
  ├── role selection rules
  └── absolute-time audio timeline
```

The renderer owns navigation, presentation, microphone device selection, and MediaRecorder capture. It has no Node.js integration. The preload exposes typed, specific methods for library, project, recording, media, and export operations; the main process checks the sender and validates IPC arguments. BrowserWindow uses context isolation and sandboxing, blocks new windows and unexpected navigation, and restores the existing window when a second instance launches. Electron grants media permission only for audio capture by its own window.

React Router uses a hash router so routes also work when the production renderer loads from `file://`. The Vite renderer uses Tailwind CSS v4 and a local shadcn/ui Button component. The dark palette is defined in CSS variables. `@/` resolves to `apps/desktop/src` in TypeScript, Vite, and Vitest.

The root `tsconfig.base.json` sets strict compiler behavior for every workspace. `@studio/shared` contains portable domain models, Zod validation, parsing, and role rules with no Electron or React dependency. Bun workspaces and `workspace:*` keep the contract local. The desktop package is the electron-builder application directory.

## Phase 2 data flow

1. Electron presents a folder or ZIP picker. The ZIP reader rejects traversal, links, encrypted entries, duplicate names, and oversized archives. A ZIP is copied into a private snapshot; a folder remains a read-only source reference.
2. The adapter supplies immediate pack files and bounded text sidecars to `parseDubPack`. The pure parser reads Godot-style `[data]` config, normalizes metadata and assets, and creates one stable dialogue ID per sample timestamp. Zod validates the resulting model. The parser retains warnings for skipped incomplete samples.
3. `LibraryStore` writes pack references and project metadata to an atomic JSON file under Electron user data. It validates saved data on read and does not overwrite corrupt data.
4. A restricted `studio-media:` protocol serves only asset references belonging to a stored pack, with byte-range responses for large videos and seekable audio. OGV sources are converted to a cached H.264/AAC MP4 preview with FFmpeg; the source stays unchanged. Original dialogue audio and optional images are served through the same allowlisted protocol.
5. The renderer selects lines and offers one **Hear clip** action beside recording that plays the muted video at the dialogue timestamp with its source audio sample. It toggles to **Playing · Stop** during playback. The cue, speaker, and caption are layered over the video. The portable preview range uses the sample's duration plus a short tail, capped at the video end. It falls back to six seconds if the sample duration is unavailable because Dub Pack metadata has no scene end timestamp. FFmpeg decodes the source and selected take in the main process; only offset-aligned peak arrays cross IPC. Peak calculation lives in the portable shared package. An animation-frame loop reads the video clock for the waveform playhead. `selectRoles` validates local selections in the portable package so future ownership rules can reuse the domain boundary.

Format rules come from the [official content guide](https://thechoicervoicer.neocities.org/v2/content_guide/dub_packs) and the [Content Manager pack-format notes](https://github.com/jojozagjos/Choicer-Voicer-Content-Manager/blob/main/docs/PACK_FORMATS.md). The current parser supports the documented voice/dub pack folder, not other game pack families.

## Phase 3 recording and export

1. The renderer enumerates audio inputs and requests the chosen microphone through `getUserMedia`. It probes `MediaRecorder.isTypeSupported` before capture and uses `AudioContext`/`AnalyserNode` for a live level and waveform samples. The live waveform fills the source clip's time window while recording. Recording starts the muted video at the cue and stops automatically at the source clip length, or earlier at the user's request. Playing a saved take starts its audio and muted video at the take's absolute timeline position.
2. MediaRecorder's completed blob is sent immediately through the restricted preload. `recordings.ts` validates the MIME family, size, duration, and identifiers, writes the file under `userData/recordings/<project ID>/`, and asks `LibraryStore` to record its metadata. An atomic `library.json` write saves the project and selection state. One take per project dialogue is selected; retakes remain available. Playback and export use the saved duration as a hard limit.
3. `studio-media:` serves saved audio from a validated take ID. The source pack remains untouched. Roles are checked when a recording is saved.
4. The portable `buildAudioTimeline` selects one take for each dialogue assigned to an enabled role and places it using the dialogue timestamp plus that take's offset. These absolute positions handle overlap without accumulating drift.
5. `export.ts` builds an FFmpeg filter graph from the timeline. It mixes selected takes with the optional backing track, or silence when the track is absent. It maps only the source video stream, never source audio, and writes H.264/AAC MP4 at the full source duration. FFmpeg is spawned with an argument array in the main process. Progress and errors return over narrow IPC methods.

## Phase 4 LAN collaboration

The Host's Electron main process starts Fastify and Socket.IO on a selected private LAN port. Both Host and guests use `RoomClient` in Electron main, with narrow preload methods for room actions. The renderer retains microphone capture. The portable room contract and dialogue ownership checks live in `@studio/shared`.

The Host's `LibraryStore` remains authoritative for the project and takes. Socket.IO carries room state and small commands only. HTTP carries pack manifest and files, saved takes, and bounded audio uploads. Guests join without a pack and download it into their private library from the room lobby. A fingerprint check over parsed dialogue data and source media gates the Guest's ready state. UDP beacons on port `4319` advertise room addresses and codes for direct joining, and discovery deduplicates beacons from multiple interfaces. An address alone can also join a LAN room. A session token stays in Electron main; the renderer receives `studio-media:` URLs, so it never receives the token or direct filesystem paths. The Host secret never crosses the preload bridge. A disconnected session retains its roles and can rejoin with its token; the Host may release a disconnected player's roles. Uploaded takes survive room closure in the Host's existing user-data directory.

The shared project enables every pack character for completeness checks. For Watch Dub and export, each client downloads the selected takes into a private room cache, maps Host dialogue IDs to its local pack assets, and invokes the Phase 3 `exportProject` pipeline on its own device. Progress is sent only to that client's renderer; its preview and exported MP4 stay on that device.

## Security and build

`electron-vite` builds main, preload, and renderer separately. The renderer has a content security policy, no Node integration, and no generic IPC or filesystem bridge. The main process accepts known channels from its own window. `electron-builder` is configured for a Windows NSIS target and unpacks the FFmpeg executable; signing and distribution are future release work.
