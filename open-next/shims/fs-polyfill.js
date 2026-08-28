// open-next/shims/fs-polyfill.js
//
// Wrapper around node:fs that no-ops the methods unenv does not implement in
// the Cloudflare Workers runtime (nodejs_compat). Several app modules call
// fs.mkdirSync / fs.writeFileSync / fs.existsSync at module-load time (e.g.
// creating a logs dir, persisting a JWT secret); without this shim they throw
// "not implemented yet" and crash every page.
//
// This file is aliased as `fs` and `node:fs` by next.config.mjs during the CF
// build (isCfBuild). It re-exports everything from the real node:fs (so the
// methods that ARE implemented — readFileSync etc. — still work) and patches
// the missing ones to no-ops. State is ephemeral at the edge anyway (no
// persistent fs), so writes are intentionally discarded.
//
// We use __non_webpack_require__ to get the REAL node:fs (bypassing the
// webpack alias that points `fs`/`node:fs` to this file — otherwise it would
// be circular).

const fs = __non_webpack_require__("node:fs") ?? __non_webpack_require__("fs");

const nop = () => undefined;
const falseNop = () => false;

// Methods that unenv does not implement — make them no-ops.
const missing = [
  "mkdirSync", "mkdir",
  "writeFileSync", "writeFile",
  "appendFileSync", "appendFile",
  "unlinkSync", "unlink",
  "renameSync", "rename",
  "chmodSync", "chownSync",
  "copyFileSync", "cpSync",
  "rmSync", "rmdirSync",
];
const falseMissing = ["existsSync", "accessSync"];

for (const m of missing) {
  if (typeof fs[m] !== "function") fs[m] = nop;
}
for (const m of falseMissing) {
  if (typeof fs[m] !== "function") fs[m] = falseNop;
}

// Re-export everything (including the patched methods).
export const {
  readFileSync, readFile, readdirSync, readdir, statSync, stat,
  lstatSync, lstat, realpathSync, realpath, createReadStream, createWriteStream,
  watch, watchFile, unwatchFile, openAsBlob, opendir, opendirSync,
  read, readSync, write, writeSync, open, openSync, close, closeSync,
  readv, readvSync, writev, writevSync, fstatSync, fstat, ftruncateSync, ftruncate,
  fsyncSync, fsync, fdatasyncSync, fdatasync, fchmodSync, fchmod, fchownSync, fchown,
  fsetxattrSync, fsetxattr, fgetxattrSync, fgetxattr, flistxattrSync, flistxattr,
  fremovexattrSync, fremovexattr, copyFile, cp, rm, rmdir,
  mkdirSync, mkdir, writeFileSync, writeFile, appendFileSync, appendFile,
  unlinkSync, unlink, renameSync, rename, chmodSync, chownSync,
  existsSync, accessSync, access,
  promises, constants, Dirent, Stats, FSWatcher, StatWatcher, ReadStream,
  WriteStream, StatsBigInt,
} = fs;

export default fs;