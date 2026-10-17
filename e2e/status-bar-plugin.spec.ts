import { zipSync, strToU8 } from "fflate";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { closeDocumentSidebar } from "./helpers/workspace";

async function settings(page: import('@playwright/test').Page, category: RegExp) {
  await page.keyboard.press('Alt+,');
  await page.getByLabel('设置分类').getByRole('button',{name:category}).click();
}
test('状态栏导航随隐藏回到标题，源码预览保留全宽与共同横线边界',async({page})=>{
 await createBlankDocument(page); await closeDocumentSidebar(page);
 const bar=page.getByRole('group',{name:'文档状态栏',exact:true});
 await expect(bar.getByRole('button',{name:'后退',exact:true})).toBeVisible();
 await expect(page.locator('.note-title-row .document-navigation')).toHaveCount(0);
 const navBox=await bar.locator('[data-status-item="navigation"]').boundingBox();
 const logBox=await bar.locator('[data-status-item="diagnostics"]').boundingBox();
 const barBox=await bar.boundingBox();
 expect(navBox!.x).toBeGreaterThan(barBox!.x+barBox!.width/2);
 expect(navBox!.x+navBox!.width).toBeLessThanOrEqual(logBox!.x);
 const rendered=await page.locator('.note-title-row:visible').evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,padding:getComputedStyle(el).paddingLeft}));
 await page.getByRole('button',{name:'源码',exact:true}).click();
 const sourceBar=page.getByRole('group',{name:'源码状态栏',exact:true});
 await expect(sourceBar.getByRole('button',{name:'前进',exact:true})).toBeVisible();
 for(const preview of [false,true]) {
  const toggle=page.getByRole('button',{name:'并排预览',exact:true});
  if((await toggle.getAttribute('aria-pressed')==='true')!==preview) await toggle.click();
  const actual=await page.locator('.markdown-source-title-row').evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,padding:getComputedStyle(el).paddingLeft}));
  expect(actual).toEqual(rendered);
  const title=(await page.locator('.markdown-source-title-row').boundingBox())!,toolbar=(await page.locator('.markdown-source-tools').boundingBox())!,footer=(await sourceBar.boundingBox())!;
  expect(Math.abs(title.x-footer.x)).toBeLessThanOrEqual(1);
  const scrollbar=await page.locator('.markdown-source-editor').evaluate(el=>parseFloat(getComputedStyle(el).getPropertyValue('--editor-scrollbar-width'))||0);
  expect(Math.abs(title.width+scrollbar-footer.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(toolbar.x-title.x-12)).toBeLessThanOrEqual(1);
  expect(Math.abs(toolbar.width-title.width+24)).toBeLessThanOrEqual(1);
 }
 await settings(page,/^编辑器.*字体排版/);
 await page.getByRole('checkbox',{name:'编辑器状态栏',exact:true}).uncheck();
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();
 await expect(sourceBar).toHaveCount(0);
 await expect(page.locator('.markdown-source-title-row').getByRole('button',{name:'后退',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'渲染',exact:true}).click();
 await expect(bar).toHaveCount(0);
 await expect(page.locator('.note-title-row').getByRole('button',{name:'前进',exact:true})).toBeVisible();
});

test('状态栏展示插件配置、接管内置设置及停用恢复',async({page})=>{
 await createBlankDocument(page);
 await settings(page,/^高级/);
 await page.getByRole('checkbox',{name:'启用插件功能',exact:true}).check();
 await page.getByRole('checkbox',{name:'启用状态栏展示',exact:true}).check();
 await page.getByRole('button',{name:'状态栏展示',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'状态栏展示配置',exact:true});
 await dialog.getByRole('spinbutton',{name:'状态栏字号',exact:true}).fill('14');
 await dialog.getByRole('checkbox',{name:'状态栏粗体',exact:true}).check();
 await dialog.getByRole('checkbox',{name:'显示字符数',exact:true}).uncheck();
 await dialog.getByRole('button',{name:'阅读或光标位置前移',exact:true}).click();
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();
 const bar=page.getByRole('group',{name:'文档状态栏',exact:true});
 await expect(bar).toHaveAttribute('data-status-display','plugin');
 await expect(bar).toHaveCSS('font-size','14px');
 await expect(bar).toHaveCSS('font-weight','700');
 const originalStyle = await page.locator('html').getAttribute('data-interface-style');
 for(const style of ['classic','paper','calm','minimal','nine-rings','mono-aware','yugen','wabi-sabi']) {
  await page.locator('html').evaluate((el,style)=>el.setAttribute('data-interface-style',style),style);
  await expect(bar).toHaveCSS('font-size','14px');
 }
 await page.locator('html').evaluate((el,style)=>el.setAttribute('data-interface-style',style!),originalStyle);

 await expect(bar.locator('[data-status-item="characters"]')).toHaveCount(0);
 await settings(page,/^编辑器.*字体排版/);
 await expect(page.getByRole('checkbox',{name:'编辑器状态栏',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();
 await settings(page,/^高级/);
 await page.getByRole('checkbox',{name:'启用状态栏展示',exact:true}).uncheck();
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();
 await expect(bar).not.toHaveAttribute('data-status-display','plugin');
 await expect(bar.locator('[data-status-item="characters"]')).toBeVisible();
});

test('专注更多编辑工具跨文档与源码往返保持展开',async({page})=>{
 await createBlankDocument(page,'工具栏保持'); await closeDocumentSidebar(page);
 const first=await page.evaluate(()=>localStorage.getItem('nr:lastNote'));
 await page.getByRole('button',{name:'专注模式',exact:true}).click();
 await page.getByRole('button',{name:'更多编辑工具',exact:true}).click();
 await expect(page.locator('.note-editor:visible .editor-menu')).toBeVisible();
 await page.getByRole('button',{name:'源码',exact:true}).click();
 await page.getByRole('button',{name:'渲染',exact:true}).click();
 await expect(page.locator('.note-editor:visible .editor-menu')).toBeVisible();
 // A regular document switch uses the same host controller as the tree.
 await page.evaluate(async first=>{
  const {api}=await import('/src/lib/api.ts'); const {useNotesStore}=await import('/src/stores/useNotesStore.ts');
  const note=await api.notes.create({title:'工具栏另一份',date:'2026-10-18',storagePath:'ideas',content:{ops:[{insert:'正文\n'}]}});
  (window as any).focusToolsFirst=first; useNotesStore.getState().selectNote(note);
 },first);
 await expect(page.locator('.note-title:visible')).toHaveValue('工具栏另一份');
 await page.evaluate(async()=>{const {api}=await import('/src/lib/api.ts');const {useNotesStore}=await import('/src/stores/useNotesStore.ts');useNotesStore.getState().selectNote(await api.notes.get((window as any).focusToolsFirst));});
 await expect(page.locator('.note-editor:visible .editor-menu')).toBeVisible();
 await expect(page.getByRole('button',{name:'更多编辑工具',exact:true})).toHaveAttribute('aria-expanded','true');
});


test('声明式状态栏包启用与卸载恢复内置展示',async({page})=>{
 await createBlankDocument(page); await settings(page,/^高级/);
 await page.getByRole('checkbox',{name:'启用插件功能',exact:true}).check();
 const manifest=JSON.parse(readFileSync(new URL('../schema/plugin/examples/acme.status/manifest.json',import.meta.url),'utf8'));
 manifest.integrity={algorithm:'sha256',files:{}};
 const section=page.getByRole('region',{name:'已安装声明式插件',exact:true});
 await section.getByLabel('选择声明式插件包').setInputFiles({name:'status.nrplugin.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync({'manifest.json':strToU8(JSON.stringify(manifest))}))});
 const review=page.getByRole('dialog',{name:'审查声明式插件包'});
 await expect(review).toContainText('状态栏展示');
 await review.getByRole('checkbox').check(); await review.getByRole('button',{name:'确认安装',exact:true}).click();
 await section.getByRole('checkbox',{name:'启用 示例状态栏',exact:true}).check();
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();
 await expect(page.getByRole('group',{name:'文档状态栏',exact:true})).toHaveAttribute('data-status-display','plugin');
 await settings(page,/^高级/);
 await section.getByRole('button',{name:'卸载 示例状态栏',exact:true}).click();
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();
 await expect(page.getByRole('group',{name:'文档状态栏',exact:true})).not.toHaveAttribute('data-status-display','plugin');
});

test('不同风格和固定目录下渲染与源码的标题工具和状态栏边界一致',async({page})=>{
 await createBlankDocument(page); await closeDocumentSidebar(page);
 await page.locator('.ProseMirror:visible').evaluate(el=>(el as any).editor.commands.setContent('<h2>标题</h2><p>正文</p>',true));
 await page.getByRole('button',{name:'文档目录',exact:true}).click();
 const splitter=page.locator('.document-dock-width-handle:visible');
 await splitter.hover();
 await expect(splitter).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
 expect(await splitter.evaluate(el=>getComputedStyle(el,'::after').width)).toBe('1px');
 expect((await splitter.boundingBox())!.width).toBeGreaterThanOrEqual(6);
 for(const style of ['classic','paper','calm','wabi-sabi']) {
  await page.locator('html').evaluate((el,style)=>el.setAttribute('data-interface-style',style),style);
  const rendered=await page.locator('.note-title-row:visible').evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,padding:getComputedStyle(el).paddingLeft}));
  await page.getByRole('button',{name:'源码',exact:true}).click();
  await expect(page.getByRole('group',{name:'源码状态栏',exact:true})).toBeVisible();
  const source=await page.locator('.markdown-source-title-row').evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,padding:getComputedStyle(el).paddingLeft}));
  expect(source).toEqual(rendered);
  await page.getByRole('button',{name:'渲染',exact:true}).click();
  await expect(page.locator('.ProseMirror:visible')).toBeVisible();
 }
});

test('状态栏插件隐藏导航时回退标题，局部只读与源码沿用展示',async({page})=>{
 await createBlankDocument(page);await closeDocumentSidebar(page);
 await page.locator('.ProseMirror:visible').evaluate(el=>(el as any).editor.commands.setContent('<h2>标题</h2><p>正文</p>',true));
 await page.evaluate(async()=>{
  const {setPluginsEnabled}=await import('/src/lib/plugin-system/runtime.ts');
  const {saveStatusPreference,readStatusPreference}=await import('/src/lib/plugin-system/builtin-status-display.ts');
  setPluginsEnabled(true);const p=readStatusPreference();saveStatusPreference({enabled:true,display:{...p.display,fontSize:14,showInFocus:true,items:p.display.items.filter(k=>k!=='navigation')}});
  const {setReadonlyRenderingEnabled}=await import('/src/lib/readonly-rendering.ts');setReadonlyRenderingEnabled(true);
 });
 await expect(page.getByRole('group',{name:'文档状态栏',exact:true})).toHaveAttribute('data-status-display','plugin');
 await expect(page.locator('.note-title-row .document-navigation')).toBeVisible();
 await page.getByRole('button',{name:'点击设为只读',exact:true}).click();
 await expect(page.locator('.vr-note')).toBeVisible();
 const bar=page.getByRole('group',{name:'文档状态栏',exact:true});await expect(bar).toHaveCSS('font-size','14px');
 await expect(bar.getByRole('button',{name:'后退',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'源码',exact:true}).click();
 await expect(page.getByRole('group',{name:'源码状态栏',exact:true})).toHaveCSS('font-size','14px');
 await expect(page.locator('.markdown-source-title-row .document-navigation')).toBeVisible();
});

test('内置专注状态栏开关控制渲染和源码，隐藏后导航回到标题',async({page})=>{
 await createBlankDocument(page);await closeDocumentSidebar(page);
 await settings(page,/^编辑器.*字体排版/);
 await expect(page.getByRole('checkbox',{name:'专注模式状态栏',exact:true})).toBeChecked();
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();
 await page.getByRole('button',{name:'专注模式',exact:true}).click();
 await expect(page.getByRole('group',{name:'文档状态栏',exact:true})).toBeVisible();
 await expect(page.locator('.note-title-row .document-navigation')).toHaveCount(0);
 await page.getByRole('button',{name:'源码',exact:true}).click();
 await expect(page.getByRole('group',{name:'源码状态栏',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'渲染',exact:true}).click();
 await expect(page.getByRole('group',{name:'文档状态栏',exact:true})).toBeVisible();
 await settings(page,/^编辑器.*字体排版/);
 await page.getByRole('checkbox',{name:'专注模式状态栏',exact:true}).uncheck();
 await page.getByRole('button',{name:'关闭设置',exact:true}).click();
 await expect(page.getByRole('group',{name:'文档状态栏',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'后退',exact:true})).toBeVisible();
});
