import {expect,test} from "@playwright/test";
for(const enabled of [false,true])test(`展陈全屏外围信息悬停显示：${enabled?"开启":"默认关闭"}`,async({page})=>{
  await page.setViewportSize({width:1280,height:900});
  await page.addInitScript(enabled=>{
    localStorage.setItem("nine_rings_config",JSON.stringify({interface_style:"mono-aware",workspace_layout:"exhibition"}));
    localStorage.setItem("nr:workspaceLayout",JSON.stringify({fullscreenQuietChrome:enabled}));
    let fullscreen:Element|null=null;
    Object.defineProperty(document,"fullscreenEnabled",{get:()=>true});
    Object.defineProperty(document,"fullscreenElement",{get:()=>fullscreen});
    Element.prototype.requestFullscreen=async()=>{fullscreen=document.documentElement;document.dispatchEvent(new Event("fullscreenchange"));};
    document.exitFullscreen=async()=>{fullscreen=null;document.dispatchEvent(new Event("fullscreenchange"));};
  },enabled);
  await page.goto("/");
  await expect(page.locator(".ProseMirror:visible")).toBeVisible();
  const header=page.locator(".exhibition-masthead"),footer=page.locator(".exhibition-overview"),editor=page.locator(".note-editor-scroll:visible");
  await expect(header).toHaveCSS("opacity","1");
  const before=await editor.boundingBox();
  await header.getByRole("button",{name:"进入全屏",exact:true}).click();
  const box=(await editor.boundingBox())!;
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await expect(header).toHaveCSS("opacity",enabled?"0":"1");
  await expect(footer).toHaveCSS("opacity",enabled?"0":"1");
  expect(await editor.boundingBox()).toEqual(before);
  const top=(await header.boundingBox())!;
  await page.mouse.move(top.x+top.width/2,top.y+top.height/2);
  await expect(header).toHaveCSS("opacity","1");
  const bottom=(await footer.boundingBox())!;
  await page.mouse.move(bottom.x+20,bottom.y+bottom.height/2);
  await expect(footer).toHaveCSS("opacity","1");
  if(enabled)await expect(header).toHaveCSS("opacity","0");
  await page.mouse.move(top.x+top.width/2,top.y+top.height/2);
  await header.getByRole("button",{name:"退出全屏",exact:true}).click();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await expect(header).toHaveCSS("opacity","1");
  await expect(footer).toHaveCSS("opacity","1");
});

test("全屏显示开关从布局设置保存，重载后仍保留",async({page})=>{
  await page.goto("/");await expect(page.locator(".ProseMirror:visible")).toBeVisible();
  await page.getByTitle("设置",{exact:true}).click();
  await page.getByRole("button",{name:/^外观与布局/}).click();
  await page.getByRole("button",{name:/布局设置.*打开布局设置/}).click();
  const checkbox=page.getByRole("checkbox",{name:"全屏时悬停显示外围信息",exact:true});
  await expect(checkbox).not.toBeChecked();await checkbox.check();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("nr:workspaceLayout")!).fullscreenQuietChrome)).toBe(true);
  await page.reload();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("nr:workspaceLayout")!).fullscreenQuietChrome)).toBe(true);
});
