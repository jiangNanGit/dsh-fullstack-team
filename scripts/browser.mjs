#!/usr/bin/env node
/**
 * Minimal browser driver over the Chrome DevTools Protocol.
 *
 * There is no browser plugin in this host, and UI acceptance needs one: a gate
 * that cannot look at a page cannot sign off on a page. This drives a real
 * Chrome (headless by default) with nothing but Node's built-in `fetch` and
 * `WebSocket` — no Playwright download, no extra dependency.
 *
 *   node scripts/browser.mjs text  <url>            # visible text of the page
 *   node scripts/browser.mjs title <url>            # document.title
 *   node scripts/browser.mjs shot  <url> <file.png> # full-page screenshot
 *   node scripts/browser.mjs eval  <url> <expr>     # evaluate an expression
 *   node scripts/browser.mjs html  <url>            # outerHTML (truncatable)
 *
 * Common flags: `--headful` (show the window), `--wait <ms>` (settle time),
 * `--timeout <ms>`, `--width/--height <px>`.
 *
 * Exit codes: 0 ok; 1 navigation/evaluation failure; 2 bad usage.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DEBUG_PORT = 9222

/** Collected flags so the positional arguments stay obvious. */
function parseArgs(argv) {
  const flags = { headful: false, wait: 300, timeout: 20_000, width: 1280, height: 900 }
  const positional = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      const value = argv[index + 1]
      if (value === undefined) fail(`missing value for ${arg}`)
      index += 1
      return value
    }
    if (arg === '--headful') flags.headful = true
    else if (arg === '--wait') flags.wait = Number(next())
    else if (arg === '--timeout') flags.timeout = Number(next())
    else if (arg === '--width') flags.width = Number(next())
    else if (arg === '--height') flags.height = Number(next())
    else if (arg.startsWith('--')) fail(`unknown flag ${arg}`)
    else positional.push(arg)
  }
  return { flags, positional }
}

function fail(message) {
  console.error(`browser: ${message}`)
  process.exit(2)
}

/** Launch Chrome and wait until the DevTools endpoint answers. */
async function launch(flags) {
  const profile = mkdtempSync(join(tmpdir(), 'dsh-browser-'))
  const args = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${flags.width},${flags.height}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,MediaRouter',
    '--hide-scrollbars',
    flags.headful ? '--new-window' : '--headless=new',
    'about:blank',
  ]
  const child = spawn(CHROME, args, { stdio: 'ignore', detached: false })
  const cleanup = () => {
    try {
      child.kill('SIGKILL')
    } catch {
      // already gone
    }
    // Chrome keeps writing for a moment after SIGKILL; a failed cleanup must
    // never turn a successful run into a failure.
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {
      // leave the temp profile for the OS to collect
    }
  }
  process.on('exit', cleanup)
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
      const page = list.find((target) => target.type === 'page')
      if (page !== undefined) return { page, cleanup }
    } catch {
      // not up yet
    }
    await new Promise((done) => setTimeout(done, 100))
  }
  cleanup()
  throw new Error('Chrome did not expose a debugging port (is it already running with one?)')
}

/** A tiny CDP client: send one command, wait for its matching reply. */
function connect(wsUrl) {
  const socket = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  const events = []
  socket.addEventListener('message', (event) => {
    const data = JSON.parse(typeof event.data === 'string' ? event.data : '')
    if (data.id !== undefined && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id)
      pending.delete(data.id)
      if (data.error !== undefined) reject(new Error(data.error.message))
      else resolve(data.result)
      return
    }
    if (data.method !== undefined) events.push(data)
  })
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve())
    socket.addEventListener('error', () => reject(new Error('websocket error')))
  })
  const send = (method, params = {}) =>
    ready.then(
      () =>
        new Promise((resolve, reject) => {
          id += 1
          pending.set(id, { resolve, reject })
          socket.send(JSON.stringify({ id, method, params }))
        }),
    )
  return { send, close: () => socket.close() }
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2))
  const [command, url, extra] = positional
  if (command === undefined || url === undefined) {
    fail('usage: text|title|html|eval|shot <url> [value]')
  }

  const { page, cleanup } = await launch(flags)
  const client = connect(page.webSocketDebuggerUrl)
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: flags.width,
    height: flags.height,
    deviceScaleFactor: 2,
    mobile: false,
  })

  const navigate = await client.send('Page.navigate', { url })
  if (navigate.errorText !== undefined && navigate.errorText !== '') {
    throw new Error(`navigation failed: ${navigate.errorText}`)
  }
  // Wait for load, then let the page settle (SPA shells paint after onload).
  const deadline = Date.now() + flags.timeout
  const loaded = await new Promise((resolve) => {
    const timer = setInterval(() => {
      if (Date.now() > deadline) {
        clearInterval(timer)
        resolve(false)
      }
    }, 100)
    const check = async () => {
      const state = await client.send('Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true,
      })
      if (state.result?.value === 'complete') {
        clearInterval(timer)
        resolve(true)
      } else {
        setTimeout(check, 100)
      }
    }
    void check()
  })
  if (!loaded) console.error('browser: timed out waiting for load, continuing anyway')
  await new Promise((done) => setTimeout(done, flags.wait))

  const evaluate = async (expression) => {
    const result = await client.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails !== undefined) {
      throw new Error(result.exceptionDetails.text ?? 'evaluation failed')
    }
    return result.result?.value
  }

  if (command === 'text') console.log(await evaluate('document.body?.innerText ?? ""'))
  else if (command === 'title') console.log(await evaluate('document.title'))
  else if (command === 'html') console.log(await evaluate('document.documentElement?.outerHTML ?? ""'))
  else if (command === 'eval') {
    if (extra === undefined) fail('eval needs an expression')
    console.log(JSON.stringify(await evaluate(extra), null, 2))
  } else if (command === 'shot') {
    if (extra === undefined) fail('shot needs an output path')
    const metrics = await client.send('Page.getLayoutMetrics')
    const size = metrics.cssContentSize ?? metrics.contentSize
    const shot = await client.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: 0,
        width: Math.ceil(size.width),
        height: Math.ceil(size.height),
        scale: 1,
      },
    })
    writeFileSync(extra, Buffer.from(shot.data, 'base64'))
    console.log(`${extra} (${Math.ceil(size.width)}x${Math.ceil(size.height)})`)
  } else fail(`unknown command ${command}`)

  client.close()
  cleanup()
}

try {
  await main()
} catch (error) {
  console.error(`browser: ${(error.__proto__?.constructor?.name ?? 'Error')}: ${error.message}`)
  process.exit(1)
}
