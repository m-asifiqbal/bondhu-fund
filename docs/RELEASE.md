# Releasing Bondhu Fund

## Build
```bash
npm install
npm run typecheck
npm run dist        # release/BondhuFund-Setup-<version>.exe and release/BondhuFund-Portable-<version>.exe
```
Bump `version` in `package.json` for every release. Users install the new setup file over the old one, and their data is kept.

## Code signing (removes the "Unknown publisher" warning)
Signing is already wired in. electron-builder signs automatically when a certificate is provided through environment
variables, and builds unsigned (with a warning) when none is set. **No config change is needed.**

### Option A: a certificate file (.pfx)
Buy an **OV or EV code-signing certificate** from a reseller of Sectigo, DigiCert or SSL.com. OV is about USD 200–400 a year.
New OV certificates still build SmartScreen reputation over the first weeks of downloads; EV certificates get it immediately but use a USB token or cloud HSM.
```powershell
$env:CSC_LINK = "C:\certs\bondhufund.pfx"      # path or base64 of the .pfx
$env:CSC_KEY_PASSWORD = "<pfx password>"         # set in the shell only, never commit it
npm run dist
```

### Option B: Azure Trusted Signing (about USD 10 a month, no hardware token)
Your organization must pass Microsoft's identity validation. Then add this to `build.win` in `package.json`:
```json
"azureSignOptions": { "publisherName": "<Your Org>", "endpoint": "https://<region>.codesigning.azure.net",
  "certificateProfileName": "<profile>", "codeSigningAccountName": "<account>" }
```
Then set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` in the shell and run `npm run dist`.

### Check a signed build
```powershell
Get-AuthenticodeSignature .\release\BondhuFund-Setup-*.exe | Format-List Status, SignerCertificate
```

## Pre-release checklist
- `npm run typecheck` is clean.
- Fresh install on a clean Windows user account: the app opens, the Overview welcome screen appears, and you can add a member and record a payment.
- Restore an older backup (Backup & Restore → Restore from file). Data appears, and a `PreRestore_*.db` snapshot exists.
- Switch to Bangla and visit every screen.
- Uninstall, then reinstall: data is still there under `%APPDATA%\Bondhu Fund\database`.
