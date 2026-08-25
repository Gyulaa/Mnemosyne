"""
Mnemosyne auto-updater.

State machine:
  idle → checking → up_to_date
                 → dev_build          (version unknown, cannot compare)
                 → update_available → downloading → ready → applying
  any → error

`install_failed` is not a status but a separate slot, set once at startup by
check_install_result() and never cleared by a later check.

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
    # Set once at startup by check_install_result() when the previous restart was
    # supposed to install a new version and did not. Survives every later check.
    'install_failed':  None,
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


# ── Install-attempt record ─────────────────────────────────────────────────────
#
# The updater script runs after this process is gone, so nothing it does can be
# reported back through _state. It leaves a breadcrumb in the temp dir instead,
# and the *next* process reads it — see check_install_result().

def _log_path() -> Path:
    return Path(tempfile.gettempdir()) / 'mnemosyne_update.log'


def _attempt_path() -> Path:
    return _tmp_dir() / 'attempt.json'


def _result_path() -> Path:
    return _tmp_dir() / 'result.txt'


def _write_attempt(expected: str) -> None:
    """Record which version this restart is supposed to come back as."""
    rec = {
        'expected': expected,
        'previous': get_current_version(),
        'app_dir':  str(_app_dir()),
        'log':      str(_log_path()),
        'result':   str(_result_path()),
    }
    try:
        _attempt_path().write_text(json.dumps(rec), encoding='utf-8')
    except OSError:
        pass


def _copy_ok(detail: str | None) -> bool:
    """
    Read the verdict the updater script left in result.txt.

    Unknown (no file, unparseable) counts as fine — the version comparison is the
    other half of the check, and a stale temp dir must not raise a false alarm.
    """
    if not detail:
        return True
    if detail.startswith('robocopy='):
        try:
            return int(detail.split('=', 1)[1].strip()) < 8
        except ValueError:
            return True
    if detail.startswith('replace=') or detail.startswith('stamp='):
        return detail.split('=', 1)[1].strip() == 'ok'
    return True


def check_install_result() -> None:
    """
    Startup check: did the update this app restarted for actually land?

    Called once from main.py. Without it a failed replace is indistinguishable
    from never having tried — the app comes back on the old version, the next
    check finds the same release again, and the user is offered the same update
    forever with nothing anywhere saying that it did not work.
    """
    path = _attempt_path()
    if not path.exists():
        return
    try:
        rec = json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        rec = {}
    try:
        path.unlink()
    except OSError:
        pass

    detail = None
    try:
        detail = Path(rec.get('result', '')).read_text(
            encoding='utf-8', errors='replace').strip() or None
    except OSError:
        pass

    expected = rec.get('expected')
    current  = get_current_version()
    if not expected or (current == expected and _copy_ok(detail)):
        return                                  # installed, or nothing to compare

    _set(install_failed={
        'expected': expected,
        'current':  current,
        'log':      rec.get('log', str(_log_path())),
        'detail':   detail,
    })


# ── Apply ──────────────────────────────────────────────────────────────────────

def apply_update() -> None:
    """
    Extract the downloaded ZIP, write a platform-specific updater script,
    launch it as a detached process, then exit the app.

    The updater script:
      1. Waits for *this* process id to disappear (not a fixed sleep — the old
         process holds every DLL it loaded, and robocopy blocks on those)
      2. Replaces the old app with the new one
      3. Records the outcome for the next start, then relaunches the app

    Raises RuntimeError if setup fails (before the exit).
    """
    if not IS_FROZEN:
        raise RuntimeError('Frissítés csak csomagolt alkalmazásban érhető el.')

    zip_path = Path(_state.get('zip_path') or '')
    if not zip_path.exists():
        raise RuntimeError('A letöltött fájl nem található.')

    expected = _state.get('latest_version') or ''

    try:
        _set(status='applying')

        extract_dir = _tmp_dir() / 'extracted'
        shutil.rmtree(extract_dir, ignore_errors=True)
        # exist_ok: the rmtree above is best-effort, and a leftover directory must
        # not turn the next attempt into a 500 with the UI stuck on 'applying'.
        extract_dir.mkdir(parents=True, exist_ok=True)

        with zipfile.ZipFile(zip_path, 'r') as z:
            z.extractall(extract_dir)

        app_dir = _app_dir()
        try:
            _result_path().unlink(missing_ok=True)
        except OSError:
            pass
        _write_attempt(expected)

        if IS_MAC:
            new_bundle = next((p for p in extract_dir.iterdir() if p.suffix == '.app'), None)
            if new_bundle is None:
                raise RuntimeError('Nem található .app a kicsomagolt archívumban.')
            old_bundle = app_dir.parent.parent  # Contents/MacOS → Contents → .app
            _launch_mac_updater(old_bundle, new_bundle)
        else:
            # Windows: Compress-Archive used `dist\Mnemosyne\*`, so files are at zip root
            _launch_win_updater(app_dir, extract_dir)
    except Exception as exc:
        # Never leave the UI spinning on 'applying'. Nothing was replaced and the
        # app is not going to restart, so say so instead of going quiet.
        try:
            _attempt_path().unlink(missing_ok=True)
        except OSError:
            pass
        _set(status='error', error=f'A frissítés alkalmazása sikertelen: {exc}')
        raise RuntimeError(str(exc)) from exc


# Both scripts take their paths as *arguments* instead of having them written
# into the file. A script file is read back in the platform's own encoding — on
# Windows cmd.exe parses a .bat in the console OEM code page (cp852 on a
# Hungarian install) while Python writes UTF-8 — so a single accented character
# in the install path used to turn the target into a different, non-existent
# directory. robocopy then *created* that directory, copied the new build into
# it, reported success and restarted the untouched old app. Arguments go through
# CreateProcessW as Unicode and survive intact, and the files stay pure ASCII.

_MAC_SCRIPT = '''\
#!/bin/bash
OLD="$1"
NEW="$2"
APPPID="$3"
RESULT="$4"
LOG="/tmp/mnemosyne_update.log"

echo "=== Mnemosyne frissites $(date) ===" > "$LOG"
echo "OLD=$OLD" >> "$LOG"
echo "NEW=$NEW" >> "$LOG"

echo "Varakozas az alkalmazas bezarasara..." >> "$LOG"
WAITED=0
while kill -0 "$APPPID" 2>/dev/null && [ "$WAITED" -lt 60 ]; do
    sleep 1
    WAITED=$((WAITED + 1))
done
sleep 1

OLD_DATA="$OLD/Contents/MacOS"
NEW_DATA="$NEW/Contents/MacOS"

# The whole bundle is replaced here, so user data really does have to be carried
# across first — unlike Windows, where the copy merges into the existing folder.
echo "Felhasznaloi adatok mentese..." >> "$LOG"
for item in projects config.json models; do
    if [ -e "$OLD_DATA/$item" ]; then
        cp -R "$OLD_DATA/$item" "$NEW_DATA/$item" \\
            && echo "  Mentve: $item" >> "$LOG" \\
            || echo "  Hiba: $item mentese sikertelen" >> "$LOG"
    fi
done

echo "Alkalmazas csereje..." >> "$LOG"
STATUS=fail
# Try direct replace (works when app is NOT in /Applications or user owns it)
if mv "$OLD" "$OLD.bak_update" 2>>"$LOG" && mv "$NEW" "$OLD" 2>>"$LOG"; then
    rm -rf "$OLD.bak_update"
    STATUS=ok
    echo "  Csere sikeres." >> "$LOG"
else
    # Restore backup before trying with admin rights
    [ -d "$OLD.bak_update" ] && mv "$OLD.bak_update" "$OLD" 2>>"$LOG"
    echo "  Rendszergazdai jogok kerese..." >> "$LOG"
    if osascript -e "do shell script \\"rm -rf '$OLD' && mv '$NEW' '$OLD'\\" with administrator privileges" >> "$LOG" 2>&1; then
        STATUS=ok
    else
        echo "  HIBA: a csere nem sikerult - a regi verzio marad." >> "$LOG"
    fi
fi
echo "replace=$STATUS" > "$RESULT"

# Clear macOS quarantine flag so the app opens without a Gatekeeper warning
xattr -cr "$OLD" 2>>"$LOG" || true

echo "Alkalmazas inditasa..." >> "$LOG"
open "$OLD"
echo "=== Kesz ===" >> "$LOG"
'''


_WIN_SCRIPT = '''\
@echo off
setlocal
set "APP=%~1"
set "NEW=%~2"
set "APPPID=%~3"
set "RESULT=%~4"
set "LOG=%TEMP%\\mnemosyne_update.log"

echo === Mnemosyne frissites %date% %time% === > "%LOG%"
echo APP="%APP%" >> "%LOG%"
echo NEW="%NEW%" >> "%LOG%"

echo Varakozas az alkalmazas bezarasara... >> "%LOG%"
set /a WAITED=0
:waitloop
tasklist /FI "PID eq %APPPID%" /NH 2>nul | find "%APPPID%" > nul
if errorlevel 1 goto closed
timeout /t 1 /nobreak > nul
set /a WAITED+=1
if %WAITED% LSS 60 goto waitloop
echo   Figyelmeztetes: a folyamat 60 mp utan is fut >> "%LOG%"
:closed
timeout /t 1 /nobreak > nul

echo Fajlok cserelese... >> "%LOG%"
robocopy "%NEW%" "%APP%" /E /IS /IT /R:2 /W:2 /XD "%NEW%\\projects" /XF "%NEW%\\config.json" "%NEW%\\_internal\\version.txt" /NFL /NDL /NJH /NJS >> "%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
echo robocopy=%RC% >> "%LOG%"

if %RC% GEQ 8 (
    echo   HIBA: a masolas nem sikerult - a regi verzio marad. >> "%LOG%"
    echo robocopy=%RC% > "%RESULT%"
) else (
    rem version.txt is copied last and only once everything else is in place, so
    rem the stamp the app reads always means "this build is fully installed".
    rem robocopy can fail on the locked exe and still reach _internal on the same
    rem run, which would otherwise leave the old app claiming the new version.
    copy /Y "%NEW%\\_internal\\version.txt" "%APP%\\_internal\\version.txt" >> "%LOG%" 2>&1
    if errorlevel 1 (
        echo   HIBA: a verziojelolo irasa nem sikerult. >> "%LOG%"
        echo stamp=fail > "%RESULT%"
    ) else (
        echo robocopy=%RC% > "%RESULT%"
        echo Ideiglenes fajlok torlese... >> "%LOG%"
        rmdir /S /Q "%NEW%" >> "%LOG%" 2>&1
    )
)

echo Alkalmazas ujrainditasa... >> "%LOG%"
start "" "%APP%\\Mnemosyne.exe"
echo === Kesz === >> "%LOG%"
endlocal
'''


def _launch_mac_updater(old_bundle: Path, new_bundle: Path) -> None:
    script_path = Path(tempfile.gettempdir()) / 'mnemosyne_updater.sh'
    script_path.write_text(_MAC_SCRIPT, encoding='utf-8')
    script_path.chmod(0o755)
    subprocess.Popen(
        ['bash', str(script_path), str(old_bundle), str(new_bundle),
         str(os.getpid()), str(_result_path())],
        start_new_session=True,
        close_fds=True,
    )
    threading.Timer(1.0, _exit_app).start()


def _launch_win_updater(app_dir: Path, new_dir: Path) -> None:
    """
    Two robocopy details, both load-bearing:

    * `/R:2 /W:2` — the built-in defaults are `/R:1000000 /W:30`, so one file it
      cannot open (the old process still running, a virus scanner holding the
      freshly extracted DLLs) makes it retry for weeks instead of failing.
    * exit codes below 8 are success; 8 and above mean at least one file was not
      copied. Nothing used to look, so a completely failed replace still ended
      with the batch cheerfully restarting the old app.

    `projects/` and `config.json` are excluded rather than copied out to the temp
    dir and back: robocopy without `/PURGE` leaves destination-only files alone,
    so user data in the app folder survives a merge copy untouched anyway.
    """
    script_path = Path(tempfile.gettempdir()) / 'mnemosyne_updater.bat'
    script_path.write_text(_WIN_SCRIPT, encoding='ascii')
    subprocess.Popen(
        ['cmd', '/c', str(script_path), str(app_dir), str(new_dir),
         str(os.getpid()), str(_result_path())],
        creationflags=subprocess.CREATE_NEW_CONSOLE | subprocess.CREATE_NEW_PROCESS_GROUP,
        close_fds=True,
    )
    threading.Timer(1.0, _exit_app).start()


def _exit_app() -> None:
    os._exit(0)
