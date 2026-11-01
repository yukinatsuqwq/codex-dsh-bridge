import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { validateEndpoint, validateRequest, readBody } from "./http-policy.mjs";

test("endpoint cannot expose the unauthenticated controller on a public interface", () => {
  validateEndpoint("127.0.0.1", 32123);
  for (const host of ["0.0.0.0", "localhost", "::", "192.168.1.1"]) {
    assert.throws(() => validateEndpoint(host, 32123));
  }
  for (const port of [0, -1, 65536, NaN, 1.5]) assert.throws(() => validateEndpoint("127.0.0.1", port));
});

test("native clients work; browser sources and rebinding hosts are rejected on reads and writes", () => {
  for (const method of ["GET", "POST"]) {
    const req = { method, headers: { host: "127.0.0.1:32123", "content-type": "application/json; charset=utf-8" } };
    validateRequest(req, 32123);
    for (const origin of ["null", "http://127.0.0.1:3080", "https://example.com", ""]) {
      assert.throws(() => validateRequest({ ...req, headers: { ...req.headers, origin } }, 32123), { code: "BROWSER_REQUEST_REJECTED" });
    }
    assert.throws(() => validateRequest({ ...req, headers: { ...req.headers, host: "evil.example:32123" } }, 32123), { code: "UNTRUSTED_HOST" });
  }
  assert.throws(() => validateRequest({ method: "POST", headers: { host: "127.0.0.1:32123", "content-type": "application/jsonp" } }, 32123), { status: 415 });
});

test("body parsing returns actionable errors without accepting non-object values", async () => {
  const body = (text) => Readable.from([Buffer.from(text)]);
  assert.deepEqual(await readBody(body('{"text":"只读测试"}')), { text: "只读测试" });
  assert.deepEqual(await readBody(body("")), {});
  await assert.rejects(readBody(body("{")), { status: 400, code: "INVALID_JSON" });
  for (const value of ["null", "[]", "42", '"text"']) {
    await assert.rejects(readBody(body(value)), { status: 400, code: "INVALID_BODY" });
  }
  await assert.rejects(readBody(body("x".repeat(1024 * 1024 + 1))), { status: 413 });
});
