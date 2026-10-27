/**
 * In-process session + phone->wallet store.
 *
 * In production, replace with Redis or a small SQLite/Postgres table.
 * The interface is intentionally simple so swapping is a one-file change.
 */

import type { Session } from './types.js'

const sessions = new Map<string, Session>()

export function getSession(phone: string): Session {
  let s = sessions.get(phone)
  if (!s) {
    s = { phone }
    sessions.set(phone, s)
  }
  return s
}

export function saveSession(session: Session): void {
  sessions.set(session.phone, session)
}

export function clearPending(phone: string): void {
  const s = sessions.get(phone)
  if (s) {
    s.pending = undefined
    sessions.set(phone, s)
  }
}
