"""
Mnemosyne launcher — PyInstaller entry point and development runner.

Usage:
  python launcher.py          (development)
  ./dist/Mnemosyne/Mnemosyne  (packaged build)
"""

import os
import sys
import socket
import threading
import time
import webbrowser
from pathlib import Path

# ── Path resolution: frozen (PyInstaller) vs development ──────────────────────
if getattr(sys, 'frozen', False):
    # _MEIPASS: where PyInstaller extracts bundled code/libs/assets
    BUNDLE_DIR = Path(sys._MEIPASS)
    # User data (projects, config) live next to the .exe, NOT in temp extraction dir
    APP_DIR = Path(sys.executable).parent
else:
    BUNDLE_DIR = Path(__file__).parent
    APP_DIR = Path(__file__).parent

os.environ.setdefault('MNEMOSYNE_APP_DIR', str(APP_DIR))
os.environ.setdefault('MNEMOSYNE_BUNDLE_DIR', str(BUNDLE_DIR))

if str(BUNDLE_DIR) not in sys.path:
    sys.path.insert(0, str(BUNDLE_DIR))


# ── Utilities ──────────────────────────────────────────────────────────────────

def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]


def _open_browser(port: int) -> None:
    time.sleep(2.5)
    webbrowser.open(f'http://localhost:{port}')


# ── Main ───────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    import uvicorn
    from backend.main import app  # import after path/env setup

    port = _free_port()
    threading.Thread(target=_open_browser, args=(port,), daemon=True).start()

    print(f'\n  Mnemosyne → http://localhost:{port}')
    print('  Bezáráshoz nyomd Ctrl+C (vagy zárd be ezt az ablakot)\n')

    uvicorn.run(app, host='127.0.0.1', port=port, log_level='warning')
