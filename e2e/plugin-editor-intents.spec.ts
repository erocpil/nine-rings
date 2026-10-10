import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";
import { selectSource, sourceInfo } from "./helpers/source-editor";

for (const transport of ["loopback", "port"] as const) {
  test(`SDK ${transport} 通过真实渲染/源码会话编辑，保留格式、保存修订和单步撤销`, async ({
    page,
  }) => {
    await createBlankDocument(page);
    await page.evaluate(async () => {
      const { DocumentEditSessions } =
        await import("/src/lib/document-edit-sessions.ts");
      const select = DocumentEditSessions.prototype.select;
      DocumentEditSessions.prototype.select = function (...args) {
        select.apply(this, args);
        Object.assign(window, { intentSessions: this });
      };
    });
    const editor = page.locator(".ProseMirror:visible");
    await editor.evaluate((el) => {
      const ed = (el as HTMLElement & { editor: Editor }).editor;
      ed.commands.insertContent("base");
      ed.commands.setTextSelection(1);
    });
    await page.evaluate(async (transport) => {
      const { pluginRuntime, setPluginsEnabled } =
        await import("/src/lib/plugin-system/runtime.ts");
      const { HostCommandDispatcher } =
        await import("/src/lib/plugin-system/command-dispatcher.ts");
      const { createSdkHost, bindSdkHostPort } =
        await import("/src/lib/plugin-system/sdk-host.ts");
      const {
        createPluginSdk,
        createLoopbackSdkTransport,
        createPortSdkTransport,
      } = await import("/src/lib/plugin-system/sdk-client.ts");
      setPluginsEnabled(true);
      const activation = pluginRuntime.activate("test.editor", [
        "editor.selection.read",
        "editor.selection.write",
        "documents.current.read",
      ]);
      const host = window as any;
      const dispatcher = new HostCommandDispatcher(
        pluginRuntime,
        host.intentSessions,
        () => ({
          platform: "web",
          view: document.querySelector(".cm-editor") ? "source" : "render",
          documentId: localStorage.getItem("nr:lastNote")!,
        }),
      );
      dispatcher.register(
        activation,
        { id: "test.editor.text", scope: "selection", risk: "write" },
        (ctx) => ctx.commit({ type: "text", value: "**literal**" }),
      );
      dispatcher.register(
        activation,
        { id: "test.editor.markdown", scope: "selection", risk: "write" },
        (ctx) => ctx.commit({ type: "markdown", value: "**formatted**" }),
      );
      const sdkHost = createSdkHost(pluginRuntime, activation, dispatcher);
      let connection;
      let disposeHost = () => sdkHost.dispose();
      if (transport === "port") {
        const channel = new MessageChannel();
        disposeHost = bindSdkHostPort(sdkHost, channel.port1);
        connection = createPortSdkTransport(channel.port2);
      } else connection = createLoopbackSdkTransport(sdkHost);
      const sdk = createPluginSdk(connection);
      Object.assign(window, {
        intentDispatcher: dispatcher,
        intentActivation: activation,
        intentSdk: sdk,
        disposeIntentHost: disposeHost,
      });
      const capabilities = await sdk.capabilities();
      if (capabilities.commands.length !== 2)
        throw new Error("SDK capabilities missing commands");
    }, transport);
    const execute = (commandId: string, requestId: string) =>
      page.evaluate(
        async (request) => {
          const host = window as any;
          return host.intentSdk.execute(request.commandId);
        },
        { commandId, requestId },
      );
    expect(await execute("test.editor.text", "render-text")).toMatchObject({
      ok: true,
      applied: true,
    });
    await expect(editor).toHaveText("**literal**base");
    await expect(editor.locator("strong")).toHaveCount(0);
    await editor.evaluate((el) =>
      (el as HTMLElement & { editor: Editor }).editor.commands.undo(),
    );
    await expect(editor).toHaveText("base");
    expect(
      await execute("test.editor.markdown", "render-markdown"),
    ).toMatchObject({ ok: true, applied: true });
    await expect(editor.locator("strong")).toHaveText("formatted");
    await editor.evaluate((el) =>
      (el as HTMLElement & { editor: Editor }).editor.commands.undo(),
    );
    await expect(editor).toHaveText("base");
    const target = await page.evaluate(() =>
      (window as any).intentSdk.editor.captureSelection(),
    );
    const targeted = await page.evaluate(
      (target) =>
        (window as any).intentSdk.editor.insert(target, {
          format: "markdown",
          value: "**targeted**",
        }),
      target,
    );
    expect(targeted).toMatchObject({
      ok: true,
      applied: true,
      value: { documentId: expect.any(String), revision: expect.any(String) },
    });
    await expect(editor.locator("strong")).toHaveText("targeted");
    await page.evaluate(
      (result) => (window as any).intentSdk.documents.whenSaved(result),
      targeted.value,
    );
    expect(
      await page.evaluate(async () => {
        const { api } = await import("/src/lib/api.ts");
        return JSON.stringify(
          (await api.notes.get(localStorage.getItem("nr:lastNote")!))!.content,
        );
      }),
    ).toContain("targeted");
    await editor.evaluate((el) =>
      (el as HTMLElement & { editor: Editor }).editor.commands.undo(),
    );
    await expect(editor).toHaveText("base");
    const beforeSwitchTarget = await page.evaluate(() =>
      (window as any).intentSdk.editor.captureSelection(),
    );
    await page.getByRole("button", { name: "源码", exact: true }).click();
    const source = page.getByRole("textbox", {
      name: "Markdown 源码",
      exact: true,
    });
    await expect(source).toBeEditable();
    await selectSource(source, 0);
    const before = (await sourceInfo(source)).value;
    expect(await execute("test.editor.text", "source-text")).toMatchObject({
      ok: true,
      applied: true,
    });
    expect((await sourceInfo(source)).value).toBe("**literal**" + before);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    expect((await sourceInfo(source)).value).toBe(before);
    expect(
      await page.evaluate(
        (target) =>
          (window as any).intentSdk.editor.insert(target, {
            format: "text",
            value: "stale",
          }),
        beforeSwitchTarget,
      ),
    ).toMatchObject({
      ok: false,
      applied: false,
      error: { code: "STALE_TARGET" },
    });
    const sourceInsert = await page.evaluate(() =>
      (window as any).intentSdk.editor.insertAtSelection({
        format: "text",
        value: "SDK",
      }),
    );
    expect(sourceInsert).toMatchObject({ ok: true, applied: true });
    expect((await sourceInfo(source)).value).toBe("SDK" + before);
    await page.evaluate(
      (result) => (window as any).intentSdk.documents.whenSaved(result),
      sourceInsert.value,
    );
    expect(
      await page.evaluate(async () => {
        const { api } = await import("/src/lib/api.ts");
        return JSON.stringify(
          (await api.notes.get(localStorage.getItem("nr:lastNote")!))!.content,
        );
      }),
    ).toContain("SDK");
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    expect((await sourceInfo(source)).value).toBe(before);
    await page.evaluate(async () => {
      const { setPluginsEnabled } =
        await import("/src/lib/plugin-system/runtime.ts");
      setPluginsEnabled(false);
    });
    expect(await execute("test.editor.text", "disabled")).toMatchObject({
      ok: false,
      applied: false,
      error: { code: "PLUGIN_DISABLED" },
    });
    expect((await sourceInfo(source)).value).toBe(before);
    await page.evaluate(() => {
      const host = window as any;
      host.intentSdk.dispose();
      host.disposeIntentHost();
    });
  });
}
