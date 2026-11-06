import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const { app: { security } } = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
// Tauri's bundled-asset transformation adds nonce sources unless this directive
// is explicitly excluded. A nonce makes unsafe-inline ineffective in style-src.
const modifications = security.dangerousDisableAssetCspModification;
const modifiesStyles = modifications !== true && !(Array.isArray(modifications) && modifications.includes("style-src"));
const csp = modifiesStyles
  ? security.csp.replace(/style-src ([^;]+)/, "style-src $1 'nonce-tauri-test'")
  : security.csp;

test("Tauri CSP 允许 Mermaid 动态样式，节点颜色和时序图连线完整", async ({ page }) => {
  await page.route("**/__mermaid_csp_test", route => route.fulfill({
    contentType: "text/html",
    headers: { "Content-Security-Policy": csp },
    body: '<!doctype html><html><body><div id="flow"></div><div id="sequence"></div></body></html>',
  }));
  await page.goto("/__mermaid_csp_test");
  const violations = await page.evaluate(async () => {
    const violations: string[] = [];
    document.addEventListener("securitypolicyviolation", event => violations.push(event.violatedDirective));
    const { renderMermaid } = await import("/src/lib/mermaid-render.ts");
    document.querySelector("#flow")!.innerHTML = await renderMermaid('flowchart TD\nA["现象<br/>间歇性失败"] --> B["检查"]\nstyle A fill:#ffdddd');
    document.querySelector("#sequence")!.innerHTML = await renderMermaid('sequenceDiagram\nparticipant A as 发送端\nparticipant B as 接收端\nA->>B: 投递消息\nNote over B: 序列号去重');
    await new Promise(resolve => setTimeout(resolve, 100));
    return violations;
  });
  await expect(page.locator("#flow .node rect").first()).toHaveCSS("fill", "rgb(255, 221, 221)");
  await expect(page.locator("#flow .node rect").nth(1)).toHaveCSS("fill", "rgb(228, 237, 255)");
  await expect(page.locator("#flow .nodeLabel").first()).toHaveCSS("color", "rgb(32, 33, 36)");
  await expect(page.locator("#sequence .messageLine0").first()).not.toHaveCSS("stroke", "none");
  expect(violations.filter(value => value.startsWith("style-src"))).toEqual([]);
});

for (const theme of ["light", "dark"]) test(`Mermaid 连线标签使用灰蓝底色并区别于节点 ${theme}`, async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async theme => {
    document.documentElement.setAttribute("data-theme", theme);
    const { renderMermaid } = await import("/src/lib/mermaid-render.ts");
    const host = document.createElement("div");
    host.id = "edge-label-palette-test";
    host.innerHTML = await renderMermaid(`flowchart TB
    subgraph NIC["NIC 硬件层 / ConnectX-6 Dx"]
        RX["RX Queue"]
        TX["TX Queue"]
    end
    subgraph USERSPACE["用户态 / DPDK + DPVS"]
        DPVS["DPVS L4 Gateway"]
        SESSION["Session Sync"]
        VXLAN["VXLAN Tunneling"]
    end
    subgraph SCALE["规模上下文"]
        S1["7 Clusters / 1000 EIPs"]
        S2["90% Line Rate Validated"]
    end
    RX -->|"Zero-copy DMA"| DPVS
    DPVS --> SESSION
    SESSION --> VXLAN
    VXLAN --> TX
    USERSPACE -.- SCALE`);
    document.body.append(host);
  }, theme);
  const diagram = page.locator("#edge-label-palette-test");
  const label = diagram.locator(".edgeLabel .labelBkg").filter({ hasText: "Zero-copy DMA" });
  await expect(label).toHaveCSS("background-color", "rgba(243, 246, 250, 0.5)");
  await expect(diagram.locator(".node rect").first()).toHaveCSS("fill", "rgb(228, 237, 255)");
});
