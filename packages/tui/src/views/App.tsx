// @ts-nocheck
/** @jsxImportSource @opentui/react */
import { useKeyboard } from "@opentui/react";
import type { AuthStatus, BackendStatus, ProbeResult, ProbeResultStatus } from "../api-client";

export type ProbeState =
  | { state: "idle" }
  | { state: "running" }
  | { state: "complete"; gmail: ProbeResult; ai: ProbeResult }
  | { state: "blocked"; reason: string };

export interface AppProps {
  backend: {
    startedBySupervisor: boolean;
  };
  status: BackendStatus;
  auth: AuthStatus;
  probe: ProbeState;
  onProbe(): void;
  onQuit(): void;
}

export function App(props: AppProps) {
  useKeyboard((key) => {
    if (key.name === "p") {
      props.onProbe();
    }

    if (key.name === "q" || (key.name === "c" && key.ctrl)) {
      props.onQuit();
    }
  });

  return (
    <box flexDirection="column" padding={1} gap={1}>
      <text>gmail-sweep TUI</text>
      <text>
        Backend: PASS {props.backend.startedBySupervisor ? "started by TUI" : "existing"}{" "}
        {props.status.version}
      </text>
      <text>
        Providers: Gmail {props.status.providerModes.gmail} / AI {props.status.providerModes.ai}
      </text>
      <text>
        Auth: {props.auth.authenticated ? "PASS" : "BLOCKED"}{" "}
        {props.auth.accountId || "missing active account"}
      </text>
      <text>Keys: p probe providers, q quit</text>
      <text>{renderProbe(props.probe)}</text>
    </box>
  );
}

function renderProbe(probe: ProbeState): string {
  if (probe.state === "idle") {
    return "Provider probes: idle";
  }

  if (probe.state === "running") {
    return "Provider probes: running";
  }

  if (probe.state === "blocked") {
    return `Provider probes: BLOCKED ${probe.reason}`;
  }

  return [
    `Gmail probe: ${probeStatus(probe.gmail)} ${probe.gmail.provider}${message(probe.gmail)}`,
    `AI probe: ${probeStatus(probe.ai)} ${probe.ai.provider}${message(probe.ai)}`,
  ].join(" | ");
}

function probeStatus(result: ProbeResult): "PASS" | "BLOCKED" {
  return getProbeDisplayStatus(result.status);
}

export function getProbeDisplayStatus(status: ProbeResultStatus): "PASS" | "BLOCKED" {
  return status === "ok" || status === "PASS" ? "PASS" : "BLOCKED";
}

function message(result: ProbeResult): string {
  return result.message ? ` ${result.message}` : "";
}
