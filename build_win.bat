@echo off
setlocal enabledelayedexpansion
echo.
echo  ======================================
echo   Mnemosyne ^| Windows build
echo  ======================================
echo.

:: 1. Build frontend
echo [1/3] Frontend build (npm run build)...
cd frontend
call npm run build
if errorlevel 1 (
    echo.
    echo  HIBA: Frontend build meghiusult!
    pause & exit /b 1
)
cd ..
echo  OK: frontend\dist\ elkeszult
echo.

:: 2. Python deps (venv-bol)
echo [2/3] Python fuggosegek telepitese...
.venv\Scripts\pip.exe install aiofiles pyinstaller --quiet
if errorlevel 1 (
    echo.
    echo  HIBA: pip install meghiusult!
    pause & exit /b 1
)
echo  OK: aiofiles, pyinstaller
echo.

:: 3. PyInstaller (venv-bol)
echo [3/3] PyInstaller csomagolas...
.venv\Scripts\pyinstaller.exe mnemosyne.spec --clean --noconfirm
if errorlevel 1 (
    echo.
    echo  HIBA: PyInstaller meghiusult!
    pause & exit /b 1
)

echo.
echo  ======================================
echo   KESZ!
echo.
echo   Kimenet: dist\Mnemosyne\
echo   Inditashoz: dist\Mnemosyne\Mnemosyne.exe
echo.
echo   A teljes dist\Mnemosyne\ mappat kuldd el
echo   (tomoritve ZIP-be).
echo  ======================================
echo.
pause
