# RhinoView

Web viewer for Rhino `.3dm` models on a local Windows server. The browser never
opens the `.3dm`; the server converts it to a GLB and the viewer draws that.

MVP scope: one viewer page, version dropdown, A/B version toggle, layer list
grouped by layer or by colour, materials, section cuts, saved layer sets,
click-to-inspect, zoom to object or layer, two-point distance and three-point
angle measure with selectable units, view cube. No login; meant for a LAN.

## Data folder

Everything the app serves comes from one folder, `D:\rhino\data` by default:

```
data/
  app.db                                  SQLite: projects, versions, saved layer sets
  projects/
    TPRO/
      versions/
        v3/
          source.3dm                      optional when the three outputs exist
          model.glb                       one mesh per Rhino layer
          scene.json                      layers, totals, bounds
          objects.json                    per-object boxes and triangle ranges
        v4/
          ...
```

To add a version:

1. Create a folder `data\projects\TPRO\versions\v5`.
2. Copy the Rhino file into it as `source.3dm`.
3. In the web app press **Load new version** then **Scan again**.
4. Leave **Delete the source .3dm after conversion** ticked if the server
   should not keep the large original file. The file is only removed after a
   successful conversion.
5. The server converts the file in the background (one job at a time). The
   version menu shows progress; choose the version when it says **Ready**.

`source.3dm` may be omitted if `model.glb`, `scene.json` and `objects.json`
already exist (for example a folder produced on another machine).

When `source.3dm` is newer than `model.glb`, the next scan queues a new
conversion. Use a new folder name for a new revision; that keeps the old GLB
and the A/B comparison intact.

## Settings

Copy `.env.example` to `.env` and edit it. `scripts\start.ps1` does this copy
automatically on the first run. The important values:

| Key | Default | Meaning |
| --- | --- | --- |
| `RHINO_DATA_DIR` | `D:\rhino\data` | data folder above |
| `RHINO_DEFAULT_PROJECT` | `TPRO` | project created on first run |
| `RHINO_HOST` / `RHINO_PORT` | `0.0.0.0` / `8000` | server address |
| `RHINO_DATABASE_URL` | empty | empty means `<data>\app.db` |
| `RHINO_CONVERTER_PYTHON` | current Python | interpreter for the converter |
| `RHINO_CONVERTER_SCRIPT` | `services\converter-3dm\convert.py` | converter entry point |

The app reads `.env` next to this README.

## Requirements

- Windows 10/11 or Windows Server.
- Python 3.11+ on `PATH` (the `python` command); tested with 3.13.
- Node.js 18+ on `PATH` (`node` and `npm`); only needed to build the web app.
- Port 8000 free and allowed through the firewall for LAN access.
- Git (optional, to clone and update the repository).

## Folders and files created on first run

These are not in Git. The start script or the API creates them:

| Item | Created by | What it is |
| --- | --- | --- |
| `.venv` | `scripts\start.ps1` (`python -m venv .venv`) | Python environment; packages from `apps\api\requirements.txt` |
| `apps\web\node_modules` | `npm install` in `scripts\start.ps1` (when `dist` is missing) or `scripts\build_web.ps1` | Node packages for the frontend build |
| `apps\web\dist` | `npm run build` in `scripts\start.ps1` or `scripts\build_web.ps1` | Built HTML/JS served by FastAPI |
| `.env` | `scripts\start.ps1` copies `.env.example` | Local settings; edit `RHINO_DATA_DIR` before the first scan |
| `data` | The API at startup (`settings.ensure_dirs()`) | `app.db` and `projects\<project>\versions\<version>` |
| `data\app.db` | The API at startup (`init_db()`) | SQLite: projects, versions, saved layer sets |
| `data\projects\TPRO\versions` | The scanner (`scan_all`) | One folder per version |

`scripts\start.ps1` does all of this automatically. If `dist` already exists
but the frontend changed, run `scripts\build_web.ps1`; it runs `npm install`
and rebuilds. If `node_modules` is missing and you only want to run the app,
nothing is needed because `dist` is already built.

### Manual setup (without start.ps1)

```powershell
# 1. Python environment (.venv)
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r apps\api\requirements.txt

# 2. Frontend (node_modules + dist)
cd apps\web
npm install
npm run build
cd ..\..

# 3. Local settings (.env)
Copy-Item .env.example .env
notepad .env

# 4. Run; the API creates the data folder and app.db
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --app-dir apps\api
```

To create the data folder before the first start:

```powershell
New-Item -ItemType Directory -Force D:\rhino\data
```

## Run on the server

One command from this folder:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start.ps1
```

The script creates `.venv`, installs the Python requirements, builds the web
app when `apps\web\dist` is missing, creates `.env` from `.env.example` when it
is missing, and serves everything on `http://<server-ip>:8000`. Open that
address from another PC on the LAN. The API creates the `data` folder and
`app.db` on its first start.

First run, in order:

1. Install Python 3.11+ and Node.js 18+ (Node is only needed to build).
2. Clone or copy the repository to the server.
3. Run `scripts\start.ps1`.
4. If the data folder must live on another drive, stop the app, edit
   `RHINO_DATA_DIR` in `.env`, then start it again.
5. Open `http://<server-ip>:8000` and add the first version.

To rebuild the web app after changing the frontend:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build_web.ps1
```

## Development

Backend (port 8000):

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000 --app-dir apps\api
```

Frontend (port 5173, proxies `/api` to 8000):

```powershell
cd apps\web
npm run dev
```

The production build is served by FastAPI from `apps\web\dist`, so there is
only one port to open on the firewall.

## Viewer controls

| Action | How |
| --- | --- |
| Orbit | drag with the left mouse button |
| Pan | drag with the right mouse button, hold **Shift** and drag, or pick the hand tool |
| Zoom | mouse wheel or trackpad pinch; the wheel reaches the closest and farthest limits |
| Zoom to a layer | click the layer name in the Layers tab (a hidden layer is shown first) |
| Fit the model | target button in the viewer toolbar |
| Section | Section tab or the scissors tool; drag the coloured outline on the model |
| Measure | ruler tool; see below |

The toolbar has Select, Pan, Layers, Section, Measure and Fit. With the Pan tool
active, left-drag moves the model instead of orbiting.

### Layers by colour

The Layers tab has **By layer** and **By color**. By colour groups the layers
under their GLB colour; the group checkbox hides or shows every layer in that
colour. **By layer** keeps the Rhino hierarchy.

### Measure

- **Distance · 2 points**: click two points on the model.
- **Angle · 3 points**: click three points; the middle point is the corner.
- Units: **m, cm, mm, ft, in**. The choice is remembered in the browser.
- Click again after a result to start a new measurement. **Clear** removes it.
- The point markers keep the same size on screen at every zoom level.

## Delete the source .3dm

The converted GLB is enough for the viewer; the original `.3dm` is only needed
to convert again. To save disk space:

- Tick **Delete the source .3dm after conversion** in the **Load new version**
  dialog. The worker removes the file only after a successful conversion; on
  error the file is kept so it can be fixed and scanned again.
- After a scan, if already-converted versions still keep a `.3dm`, a dialog
  lists them and their sizes. **Keep files** leaves them, **Delete .3dm files**
  removes them.

The version keeps the original file name and size in its menu (read from
`scene.json`), so the history stays readable after the file is gone.

## Update an existing install

After pulling a new commit on the server:

```powershell
git pull
.\.venv\Scripts\python.exe -m pip install -r apps\api\requirements.txt
powershell -ExecutionPolicy Bypass -File scripts\build_web.ps1
```

Then restart the API process (or the Windows service). The SQLite schema is
migrated on startup; data and `app.db` are outside the repository. Users press
**Ctrl+F5** after a frontend update.

## Converter limits

`services/converter-3dm/convert.py` uses `rhino3dm` (openNURBS); Rhino itself
is not needed and no licence is involved.

- Meshes and Extrusions are exported. Breps, curves, text and hatches are
  counted as skipped because openNURBS cannot tessellate them. In Rhino, run
  `_Mesh` on the Breps and save again if those must appear.
- The 996 MB TPRO sample takes about 45-170 s and roughly 2 GB of RAM. Jobs run
  one at a time so two large models cannot exhaust the server.
- If a file has no mesh or extrusion, the version shows an error instead of an
  empty GLB.

## Saved layer sets

A saved set stores hidden layer paths, hidden material colours, section cuts and
the camera. Layers are matched by their full Rhino path, so a set saved on v3
applies to v4. Missing layers are reported and the rest of the set still
applies.

In this MVP the Materials tab groups layers by their GLB material colour, which
is the granularity the converter currently exports. When the converter starts
exporting real Rhino material names, only that grouping needs to change.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | server and data folder |
| GET | `/api/projects` | project list |
| POST | `/api/projects/{slug}/scan` | rescan the data folder; body `{"delete_source": true}` removes each `.3dm` after a successful conversion |
| GET | `/api/projects/{slug}/versions` | versions with status/progress and `has_source` |
| GET | `/api/projects/{slug}/versions/{label}` | one version + file URLs |
| GET | `/api/projects/{slug}/versions/{label}/model.glb` | GLB |
| GET | `/api/projects/{slug}/versions/{label}/scene.json` | scene JSON |
| GET | `/api/projects/{slug}/versions/{label}/objects.json` | object index |
| POST | `/api/projects/{slug}/versions/{label}/delete-source` | delete the converted version's `.3dm` |
| GET/POST | `/api/projects/{slug}/views` | list/create saved layer sets |
| PUT/DELETE | `/api/projects/{slug}/views/{id}` | update/delete a saved set |

## Put the code on Git

This folder is the repository. It contains source code only; `.venv`,
`node_modules`, `dist`, `data`, `.env` and converted models are ignored by
`.gitignore`.

```powershell
git init
git add .
git commit -m "RhinoView MVP"
git branch -M main
git remote add origin <repo-url>
git push -u origin main
```

After the first push, update with `git pull` and follow **Update an existing
install** above.

## Files

```
apps/api/app/          FastAPI app: routers, models, scanner, converter worker
apps/web/src/          React + TypeScript + three.js viewer
services/converter-3dm/convert.py
scripts/start.ps1      production start
scripts/build_web.ps1  frontend build
scripts/check_viewer.py headless Edge smoke test
```
