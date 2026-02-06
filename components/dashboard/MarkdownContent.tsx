/**
 * Simple Markdown Renderer for Chat Messages
 * Renders common markdown syntax without external dependencies
 */

'use client';

import React from 'react';

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className = '' }: MarkdownContentProps) {
  const renderMarkdown = (text: string): React.ReactNode => {
    // Split by lines for proper paragraph/list handling
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];
    let listItems: string[] = [];
    let key = 0;

    const flushList = () => {
      if (listItems.length > 0) {
        elements.push(
          <ul key={`list-${key++}`} className="list-none space-y-2 my-3 ml-1">
            {listItems.map((item, i) => (
              <li 
                key={i} 
                className="flex items-start gap-2.5"
                dangerouslySetInnerHTML={{ 
                  __html: '<span class="text-[#007AFF] mt-0.5 flex-shrink-0">•</span><span class="flex-1 text-[#1d1d1f]">' + processInlineMarkdown(item) + '</span>'
                }} 
              />
            ))}
          </ul>
        );
        listItems = [];
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Empty line - paragraph break
      if (!line.trim()) {
        flushList();
        elements.push(<div key={`spacer-${key++}`} className="h-3" />);
        continue;
      }

      // List items (• or -)
      if (line.match(/^[•-]\s+/)) {
        listItems.push(line.replace(/^[•-]\s+/, ''));
        continue;
      }

      // Flush any pending list before other elements
      flushList();

      // Headers
      if (line.startsWith('### ')) {
        elements.push(
          <h3 key={`h3-${key++}`} className="text-base font-semibold mt-4 mb-2 text-[#1d1d1f]">
            {processInlineMarkdown(line.replace(/^###\s+/, ''))}
          </h3>
        );
        continue;
      }
      if (line.startsWith('## ')) {
        elements.push(
          <h2 key={`h2-${key++}`} className="text-lg font-semibold mt-5 mb-2.5 text-[#1d1d1f]">
            {processInlineMarkdown(line.replace(/^##\s+/, ''))}
          </h2>
        );
        continue;
      }
      if (line.startsWith('# ')) {
        elements.push(
          <h1 key={`h1-${key++}`} className="text-xl font-bold mt-5 mb-3 text-[#1d1d1f]">
            {processInlineMarkdown(line.replace(/^#\s+/, ''))}
          </h1>
        );
        continue;
      }

      // Regular paragraph
      elements.push(
        <p
          key={`p-${key++}`}
          className="my-2 leading-relaxed text-[#1d1d1f]"
          dangerouslySetInnerHTML={{ __html: processInlineMarkdown(line) }}
        />
      );
    }

    // Flush any remaining list
    flushList();

    return elements;
  };

  const processInlineMarkdown = (text: string): string => {
    // Escape HTML first to prevent XSS
    let result = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    // Then apply markdown formatting
    result = result
      // Code: `text` (do first to avoid conflicts)
      .replace(/`([^`]+)`/g, '<code class="bg-[#f5f5f7] px-1.5 py-0.5 rounded-[4px] text-[12px] font-mono text-[#AF52DE] border border-black/5">$1</code>')
      // Bold: **text** or __text__
      .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-[#1d1d1f]">$1</strong>')
      .replace(/__([^_]+)__/g, '<strong class="font-semibold text-[#1d1d1f]">$1</strong>')
      // Italic: *text* or _text_
      .replace(/\*([^*]+)\*/g, '<em class="italic text-[#1d1d1f]">$1</em>')
      .replace(/_([^_]+)_/g, '<em class="italic text-[#1d1d1f]">$1</em>')
      // Links: [text](url)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-[#007AFF] hover:text-[#0051D5] underline decoration-[#007AFF]/40 transition-colors">$1</a>');

    return result;
  };

  return (
    <div className={`markdown-content text-sm leading-relaxed text-[#1d1d1f] ${className}`}>
      {renderMarkdown(content)}
    </div>
  );
}
