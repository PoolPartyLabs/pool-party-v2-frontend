import { describe, expect, it } from "vitest";
import { canonicalProfile, type LaunchProfile, profileMessage } from "./profile";

const profile: LaunchProfile = {
  name: "Demo income fund",
  description: "",
  managerDisplayName: "",
  imageUrl: "",
  websiteUrl: "",
  socialLinks: { z: "https://z.test", a: "https://a.test" },
  tags: ["second", "first"],
  broadMandate: false,
  spokeCapPercent: null,
  launchSnapshotId: "snapshot",
};
describe("canonical profile [R7]", () => {
  it("keeps exact field and tag order, sorts social keys, and includes explicit null", () => {
    expect(canonicalProfile(profile)).toBe(
      '{"name":"Demo income fund","description":"","managerDisplayName":"","imageUrl":"","websiteUrl":"","socialLinks":{"a":"https://a.test","z":"https://z.test"},"tags":["second","first"],"broadMandate":false,"spokeCapPercent":null,"launchSnapshotId":"snapshot"}',
    );
  });
  it("uses lowercased core, fixed hub domain and no trailing newline", () => {
    const message = profileMessage("0xABc", profile, "nonce1234", "2000000000");
    expect(message).toMatch(
      /^Pool Party v2 fund profile\ncore:0xabc\nchainId:42161\ncontentHash:0x[0-9a-f]{64}\nnonce:nonce1234\nexpiresAt:2000000000$/,
    );
  });
});
