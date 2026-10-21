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

## Microsoft Store edition from build 836

The Store edition starts from `d85ca436446b48e975ace9461eda6a9365f686ec` (successful Windows build 836, including the native Windows Save As repair). Existing EXE installation behavior remains compatible.

The public identity in `build/store-identity.json` was copied from the owner's Partner Center product `9N1B4CJXJ3LN` after reserving `الكرنه`. It is not a signing key. Do not replace it with the identity from the perfume app or infer it from the product name. Keep it stable for updates.

After staging and native validation, build the unsigned Store upload input:

```bash
npm run desktop:package:store
node scripts/desktop-test-server.mjs --packaged --store
```

The result is `dist/store/AlKarna-Store-1.0.0-x64.msix`, plus SHA-256 and `BUILD-INFO.json`. Microsoft's MakeAppx creates the MSIX directly. Explicit builder targets avoid inheriting the original NSIS installer. The package declares only `runFullTrust` and Arabic/French resources. No certificate is installed, and the build does not submit or publish anything. Microsoft signs the package after Store certification.

`storeVersion` in package.json is independent of the original EXE version. It starts at `1.0.0` and produces MSIX version `1.0.0.0`; increase it for each Store update. The fourth part stays zero for Microsoft. Do not derive versions from GitHub run counters.

Only packaged Store metadata selects `AlKarna-Store` under Electron AppData, including independent database, browser session, logs, settings, license file and activation ledger. Registry licensing is disabled for this edition so it cannot consume the existing EXE's activation state. A launch environment or argument cannot select this profile. There is no automatic data or license migration from the EXE; any migration must use an explicit backup/restore after verification.

The signed, device-bound license verification and issuer keys are unchanged. User activation remains free and manually supplied by the owner. Store listing/support contact authorized by the owner: WhatsApp `+222 49823328`. Describe this requirement clearly in the Store listing. A genuine reviewer activation/access method is still required; do not embed private signing keys, a universal license or a hidden reviewer bypass.

CI checks the original EXE, the Store unpacked runtime, license gates and MSIX structure/identity/version. These checks do not replace signed install/update testing, WACK, or Microsoft certification.
