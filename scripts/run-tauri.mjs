import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const root = process.cwd();
const isWindows = process.platform === "win32";
const localTauri = join(
  root,
  "node_modules",
  ".bin",
  isWindows ? "tauri.cmd" : "tauri",
);
const cargoBin = join(homedir(), ".cargo", "bin");
const command = existsSync(localTauri) ? localTauri : "tauri";
const env = {
  ...process.env,
  PATH: existsSync(cargoBin)
    ? `${cargoBin}${delimiter}${process.env.PATH ?? ""}`
    : process.env.PATH,
};

const child = spawn(command, args, {
  env,
  shell: isWindows,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
