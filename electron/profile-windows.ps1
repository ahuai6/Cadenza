$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$base = [IO.Path]::GetFullPath($request.base).TrimEnd('\')
$prefix = $base + '\'

function Visit([string]$item, [bool]$walk, [bool]$remove) {
  $full = [IO.Path]::GetFullPath($item)
  if ($full -ne $base -and !$full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Profile item escaped its directory: $full"
  }
  $attributes = [IO.File]::GetAttributes($full)
  if ($attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw "Reparse point in application profile: $full"
  }
  if ($attributes -band [IO.FileAttributes]::Directory) {
    if ($walk) {
      foreach ($child in [IO.Directory]::GetFileSystemEntries($full)) { Visit $child $true $remove }
    }
    if ($remove) { [IO.Directory]::Delete($full, $false) }
  } else {
    if ($walk -and [IO.Path]::GetExtension($full) -match $request.media) {
      throw "Media found in a managed profile directory: $full"
    }
    if ($remove) { [IO.File]::Delete($full) }
  }
}

try {
  Visit $base $false $false
  foreach ($item in $request.items) {
    Visit $item $request.walk $request.remove
  }
} catch {
  [Console]::Out.WriteLine($_.Exception.Message)
  exit 1
}
