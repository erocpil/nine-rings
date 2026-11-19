import { expect, test } from "@playwright/test";
import { createBlankDocument } from "../helpers/document";
import { openWritableLocalDirectory } from "../helpers/local-files";
import { sourceInfo } from "../helpers/source-editor";

test("磁盘文件标题打开右侧属性而非完整名称气泡", async ({ page }) => {
  await createBlankDocument(page, "磁盘属性宿主");
  const source = "int main(void) { return 0; }\n";
  const { workspace } = await openWritableLocalDirectory(page, { "a-very-long-local-file-name.c": source }, "a-very-long-local-file-name.c");
  await workspace.getByRole("button", { name: "设为只读", exact: true }).click();
  const title = workspace.getByRole("button", { name: "文档属性", exact: true });
  await expect(title).toHaveText("a-very-long-local-file-name.c");
  await title.click();
  const properties = workspace.getByRole("complementary", { name: "文件属性", exact: true });
  await expect(properties).toBeVisible();
  await expect(properties).toContainText("a-very-long-local-file-name.c");
  await expect(properties).toContainText("C/C++");
  await expect(workspace.getByRole("tooltip", { name: /完整标题/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(properties).toHaveCount(0);
});

test("磁盘 Markdown 渲染标题复用右侧属性入口", async ({ page }) => {
  await createBlankDocument(page, "磁盘渲染属性宿主");
  const { workspace } = await openWritableLocalDirectory(page, { "long-rendered-title.md": "# 标题\n\n正文\n" }, "long-rendered-title.md");
  await workspace.getByRole("button", { name: "渲染", exact: true }).click();
  await workspace.getByRole("button", { name: "点击设为只读", exact: true }).click();
  await workspace.getByRole("button", { name: "文档属性", exact: true }).click();
  const properties = workspace.getByRole("complementary", { name: "文件属性", exact: true });
  await expect(properties).toContainText("long-rendered-title.md");
  await expect(properties).toContainText("Markdown");
  await expect(workspace.getByRole("tooltip", { name: /完整标题/ })).toHaveCount(0);
});

test("磁盘源码状态栏提供独立且可用的位置历史", async ({ page }) => {
  await createBlankDocument(page, "磁盘历史宿主");
  const source = Array.from({ length: 180 }, (_, index) => `int value_${index} = ${index};`).join("\n") + "\n";
  const { workspace } = await openWritableLocalDirectory(page, { "history.c": source }, "history.c");
  const area = workspace.locator(".cm-content");
  await sourceInfo(area);
  const moveTo = async (offset: number) => area.evaluate((element, at) => {
    const view = (window as any).sourceCM.EditorView.findFromDOM(element)!;
    view.dispatch({ selection: { anchor: at } });
    view.contentDOM.dispatchEvent(new Event("select", { bubbles: true }));
  }, offset);
  await moveTo(0);
  const target = source.indexOf("value_150");
  await moveTo(target);
  const back = workspace.getByRole("button", { name: "后退", exact: true });
  const forward = workspace.getByRole("button", { name: "前进", exact: true });
  await expect(back).toBeEnabled();
  await back.click();
  await expect.poll(async () => (await sourceInfo(area)).selectionStart).toBe(0);
  await expect(forward).toBeEnabled();
  await forward.click();
  await expect.poll(async () => (await sourceInfo(area)).selectionStart).toBe(target);
});

for (const rendered of [false,true]) test(`磁盘文档标题和属性接入文件系统创建访问时间，渲染=${rendered}`, async({page})=>{
  await createBlankDocument(page,"磁盘时间信息");
  await page.evaluate(async()=>{
    const {localFileService}=await import("/src/lib/local-files/service.ts"); const original=localFileService.fileProperties.bind(localFileService);
    localFileService.fileProperties=async(root,node,system)=>({...await original(root,node,system),createdMs:1600000000000,accessedMs:1600000300000});
  });
  const name=rendered?"metadata.md":"metadata.c";
  const {workspace}=await openWritableLocalDirectory(page,{[name]:rendered?"# Title\n\nText":"int value = 1;"},name);
  if(rendered){await workspace.getByRole("button",{name:"渲染",exact:true}).click();await workspace.getByRole("button",{name:"点击设为只读",exact:true}).click();}
  else await workspace.getByRole("button",{name:"设为只读",exact:true}).click();
  const times=await page.evaluate(async()=>{const {formatDocumentTimestamp}=await import("/src/lib/document-info.ts");return [1600000000000,1600000300000].map(value=>formatDocumentTimestamp(new Date(value).toISOString()));});
  const title=workspace.getByRole("button",{name:"文档属性",exact:true});await title.hover({position:{x:await title.evaluate(element=>(parseFloat(getComputedStyle(element).paddingLeft)||0)+3),y:12}});
  const info=page.getByRole("tooltip",{name:`${name} 的文档信息`,exact:true});
  for(const time of times)await expect(info).toContainText(time);
  await title.click();const properties=workspace.getByRole("complementary",{name:"文件属性",exact:true});
  for(const time of times)await expect(properties).toContainText(time);
});

for (const readonly of [false, true]) test(`磁盘 Markdown 相对链接打开后，本地文件树跟随选择并展开目标路径 readonly=${readonly}`, async ({ page }) => {
  await createBlankDocument(page, "链接导航树");
  const { workspace, tree } = await openWritableLocalDirectory(page, { "guide.md": "# Guide\n\n[Related](sub/related.md)\n", "sub/related.md": "# Related\n\nTarget paragraph.\n" }, "guide.md");
  if (readonly) await workspace.getByRole("button", { name: "设为只读", exact: true }).click();
  await workspace.getByRole("button", { name: "渲染", exact: true }).click();
  const popups: unknown[] = [];
  page.on("popup", popup => popups.push(popup));
  await workspace.getByRole("link", { name: "Related", exact: true }).click();
  await expect.poll(() => workspace.locator(".note-title:visible").evaluate(element => element instanceof HTMLInputElement ? element.value : element.textContent)).toBe("related.md");
  await expect(tree.getByRole("button", { name: "related.md", exact: true })).toBeVisible();
  await expect(tree.getByRole("button", { name: "related.md", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(popups).toHaveLength(0);
});

for (const style of ["classic", "calm", "calm-compact", "paper", "minimal", "nine-rings", "mono-aware", "yugen", "wabi-sabi"]) test(`磁盘更多工具在源码与渲染间保留开关及背景 ${style}`, async ({ page }) => {
  await page.addInitScript(style => localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: style })), style);
  await createBlankDocument(page, "磁盘工具状态");
  const { workspace } = await openWritableLocalDirectory(page, { "guide.md": "## Heading\n\nParagraph\n" }, "guide.md");
  const tools = workspace.getByRole("button", { name: "更多工具", exact: true });
  await expect(tools).toHaveAttribute("aria-pressed", "true");
  const color = await tools.evaluate(element => getComputedStyle(element).backgroundColor);
  expect(color).not.toBe("rgba(0, 0, 0, 0)");
  await tools.click();
  await workspace.getByRole("button", { name: "渲染", exact: true }).click();
  await expect(tools).toHaveAttribute("aria-pressed", "false");
  await tools.click();
  await expect(tools).toHaveCSS("background-color", color);
  await workspace.getByRole("button", { name: "显示源码", exact: true }).click();
  await expect(tools).toHaveAttribute("aria-pressed", "true");
  await expect(tools).toHaveCSS("background-color", color);
});
