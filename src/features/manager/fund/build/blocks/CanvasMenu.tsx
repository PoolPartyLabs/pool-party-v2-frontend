/**
 * @id PP-MGR-CMP-057
 * @name CanvasMenu
 * @implements-rules-version v1 (POO-2155 rules v1)
 * @analytics-events none, a presentational menu. A choice, a refusal and the link are handed to the
 *   controller (`useBuildCanvas`), which reports them through `onEvent`; the Build screen
 *   (PP-MGR-SCR-002, S7) owns every event.
 *
 * The menu a canvas template or an insert port opens (handoff v1.2 BB9, I1, I2, I4): it draws a
 * {@link MenuModel} and decides nothing. 248 wide, radius 16, padding 8, gap 2, `surface`, 1 px
 * `border`; the title in capitals (CSS, so CJK is unaffected); option rows padding 8, radius 12,
 * gap 10, a 20 px mark, the name (Body/Medium) over one line (Caption/Default), hover and keyboard
 * focus on `surface-raised`; a disabled row at 40% with its reason as the second line; the footer
 * sentence and, 4 px under it, the link back to the Mandate step (C6).
 *
 * Accessibility: the root is a `menu` named by its title and described by its footer sentence. The
 * options and the link are its `menuitem`s, grouped (a `group` may hold the title and the sentence as
 * text, a `menu` may not). A disabled row stays focusable with `aria-disabled`, so its reason is
 * read; choosing it is handed to the controller, which reports the refusal and adds nothing.
 * Placement, the portal, Escape, the outside press, the arrow keys and the focus return are the
 * {@link AnchoredPopover}'s.
 */
"use client";

import { useId } from "react";
import { cn } from "@/lib/utils/cn";
import { AnchoredPopover } from "./AnchoredPopover";
import { BlockMark } from "./BlockMark";
import type { MenuModel, MenuOption } from "./menuModels";

/** Public props for {@link CanvasMenu}. */
export interface CanvasMenuProps {
  /** The open menu and the element it opened from, or null when no menu is open. */
  menu: { anchor: HTMLElement; model: MenuModel } | null;
  /** An option was chosen (a disabled one too: the controller reports the refusal). */
  onChoose(option: MenuOption): void;
  /** The "Edit mandate" link was followed. */
  onLink(step: "networks" | "protocols"): void;
  /** Escape, Tab or a press outside. */
  onClose(): void;
}

const ITEM =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-md p-2 text-left outline-none transition-colors hover:bg-surface-raised focus-visible:bg-surface-raised motion-reduce:transition-none";

function OptionRow({ option, onChoose }: { option: MenuOption; onChoose(o: MenuOption): void }) {
  const nameId = useId();
  const captionId = useId();
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      data-popover-item=""
      data-menu-option={option.id}
      // Name then caption, read as two words ("Aave v3 Borrow · add it under a Supply block").
      aria-labelledby={`${nameId} ${captionId}`}
      aria-disabled={option.disabled ? "true" : undefined}
      onClick={() => onChoose(option)}
      className={cn(ITEM, option.disabled && "cursor-not-allowed opacity-40")}
    >
      <BlockMark logo={option.logo} markId={option.markId} name={option.name} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span id={nameId} className="font-medium text-foreground text-sm leading-normal">
          {option.name}
        </span>
        <span
          id={captionId}
          className={cn(
            "text-muted-foreground text-xs leading-normal",
            !option.disabled && "truncate",
          )}
        >
          {option.caption}
        </span>
      </span>
    </button>
  );
}

/** The open menu of a canvas template or port, or nothing. */
export function CanvasMenu({ menu, onChoose, onLink, onClose }: CanvasMenuProps) {
  const titleId = useId();
  const sentenceId = useId();
  if (!menu) return null;
  const { anchor, model } = menu;
  const sentence = model.emptySentence ?? model.footer;
  return (
    <AnchoredPopover
      key={model.title}
      anchor={anchor}
      onClose={onClose}
      role="menu"
      aria-labelledby={titleId}
      aria-describedby={sentence ? sentenceId : undefined}
      data-canvas-menu=""
      className="flex w-[248px] flex-col gap-0.5 rounded-lg border border-border bg-surface p-2"
    >
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset is a form control group; this groups menu items, which only role="group" may do inside a menu. */}
      <div role="group" aria-labelledby={titleId} className="flex flex-col gap-0.5">
        <span
          id={titleId}
          className="font-medium text-[11px] text-muted-foreground uppercase leading-normal tracking-wide"
        >
          {model.title}
        </span>
        {model.options.map((option) => (
          <OptionRow key={option.id} option={option} onChoose={onChoose} />
        ))}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: see above, the link is a menu item too. */}
      <div
        role="group"
        aria-describedby={sentence ? sentenceId : undefined}
        className="flex flex-col gap-1"
      >
        {sentence ? (
          <p id={sentenceId} className="text-muted-foreground text-xs leading-normal">
            {sentence}
          </p>
        ) : null}
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          data-popover-item=""
          data-menu-link={model.link.mandateStep}
          onClick={() => onLink(model.link.mandateStep)}
          className="self-start rounded-sm text-left font-medium text-primary text-sm leading-normal outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {model.link.label}
        </button>
      </div>
    </AnchoredPopover>
  );
}
