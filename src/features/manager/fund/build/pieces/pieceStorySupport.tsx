/**
 * @id PP-MGR-CMP-049
 * @name pieceStorySupport
 * @implements-rules-version v1 (POO-2154 rules v1)
 * @analytics-events none, Storybook support only; nothing here ships in a route
 *
 * Shared by the stories of the Build canvas pieces (slice S4, POO-2154).
 *
 * - {@link storyT}: the canvas copy from the English `manager` messages, through next-intl's own
 *   translator, so a story shows the real strings (with their ICU placeholders filled) and never a
 *   literal of its own. The pieces take strings as props; in the app S5 and S6 read the same keys.
 * - {@link withCanvasBackground}: the canvas fill (`background`) behind a piece, with room for its
 *   focus ring, ports and tooltips, so the piece is reviewed on the surface it is drawn on.
 */
import type { Decorator } from "@storybook/nextjs-vite";
import { createTranslator } from "next-intl";
import enManager from "@/i18n/messages/en/manager.json";

/** The `fundBuilder.canvas` copy in English. */
export const storyT = createTranslator({
  locale: "en",
  messages: { manager: enManager },
  namespace: "manager.fundBuilder.canvas",
});

/** The network names the canvas copy interpolates. */
export const storyNetworkNames = enManager.fundBuilder.networkNames;

/** Draws the story on the canvas fill, padded so rings, ports and tooltips have room. */
export const withCanvasBackground: Decorator = (Story) => (
  <div className="inline-flex items-start gap-6 rounded-xl bg-background p-10">
    <Story />
  </div>
);
