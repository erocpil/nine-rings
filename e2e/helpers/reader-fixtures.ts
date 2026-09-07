import { strToU8, zipSync } from "fflate";

export function createPdfFixture(): Buffer {
  const firstStream = "BT /F1 18 Tf 36 90 Td (Nine Rings PDF MVP) Tj ET";
  const secondStream = "BT /F1 18 Tf 36 90 Td (Second page searchable target) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(firstStream)} >>\nstream\n${firstStream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    `<< /Length ${Buffer.byteLength(secondStream)} >>\nstream\n${secondStream}\nendstream`,
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n`;
  source += "0000000000 65535 f \n";
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(source, "ascii");
}

export function createEpubFixture(): Buffer {
  const files = {
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(`<?xml version="1.0"?>
      <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
        <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
      </container>`),
    "OEBPS/content.opf": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:identifier id="book-id">nine-rings-epub-test</dc:identifier>
          <dc:title>Nine Rings EPUB MVP</dc:title>
          <dc:creator>测试作者</dc:creator>
          <dc:language>zh-CN</dc:language>
        </metadata>
        <manifest>
          <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
          <item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/>
          <item id="chapter-2" href="chapter-2.xhtml" media-type="application/xhtml+xml"/>
          <item id="style" href="book.css" media-type="text/css"/>
          <item id="cover" href="cover.svg" media-type="image/svg+xml" properties="cover-image"/>
        </manifest>
        <spine><itemref idref="chapter-1"/><itemref idref="chapter-2"/></spine>
      </package>`),
    "OEBPS/nav.xhtml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
        <nav epub:type="toc"><ol><li><a href="chapter-1.xhtml">开始阅读</a><ol><li><a href="chapter-2.xhtml#target">继续阅读</a></li></ol></li></ol></nav>
      </body></html>`),
    "OEBPS/book.css": strToU8("h1 { letter-spacing: 0.02em; }"),
    "OEBPS/cover.svg": strToU8(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#315f9b"/><text x="200" y="300" text-anchor="middle" fill="white">Nine Rings</text></svg>`),
    "OEBPS/chapter-1.xhtml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <html xmlns="http://www.w3.org/1999/xhtml"><head><title>开始阅读</title><link rel="stylesheet" href="book.css"/></head>
      <body><h1>第一章</h1><p>这是 EPUB 第一章正文。</p><p id="hard-line-a">At one time or</p><p id="hard-line-b">another, this line should be joined.</p><p id="manual-line-a">Manual line break</p><p id="manual-line-b">Needs exact repair.</p><a href="chapter-2.xhtml#target">正文下一章</a><script>parent.document.body.dataset.epubUnsafe='true'</script></body></html>`),
    "OEBPS/chapter-2.xhtml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <html xmlns="http://www.w3.org/1999/xhtml"><head><title>继续阅读</title></head>
      <body><h1 id="target">第二章</h1><p>阅读进度应当保存到这里。</p><div style="height: 1800px"></div><p>章节末尾内容。</p></body></html>`),
  };
  return Buffer.from(zipSync(files, { level: 6 }));
}
