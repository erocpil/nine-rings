import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Tauri selects its Rust project from cwd. A --config overlay in Nine Rings'
// cwd would still compile the Nine Rings binary, so always enter the real app.
const directory = fileURLToPath(new URL("../native/file-workbench/", import.meta.url));
const cli = fileURLToPath(new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url));
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], { cwd: directory, stdio: "inherit" });
child.on("error", error => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
