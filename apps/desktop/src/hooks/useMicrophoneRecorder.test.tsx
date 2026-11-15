import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { useMicrophoneRecorder } from './useMicrophoneRecorder'

afterEach(() => {
  cleanup()
  window.localStorage.removeItem('studio.microphone-settings.v1')
})

it('keeps microphone choices when the recorder remounts for another clip', () => {
  const first = renderHook(useMicrophoneRecorder)
  act(() => {
    first.result.current.setDeviceId('selected-microphone')
    first.result.current.setInputVolume(325)
    first.result.current.setAutomaticVolume(true)
    first.result.current.setNoiseReduction(false)
    first.result.current.setEchoCancellation(true)
    first.result.current.setVoiceIsolation(true)
  })
  first.unmount()

  const nextClip = renderHook(useMicrophoneRecorder)
  expect(nextClip.result.current).toMatchObject({
    deviceId: 'selected-microphone',
    inputVolume: 325,
    automaticVolume: true,
    noiseReduction: false,
    echoCancellation: true,
    voiceIsolation: true,
  })
})

it('uses safe defaults when stored microphone settings are invalid', () => {
  window.localStorage.setItem(
    'studio.microphone-settings.v1',
    JSON.stringify({
      deviceId: 123,
      inputVolume: 99999,
      noiseReduction: 'off',
    }),
  )
  const recorder = renderHook(useMicrophoneRecorder)
  expect(recorder.result.current).toMatchObject({
    deviceId: '',
    inputVolume: 100,
    automaticVolume: false,
    noiseReduction: true,
    echoCancellation: false,
    voiceIsolation: false,
  })
})
