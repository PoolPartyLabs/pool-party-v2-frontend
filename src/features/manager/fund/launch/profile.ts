/**
 * @id PP-MGR-LIB-029 (POO-2177)
 * @name launchProfileMessage
 * @implements-rules-version v1
 * Exact API EIP-191 canonical content, without normalizing signed values.
 */
import { keccak256, stringToHex } from "viem";

export interface LaunchProfile {
  name: string;
  description: string;
  managerDisplayName: string;
  imageUrl: string;
  websiteUrl: string;
  socialLinks: Record<string, string>;
  tags: string[];
  broadMandate?: boolean;
  spokeCapPercent?: number | null;
  launchSnapshotId?: string;
}
export function canonicalProfile(profile: LaunchProfile): string {
  return JSON.stringify({
    name: profile.name,
    description: profile.description,
    managerDisplayName: profile.managerDisplayName,
    imageUrl: profile.imageUrl,
    websiteUrl: profile.websiteUrl,
    socialLinks: Object.fromEntries(
      Object.keys(profile.socialLinks)
        .sort()
        .map((key) => [key, profile.socialLinks[key]]),
    ),
    tags: profile.tags,
    ...(profile.broadMandate === undefined ? {} : { broadMandate: profile.broadMandate }),
    ...(profile.spokeCapPercent === undefined ? {} : { spokeCapPercent: profile.spokeCapPercent }),
    ...(profile.launchSnapshotId === undefined
      ? {}
      : { launchSnapshotId: profile.launchSnapshotId }),
  });
}
export function profileMessage(
  core: string,
  profile: LaunchProfile,
  nonce: string,
  expiresAt: string,
): string {
  return [
    "Pool Party v2 fund profile",
    `core:${core.toLowerCase()}`,
    "chainId:42161",
    `contentHash:${keccak256(stringToHex(canonicalProfile(profile)))}`,
    `nonce:${nonce}`,
    `expiresAt:${expiresAt}`,
  ].join("\n");
}
