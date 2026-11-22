import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatBytes(size: number): string {
  const units = [
    [1024 ** 3, 'GB'],
    [1024 ** 2, 'MB'],
    [1024, 'KB'],
  ] as const
  const unit = units.find(([divisor]) => size >= divisor)
  return unit ? `${(size / unit[0]).toFixed(1)} ${unit[1]}` : `${size} B`
}
