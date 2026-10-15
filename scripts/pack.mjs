// Packs the assembled theme directory into theme.tar.gz, the file the hub's
// installer and its "install from GitHub" both look for in a release.
//
// The tar is written here rather than shelled out to `tar` so the archive holds
// exactly what the hub accepts: regular files and directories, nothing else. A
// macOS tar would add extended-attribute entries (`._theme.json`, `LIBARCHIVE.xattr.*`)
// for files carrying a quarantine or Finder flag, and the hub rejects any member
// that is not a regular file or a directory.
import { gzipSync } from "node:zlib"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, posix, relative, sep } from "node:path"

const ROOT = join(import.meta.dirname, "..")
const manifest = JSON.parse(readFileSync(join(ROOT, "theme.json"), "utf8"))
const source = join(ROOT, manifest.short)
const target = join(ROOT, "theme.tar.gz")

// The hub's limits, from the theme documentation. Checked here because the
// installer's rejection arrives after the upload, and the tar is built anyway.
const LIMITS = {
  package: 32 * 1024 * 1024,
  unpacked: 64 * 1024 * 1024,
  file: 8 * 1024 * 1024,
  entries: 2000,
  padding: 1024 * 1024,
}

/**
 * Every entry under `dir`, as paths relative to it, in a stable order. Both
 * files and directories are listed: a tar that names only files leaves the
 * extractor to invent the parents, and the hub counts directories against its
 * entry limit, so it is better to say what the package contains.
 */
function walk(dir) {
  const entries = []
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    const info = statSync(full)
    if (info.isDirectory()) {
      entries.push(name, ...walk(full).map((p) => posix.join(name, p)))
    } else if (info.isFile()) {
      entries.push(name)
    } else {
      // Symbolic links and the like are not regular files: the hub rejects a
      // package containing one, so they are dropped rather than silently shipped.
      console.warn(`skipping non-regular file: ${relative(ROOT, full)}`)
    }
  }
  return entries
}

// The modes written into the header, fixed rather than read off the packing
// machine's filesystem. The installer chmods every entry to whatever the header
// says, directories included -- so a directory entry with the wrong bits is not
// a cosmetic detail, it is an install that fails.
//
// This bit us on Windows, where the filesystem reports 0666 for a directory.
// Packed there, `dist/` arrived as `drw-rw-rw-`; the hub runs as an unprivileged
// user, and a directory without the execute bit cannot be searched, so the very
// next member -- `dist/apple-touch-icon.png`, the first file inside it -- failed
// with `Permission denied (os error 13)`. The hub logs the raw io error and
// answers 500 "hub 内部出错", which names neither the file nor the mode.
//
// 0755 and 0644 are what every published theme carries; keep them fixed so the
// archive is byte-identical whichever machine packs it.
const MODE_DIR = 0o755
const MODE_FILE = 0o644

/** A ustar header: 512 bytes, the name split across the prefix field past 100. */
function header(name, size, mode, type, mtime) {
  const block = Buffer.alloc(512)
  const put = (text, offset, length) => block.write(text, offset, Math.min(length, Buffer.byteLength(text)), "utf8")
  const octal = (n, offset, length) => put(n.toString(8).padStart(length - 1, "0"), offset, length - 1)

  let rest = name
  if (Buffer.byteLength(name) > 100) {
    // The prefix field holds the leading directories; a path that still does not
    // fit is one the hub could not have produced either.
    const cut = name.lastIndexOf("/", 155)
    if (cut < 0) throw new Error(`path too long for the tar header: ${name}`)
    put(name.slice(0, cut), 345, 155)
    rest = name.slice(cut + 1)
  }
  put(rest, 0, 100)
  octal(mode, 100, 8)
  octal(0, 108, 8) // uid: the hub reads neither, and the operator's ids mean nothing there
  octal(0, 116, 8) // gid
  octal(size, 124, 12)
  octal(mtime, 136, 12)
  block.write("        ", 148, 8, "ascii") // checksum, computed below
  block[156] = type.charCodeAt(0)
  put("ustar\0", 257, 6)
  put("00", 263, 2)
  let sum = 0
  for (const byte of block) sum += byte
  put(sum.toString(8).padStart(6, "0"), 148, 6)
  block[154] = 0
  block[155] = 0x20
  return block
}

// The archive root IS the theme directory's contents: `theme.json`, `preview.png`
// and `dist/` sit at the top level, with no `<short>/` wrapper. The hub unpacks a
// package into a staging directory and reads `staging/theme.json`, so a wrapped
// archive is rejected with "主题包里没有 theme.json".
const files = walk(source)
const entries = files.map((f) => join(source, f))
const dirs = entries.filter((f) => statSync(f).isDirectory()).length

let unpacked = 0
for (const full of entries) {
  const info = statSync(full)
  if (info.size > LIMITS.file) throw new Error(`${relative(ROOT, full)} is over the 8 MiB single-file limit`)
  unpacked += info.isDirectory() ? 0 : info.size
}
if (entries.length > LIMITS.entries) throw new Error(`${entries.length} entries is over the 2000 limit`)
if (unpacked > LIMITS.unpacked) throw new Error(`${unpacked} bytes unpacked is over the 64 MiB limit`)

const mtime = Math.floor(Date.now() / 1000)
const parts = []
for (const full of entries) {
  const info = statSync(full)
  // The archive is rooted at the theme's own directory name, so extracting it
  // into --themes gives <themes-dir>/<short>/... directly.
  const name = relative(source, full).split(sep).join("/")
  const dir = info.isDirectory()
  parts.push(header(dir ? `${name}/` : name, dir ? 0 : info.size, dir ? MODE_DIR : MODE_FILE, dir ? "5" : "0", mtime))
  if (!dir) {
    const body = readFileSync(full)
    parts.push(body)
    const pad = (512 - (body.length % 512)) % 512
    if (pad) parts.push(Buffer.alloc(pad))
  }
}
// Two zero blocks end a tar, then the record is padded to a 10 KiB boundary.
const body = Buffer.concat(parts)
const end = Buffer.alloc(1024 + ((10240 - ((body.length + 1024) % 10240)) % 10240))
const tar = Buffer.concat([body, end])
if (tar.length - body.length > LIMITS.padding) throw new Error("tar padding is over the 1 MiB limit")

// Reads the headers back out of the finished archive and checks the two modes
// the installer depends on. Reverting to a mode taken from the packing machine
// is the easy mistake, and it is invisible until a hub refuses the package, so
// the package is not written if it carries a directory without the execute bit.
function verify(tar) {
  const str = (buf) => buf.toString("utf8").replace(/\0.*$/s, "").trim()
  const oct = (buf) => parseInt(str(buf).replace(/[^0-7]/g, "") || "0", 8)
  let at = 0
  let count = 0
  while (at + 512 <= tar.length) {
    const head = tar.subarray(at, at + 512)
    if (head.every((b) => b === 0)) break
    const name = str(head.subarray(0, 100))
    const size = oct(head.subarray(124, 136))
    const mode = oct(head.subarray(100, 108)) & 0o777
    const isDir = String.fromCharCode(head[156]) === "5" || name.endsWith("/")
    if (isDir && mode !== MODE_DIR) throw new Error(`directory \`${name}\` is ${mode.toString(8)}, want ${MODE_DIR.toString(8)}`)
    if (!isDir && mode !== MODE_FILE) throw new Error(`file \`${name}\` is ${mode.toString(8)}, want ${MODE_FILE.toString(8)}`)
    count += 1
    at += 512 + Math.ceil(size / 512) * 512
  }
  if (count !== entries.length) throw new Error(`archive holds ${count} entries, expected ${entries.length}`)
  return count
}

const gz = gzipSync(tar, { level: 9 })
if (gz.length > LIMITS.package) throw new Error(`${gz.length} bytes is over the 32 MiB package limit`)
verify(tar)
writeFileSync(target, gz)

const kb = (n) => `${(n / 1024).toFixed(1)} KiB`
console.log(
  `wrote theme.tar.gz: ${kb(gz.length)} packed, ${kb(unpacked)} unpacked, ` +
    `${entries.length} entries (${entries.length - dirs} files + ${dirs} directories), ` +
    `modes ${MODE_DIR.toString(8)}/${MODE_FILE.toString(8)}`,
)
