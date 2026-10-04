/**
 * EasySync repository join offer (carrier 20261003-2128, R1) — main-layer
 * behavior: gate conditions, name comparison, count-only offer, the
 * offer→list→offer loop, RS priority at the first-sync wiring points, and
 * the fresh-login notice.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const vaultJoinAwaitAction = vi.hoisted(() => vi.fn());
const vaultJoinArgs = vi.hoisted(() => [] as unknown[][]);
const vaultJoinListAwaitAction = vi.hoisted(() => vi.fn());
const vaultJoinListArgs = vi.hoisted(() => [] as unknown[][]);

vi.mock("../src/auth/auth-module", () => ({
  AuthModule: class {},
}));

vi.mock("../src/onedrive/client", () => ({
  OneDriveClient: class {},
}));

vi.mock("../src/sync/local-scanner", () => ({
  LocalScanner: class {},
  createFolderSyncScopeSnapshotV1: () => ({
    version: 1,
    includedPaths: [],
    excludedFolders: [],
  }),
  isEasySyncInternalPath: () => false,
  normalizeExcludedFolders: (paths: unknown[]) => paths.filter(
    (path): path is string => typeof path === "string" && path.length > 0,
  ),
}));

vi.mock("../src/sync/state-manager", () => ({
  StateManager: class {},
  SyncPathMutationRecoveryError: class extends Error {},
  ConservativeResetBlockedError: class extends Error {},
}));

vi.mock("../src/sync/diagnostic-logger", () => ({
  DiagnosticLogger: class {
    log = vi.fn();
    warn = vi.fn();
    error = vi.fn();
    setAdapter = vi.fn();
  },
}));

vi.mock("../src/ui/settings-tab", () => ({
  EasySyncSettingTab: class {},
}));

vi.mock("../src/ui/sync-view", () => ({
  SYNC_VIEW_TYPE: "easy-sync-detail",
  EasySyncSyncView: class {
    render = vi.fn();
  },
}));

vi.mock("../src/ui/ribbon-status", () => ({
  RIBBON_STATUS_ICONS: {},
  resolveRibbonStatus: () => ({
    icon: "cloud",
    label: "idle",
    ariaLabel: "idle",
    tooltip: "idle",
    cssClass: "",
    needsAttention: false,
  }),
}));

vi.mock("../src/ui/confirm-modal", () => ({
  ConfirmModal: class {},
  SyncPlanAlertModal: class {},
}));

vi.mock("../src/ui/scope-crossing-prompt-modal", () => ({
  ScopeCrossingPromptModal: class {},
}));

vi.mock("../src/ui/vault-join-offer-modal", () => ({
  VaultJoinOfferModal: class {
    awaitAction = vaultJoinAwaitAction;
    constructor(...args: unknown[]) {
      vaultJoinArgs.push(args);
    }
  },
}));

vi.mock("../src/ui/vault-join-repository-list-modal", () => ({
  VaultJoinRepositoryListModal: class {
    awaitAction = vaultJoinListAwaitAction;
    constructor(...args: unknown[]) {
      vaultJoinListArgs.push(args);
    }
  },
}));

import EasySyncPlugin from "../src/main";
import { NOTICE_PRIORITY } from "../src/ui/notice-center";

function makePlugin(): {
  plugin: EasySyncPlugin;
  t: ReturnType<typeof vi.fn>;
} {
  const plugin = new EasySyncPlugin();
  plugin.diag = {
    isEnabled: vi.fn().mockReturnValue(false),
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as never;
  const t = vi.fn((key: string) => key);
  plugin.i18n = { t, language: "zh-cn" } as never;
  plugin.noticeCenter = {
    show: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
  } as never;
  vi.spyOn(plugin.app.vault, "getName").mockReturnValue("奇奇怪怪");
  return { plugin, t };
}

function attachDetection(
  plugin: EasySyncPlugin,
  repositories: string[] | Error,
): { detect: ReturnType<typeof vi.fn> } {
  const detect = vi.fn();
  if (repositories instanceof Error) {
    detect.mockRejectedValue(repositories);
  } else {
    detect.mockResolvedValue(repositories);
  }
  plugin.onedrive = { detectExistingEasySyncRepositories: detect } as never;
  plugin.syncExecutor = { isRunning: false } as never;
  plugin.state = {
    lastSyncTime: 0,
    baseSnapshot: [],
    planReviewActive: false,
  } as never;
  plugin.auth = {
    authState: { isLoggedIn: true, accountId: "account" },
  } as never;
  return { detect };
}

function callOffer(plugin: EasySyncPlugin): Promise<string> {
  return (plugin as never as {
    maybeOfferExistingVaultJoin(): Promise<string>;
  }).maybeOfferExistingVaultJoin();
}

function callNotice(plugin: EasySyncPlugin): Promise<void> {
  return (plugin as never as {
    offerVaultJoinNoticeAfterFreshLogin(): Promise<void>;
  }).offerVaultJoinNoticeAfterFreshLogin();
}

describe("maybeOfferExistingVaultJoin", () => {
  afterEach(() => {
    vaultJoinAwaitAction.mockReset();
    vaultJoinArgs.length = 0;
    vaultJoinListAwaitAction.mockReset();
    vaultJoinListArgs.length = 0;
    vi.restoreAllMocks();
  });

  it("continues the plain first sync when the cloud has no EasySync repositories", async () => {
    const { plugin } = makePlugin();
    const { detect } = attachDetection(plugin, []);

    await expect(callOffer(plugin)).resolves.toBe("continue");
    expect(detect).toHaveBeenCalledOnce();
    expect(vaultJoinArgs).toHaveLength(0);
  });

  it("continues without an offer when a repository name matches byte-for-byte", async () => {
    const { plugin } = makePlugin();
    attachDetection(plugin, ["其他库", "奇奇怪怪"]);

    await expect(callOffer(plugin)).resolves.toBe("continue");
    expect(vaultJoinArgs).toHaveLength(0);
  });

  it("offers the join when the only repository differs by letter case", async () => {
    const { plugin } = makePlugin();
    vi.spyOn(plugin.app.vault, "getName").mockReturnValue("Notes");
    attachDetection(plugin, ["notes"]);
    vaultJoinAwaitAction.mockResolvedValue({ action: "dismiss" });

    await expect(callOffer(plugin)).resolves.toBe("abort");
    expect(vaultJoinArgs).toHaveLength(1);
    const views = vaultJoinArgs[0]?.[1] as Record<string, unknown>;
    expect(views.title).toBe("vaultJoin.offerTitle");
    expect(views.body).toBe("vaultJoin.offerBody");
    expect(views.join).toMatchObject({ title: "vaultJoin.offerJoinTitle" });
    expect(views.fresh).toMatchObject({ title: "vaultJoin.offerFreshTitle" });
  });

  it("names only the repository count in the offer body", async () => {
    const { plugin, t } = makePlugin();
    attachDetection(plugin, ["工作库", "生活库"]);
    vaultJoinAwaitAction.mockResolvedValue({ action: "fresh-sync" });

    await expect(callOffer(plugin)).resolves.toBe("continue");
    expect(t).toHaveBeenCalledWith("vaultJoin.offerBody", { count: 2 });
    expect(t).not.toHaveBeenCalledWith(
      "vaultJoin.offerBody",
      expect.objectContaining({ vaults: expect.anything() }),
    );
  });

  it("opens the repository list on join, then returns to the offer until a decision", async () => {
    const { plugin } = makePlugin();
    attachDetection(plugin, ["工作库", "生活库"]);
    vaultJoinAwaitAction
      .mockResolvedValueOnce({ action: "join" })
      .mockResolvedValueOnce({ action: "fresh-sync" });
    vaultJoinListAwaitAction.mockResolvedValue(undefined);

    await expect(callOffer(plugin)).resolves.toBe("continue");

    expect(vaultJoinAwaitAction).toHaveBeenCalledTimes(2);
    expect(vaultJoinListAwaitAction).toHaveBeenCalledOnce();
    const listViews = vaultJoinListArgs[0]?.[1] as Record<string, unknown>;
    expect(listViews.title).toBe("vaultJoin.listTitle");
    expect(listViews.rows).toEqual(["工作库", "生活库"]);
    expect(listViews.copiedNotice).toBe("vaultJoin.nameCopied");
  });

  it("stops this round when the offer is dismissed", async () => {
    const { plugin } = makePlugin();
    attachDetection(plugin, ["工作库"]);
    vaultJoinAwaitAction.mockResolvedValue({ action: "dismiss" });

    await expect(callOffer(plugin)).resolves.toBe("abort");
    expect(vaultJoinListAwaitAction).not.toHaveBeenCalled();
  });

  it("continues the plain first sync when detection fails, with a diagnostic note", async () => {
    const { plugin } = makePlugin();
    attachDetection(plugin, new Error("network down"));

    await expect(callOffer(plugin)).resolves.toBe("continue");
    expect(vaultJoinArgs).toHaveLength(0);
    expect((plugin.diag as never as { warn: ReturnType<typeof vi.fn> }).warn)
      .toHaveBeenCalled();
  });

  it("never runs for vaults that already completed a sync", async () => {
    const { plugin } = makePlugin();
    const { detect } = attachDetection(plugin, ["工作库"]);
    plugin.state = {
      lastSyncTime: 1,
      baseSnapshot: [],
      planReviewActive: false,
    } as never;

    await expect(callOffer(plugin)).resolves.toBe("continue");
    expect(detect).not.toHaveBeenCalled();
  });

  it("never runs while a plan review is pending", async () => {
    const { plugin } = makePlugin();
    const { detect } = attachDetection(plugin, ["工作库"]);
    (plugin.state as never as { planReviewActive: boolean }).planReviewActive = true;

    await expect(callOffer(plugin)).resolves.toBe("continue");
    expect(detect).not.toHaveBeenCalled();
  });

  it("never runs while logged out", async () => {
    const { plugin } = makePlugin();
    const { detect } = attachDetection(plugin, ["工作库"]);
    (plugin.auth as never as { authState: { isLoggedIn: boolean } })
      .authState.isLoggedIn = false;

    await expect(callOffer(plugin)).resolves.toBe("continue");
    expect(detect).not.toHaveBeenCalled();
  });
});

describe("offerVaultJoinNoticeAfterFreshLogin", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the one-shot notice naming only the count", async () => {
    const { plugin, t } = makePlugin();
    attachDetection(plugin, ["工作库"]);
    const show = (plugin.noticeCenter as never as { show: ReturnType<typeof vi.fn> })
      .show;

    await callNotice(plugin);

    expect(t).toHaveBeenCalledWith("vaultJoin.detectNotice", { count: 1 });
    expect(show).toHaveBeenCalledOnce();
    expect(show.mock.calls[0]?.[0]).toMatchObject({
      key: "vault-join-detect",
      priority: NOTICE_PRIORITY.info,
    });
  });

  it("stays silent when a repository already matches this vault's name", async () => {
    const { plugin } = makePlugin();
    attachDetection(plugin, ["奇奇怪怪"]);
    const show = (plugin.noticeCenter as never as { show: ReturnType<typeof vi.fn> })
      .show;

    await callNotice(plugin);

    expect(show).not.toHaveBeenCalled();
  });

  it("stays silent on detection failure", async () => {
    const { plugin } = makePlugin();
    attachDetection(plugin, new Error("network down"));
    const show = (plugin.noticeCenter as never as { show: ReturnType<typeof vi.fn> })
      .show;

    await callNotice(plugin);

    expect(show).not.toHaveBeenCalled();
  });
});

function attachFirstSyncHarness(plugin: EasySyncPlugin) {
  plugin.state = {
    planReviewActive: false,
    hasV2RemoteScopeRecovery: false,
  } as never;
  plugin.syncExecutor = { isRunning: false } as never;
  vi.spyOn(plugin as never, "ensureStateLoaded").mockResolvedValue(undefined);
  vi.spyOn(plugin as never, "dispatchV2StateLoadBlockIfPresent")
    .mockResolvedValue(false);
  vi.spyOn(plugin as never, "checkAccountBindingForSync").mockResolvedValue(true);
  vi.spyOn(plugin, "activateSyncView").mockResolvedValue(undefined);
  const dispatch = vi.spyOn(plugin as never, "dispatchSyncRun")
    .mockResolvedValue(undefined);
  const migrate = vi.spyOn(plugin as never, "maybeRunRsMigrationOffer");
  const join = vi.spyOn(plugin as never, "maybeOfferExistingVaultJoin");
  return { dispatch, migrate, join };
}

describe("startFirstSync join-offer wiring", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips the join offer when the Remotely Save adoption ran this round", async () => {
    const { plugin } = makePlugin();
    const harness = attachFirstSyncHarness(plugin);
    harness.migrate.mockResolvedValue("migrated");
    harness.join.mockResolvedValue("continue");

    await plugin.startFirstSync();

    expect(harness.join).not.toHaveBeenCalled();
    expect(harness.dispatch).toHaveBeenCalledOnce();
  });

  it("runs the join offer when no Remotely Save repository is paired", async () => {
    const { plugin } = makePlugin();
    const harness = attachFirstSyncHarness(plugin);
    harness.migrate.mockResolvedValue("fresh");
    harness.join.mockResolvedValue("continue");

    await plugin.startFirstSync();

    expect(harness.join).toHaveBeenCalledOnce();
    expect(harness.dispatch).toHaveBeenCalledOnce();
  });

  it("stops before dispatch when the join offer aborts the round", async () => {
    const { plugin } = makePlugin();
    const harness = attachFirstSyncHarness(plugin);
    harness.migrate.mockResolvedValue("fresh");
    harness.join.mockResolvedValue("abort");

    await plugin.startFirstSync();

    expect(harness.dispatch).not.toHaveBeenCalled();
  });
});
