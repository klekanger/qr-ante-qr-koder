# Qr-ante QR-koder

Etter å ha irritert meg over alle disse «gratis» QR-kode-generatorene som var fulle av reklame, eller som genererte QR-koder som plutselig kunne slutte å fungere, vibbekodet jeg denne.

Helt kurante QR-koder uten noe fjas.

## Hva den gjør

Appen kan lage QR-koder ut fra URL, telefonnummer og e-post.
QR-kodene kan lagres som png, svg, eps eller jpg.

### Oppbygning

- React 19 SPA bygget med Vite. Ingen API-kall for å generere QR; alt skjer i nettleseren.
- Bruker biblioteket [`qrcode`](https://www.npmjs.com/package/qrcode) til å beregne modulrutenettet og til SVG-tekst.

### Forhåndsvisning (SVG)

En `useEffect` med avhengighet `payloadState` kaller `QRCode.toString(payload, { type: "svg", width: 512, margin: 2, color: { dark: "#000000", light: "#ffffff" } })`. Resultatet lagres i state og injiseres som HTML i preview (samt gjenbrukes for raster-eksport).

### Eksport og filer

Nedlasting skjer via `URL.createObjectURL` + midlertidig `<a download>`.

- **SVG**: Blob fra den genererte SVG-strengen (`image/svg+xml`).
- **PNG / JPG**: `svgToRasterBlob()` laster SVG inn i `Image()`, tegner på et offscreen canvas med hvit bakgrunn, `imageSmoothingEnabled: false`, og `canvas.toBlob()` med valgt `mimeType`. Sidekant velges fra `RASTER_RESOLUTIONS`: `256 | 512 | 1024 | 2048`.
- **EPS**: `QRCode.create(payload, { errorCorrectionLevel: "M" })`; `buildEpsFromQrPayload()` går gjennom `qr.modules` og genererer PostScript (`rectfill` per mørk modul) med 2 modulers stille margin og fast modulstørrelse i punkter. Pass på at payload escapes i EPS-kommentar (`escapePostScriptText`).
