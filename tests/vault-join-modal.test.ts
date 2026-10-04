/**
 * VaultJoinOfferModal — house-structure contract (same shell and option rows
 * as the Remotely Save migration offer; body carries the count only, no name
 * list, no bottom note since R1) and the join / fresh / dismiss action wiring
 * the main-layer offer loop relies on.
 */
import { describe, expect, it } from "vitest";
import { I18n } from "../src/i18n";
import { VaultJoinOfferModal } from "../src/ui/vault-join-offer-modal";
import type EasySyncPlugin from "../src/main";

// Local DOM stubs mirror real semantics (apply cls/text, append to caller,
// record click handlers) — same approach as rs-migration-ui.test.ts.
type RecordedEl = HTMLElement & {
  classList: { contains(token: string): boolean };
  textContent: string;
  children: unknown[];
  __click?: () => void;
};

function ensureListeners(child: HTMLElement): void {
  const el = child as unknown as Record<string, unknown>;
  if (typeof el.addEventListener !== "function") {
    el.addEventListener = (type: string, handler: () => void) => {
      if (type === "click") el.__click = handler;
    };
  }
}

function captureDom(el: HTMLElement): void {
  const listOf = (): unknown[] => el.children as unknown[];
  const origCreateEl = el.createEl.bind(el);
  (el as unknown as Record<string, unknown>).createEl = (
    tag: string,
    options?: { text?: string; cls?: string },
  ) => {
    const child = origCreateEl(tag, options as never) as RecordedEl;
    ensureListeners(child);
    if (options?.cls) {
      for (const token of options.cls.split(" ")) child.classList.add(token);
    }
    if (options?.text) child.setText(options.text);
    listOf().push(child);
    return child;
  };
  const origCreateDiv = el.createDiv.bind(el);
  (el as unknown as Record<string, unknown>).createDiv = (cls?: string) => {
    const child = origCreateDiv(cls) as RecordedEl;
    ensureListeners(child);
    if (cls) {
      for (const token of cls.split(" ")) child.classList.add(token);
    }
    listOf().push(child);
    return child;
  };
  const origAppendChild = el.appendChild.bind(el);
  (el as unknown as Record<string, unknown>).appendChild = (
    child: unknown,
  ) => {
    if (!listOf().includes(child)) listOf().push(child);
    ensureListeners(child as HTMLElement);
    return origAppendChild(child as never);
  };
}

function createMockPlugin(): EasySyncPlugin {
  const i18n = new I18n("zh-cn");
  return { app: {} as never, i18n } as unknown as EasySyncPlugin;
}

function buildModal(): {
  modal: VaultJoinOfferModal;
  t: (key: string, params?: Record<string, string | number>) => string;
} {
  const plugin = createMockPlugin();
  const t = plugin.i18n.t.bind(plugin.i18n);
  const modal = new VaultJoinOfferModal(plugin, {
    title: t("vaultJoin.offerTitle"),
    body: t("vaultJoin.offerBody", { count: 11 }),
    join: {
      title: t("vaultJoin.offerJoinTitle"),
      description: t("vaultJoin.offerJoinDesc"),
    },
    fresh: {
      title: t("vaultJoin.offerFreshTitle"),
      description: t("vaultJoin.offerFreshDesc"),
    },
  });
  captureDom(modal.contentEl);
  modal.onOpen();
  return { modal, t };
}

describe("VaultJoinOfferModal", () => {
  it("keeps the auth-method house container class, the count-only body and two option rows", () => {
    const { modal, t } = buildModal();

    expect(
      modal.contentEl.classList.contains("easy-sync-auth-method-modal"),
    ).toBe(true);
    const children = modal.contentEl.children as unknown as RecordedEl[];
    expect(children).toHaveLength(3);
    expect(children[0].classList.contains("setting-item-description")).toBe(true);
    expect(children[0].textContent).toBe(
      t("vaultJoin.offerBody", { count: 11 }),
    );
    expect(children[1].classList.contains("easy-sync-auth-method-option")).toBe(true);
    expect(children[2].classList.contains("easy-sync-auth-method-option")).toBe(true);
    // R1: the layout ends at the two options — no bottom note row any more.
  });

  it("keys the two options to the join and fresh-sync actions", async () => {
    const { modal } = buildModal();
    const children = modal.contentEl.children as unknown as RecordedEl[];

    const pending = modal.awaitAction();
    children[1].__click?.();
    await expect(pending).resolves.toEqual({ action: "join" });

    const second = buildModal();
    const secondChildren = second.modal.contentEl.children as unknown as RecordedEl[];
    const secondPending = second.modal.awaitAction();
    secondChildren[2].__click?.();
    await expect(secondPending).resolves.toEqual({ action: "fresh-sync" });
  });

  it("resolves dismiss when the modal is closed without a choice", async () => {
    const { modal } = buildModal();

    const pending = modal.awaitAction();
    modal.onClose();
    await expect(pending).resolves.toEqual({ action: "dismiss" });
  });
});
