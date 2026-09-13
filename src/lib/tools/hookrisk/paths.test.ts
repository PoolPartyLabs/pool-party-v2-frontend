/**
 * @id PP-TOOLS-LIB-001
 * @name hookrisk cache paths and TTL, tests
 * @implements-rules-version v1
 * @analytics-events none (a pure module; the screen owns the funnel)
 *
 * Behavior under test:
 *   [R1] one hook = one cache key = `<chainId>:<address lowercased>`, so the same contract typed
 *        in three different casings is one scan rather than three.
 *   [R2] the on-disk directory is a hash of that key, never the address itself.
 *   [R3] a report younger than 24 h is served; an older one is not.
 *   [R4] the sweep deletes only siblings that are provably stale, and never the entry it was
 *        asked to keep.
 */
import { describe, expect, it } from "vitest";
import {
  buildCacheKey,
  cacheDirName,
  isFresh,
  jobDirPath,
  normalizeAddress,
  resolveHookriskHome,
  resolveWorkRoot,
  SCAN_TTL_MS,
  selectStaleDirs,
} from "./paths";

const ADDRESS = "0x0000000000000000000000000000000000000001";

describe("normalizeAddress [R1]", () => {
  it("returns the EIP-55 checksummed form of a valid address", () => {
    // A known mixed-case checksum: lowercasing the input must not change the answer.
    const lower = "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed";
    expect(normalizeAddress(lower)).toBe("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed");
    expect(normalizeAddress(lower.toUpperCase().replace("0X", "0x"))).toBe(
      "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    );
  });

  it("trims surrounding whitespace, which is what a paste from a block explorer carries", () => {
    expect(normalizeAddress(`  ${ADDRESS}\n`)).toBe(ADDRESS);
  });

  it("returns null for anything that is not a 20-byte hex address", () => {
    for (const bad of ["", "0x", "not-an-address", "0x123", `${ADDRESS}00`, ADDRESS.slice(2)]) {
      expect(normalizeAddress(bad), bad).toBeNull();
    }
  });
});

describe("buildCacheKey [R1]", () => {
  it("is the chain id and the LOWERCASED address, so casing never forks the cache", () => {
    const checksummed = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
    expect(buildCacheKey(130, checksummed)).toBe("130:0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed");
    expect(buildCacheKey(130, checksummed.toLowerCase())).toBe(buildCacheKey(130, checksummed));
  });

  it("separates the same address on different chains", () => {
    expect(buildCacheKey(1, ADDRESS)).not.toBe(buildCacheKey(8453, ADDRESS));
  });
});

describe("cacheDirName [R2]", () => {
  it("is a 64-char sha256 hex digest, not the address", () => {
    const name = cacheDirName(buildCacheKey(1, ADDRESS));
    expect(name).toMatch(/^[0-9a-f]{64}$/);
    expect(name).not.toContain(ADDRESS.slice(2));
  });

  it("is stable for the same key and different for a different one", () => {
    expect(cacheDirName("1:a")).toBe(cacheDirName("1:a"));
    expect(cacheDirName("1:a")).not.toBe(cacheDirName("1:b"));
  });
});

describe("resolveWorkRoot", () => {
  it("prefers HOOKRISK_WORK_DIR and always lands under a `hookrisk` folder", () => {
    expect(resolveWorkRoot({ HOOKRISK_WORK_DIR: "/var/scan" })).toBe("/var/scan/hookrisk");
  });

  it("falls back to the OS temp dir when the env var is absent or blank", () => {
    expect(resolveWorkRoot({}, "/tmp")).toBe("/tmp/hookrisk");
    expect(resolveWorkRoot({ HOOKRISK_WORK_DIR: "   " }, "/tmp")).toBe("/tmp/hookrisk");
  });
});

describe("resolveHookriskHome", () => {
  it("defaults to <repo>/hookrisk", () => {
    expect(resolveHookriskHome({}, "/srv/app")).toBe("/srv/app/hookrisk");
  });

  it("honours an explicit HOOKRISK_HOME, which is what the container sets", () => {
    expect(resolveHookriskHome({ HOOKRISK_HOME: "/opt/hookrisk" }, "/srv/app")).toBe(
      "/opt/hookrisk",
    );
  });
});

describe("jobDirPath [R2]", () => {
  it("joins the work root with the hashed key", () => {
    const key = buildCacheKey(1, ADDRESS);
    expect(jobDirPath("/tmp/hookrisk", key)).toBe(`/tmp/hookrisk/${cacheDirName(key)}`);
  });
});

describe("isFresh [R3]", () => {
  const now = 1_000_000_000_000;

  it("is 24 hours", () => {
    expect(SCAN_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("serves a report written a second ago", () => {
    expect(isFresh(now - 1_000, now)).toBe(true);
  });

  it("refuses one written 24 h and a millisecond ago", () => {
    expect(isFresh(now - SCAN_TTL_MS - 1, now)).toBe(false);
  });

  it("treats the exact boundary as still fresh", () => {
    expect(isFresh(now - SCAN_TTL_MS, now)).toBe(true);
  });

  it("refuses a future mtime rather than trusting it (clock skew is not freshness)", () => {
    expect(isFresh(now + 60_000, now)).toBe(false);
  });
});

describe("selectStaleDirs [R4]", () => {
  const now = 2_000_000_000_000;
  const old = now - SCAN_TTL_MS - 1;

  it("returns only the entries older than the TTL", () => {
    expect(
      selectStaleDirs(
        [
          { name: "a", mtimeMs: old },
          { name: "b", mtimeMs: now - 1_000 },
          { name: "c", mtimeMs: old },
        ],
        now,
      ),
    ).toEqual(["a", "c"]);
  });

  it("never returns the directory it was told to keep, even when that one is stale", () => {
    // The keep entry is the job about to run: deleting it mid-request would race the writer.
    expect(
      selectStaleDirs(
        [
          { name: "keep-me", mtimeMs: old },
          { name: "other", mtimeMs: old },
        ],
        now,
        "keep-me",
      ),
    ).toEqual(["other"]);
  });

  it("returns nothing when everything is fresh", () => {
    expect(selectStaleDirs([{ name: "a", mtimeMs: now }], now)).toEqual([]);
  });
});
