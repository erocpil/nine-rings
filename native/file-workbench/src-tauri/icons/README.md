# File Workbench 图标

独立应用使用用户提供的 FKFl4.jpg，原图保存在 source.jpg；不再引用 Nine Rings 图标。

在仓库根目录重新生成桌面图标：

```bash
sips -s format png native/file-workbench/src-tauri/icons/source.jpg --out /tmp/file-workbench-source.png
bash scripts/with-local-tools.sh npx tauri icon /tmp/file-workbench-source.png --output /tmp/file-workbench-icons
```

从输出中更新本目录的 PNG、ICO 和 ICNS 桌面资源即可，不加入未支持的平台图标。file-workbench.html 的网页图标也使用本目录32x32.png。Nine Rings 的 src-tauri/icons 不变。
