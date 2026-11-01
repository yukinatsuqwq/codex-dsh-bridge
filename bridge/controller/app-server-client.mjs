import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";
import { codexSpawnSpec } from "../resolve-codex.mjs";

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
    const configuredTimeout = Number(process.env.CODEX_APP_SERVER_REQUEST_TIMEOUT_MS ?? 120_000);
    this.requestTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 120_000;
  }

  async start() {
    if (this.starting) return this.starting;
    if (this.process) return;
    this.starting = this.#startProcess();
    try {
      await this.starting;
    } catch (error) {
      await this.stop();
      throw error;
    } finally {
      this.starting = null;
    }
  }

  async #startProcess() {
    const launch = codexSpawnSpec(this.executable, ["app-server", "--listen", "stdio://"]);
    this.process = spawn(launch.command, launch.args, {
      cwd: this.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
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
    this.process.on("error", (cause) => {
      const error = new Error(`Could not start Codex app-server executable ${this.executable}: ${cause.message}`, { cause });
      this.#failProcess(child, error);
    });
    this.process.stdin.on("error", (cause) => {
      const error = new Error(`Codex app-server stdin failed: ${cause.message}`, { cause });
      this.#failProcess(child, error);
    });
    this.process.on("exit", (code, signal) => {
      const error = new Error(`Codex app-server exited (code=${code}, signal=${signal})`);
      this.#failProcess(child, error);
    });

    await this.request("initialize", {
      clientInfo: { name: "dsh_codex_bridge", title: "DSH Codex Bridge", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    }, 30_000);
    this.notify("initialized", {});
  }

  request(method, params = {}, timeoutMs = this.requestTimeoutMs) {
    if (!this.process) throw new Error("Codex app-server is not running");
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const entry = {
        method,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.pending.set(id, entry);
      try {
        this.#send({ method, id, params });
      } catch (error) {
        this.pending.delete(id);
        entry.reject(error);
      }
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
    const error = new Error("Codex app-server stopped");
    // Reject callers even when a child refuses to finish its outstanding RPCs.
    this.#failProcess(child, error);
    if (child.exitCode !== null || child.signalCode !== null) return;
    let timer;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    const wait = (milliseconds) => Promise.race([
      exited.then(() => true),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), milliseconds); }),
    ]).finally(() => clearTimeout(timer));
    if (child.stdin.writable) child.stdin.end();
    if (await wait(2_000)) return;
    child.kill("SIGTERM");
    if (await wait(2_000)) return;
    child.kill("SIGKILL");
    if (!await wait(2_000)) throw new Error("Codex app-server did not exit after SIGKILL");
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

  #failProcess(child, error) {
    if (this.process !== child) return;
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
    this.process = null;
    this.emit("exit", error);
  }
}
