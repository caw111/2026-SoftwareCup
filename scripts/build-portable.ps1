$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$outputRoot = Join-Path $projectRoot "dist-portable"
$appOutput = Join-Path $outputRoot "PersonalizedLearning"
$pythonVersion = "3.13.14"
$pythonSha256 = "90B4E5B9898B72D744650524BFF92377C367F44BD5FBD09E3148656C080AD907"
$pythonCacheRoot = Join-Path $projectRoot ".cache"
$pythonArchive = Join-Path $pythonCacheRoot "python-$pythonVersion-embed-amd64.zip"
$pythonRuntimeSource = Join-Path $pythonCacheRoot "python-$pythonVersion-embed-amd64"

if ((Split-Path $outputRoot -Parent) -ne $projectRoot -or (Split-Path $outputRoot -Leaf) -ne "dist-portable") {
  throw "Refusing to replace unexpected output path: $outputRoot"
}

if (Test-Path -LiteralPath $outputRoot) {
  Remove-Item -LiteralPath $outputRoot -Recurse -Force
}

New-Item -ItemType Directory -Path (Join-Path $appOutput "app") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $appOutput "runtime") -Force | Out-Null

if (-not (Test-Path -LiteralPath (Join-Path $pythonRuntimeSource "python.exe"))) {
  New-Item -ItemType Directory -Path $pythonCacheRoot -Force | Out-Null
  $needsDownload = -not (Test-Path -LiteralPath $pythonArchive)
  if (-not $needsDownload) {
    $needsDownload = (Get-FileHash -LiteralPath $pythonArchive -Algorithm SHA256).Hash -ne $pythonSha256
  }
  if ($needsDownload) {
    curl.exe -L --fail --retry 3 --connect-timeout 15 --max-time 300 --continue-at - --output $pythonArchive "https://www.python.org/ftp/python/$pythonVersion/python-$pythonVersion-embed-amd64.zip"
    if ($LASTEXITCODE -ne 0) {
      throw "Embedded Python download failed with exit code $LASTEXITCODE"
    }
  }
  $actualPythonHash = (Get-FileHash -LiteralPath $pythonArchive -Algorithm SHA256).Hash
  if ($actualPythonHash -ne $pythonSha256) {
    throw "Embedded Python checksum mismatch: $actualPythonHash"
  }
  if (Test-Path -LiteralPath $pythonRuntimeSource) {
    Remove-Item -LiteralPath $pythonRuntimeSource -Recurse -Force
  }
  Expand-Archive -LiteralPath $pythonArchive -DestinationPath $pythonRuntimeSource
}

foreach ($directory in @("backend", "database", "desktop", "frontend")) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $directory) -Destination (Join-Path $appOutput "app") -Recurse
}

New-Item -ItemType Directory -Path (Join-Path $appOutput "app\scripts") -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot "scripts\migrate.js") -Destination (Join-Path $appOutput "app\scripts\migrate.js")
Copy-Item -LiteralPath (Join-Path $projectRoot "package.json") -Destination (Join-Path $appOutput "app\package.json")
Copy-Item -LiteralPath (Join-Path $projectRoot "package-lock.json") -Destination (Join-Path $appOutput "app\package-lock.json")
Copy-Item -LiteralPath (Get-Command node.exe).Source -Destination (Join-Path $appOutput "runtime\node.exe")
Copy-Item -LiteralPath $pythonRuntimeSource -Destination (Join-Path $appOutput "runtime\python") -Recurse

Push-Location (Join-Path $appOutput "app")
try {
  npm ci --omit=dev --ignore-scripts
  if ($LASTEXITCODE -ne 0) {
    throw "npm production dependency installation failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

$launcher = @'
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
command = Chr(34) & base & "\runtime\node.exe" & Chr(34) & " " & Chr(34) & base & "\app\desktop\portable-main.js" & Chr(34)
exitCode = shell.Run(command, 0, True)
If exitCode <> 0 Then
  MsgBox "Startup failed. See %LOCALAPPDATA%\PersonalizedLearning\startup-error.log", 16, "Personalized Learning"
End If
'@
Set-Content -LiteralPath (Join-Path $appOutput "Start.vbs") -Value $launcher -Encoding ASCII

$readme = @'
Personalized Learning - Portable Desktop Edition

1. Double-click Start.vbs.
2. Node.js, MySQL and Docker are not required.
3. Microsoft Edge is required.
4. User data is stored in %LOCALAPPDATA%\PersonalizedLearning.
5. Python 3.13 is included and runs in a restricted child process.
6. This local restriction is for trusted demos, not hostile public code.
'@
Set-Content -LiteralPath (Join-Path $appOutput "README.txt") -Value $readme -Encoding ASCII

$zipPath = Join-Path $outputRoot "PersonalizedLearning-Portable-0.1.0.zip"
tar.exe -a -c -f $zipPath -C $appOutput .
if ($LASTEXITCODE -ne 0) {
  throw "Portable ZIP creation failed with exit code $LASTEXITCODE"
}
Write-Output $zipPath
