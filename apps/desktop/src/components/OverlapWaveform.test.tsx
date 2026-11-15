import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi } from '@studio/shared'
import { OverlapWaveform } from './OverlapWaveform'

afterEach(cleanup)

describe('overlap waveform', () => {
  it('ignores a waveform cancelled by room teardown', async () => {
    const onSourceDuration = vi.fn()
    const loadWaveform = vi.fn().mockResolvedValue(null)
    render(
      <OverlapWaveform
        projectId="project"
        dialogueId="dialogue"
        cueSeconds={0}
        playbackSeconds={0}
        onSourceDuration={onSourceDuration}
        loadWaveform={loadWaveform}
      />,
    )

    await waitFor(() => expect(loadWaveform).toHaveBeenCalledOnce())
    expect(onSourceDuration).not.toHaveBeenCalled()
    expect(screen.queryByText(/Waveform unavailable:/)).not.toBeInTheDocument()
  })

  it('marks both track edges and clips source and take waves to them', async () => {
    window.studio = {
      getWaveform: async () => ({
        sourceDurationSeconds: 2,
        windowStartSeconds: -1,
        windowSeconds: 4,
        original: [0.8, 0.8, 0.8, 0.8],
        take: [0.8, 0.8, 0.8, 0.8],
      }),
    } as unknown as DesktopApi
    const { container } = render(
      <OverlapWaveform
        projectId="project"
        dialogueId="dialogue"
        cueSeconds={5}
        playbackSeconds={4}
        onSourceDuration={vi.fn()}
      />,
    )

    await waitFor(() =>
      expect(container.querySelectorAll('path[stroke="#f23b9b"]')).toHaveLength(
        2,
      ),
    )
    expect(
      Array.from(container.querySelectorAll('path[stroke="#f23b9b"]')).map(
        (path) => path.getAttribute('d'),
      ),
    ).toEqual(['M250 0 V140', 'M750 0 V140'])
    const clip = container.querySelector('clipPath rect')
    expect(clip).toHaveAttribute('x', '250')
    expect(clip).toHaveAttribute('width', '500')
    const waves = container.querySelector('g[clip-path]')
    expect(waves?.querySelectorAll('path')).toHaveLength(2)
    expect(waves?.getAttribute('clip-path')).toContain('-track')
  })

  it('shows decoded source and selected-take paths and reports the source duration', async () => {
    const onSourceDuration = vi.fn()
    window.studio = {
      getWaveform: async () => ({
        sourceDurationSeconds: 1.5,
        windowStartSeconds: 0,
        windowSeconds: 2,
        original: [0, 0.4, 0.7, 0.1],
        take: [0, 0, 0.5, 0.2],
      }),
    } as unknown as DesktopApi
    const { container, rerender } = render(
      <OverlapWaveform
        projectId="project"
        dialogueId="dialogue"
        cueSeconds={2}
        playbackSeconds={2}
        onSourceDuration={onSourceDuration}
      />,
    )
    await waitFor(() =>
      expect(container.querySelector('path[stroke="#46e4f4"]')).not.toBeNull(),
    )
    expect(container.querySelector('path[stroke="#ed3bc1"]')).not.toBeNull()
    expect(screen.getByLabelText('Overlap waveform')).toHaveTextContent(
      'Your take',
    )
    expect(onSourceDuration).toHaveBeenCalledWith(1.5)
    rerender(
      <OverlapWaveform
        projectId="project"
        dialogueId="dialogue"
        cueSeconds={2}
        playbackSeconds={4}
        onSourceDuration={onSourceDuration}
      />,
    )
    expect(
      container.querySelector('path[stroke="#b8ffea"]')?.getAttribute('d'),
    ).toBe('M1000 0 V140')
  })

  it('draws incoming microphone peaks before a saved take exists', async () => {
    window.studio = {
      getWaveform: async () => ({
        sourceDurationSeconds: 1,
        windowStartSeconds: 0,
        windowSeconds: 1,
        original: [0, 0.2, 0.4, 0],
        take: null,
      }),
    } as unknown as DesktopApi
    const { container, rerender } = render(
      <OverlapWaveform
        projectId="project"
        dialogueId="dialogue"
        cueSeconds={2}
        playbackSeconds={2}
        onSourceDuration={vi.fn()}
        liveTakePeaks={[0, 0, 0, 0]}
      />,
    )
    await waitFor(() =>
      expect(screen.getByText('■ Live take')).toBeInTheDocument(),
    )
    const initialPath = container
      .querySelector('path[stroke="#46e4f4"]')
      ?.getAttribute('d')
    const originalPath = container
      .querySelector('path[stroke="#ed3bc1"]')
      ?.getAttribute('d')
    rerender(
      <OverlapWaveform
        projectId="project"
        dialogueId="dialogue"
        cueSeconds={2}
        playbackSeconds={2.5}
        onSourceDuration={vi.fn()}
        liveTakePeaks={[0, 0.5, 0.7, 0]}
      />,
    )
    expect(
      container.querySelector('path[stroke="#46e4f4"]')?.getAttribute('d'),
    ).not.toBe(initialPath)
    expect(
      container.querySelector('path[stroke="#ed3bc1"]')?.getAttribute('d'),
    ).toBe(originalPath)
    expect(
      container.querySelector('path[stroke="#b8ffea"]')?.getAttribute('d'),
    ).toBe('M500 0 V140')
  })
})
