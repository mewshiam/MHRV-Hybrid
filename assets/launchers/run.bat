@echo off
REM mhrv-rs launcher for Windows.
REM Runs the CLI once to initialize the MITM CA (may trigger a UAC prompt when
REM installing into the Windows trust store), then launches the UI.

setlocal
cd /d "%~dp0"

if not exist "mhrv-rs.exe" (
    echo error: mhrv-rs.exe not found next to this script.
    pause
    exit /b 1
)

echo Initializing MITM CA (a UAC prompt may appear)...
mhrv-rs.exe --install-cert
if errorlevel 1 (
    echo warning: CA install returned non-zero. The UI can still run,
    echo but HTTPS sites may show certificate warnings until the CA is trusted.
)

if not exist "mhrv-rs-ui.exe" (
    echo UI binary not found. Running CLI proxy instead.
    mhrv-rs.exe
    goto :eof
)

echo.
echo Starting mhrv-rs UI...
echo (A new window should open. If nothing appears, the UI crashed — the
echo  error is shown in this terminal below. Take a screenshot of it and
echo  open an issue on github.)
echo.

REM Run in-place (not via `start`) so if the UI dies on launch, its stderr
REM and non-zero exit code are visible in this window. Previously we used
REM `start "" "mhrv-rs-ui.exe"` which returns immediately and swallows any
REM launch-time crash (issue #7).
mhrv-rs-ui.exe
set UI_EXIT=%ERRORLEVEL%
if not "%UI_EXIT%"=="0" (
    echo.
    echo ---------------------------------------------------
    echo UI exited with error code %UI_EXIT%.
    echo.
    echo If this is the first time and you just saw the UI crash immediately,
    echo common causes on Windows are:
    echo   - missing or outdated graphics drivers (try updating)
    echo   - running inside RDP or a VM without GPU acceleration
    echo   - antivirus blocking the exe — whitelist the folder and retry
    echo.
    echo Copy everything above and open an issue on:
    echo   https://github.com/therealaleph/MasterHttpRelayVPN-RUST/issues
    echo ---------------------------------------------------
    pause
)

endlocal
