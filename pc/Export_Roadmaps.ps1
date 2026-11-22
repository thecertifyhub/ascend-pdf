# Export_Roadmaps.ps1 - started by Export_Roadmaps.bat (G:\My Drive\Roadmaps).
# For every roadmap that is built and not yet exported: creates the lead's folder, saves the PDF there, has
# PowerPoint export the narrated deck as a 1080p video (recorded timings and narration), saves the video there,
# and uploads it so the lead's personal page plays it. Test roadmaps are skipped. Log: _export\export_log.txt
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
[Net.ServicePointManager]::Expect100Continue = $false

$here = Split-Path -Parent $MyInvocation.MyCommand.Path      # ...\Roadmaps\_export
$root = Split-Path -Parent $here                              # ...\Roadmaps
$api  = 'https://jbncsigalbtfwkxpgwso.supabase.co/functions/v1/roadmap-pc'
$key  = (Get-Content (Join-Path $here 'export.key') -Raw).Trim()
$log  = Join-Path $here 'export_log.txt'
$work = Join-Path $env:TEMP 'ascend_roadmaps'
New-Item -ItemType Directory -Force $work | Out-Null

function Say($m) { $t = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m"; Write-Host $t; Add-Content -Path $log -Value $t -Encoding UTF8 }
function Api($body) {
  $body.key = $key
  $bytes = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Compress))
  # read as UTF-8 (Windows PowerShell 5 would otherwise garble accents such as the e in Herve)
  $r = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $api -ContentType 'application/json; charset=utf-8' -Body $bytes
  [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()) | ConvertFrom-Json
}

$list = Api @{ action = 'list' }
if (-not $list.items -or $list.items.Count -eq 0) { Say 'Nothing to export: every built roadmap already has its video.'; exit 0 }
Say "$($list.items.Count) roadmap(s) to export."

$ppt = New-Object -ComObject PowerPoint.Application
$hadOpen = $ppt.Presentations.Count -gt 0

foreach ($it in $list.items) {
  try {
    Say "--- $($it.name) ($($it.language))"
    $dir = Join-Path $root $it.folder
    New-Item -ItemType Directory -Force $dir | Out-Null
    $pptx = Join-Path $work "$($it.base).pptx"
    $mp4w = Join-Path $work "$($it.base).mp4"
    $dest = Join-Path $dir "$($it.base).mp4"
    Invoke-WebRequest -UseBasicParsing -Uri $it.pdf_url -OutFile (Join-Path $dir "$($it.base).pdf")
    $built = [datetime]::Parse($it.built_at).ToUniversalTime()
    if ((Test-Path $dest) -and ((Get-Item $dest).LastWriteTimeUtc -gt $built)) {
      # exported from this same deck on an earlier run whose upload failed: upload it again, no new export
      Say 'Video already exported on an earlier run: uploading it again.'
      Copy-Item $dest $mp4w -Force
    } else {
    Invoke-WebRequest -UseBasicParsing -Uri $it.pptx_url -OutFile $pptx
    Say 'Deck and PDF downloaded. PowerPoint is exporting the video...'
    if (Test-Path $mp4w) { Remove-Item $mp4w -Force }

    # Open(FileName, ReadOnly, Untitled, WithWindow); CreateVideo(FileName, UseTimingsAndNarrations,
    # DefaultSlideDuration, VertResolution, FramesPerSecond, Quality)
    $pres = $ppt.Presentations.Open($pptx, -1, 0, -1)
    $pres.CreateVideo($mp4w, $true, 5, 1080, 30, 85)
    # CreateVideoStatus: 1 in progress, 2 queued, 3 done, 4 failed
    do { Start-Sleep -Seconds 5; $st = $pres.CreateVideoStatus } while ($st -eq 1 -or $st -eq 2)
    $pres.Close()
    if ($st -ne 3) { throw "PowerPoint could not export the video (status $st)." }
    $mb = [math]::Round((Get-Item $mp4w).Length / 1MB)
    Say "Video exported ($mb MB)."

    Copy-Item $mp4w $dest -Force
    Say "Saved in $dir"
    }

    $slot = Api @{ action = 'video_slot'; request_id = $it.id }
    # curl.exe (built into Windows 10/11): PowerShell 5's own upload drops large files
    $code = & curl.exe -sS -o NUL -w '%{http_code}' -X PUT -H 'Content-Type: video/mp4' -H 'x-upsert: true' --data-binary "@$mp4w" $slot.signed_url
    if ($LASTEXITCODE -ne 0 -or $code -notmatch '^2') { throw "Video upload failed (curl exit $LASTEXITCODE, HTTP $code)." }
    $done = Api @{ action = 'video_done'; request_id = $it.id; path = $slot.path }
    Say 'Uploaded: the lead''s page now plays this video.'
    Remove-Item $pptx, $mp4w -Force -ErrorAction SilentlyContinue
  } catch {
    $detail = if ($_.ErrorDetails -and $_.ErrorDetails.Message) { " | $($_.ErrorDetails.Message)" } else { '' }
    Say "FAILED for $($it.name): $($_.Exception.Message)$detail"
    try { if ($pres) { $pres.Close() } } catch {}
  }
}
if (-not $hadOpen) { $ppt.Quit() }
Say 'Done.'
