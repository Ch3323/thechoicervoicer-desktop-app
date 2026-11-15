# Collaborative Dubbing Studio

A Windows-first Electron app for The Choicer Voicer Dub Packs. **Phase 4** adds LAN dubbing rooms while preserving local single-player recording and export.

## Prerequisites

- Windows 11 for the primary development and packaging target.
- [Bun](https://bun.com/docs/installation) 1.3.14 or newer. Confirm with `bun --version`.
- Network access for the first dependency install and Electron binary download.
- The first install also downloads a Windows FFmpeg binary for OGV preview conversion and export.
- A microphone and operating-system microphone permission are needed for recording.

Electron runs on its bundled Node.js runtime. Bun manages dependencies, workspaces, and scripts.

## Commands

Run from the repository root:

| Command                | Purpose                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| `bun install`          | Install dependencies from `bun.lock`                                    |
| `bun run dev`          | Start the renderer dev server and Electron                              |
| `bun run start`        | Preview the built desktop app                                           |
| `bun run typecheck`    | Check strict TypeScript in desktop and shared workspaces                |
| `bun run lint`         | Run ESLint in both workspaces                                           |
| `bun run test`         | Run Vitest                                                              |
| `bun run build`        | Build Electron main, preload, and Vite renderer into `apps/desktop/out` |
| `bun run dist:win`     | Build and package a Windows NSIS installer into `apps/desktop/release`  |
| `bun run format`       | Format repository files                                                 |
| `bun run format:check` | Check formatting                                                        |

If you change dependencies, use `bun add` in the relevant workspace and commit `bun.lock`. Bun is the only package manager for this repository.

## Structure

```text
apps/desktop/
  electron/                 Electron main, restricted preload bridge, pack I/O, library, media, export
  src/hooks/                Browser microphone capture and device enumeration
  src/components/ui/        Local shadcn/ui components
  src/pages/                Routed screens
  src/styles/               Tailwind theme
  src/test/                 Renderer test setup
packages/shared/src/        Domain models, Zod validation, format parser, role rules, timeline
docs/                       Architecture and roadmap
```

See [architecture](docs/architecture.md) for process boundaries and [roadmap](docs/development-roadmap.md) for planned phases.

## Using Dub Packs

Choose **New Project** to open the pack library. Import a pack folder or ZIP, inspect its metadata, then choose **Open as project**. **Open Project** lists previously created local projects. In a workspace, select a dialogue and click **Hear clip** next to the recording action. The button changes to **Playing · Stop** while active. The video starts at that dialogue's timestamp while its original audio sample plays; the video's own audio is muted. The cue, speaker, and caption appear over the full video frame. A waveform below compares the original clip with the selected take at its saved timing offset. The preview ends half a second after the sample, or after six seconds if the sample duration is unavailable, and never passes the video end. Dub Pack metadata does not define scene end timestamps. The dialogue list can show all lines or only enabled roles.

For an enabled role, select a line and open **Microphone settings** to choose an input device. **Start recording** starts the muted video at the dialogue cue and draws the microphone waveform as you speak. The microphone stops automatically at the source sample's length, though you may choose **Stop recording** earlier. The take saves automatically when capture finishes and becomes the selected take. **Play recording** plays the selected saved take with the muted video at its timeline offset; earlier takes remain available for selection. Each take has its own timing offset in seconds. The project, selected takes, offsets, and progress are saved automatically and appear again under **Open Project** after restarting the app. The recorder probes supported MIME types at runtime and uses the browser default when needed.

Choose **Export video** from the workspace. The export screen lists completion and missing assigned lines. **Require all assigned lines** blocks an incomplete export when enabled. Choose whether to use the pack backing track, pick an MP4 destination, watch FFmpeg progress, and open the output folder when done. The result uses the full source video timeline, selected takes at absolute dialogue timestamps, H.264 video, and AAC audio. Overlapping takes are mixed. Source video audio is excluded so original dialogue cannot play over the dub. Without a usable backing track, spaces between takes are silent; the export screen reports this limitation. FFmpeg runs in the Electron main process with argument arrays, outside the renderer.

## LAN collaboration

Open **LAN** from the home rail. The Host enters a display name and port (default `4318`), then chooses **Create Room**. Guests can click an entry in **Available Rooms** to join directly; a blank name becomes **Guest**. The manual option accepts either a six-character room code found through LAN discovery or the Host's private IPv4 address, with an optional port (default `4318`). Discovery uses UDP port `4319`; internet relay is not provided.

The Host can share an existing local project or import a Dub Pack ZIP and create a shared project. Guests join first, then click **Download from Host** in the room lobby. The download saves a private local copy. The app compares the parsed dialogue and source media with the Host's pack and rejects a mismatch. Guests cannot mark ready until their local pack is verified. Everyone claims available character roles; one player owns each character, and one player may claim several. Each connected player marks themselves ready, then the Host starts the game. Players use the same studio layout and microphone recorder as single-player mode to select their dialogue, listen to the source, and record. The take uploads to the Host and becomes the selected take for that dialogue. The Host retains recordings after a disconnect and can release their roles for reassignment. A reconnecting player recovers their identity and roles while the Host app and room remain running. Explicitly leaving releases roles but keeps submitted takes.

Every player can choose **Watch dub** or **Export video**. The app downloads the selected takes from the Host, combines them with that player's local pack, and runs FFmpeg on that player's device. Watch Dub previews and MP4 exports are private to the player who requested them; the export is saved on that player's computer. The Host closes the room when finished. Rooms are temporary; the Host's project and uploaded takes remain in its local library after closing.

To try two players on one computer during development, run `bun run dev` in two terminals. Create a room in the first window, then click its listing in the second window or join using `127.0.0.1:4318`. Click **Download from Host** in the second window's room lobby. The first window keeps the usual dev library; each additional dev window gets its own user-data folder. Packaged builds still allow only one instance per Windows user.

**Windows Firewall:** Allow the app to accept inbound TCP connections on the selected room port and UDP on port `4319` for discovery on **Private networks**. If Windows asks when creating a room, allow Private access. On managed or Public networks, the Host may need an administrator to add inbound rules. Guest devices must reach the Host's displayed IPv4 address on the same LAN; router guest isolation, VPN routing, or firewall policy can block access. Manual IP entry still works when discovery is blocked. Anyone on the reachable LAN with the Host address can join; use the room only on a network you trust.

Supported packs follow the [official Dub Pack guide](https://thechoicervoicer.neocities.org/v2/content_guide/dub_packs) and the [Content Manager format notes](https://github.com/jojozagjos/Choicer-Voicer-Content-Manager/blob/main/docs/PACK_FORMATS.md): `dub_video.ogv`, WAV/MP3/OGG samples, `.ini`/`.cfg`/config `.txt` sidecars, optional plain `.txt` captions, images, pack info, and `_backing_track`. A sample with several `dub_timestamps` creates several dialogue instances. Missing timestamps are reported and those samples are skipped; a pack with no valid dialogue is rejected.

Folder imports retain a reference to the original folder, so it must remain accessible. ZIP imports are extracted into the app's private user-data area. Project, pack, and recording metadata are stored in `library.json`; audio files are stored in `recordings/<project ID>/` under Electron user data. The app does not modify source packs. OGV video is converted to a cached MP4 preview because current Chromium does not provide reliable Theora playback. The preview conversion may take time for large videos. The media protocol serves byte ranges so the player can seek promptly inside a large preview file. FFmpeg decodes short audio clips in the main process to produce waveform peaks; the renderer receives only those peaks.

Compatibility checks use small synthetic packs matching the documented format, including generated Theora OGV, WAV backing audio, and a WebM/Opus retake. No third-party community pack or physical microphone was available for an end-to-end UI recording test in this workspace. Packs with undocumented metadata layouts or unusual codecs remain unverified.

## Environment

Copy `apps/desktop/.env.example` to `apps/desktop/.env.local` to override the optional renderer display name. Renderer-visible variables use the `RENDERER_VITE_` prefix. Do not put secrets in renderer variables or the preload bridge.

## Windows distribution

`bun run dist:win` uses electron-builder to produce an unsigned NSIS installer. Code signing and publishing are left for a later release phase. The installer bundles `ffmpeg-static` for preview conversion and export; that binary is GPL-licensed, so redistribution must satisfy its license terms.
