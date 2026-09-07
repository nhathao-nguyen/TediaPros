param([Parameter(Mandatory=$true)][string]$Python312)
$ErrorActionPreference = 'Stop'
$engineRoot = $PSScriptRoot
$pythonVersion = & $Python312 -c 'import sys; print(str(sys.version_info.major)+"."+str(sys.version_info.minor))'
if ($LASTEXITCODE -ne 0 -or $pythonVersion -ne '3.12') { throw 'Build requires Python 3.12.' }
& $Python312 -m venv (Join-Path $engineRoot '.venv-build')
if ($LASTEXITCODE -ne 0) { throw 'Cannot create isolated build environment.' }
$enginePython = Join-Path $engineRoot '.venv-build\Scripts\python.exe'
& $enginePython -m pip install torch==2.7.1 --index-url https://download.pytorch.org/whl/cu118
if ($LASTEXITCODE -ne 0) { throw 'Torch installation failed.' }
& $enginePython -m pip install -r (Join-Path $engineRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
& $enginePython -m PyInstaller --noconfirm --distpath (Join-Path $engineRoot 'dist') --workpath (Join-Path $engineRoot 'build') (Join-Path $engineRoot 'sttn-engine.spec')
if ($LASTEXITCODE -ne 0) { throw 'STTN package build failed.' }
Write-Host ('Runtime: ' + (Join-Path $engineRoot 'dist\sttn-engine'))
