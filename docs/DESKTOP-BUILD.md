# Desktop developer build

Requirements for developers only: Node.js 22 and npm.

```bash
npm ci --ignore-scripts
node node_modules/electron/install.js
npm test
npm run lint
npm run desktop:dev
npm run desktop:dist
```

`desktop:dist` builds the standalone Next runtime, generates the Windows icon from `public/alkarna-logo.png`, stages all local assets, rebuilds native dependencies for Electron, and creates the sole customer artifact: `dist/AlKarna-Setup-x64.exe`. Electron Builder still creates `win-unpacked` as an intermediate directory for packaged-runtime smoke testing; it is not uploaded as a customer artifact.

## Downloading a CI-built installer

The **Build Windows desktop** GitHub Actions workflow runs for `main`, `fix/**`, `feat/**`, pull requests targeting `main`, and manual dispatches. After a successful run:

1. Open the repository's **Actions** tab and select the completed run.
2. Download the `AlKarna-Windows-x64-<run number>` artifact.
3. Extract `AlKarna-Setup-x64.exe` and `AlKarna-Setup-x64.exe.sha256` from the artifact.
4. Verify the installer before sharing it:

```powershell
(Get-FileHash .\AlKarna-Setup-x64.exe -Algorithm SHA256).Hash.ToLowerInvariant()
Get-Content .\AlKarna-Setup-x64.exe.sha256
```

The workflow uploads an installer only after unit tests, type checking, linting, production dependency auditing, the standalone server smoke test, the Electron native SQLite probe, and the relocated packaged-runtime smoke test all pass.

Electron binds the internal server exclusively to `127.0.0.1`. The Next process is the sole database owner. Production data is derived from Electron's `app.getPath("userData")`; development uses `.dev-data`.

The signed device license is also machine configuration rather than business data. It is stored independently at `<userData>/config/license.alkarna-license`, so application updates and business database backup/restore operations do not move or replace it.
