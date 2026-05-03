import { describe, expect, test } from "bun:test";
import { ensureBackend } from "../../packages/tui/src/backend-process";
import { getProbeDisplayStatus } from "../../packages/tui/src/views/App";
import { evaluateRealServiceAcceptance } from "../../scripts/acceptance/deliverable-1";

describe("tui backend process supervisor", () => {
  test("it should reuse an existing compatible backend", async () => {
    let starts = 0;

    const backend = await ensureBackend({
      statusUrl: "http://127.0.0.1:3000/status",
      fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      startProcess: () => {
        starts += 1;
        return { kill: () => undefined };
      },
    });

    expect(backend.startedBySupervisor).toBe(false);
    expect(starts).toBe(0);
    backend.stop();
  });

  test("it should start the backend when no compatible backend is running", async () => {
    let attempts = 0;
    let starts = 0;

    const backend = await ensureBackend({
      statusUrl: "http://127.0.0.1:3000/status",
      fetch: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("connection refused");
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
      startProcess: () => {
        starts += 1;
        return { kill: () => undefined };
      },
      retryDelayMs: 0,
    });

    expect(backend.startedBySupervisor).toBe(true);
    expect(starts).toBe(1);
  });

  test("it should stop only the backend process started by this TUI", async () => {
    let killedStartedProcess = false;
    let killedExistingProcess = false;

    const existing = await ensureBackend({
      statusUrl: "http://127.0.0.1:3000/status",
      fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      startProcess: () => ({
        kill: () => {
          killedExistingProcess = true;
        },
      }),
    });

    existing.stop();
    expect(killedExistingProcess).toBe(false);

    let attempts = 0;
    const started = await ensureBackend({
      statusUrl: "http://127.0.0.1:3000/status",
      fetch: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("connection refused");
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
      startProcess: () => ({
        kill: () => {
          killedStartedProcess = true;
        },
      }),
      retryDelayMs: 0,
    });

    started.stop();
    expect(killedStartedProcess).toBe(true);
  });
});

describe("provider probe acceptance flow", () => {
  test("it should render PASS or BLOCKED probe results in the TUI", () => {
    const result = evaluateRealServiceAcceptance({
      paneText: "Gmail probe: PASS google | AI probe: PASS openai",
      providerModes: { gmail: "google", ai: "openai" },
      prereqs: { status: "PASS", reasons: [] },
    });

    expect(result.status).toBe("PASS");
  });

  test("it should treat static or fake-only status as insufficient for real-service acceptance", () => {
    const result = evaluateRealServiceAcceptance({
      paneText: "Backend: PASS existing 0.1.0\nProviders: Gmail fakeGmail / AI fakeAI",
      providerModes: { gmail: "fakeGmail", ai: "fakeAI" },
      prereqs: { status: "PASS", reasons: [] },
    });

    expect(result).toEqual({
      status: "BLOCKED",
      reasons: [
        "TUI did not render provider probe PASS or BLOCKED results",
        "Real-service acceptance requires non-fake Gmail and AI providers",
      ],
    });
  });
});

describe("provider probe acceptance evaluation", () => {
  test("it should return BLOCKED when real providers and prereqs pass but Gmail probe text is BLOCKED", () => {
    const result = evaluateRealServiceAcceptance({
      paneText: "Gmail probe: BLOCKED google | AI probe: PASS openai",
      providerModes: { gmail: "google", ai: "openai" },
      prereqs: { status: "PASS", reasons: [] },
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.reasons).toContain("Real-service acceptance requires Gmail and AI probe PASS results");
  });

  test("it should return BLOCKED when real providers and prereqs pass but AI probe text is BLOCKED", () => {
    const result = evaluateRealServiceAcceptance({
      paneText: "Gmail probe: PASS google | AI probe: BLOCKED openai",
      providerModes: { gmail: "google", ai: "openai" },
      prereqs: { status: "PASS", reasons: [] },
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.reasons).toContain("Real-service acceptance requires Gmail and AI probe PASS results");
  });

  test("it should return PASS only when real providers, prereqs, and both probe texts pass", () => {
    const result = evaluateRealServiceAcceptance({
      paneText: "Gmail probe: PASS google | AI probe: PASS anthropic",
      providerModes: { gmail: "google", ai: "anthropic" },
      prereqs: { status: "PASS", reasons: [] },
    });

    expect(result).toEqual({ status: "PASS", reasons: [] });
  });
});

describe("provider probe display", () => {
  test("it should render PASS for backend probe status PASS", () => {
    expect(getProbeDisplayStatus("PASS")).toBe("PASS");
  });

  test("it should render PASS for backend probe status ok", () => {
    expect(getProbeDisplayStatus("ok")).toBe("PASS");
  });

  test("it should render BLOCKED for failed, blocked, or not-configured statuses", () => {
    expect(getProbeDisplayStatus("failed")).toBe("BLOCKED");
    expect(getProbeDisplayStatus("BLOCKED")).toBe("BLOCKED");
    expect(getProbeDisplayStatus("not-configured")).toBe("BLOCKED");
  });
});
