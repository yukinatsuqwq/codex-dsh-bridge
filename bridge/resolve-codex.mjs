import fs from "node:fs";

const MACOS_CODEX_CANDIDATES = [
  "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
  "/Applications/Codex.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
];

export function resolveCodexExecutable() {
  if (process.env.CODEX_BRIDGE_EXECUTABLE) return process.env.CODEX_BRIDGE_EXECUTABLE;
  if (process.platform === "darwin") {
    const bundled = MACOS_CODEX_CANDIDATES.find((candidate) => fs.existsSync(candidate));
    if (bundled) return bundled;
  }
  return "codex";
}

export function codexSpawnSpec(executable, args) {
  if (process.platform !== "win32" || !/\.(?:cmd|bat)$/i.test(executable)) {
    return { command: executable, args };
  }
  if (/[\r\n"&|<>^%!()]/.test(executable)) {
    throw new Error("CODEX_BRIDGE_EXECUTABLE batch path contains characters that are unsafe for cmd.exe");
  }
  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", `"${executable}" ${args.join(" ")}`],
  };
}
