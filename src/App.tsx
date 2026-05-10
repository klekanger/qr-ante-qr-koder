import logoUrl from "@/assets/logo.webp";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";

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
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
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
  mimeType: "image/png" | "image/jpeg"
): Promise<Blob> {
  const svgBlob = new Blob([svgMarkup], {
    type: "image/svg+xml;charset=utf-8",
  });
  const svgObjectUrl = URL.createObjectURL(svgBlob);
  const image = new Image();
  image.decoding = "async";

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () =>
      reject(new Error("Could not load SVG for raster export."));
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
  const [resolution, setResolution] =
    useState<(typeof RASTER_RESOLUTIONS)[number]>(512);
  const [svgMarkup, setSvgMarkup] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);

  const payloadState = useMemo(() => {
    if (mode === "url") {
      const value = urlValue.trim();
      if (!value)
        return { valid: false, payload: "", message: "Skriv inn en URL." };
      if (!validateUrl(value)) {
        return {
          valid: false,
          payload: "",
          message: "Bruk en gyldig URL som starter med http:// eller https://.",
        };
      }
      return { valid: true, payload: value, message: "" };
    }

    if (mode === "phone") {
      const normalized = normalizePhone(phoneValue);
      if (!normalized) {
        return {
          valid: false,
          payload: "",
          message: "Skriv inn et telefonnummer.",
        };
      }
      if (!validatePhone(normalized)) {
        return {
          valid: false,
          payload: "",
          message: "Bruk et gyldig telefonnummer.",
        };
      }
      return { valid: true, payload: `tel:${normalized}`, message: "" };
    }

    const value = emailValue.trim();
    if (!value)
      return {
        valid: false,
        payload: "",
        message: "Skriv inn en e-postadresse.",
      };
    if (!validateEmail(value)) {
      return {
        valid: false,
        payload: "",
        message: "Bruk en gyldig e-postadresse.",
      };
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
        setPreviewError("Kunne ikke generere forhåndsvisning av QR-kode.");
      });

    return () => {
      active = false;
    };
  }, [payloadState]);

  const canDownload =
    payloadState.valid && svgMarkup.length > 0 && !isDownloading;

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
          new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" })
        );
        return;
      }

      if (format === "eps") {
        const epsContent = buildEpsFromQrPayload(payloadState.payload);
        triggerDownload(
          `${filePrefix}.eps`,
          new Blob([epsContent], {
            type: "application/postscript;charset=utf-8",
          })
        );
        return;
      }

      const mimeType = format === "png" ? "image/png" : "image/jpeg";
      const blob = await svgToRasterBlob(svgMarkup, resolution, mimeType);
      triggerDownload(`${filePrefix}.${format}`, blob);
    } catch (error) {
      setDownloadError(
        error instanceof Error
          ? error.message
          : "Something went wrong during export."
      );
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center px-4 py-10 sm:py-12">
      <header className="mb-10 flex w-full max-w-2xl flex-col items-center text-center lg:max-w-5xl">
        <img
          src={logoUrl}
          alt="QR-ante"
          width={280}
          height={120}
          decoding="async"
          className="h-auto w-44 object-contain sm:w-52 md:w-60"
        />
        <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
          Lag QR-koder kjapt og enkelt. Ikke noe fjas &ndash; bare helt qr-ante
          QR-koder!
        </p>
      </header>

      <Card className="w-full max-w-2xl lg:max-w-5xl">
        <CardContent className="flex flex-col gap-5 lg:flex-row lg:items-stretch lg:gap-8">
          {/* Form + export: full width on small screens, left column on lg+ */}
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <div className="grid gap-2">
              <Label htmlFor="mode">Type</Label>
              <Select
                value={mode}
                onValueChange={(value) => setMode(value as InputMode)}
              >
                <SelectTrigger id="mode" className="w-full">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="url">URL</SelectItem>
                  <SelectItem value="phone">Telefonnummer</SelectItem>
                  <SelectItem value="email">E-post</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {mode === "url" && (
              <div className="grid gap-2">
                <Label htmlFor="url">URL</Label>
                <Input
                  id="url"
                  type="url"
                  placeholder="https://eksempel.no"
                  value={urlValue}
                  onChange={(event) => setUrlValue(event.target.value)}
                />
              </div>
            )}

            {mode === "phone" && (
              <div className="grid gap-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="+47 123 45 678"
                  value={phoneValue}
                  onChange={(event) => setPhoneValue(event.target.value)}
                />
              </div>
            )}

            {mode === "email" && (
              <div className="grid gap-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={emailValue}
                  onChange={(event) => setEmailValue(event.target.value)}
                />
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="format">Format</Label>
                <Select
                  value={format}
                  onValueChange={(value) => setFormat(value as ExportFormat)}
                >
                  <SelectTrigger id="format" className="w-full">
                    <SelectValue placeholder="Select format" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="png">PNG</SelectItem>
                    <SelectItem value="jpg">JPG</SelectItem>
                    <SelectItem value="svg">SVG</SelectItem>
                    <SelectItem value="eps">EPS</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="resolution">Oppløsning</Label>
                <Select
                  value={String(resolution)}
                  onValueChange={(value) =>
                    setResolution(
                      Number(value) as (typeof RASTER_RESOLUTIONS)[number]
                    )
                  }
                  disabled={format === "svg" || format === "eps"}
                >
                  <SelectTrigger id="resolution" className="w-full">
                    <SelectValue placeholder="Select resolution" />
                  </SelectTrigger>
                  <SelectContent>
                    {RASTER_RESOLUTIONS.map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size} x {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button
              type="button"
              onClick={handleDownload}
              disabled={!canDownload}
              className="w-full"
            >
              {isDownloading ? "Forbereder..." : "Last ned QR-kode"}
            </Button>

            {downloadError && (
              <p className="text-sm text-destructive">{downloadError}</p>
            )}
          </div>

          {/* Preview: below form on small screens, right column on lg+ */}
          <div className="flex shrink-0 flex-col gap-2 lg:w-80 lg:max-w-[min(22rem,40vw)] lg:self-stretch">
            <div
              className="grid min-h-72 place-items-center rounded-xl border bg-white p-4 lg:min-h-72 lg:flex-1"
              aria-live="polite"
            >
              {svgMarkup ? (
                <div
                  className="grid aspect-square w-full max-w-72 place-items-center p-4 lg:max-w-none lg:p-6 [&_svg]:mx-auto [&_svg]:block [&_svg]:h-full [&_svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: svgMarkup }}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Forhåndsvisning av QR-kode vises her.
                </p>
              )}
            </div>
            {previewError && (
              <p className="text-sm text-destructive lg:text-center">
                {previewError}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

export default App;
