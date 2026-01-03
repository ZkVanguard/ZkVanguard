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
                  __html: '<span class="text-cyan-400 mt-0.5 flex-shrink-0">•</span><span class="flex-1">' + processInlineMarkdown(item) + '</span>'
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
      if (line.match(/^[•\-]\s+/)) {
        listItems.push(line.replace(/^[•\-]\s+/, ''));
        continue;
      }

      // Flush any pending list before other elements
      flushList();

      // Headers
      if (line.startsWith('### ')) {
        elements.push(
          <h3 key={`h3-${key++}`} className="text-base font-semibold mt-4 mb-2 text-gray-100">
            {processInlineMarkdown(line.replace(/^###\s+/, ''))}
          </h3>
        );
        continue;
      }
      if (line.startsWith('## ')) {
        elements.push(
          <h2 key={`h2-${key++}`} className="text-lg font-semibold mt-5 mb-2.5 text-white">
            {processInlineMarkdown(line.replace(/^##\s+/, ''))}
          </h2>
        );
        continue;
      }
      if (line.startsWith('# ')) {
        elements.push(
          <h1 key={`h1-${key++}`} className="text-xl font-bold mt-5 mb-3 text-white">
            {processInlineMarkdown(line.replace(/^#\s+/, ''))}
          </h1>
        );
        continue;
      }

      // Regular paragraph
      elements.push(
        <p
          key={`p-${key++}`}
          className="my-2 leading-relaxed text-gray-200"
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
      .replace(/`([^`]+)`/g, '<code class="bg-gray-800/70 px-2 py-1 rounded text-sm font-mono text-cyan-300 border border-gray-700">$1</code>')
      // Bold: **text** or __text__
      .replace(/\*\*([^\*]+)\*\*/g, '<strong class="font-semibold text-white">$1</strong>')
      .replace(/__([^_]+)__/g, '<strong class="font-semibold text-white">$1</strong>')
      // Italic: *text* or _text_
      .replace(/\*([^\*]+)\*/g, '<em class="italic text-gray-300">$1</em>')
      .replace(/_([^_]+)_/g, '<em class="italic text-gray-300">$1</em>')
      // Links: [text](url)
      .replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300 underline decoration-blue-400/40 transition-colors">$1</a>');

    return result;
  };

  return (
    <div className={`markdown-content text-sm leading-relaxed ${className}`}>
      {renderMarkdown(content)}
    </div>
  );
}
