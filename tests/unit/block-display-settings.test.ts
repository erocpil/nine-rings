import { afterEach, describe, expect, it, vi } from "vitest";
import {
  blockWorkspacePreferences,
  foldGutterVisibilityAction,
} from "../../src/lib/block-display-settings";

describe("status bar idle glow preferences", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("leaves optional settings unset by default and accepts only supported values", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
    });

    expect(blockWorkspacePreferences().statusBarIdleGlow).toBeUndefined();
    expect(
      blockWorkspacePreferences().statusBarIdleDelaySeconds,
    ).toBeUndefined();
    expect(
      blockWorkspacePreferences().statusBarIdleGlowIntensity,
    ).toBeUndefined();

    values.set(
      "nr:blockWorkspaceDisplay",
      JSON.stringify({
        statusBarIdleGlow: true,
        statusBarIdleDelaySeconds: 30,
        statusBarIdleGlowIntensity: "prominent",
        sourceFoldConnectorStyle: "dashed",
        sourceFoldConnectorWidth: 3,
        sourceFoldConnectorOpacity: 50,
      }),
    );
    expect(blockWorkspacePreferences()).toMatchObject({
      statusBarIdleGlow: true,
      statusBarIdleDelaySeconds: 30,
      statusBarIdleGlowIntensity: "prominent",
      sourceFoldConnectorStyle: "dashed",
      sourceFoldConnectorWidth: 3,
      sourceFoldConnectorOpacity: 50,
    });

    values.set(
      "nr:blockWorkspaceDisplay",
      JSON.stringify({
        statusBarIdleDelaySeconds: 45,
        statusBarIdleGlowIntensity: "flashy",
        sourceFoldConnectorStyle: "double",
        sourceFoldConnectorWidth: 8,
        sourceFoldConnectorOpacity: 60,
      }),
    );
    expect(
      blockWorkspacePreferences().statusBarIdleDelaySeconds,
    ).toBeUndefined();
    expect(
      blockWorkspacePreferences().statusBarIdleGlowIntensity,
    ).toBeUndefined();
    expect(
      blockWorkspacePreferences().sourceFoldConnectorStyle,
    ).toBeUndefined();
    expect(
      blockWorkspacePreferences().sourceFoldConnectorWidth,
    ).toBeUndefined();
    expect(
      blockWorkspacePreferences().sourceFoldConnectorOpacity,
    ).toBeUndefined();
  });
});

describe("fold gutter visibility", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("persists source and rendered visibility independently and leaves existing preferences intact", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal("document", {
      documentElement: { style: { setProperty: vi.fn() } },
    });
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    expect(blockWorkspacePreferences().renderedFoldGutter).toBeUndefined();
    values.set(
      "nr:blockWorkspaceDisplay",
      JSON.stringify({ relativeBlockNumbers: true, sourceFoldGutter: true }),
    );
    const hide = foldGutterVisibilityAction("rendered", true);
    expect(hide).toMatchObject({ checked: true, keepOpen: true });
    hide.run();
    expect(blockWorkspacePreferences()).toMatchObject({
      renderedFoldGutter: false,
      sourceFoldGutter: true,
      relativeBlockNumbers: true,
    });
    foldGutterVisibilityAction("source", true).run();
    foldGutterVisibilityAction("rendered", false).run();
    expect(blockWorkspacePreferences()).toMatchObject({
      renderedFoldGutter: true,
      sourceFoldGutter: false,
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(3);
    values.set(
      "nr:blockWorkspaceDisplay",
      JSON.stringify({ renderedFoldGutter: "false" }),
    );
    expect(blockWorkspacePreferences().renderedFoldGutter).toBeUndefined();
  });
});
