/* "Only the owner can use this" — asserted the way each platform actually enforces it.
 *
 * POSIX: the mode bits. Windows: modes are not enforced (Node reports 0o666 for every file), so the
 * real contract is the access list. Files and folders made inside a test's temp directory inherit
 * that directory's list; this asserts that no broad group (Everyone, Users, Authenticated Users,
 * Guests, Domain Users) can use the path, which is what a broken permission step or a data directory
 * on a shared drive would violate. See api/win-acl.js.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { broadAccess } from '../win-acl.js';

export async function assertOwnerOnly(p, posixMode) {
  if (process.platform === 'win32') {
    assert.deepEqual(await broadAccess(p), [], `${p}: a broad Windows group can use it`);
    return;
  }
  assert.equal(fs.statSync(p).mode & 0o777, posixMode, p);
}

/* A directory the server cannot write to, made the way the platform does it: POSIX takes the write
 * bit away; Windows adds a Deny entry for the current user (an explicit Deny beats the Allow the
 * folder inherited) and removes it again. Both leave the owner able to change it back and delete it. */
import { execFileSync } from 'node:child_process';
const who = () => (process.env.USERDOMAIN || '.') + '\\' + process.env.USERNAME;
export function makeUnwritable(dir) {
  if (process.platform === 'win32') execFileSync('icacls', [dir, '/deny', `${who()}:(OI)(CI)(WD,AD,DC)`], { stdio: 'ignore' });
  else fs.chmodSync(dir, 0o500);
}
export function makeWritable(dir) {
  if (process.platform === 'win32') execFileSync('icacls', [dir, '/remove:d', who()], { stdio: 'ignore' });
  else fs.chmodSync(dir, 0o700);
}
