 $chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
  if (!(Test-Path $chrome)) {
    $chrome = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
  }

  $profile = "$env:USERPROFILE\Documents\chrome-profiles\mute-block-clean"
  $extension = "$env:USERPROFILE\Documents\src\mute-block-main\chrome"

  New-Item -ItemType Directory -Force $profile | Out-Null

  & $chrome `
    --user-data-dir="$profile" `
    --remote-debugging-port=9223 `
    --load-extension="$extension" `
    "https://www.quora.com/"

