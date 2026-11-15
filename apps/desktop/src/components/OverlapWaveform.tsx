import { useEffect, useId, useMemo, useState } from 'react'
import type { WaveformSnapshot } from '@studio/shared'

function loadLocalWaveform(projectId: string, dialogueId: string) {
  return window.studio.getWaveform(projectId, dialogueId)
}

function wavePath(peaks: number[], gain: number): string {
  if (!peaks.length) return ''
  const point = (index: number, upper: boolean) => {
    const x = (index / (peaks.length - 1)) * 1000
    const y = 70 + (upper ? -1 : 1) * Math.min(60, peaks[index] * gain)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }
  return `M${peaks.map((_, index) => point(index, true)).join(' L')} L${peaks.map((_, index) => point(peaks.length - 1 - index, false)).join(' L')} Z`
}

export function OverlapWaveform({
  projectId,
  dialogueId,
  cueSeconds,
  playbackSeconds,
  onSourceDuration,
  liveTakePeaks,
  loadWaveform = loadLocalWaveform,
}: {
  projectId: string
  dialogueId: string
  cueSeconds: number
  playbackSeconds: number
  onSourceDuration: (seconds: number) => void
  liveTakePeaks?: number[]
  loadWaveform?: (
    projectId: string,
    dialogueId: string,
  ) => Promise<WaveformSnapshot | null>
}) {
  const [snapshot, setSnapshot] = useState<WaveformSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const svgId = useId().replace(/:/g, '')
  useEffect(() => {
    let active = true
    loadWaveform(projectId, dialogueId).then(
      (value) => {
        if (!active || !value) return
        setSnapshot(value)
        onSourceDuration(value.sourceDurationSeconds)
        setError(null)
      },
      (reason) => {
        if (active)
          setError(reason instanceof Error ? reason.message : String(reason))
      },
    )
    return () => {
      active = false
    }
  }, [projectId, dialogueId, onSourceDuration, loadWaveform])

  const paths = useMemo(() => {
    const takePeaks = liveTakePeaks ?? snapshot?.take
    // Keep the source at one fixed scale while live microphone peaks arrive.
    const gain = 52 / Math.max(0.15, ...(snapshot?.original ?? []))
    return {
      original: snapshot ? wavePath(snapshot.original, gain) : '',
      take: takePeaks ? wavePath(takePeaks, gain) : '',
    }
  }, [snapshot, liveTakePeaks])
  const start = snapshot?.windowStartSeconds ?? 0
  const windowSeconds = snapshot?.windowSeconds ?? 1
  const cueX = (-start / windowSeconds) * 1000
  const endX = snapshot
    ? ((snapshot.sourceDurationSeconds - start) / windowSeconds) * 1000
    : cueX
  const trackStartX = Math.max(0, Math.min(1000, cueX))
  const trackEndX = Math.max(trackStartX, Math.min(1000, endX))
  const playheadX = Math.max(
    0,
    Math.min(
      1000,
      ((playbackSeconds - cueSeconds - start) / windowSeconds) * 1000,
    ),
  )

  return (
    <section
      aria-label="Overlap waveform"
      className="waveform-panel rounded-2xl border border-primary/70 bg-card p-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.1em]">
        <div className="flex items-center gap-3">
          <h2 className="text-primary">Overlap waveform</h2>
          <span className="text-fuchsia-400">■ Original</span>
          <span className="text-cyan-300">
            ■ {liveTakePeaks ? 'Live take' : 'Your take'}
          </span>
        </div>
        <span className="text-muted-foreground">
          {snapshot
            ? `${windowSeconds.toFixed(2)}s window`
            : 'Preparing waveform'}
        </span>
      </div>
      <svg
        viewBox="0 0 1000 140"
        preserveAspectRatio="none"
        role="img"
        aria-label={
          liveTakePeaks || snapshot?.take
            ? 'Original and take waveforms aligned to the cue'
            : 'Original clip waveform; no selected take yet'
        }
        className="waveform-plot h-32 w-full"
      >
        <defs>
          <pattern
            id={`${svgId}-grid`}
            width="50"
            height="35"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 50 0 L 0 0 0 35"
              fill="none"
              stroke="#1c4146"
              strokeWidth="1"
            />
          </pattern>
          <clipPath id={`${svgId}-track`}>
            <rect
              x={trackStartX}
              y="0"
              width={trackEndX - trackStartX}
              height="140"
            />
          </clipPath>
        </defs>
        <rect width="1000" height="140" fill="#071113" />
        <rect width="1000" height="140" fill={`url(#${svgId}-grid)`} />
        <path d="M0 70 H1000" stroke="#366166" strokeWidth="1" />
        <g clipPath={`url(#${svgId}-track)`}>
          {snapshot && (
            <path
              d={paths.original}
              fill="#dd27ac33"
              stroke="#ed3bc1"
              strokeWidth="1.5"
            />
          )}
          {(liveTakePeaks || snapshot?.take) && (
            <path
              d={paths.take}
              fill="#26c9e833"
              stroke="#46e4f4"
              strokeWidth="1.5"
            />
          )}
        </g>
        <path
          d={`M${cueX} 0 V140`}
          stroke="#f23b9b"
          strokeWidth="2"
          strokeDasharray="5 4"
        />
        {snapshot && (
          <path
            d={`M${endX} 0 V140`}
            stroke="#f23b9b"
            strokeWidth="2"
            strokeDasharray="5 4"
          />
        )}
        <path
          d={`M${playheadX} 0 V140`}
          stroke="#b8ffea"
          strokeWidth="2"
          opacity="0.8"
        />
      </svg>
      <div className="mt-2 flex justify-between text-[10px] font-semibold text-muted-foreground">
        <span>{start.toFixed(1)}s</span>
        <span>0.0s cue</span>
        <span>+{(start + windowSeconds).toFixed(1)}s</span>
      </div>
      {!snapshot && !error && (
        <p className="mt-2 text-xs text-muted-foreground">Loading waveform…</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-amber-200">
          Waveform unavailable: {error}
        </p>
      )}
      {snapshot?.warning && (
        <p role="alert" className="mt-2 text-xs text-amber-200">
          {snapshot.warning}
        </p>
      )}
    </section>
  )
}
