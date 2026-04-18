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
    let normalized = (content || '')
        .replace(/\\\(/g, '$')
        .replace(/\\\)/g, '$')
        .replace(/\\\[/g, '$$')
        .replace(/\\\]/g, '$$');

    // Best-effort sanitation for common model-produced pseudo-LaTeX so KaTeX doesn't error.
    // Examples seen in the wild:
    // - vec(F)_1  -> \vec{F}_1
    // - F_(\\text{tot}) -> F_{\\text{tot}}
    // - x_(1) -> x_{1}
    // NOTE on escaping: in a JS string literal, '\\vec' is the 4-char string `\vec`
    // (single backslash + "vec"), which is exactly what KaTeX expects. Using '\\\\vec'
    // would emit `\\vec` (two backslashes) and KaTeX parses `\\` as a line-break.
    normalized = normalized
        // vec(F) / vec(x) -> \vec{F} / \vec{x}
        .replace(/\bvec\(\s*([A-Za-z])\s*\)/g, '\\vec{$1}')
        // vecF / vecX written as one token -> \vec{F}
        .replace(/\bvec([A-Za-z])\b/g, '\\vec{$1}')
        // _( \text{...} ) -> _{\text{...}}
        .replace(/_\(\s*(\\text\{[^}]*\})\s*\)/g, '_{$1}')
        // _(token) -> _{token}  (keeps it conservative: no spaces, no braces)
        .replace(/_\(\s*([A-Za-z0-9]+)\s*\)/g, '_{$1}')
        // \sqrtTOKEN (letters then optional digits) -> \sqrt{TOKEN}. Only wraps the first word.
        .replace(/\\sqrt([A-Za-z][A-Za-z0-9]*)/g, '\\sqrt{$1}')
        // Dangling \text{tok  (no closing brace) before whitespace / = / ^ / _ / $ / end → close it.
        .replace(/\\text\{([A-Za-z0-9]+)(?=[\s=^_$]|$)/g, '\\text{$1}');

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
