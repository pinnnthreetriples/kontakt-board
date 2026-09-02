# Файл сохранён в UTF-8 с BOM: Windows PowerShell 5.1, которым его запускает
# START_WINDOWS.cmd, без BOM читает русские строки как ANSI и падает на разборе.
# Запуск локального моста к MAX. Скрипт сам готовит окружение и ставит в него
# закреплённые версии из bridge\requirements.txt. Интернет нужен только при
# первой установке и после изменения requirements.txt.
[CmdletBinding()]
param(
  # Origin страницы приложения. Порт веб-сервера выбирается при запуске, поэтому
  # разрешённый источник передаётся сюда, а не зашивается в мост.
  [string]$Origin = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$bridgeDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\bridge'))
# Окружение живёт на локальном диске, а не рядом с программой: тогда её можно
# держать на флешке и носить между компьютерами. Каждый компьютер ставит своё
# окружение под свой Python, а смена буквы диска ничего не ломает.
$venvDir = Join-Path $env:LOCALAPPDATA 'KontaktBoard\bridge-venv'
$venvPython = Join-Path $venvDir 'Scripts\python.exe'
$requirements = Join-Path $bridgeDir 'requirements.txt'
$stampFile = Join-Path $venvDir '.requirements-hash'

function Stop-WithHint {
  # Окно моста закрывается вместе со скриптом, поэтому перед выходом нужна
  # пауза: иначе единственное объяснение проблемы мелькнёт и исчезнет.
  param([string[]]$Lines)
  Write-Host ''
  foreach ($line in $Lines) { Write-Host $line -ForegroundColor Red }
  Write-Host ''
  Read-Host 'Нажмите Enter, чтобы закрыть это окно' | Out-Null
  exit 1
}

function Find-Python {
  # py.exe умеет выбрать нужную версию сам, поэтому он в приоритете. Заглушка
  # python.exe из Microsoft Store версию не печатает и открывает магазин.
  $candidates = @(
    [pscustomobject]@{ Exe = 'py'; Prefix = @('-3') },
    [pscustomobject]@{ Exe = 'python'; Prefix = @() }
  )
  foreach ($candidate in $candidates) {
    if (-not (Get-Command $candidate.Exe -ErrorAction SilentlyContinue)) { continue }
    # Спрашиваем версию ключом -V, а не коротким скриптом: Windows PowerShell 5.1
    # ломает кавычки внутри аргументов, и такой скрипт до Python не доходит.
    try { $banner = & $candidate.Exe @($candidate.Prefix) '-V' 2>$null }
    catch { continue }
    if ($LASTEXITCODE -ne 0 -or -not $banner) { continue }
    $match = [regex]::Match([string]$banner, '(\d+)\.(\d+)')
    if (-not $match.Success) { continue }
    $version = "$($match.Groups[1].Value).$($match.Groups[2].Value)"
    if ([version]$version -lt [version]'3.10') { continue }
    return [pscustomobject]@{ Exe = $candidate.Exe; Prefix = $candidate.Prefix; Version = $version }
  }
  return $null
}

if (Test-Path $venvPython) {
  # Прерванная установка оставляет python.exe на месте, но нерабочим. Такое
  # окружение чинится только пересозданием, а не доустановкой пакетов.
  & $venvPython '-c' 'pass' 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'Окружение моста повреждено, создаю заново.' -ForegroundColor Yellow
    Remove-Item $venvDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if (-not (Test-Path $venvPython)) {
  $python = Find-Python
  if (-not $python) {
    Stop-WithHint @(
      'Не найден Python 3.10 или новее, без него мост к MAX не работает.',
      'Установите его с python.org, включив галочку "Add python.exe to PATH",',
      'затем закройте приложение и запустите START_WINDOWS.cmd заново.'
    )
  }
  Write-Host "Готовлю окружение моста, Python $($python.Version). Это делается один раз." -ForegroundColor Cyan
  & $python.Exe @($python.Prefix) '-m' 'venv' $venvDir
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $venvPython)) {
    Stop-WithHint @(
      'Не удалось создать окружение моста в папке:',
      "  $venvDir",
      'Проверьте, что эту папку можно изменять и что антивирус не мешает',
      'создавать в ней файлы, затем запустите приложение заново.'
    )
  }
}

$requirementsHash = (Get-FileHash -Path $requirements -Algorithm SHA256).Hash
$installedHash = if (Test-Path $stampFile) { (Get-Content $stampFile -Raw).Trim() } else { '' }

if ($installedHash -ne $requirementsHash) {
  Write-Host 'Устанавливаю библиотеки моста, нужен интернет. Это занимает пару минут.' -ForegroundColor Cyan
  # --only-binary: сборка из исходников на машине оператора потребовала бы
  # компилятора и превратила бы обычный запуск в отладку окружения.
  & $venvPython '-m' 'pip' 'install' '--disable-pip-version-check' '--only-binary' ':all:' '-r' $requirements
  if ($LASTEXITCODE -ne 0) {
    Stop-WithHint @(
      'Не удалось установить библиотеки моста.',
      'Проверьте интернет, а если он есть, удалите папку',
      "  $venvDir",
      'и запустите приложение заново.'
    )
  }
  Set-Content -Path $stampFile -Value $requirementsHash -Encoding ascii
}

$bridgeArgs = @('bridge.py')
if ($Origin) { $bridgeArgs += @('--origin', $Origin) }

Push-Location $bridgeDir
try {
  & $venvPython @bridgeArgs
  $code = $LASTEXITCODE
}
finally {
  Pop-Location
}
if ($code -ne 0) {
  Stop-WithHint @("Мост остановился с кодом $code, причина указана выше.")
}
exit 0
