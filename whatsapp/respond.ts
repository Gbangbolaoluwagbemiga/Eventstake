/**
 * Plain-language reply builder.
 *
 * Every public function returns a string that gets sent back to the user
 * via WhatsApp. No HTML, no markdown — just plain text.
 *
 * Tone: clear, warm, short. Not formal. Never technical jargon.
 * "Your stake" not "your deposited USDC collateral."
 * "You are registered" not "Registration transaction confirmed."
 */

import type { EventData, CreditScore, UserRecord } from './chain.js'

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' })
}

function fmtUsdc(amount: string): string {
  const n = parseFloat(amount)
  return `${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)} USDC`
}

function fmtEventLine(e: EventData): string {
  return `${e.id}. ${e.name} — ${fmtDate(e.eventDate)} — stake ${fmtUsdc(e.stakeAmount_usdc)} — ${e.spotsLeft} spot${e.spotsLeft !== 1 ? 's' : ''} left`
}

// ---------------------------------------------------------------------------
// Informational replies (no money moves)
// ---------------------------------------------------------------------------

export function replyWelcome(address: string): string {
  return (
    `Welcome to EventStake! Your wallet has been created.\n\n` +
    `Your address: ${address}\n\n` +
    `You control the funds in this wallet. Nobody else can move your money.\n\n` +
    `What can I do for you?\n` +
    `- See open events: say "show events"\n` +
    `- Check your balance: say "my balance"\n` +
    `- Check your score: say "my score"`
  )
}

export function replyKnownUser(address: string): string {
  return `Your wallet: ${address}\n\nWhat can I do for you?`
}

export function replyOpenEvents(events: EventData[]): string {
  if (events.length === 0) {
    return 'No events are open for registration right now. Check back soon.'
  }
  const lines = events.map(fmtEventLine).join('\n')
  return `Open events:\n\n${lines}\n\nReply with the event number or name to register.`
}

export function replyEventDetail(e: EventData): string {
  return (
    `${e.name}\n` +
    `Date: ${fmtDate(e.eventDate)}\n` +
    `Stake: ${fmtUsdc(e.stakeAmount_usdc)}\n` +
    `Registered: ${e.registeredCount} / ${e.maxAttendees}\n` +
    `Spots left: ${e.spotsLeft}\n\n` +
    `Say "register for ${e.id}" to join, or "cover for ${e.id}" if you need the pool to cover your stake.`
  )
}

export function replyRecord(record: UserRecord, score: CreditScore): string {
  const attended = `${record.eventsAttended} of ${record.eventsRegistered} events attended`
  const scoreStr = score.label === 'new'
    ? 'Score: new — not enough history yet'
    : `Score: ${score.score}/100 (${score.label})`
  const extra: string[] = []
  if (record.hasOutstandingCover) extra.push('You have a covered stake open right now.')
  if (record.bannedFromCover) extra.push('You missed a covered event. Attend one paid event to restore cover eligibility.')
  return [scoreStr, attended, score.explanation, ...extra].filter(Boolean).join('\n')
}

export function replyBalance(balance: string, address: string): string {
  return `Balance: ${fmtUsdc(balance)}\n\nWallet: ${address}`
}

export function replyPoolBalance(balance: string, stakesCanCover: number, stakeUsdc?: string): string {
  const canCoverLine = stakeUsdc
    ? `\nAt ${fmtUsdc(stakeUsdc)} per stake, it can cover ${stakesCanCover} more attendee${stakesCanCover !== 1 ? 's' : ''}.`
    : ''
  return `Sponsor pool: ${fmtUsdc(balance)}${canCoverLine}`
}

export function replyOrganiserSummary(e: EventData, organiserCredits: string): string {
  return (
    `${e.name} (event ${e.id})\n` +
    `Registered: ${e.registeredCount}\n` +
    `Checked in: ${e.checkedInCount}\n` +
    `No-shows so far: ${e.registeredCount - e.checkedInCount}\n` +
    (organiserCredits !== '0' ? `\nYour unclaimed earnings: ${fmtUsdc(organiserCredits)}. Say "withdraw" to collect.` : '')
  )
}

export function replyNoCoverEligible(reason: string): string {
  return `The sponsor pool cannot cover you right now: ${reason}`
}

// ---------------------------------------------------------------------------
// Confirmation prompts (money moves require YES)
// ---------------------------------------------------------------------------

export function confirmRegister(e: EventData): string {
  return (
    `Register you for ${e.name} on ${fmtDate(e.eventDate)} and stake ${fmtUsdc(e.stakeAmount_usdc)}.\n\n` +
    `Reply YES to confirm. Anything else cancels.`
  )
}

export function confirmCover(e: EventData): string {
  return (
    `Ask the sponsor pool to cover your ${fmtUsdc(e.stakeAmount_usdc)} stake for ${e.name} on ${fmtDate(e.eventDate)}.\n\n` +
    `If approved, you are registered. Check in at the door and the pool gets repaid automatically.\n\n` +
    `Reply YES to confirm. Anything else cancels.`
  )
}

export function confirmCheckIn(e: EventData): string {
  return (
    `Check you in for ${e.name}.\n\n` +
    `Reply YES to confirm. Anything else cancels.`
  )
}

// ---------------------------------------------------------------------------
// Post-action replies
// ---------------------------------------------------------------------------

export function replyRegistered(e: EventData): string {
  return (
    `You are registered. ${fmtUsdc(e.stakeAmount_usdc)} is held.\n\n` +
    `Show up on ${fmtDate(e.eventDate)} and send me the code at the door to get it back.`
  )
}

export function replyCoverGranted(e: EventData): string {
  return (
    `Cover approved. You are registered for ${e.name} on ${fmtDate(e.eventDate)}.\n\n` +
    `Show up and send me the code at the door. Your stake will be repaid from the pool automatically when you check in.`
  )
}

export function replyCoverDenied(reason: string): string {
  return `Cover was not granted: ${reason}`
}

export function replyCheckedIn(e: EventData): string {
  return (
    `Checked in. Your stake is on its way back to your wallet.\n\n` +
    `You will receive a proof-of-attendance NFT for ${e.name}.`
  )
}

export function replyCheckInFailed(reason: string): string {
  return `Check-in failed: ${reason}\n\nMake sure you are sending the exact code from the organiser.`
}

export function replyConfirmationExpired(): string {
  return 'That confirmation has expired. Please start again.'
}

export function replyCancelled(): string {
  return 'Cancelled. Nothing was sent. What would you like to do?'
}

export function replyUnknown(): string {
  return (
    `I did not understand that.\n\n` +
    `Here is what I can do:\n` +
    `- "show events" — see what is open\n` +
    `- "register for [event name or number]" — join an event\n` +
    `- "i don reach" + your code — check in at the door\n` +
    `- "my score" — see your attendance record\n` +
    `- "my balance" — see your USDC\n` +
    `- "pool balance" — see the sponsor pool\n` +
    `- "event [number]" — details on one event`
  )
}

export function replyError(detail: string): string {
  return `Something went wrong: ${detail}\n\nTry again or say "help".`
}

export function replyTxPending(): string {
  return 'Your transaction is being processed. I will let you know when it is done.'
}
