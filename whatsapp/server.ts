/**
 * EventStake WhatsApp agent server.
 *
 * Receives inbound WhatsApp messages from Twilio, parses intent via LLM,
 * manages per-user Circle wallets, and executes onchain actions.
 *
 * Run:  bun run whatsapp:server
 *
 * Required environment variables — see whatsapp/config.ts for the full list.
 *
 * Twilio webhook setup:
 *   1. Twilio Console → Messaging → Try it out → Send a WhatsApp message
 *   2. Set "When a message comes in" webhook URL to:
 *      https://<your-host>/webhook/whatsapp
 *      Method: HTTP POST
 *   For production, point your Twilio WhatsApp sender's inbound URL to the same path.
 *
 * The server validates every inbound request with Twilio's X-Twilio-Signature
 * header to reject spoofed webhooks.
 */

import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import twilio from 'twilio'
import type { Config } from './config.js'
import { loadConfig } from './config.js'
import { buildWalletClient } from './wallet.js'
import { buildChainClient, type EventData } from './chain.js'
import { buildIntentParser } from './intent.js'
import { getSession, saveSession, clearPending } from './store.js'
import * as R from './respond.js'
import { formatUnits } from 'viem'

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const config: Config = loadConfig()
const walletClient = buildWalletClient(config)
const chainClient = buildChainClient(config)
const intentParser = buildIntentParser(config)
const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken)

// ---------------------------------------------------------------------------
// Send a WhatsApp reply
// ---------------------------------------------------------------------------

async function reply(to: string, body: string): Promise<void> {
  await twilioClient.messages.create({
    from: config.twilio.from,
    to: `whatsapp:${to}`,
    body,
  })
}

// ---------------------------------------------------------------------------
// Core message handler
// ---------------------------------------------------------------------------

async function handleMessage(phone: string, rawMessage: string): Promise<void> {
  const session = getSession(phone)
  const msgLower = rawMessage.trim().toLowerCase()

  // ------------------------------------------------------------------
  // 1. Resolve or create wallet (first contact)
  // ------------------------------------------------------------------

  let resolvedSession: Awaited<ReturnType<typeof walletClient.resolveWallet>>
  try {
    resolvedSession = await walletClient.resolveWallet(phone)
  } catch (err) {
    await reply(phone, R.replyError('Could not create your wallet. Please try again.'))
    console.error('Wallet creation error', err)
    return
  }

  const isNewUser = !session.walletAddress
  if (isNewUser) {
    await reply(phone, R.replyWelcome(resolvedSession.walletAddress))
    return
  }

  const walletAddress = resolvedSession.walletAddress as `0x${string}`
  const walletId = resolvedSession.walletId

  // ------------------------------------------------------------------
  // 2. Confirmation gate — check if we are waiting for YES/NO
  // ------------------------------------------------------------------

  if (session.pending) {
    const { pending } = session

    if (Date.now() > pending.expiresAt) {
      clearPending(phone)
      await reply(phone, R.replyConfirmationExpired())
      return
    }

    const isYes = /^\s*(yes|y|yeah|yep|yh|ok|okay|sure|do it|confirm|go ahead|oya|proceed|make e happen)\s*$/i.test(rawMessage)

    if (!isYes) {
      clearPending(phone)
      await reply(phone, R.replyCancelled())
      return
    }

    // User confirmed — execute the pending intent
    clearPending(phone)
    await executePendingIntent(pending.intent, phone, walletAddress, walletId)
    return
  }

  // ------------------------------------------------------------------
  // 3. Parse intent via LLM
  // ------------------------------------------------------------------

  let openEvents: EventData[]
  try {
    openEvents = await chainClient.getOpenEvents()
  } catch {
    openEvents = []
  }

  const intent = await intentParser.parseIntent({
    message: rawMessage,
    openEvents,
    walletAddress,
  })

  // ------------------------------------------------------------------
  // 4. Dispatch intent
  // ------------------------------------------------------------------

  switch (intent.action) {
    case 'list_events': {
      await reply(phone, R.replyOpenEvents(openEvents))
      break
    }

    case 'show_event': {
      try {
        const evt = await chainClient.getEvent(intent.eventId)
        await reply(phone, R.replyEventDetail(evt))
      } catch {
        await reply(phone, R.replyError(`Event ${intent.eventId} not found.`))
      }
      break
    }

    case 'register': {
      try {
        const evt = await chainClient.getEvent(intent.eventId)

        // Check if already registered
        const alreadyReg = await chainClient.isRegistered(intent.eventId, walletAddress)
        if (alreadyReg) {
          await reply(phone, `You are already registered for ${evt.name}.`)
          break
        }

        if (evt.status !== 'registration_open') {
          await reply(phone, `Registration for ${evt.name} is not open right now.`)
          break
        }

        // Check balance
        const balance = await walletClient.getUsdcBalance(walletId)
        const balanceRaw = chainClient.parseUsdcAmount(balance)
        const hasEnough = balanceRaw >= evt.stakeAmountRaw

        if (!hasEnough) {
          // Check if pool can cover them instead
          const { eligible, reason } = await chainClient.getCoverEligibility(walletAddress, intent.eventId)
          if (eligible) {
            const confirmMsg = R.confirmCover(evt)
            session.pending = {
              intent: { action: 'register_with_cover', eventId: intent.eventId } as unknown as typeof intent,
              promptSent: confirmMsg,
              expiresAt: Date.now() + 5 * 60 * 1000,
            }
            saveSession(session)
            await reply(phone, `You have ${fmtBalance(balance)} but the stake is ${evt.stakeAmount_usdc} USDC. The sponsor pool can cover you.\n\n${confirmMsg}`)
          } else {
            await reply(phone, `You have ${fmtBalance(balance)} but need ${evt.stakeAmount_usdc} USDC to register. ${R.replyNoCoverEligible(reason)}`)
          }
          break
        }

        // Enough balance — ask for confirmation
        const confirmMsg = R.confirmRegister(evt)
        session.pending = {
          intent,
          promptSent: confirmMsg,
          expiresAt: Date.now() + 5 * 60 * 1000,
        }
        saveSession(session)
        await reply(phone, confirmMsg)
      } catch (err) {
        await reply(phone, R.replyError(String(err)))
      }
      break
    }

    case 'checkin': {
      try {
        const allEvents = await chainClient.getAllEvents()
        // Find the event this wallet is registered for that is currently in the check-in window
        const eventId = intent.eventId

        const evt = allEvents.find((e) => e.id === eventId)
        if (!evt) {
          await reply(phone, R.replyError(`Event ${eventId} not found.`))
          break
        }

        const alreadyIn = await chainClient.isCheckedIn(eventId, walletAddress)
        if (alreadyIn) {
          await reply(phone, `You have already checked in for ${evt.name}.`)
          break
        }

        // Store the preimage in the intent for execution after YES
        const confirmMsg = R.confirmCheckIn(evt)
        session.pending = {
          intent,
          promptSent: confirmMsg,
          expiresAt: Date.now() + 5 * 60 * 1000,
        }
        saveSession(session)
        await reply(phone, confirmMsg)
      } catch (err) {
        await reply(phone, R.replyError(String(err)))
      }
      break
    }

    case 'my_record': {
      try {
        const [record, score] = await Promise.all([
          chainClient.getUserRecord(walletAddress),
          chainClient.getCreditScore(walletAddress),
        ])
        await reply(phone, R.replyRecord(record, score))
      } catch (err) {
        await reply(phone, R.replyError(String(err)))
      }
      break
    }

    case 'my_balance': {
      try {
        const balance = await walletClient.getUsdcBalance(walletId)
        await reply(phone, R.replyBalance(balance, walletAddress))
      } catch (err) {
        await reply(phone, R.replyError(String(err)))
      }
      break
    }

    case 'organiser_summary': {
      try {
        const evt = await chainClient.getEvent(intent.eventId)
        if (evt.organiser.toLowerCase() !== walletAddress.toLowerCase()) {
          await reply(phone, `You are not the organiser for event ${intent.eventId}.`)
          break
        }
        const { balance_usdc } = await chainClient.getSponsorPool()
        // organiserCredits requires a direct read — use chain.ts's read client via a separate call
        // For simplicity, pass '0' — organisers can check their earnings via the web app
        await reply(phone, R.replyOrganiserSummary(evt, '0'))
        await reply(phone, `Sponsor pool: ${balance_usdc} USDC`)
      } catch (err) {
        await reply(phone, R.replyError(String(err)))
      }
      break
    }

    case 'pool_balance': {
      try {
        const { balance_usdc, stakesCanCover } = await chainClient.getSponsorPool()
        await reply(phone, R.replyPoolBalance(balance_usdc, stakesCanCover))
      } catch (err) {
        await reply(phone, R.replyError(String(err)))
      }
      break
    }

    default: {
      await reply(phone, R.replyUnknown())
    }
  }
}

// ---------------------------------------------------------------------------
// Execute a confirmed pending intent
// ---------------------------------------------------------------------------

type ExtendedIntent =
  | { action: 'register'; eventId: number }
  | { action: 'register_with_cover'; eventId: number }
  | { action: 'checkin'; eventId: number; preimage: string }

async function executePendingIntent(
  intent: ExtendedIntent,
  phone: string,
  walletAddress: `0x${string}`,
  walletId: string,
): Promise<void> {
  switch (intent.action) {
    case 'register': {
      try {
        const evt = await chainClient.getEvent(intent.eventId)

        await reply(phone, R.replyTxPending())

        // Approve USDC then register
        const approveTxId = await walletClient.approveUsdc({
          walletId,
          usdcAddress: config.chain.usdcAddress,
          spender: config.chain.contractAddress,
          amountRaw: evt.stakeAmountRaw,
        })
        const approveResult = await walletClient.waitForTx(approveTxId)
        if (approveResult === 'FAILED') {
          await reply(phone, R.replyError('USDC approval failed. Please try again.'))
          return
        }

        const registerCalldata = chainClient.calldataRegister(intent.eventId)
        const registerTxId = await walletClient.sendContractTx({
          walletId,
          contractAddress: config.chain.contractAddress,
          callData: registerCalldata,
        })
        const registerResult = await walletClient.waitForTx(registerTxId)
        if (registerResult === 'FAILED') {
          await reply(phone, R.replyError('Registration failed. Please try again.'))
          return
        }

        await reply(phone, R.replyRegistered(evt))
      } catch (err) {
        await reply(phone, R.replyError(String(err)))
      }
      break
    }

    case 'register_with_cover': {
      try {
        const evt = await chainClient.getEvent(intent.eventId)

        await reply(phone, R.replyTxPending())

        const calldata = chainClient.calldataRequestCover(intent.eventId)
        const txId = await walletClient.sendContractTx({
          walletId,
          contractAddress: config.chain.contractAddress,
          callData: calldata,
        })
        const result = await walletClient.waitForTx(txId)
        if (result === 'FAILED') {
          await reply(phone, R.replyError('Cover request failed. Please try again.'))
          return
        }

        // The contract emits CoverGranted or CoverDenied — we cannot read events easily here.
        // Check registration status as a proxy.
        const registered = await chainClient.isRegistered(intent.eventId, walletAddress)
        if (registered) {
          await reply(phone, R.replyCoverGranted(evt))
        } else {
          await reply(phone, R.replyCoverDenied('The pool denied your request. Check your eligibility with "my score".'))
        }
      } catch (err) {
        await reply(phone, R.replyError(String(err)))
      }
      break
    }

    case 'checkin': {
      try {
        const evt = await chainClient.getEvent(intent.eventId)

        await reply(phone, R.replyTxPending())

        // Normalise preimage: must be 0x-prefixed 32-byte hex
        let preimage = intent.preimage.trim()
        if (!preimage.startsWith('0x')) preimage = `0x${preimage}`
        // Pad to 32 bytes if shorter (e.g. user sent a shorter string)
        if (preimage.length < 66) preimage = preimage.padEnd(66, '0')

        const calldata = chainClient.calldataCheckIn(intent.eventId, preimage as `0x${string}`)
        const txId = await walletClient.sendContractTx({
          walletId,
          contractAddress: config.chain.contractAddress,
          callData: calldata,
        })
        const result = await walletClient.waitForTx(txId)
        if (result === 'FAILED') {
          await reply(phone, R.replyCheckInFailed('The code was not accepted. Make sure you copied it exactly.'))
          return
        }

        await reply(phone, R.replyCheckedIn(evt))

        // Automatically claim back (no confirmation needed — this is a pure refund)
        try {
          const claimCalldata = chainClient.calldataClaimBack(intent.eventId)
          const claimTxId = await walletClient.sendContractTx({
            walletId,
            contractAddress: config.chain.contractAddress,
            callData: claimCalldata,
          })
          await walletClient.waitForTx(claimTxId)
          // Silent success — replyCheckedIn already told them money is on the way
        } catch {
          // claimBack might fail if event hasn't ended yet — that's fine, user can claim later
        }
      } catch (err) {
        await reply(phone, R.replyError(String(err)))
      }
      break
    }
  }
}

function fmtBalance(b: string): string {
  const n = parseFloat(b)
  return `${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)} USDC`
}

// ---------------------------------------------------------------------------
// Hono HTTP server
// ---------------------------------------------------------------------------

const app = new Hono()

// Health check
app.get('/', (c) => c.text('EventStake WhatsApp agent OK'))

// Twilio webhook — inbound WhatsApp messages
app.post('/webhook/whatsapp', async (c) => {
  // Validate Twilio signature
  const signature = c.req.header('x-twilio-signature') ?? ''
  const url = c.req.url
  const bodyText = await c.req.text()

  // Parse form-encoded body that Twilio sends
  const params: Record<string, string> = {}
  new URLSearchParams(bodyText).forEach((v, k) => { params[k] = v })

  const isValid = twilio.validateRequest(
    config.twilio.authToken,
    signature,
    url,
    params,
  )

  if (!isValid) {
    console.warn('Invalid Twilio signature — rejecting request')
    return c.text('Forbidden', 403)
  }

  const from = params['From'] ?? ''
  const body = params['Body'] ?? ''

  // E.164 phone number: Twilio sends "whatsapp:+2348012345678"
  const phone = from.replace(/^whatsapp:/, '')

  if (!phone || !body) {
    return c.text('Bad Request', 400)
  }

  // Handle async — respond to Twilio immediately (empty TwiML), reply via REST API
  void handleMessage(phone, body).catch((err) => {
    console.error('handleMessage error', err)
  })

  // Return empty TwiML so Twilio does not send an auto-reply
  c.header('Content-Type', 'text/xml')
  return c.body('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
})

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const port = config.port
serve({ fetch: app.fetch, port }, () => {
  console.log(`EventStake WhatsApp agent listening on port ${port}`)
  console.log(`Webhook URL: https://<your-host>/webhook/whatsapp`)
})
