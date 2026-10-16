import {test,expect} from "@playwright/test";
import {createBlankDocument} from "./helpers/document";
test("文档树右键复制名称保持文档不变并在下方提示",async({page})=>{
 await createBlankDocument(page,"复制名称 - 中文 Example");
 await page.evaluate(()=>Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async(text:string)=>{(window as unknown as {copiedName:string}).copiedName=text;}}}));
 const note=page.locator(".doc-tree").getByRole("button",{name:"复制名称 - 中文 Example",exact:true});
 await note.click({button:"right"});
 await page.locator(".doc-context-menu").getByRole("button",{name:"复制名称",exact:true}).click();
 await expect(page.locator(".doc-context-menu")).toHaveCount(0);
 expect(await page.evaluate(()=>(window as unknown as {copiedName:string}).copiedName)).toBe("复制名称 - 中文 Example");
 await expect(page.locator(".doc-tree-path-toast")).toContainText("已复制名称");
});
