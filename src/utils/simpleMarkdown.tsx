import type { ReactNode } from 'react';

/**
 * A deliberately minimal Markdown-lite renderer for GitHub Release notes (Settings > Update's
 * Changelog modal) - handles exactly what this project's own release notes actually use: "#"
 * headers (any level, rendered the same way - the modal's too small to want a real heading
 * hierarchy), "-"/"*" bullet lists, and blank-line-separated paragraphs. Anything else (links,
 * bold, code blocks, tables, ...) passes through as its raw markdown syntax rather than being
 * silently dropped or mis-rendered - a real markdown library would be the right call if release
 * notes ever grow to actually need those. Every line is passed straight through as React text
 * content (never dangerouslySetInnerHTML), so this can't introduce an HTML injection surface no
 * matter what the source text contains.
 */
export function renderSimpleMarkdown(text: string): ReactNode[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    const headerMatch = line.match(/^#{1,6}\s+(.*)/);
    if (headerMatch) {
      blocks.push(
        <div className="changelog-heading" key={key++}>
          {headerMatch[1]}
        </div>,
      );
      i++;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul className="changelog-list" key={key++}>
          {items.map((item, idx) => (
            <li key={idx}>{item}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Paragraph: consecutive non-blank, non-header, non-list lines joined into one block.
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^#{1,6}\s+/.test(lines[i]) && !/^[-*]\s+/.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(
      <p className="changelog-paragraph" key={key++}>
        {paraLines.join(' ')}
      </p>,
    );
  }

  return blocks;
}
