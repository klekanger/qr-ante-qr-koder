import "./App.css";
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";

type InputMode = "url" | "phone" | "email";
type ExportFormat = "png" | "jpg" | "svg" | "eps";

const RASTER_RESOLUTIONS = [256, 512, 1024, 2048] as const;

function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed) return "";
  const hasPlus = trimmed.startsWith("+");
  const digitsOnly = trimmed.replace(/\D/g, "");
  return hasPlus ? `+${digitsOnly}` : digitsOnly;
}

function validateUrl(rawUrl: string): boolean {
  if (!rawUrl.trim()) return false;
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function validateEmail(rawEmail: string): boolean {
  const email = rawEmail.trim();
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePhone(rawPhone: string): boolean {
  const normalized = normalizePhone(rawPhone);
  return /^\+?\d{6,15}$/.test(normalized);
}

function escapePostScriptText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildEpsFromQrPayload(payload: string): string {
  const qr = QRCode.create(payload, { errorCorrectionLevel: "M" });
  const moduleCount = qr.modules.size;
  const marginModules = 2;
  const totalModules = moduleCount + marginModules * 2;
  const moduleSize = 10;
  const widthPoints = totalModules * moduleSize;
  const heightPoints = totalModules * moduleSize;

  const lines: string[] = [
    "%!PS-Adobe-3.0 EPSF-3.0",
    `%%BoundingBox: 0 0 ${widthPoints} ${heightPoints}`,
    "%%Creator: qr-ante-qr-koder",
    `%%Title: ${escapePostScriptText(payload)}`,
    "%%EndComments",
    `${moduleSize} ${moduleSize} scale`,
    "1 setgray",
    `0 0 ${totalModules} ${totalModules} rectfill`,
    "0 setgray",
  ];

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (qr.modules.get(row, col)) {
        const x = marginModules + col;
        const y = totalModules - marginModules - row - 1;
        lines.push(`${x} ${y} 1 1 rectfill`);
      }
    }
  }

  lines.push("showpage", "%%EOF");
  return lines.join("\n");
}

function triggerDownload(filename: string, blob: Blob): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

async function svgToRasterBlob(
  svgMarkup: string,
  size: number,
  mimeType: "image/png" | "image/jpeg",
): Promise<Blob> {
  const svgBlob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
  const svgObjectUrl = URL.createObjectURL(svgBlob);
  const image = new Image();
  image.decoding = "async";

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Could not load SVG for raster export."));
    image.src = svgObjectUrl;
  });

  URL.revokeObjectURL(svgObjectUrl);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Could not create canvas context for export.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, size, size);

  const blob = await new Promise<Blob | null>((resolve) => {
    context.canvas.toBlob(resolve, mimeType, 1);
  });

  if (!blob) {
    throw new Error("Could not generate raster file.");
  }

  return blob;
}

function App() {
  const [mode, setMode] = useState<InputMode>("url");
  const [urlValue, setUrlValue] = useState("");
  const [phoneValue, setPhoneValue] = useState("");
  const [emailValue, setEmailValue] = useState("");
  const [format, setFormat] = useState<ExportFormat>("png");
  const [resolution, setResolution] = useState<(typeof RASTER_RESOLUTIONS)[number]>(
    512,
  );
  const [svgMarkup, setSvgMarkup] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);

  const payloadState = useMemo(() => {
    if (mode === "url") {
      const value = urlValue.trim();
      if (!value) return { valid: false, payload: "", message: "Enter a URL." };
      if (!validateUrl(value)) {
        return {
          valid: false,
          payload: "",
          message: "Use a valid URL starting with http:// or https://.",
        };
      }
      return { valid: true, payload: value, message: "" };
    }

    if (mode === "phone") {
      const normalized = normalizePhone(phoneValue);
      if (!normalized) {
        return { valid: false, payload: "", message: "Enter a phone number." };
      }
      if (!validatePhone(normalized)) {
        return {
          valid: false,
          payload: "",
          message: "Use a valid phone number with 6-15 digits.",
        };
      }
      return { valid: true, payload: `tel:${normalized}`, message: "" };
    }

    const value = emailValue.trim();
    if (!value) return { valid: false, payload: "", message: "Enter an email address." };
    if (!validateEmail(value)) {
      return { valid: false, payload: "", message: "Use a valid email address." };
    }
    return { valid: true, payload: `mailto:${value}`, message: "" };
  }, [mode, urlValue, phoneValue, emailValue]);

  useEffect(() => {
    setDownloadError("");
    if (!payloadState.valid) {
      setSvgMarkup("");
      setPreviewError(payloadState.message);
      return;
    }

    let active = true;

    QRCode.toString(payloadState.payload, {
      type: "svg",
      width: 512,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((svg) => {
        if (!active) return;
        setSvgMarkup(svg);
        setPreviewError("");
      })
      .catch(() => {
        if (!active) return;
        setSvgMarkup("");
        setPreviewError("Could not generate preview QR code.");
      });

    return () => {
      active = false;
    };
  }, [payloadState]);

  const canDownload = payloadState.valid && svgMarkup.length > 0 && !isDownloading;

  const filePrefix = useMemo(() => {
    const base = mode === "url" ? "url" : mode === "phone" ? "phone" : "email";
    return `qr-${base}`;
  }, [mode]);

  async function handleDownload(): Promise<void> {
    if (!canDownload) return;
    setDownloadError("");
    setIsDownloading(true);

    try {
      if (format === "svg") {
        triggerDownload(
          `${filePrefix}.svg`,
          new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" }),
        );
        return;
      }

      if (format === "eps") {
        const epsContent = buildEpsFromQrPayload(payloadState.payload);
        triggerDownload(
          `${filePrefix}.eps`,
          new Blob([epsContent], { type: "application/postscript;charset=utf-8" }),
        );
        return;
      }

      const mimeType = format === "png" ? "image/png" : "image/jpeg";
      const blob = await svgToRasterBlob(svgMarkup, resolution, mimeType);
      triggerDownload(`${filePrefix}.${format}`, blob);
    } catch (error) {
      setDownloadError(
        error instanceof Error ? error.message : "Something went wrong during export.",
      );
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="card">
        <h1>QR Code Maker</h1>
        <p className="subtext">
          Create QR codes for links, phone numbers, and email addresses.
        </p>

        <div className="field">
          <label htmlFor="mode">Type</label>
          <select
            id="mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as InputMode)}
          >
            <option value="url">URL</option>
            <option value="phone">Phone</option>
            <option value="email">Email</option>
          </select>
        </div>

        {mode === "url" && (
          <div className="field">
            <label htmlFor="url">URL</label>
            <input
              id="url"
              type="url"
              placeholder="https://example.com"
              value={urlValue}
              onChange={(event) => setUrlValue(event.target.value)}
            />
          </div>
        )}

        {mode === "phone" && (
          <div className="field">
            <label htmlFor="phone">Phone Number</label>
            <input
              id="phone"
              type="tel"
              placeholder="+47 123 45 678"
              value={phoneValue}
              onChange={(event) => setPhoneValue(event.target.value)}
            />
          </div>
        )}

        {mode === "email" && (
          <div className="field">
            <label htmlFor="email">Email Address</label>
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={emailValue}
              onChange={(event) => setEmailValue(event.target.value)}
            />
          </div>
        )}

        <div className="preview-wrap" aria-live="polite">
          {svgMarkup ? (
            <div
              className="qr-preview"
              dangerouslySetInnerHTML={{ __html: svgMarkup }}
            />
          ) : (
            <div className="placeholder">QR preview appears here.</div>
          )}
        </div>

        {previewError && <p className="message error">{previewError}</p>}

        <div className="download-controls">
          <div className="field">
            <label htmlFor="format">Format</label>
            <select
              id="format"
              value={format}
              onChange={(event) => setFormat(event.target.value as ExportFormat)}
            >
              <option value="png">PNG</option>
              <option value="jpg">JPG</option>
              <option value="svg">SVG</option>
              <option value="eps">EPS</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="resolution">Resolution</label>
            <select
              id="resolution"
              value={resolution}
              onChange={(event) =>
                setResolution(Number(event.target.value) as (typeof RASTER_RESOLUTIONS)[number])
              }
              disabled={format === "svg" || format === "eps"}
            >
              {RASTER_RESOLUTIONS.map((size) => (
                <option key={size} value={size}>
                  {size} x {size}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button type="button" onClick={handleDownload} disabled={!canDownload}>
          {isDownloading ? "Preparing..." : "Download QR Code"}
        </button>

        {downloadError && <p className="message error">{downloadError}</p>}
      </section>
    </main>
  );
}

export default App;
