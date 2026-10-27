/* What Windows actually lets other accounts do with a folder or file.
 *
 * POSIX modes (0600, 0700) are not enforced on NTFS: a new file inherits its folder's access
 * list. For the data directory (the session secret, db.json, the AI coach and Spotify credentials)
 * that list is the whole protection, so on Windows REPO checks it once at start and says so if it
 * includes a broad group, and the tests assert it on the files they create. Nothing here changes a
 * permission: tightening a folder's access list is the owner's decision (the warning shows the
 * command).
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'acl-list.ps1');

// Everyone, Guests, Users, Authenticated Users, and any domain's "Domain Users" (RID 513) / "Domain Guests" (514).
const BROAD = new Set(['S-1-1-0', 'S-1-5-11', 'S-1-5-32-545', 'S-1-5-32-546', 'S-1-5-7']);
export const isBroadSid = sid => BROAD.has(sid) || /^S-1-5-21-[\d-]+-(513|514)$/.test(sid);

/** The SIDs with an Allow entry on `target`, in the order Windows lists them. */
export function accessSids(target, { run = execFile } = {}) {
  return new Promise((resolve, reject) => {
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Path', target],
      { encoding: 'utf8', windowsHide: true, timeout: 20000 }, (err, stdout) => {
        if (err) return reject(new Error('acl'));
        resolve(String(stdout).split(/\r?\n/).map(s => s.trim()).filter(Boolean));
      });
  });
}

/** The broad groups that can use `target`: empty means only specific accounts can. */
export async function broadAccess(target, opts) {
  return (await accessSids(target, opts)).filter(isBroadSid);
}
