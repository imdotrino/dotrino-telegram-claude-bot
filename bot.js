#!/usr/bin/env node
/**
 * dotrino-telegram-claude-bot
 *
 * Un bot de Telegram que conversa con **Claude** (con memoria de sesión), expuesto
 * al mundo con @dotrino/tunnel (túnel reverso) — sin abrir puertos. Solo responde al
 * usuario autorizado. Pensado para correr con `npx` en cualquier máquina.
 *
 *   TELEGRAM_BOT_TOKEN=123:ABC  npx dotrino-telegram-claude-bot
 *
 * Config (variables de entorno o archivo .env en el cwd, o el que indique BOT_ENV):
 *   TELEGRAM_BOT_TOKEN  (req)  token de @BotFather
 *   CLAUDE_CWD          carpeta donde corre Claude         (def: el cwd actual)
 *   CLAUDE_FLAGS        flags extra para `claude -p`        (def: ninguno; p.ej.
 *                       "--dangerously-skip-permissions --model claude-sonnet-4-6")
 *   CLAUDE_BIN          binario de claude                   (def: "claude")
 *   ALLOWED_USER_ID     id de Telegram autorizado           (def: captura al 1ro)
 *   TUNNEL_SERVER       relay del túnel                     (def: https://r.dotrino.com)
 *   TUNNEL_KEY / TG_WEBHOOK_SECRET / CLAUDE_SESSION_ID  se autogeneran y persisten.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createTunnel } from '@dotrino/tunnel'

/* --------- Config (.env: arg CLI o --env, si no BOT_ENV, si no ./.env del cwd) --------- */
const _argv = process.argv.slice(2)
const _envArg = (_argv.includes('--env') ? _argv[_argv.indexOf('--env') + 1] : null) || _argv.find((a) => !a.startsWith('-'))
const ENV_FILE = _envArg || process.env.BOT_ENV || join(process.cwd(), '.env')
function loadEnvFile () {
  const e = {}
  try {
    for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (m) e[m[1]] = m[2]
    }
  } catch { /* no hay archivo */ }
  return e
}
function setEnv (key, value) {
  let txt = ''
  try { txt = readFileSync(ENV_FILE, 'utf8') } catch {}
  const re = new RegExp(`^${key}=.*$`, 'm')
  if (re.test(txt)) txt = txt.replace(re, `${key}=${value}`)
  else txt = (txt && !txt.endsWith('\n') ? txt + '\n' : txt) + `${key}=${value}\n`
  writeFileSync(ENV_FILE, txt)
}
const fileEnv = loadEnvFile()
const cfg = (k) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : fileEnv[k])
const genB62 = (n) => {
  const b = randomBytes(n), A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''; for (let i = 0; i < n; i++) s += A[b[i] % 62]; return s
}

const TOKEN = cfg('TELEGRAM_BOT_TOKEN')
if (!TOKEN) {
  console.error(`Falta TELEGRAM_BOT_TOKEN.
Pásalo por variable de entorno o en un .env (en el cwd, o el que indique BOT_ENV):
  TELEGRAM_BOT_TOKEN=<token de @BotFather>
Opcionales: CLAUDE_CWD, CLAUDE_FLAGS, ALLOWED_USER_ID, TUNNEL_SERVER, CLAUDE_BIN`)
  process.exit(1)
}
let SECRET = cfg('TG_WEBHOOK_SECRET'); if (!SECRET) { SECRET = randomBytes(24).toString('hex'); setEnv('TG_WEBHOOK_SECRET', SECRET) }
let KEY = cfg('TUNNEL_KEY'); if (!KEY) { KEY = genB62(32); setEnv('TUNNEL_KEY', KEY) }
let ALLOWED = cfg('ALLOWED_USER_ID') || null
let sessionId = cfg('CLAUDE_SESSION_ID') || null
const CLAUDE_BIN = cfg('CLAUDE_BIN') || 'claude'
const CLAUDE_CWD = cfg('CLAUDE_CWD') || process.cwd()
const CLAUDE_FLAGS = (cfg('CLAUDE_FLAGS') || '').split(/\s+/).filter(Boolean)
const TUNNEL_SERVER = cfg('TUNNEL_SERVER') || undefined   // undefined → default de la lib
let busy = false
const queue = []
// PATH robusto para cuando arranca por systemd/PM2 (PATH mínimo): node + ~/.local/bin (claude).
const EXTRA_PATH = [dirname(process.execPath), `${process.env.HOME || ''}/.local/bin`].filter(Boolean).join(':')

/* --------- API de Telegram --------- */
const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json())
const reply = (chatId, text) => api('sendMessage', { chat_id: chatId, text })

/* --------- Lógica del bot --------- */
async function handleUpdate (update) {
  const msg = update.message || update.edited_message
  if (!msg || !msg.from) return
  const from = msg.from
  const chatId = msg.chat.id
  const who = '@' + (from.username || from.first_name || from.id)
  const text = (msg.text || '').trim()

  // /id → eco del id (para cualquiera, no captura ni requiere autorización)
  if (text === '/id' || text.startsWith('/id ')) {
    await reply(chatId, `Tu id de Telegram: ${from.id}\nUsuario: @${from.username || from.first_name || '—'}`)
    return
  }

  // Sin usuario autorizado definido → SIEMPRE eco del id + cómo autorizarse (no captura).
  if (!ALLOWED) {
    console.log(`ℹ️ sin ALLOWED_USER_ID — eco a ${who} (id ${from.id})`)
    await reply(chatId,
      '🔓 Este bot todavía no tiene un usuario autorizado.\n\n' +
      `Tu id de Telegram es: ${from.id}\n\n` +
      'Para autorizarte (y que solo tú puedas usarlo), pon esto en el .env del bot:\n' +
      `    ALLOWED_USER_ID=${from.id}\n` +
      'y reinícialo. Después podrás chatear con Claude por aquí.')
    return
  }
  if (String(from.id) !== ALLOWED) {
    console.log(`⛔ intento de ${who} (id ${from.id}) — no autorizado`)
    await reply(chatId, '⛔ No estás autorizado para usar este bot.')
    return
  }
  // Usuario autorizado → Claude con memoria (encolado en orden)
  if (!text) { await reply(chatId, 'Mándame texto para pasárselo a Claude.'); return }
  enqueue(text, chatId, who)
}

/* --------- Cola: encola y procesa en orden (no descarta) --------- */
function enqueue (text, chatId, who) {
  queue.push({ text, chatId, who })
  if (busy) reply(chatId, `📥 En cola (${queue.length} esperando). Lo respondo apenas termine el anterior.`).catch(() => {})
  drain()
}
async function drain () {
  if (busy || !queue.length) return
  busy = true
  const job = queue.shift()
  try { await runClaude(job.text, job.chatId, job.who) }
  finally { busy = false; if (queue.length) drain() }
}

/* --------- Claude (con memoria de sesión) --------- */
async function runClaude (text, chatId, who) {
  console.log(`💬 ${who}: ${text.slice(0, 100)}`)
  api('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {})
  const typing = setInterval(() => api('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {}), 5000)
  try {
    let r
    try {
      r = await claudeRun(text, sessionId)
    } catch (e) {
      // Sesión inválida/inexistente → empezar una nueva en vez de fallar.
      if (sessionId && /no conversation found|session/i.test(e.message || '')) {
        console.log('sesión previa inválida → empiezo una nueva')
        sessionId = null; setEnv('CLAUDE_SESSION_ID', '')
        r = await claudeRun(text, null)
      } else throw e
    }
    if (r.sid && r.sid !== sessionId) { sessionId = r.sid; setEnv('CLAUDE_SESSION_ID', r.sid) }
    await sendLong(chatId, String(r.result || '(sin respuesta)'))
  } catch (e) {
    console.error('claude error:', e.message)
    await reply(chatId, '⚠️ Error con Claude: ' + (e.message || e))
  } finally { clearInterval(typing) }
}

async function claudeRun (text, useSession) {
  const args = ['-p', text, '--output-format', 'json', ...CLAUDE_FLAGS]
  if (useSession) args.push('--resume', useSession)
  const out = await runCmd(CLAUDE_BIN, args, CLAUDE_CWD, 300000)
  let result = out, sid = useSession
  try { const j = JSON.parse(out); result = (j.result ?? out); sid = j.session_id || sid } catch {}
  return { result, sid }
}

function runCmd (cmd, args, cwd, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    // stdin cerrado para que claude -p no espere por stdin.
    const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PATH: `${process.env.PATH || ''}:${EXTRA_PATH}` } })
    let out = '', err = ''
    const to = setTimeout(() => { try { p.kill('SIGKILL') } catch {}; reject(new Error('timeout')) }, timeoutMs)
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('error', (e) => { clearTimeout(to); reject(e) })
    p.on('close', (code) => { clearTimeout(to); code === 0 ? resolve(out) : reject(new Error((err.slice(-400) || 'exit ' + code))) })
  })
}

async function sendLong (chatId, text) {
  const MAX = 4000
  if (!text) return
  for (let i = 0; i < text.length; i += MAX) await reply(chatId, text.slice(i, i + MAX))
}

/* --------- Túnel + webhook --------- */
const tun = createTunnel({
  key: KEY,
  server: TUNNEL_SERVER,
  quiet: true,
  target: async (req) => {
    if (req.headers['x-telegram-bot-api-secret-token'] !== SECRET) return { status: 401, body: 'unauthorized' }
    if (req.method !== 'POST') return { status: 200, body: 'ok' }
    let update = {}
    try { update = JSON.parse(req.body ? req.body.toString() : '{}') } catch {}
    handleUpdate(update).catch((e) => console.error('handler error:', e))
    return { status: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' }
  },
  onReady: async (url) => {
    const webhookUrl = `${url}/tg`
    const r = await api('setWebhook', { url: webhookUrl, secret_token: SECRET, allowed_updates: ['message'], drop_pending_updates: true })
    const me = await api('getMe', {})
    console.log('túnel  →', url)
    console.log('webhook→', webhookUrl, '·', r.ok ? 'OK' : JSON.stringify(r))
    if (me.ok) console.log('bot    →', '@' + me.result.username, `(${me.result.first_name})`)
    console.log('claude →', CLAUDE_BIN, 'en', CLAUDE_CWD, CLAUDE_FLAGS.length ? '· flags: ' + CLAUDE_FLAGS.join(' ') : '')
    console.log(ALLOWED
      ? `\nUsuario autorizado: ${ALLOWED}. Esperando mensajes…`
      : '\n👉 Mándale un mensaje al bot para capturar el usuario autorizado…')
  },
})

process.on('SIGINT', () => { console.log('\ncerrando…'); tun.close(); process.exit(0) })
