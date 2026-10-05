#!/usr/bin/env node
'use strict'

/*
 * opencode-desktop-style
 * ---------------------------------------------------------------------------
 * Unofficial CLI that adds grouping frames / expand-collapse markers to the
 * OpenCode Desktop app by injecting a <style id="oc-desktop-overrides"> into
 * the app's app.asar (out/renderer/index.html).
 *
 * Cross-platform: Windows / macOS / Linux.
 *
 * Commands:
 *   apply            app.asar に CSS を注入（冪等・更新後も再適用可）
 *   revert           バックアップ(app.asar.orig)から元に戻す
 *   status           適用状態を表示
 *   preview          再起動なしで試せる DevTools コンソール用スニペットを出力
 *   install-skill    opencode の skill / command を ~/.config/opencode に配置
 *   uninstall-skill  上記の配置を削除
 *
 * Options:
 *   --asar <path>    app.asar を明示指定
 *   --css  <file>    適用する CSS を指定（既定: css/overrides.css）
 *   --entry <path>   注入先 index.html のパス（既定: out/renderer/index.html）
 *   --force          アプリ起動中でも強行
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const MARKER_ID = 'oc-desktop-overrides'
const DEFAULT_ENTRY = 'out/renderer/index.html'
const PKG_ROOT = path.join(__dirname, '..')

/* ------------------------------------------------------------------ paths */

function asarCandidates() {
  const home = os.homedir()
  const list = []
  if (process.env.OPENCODE_DESKTOP_ASAR) list.push(process.env.OPENCODE_DESKTOP_ASAR)
  if (process.platform === 'win32') {
    list.push(path.join(process.env.LOCALAPPDATA || '', 'Programs', '@opencode-aidesktop', 'resources', 'app.asar'))
    list.push(path.join(process.env.PROGRAMFILES || '', '@opencode-aidesktop', 'resources', 'app.asar'))
  } else if (process.platform === 'darwin') {
    list.push('/Applications/OpenCode.app/Contents/Resources/app.asar')
    list.push(path.join(home, 'Applications', 'OpenCode.app', 'Contents', 'Resources', 'app.asar'))
    list.push('/Applications/@opencode-aidesktop.app/Contents/Resources/app.asar')
  } else {
    list.push('/opt/OpenCode/resources/app.asar')
    list.push('/usr/lib/opencode-desktop/resources/app.asar')
    list.push(path.join(home, '.local', 'share', 'opencode-desktop', 'resources', 'app.asar'))
  }
  return list
}

function resolveAsar(explicit) {
  if (explicit) return explicit
  for (const c of asarCandidates()) if (c && fs.existsSync(c)) return c
  return asarCandidates()[0] || ''
}

function configDir() {
  return process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode')
}

/* ------------------------------------------------------------ running app */

function isAppRunning() {
  try {
    if (process.platform === 'win32') {
      const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq OpenCode.exe', '/NH'], { encoding: 'utf8' })
      return /OpenCode\.exe/i.test(r.stdout || '')
    }
    const r = spawnSync('pgrep', ['-if', 'opencode'], { encoding: 'utf8' })
    return r.status === 0 && (r.stdout || '').trim().length > 0
  } catch {
    return false
  }
}

function guardRunning(force) {
  if (force) return true
  if (!isAppRunning()) return true
  console.error('')
  console.error('OpenCode デスクトップが起動中です。実行中に app.asar を書き換えると動作が壊れる恐れがあります。')
  console.error('アプリを閉じてから再実行してください (強行する場合: --force)。')
  console.error('')
  return false
}

/* --------------------------------------------------------------- asar I/O */

function readHeader(fd) {
  const head = Buffer.alloc(16)
  fs.readSync(fd, head, 0, 16, 0)
  const jsonLen = head.readUInt32LE(12)
  const jsonBuf = Buffer.alloc(jsonLen)
  fs.readSync(fd, jsonBuf, 0, jsonLen, 16)
  const jsonStr = jsonBuf.toString('utf8').replace(/\u0000+$/g, '').trimEnd()
  return { header: JSON.parse(jsonStr), dataStart: 16 + jsonLen }
}

function findEntry(header, entryPath) {
  const parts = entryPath.split('/').filter(Boolean)
  let cur = header
  for (const part of parts) {
    if (!cur.files || !cur.files[part]) return null
    cur = cur.files[part]
  }
  return cur
}

function resolveEntry(header, entryPath) {
  if (findEntry(header, entryPath)) return entryPath
  let found = null
  ;(function walk(node, prefix) {
    for (const [name, v] of Object.entries(node.files || {})) {
      const full = prefix ? prefix + '/' + name : name
      if (v.files) walk(v, full)
      else if (name === 'index.html' && /(^|\/)renderer\//.test(full)) found = found || full
    }
  })(header, '')
  return found
}

function readEntry(fd, header, dataStart, entryPath) {
  const entry = findEntry(header, entryPath)
  if (!entry) throw new Error('entry not found in asar: ' + entryPath)
  if (entry.unpacked) throw new Error('entry is unpacked: ' + entryPath)
  const buf = Buffer.alloc(entry.size)
  fs.readSync(fd, buf, 0, entry.size, dataStart + Number(entry.offset))
  return buf
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function makeIntegrity(buf, blockSize) {
  const bs = blockSize || 4194304
  const blocks = []
  if (buf.length === 0) blocks.push(sha256Hex(buf))
  for (let off = 0; off < buf.length; off += bs) blocks.push(sha256Hex(buf.subarray(off, Math.min(off + bs, buf.length))))
  return { algorithm: 'SHA256', hash: sha256Hex(buf), blockSize: bs, blocks }
}

function planAndWrite(srcPath, overrides, outPath) {
  const srcFd = fs.openSync(srcPath, 'r')
  try {
    const { header, dataStart } = readHeader(srcFd)
    const plan = []
    let offset = 0
    const newHeader = { files: {} }
    ;(function walk(srcNode, dstNode, prefix) {
      for (const [name, node] of Object.entries(srcNode.files)) {
        const full = prefix ? prefix + '/' + name : name
        if (node.files) {
          const d = { files: {} }
          dstNode.files[name] = d
          walk(node, d, full)
          continue
        }
        if (node.unpacked) {
          dstNode.files[name] = { size: node.size, unpacked: true, integrity: node.integrity }
          continue
        }
        let entry
        if (overrides.has(full)) {
          const buf = overrides.get(full)
          entry = { size: buf.length, offset: String(offset), integrity: makeIntegrity(buf, node.integrity && node.integrity.blockSize) }
          plan.push({ kind: 'inline', buf })
        } else {
          entry = { size: node.size, offset: String(offset), integrity: node.integrity }
          plan.push({ kind: 'copy', srcOffset: dataStart + Number(node.offset), size: node.size })
        }
        dstNode.files[name] = entry
        offset += entry.size
      }
    })(header, newHeader, '')

    const jsonBuf = Buffer.from(JSON.stringify(newHeader), 'utf8')
    const pad = (4 - (jsonBuf.length % 4)) % 4
    const padded = pad ? Buffer.concat([jsonBuf, Buffer.alloc(pad, 0x20)]) : jsonBuf
    const jsonLen = padded.length
    const prefix16 = Buffer.alloc(16)
    prefix16.writeUInt32LE(4, 0)
    prefix16.writeUInt32LE(jsonLen + 8, 4)
    prefix16.writeUInt32LE(jsonLen + 4, 8)
    prefix16.writeUInt32LE(jsonLen, 12)

    const outFd = fs.openSync(outPath, 'w')
    try {
      fs.writeSync(outFd, prefix16)
      fs.writeSync(outFd, padded)
      const copyBuf = Buffer.alloc(1024 * 1024)
      for (const step of plan) {
        if (step.kind === 'inline') {
          fs.writeSync(outFd, step.buf)
        } else {
          let remaining = step.size
          let pos = step.srcOffset
          while (remaining > 0) {
            const n = Math.min(remaining, copyBuf.length)
            const read = fs.readSync(srcFd, copyBuf, 0, n, pos)
            if (read <= 0) throw new Error('unexpected EOF while copying asar data')
            fs.writeSync(outFd, copyBuf, 0, read)
            pos += read
            remaining -= read
          }
        }
      }
      fs.fsyncSync(outFd)
    } finally {
      fs.closeSync(outFd)
    }
  } finally {
    fs.closeSync(srcFd)
  }
}

function injectCss(html, css) {
  const block = `\n    <style id="${MARKER_ID}">\n${css.trim()}\n    </style>\n  </head>`
  const existing = new RegExp(`\\s*<style id="${MARKER_ID}">[\\s\\S]*?</style>\\s*</head>`)
  if (existing.test(html)) return html.replace(existing, () => block)
  if (!/\s*<\/head>/.test(html)) throw new Error('</head> not found in index.html')
  return html.replace(/\s*<\/head>/, () => block)
}

function readIndexHtml(asar, entryWanted) {
  const fd = fs.openSync(asar, 'r')
  try {
    const { header, dataStart } = readHeader(fd)
    const entry = resolveEntry(header, entryWanted)
    if (!entry) throw new Error('renderer index.html not found in asar')
    return { entry, html: readEntry(fd, header, dataStart, entry).toString('utf8') }
  } finally {
    fs.closeSync(fd)
  }
}

/* ---------------------------------------------------------------- commands */

function cmdApply(opts) {
  const asar = opts.asar
  if (!fs.existsSync(asar)) throw new Error('app.asar not found: ' + asar)
  if (!guardRunning(opts.force)) process.exit(1)

  const css = fs.readFileSync(opts.css, 'utf8')
  const backup = asar + '.orig'
  const { entry, html } = readIndexHtml(asar, opts.entry)
  const patched = injectCss(html, css)

  if (!html.includes(`id="${MARKER_ID}"`)) {
    fs.copyFileSync(asar, backup)
    console.log('backup updated:', backup)
  } else if (!fs.existsSync(backup)) {
    console.warn('warning: already patched but no backup found; revert cannot restore pristine')
  }

  const tmp = asar + '.tmp'
  planAndWrite(asar, new Map([[entry, Buffer.from(patched, 'utf8')]]), tmp)
  try {
    fs.rmSync(asar, { force: true })
    fs.renameSync(tmp, asar)
  } catch {
    fs.copyFileSync(tmp, asar)
    fs.rmSync(tmp, { force: true })
  }
  console.log('patched :', asar)
  console.log('  entry :', entry)
  console.log('  css   :', opts.css)
  console.log('  size  :', fs.statSync(asar).size, 'bytes')
  console.log('OpenCode を再起動すると反映されます。')
}

function cmdRevert(opts) {
  const asar = opts.asar
  const backup = asar + '.orig'
  if (!fs.existsSync(backup)) {
    console.log('no backup found at', backup, '- nothing to revert')
    return
  }
  if (!guardRunning(opts.force)) process.exit(1)
  fs.copyFileSync(backup, asar)
  console.log('reverted from backup:', backup)
}

function cmdStatus(opts) {
  const asar = opts.asar
  console.log('asar   :', asar, fs.existsSync(asar) ? '(found)' : '(NOT FOUND)')
  console.log('backup :', asar + '.orig', fs.existsSync(asar + '.orig') ? '(present)' : '(none)')
  console.log('app    :', isAppRunning() ? 'running (起動中)' : 'not running')
  if (!fs.existsSync(asar)) return
  try {
    const { entry, html } = readIndexHtml(asar, opts.entry)
    console.log('entry  :', entry)
    console.log('state  :', html.includes(`id="${MARKER_ID}"`) ? 'PATCHED (適用済み)' : 'pristine (未適用)')
  } catch (e) {
    console.log('state  : unknown (' + e.message + ')')
  }
}

function minifyCss(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim().replace(/\s*([{};:,>])\s*/g, '$1')
}

function cmdPreview(opts) {
  const css = minifyCss(fs.readFileSync(opts.css, 'utf8'))
  const snippet =
    "(()=>{let e=document.getElementById('oc-preview');if(!e){e=document.createElement('style');e.id='oc-preview';document.head.append(e)}" +
    'e.textContent=`' + css + "`;console.log('[oc-preview] applied')})()"
  process.stdout.write(snippet + '\n')
}

function listDirs(p) {
  try {
    return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
}
function listMd(p) {
  try {
    return fs.readdirSync(p).filter((f) => f.endsWith('.md'))
  } catch {
    return []
  }
}

function cmdInstallSkill() {
  const cfg = configDir()
  const skillSrcDir = path.join(PKG_ROOT, 'opencode', 'skill')
  const cmdSrcDir = path.join(PKG_ROOT, 'opencode', 'command')
  let n = 0
  for (const name of listDirs(skillSrcDir)) {
    const src = path.join(skillSrcDir, name, 'SKILL.md')
    if (!fs.existsSync(src)) continue
    const dst = path.join(cfg, 'skills', name, 'SKILL.md')
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(src, dst)
    console.log('skill  :', dst)
    n++
  }
  const cmdDstDir = path.join(cfg, 'command')
  fs.mkdirSync(cmdDstDir, { recursive: true })
  for (const f of listMd(cmdSrcDir)) {
    const dst = path.join(cmdDstDir, f)
    fs.copyFileSync(path.join(cmdSrcDir, f), dst)
    console.log('command:', dst)
    n++
  }
  console.log(n + ' file(s) installed. opencode を再起動すると skill/command が使えます。')
}

function cmdUninstallSkill() {
  const cfg = configDir()
  let n = 0
  for (const name of listDirs(path.join(PKG_ROOT, 'opencode', 'skill'))) {
    const dst = path.join(cfg, 'skills', name)
    if (fs.existsSync(dst)) {
      fs.rmSync(dst, { recursive: true, force: true })
      console.log('removed:', dst)
      n++
    }
  }
  for (const f of listMd(path.join(PKG_ROOT, 'opencode', 'command'))) {
    const dst = path.join(cfg, 'command', f)
    if (fs.existsSync(dst)) {
      fs.rmSync(dst, { force: true })
      console.log('removed:', dst)
      n++
    }
  }
  console.log(n + ' item(s) removed from ' + cfg)
}

function printHelp() {
  console.log(`opencode-desktop-style - Unofficial OpenCode Desktop styling (grouping frames)

Usage:
  opencode-desktop-style <command> [options]

Commands:
  apply             app.asar に CSS を注入する (冪等 / 更新後も再適用可)
  revert            バックアップから元に戻す
  status            現在の適用状態を表示
  preview           再起動なしで試せる DevTools コンソール用スニペットを出力
  install-skill     opencode の skill/command を ~/.config/opencode に配置
  uninstall-skill   配置した skill/command を削除

Options:
  --asar <path>     app.asar を明示指定
  --css  <file>     適用する CSS (既定: css/overrides.css)
  --entry <path>    注入先 index.html (既定: out/renderer/index.html)
  --force           アプリ起動中でも強行
  -h, --help        このヘルプ

Examples:
  npx -y opencode-desktop-style apply
  npx -y opencode-desktop-style status
  npx -y opencode-desktop-style preview
  npx -y opencode-desktop-style install-skill
`)
}

/* ------------------------------------------------------------------- main */

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') {
      args.help = true
    } else if (a.startsWith('--')) {
      const key = a.slice(2)
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true
      args[key] = val
    } else {
      args._.push(a)
    }
  }
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const cmd = args._[0]

  if (!cmd || args.help) {
    printHelp()
    process.exit(cmd ? 0 : 1)
  }

  const opts = {
    asar: resolveAsar(args.asar),
    css: args.css || path.join(PKG_ROOT, 'css', 'overrides.css'),
    entry: args.entry || DEFAULT_ENTRY,
    force: !!args.force,
  }

  try {
    switch (cmd) {
      case 'apply':
        cmdApply(opts)
        break
      case 'revert':
        cmdRevert(opts)
        break
      case 'status':
        cmdStatus(opts)
        break
      case 'preview':
        cmdPreview(opts)
        break
      case 'install-skill':
        cmdInstallSkill()
        break
      case 'uninstall-skill':
        cmdUninstallSkill()
        break
      default:
        console.error('unknown command:', cmd)
        printHelp()
        process.exit(1)
    }
  } catch (e) {
    console.error('error:', e.message)
    process.exit(2)
  }
}

main()
