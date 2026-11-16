import { describe, expect, it } from 'vitest'
import {
  DubPackSchema,
  PackValidationError,
  dialogueMatchesRoles,
  parseDubPack,
  selectRoles,
  type PackFile,
} from '@studio/shared'

const source = { kind: 'folder' as const, location: 'C:/packs/Scene' }

function parse(files: PackFile[]) {
  return parseDubPack({ id: 'pack-1', source, folderName: 'Scene', files })
}

describe('Dub Pack parsing', () => {
  it('reads documented metadata, characters, captions, images, and backing track', () => {
    const pack = parse([
      { path: 'dub_video.ogv' },
      {
        path: '_pack_info.ini',
        text: '[data]\ntitle="A Scene"\nsubtitle="An episode"\nauthors=["A", "B"]\nreadme="Hello"\nicon="_icon"',
      },
      { path: '_icon.png' },
      { path: '_backing_track.MP3' },
      { path: '01_Hello.wav' },
      {
        path: '01_Hello.ini',
        text: '[data]\ncaption="From config"\nimage="face"\ndub_timestamps=[1.866]\ndub_characters=["Narrator"]',
      },
      { path: '01_Hello.txt', text: 'From text sidecar' },
      { path: 'face.jpg' },
    ])

    expect(pack.metadata).toEqual({
      title: 'A Scene',
      subtitle: 'An episode',
      authors: ['A', 'B'],
      readme: 'Hello',
    })
    expect(pack.iconRef).toBe('_icon.png')
    expect(pack.backingTrackRef).toBe('_backing_track.MP3')
    expect(pack.characters).toEqual([
      { id: 'character:narrator', name: 'Narrator', inferred: false },
    ])
    expect(pack.dialogues[0]).toMatchObject({
      timestampSeconds: 1.866,
      caption: 'From text sidecar',
      imageRef: 'face.jpg',
      sourceRef: '01_Hello.wav',
    })
  })

  it('creates a stable dialogue instance for every timestamp on one audio sample', () => {
    const files: PackFile[] = [
      { path: 'dub_video.ogv' },
      { path: '01_Repeat.ogg' },
      {
        path: '01_Repeat.txt',
        text: '[data]\ndub_timestamps=[12.966, 00:18, 1:02.5]\ndub_characters=["Alice", "Bob"]\ncaption="Again"',
      },
    ]
    const first = parse(files)
    const second = parse(files)
    expect(
      first.dialogues.map((dialogue) => dialogue.timestampSeconds),
    ).toEqual([12.966, 18, 62.5])
    expect(first.dialogues.map((dialogue) => dialogue.id)).toEqual(
      second.dialogues.map((dialogue) => dialogue.id),
    )
    expect(new Set(first.dialogues.map((dialogue) => dialogue.id)).size).toBe(3)
    expect(
      first.dialogues.every(
        (dialogue) => dialogue.sourceRef === '01_Repeat.ogg',
      ),
    ).toBe(true)
    expect(first.characters.map((character) => character.name)).toEqual([
      'Alice',
      'Bob',
    ])
  })

  it('accepts alternate video extensions and rejects ambiguous videos', () => {
    const dialogue = [
      { path: '01_Line.wav' },
      { path: '01_Line.ini', text: '[data]\ndub_timestamps=[1]' },
    ]
    expect(parse([{ path: 'dub_video.MP4' }, ...dialogue]).videoRef).toBe(
      'dub_video.MP4',
    )
    expect(parse([{ path: 'dub_video.mkv' }, ...dialogue]).videoRef).toBe(
      'dub_video.mkv',
    )
    expect(() =>
      parse([{ path: 'dub_video.ogv' }, { path: 'dub_video.mp4' }, ...dialogue]),
    ).toThrow('exactly one video')
  })

  it('accepts cfg metadata and real-world author and subtitle text sidecars', () => {
    const pack = parse([
      { path: 'dub_video.ogv' },
      { path: '_author.txt', text: 'Maker' },
      { path: '_subtitle.txt', text: 'Short subtitle' },
      { path: '_pack_filler_image.png' },
      { path: '01_Line.mp3' },
      {
        path: '01_Line.cfg',
        text: '[data]\ndub_timestamps=[00:02]\ncaption="Line"',
      },
    ])
    expect(pack.metadata).toMatchObject({
      title: 'Scene',
      subtitle: 'Short subtitle',
      authors: ['Maker'],
    })
    expect(pack.dialogues[0]).toMatchObject({
      imageRef: '_pack_filler_image.png',
      timestampSeconds: 2,
    })
    expect(pack.characters[0]).toMatchObject({
      name: 'Unassigned',
      inferred: true,
    })
  })

  it('rejects invalid or unsupported packs without inventing timestamps', () => {
    expect(() => parse([{ path: 'movie.mp4' }])).toThrow(PackValidationError)
    expect(() =>
      parse([{ path: 'dub_video.ogv' }, { path: '01_Line.wav' }]),
    ).toThrow('No valid dialogue timestamps')
    expect(() =>
      parse([
        { path: 'dub_video.ogv' },
        { path: '01_Line.wav' },
        { path: '01_Line.ini', text: '[data]\ndub_timestamps=[bad]' },
      ]),
    ).toThrow('No valid dialogue timestamps')
  })

  it('validates normalized references and unique dialogue IDs', () => {
    const pack = parse([
      { path: 'dub_video.ogv' },
      { path: '01_Line.wav' },
      {
        path: '01_Line.ini',
        text: '[data]\ndub_timestamps=[1]\ndub_characters=["A"]',
      },
    ])
    expect(
      DubPackSchema.safeParse({
        ...pack,
        dialogues: [...pack.dialogues, pack.dialogues[0]],
      }).success,
    ).toBe(false)
    expect(
      DubPackSchema.safeParse({
        ...pack,
        dialogues: [{ ...pack.dialogues[0], characterIds: ['missing'] }],
      }).success,
    ).toBe(false)
    expect(
      DubPackSchema.safeParse({ ...pack, videoRef: '../outside.ogv' }).success,
    ).toBe(false)
  })
})

describe('local role selection', () => {
  const project = {
    id: 'project-1',
    packId: 'pack-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    enabledCharacterIds: ['a'],
  }

  it('supports multiple roles, deduplicates choices, and filters dialogues', () => {
    const updated = selectRoles(project, ['a', 'b'], ['a', 'b', 'a'])
    expect(updated.enabledCharacterIds).toEqual(['a', 'b'])
    expect(
      dialogueMatchesRoles(
        {
          id: 'line',
          sourceRef: 'line.wav',
          occurrenceIndex: 0,
          timestampSeconds: 1,
          characterIds: ['b'],
        },
        updated.enabledCharacterIds,
      ),
    ).toBe(true)
    expect(
      dialogueMatchesRoles(
        {
          id: 'line2',
          sourceRef: 'line.wav',
          occurrenceIndex: 0,
          timestampSeconds: 2,
          characterIds: ['b'],
        },
        [],
      ),
    ).toBe(false)
  })

  it('rejects roles outside the pack', () => {
    expect(() => selectRoles(project, ['a'], ['missing'])).toThrow(
      'unknown character',
    )
  })
})
