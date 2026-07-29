"""
Mnemosyne auto-updater.

State machine:
  idle → checking → up_to_date
                 → update_available → downloading → ready → applying
  any → error

All public functions are thread-safe.
"""

from __future__ import annotations

import json
import os
import platform
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import urllib.request
import zipfile
from pathlib import Path

GITHUB_OWNER = 'Gyulaa'
GITHUB_REPO  = 'Image-Organizer'
_API_URL     = f'https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest'

IS_FROZEN = getattr(sys, 'frozen', False)
IS_MAC    = platform.system() == 'Darwin'
IS_WIN    = platform.system() == 'Windows'

# ── State ──────────────────────────────────────────────────────────────────────

_state: dict = {
    'status':          'idle',
    'current_version': 'dev',
    'latest_version':  None,
    'release_name':    None,
    'release_url':     None,
    'download_url':    None,
    'downloaded':      0,
    'total':           0,
    'zip_path':        None,
    'error':           None,
}
_lock = threading.Lock()


def _set(**kw: object) -> None:
    with _lock:
        _state.update(kw)


def get_state() -> dict:
    with _lock:
        return dict(_state)


# ── Paths ──────────────────────────────────────────────────────────────────────

def _app_dir() -> Path:
    """Directory next to the executable (where user data lives)."""
    return Path(os.environ.get('MNEMOSYNE_APP_DIR', str(Path(__file__).parent.parent)))


def _bundle_dir() -> Path:
    """Directory PyInstaller extracts bundled data files into (_MEIPASS)."""
    env = os.environ.get('MNEMOSYNE_BUNDLE_DIR')
    if env:
        return Path(env)
    meipass = getattr(sys, '_MEIPASS', None)
    if meipass:
        return Path(meipass)
    return Path(__file__).parent.parent


def get_current_version() -> str:
    """
    Read the build tag stamped in at package time.

    The bundle dir must be checked FIRST: PyInstaller 6 onedir puts spec `datas`
    into <exe dir>/_internal, while _app_dir() is <exe dir> itself and holds only
    user data. Looking solely in _app_dir() always missed version.txt in packaged
    builds, so every release reported itself as 'dev' — and the 'dev' guard in
    _do_check() then silently forced status to 'up_to_date' forever.
    """
    for base in (_bundle_dir(), _app_dir(), Path(__file__).parent.parent):
        vf = base / 'version.txt'
        if vf.exists():
            # utf-8-sig strips a BOM if the build step wrote one
            v = vf.read_text(encoding='utf-8-sig').strip()
            if v:
                return v
    return 'dev'


def _tmp_dir() -> Path:
    d = Path(tempfile.gettempdir()) / 'mnemosyne_update'
    d.mkdir(exist_ok=True)
    return d


def _parse_version(tag: str) -> tuple[int, int]:
    """Parse 'build-YYYYMMDD-N' → (date_int, run_number) for comparison."""
    try:
        parts = tag.split('-')
        return (int(parts[1]), int(parts[2]))
    except Exception:
        return (0, 0)


# ── Version check ──────────────────────────────────────────────────────────────

def _do_check() -> None:
    try:
        ctx = ssl.create_default_context()
        req = urllib.request.Request(
            _API_URL,
            headers={
                'User-Agent': 'Mnemosyne-Updater/1.0',
                'Accept': 'application/vnd.github+json',
            },
        )
        with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
            data = json.loads(r.read())

        latest   = data['tag_name']
        current  = get_current_version()
        asset_nm = 'Mnemosyne-mac.zip' if IS_MAC else 'Mnemosyne-windows.zip'
        dl_url   = next(
            (a['browser_download_url'] for a in data.get('assets', []) if a['name'] == asset_nm),
            None,
        )
        # An unstamped build cannot be compared — say so instead of claiming
        # to be up to date, which is what hid this bug from the user.
        is_dev     = current == 'dev'
        has_update = (
            not is_dev
            and dl_url is not None
            and _parse_version(latest) > _parse_version(current)
        )
        _set(
            status          = ('update_available' if has_update
                               else 'dev_build' if is_dev
                               else 'up_to_date'),
            current_version = current,
            latest_version  = latest,
            release_name    = data.get('name', latest),
            release_url     = data.get('html_url', ''),
            download_url    = dl_url,
            error           = None,
        )
    except Exception as exc:
        _set(status='error', error=f'Verzióellenőrzés sikertelen: {exc}')


def trigger_check() -> None:
    """Start a version check in a background thread."""
    current = get_current_version()
    _set(status='checking', current_version=current, error=None,
         latest_version=None, release_name=None, release_url=None)
    threading.Thread(target=_do_check, daemon=True).start()


# ── Download ───────────────────────────────────────────────────────────────────

def _do_download(url: str) -> None:
    asset_nm = 'Mnemosyne-mac.zip' if IS_MAC else 'Mnemosyne-windows.zip'
    zip_path  = _tmp_dir() / asset_nm
    try:
        ctx = ssl.create_default_context()
        req = urllib.request.Request(url, headers={'User-Agent': 'Mnemosyne-Updater/1.0'})
        with urllib.request.urlopen(req, context=ctx) as r:
            total      = int(r.headers.get('Content-Length', 0))
            downloaded = 0
            _set(downloaded=0, total=total)
            with open(zip_path, 'wb') as f:
                while True:
                    chunk = r.read(65536)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    _set(downloaded=downloaded)
        _set(status='ready', zip_path=str(zip_path))
    except Exception as exc:
        _set(status='error', error=f'Letöltés sikertelen: {exc}')


def start_download() -> None:
    """Start the ZIP download in a background thread."""
    url = _state.get('download_url')
    if not url:
        _set(status='error', error='Nincs letöltési URL.')
        return
    _set(status='downloading', downloaded=0, total=0, zip_path=None, error=None)
    threading.Thread(target=_do_download, args=(url,), daemon=True).start()


# ── Apply ──────────────────────────────────────────────────────────────────────

def apply_update() -> None:
    """
    Extract the downloaded ZIP, write a platform-specific updater script,
    launch it as a detached process, then exit the app.

    The updater script:
      1. Waits for this process to fully close (3 s sleep)
      2. Copies user data (projects/, config.json) into the new version
      3. Replaces the old app with the new one
      4. Relaunches the app

    Raises RuntimeError if setup fails (before the exit).
    """
    if not IS_FROZEN:
        raise RuntimeError('Frissítés csak csomagolt alkalmazásban érhető el.')

    zip_path = Path(_state.get('zip_path') or '')
    if not zip_path.exists():
        raise RuntimeError('A letöltött fájl nem található.')

    _set(status='applying')

    extract_dir = _tmp_dir() / 'extracted'
    shutil.rmtree(extract_dir, ignore_errors=True)
    extract_dir.mkdir()

    with zipfile.ZipFile(zip_path, 'r') as z:
        z.extractall(extract_dir)

    app_dir = _app_dir()

    if IS_MAC:
        new_bundle = next((p for p in extract_dir.iterdir() if p.suffix == '.app'), None)
        if new_bundle is None:
            raise RuntimeError('Nem található .app a kicsomagolt archívumban.')
        old_bundle = app_dir.parent.parent  # Contents/MacOS → Contents → .app
        _launch_mac_updater(old_bundle, new_bundle)
    else:
        # Windows: Compress-Archive used `dist\Mnemosyne\*`, so files are at zip root
        _launch_win_updater(app_dir, extract_dir)


def _launch_mac_updater(old_bundle: Path, new_bundle: Path) -> None:
    old_str = str(old_bundle)
    new_str = str(new_bundle)

    script = f'''\
#!/bin/bash
LOG="/tmp/mnemosyne_update.log"
OLD="{old_str}"
NEW="{new_str}"

echo "=== Mnemosyne frissítés $(date) ===" > "$LOG"
echo "Várakozás az alkalmazás bezárására (3 mp)..." >> "$LOG"
sleep 3

OLD_DATA="$OLD/Contents/MacOS"
NEW_DATA="$NEW/Contents/MacOS"

echo "Felhasználói adatok mentése..." >> "$LOG"
for item in projects config.json models; do
    if [ -e "$OLD_DATA/$item" ]; then
        cp -R "$OLD_DATA/$item" "$NEW_DATA/$item" \\
            && echo "  Mentve: $item" >> "$LOG" \\
            || echo "  Hiba: $item mentése sikertelen" >> "$LOG"
    fi
done

echo "Alkalmazás cseréje..." >> "$LOG"
# Try direct replace (works when app is NOT in /Applications or user owns it)
if mv "$OLD" "$OLD.bak_update" 2>>"$LOG" && mv "$NEW" "$OLD" 2>>"$LOG"; then
    rm -rf "$OLD.bak_update"
    echo "  Csere sikeres." >> "$LOG"
else
    # Restore backup before trying with admin rights
    [ -d "$OLD.bak_update" ] && mv "$OLD.bak_update" "$OLD" 2>>"$LOG"
    echo "  Rendszergazdai jogok kérése..." >> "$LOG"
    osascript -e "do shell script \\"rm -rf '$OLD' && mv '$NEW' '$OLD'\\" with administrator privileges" >> "$LOG" 2>&1
fi

# Clear macOS quarantine flag so the app opens without a Gatekeeper warning
xattr -cr "$OLD" 2>>"$LOG" || true

echo "Alkalmazás indítása..." >> "$LOG"
open "$OLD"
echo "=== Kész ===" >> "$LOG"
'''

    script_path = Path(tempfile.gettempdir()) / 'mnemosyne_updater.sh'
    script_path.write_text(script, encoding='utf-8')
    script_path.chmod(0o755)
    subprocess.Popen(['bash', str(script_path)], start_new_session=True, close_fds=True)
    threading.Timer(1.0, _exit_app).start()


def _launch_win_updater(app_dir: Path, new_dir: Path) -> None:
    script_path = Path(tempfile.gettempdir()) / 'mnemosyne_updater.bat'
    app_str = str(app_dir)
    new_str = str(new_dir)

    script = f'''\
@echo off
setlocal
set "APP={app_str}"
set "NEW={new_str}"
set "LOG=%TEMP%\\mnemosyne_update.log"

echo === Mnemosyne frissites %date% %time% === > "%LOG%"
echo Varakozas az alkalmazas bezarasara (3 mp)... >> "%LOG%"
timeout /t 3 /nobreak > nul

echo Felhasznaloi adatok mentese... >> "%LOG%"
if exist "%APP%\\projects" (
    xcopy /E /I /Y /Q "%APP%\\projects" "%NEW%\\projects" >> "%LOG%" 2>&1
    echo   Mentve: projects >> "%LOG%"
)
if exist "%APP%\\config.json" (
    copy /Y "%APP%\\config.json" "%NEW%\\config.json" >> "%LOG%" 2>&1
    echo   Mentve: config.json >> "%LOG%"
)
if exist "%APP%\\models" (
    xcopy /E /I /Y /Q "%APP%\\models" "%NEW%\\models" >> "%LOG%" 2>&1
    echo   Mentve: models >> "%LOG%"
)

echo Fajlok cserelese... >> "%LOG%"
robocopy "%NEW%" "%APP%" /E /IS /IT /NFL /NDL /NJH /NJS >> "%LOG%" 2>&1

echo Ideiglenes fajlok torleese... >> "%LOG%"
rmdir /S /Q "%NEW%" >> "%LOG%" 2>&1

echo Alkalmazas ujrainditasa... >> "%LOG%"
start "" "%APP%\\Mnemosyne.exe"
echo === Kesz === >> "%LOG%"
endlocal
'''

    script_path.write_text(script, encoding='utf-8')
    subprocess.Popen(
        ['cmd', '/c', str(script_path)],
        creationflags=subprocess.CREATE_NEW_CONSOLE | subprocess.CREATE_NEW_PROCESS_GROUP,
        close_fds=True,
    )
    threading.Timer(1.0, _exit_app).start()


def _exit_app() -> None:
    os._exit(0)


