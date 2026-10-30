import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";

export class CodexAppServerClient extends EventEmitter {
  constructor({ executable, cwd, logger = console }) {
    super();
    this.executable = executable;
    this.cwd = cwd;
    this.logger = logger;
    this.nextId = 1;
    this.pending = new Map();
    this.process = null;
    this.starting = null;
  }

  async start() {
    if (this.process) return;
    if (this.starting) return this.starting;
    this.starting = this.#startProcess();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async #startProcess() {
    this.process = spawn(this.executable, ["app-server", "--listen", "stdio://"], {
      cwd: this.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: process.platform === "win32" && !/\.exe$/i.test(this.executable),
    });

    readline.createInterface({ input: this.process.stdout }).on("line", (line) => {
      if (!line.trim()) return;
      try {
        this.#handle(JSON.parse(line));
      } catch (error) {
        this.logger.error("Invalid app-server JSON:", error.message, line.slice(0, 500));
      }
    });
    readline.createInterface({ input: this.process.stderr }).on("line", (line) => {
      if (line.trim()) this.logger.error(`[codex app-server] ${line}`);
    });
    const child = this.process;
    this.process.on("exit", (code, signal) => {
      const error = new Error(`Codex app-server exited (code=${code}, signal=${signal})`);
      for (const entry of this.pending.values()) entry.reject(error);
      this.pending.clear();
      if (this.process === child) this.process = null;
      this.emit("exit", error);
    });

    await this.request("initialize", {
      clientInfo: { name: "dsh_codex_bridge", title: "DSH Codex Bridge", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    this.notify("initialized", {});
  }

  request(method, params = {}) {
    if (!this.process) throw new Error("Codex app-server is not running");
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.#send({ method, id, params });
    });
  }

  notify(method, params = {}) {
    this.#send({ method, params });
  }

  respond(id, result) {
    this.#send({ id, result });
  }

  async stop() {
    if (!this.process) return;
    const child = this.process;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    if (child.stdin.writable) child.stdin.end();
    const timeout = setTimeout(() => child.kill(), 2_000);
    await exited;
    clearTimeout(timeout);
    if (this.process === child) this.process = null;
  }

  #send(message) {
    if (!this.process?.stdin.writable) throw new Error("Codex app-server stdin is unavailable");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handle(message) {
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const entry = this.pending.get(message.id);
      if (entry) {
        this.pending.delete(message.id);
        if (message.error) {
          const error = new Error(`${entry.method}: ${message.error.message ?? JSON.stringify(message.error)}`);
          error.details = message.error;
          entry.reject(error);
        } else {
          entry.resolve(message.result);
        }
        return;
      }
    }

    if (message.id !== undefined && message.method) {
      this.emit("serverRequest", message);
      return;
    }
    if (message.method) this.emit("notification", message);
  }
}
