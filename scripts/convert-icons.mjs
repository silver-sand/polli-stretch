import { createRequire } from "node:module";
import { readFile, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));

class ChromeNotFoundError extends Error {}

export async function findChromeExecutable() {
  const programFiles = process.env["PROGRAMFILES"] ? [process.env["PROGRAMFILES"]] : [];
  const programFilesX86 = process.env["PROGRAMFILES(X86)"] ? [process.env["PROGRAMFILES(X86)"]] : [];
  const localAppData = process.env["LOCALAPPDATA"] ? [process.env["LOCALAPPDATA"]] : [];
  const baseDirectories = [...programFiles, ...programFilesX86, ...localAppData];
  const suffixes = [
    "Google\\Chrome\\Application\\chrome.exe",
    `Google\\Chrome\\Application\\chrome.exe`,
  ];
  const candidates = baseDirectories.flatMap((dir) => suffixes.map((suffix) => join(dir, suffix)));
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Keep searching for a stable Chrome path.
    }
  }

  try {
    const registry = require("child_process");
    const result = registry.execSync(
      `powershell.exe -NoProfile -Command "Get-ItemProperty -ErrorAction SilentlyContinue 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Google Chrome' | Select-Object -ExpandProperty InstallLocation"`,
      { encoding: "utf8" },
    ).trim();
    if (result) {
      const chromePath = join(result, "chrome.exe");
      await access(chromePath);
      return chromePath;
    }
  } catch {
    // Fall through to a command-line lookup.
  }

  try {
    const output = await import("node:child_process").then(({ execFile }) =>
      new Promise<string>((resolvePromise, rejectPromise) => {
        execFile("where.exe", ["chrome"], (error, stdout) =>
          error ? rejectPromise(error) : resolvePromise(stdout.trim()),
        );
      }),
    );
    if (output) {
      const chromePath = output.split(/\r?\n/)[0];
      await access(chromePath);
      return chromePath;
    }
  } catch {
    // No Chrome executable was located.
  }

  throw new ChromeNotFoundError("Chrome executable not found on this machine.");
}

export async function headlessScreenshot({ svgPath, width, height, outputPath, backgroundColor = "transparent" }) {
  const chromePath = await findChromeExecutable();
  const svgContents = await readFile(svgPath, "utf8");
  const html = `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      html, body {
        width: ${width}px;
        height: ${height}px;
        margin: 0;
        background-color: ${backgroundColor};
      }
      svg {
        display: block;
        width: ${width}px;
        height: ${height}px;
      }
    </style>
  </head>
  <body>
    ${svgContents}
  </body>
</html>`;

  const tmpHtmlPath = join(
    root,
    `__tmp_polli_icons_${width}x${height}_${Date.now()}.html`,
  );
  await writeFile(tmpHtmlPath, html, "utf8");

  const args = [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    `--screenshot=${outputPath}`,
    `--window-size=${width},${height}`,
    `--hide-scrollbars`,
    pathToFileURL(tmpHtmlPath).toString(),
  ];

  const { spawn } = await import("node:child_process");
  const child = spawn(chromePath, args, { stdio: "pipe" });
  const exitCode = await new Promise((resolve) => {
    child.on("close", (code) => resolve(code ?? 0));
    child.on("error", (error) => {
      console.error(error);
      resolve(1);
    });
  });

  const { unlink } = await import("node:fs/promises");
  await unlink(tmpHtmlPath).catch(() => {});

  if (exitCode !== 0) {
    throw new Error(`Chrome headless exited with code ${exitCode}.`);
  }
}

const sizes = [16, 32, 48, 128];
for (const size of sizes) {
  const svgPath = join(root, "icons", `icon${size}.svg`);
  const outputPath = join(root, "icons", `icon${size}.png`);
  await headlessScreenshot({ svgPath, width: size, height: size, outputPath });
  console.log(`generated ${outputPath}`);
}
