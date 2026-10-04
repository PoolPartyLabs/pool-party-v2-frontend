import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../tests/utils/renderWithProviders";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./fundActions", () => ({ loadFundHistoryAction: mocks.load }));

import { FundHistory } from "./FundHistory";

const core = `0x${"1".repeat(40)}`;
const hash = `0x${"2".repeat(64)}`;
const event = (chainId = "42161", logIndex = 1) => ({
  protocolVersion: "v2",
  type: "deposit",
  kind: "deposit",
  eventName: "Deposited",
  chainId,
  vault: core,
  transactionHash: hash,
  blockNumber: "123",
  logIndex,
  timestamp: "2026-10-04T08:00:00.000Z",
  amounts: { budget: "2000000" },
});
const page = (events = [event()], nextCursor: string | null = null) => ({
  ok: true,
  data: { protocolVersion: "v2", coreVault: core, events, nextCursor, indexing: [] },
});
describe("fund-wide history", () => {
  beforeEach(() => vi.clearAllMocks());
  it("loads on demand and links every row on its actual chain", async () => {
    mocks.load.mockResolvedValue(page([event(), { ...event("4663", 2), type: "instant-payout" }]));
    renderWithProviders(<FundHistory core={core} />);
    expect(mocks.load).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    const links = await screen.findAllByRole("link", { name: hash });
    expect(links[0]).toHaveAttribute("href", `https://arbiscan.io/tx/${hash}`);
    expect(links[1]).toHaveAttribute("href", `https://robinhoodchain.blockscout.com/tx/${hash}`);
    expect(screen.getByText(/instant-payout ·/)).toBeInTheDocument();
    expect(screen.getByText(/indexed events only/)).toBeInTheDocument();
  });
  it("appends pages in API order, deduplicates log identities and refreshes", async () => {
    const cursor = `1728000000:42161:${hash}:1`;
    mocks.load
      .mockResolvedValueOnce(page([event()], cursor))
      .mockResolvedValueOnce(page([event(), event("4663", 2)]))
      .mockResolvedValueOnce(page([]));
    renderWithProviders(<FundHistory core={core} />);
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await userEvent.click(await screen.findByRole("button", { name: "Load more events" }));
    await waitFor(() => expect(screen.getAllByRole("link", { name: hash })).toHaveLength(2));
    expect(mocks.load).toHaveBeenLastCalledWith(core, cursor);
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("No indexed events yet")).toBeInTheDocument();
  });
  it("shows read failures and leaves retry available", async () => {
    mocks.load.mockResolvedValue({ ok: false, error: { code: "V2_UNAVAILABLE" } });
    renderWithProviders(<FundHistory core={core} />);
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
  });
  it("discards stale history after changing funds", async () => {
    let resolve: (value: ReturnType<typeof page>) => void = () => {};
    mocks.load.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = renderWithProviders(<FundHistory core={core} />);
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    view.rerender(<FundHistory core={`0x${"3".repeat(40)}`} />);
    await act(async () => resolve(page()));
    expect(screen.queryByRole("link", { name: hash })).not.toBeInTheDocument();
  });
});
