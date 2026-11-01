export function validateEndpoint(host, port) {
  if (host !== "127.0.0.1") throw new Error("CODEX_BRIDGE_HOST must be 127.0.0.1");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid CODEX_BRIDGE_PORT");
}

export function validateRequest(req, port) {
  const authority = req.headers.host;
  if (authority !== `127.0.0.1:${port}` && authority !== `localhost:${port}`) {
    throw httpError(403, "UNTRUSTED_HOST", "untrusted bridge host");
  }
  // This is a machine API. Browser pages must not access task metadata or writes.
  if (req.headers.origin !== undefined || (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "none")) {
    throw httpError(403, "BROWSER_REQUEST_REJECTED", "browser requests are not supported");
  }
  if (req.method === "POST" && String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase() !== "application/json") {
    throw httpError(415, "UNSUPPORTED_MEDIA_TYPE", "application/json is required");
  }
}

export function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

export async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw httpError(413, "BODY_TOO_LARGE", "request body exceeds 1 MiB");
    chunks.push(chunk);
  }
  let body;
  try {
    body = size ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  } catch {
    throw httpError(400, "INVALID_JSON", "request body must contain valid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw httpError(400, "INVALID_BODY", "request body must be a JSON object");
  }
  return body;
}
