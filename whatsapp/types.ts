/**
 * Shared types for the EventStake WhatsApp agent.
 */

// ---------------------------------------------------------------------------
// Intents the LLM can return
// ---------------------------------------------------------------------------

export type Intent =
  | { action: 'list_events' }
  | { action: 'show_event'; eventId: number }
  | { action: 'register'; eventId: number }
  | { action: 'checkin'; eventId: number; preimage: string }
  | { action: 'my_record' }
  | { action: 'my_balance' }
  | { action: 'organiser_summary'; eventId: number }
  | { action: 'pool_balance' }
  | { action: 'unknown' }

// ---------------------------------------------------------------------------
// Pending confirmation (waiting for YES/NO)
// ---------------------------------------------------------------------------

export type PendingConfirmation = {
  intent: Intent
  promptSent: string      // The "Reply YES to confirm" message we sent
  expiresAt: number       // Unix ms — discard after 5 minutes
}

// ---------------------------------------------------------------------------
// Per-user session (keyed by E.164 phone number)
// ---------------------------------------------------------------------------

export type Session = {
  phone: string           // E.164, e.g. +2348012345678
  walletAddress?: string  // Set after first wallet creation
  walletId?: string       // Circle wallet ID
  pending?: PendingConfirmation
}
