#!/usr/bin/env bash
set -e

echo ""
echo " ======================================"
echo "  Mnemosyne | macOS build"
echo " ======================================"
echo ""

# 0. Version
GIT_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "dev")
printf "%s" "$GIT_TAG" > version.txt
echo " Verzió: $GIT_TAG"
echo ""

# 1. Build frontend
echo "[1/3] Frontend build (npm run build)..."
cd frontend
npm run build
cd ..
echo " OK: frontend/dist/ elkészült"
echo ""

# 2. Python deps
echo "[2/3] Python függőségek telepítése..."
pip install aiofiles pyinstaller --quiet
echo " OK: aiofiles, pyinstaller"
echo ""

# 3. PyInstaller
echo "[3/3] PyInstaller csomagolás..."
pyinstaller mnemosyne.spec --clean --noconfirm

echo ""
echo " ======================================"
echo "  KÉSZ!"
echo ""
echo "  Kimenet: dist/Mnemosyne.app"
echo "  Indításhoz: duplakattint a Mnemosyne.app-ra"
echo ""
echo "  Terjesztéshez tömörítsd be:"
echo "  cd dist && zip -r Mnemosyne-mac.zip Mnemosyne.app"
echo " ======================================"
echo ""
