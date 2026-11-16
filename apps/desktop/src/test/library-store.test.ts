// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseDubPack } from '@studio/shared'
import { LibraryStore } from '../../electron/library-store'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'studio-library-test-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('local pack library', () => {
  it('persists pack references, project metadata, and multiple selected roles', async () => {
    const pack = parseDubPack({
      id: 'pack-1',
      source: { kind: 'folder', location: 'C:/packs/Scene' },
      folderName: 'Scene',
      files: [
        { path: 'dub_video.ogv' },
        { path: '01_Line.wav' },
        {
          path: '01_Line.ini',
          text: '[data]\ndub_timestamps=[1]\ndub_characters=["Alice", "Bob"]',
        },
      ],
    })
    const store = new LibraryStore(root)
    await store.savePack(pack)
    const listed = await store.listPacks()
    listed[0].metadata.title = 'Changed only in caller'
    expect((await store.listPacks())[0].metadata.title).toBe('Scene')
    const project = await store.createProject(pack.id)
    const updated = await store.updateRoles(project.id, [
      pack.characters[1].id,
      pack.characters[0].id,
    ])
    expect(updated.enabledCharacterIds).toHaveLength(2)

    const reopened = new LibraryStore(root)
    expect((await reopened.listPacks())[0].metadata.title).toBe('Scene')
    expect((await reopened.listProjects())[0].enabledCharacterIds).toEqual(
      updated.enabledCharacterIds,
    )
  })

  it('reports corrupt local state without overwriting it', async () => {
    await writeFile(join(root, 'library.json'), '{bad')
    const store = new LibraryStore(root)
    await expect(store.listPacks()).rejects.toThrow('could not be read')
    await expect(store.createProject('unknown')).rejects.toThrow(
      'could not be read',
    )
  })

  it('removes a pack and all its projects and takes together', async () => {
    const pack = parseDubPack({
      id: 'pack-1',
      source: { kind: 'zip', location: 'C:/packs/Scene.zip' },
      folderName: 'Scene',
      files: [
        { path: 'dub_video.ogv' },
        { path: 'line.wav' },
        {
          path: 'line.ini',
          text: '[data]\ndub_timestamps=[1]\ndub_characters=["Alice"]',
        },
      ],
    })
    const store = new LibraryStore(root)
    await store.savePack(pack)
    const project = await store.createProject(pack.id)
    const secondProject = await store.createProject(pack.id)
    const take = {
      id: '00000000-0000-4000-8000-000000000011',
      projectId: project.id,
      dialogueId: pack.dialogues[0].id,
      fileRef: '00000000-0000-4000-8000-000000000011.webm',
      mimeType: 'audio/webm',
      durationSeconds: 1,
      offsetSeconds: 0,
      createdAt: new Date().toISOString(),
      selected: true,
    }
    await store.addTake(take)
    const secondTake = {
      ...take,
      id: '00000000-0000-4000-8000-000000000012',
      projectId: secondProject.id,
      fileRef: '00000000-0000-4000-8000-000000000012.webm',
    }
    await store.addTake(secondTake)
    const otherPack = { ...pack, id: 'pack-2' }
    await store.savePack(otherPack)
    const otherProject = await store.createProject(otherPack.id)
    expect(await store.removePack(pack.id)).toEqual({
      pack,
      projectIds: [project.id, secondProject.id],
    })
    expect(await store.listTakes(project.id)).toEqual([])
    expect(await store.listTakes(secondProject.id)).toEqual([])
    expect(await store.listProjects()).toEqual([otherProject])
    expect(await store.listPacks()).toEqual([otherPack])
  })
})
