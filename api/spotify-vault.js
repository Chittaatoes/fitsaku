/* Where Spotify tokens are protected at rest.
 *
 * POSIX mode 0600 does nothing on NTFS (Node only maps it to the read-only flag): a file's access
 * list is inherited from its folder, and on a typical non-system drive that includes
 * "Authenticated Users: Modify". So on Windows the token file holds a DPAPI blob instead of the
 * tokens: encrypted for the current Windows user, with the file's own name mixed in as entropy so a
 * blob copied over another profile's file does not open. No dependency: it is one call to the
 * .NET ProtectedData class through the PowerShell that ships with Windows (api/dpapi.ps1), with
 * the secret passed on stdin, never on a command line.
 *
 * Elsewhere there is no vault (null) and the file is plaintext with mode 0600, which a POSIX
 * filesystem does enforce.
 *
 * Trade-offs, stated plainly: each protect/unprotect starts PowerShell (a few hundred ms, run
 * synchronously), so spotify.js caches the decrypted record in memory and calls it only on a
 * write or a cold read. Any process running as the same Windows user can still decrypt; DPAPI
 * keeps out other users and offline copies of the file, not malware in your own session.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dpapi.ps1');

export class VaultError extends Error {
  constructor() { super('vault'); this.name = 'VaultError'; }   // never carries the child's output
}

/** `{ protect(text, entropy) → string, unprotect(string, entropy) → text }`, both synchronous. */
export function dpapiVault({ run = spawnSync } = {}) {
  const call = (op, input64, entropy) => {
    const r = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, op, Buffer.from(entropy).toString('base64')],
      { input: input64, encoding: 'utf8', windowsHide: true, timeout: 20000 });
    if (r.error || r.status !== 0 || !r.stdout) throw new VaultError();
    return r.stdout.trim();
  };
  return {
    kind: 'dpapi',
    protect: (text, entropy) => call('protect', Buffer.from(text, 'utf8').toString('base64'), entropy),
    unprotect: (blob, entropy) => Buffer.from(call('unprotect', String(blob), entropy), 'base64').toString('utf8'),
  };
}

/** The vault this platform has: DPAPI on Windows, none elsewhere. */
export const platformVault = () => (process.platform === 'win32' ? dpapiVault() : null);
