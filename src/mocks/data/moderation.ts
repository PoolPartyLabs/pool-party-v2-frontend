/**
 * @id PP-ADM-MCK-002
 * @name moderation queue images — mock fixture
 * @implements-rules-version v1
 *
 * PP-MOCK: seeded images for the Admin Console moderation queue (POO-590). Post-publication: the
 * `pending` ones populate the queue. `imageUrl` is intentionally absent — the manager/strategy image
 * UPLOAD + hosting are not built yet (POO-580), so the queue renders a placeholder thumbnail.
 *
 * PP-INTEGRATION-POINT: moderation images ← pool-party-api (`GET /admin/moderation/images`); real
 * `imageUrl`s come from the image-hosting backend (POO-580). Never read the DB directly.
 */
import type { ModerationImage } from "@/lib/schemas";

export const moderationImages: ModerationImage[] = [
  {
    id: "mod-avatar-apex",
    kind: "manager-avatar",
    subjectId: "apex-quant",
    subjectName: "Apex Quant",
    uploadedAt: "2026-07-04T10:00:00.000Z",
    status: "pending",
  },
  {
    id: "mod-banner-sofia",
    kind: "manager-banner",
    subjectId: "sofia-delgado",
    subjectName: "Sofia Delgado",
    uploadedAt: "2026-07-04T12:30:00.000Z",
    status: "pending",
  },
  {
    id: "mod-strategy-ethusdc",
    kind: "strategy",
    subjectId: "strat-eth-usdc-momentum",
    subjectName: "ETH-USDC Momentum",
    uploadedAt: "2026-07-04T15:45:00.000Z",
    status: "pending",
  },
  {
    id: "mod-avatar-lucas",
    kind: "manager-avatar",
    subjectId: "lucas-meyer",
    subjectName: "Lucas Meyer",
    uploadedAt: "2026-07-05T08:15:00.000Z",
    status: "pending",
  },
];
