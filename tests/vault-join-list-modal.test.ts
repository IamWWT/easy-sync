/**
 * VaultJoinRepositoryListModal — the R1 second step: guide sentence, one
 * compact row per joinable repository, click-to-copy with the device-code
 * notice pattern (success / unavailable), empty state, close resolution.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18n } from "../src/i18n";
import { NOTICE_PRIORITY } from "../src/ui/notice-center";
import { VaultJoinRepositoryListModal } from "../src/ui/vault-join-repository-list-modal";
import type EasySyncPlugin from "../src/main";

type RecordedEl = HTMLElement & {
  classList: { contains(token: string): boolean };
  children: unknown[];
  textContent: string;
  __click?: () => void;
};

/** Wrap one element so created children record into it, expose click
 *  handlers and inherit text/class options — the mock factory creates bare
 *  elements without parents, so the wrapper supplies the wiring. */
function instrument(el: HTMLElement): void {
  const target = el as unknown as Record<string, unknown> & {
    children: unknown[];
  };
  if (target.__instrumented) return;
  target.__instrumented = true;
  const record = (child: RecordedEl): RecordedEl => {
    instrument(child);
    if (!target.children.includes(child)) target.children.push(child);
    return child;
  };
  const applyFields = (
    child: RecordedEl,
    fields?: string | { cls?: string; text?: string },
  ): void => {
    const cls = typeof fields === "string" ? fields : fields?.cls;
    if (cls) {
      for (const token of cls.split(" ")) child.classList.add(token);
    }
    const text = typeof fields === "string" ? undefined : fields?.text;
    if (text !== undefined) child.setText(text);
  };
  const origCreateEl = el.createEl.bind(el);
  target.createEl = (
    _tag: string,
    options?: { cls?: string; text?: string },
  ): RecordedEl => {
    const child = origCreateEl() as RecordedEl;
    applyFields(child, options);
    ensureListeners(child);
    return record(child);
  };
  const origCreateDiv = el.createDiv.bind(el);
  target.createDiv = (
    fields?: string | { cls?: string; text?: string },
  ): RecordedEl => {
    const child = origCreateDiv() as RecordedEl;
    applyFields(child, fields);
    ensureListeners(child);
    return record(child);
  };
  const origCreateSpan = el.createSpan.bind(el);
  target.createSpan = (
    fields?: string | { cls?: string; text?: string },
  ): RecordedEl => {
    const child = origCreateSpan(fields) as RecordedEl;
    ensureListeners(child);
    return record(child);
  };
  target.appendChild = (child: unknown): unknown => {
    return record(child as RecordedEl);
  };
}

function ensureListeners(child: HTMLElement): void {
  const el = child as unknown as Record<string, unknown>;
  if (typeof el.addEventListener !== "function") {
    el.addEventListener = (type: string, handler: () => void) => {
      if (type === "click") (el as RecordedEl).__click = handler;
    };
  }
}

function buildModal(
  rows: string[],
): {
  modal: VaultJoinRepositoryListModal;
  show: ReturnType<typeof vi.fn>;
} {
  const plugin = { app: {}, i18n: new I18n("zh-cn") } as unknown as EasySyncPlugin;
  const t = plugin.i18n.t.bind(plugin.i18n);
  const show = vi.fn();
  const noticeCenter = { show } as never;
  const modal = new VaultJoinRepositoryListModal(
    plugin,
    {
      title: t("vaultJoin.listTitle"),
      guide: t("vaultJoin.listGuide"),
      empty: t("vaultJoin.listEmpty"),
      rows,
      copiedNotice: t("vaultJoin.nameCopied"),
      copyUnavailableNotice: t("vaultJoin.copyUnavailable"),
    },
    noticeCenter,
  );
  instrument(modal.contentEl);
  modal.onOpen();
  return { modal, show };
}

function rowElements(modal: VaultJoinRepositoryListModal): RecordedEl[] {
  const children = modal.contentEl.children as unknown as RecordedEl[];
  // children: [guide, list] on the normal path.
  expect(children.length).toBe(2);
  const list = children[1];
  expect(list.classList.contains("easy-sync-vault-join-list")).toBe(true);
  return list.children as unknown as RecordedEl[];
}

describe("VaultJoinRepositoryListModal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the guide and one compact row with a copy icon per repository", () => {
    const { modal } = buildModal(["工作库", "生活库"]);
    const children = modal.contentEl.children as unknown as RecordedEl[];

    expect(
      modal.contentEl.classList.contains("easy-sync-auth-method-modal"),
    ).toBe(true);
    expect(children[0].classList.contains("setting-item-description")).toBe(true);
    expect(children[0].textContent).toContain("点击名称可复制");

    const rows = rowElements(modal);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.classList.contains("easy-sync-vault-join-repo-row")).toBe(true);
      const cells = row.children as unknown as RecordedEl[];
      expect(cells[0].classList.contains("easy-sync-vault-join-repo-name")).toBe(true);
      expect(
        cells[1].classList.contains("easy-sync-vault-join-repo-copy"),
      ).toBe(true);
    }
    expect((rows[0].children as unknown as RecordedEl[])[0].textContent)
      .toBe("工作库");
    expect((rows[1].children as unknown as RecordedEl[])[0].textContent)
      .toBe("生活库");
  });

  it("copies the repository name on row click and shows the copied notice", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { modal, show } = buildModal(["工作库"]);

    const rows = rowElements(modal);
    rows[0].__click?.();
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("工作库");
    });
    expect(show).toHaveBeenCalledOnce();
    expect(show.mock.calls[0]?.[0]).toMatchObject({
      key: "vault-join-name-copied",
      priority: NOTICE_PRIORITY.action,
    });
  });

  it("shows the unavailable notice when the clipboard is missing", async () => {
    vi.stubGlobal("navigator", {});
    const { modal, show } = buildModal(["工作库"]);

    const rows = rowElements(modal);
    rows[0].__click?.();
    await vi.waitFor(() => {
      expect(show).toHaveBeenCalledOnce();
    });
    expect(show.mock.calls[0]?.[0]).toMatchObject({
      key: "vault-join-name-copy-unavailable",
      priority: NOTICE_PRIORITY.failure,
    });
  });

  it("shows the empty state instead of a list when nothing is joinable", () => {
    const { modal } = buildModal([]);
    const children = modal.contentEl.children as unknown as RecordedEl[];

    expect(children).toHaveLength(2);
    expect(children[1].classList.contains("setting-item-description")).toBe(true);
    expect(children[1].textContent).toContain("作为新仓库同步");
    expect(children[1].classList.contains("easy-sync-vault-join-list")).toBe(false);
  });

  it("resolves its awaitAction when the modal is closed", async () => {
    const { modal } = buildModal(["工作库"]);

    const pending = modal.awaitAction();
    modal.onClose();
    await expect(pending).resolves.toBeUndefined();
  });
});
