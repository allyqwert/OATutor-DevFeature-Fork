import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import 'katex/dist/katex.min.css';

/**
 * Same math preprocessing as MessageRenderer: \( \) and \[ \] → $ / $$
 * Use inline=true when embedding in a flex row so <p> does not break layout.
 */
function preprocessMath(content) {
    const normalized = (content || '')
        .replace(/\\\(/g, '$')
        .replace(/\\\)/g, '$')
        .replace(/\\\[/g, '$$')
        .replace(/\\\]/g, '$$');

    // If no explicit math delimiters are present but the string looks like LaTeX/math,
    // wrap it so remark-math + KaTeX can still render it.
    const hasMathDelimiters = normalized.includes('$');
    const looksLikeLatexMath =
        /(^|[^\\])[A-Za-z]\^\d/.test(normalized) || // x^2, y^3
        /(^|[^\\])[A-Za-z]_[A-Za-z0-9]/.test(normalized) || // x_1
        /\\(frac|sqrt|pi|theta|alpha|beta|gamma|Delta|sum|int|approx|quad)\b/.test(normalized) ||
        /=/.test(normalized);

    if (!hasMathDelimiters && looksLikeLatexMath) {
        return `$${normalized}$`;
    }

    return normalized;
}

export default function ArtifactMarkdown({ content, inline = false, style }) {
    const processed = preprocessMath(content);

    const components = inline
        ? {
              p: ({ children }) => <span style={{ display: 'inline' }}>{children}</span>,
          }
        : {
              p: ({ children }) => (
                  <p style={{ margin: '0.35em 0' }}>{children}</p>
              ),
          };

    const wrapperStyle = {
        color: '#52606d',
        fontSize: 14,
        lineHeight: 1.6,
        ...(inline ? { display: 'inline-block', verticalAlign: 'baseline' } : {}),
        ...style,
    };

    return (
        <div style={wrapperStyle}>
            <ReactMarkdown
                remarkPlugins={[remarkMath, remarkGfm]}
                rehypePlugins={[rehypeKatex]}
                components={components}
            >
                {processed}
            </ReactMarkdown>
        </div>
    );
}
