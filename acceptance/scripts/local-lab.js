'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const net = require('node:net')
const { spawn } = require('node:child_process')
const reportTools = require('../src/report')
const acceptanceConfig = require('../src/config')

const ROOT = process.env.MC_ACCEPTANCE_RUNTIME || 'C:\\MinecraftAI\\AcceptanceRuntime'
const LAB = path.join(ROOT, 'local-lab')
const PAPER = path.join(LAB, 'paper')
const VELOCITY = path.join(LAB, 'velocity')
const JAVA = 'C:\\Program Files\\Amazon Corretto\\jdk25.0.4_8\\bin\\java.exe'
const SOURCE_PAPER = 'C:\\Minecraft\\DingbatLab\\paper-26.2-126.jar'
const SOURCE_PAPER_CONFIG = 'C:\\Minecraft\\DingbatLab\\config\\paper-global.yml'
const SOURCE_VELOCITY = 'C:\\Minecraft\\Velocity\\velocity.jar'
const SOURCE_VELOCITY_CONFIG = 'C:\\Minecraft\\Velocity\\velocity.toml'

function replaceLine (content, pattern, replacement, label) {
  let count = 0
  const result = content.replace(pattern, () => { count++; return replacement })
  if (count !== 1) throw new Error(`Expected exactly one ${label} setting, found ${count}`)
  return result
}

function paperConfig (secret) {
  const lines = fs.readFileSync(SOURCE_PAPER_CONFIG, 'utf8').split(/\r?\n/)
  const start = lines.findIndex(line => /^  velocity:\s*$/.test(line))
  if (start < 0) throw new Error('Paper Velocity forwarding section not found')
  let online = 0; let secretCount = 0; let enabled = 0
  for (let i = start + 1; i < lines.length && /^    \S/.test(lines[i]); i++) {
    if (/^    enabled:/.test(lines[i])) { lines[i] = '    enabled: true'; enabled++ }
    if (/^    online-mode:/.test(lines[i])) { lines[i] = '    online-mode: false'; online++ }
    if (/^    secret:/.test(lines[i])) { lines[i] = `    secret: ${secret}`; secretCount++ }
  }
  if (online !== 1 || secretCount !== 1 || enabled !== 1) throw new Error('Paper forwarding settings could not be scoped safely')
  return lines.join('\n')
}

function velocityConfig () {
  let content = fs.readFileSync(SOURCE_VELOCITY_CONFIG, 'utf8')
  content = replaceLine(content, /^bind = .*$/m, 'bind = "127.0.0.1:25590"', 'Velocity bind')
  content = replaceLine(content, /^online-mode = .*$/m, 'online-mode = false', 'Velocity authentication')
  content = replaceLine(content, /^force-key-authentication = .*$/m, 'force-key-authentication = false', 'Velocity key authentication')
  content = replaceLine(content, /^haproxy-protocol = .*$/m, 'haproxy-protocol = false', 'Velocity HAProxy')
  content = content.replace(/\[servers\][\s\S]*?(?=\[advanced\])/, '[servers]\nlab = "127.0.0.1:25591"\ntry = ["lab"]\n\n[forced-hosts]\n\n')
  if (!content.includes('lab = "127.0.0.1:25591"') || content.includes('turtlebay =')) throw new Error('Velocity lab route replacement failed')
  return content
}

function prepare () {
  fs.mkdirSync(path.join(PAPER, 'config'), { recursive: true })
  fs.mkdirSync(VELOCITY, { recursive: true })
  const marker = path.join(LAB, 'lab.json')
  if (fs.existsSync(marker)) {
    const meta = JSON.parse(fs.readFileSync(marker, 'utf8'))
    if (meta.version !== 1 || meta.proxy !== '127.0.0.1:25590' || meta.paper !== '127.0.0.1:25591') throw new Error('Existing local lab layout differs; refusing to overwrite it')
    validateLab()
    return meta
  }
  const secret = crypto.randomBytes(32).toString('base64')
  fs.copyFileSync(SOURCE_PAPER, path.join(PAPER, 'paper.jar'))
  fs.copyFileSync(SOURCE_VELOCITY, path.join(VELOCITY, 'velocity.jar'))
  fs.writeFileSync(path.join(PAPER, 'eula.txt'), 'eula=true\n')
  fs.writeFileSync(path.join(PAPER, 'server.properties'), [
    'server-ip=127.0.0.1', 'server-port=25591', 'online-mode=false',
    'enforce-secure-profile=false', 'enable-rcon=false', 'enable-query=false',
    'white-list=false', 'max-players=1', 'level-name=acceptance-world',
    'level-type=minecraft:flat', 'gamemode=survival', 'difficulty=peaceful',
    'spawn-protection=0', 'generate-structures=false', 'spawn-monsters=false',
    'view-distance=4', 'simulation-distance=4', 'enable-command-block=false',
    'motd=Isolated Minecraft Acceptance Lab', 'sync-chunk-writes=true', ''
  ].join('\n'))
  fs.writeFileSync(path.join(PAPER, 'config', 'paper-global.yml'), paperConfig(secret))
  fs.writeFileSync(path.join(VELOCITY, 'forwarding.secret'), secret + '\n')
  fs.writeFileSync(path.join(VELOCITY, 'velocity.toml'), velocityConfig())
  const meta = { version: 1, proxy: '127.0.0.1:25590', paper: '127.0.0.1:25591', isolated: true,
    sourcePaper: SOURCE_PAPER, sourceVelocity: SOURCE_VELOCITY }
  fs.writeFileSync(marker, JSON.stringify(meta, null, 2) + '\n')
  validateLab()
  return meta
}

function validateLab () {
  const secret = fs.readFileSync(path.join(VELOCITY, 'forwarding.secret'), 'utf8').trim()
  const productionSecret = fs.readFileSync('C:\\Minecraft\\Velocity\\forwarding.secret', 'utf8').trim()
  const proxy = fs.readFileSync(path.join(VELOCITY, 'velocity.toml'), 'utf8')
  const paper = fs.readFileSync(path.join(PAPER, 'server.properties'), 'utf8')
  const global = fs.readFileSync(path.join(PAPER, 'config', 'paper-global.yml'), 'utf8')
  const routes = proxy.match(/\[servers\]([\s\S]*?)(?=\[forced-hosts\])/)?.[1] || ''
  if (!secret || secret === productionSecret || !global.includes(`    secret: ${secret}`)) throw new Error('Lab forwarding secret is invalid or matches production')
  if (!/^bind = "127\.0\.0\.1:25590"$/m.test(proxy) || !/^online-mode = false$/m.test(proxy) || !/^haproxy-protocol = false$/m.test(proxy)) throw new Error('Lab proxy authentication or loopback bind is unsafe')
  if (!/^lab = "127\.0\.0\.1:25591"$/m.test(routes) || /127\.0\.0\.1:255(?:6[5-9]|7[0-9]|8[0-4])/.test(routes)) throw new Error('Lab proxy routes outside the isolated backend')
  if (!/^server-ip=127\.0\.0\.1$/m.test(paper) || !/^server-port=25591$/m.test(paper) || !/^online-mode=false$/m.test(paper) || !/^enable-rcon=false$/m.test(paper)) throw new Error('Lab Paper settings are unsafe')
  if (!/  velocity:\n    enabled: true\n    online-mode: false\n    secret: /m.test(global)) throw new Error('Lab Paper forwarding settings are invalid')
}

function portOpen (port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    socket.setTimeout(800)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
    socket.once('error', () => resolve(false))
  })
}

async function waitPort (port, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.startError) throw new Error(`Could not start local lab Java process: ${child.startError.message}`)
    if (child.exitCode !== null) throw new Error(`Lab process exited before port ${port} opened; inspect ${LAB} logs`)
    if (await portOpen(port)) return
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`Timed out waiting for local lab port ${port}; inspect ${LAB} logs`)
}

function startJava (cwd, name, memoryMb, jar) {
  const log = fs.openSync(path.join(cwd, `${name}.log`), 'a')
  const child = spawn(JAVA, [`-Xms256M`, `-Xmx${memoryMb}M`, '-jar', jar, 'nogui'],
    { cwd, windowsHide: true, stdio: ['pipe', log, log] })
  child.on('error', error => { child.startError = error })
  fs.closeSync(log)
  return child
}

async function stopJava (child, command) {
  if (!child || child.exitCode !== null || child.startError) return true
  const ended = new Promise(resolve => child.once('exit', resolve))
  try { child.stdin.write(command + '\n') } catch { /* process may have exited */ }
  let timeout
  await Promise.race([ended, new Promise(resolve => { timeout = setTimeout(resolve, 20000) })])
  clearTimeout(timeout)
  if (child.exitCode !== null) return true
  child.kill()
  return false
}

async function runLocalSmoke ({ dryRun = false } = {}) {
  if (dryRun) {
    console.log(JSON.stringify({ target: 'local-lab', proxy: '127.0.0.1:25590', paper: '127.0.0.1:25591',
      plan: ['Prepare isolated runtime with fresh forwarding secret', 'Start local Paper 26.2', 'Start local Velocity', 'Run offline CodexTestBot smoke', 'Gracefully stop both processes'], productionChanges: [] }, null, 2))
    return
  }
  const report = reportTools.newReport('test local-smoke')
  let paper; let velocity; let result = 1
  try {
    if (await portOpen(25590) || await portOpen(25591)) throw new Error('Local lab port is already occupied; no process was started')
    prepare()
    reportTools.addStep(report, 'isolated_lab_prepared', 'AUTOMATED PASS', { proxy: '127.0.0.1:25590', backend: '127.0.0.1:25591' })
    paper = startJava(PAPER, 'paper', 1536, 'paper.jar')
    await waitPort(25591, paper, 150000)
    reportTools.addStep(report, 'local_paper_started', 'AUTOMATED PASS')
    velocity = startJava(VELOCITY, 'velocity', 512, 'velocity.jar')
    await waitPort(25590, velocity, 60000)
    reportTools.addStep(report, 'local_velocity_started', 'AUTOMATED PASS')
    const before = new Set(fs.existsSync(acceptanceConfig.reportsFolder) ? fs.readdirSync(acceptanceConfig.reportsFolder).filter(name => name.endsWith('.json')) : [])
    result = await new Promise(resolve => {
      const bot = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'cli.js'), 'test', 'smoke'],
        { cwd: path.join(__dirname, '..'), env: { ...process.env, MC_ACCEPTANCE_TARGET: 'local-lab' }, stdio: 'inherit', windowsHide: true })
      bot.once('exit', code => resolve(code ?? 1))
      bot.once('error', () => resolve(1))
    })
    const files = fs.readdirSync(acceptanceConfig.reportsFolder).filter(name => name.endsWith('.json') && !before.has(name)).sort()
    const childReport = files.length ? JSON.parse(fs.readFileSync(path.join(acceptanceConfig.reportsFolder, files.at(-1)), 'utf8')) : null
    report.player_uuid = childReport?.player_uuid || null
    reportTools.addStep(report, 'client_smoke', result === 0 ? 'AUTOMATED PASS' : 'AUTOMATED FAIL', { run_id: childReport?.run_id || null, result: childReport?.result || 'NO REPORT' })
  } catch (error) {
    reportTools.addStep(report, 'failure', 'AUTOMATED FAIL', { message: String(error.message).slice(0, 500) })
    result = 1
  } finally {
    const proxyStopped = await stopJava(velocity, 'shutdown')
    const paperStopped = await stopJava(paper, 'stop')
    const cleanup = proxyStopped && paperStopped ? 'PASS' : 'FAIL'
    reportTools.addStep(report, 'lab_shutdown', cleanup === 'PASS' ? 'AUTOMATED PASS' : 'AUTOMATED FAIL', { proxyStopped, paperStopped })
    reportTools.finish(report, result === 0 && cleanup === 'PASS' ? 'AUTOMATED PASS' : 'AUTOMATED FAIL', cleanup)
    const paths = reportTools.save(report)
    console.log(JSON.stringify({ run_id: report.run_id, result: report.result, cleanup: report.cleanup, report_files: paths }))
    if (!proxyStopped || !paperStopped) result = 1
  }
  if (result !== 0) process.exitCode = 1
}

module.exports = { prepare, runLocalSmoke }
