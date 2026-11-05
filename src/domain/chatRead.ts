export interface ReadRect { top: number; bottom: number; left: number; right: number }
// Reading is acknowledgement of a visible message ending, not proof that the
// whole text was read. Long messages need their last 80px visible as well.
export function readableTail(message: ReadRect, clip: ReadRect): ReadRect | null {
  const top = Math.max(message.top, message.bottom - 80)
  if (![message.top, message.bottom, message.left, message.right, clip.top, clip.bottom, clip.left, clip.right].every(Number.isFinite)
    || message.bottom <= message.top || message.right <= message.left || top < clip.top || message.bottom > clip.bottom
    || message.left < clip.left || message.right > clip.right) return null
  return { top, bottom: message.bottom, left: message.left, right: message.right }
}
