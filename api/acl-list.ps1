# Lists the security identifiers (SIDs) granted access to a path, one per line, for api/win-acl.js.
# SIDs, not names: group names are localised ("Users" is not "Users" on every Windows).
param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
foreach ($ace in (Get-Acl -LiteralPath $Path).Access) {
  if ($ace.AccessControlType -ne 'Allow') { continue }
  try { $ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value }
  catch { $ace.IdentityReference.Value }
}
