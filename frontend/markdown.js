(function createMarkdownRenderer(global) {
  const markdownParser = global.marked;
  const sanitizer = global.DOMPurify;

  if (!markdownParser || !sanitizer) {
    console.error("Markdown renderer dependencies failed to load.");
  } else {
    markdownParser.setOptions({
      breaks: true,
      gfm: true
    });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function toHtml(value) {
    const markdown = String(value ?? "");
    if (!markdownParser || !sanitizer) {
      return `<p>${escapeHtml(markdown).replaceAll("\n", "<br />")}</p>`;
    }

    const parsed = markdownParser.parse(markdown);
    return sanitizer.sanitize(parsed, {
      USE_PROFILES: { html: true }
    });
  }

  function toDocument(title, value) {
    const safeTitle = escapeHtml(title || "Markdown 文档");
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { max-width: 860px; margin: 0 auto; padding: 48px 32px; color: #241719; background: #fff; font: 15px/1.75 "PingFang SC", "Microsoft YaHei", sans-serif; }
    h1, h2, h3, h4 { margin: 1.6em 0 .65em; line-height: 1.35; }
    h1 { margin-top: 0; font-size: 30px; border-bottom: 1px solid #e8e4e1; padding-bottom: 12px; }
    h2 { font-size: 22px; border-bottom: 1px solid #e8e4e1; padding-bottom: 8px; }
    h3 { font-size: 18px; }
    p, ul, ol, blockquote, pre, table { margin: 0 0 16px; }
    a { color: #a9161b; }
    blockquote { padding: 10px 16px; border-left: 4px solid #c81e24; color: #655c5d; background: #fcfbfa; }
    code { padding: 2px 6px; border-radius: 5px; background: #f6f4f2; font-family: Consolas, monospace; }
    pre { overflow-x: auto; padding: 16px; border-radius: 8px; color: #f9f5ed; background: #241719; }
    pre code { padding: 0; color: inherit; background: transparent; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 12px; border: 1px solid #e8e4e1; text-align: left; vertical-align: top; }
    th { background: #f6f4f2; }
    img { max-width: 100%; }
    hr { margin: 24px 0; border: 0; border-top: 1px solid #e8e4e1; }
    @media print { body { max-width: none; padding: 0; } a { color: inherit; text-decoration: none; } }
  </style>
</head>
<body>${toHtml(value)}</body>
</html>`;
  }

  global.markdownRenderer = { toHtml, toDocument };
})(window);
