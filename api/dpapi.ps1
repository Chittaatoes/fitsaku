# Windows DPAPI for api/spotify-vault.js: protect or unprotect one value for the CURRENT Windows
# user. Everything crosses as base64 (stdin in, stdout out) so no secret is ever on a command line
# and non-ASCII text survives the console code page. `$Entropy` (base64) is mixed into the key
# material: a blob only opens with the entropy it was made with.
#
#   protect:   stdin = base64(plaintext bytes)   stdout = base64(protected blob)
#   unprotect: stdin = base64(protected blob)    stdout = base64(plaintext bytes)
param([Parameter(Mandatory = $true)][ValidateSet('protect', 'unprotect')][string]$Op,
      [Parameter(Mandatory = $true)][string]$Entropy)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$entropyBytes = [Convert]::FromBase64String($Entropy)
$input64 = [Console]::In.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($input64)
$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
if ($Op -eq 'protect') {
  $out = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $entropyBytes, $scope)
} else {
  $out = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $entropyBytes, $scope)
}
[Console]::Out.Write([Convert]::ToBase64String($out))
