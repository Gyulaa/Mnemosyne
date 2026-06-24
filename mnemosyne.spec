# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for Mnemosyne
# Run: pyinstaller mnemosyne.spec --clean --noconfirm

from pathlib import Path
ROOT = Path(SPECPATH)

a = Analysis(
    [str(ROOT / 'launcher.py')],
    pathex=[str(ROOT)],
    binaries=[],
    datas=[
        (str(ROOT / 'frontend' / 'dist'), 'frontend_dist'),
        (str(ROOT / 'frontend' / 'public' / 'favicon.png'), '.'),
        # insightface's pickle_object.py looks for sys._MEIPASS/objects/*.pkl when frozen
        (str(ROOT / '.venv/Lib/site-packages/insightface/data/objects'), 'objects'),
    ],
    hiddenimports=[
        # insightface
        'insightface',
        'insightface.app',
        'insightface.model_zoo',
        'insightface.model_zoo.model_zoo',
        'insightface.utils',
        'insightface.utils.face_align',
        # onnxruntime
        'onnxruntime',
        'onnxruntime.backend',
        'onnxruntime.capi',
        'onnxruntime.capi.onnxruntime_inference_collection',
        # scikit-learn / scipy
        'sklearn',
        'sklearn.cluster',
        'sklearn.cluster._dbscan_inner',
        'sklearn.neighbors',
        'sklearn.neighbors._dist_metrics',
        'sklearn.utils._cython_blas',
        'scipy',
        'scipy.spatial',
        'scipy.spatial.distance',
        'scipy.sparse',
        'scipy.sparse.csgraph',
        # PIL / Pillow
        'PIL',
        'PIL._imaging',
        'pillow_heif',
        # OpenCV
        'cv2',
        # async file serving
        'aiofiles',
        # uvicorn
        'uvicorn',
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.loops.asyncio',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.http.h11_impl',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        # FastAPI / Starlette
        'fastapi',
        'fastapi.staticfiles',
        'starlette',
        'starlette.staticfiles',
        'starlette.responses',
        # SQLAlchemy
        'sqlalchemy',
        'sqlalchemy.dialects.sqlite',
        'sqlalchemy.dialects.sqlite.pysqlite',
        # app backend
        'backend',
        'backend.main',
        'backend.database',
        'backend.scanner',
        'backend.clusterer',
        'backend.project_manager',
        'backend.schemas',
        'backend.image_utils',
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=['torch', 'tensorflow', 'matplotlib', 'notebook', 'IPython', 'pytest'],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Mnemosyne',
    debug=False,
    strip=False,
    upx=True,
    console=True,
    icon=str(ROOT / 'frontend' / 'public' / 'favicon.png'),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='Mnemosyne',
)

# macOS .app bundle (ignored on Windows)
app = BUNDLE(
    coll,
    name='Mnemosyne.app',
    icon=str(ROOT / 'frontend' / 'public' / 'favicon.png'),
    bundle_identifier='hu.prometheusagency.mnemosyne',
    info_plist={
        'NSHighResolutionCapable': True,
        'CFBundleShortVersionString': '1.0.0',
    },
)
