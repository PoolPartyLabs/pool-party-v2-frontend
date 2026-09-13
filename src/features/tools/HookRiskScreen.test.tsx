/**
 * @id PP-TOOLS-CMP-001
 * @name HookRiskScreen, tests
 * @implements-rules-version v1
 * @analytics-events tools_hookrisk_viewed, tools_hookrisk_started, tools_hookrisk_completed,
 *                   tools_hookrisk_failed, tools_hookrisk_blocked
 *
 * Behavior under test:
 *   [R21] idle: the form is there and no report is claimed.
 *   [R22] running: the screen names WHICH stage the scan is in, not just "loading".
 *   [R23] report: the Markdown is rendered, and `tools_hookrisk_completed` fires on the report
 *         arriving, never on the click that asked for it.
 *   [R24] a bad address is a BLOCKED INTENT: the event fires, and nothing is requested.
 *   [R25] a scan that could not run shows the reason and NO report. The whole point of hookrisk is
 *         that silence must not read as safety.
 *
 * No process is spawned here: `fetch` is the only seam and it is stubbed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../tests/utils/renderWithProviders";
import { HookRiskScreen } from "./HookRiskScreen";

const track = vi.fn();
vi.mock("@/lib/analytics/useAnalytics", () => ({
  useAnalytics: () => ({ track }),
}));

const ADDRESS = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const JOB_ID = "b".repeat(64);

function stubFetch(response: { status: number; body: unknown }) {
  const impl = vi.fn(async () => ({
    status: response.status,
    ok: response.status < 400,
    json: async () => response.body,
  }));
  vi.stubGlobal("fetch", impl);
  return impl;
}

async function submit(address = ADDRESS) {
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText("Hook contract address"));
  await user.type(screen.getByLabelText("Hook contract address"), address);
  await user.click(screen.getByRole("button", { name: "Analyze" }));
}

beforeEach(() => {
  track.mockReset();
  vi.unstubAllGlobals();
});

describe("idle [R21]", () => {
  it("shows the form and says there is no scan yet", () => {
    renderWithProviders(<HookRiskScreen />);
    expect(screen.getByLabelText("Hook contract address")).toBeInTheDocument();
    expect(screen.getByLabelText("Chain")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyze" })).toBeInTheDocument();
    expect(screen.getByText("No scan yet")).toBeInTheDocument();
  });

  it("offers the five chains the server reads, Unichain included", () => {
    renderWithProviders(<HookRiskScreen />);
    for (const name of ["Ethereum", "Unichain", "Base", "Arbitrum", "Polygon"]) {
      expect(screen.getByRole("option", { name })).toBeInTheDocument();
    }
  });

  it("fires the view event once", () => {
    renderWithProviders(<HookRiskScreen />);
    expect(track).toHaveBeenCalledWith("tools_hookrisk_viewed", undefined);
  });
});

describe("running [R22]", () => {
  it("names the stage the scan is in", async () => {
    stubFetch({ status: 202, body: { jobId: JOB_ID, status: "building", startedAt: 1 } });
    renderWithProviders(<HookRiskScreen />);
    await submit();
    await waitFor(() => {
      expect(screen.getByText("Compiling the contract")).toBeInTheDocument();
    });
    expect(screen.queryByText("No scan yet")).not.toBeInTheDocument();
  });

  it("fires started on the request and NOT completed [R23]", async () => {
    stubFetch({ status: 202, body: { jobId: JOB_ID, status: "queued", startedAt: 1 } });
    renderWithProviders(<HookRiskScreen />);
    await submit();
    await waitFor(() => {
      expect(track).toHaveBeenCalledWith("tools_hookrisk_started", { chain_id: 1 });
    });
    expect(track).not.toHaveBeenCalledWith("tools_hookrisk_completed", expect.anything());
  });
});

describe("report [R23]", () => {
  const report =
    "# Hook risk\n\nMEDIUM risk 12/33\n\n| Dimension | Score |\n|---|---|\n| Complexity | 4/5 |\n";

  it("renders the Markdown, headings and tables included", async () => {
    stubFetch({
      status: 200,
      body: {
        jobId: JOB_ID,
        status: "done",
        report,
        cached: false,
        gatePassed: true,
        startedAt: 1,
      },
    });
    renderWithProviders(<HookRiskScreen />);
    await submit();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Hook risk" })).toBeInTheDocument();
    });
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("hookrisk gate passed.")).toBeInTheDocument();
  });

  it("fires completed only once the report is in hand", async () => {
    stubFetch({
      status: 200,
      body: { jobId: JOB_ID, status: "done", report, startedAt: 1 },
    });
    renderWithProviders(<HookRiskScreen />);
    await submit();
    await waitFor(() => {
      expect(track).toHaveBeenCalledWith("tools_hookrisk_completed", { chain_id: 1 });
    });
  });

  it("shows a FAILED GATE as a result, with its report, not as an error", async () => {
    // hookrisk exits 2 when a hook does not pass and still writes the full report. That is the
    // output the user came for; treating it as an error would throw it away.
    stubFetch({
      status: 200,
      body: { jobId: JOB_ID, status: "done", report, gatePassed: false, startedAt: 1 },
    });
    renderWithProviders(<HookRiskScreen />);
    await submit();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Hook risk" })).toBeInTheDocument();
    });
    expect(screen.getByText(/hookrisk gate failed/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("blocked intent [R24]", () => {
  it("refuses a malformed address without requesting anything", async () => {
    const impl = stubFetch({ status: 202, body: {} });
    renderWithProviders(<HookRiskScreen />);
    await submit("0xnope");
    expect(track).toHaveBeenCalledWith("tools_hookrisk_blocked", {
      chain_id: 1,
      error_code: "INVALID_ADDRESS",
    });
    expect(impl).not.toHaveBeenCalled();
    expect(screen.getByText(/not a valid contract address/i)).toBeInTheDocument();
  });
});

describe("could not run [R25]", () => {
  it("shows the reason and renders no report", async () => {
    stubFetch({
      status: 202,
      body: {
        jobId: JOB_ID,
        status: "failed",
        startedAt: 1,
        error: {
          code: "TOOLCHAIN_MISSING",
          message: "This host cannot run a hook scan. `forge` (Foundry) is not on PATH.",
        },
      },
    });
    renderWithProviders(<HookRiskScreen />);
    await submit();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText(/forge/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(track).toHaveBeenCalledWith("tools_hookrisk_failed", {
      chain_id: 1,
      error_code: "TOOLCHAIN_MISSING",
    });
  });
});
