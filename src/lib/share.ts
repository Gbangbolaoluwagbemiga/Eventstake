export function getShareBase(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin
  }
  return ''
}

export function buildShareLink(path: string): string {
  return `${getShareBase()}${path}`
}
