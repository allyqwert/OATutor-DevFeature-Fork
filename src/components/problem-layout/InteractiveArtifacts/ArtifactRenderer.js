import React, { useEffect, useMemo, useState } from 'react';
import { Slider } from '@material-ui/core';
import ArtifactMarkdown from './ArtifactMarkdown';

function debugLog(...args) {
    // eslint-disable-next-line no-console
    console.log('[artifact-debug]', ...args);
}

function isValidDecision(decision) {
    return (
        decision &&
        typeof decision === 'object' &&
        typeof decision.enable_interactive_artifact === 'boolean'
    );
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function evaluateExpression(expr, vars = {}) {
    if (typeof expr === 'number') return expr;
    if (typeof expr !== 'string') return 0;
    const trimmed = expr.trim();
    if (Object.prototype.hasOwnProperty.call(vars, trimmed)) {
        const value = Number(vars[trimmed]);
        return Number.isFinite(value) ? value : 0;
    }
    if (!expr.startsWith('=')) {
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    const body = expr.slice(1);
    try {
        // eslint-disable-next-line no-new-func
        const fn = new Function('vars', 'Math', `with (vars) { return (${body}); }`);
        const result = fn(vars, Math);
        return Number.isFinite(Number(result)) ? Number(result) : 0;
    } catch (_e) {
        return 0;
    }
}

function interpolateTemplate(text, vars = {}) {
    if (typeof text !== 'string') return '';
    let output = text;

    const helpers = {
        // For plugging into patterns like (x - h): renders as "- 2", "+ 5", "+ 0"
        fmtMinus: (v) => {
            const n = Number(v);
            if (!Number.isFinite(n)) return '';
            if (n < 0) return `+ ${Math.abs(n)}`;
            if (n === 0) return '+ 0';
            return `- ${n}`;
        },
        // For plugging into patterns like (x + h): renders as "+ 2", "- 5", "+ 0"
        fmtPlus: (v) => {
            const n = Number(v);
            if (!Number.isFinite(n)) return '';
            if (n < 0) return `- ${Math.abs(n)}`;
            if (n === 0) return '+ 0';
            return `+ ${n}`;
        },
        fmtAbs: (v) => {
            const n = Number(v);
            return Number.isFinite(n) ? Math.abs(n) : 0;
        },
    };

    // Run multiple passes so templates introduced by earlier replacements can also resolve.
    // Keep expression matcher strict (no braces inside) to avoid swallowing LaTeX braces.
    const templateRegex = /\{\{\s*([^{}]+?)\s*\}\}/g;
    for (let i = 0; i < 4; i += 1) {
        let changed = false;
        output = output.replace(templateRegex, (_full, expression) => {
            try {
                // eslint-disable-next-line no-new-func
                const fn = new Function(
                    'vars',
                    'Math',
                    'helpers',
                    `with (vars) { with (helpers) { return (${expression}); } }`
                );
                const value = fn(vars, Math, helpers);
                changed = true;
                if (value === undefined || value === null) return '';
                const asNum = Number(value);
                return Number.isFinite(asNum) ? String(asNum) : String(value);
            } catch (_e) {
                // If expression fails, drop this token instead of leaking broken braces into LaTeX.
                changed = true;
                return '';
            }
        });
        if (!changed) break;
    }

    // Final cleanup: collapse whitespace only. Do NOT strip `{{` or `}}` —
    // legitimate LaTeX like `F_{\text{normal}}` ends in `}}` and we would
    // destroy its outer braces. Unresolved templates are already replaced
    // with '' inside the loop's catch branch, so nothing else to clean.
    output = output.replace(/\s{2,}/g, ' ').trim();

    return output;
}

function getStepPrecision(step) {
    if (!Number.isFinite(step) || step <= 0 || step >= 1) return 0;
    const str = String(step);
    const dot = str.indexOf('.');
    return dot === -1 ? 0 : str.length - dot - 1;
}

function formatValue(value, step) {
    const precision = getStepPrecision(Number(step));
    return Number(value).toFixed(precision);
}

// Round x to a "nice" number: power of 10 times 1, 2, or 5. Used to pick
// slider step sizes that feel natural regardless of the variable's magnitude.
function niceNumber(x) {
    if (!Number.isFinite(x) || x <= 0) return 1;
    const exp = Math.floor(Math.log10(x));
    const frac = x / Math.pow(10, exp);
    const mult = frac < 1.5 ? 1 : frac < 3.5 ? 2 : frac < 7.5 ? 5 : 10;
    return mult * Math.pow(10, exp);
}

function snapToStep(value, step) {
    if (!Number.isFinite(step) || step <= 0) return value;
    return Math.round(value / step) * step;
}

// Small deterministic RNG so the same plan + variable always starts at the
// same offset (no jitter on re-render), but different variables / different
// plans get different starting points.
function hashStringToSeed(s) {
    let h = 2166136261;
    const str = String(s || '');
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function seededRng(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Derive a sensible slider range and step from the LLM-supplied config.
// The LLM is unreliable at picking min/max/step (absurdly wide ranges,
// jumpy non-uniform steps like 0.3). We keep only its `defaultValue` as the
// "true answer" anchor and build a ~50-tick symmetric range with a
// power-of-10 step. The slider then STARTS at a deterministic-but-nudged
// position (not at the answer, not at the middle) so students have to
// slide to explore — the whole point of an interactive visual.
function autoSliderConfig(cfg, seedKey) {
    const rawDefault = Number(cfg?.defaultValue);
    const rawMin = Number(cfg?.min);
    const rawMax = Number(cfg?.max);
    const anchor = Number.isFinite(rawDefault)
        ? rawDefault
        : Number.isFinite(rawMin) && Number.isFinite(rawMax)
            ? (rawMin + rawMax) / 2
            : 0;
    const magnitudeCandidates = [
        Math.abs(anchor),
        Math.abs(rawMax),
        Math.abs(rawMin),
    ].filter((v) => Number.isFinite(v) && v > 0);
    const magnitude = magnitudeCandidates.length > 0 ? Math.max(...magnitudeCandidates) : 1;
    const step = niceNumber(magnitude / 50);
    const halfSpan = step * 25;
    const min = snapToStep(anchor - halfSpan, step);
    const max = snapToStep(anchor + halfSpan, step);

    // Pick a starting position offset from the answer by 25–60% of halfSpan,
    // in a seeded direction. Never starts AT the answer, never at the extremes.
    const rng = seededRng(hashStringToSeed(seedKey));
    const direction = rng() < 0.5 ? -1 : 1;
    const fraction = 0.25 + rng() * 0.35; // 25%–60%
    const start = anchor + direction * fraction * halfSpan;
    const innerMin = min + step;
    const innerMax = max - step;
    const defaultValue = clamp(snapToStep(start, step), innerMin, innerMax);
    return { min, max, step, defaultValue };
}

function normalizeLatexSigns(content) {
    if (typeof content !== 'string') return '';
    // Keep this intentionally conservative: only normalize obvious sign artifacts
    // that look bad in plug-and-play output (e.g. "x - -5" -> "x + 5").
    return content
        .replace(/\+\s*-\s*/g, '- ')
        .replace(/-\s*-\s*/g, '+ ')
        .replace(/\(\s*-\s*/g, '(-') // avoid "( -5" spacing
        .replace(/\s{2,}/g, ' ');
}

function toColor(value, fallback) {
    return typeof value === 'string' && value.trim() ? value : fallback;
}

function isRedLikeColor(value) {
    if (typeof value !== 'string') return false;
    const c = value.trim().toLowerCase();
    if (c === 'red' || c === '#f00' || c === '#ff0000') return true;

    // Parse #rgb / #rrggbb / #rrggbbaa
    if (c.startsWith('#')) {
        let r;
        let g;
        let b;
        if (c.length === 4) {
            r = parseInt(c[1] + c[1], 16);
            g = parseInt(c[2] + c[2], 16);
            b = parseInt(c[3] + c[3], 16);
        } else if (c.length === 7 || c.length === 9) {
            r = parseInt(c.slice(1, 3), 16);
            g = parseInt(c.slice(3, 5), 16);
            b = parseInt(c.slice(5, 7), 16);
        }
        if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
            return r > 150 && g < 120 && b < 120;
        }
    }

    // Parse rgb()/rgba() with arbitrary spacing
    const rgbMatch = c.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
    if (rgbMatch) {
        const r = Number(rgbMatch[1]);
        const g = Number(rgbMatch[2]);
        const b = Number(rgbMatch[3]);
        if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
            return r > 150 && g < 120 && b < 120;
        }
    }

    return false;
}

function getAreaStyle(element, type, vars) {
    // Keep area-like shapes visually consistent and readable.
    const defaultStroke = '#0C74E8';
    const defaultFill = 'rgba(12,116,232,0.20)';
    const requestedFill = toColor(element.fill, '');
    const requestedStroke = toColor(element.stroke, defaultStroke);

    // If model picks harsh red fills, normalize to light blue.
    const fill = (!requestedFill || isRedLikeColor(requestedFill)) ? defaultFill : requestedFill;
    const stroke = (!requestedStroke || isRedLikeColor(requestedStroke)) ? defaultStroke : requestedStroke;
    const strokeWidth = evaluateExpression(element.strokeWidth ?? (type === 'rect' ? 1.5 : 2.5), vars);

    return { fill, stroke, strokeWidth };
}

function getVarConfigById(varsConfig) {
    const map = {};
    varsConfig.forEach((cfg) => {
        if (cfg?.id) map[cfg.id] = cfg;
    });
    return map;
}

function getGlobalDomain(varsConfig) {
    const mins = [];
    const maxs = [];
    varsConfig.forEach((cfg) => {
        const min = Number(cfg?.min);
        const max = Number(cfg?.max);
        if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
            mins.push(min);
            maxs.push(max);
        }
    });
    if (mins.length === 0) {
        return { min: 0, max: 1, valid: false };
    }
    return {
        min: Math.min(...mins),
        max: Math.max(...maxs),
        valid: true,
    };
}

function getVarAxis(cfg) {
    const idText = String(cfg?.id || '').toLowerCase();
    const labelText = String(cfg?.label || '').toLowerCase();
    const combined = `${idText} ${labelText}`;
    if (combined.includes('radius') || idText === 'r' || labelText === 'r') return 'r';
    if (idText.startsWith('x') || labelText.startsWith('x') || combined.includes('center x')) return 'x';
    if (idText.startsWith('y') || labelText.startsWith('y') || combined.includes('center y')) return 'y';
    return null;
}

function getAxisDomain(varsConfig, axis, fallbackDomain) {
    const mins = [];
    const maxs = [];
    varsConfig.forEach((cfg) => {
        if (getVarAxis(cfg) !== axis) return;
        const min = Number(cfg?.min);
        const max = Number(cfg?.max);
        if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
            mins.push(min);
            maxs.push(max);
        }
    });
    if (mins.length === 0) return fallbackDomain;

    // Keep coordinate systems centered around origin for better visual consistency.
    const domainMin = Math.min(...mins);
    const domainMax = Math.max(...maxs);
    const maxAbs = Math.max(Math.abs(domainMin), Math.abs(domainMax), 1);
    return { min: -maxAbs, max: maxAbs, valid: true };
}

// Walk the element tree and record which variable ids appear on x-like vs
// y-like coordinate fields. We use this to right-size the axis domains so
// the drawing always fills the canvas proportional to the sliders in use.
function inferAxisVarNames(elements) {
    const xKeys = ['x', 'x1', 'x2', 'x3', 'cx'];
    const yKeys = ['y', 'y1', 'y2', 'y3', 'cy'];
    const xVars = new Set();
    const yVars = new Set();

    const extractVar = (value) => {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        const body = trimmed.startsWith('=') ? trimmed.slice(1).trim() : trimmed;
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(body)) return body;
        return null;
    };

    const walkElement = (element) => {
        if (!element || typeof element !== 'object') return;
        xKeys.forEach((k) => {
            const v = extractVar(element[k]);
            if (v) xVars.add(v);
        });
        yKeys.forEach((k) => {
            const v = extractVar(element[k]);
            if (v) yVars.add(v);
        });
        if (Array.isArray(element.points)) {
            element.points.forEach((p) => {
                if (!p) return;
                const vx = extractVar(p.x);
                const vy = extractVar(p.y);
                if (vx) xVars.add(vx);
                if (vy) yVars.add(vy);
            });
        } else if (typeof element.points === 'string') {
            // "x,y x,y ..." — all numeric, no variables to record.
        }
    };

    (Array.isArray(elements) ? elements : []).forEach(walkElement);
    return { xVars, yVars };
}

// Build an axis domain from the ranges of the specified variable ids, anchored
// at 0 so that origin-based drawings (e.g. vectors from (0,0)) have room.
function domainFromVarNames(varsConfig, names) {
    if (!names || names.size === 0) return null;
    const mins = [0];
    const maxs = [0];
    varsConfig.forEach((cfg) => {
        if (!cfg?.id || !names.has(cfg.id)) return;
        const min = Number(cfg.min);
        const max = Number(cfg.max);
        if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
            mins.push(min);
            maxs.push(max);
        }
    });
    if (mins.length === 1) return null; // only the 0 anchor, no real data
    return { min: Math.min(...mins), max: Math.max(...maxs), valid: true };
}

// Convert a (potentially LaTeX-flavored) label into plain text suitable for
// direct SVG <text> rendering. KaTeX can't run inside <text>, so instead of
// showing `F_{\text{applied}}` literally, we reduce it to `F_applied`.
function latexToPlainText(s) {
    if (typeof s !== 'string') return '';
    return s
        .replace(/\\text\{([^{}]*)\}/g, '$1')
        .replace(/\\mathrm\{([^{}]*)\}/g, '$1')
        .replace(/\\vec\{([^{}]*)\}/g, '$1')
        .replace(/\\sqrt\{([^{}]*)\}/g, 'sqrt($1)')
        .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
        // Strip any remaining LaTeX commands like \alpha, \Delta, \cdot (keep the letters).
        .replace(/\\([A-Za-z]+)/g, '$1')
        // Strip leftover braces that were holding grouped content.
        .replace(/[{}]/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

// Split a plain-text label like `F_tot + x^2` into segments that SVG can
// typeset with proper sub/superscripts (no KaTeX needed). Each segment is
// `{ text, kind }` with kind ∈ 'base' | 'sub' | 'sup'. After a sub or sup,
// following base text returns to the normal baseline automatically because
// baseline-shift is a per-tspan presentation attribute.
function parseLabelSegments(text) {
    if (typeof text !== 'string' || !text) return [];
    const segments = [];
    let buf = '';
    const flushBase = () => {
        if (buf) {
            segments.push({ text: buf, kind: 'base' });
            buf = '';
        }
    };
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (ch === '_' || ch === '^') {
            flushBase();
            const kind = ch === '_' ? 'sub' : 'sup';
            i += 1;
            // Collect the subscript/superscript token: one identifier-ish run
            // (letters, digits, Greek fallback). Stops at space or operator.
            let tok = '';
            while (i < text.length && /[A-Za-z0-9]/.test(text[i])) {
                tok += text[i];
                i += 1;
            }
            if (tok) segments.push({ text: tok, kind });
        } else {
            buf += ch;
            i += 1;
        }
    }
    flushBase();
    return segments;
}

function inferCircleDomainFromConfig(varsConfig, vars) {
    const byKey = {};
    varsConfig.forEach((cfg) => {
        if (cfg?.id) byKey[String(cfg.id).toLowerCase()] = cfg;
    });

    const centerXCfg = byKey.centerx || byKey.h || byKey.cx;
    const centerYCfg = byKey.centery || byKey.k || byKey.cy;
    const radiusCfg = byKey.radius || byKey.r;
    if (!radiusCfg) return null;

    const resolveVal = (cfg) => {
        if (!cfg?.id) return Number.NaN;
        const id = cfg.id;
        const fromState = vars && Object.prototype.hasOwnProperty.call(vars, id)
            ? Number(vars[id])
            : Number.NaN;
        if (Number.isFinite(fromState)) return fromState;
        const fromDefault = Number(cfg.defaultValue);
        if (Number.isFinite(fromDefault)) return fromDefault;
        return Number.NaN;
    };

    const cxVal = resolveVal(centerXCfg);
    const cyVal = resolveVal(centerYCfg);
    const rVal = resolveVal(radiusCfg);
    if (!Number.isFinite(rVal) || rVal <= 0) return null;

    const xCenter = Number.isFinite(cxVal) ? cxVal : 0;
    const yCenter = Number.isFinite(cyVal) ? cyVal : 0;
    const span = Math.max(4, rVal + 2);

    return {
        xDomain: { min: xCenter - span, max: xCenter + span, valid: true },
        yDomain: { min: yCenter - span, max: yCenter + span, valid: true },
    };
}

function isLikelyCenterLabel(text) {
    if (typeof text !== 'string') return false;
    const t = text.toLowerCase();
    return t.includes('center') || t.includes('centroid');
}

function isLikelyRadiusLabel(text) {
    if (typeof text !== 'string') return false;
    const t = text.toLowerCase();
    return t.includes('radius') || t === 'r' || t.includes('r =');
}

function formatVarValue(varId, vars, context) {
    const raw = Number(vars?.[varId]);
    if (!Number.isFinite(raw)) return '';
    const step = Number(context?.varConfigById?.[varId]?.step ?? 1);
    return formatValue(raw, step);
}

function getPrimaryCircleMeta(vars, context) {
    const keys = Object.keys(vars).reduce((acc, key) => {
        acc[key.toLowerCase()] = key;
        return acc;
    }, {});
    const cxKey = keys.centerx || keys.h || keys.cx;
    const cyKey = keys.centery || keys.k || keys.cy;
    const rKey = keys.radius || keys.r;
    if (!rKey) return null;

    const rRaw = Number(vars[rKey]);
    if (!Number.isFinite(rRaw) || rRaw <= 0) return null;

    const cx = resolveCoord(cxKey || 0, 'x', vars, context);
    const cy = resolveCoord(cyKey || 0, 'y', vars, context);
    const r = resolveCoord(rKey, 'r', vars, context);
    return { cx, cy, r };
}

function normalizeToken(token) {
    if (typeof token !== 'string') return '';
    const trimmed = token.trim();
    if (trimmed.startsWith('=')) {
        const expr = trimmed.slice(1).trim();
        // If expression is just a variable identifier, treat it as variable token.
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(expr)) return expr;
        return '';
    }
    return trimmed;
}

function scaleFromVarToken(token, rawValue, axis, context) {
    const varToken = normalizeToken(token);
    if (!varToken) return rawValue;
    const cfg = context.varConfigById[varToken];
    if (!cfg) return rawValue;

    const axisDomain = axis === 'x'
        ? context.xDomain
        : axis === 'y'
            ? context.yDomain
            : null;
    const min = axisDomain ? Number(axisDomain.min) : Number(cfg.min);
    const max = axisDomain ? Number(axisDomain.max) : Number(cfg.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return rawValue;

    const t = (rawValue - min) / (max - min);
    const clampedT = clamp(t, 0, 1);
    const { width, height, padding } = context;

    if (axis === 'x') {
        return padding + clampedT * (width - 2 * padding);
    }
    if (axis === 'y') {
        // Math-like orientation: bigger y values appear higher.
        return height - padding - clampedT * (height - 2 * padding);
    }
    if (axis === 'r') {
        const idText = String(cfg.id || '').toLowerCase();
        const labelText = String(cfg.label || '').toLowerCase();
        const isTrueRadiusVar =
            idText === 'r' ||
            idText.includes('radius') ||
            labelText.includes('radius') ||
            labelText === 'r';

        // If this circle radius comes from a point-like variable (x1, y2, etc),
        // avoid giant bubbles: keep radius in a compact marker range.
        if (!isTrueRadiusVar) {
            const minMarkerR = 3;
            const maxMarkerR = 10;
            return minMarkerR + clampedT * (maxMarkerR - minMarkerR);
        }

        const minR = 8;
        const maxR = Math.max(16, Math.min(width, height) * 0.35);
        return minR + clampedT * (maxR - minR);
    }
    return rawValue;
}

function scaleFromGlobalDomain(rawValue, axis, context) {
    const domain = axis === 'x'
        ? context.xDomain
        : axis === 'y'
            ? context.yDomain
            : context.globalDomain;
    if (!domain?.valid) return rawValue;
    const min = domain.min;
    const max = domain.max;
    if (!(Number.isFinite(rawValue) && Number.isFinite(min) && Number.isFinite(max) && max > min)) {
        return rawValue;
    }
    // Always clamp into the visible domain so slider extremes can't push visuals off-canvas.
    const clampedRaw = clamp(rawValue, min, max);
    const t = (clampedRaw - min) / (max - min);
    const clampedT = clamp(t, 0, 1);
    const { width, height, padding } = context;

    if (axis === 'x') {
        return padding + clampedT * (width - 2 * padding);
    }
    if (axis === 'y') {
        return height - padding - clampedT * (height - 2 * padding);
    }
    // Do not globally scale circle radii because many plans use circles as point markers.
    if (axis === 'r') return rawValue;
    return rawValue;
}

function resolveCoord(expr, axis, vars, context) {
    const raw = evaluateExpression(expr, vars);
    const scaledByToken = scaleFromVarToken(expr, raw, axis, context);
    if (scaledByToken !== raw) return scaledByToken;
    return scaleFromGlobalDomain(raw, axis, context);
}

function createGridElements(context) {
    const { width, height, padding, xDomain, yDomain } = context;
    const elements = [];
    if (!xDomain?.valid || !yDomain?.valid) return elements;

    const plotW = Math.max(40, width - 2 * padding);
    const plotH = Math.max(40, height - 2 * padding);
    const worldToX = (worldX) => {
        const t = (worldX - xDomain.min) / (xDomain.max - xDomain.min);
        return padding + clamp(t, 0, 1) * plotW;
    };
    const worldToY = (worldY) => {
        const t = (worldY - yDomain.min) / (yDomain.max - yDomain.min);
        return height - (padding + clamp(t, 0, 1) * plotH);
    };

    const xStart = Math.ceil(xDomain.min);
    const xEnd = Math.floor(xDomain.max);
    const yStart = Math.ceil(yDomain.min);
    const yEnd = Math.floor(yDomain.max);

    // Draw 1-unit grid lines, but cap density to avoid visual noise for very large ranges.
    const maxLinesPerAxis = 80;
    const xLineCount = Math.max(0, xEnd - xStart + 1);
    const yLineCount = Math.max(0, yEnd - yStart + 1);
    const xStep = xLineCount > maxLinesPerAxis ? Math.ceil(xLineCount / maxLinesPerAxis) : 1;
    const yStep = yLineCount > maxLinesPerAxis ? Math.ceil(yLineCount / maxLinesPerAxis) : 1;

    for (let gx = xStart; gx <= xEnd; gx += xStep) {
        const x = worldToX(gx);
        elements.push(
            <line
                key={`grid-v-${gx}`}
                x1={x}
                y1={padding}
                x2={x}
                y2={height - padding}
                stroke="rgba(31,41,51,0.10)"
                strokeWidth="1"
            />
        );
    }

    for (let gy = yStart; gy <= yEnd; gy += yStep) {
        const y = worldToY(gy);
        elements.push(
            <line
                key={`grid-h-${gy}`}
                x1={padding}
                y1={y}
                x2={width - padding}
                y2={y}
                stroke="rgba(31,41,51,0.10)"
                strokeWidth="1"
            />
        );
    }

    const axisX = worldToX(0);
    const axisY = worldToY(0);

    elements.push(
        <line
            key="grid-axis-y"
            x1={axisX}
            y1={padding}
            x2={axisX}
            y2={height - padding}
            stroke="rgba(31,41,51,0.35)"
            strokeWidth="1.5"
        />
    );
    elements.push(
        <line
            key="grid-axis-x"
            x1={padding}
            y1={axisY}
            x2={width - padding}
            y2={axisY}
            stroke="rgba(31,41,51,0.35)"
            strokeWidth="1.5"
        />
    );

    return elements;
}

function renderElement(element, vars, context) {
    const type = element?.type;
    if (!type) return null;

    if (type === 'line' || type === 'arrow') {
        // Support both {x,y,x2,y2} and the more common {x1,y1,x2,y2}.
        const x1 = resolveCoord(element.x ?? element.x1, 'x', vars, context);
        const y1 = resolveCoord(element.y ?? element.y1, 'y', vars, context);
        const x2 = resolveCoord(element.x2, 'x', vars, context);
        const y2 = resolveCoord(element.y2, 'y', vars, context);
        const stroke = toColor(element.stroke, '#252525');
        const strokeWidth = evaluateExpression(element.strokeWidth ?? 2, vars);
        const opacity = evaluateExpression(element.opacity ?? 1, vars);
        return (
            <line
                key={element.id}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={stroke}
                strokeWidth={strokeWidth}
                opacity={opacity}
                markerEnd={type === 'arrow' ? 'url(#artifact-arrowhead)' : undefined}
            />
        );
    }

    if (type === 'polyline' || type === 'polygon' || type === 'triangle') {
        // Accept points as either:
        // - element.points: [{x,y}, ...]
        // - element.points: "x,y x,y ..."
        // - triangle aliases: {x1,y1,x2,y2,x3,y3}
        let points = [];
        if (Array.isArray(element.points)) {
            points = element.points;
        } else if (typeof element.points === 'string') {
            points = element.points
                .split(/\s+/)
                .map((pair) => pair.split(','))
                .filter((xy) => xy.length === 2)
                .map(([x, y]) => ({ x, y }));
        } else if (type === 'triangle') {
            points = [
                { x: element.x1, y: element.y1 },
                { x: element.x2, y: element.y2 },
                { x: element.x3, y: element.y3 },
            ].filter((p) => p.x !== undefined && p.y !== undefined);
        }

        if (points.length < 2) return null;

        const mapped = points
            .map((p) => {
                const x = resolveCoord(p.x, 'x', vars, context);
                const y = resolveCoord(p.y, 'y', vars, context);
                return `${x},${y}`;
            })
            .join(' ');

        const stroke = toColor(element.stroke, '#252525');
        const strokeWidth = evaluateExpression(element.strokeWidth ?? 2, vars);
        const opacity = evaluateExpression(element.opacity ?? 1, vars);
        const fill = type === 'polygon' ? toColor(element.fill, 'transparent') : 'transparent';

        if (type === 'polygon') {
            return (
                <polygon
                    key={element.id}
                    points={mapped}
                    stroke={stroke}
                    strokeWidth={strokeWidth}
                    fill={fill}
                    opacity={opacity}
                />
            );
        }

        return (
            <polyline
                key={element.id}
                points={mapped}
                stroke={stroke}
                strokeWidth={strokeWidth}
                fill="transparent"
                opacity={opacity}
            />
        );
    }

    if (type === 'circle') {
        const cx = resolveCoord(element.x, 'x', vars, context);
        const cy = resolveCoord(element.y, 'y', vars, context);
        const r = resolveCoord(element.r, 'r', vars, context);
        const areaStyle = getAreaStyle(element, 'circle', vars);
        return (
            <circle
                key={element.id}
                cx={cx}
                cy={cy}
                r={r}
                stroke={areaStyle.stroke}
                fill={areaStyle.fill}
                strokeWidth={areaStyle.strokeWidth}
                opacity={evaluateExpression(element.opacity ?? 1, vars)}
            />
        );
    }

    if (type === 'rect') {
        const x = resolveCoord(element.x, 'x', vars, context);
        const y = resolveCoord(element.y, 'y', vars, context);
        const width = evaluateExpression(element.width, vars);
        const height = evaluateExpression(element.height, vars);
        const areaStyle = getAreaStyle(element, 'rect', vars);
        return (
            <rect
                key={element.id}
                x={x}
                y={y}
                width={width}
                height={height}
                stroke={areaStyle.stroke}
                fill={areaStyle.fill}
                strokeWidth={areaStyle.strokeWidth}
                opacity={evaluateExpression(element.opacity ?? 1, vars)}
            />
        );
    }

    if (type === 'text') {
        let x = resolveCoord(element.x, 'x', vars, context);
        let y = resolveCoord(element.y, 'y', vars, context);
        // SVG <text> can't render LaTeX, so strip it down to readable plain text.
        let text = latexToPlainText(interpolateTemplate(element.text || '', vars));

        // Heuristic: if this is a center label and we have a circle, place label outside the circle.
        if (isLikelyCenterLabel(text)) {
            const circle = getPrimaryCircleMeta(vars, context);
            if (circle) {
                x = circle.cx + circle.r + 10;
                y = circle.cy - 2;

                // Prefer showing the live numeric center when possible.
                const keys = Object.keys(vars).reduce((acc, key) => {
                    acc[key.toLowerCase()] = key;
                    return acc;
                }, {});
                const hKey = keys.h || keys.centerx || keys.cx;
                const kKey = keys.k || keys.centery || keys.cy;
                const hVal = hKey ? formatVarValue(hKey, vars, context) : '';
                const kVal = kKey ? formatVarValue(kKey, vars, context) : '';
                if (hVal !== '' && kVal !== '') {
                    text = `Center (${hVal}, ${kVal})`;
                }
            }
        }

        if (isLikelyRadiusLabel(text)) {
            const keys = Object.keys(vars).reduce((acc, key) => {
                acc[key.toLowerCase()] = key;
                return acc;
            }, {});
            const rKey = keys.r || keys.radius;
            const rVal = rKey ? formatVarValue(rKey, vars, context) : '';
            if (rVal !== '') {
                text = `Radius ${rVal}`;
            }
        }
        const segments = parseLabelSegments(text);
        return (
            <text
                key={element.id}
                x={x}
                y={y}
                fill={toColor(element.fill, '#334e68')}
                fontSize={evaluateExpression(element.fontSize ?? 12, vars)}
                opacity={evaluateExpression(element.opacity ?? 1, vars)}
            >
                {segments.length === 0
                    ? text
                    : segments.map((seg, idx) => (
                          seg.kind === 'base'
                              ? <tspan key={idx}>{seg.text}</tspan>
                              : (
                                    <tspan
                                        key={idx}
                                        baselineShift={seg.kind === 'sub' ? 'sub' : 'super'}
                                        fontSize="0.75em"
                                    >
                                        {seg.text}
                                    </tspan>
                                )
                      ))}
            </text>
        );
    }

    return null;
}

export default function ArtifactRenderer({ decision }) {
    const validDecision = isValidDecision(decision);
    const artifactEnabled = validDecision && Boolean(decision.enable_interactive_artifact);
    const plan = artifactEnabled && decision.artifact_plan && typeof decision.artifact_plan === 'object'
        ? decision.artifact_plan
        : null;

    const varsConfig = useMemo(() => {
        const raw = Array.isArray(plan?.variables) ? plan.variables : [];
        const planKey = plan?.title || 'artifact';
        // Normalize min/max/step up front so every downstream consumer
        // (init, sliders, domain inference) sees nice, uniform numbers.
        // Seed the starting-offset per (plan, variable id) so it's stable
        // across re-renders but varies between variables and problems.
        return raw.map((v) => ({
            ...v,
            ...autoSliderConfig(v, `${planKey}:${v?.id || ''}`),
        }));
    }, [plan]);
    const initialVariables = useMemo(() => {
        const initial = {};
        varsConfig.forEach((v) => {
            if (!v?.id) return;
            const min = Number(v.min ?? 0);
            const max = Number(v.max ?? 10);
            const fallback = Number.isFinite(min) ? min : 0;
            const value = Number(v.defaultValue ?? fallback);
            initial[v.id] = clamp(
                Number.isFinite(value) ? value : fallback,
                Number.isFinite(min) ? min : 0,
                Number.isFinite(max) ? max : 10
            );
        });
        return initial;
    }, [varsConfig]);

    const [variables, setVariables] = useState(() => initialVariables);

    // When a new artifact plan arrives, re-init variables so the canvas and sliders match.
    // This prevents the “starts at -5 but drawing at 0 until you drag” jump.
    useEffect(() => {
        setVariables(initialVariables);
    }, [initialVariables]);

    const canvas = plan?.canvas && typeof plan.canvas === 'object' ? plan.canvas : {};
    const width = Number(canvas.width ?? 380) || 380;
    const height = Number(canvas.height ?? 220) || 220;

    const elements = useMemo(
        () => (Array.isArray(plan?.elements) ? plan.elements : []),
        [plan]
    );
    const formulas = Array.isArray(plan?.formulas) ? plan.formulas : [];
    const varConfigById = useMemo(() => getVarConfigById(varsConfig), [varsConfig]);
    const globalDomain = useMemo(() => getGlobalDomain(varsConfig), [varsConfig]);
    const fittedCircleDomain = useMemo(
        () => inferCircleDomainFromConfig(varsConfig, variables),
        [varsConfig, variables]
    );
    const axisVarNames = useMemo(() => inferAxisVarNames(elements), [elements]);
    const xDomain = useMemo(
        () => fittedCircleDomain?.xDomain
            || domainFromVarNames(varsConfig, axisVarNames.xVars)
            || getAxisDomain(varsConfig, 'x', globalDomain),
        [fittedCircleDomain, varsConfig, axisVarNames, globalDomain]
    );
    const yDomain = useMemo(
        () => fittedCircleDomain?.yDomain
            || domainFromVarNames(varsConfig, axisVarNames.yVars)
            || getAxisDomain(varsConfig, 'y', globalDomain),
        [fittedCircleDomain, varsConfig, axisVarNames, globalDomain]
    );
    const renderContext = useMemo(() => ({
        width,
        height,
        padding: 20,
        varConfigById,
        globalDomain,
        xDomain,
        yDomain,
    }), [width, height, varConfigById, globalDomain, xDomain, yDomain]);
    const gridElements = useMemo(() => createGridElements(renderContext), [renderContext]);

    const renderedElements = useMemo(
        () => elements.map((element) => renderElement(element, variables, renderContext)).filter(Boolean),
        [elements, variables, renderContext]
    );

    const fallbackDistanceElements = useMemo(() => {
        const lowerKeys = Object.keys(variables).reduce((acc, key) => {
            acc[key.toLowerCase()] = key;
            return acc;
        }, {});

        const x1Key = lowerKeys.x1;
        const y1Key = lowerKeys.y1;
        const x2Key = lowerKeys.x2;
        const y2Key = lowerKeys.y2;
        if (!x1Key || !y1Key || !x2Key || !y2Key) return [];

        const x1 = Number(variables[x1Key]);
        const y1 = Number(variables[y1Key]);
        const x2 = Number(variables[x2Key]);
        const y2 = Number(variables[y2Key]);
        if (![x1, y1, x2, y2].every(Number.isFinite)) return [];

        const minX = Math.min(x1, x2);
        const maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2);
        const maxY = Math.max(y1, y2);
        const rangeX = Math.max(1, maxX - minX);
        const rangeY = Math.max(1, maxY - minY);

        const padding = 24;
        const plotW = Math.max(40, width - 2 * padding);
        const plotH = Math.max(40, height - 2 * padding);

        const sx = (x) => padding + ((x - minX) / rangeX) * plotW;
        // Invert y so higher values appear higher on screen.
        const sy = (y) => height - padding - ((y - minY) / rangeY) * plotH;

        const px1 = sx(x1);
        const py1 = sy(y1);
        const px2 = sx(x2);
        const py2 = sy(y2);
        const distance = Math.hypot(x2 - x1, y2 - y1);

        return [
            <line key="fb-axis-x" x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="rgba(31,41,51,0.25)" strokeWidth="1.5" />,
            <line key="fb-axis-y" x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="rgba(31,41,51,0.25)" strokeWidth="1.5" />,
            <line key="fb-segment" x1={px1} y1={py1} x2={px2} y2={py2} stroke="#0C74E8" strokeWidth="3" />,
            <circle key="fb-p1" cx={px1} cy={py1} r="4.5" fill="#1f2933" />,
            <circle key="fb-p2" cx={px2} cy={py2} r="4.5" fill="#1f2933" />,
            <text key="fb-t1" x={px1 + 8} y={py1 - 8} fontSize="12" fill="#334e68">{`P1(${x1}, ${y1})`}</text>,
            <text key="fb-t2" x={px2 + 8} y={py2 - 8} fontSize="12" fill="#334e68">{`P2(${x2}, ${y2})`}</text>,
            <text key="fb-dist" x={(px1 + px2) / 2 + 8} y={(py1 + py2) / 2 - 10} fontSize="12" fill="#0C74E8">{`d ≈ ${distance.toFixed(2)}`}</text>,
        ];
    }, [variables, width, height]);

    const fallbackCircleElements = useMemo(() => {
        const lowerKeys = Object.keys(variables).reduce((acc, key) => {
            acc[key.toLowerCase()] = key;
            return acc;
        }, {});

        const centerXKey = lowerKeys.centerx || lowerKeys.h || lowerKeys.cx;
        const centerYKey = lowerKeys.centery || lowerKeys.k || lowerKeys.cy;
        const radiusKey = lowerKeys.radius || lowerKeys.r;
        if (!radiusKey) return [];

        const radiusValue = Number(variables[radiusKey]);
        if (!Number.isFinite(radiusValue) || radiusValue <= 0) return [];

        const rawCenterX = centerXKey ? Number(variables[centerXKey]) : 0;
        const rawCenterY = centerYKey ? Number(variables[centerYKey]) : 0;
        const centerXVal = Number.isFinite(rawCenterX) ? rawCenterX : 0;
        const centerYVal = Number.isFinite(rawCenterY) ? rawCenterY : 0;

        const maxR = Math.max(1, Math.abs(radiusValue));
        const pad = 28;
        const plotW = Math.max(40, width - 2 * pad);
        const plotH = Math.max(40, height - 2 * pad);
        const radiusPx = Math.min(plotW, plotH) * 0.28;

        const cx = pad + plotW * 0.5 + (centerXVal / (maxR * 2)) * (plotW * 0.35);
        const cy = pad + plotH * 0.5 - (centerYVal / (maxR * 2)) * (plotH * 0.35);

        return [
            <line key="fc-axis-x" x1={pad} y1={pad + plotH * 0.5} x2={width - pad} y2={pad + plotH * 0.5} stroke="rgba(31,41,51,0.2)" strokeWidth="1.25" />,
            <line key="fc-axis-y" x1={pad + plotW * 0.5} y1={pad} x2={pad + plotW * 0.5} y2={height - pad} stroke="rgba(31,41,51,0.2)" strokeWidth="1.25" />,
            <circle key="fc-circle" cx={cx} cy={cy} r={radiusPx} stroke="#0C74E8" fill="rgba(12,116,232,0.10)" strokeWidth="3" />,
            <circle key="fc-center" cx={cx} cy={cy} r="3.5" fill="#1f2933" />,
            <line key="fc-radius" x1={cx} y1={cy} x2={cx + radiusPx} y2={cy} stroke="#252525" strokeWidth="2.5" />,
            <text key="fc-center-label" x={cx + 8} y={cy - 8} fontSize="12" fill="#334e68">{`Center (${centerXVal}, ${centerYVal})`}</text>,
            <text key="fc-radius-label" x={cx + radiusPx / 2} y={cy - 10} textAnchor="middle" fontSize="12" fill="#334e68">{`r = ${radiusValue}`}</text>,
        ];
    }, [variables, width, height]);

    React.useEffect(() => {
        debugLog('renderer:decision', {
            validDecision,
            artifactEnabled,
            hasPlan: !!plan,
            title: plan?.title,
            varsConfigCount: varsConfig.length,
            varsKeys: Object.keys(variables || {}),
            xDomain,
            yDomain,
            elementsCount: elements.length,
            renderedElementsCount: renderedElements.length,
            fallbackDistanceCount: fallbackDistanceElements.length,
            fallbackCircleCount: fallbackCircleElements.length,
            gridElementsCount: gridElements.length,
            formulasCount: formulas.length
        });
    }, [
        validDecision,
        artifactEnabled,
        plan,
        varsConfig.length,
        variables,
        xDomain,
        yDomain,
        elements.length,
        renderedElements.length,
        fallbackDistanceElements.length,
        fallbackCircleElements.length,
        gridElements.length,
        formulas.length
    ]);

    if (!plan) return null;

    const cardStyle = {
        marginTop: 12,
        borderRadius: 12,
        overflow: 'hidden',
        background: 'rgba(255,255,255,0.8)',
        border: '1px solid rgba(0,0,0,0.06)',
        backdropFilter: 'blur(6px)',
    };

    const sliderRowStyle = {
        display: 'grid',
        gridTemplateColumns: '32px 48px 1fr',
        alignItems: 'center',
        gap: 8,
        padding: '2px 0',
    };

    return (
        <div style={cardStyle}>
            {/* ── Canvas ── */}
            <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 16px 8px' }}>
                <svg
                    width={width}
                    height={height}
                    viewBox={`0 0 ${width} ${height}`}
                    style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
                >
                    <defs>
                        {/*
                          One shared arrowhead for all `arrow` elements. `fill="context-stroke"`
                          (SVG 2, Chrome 114+/Firefox/Safari) inherits the colour from the line
                          using the marker, so each arrow's head matches its stroke. On older
                          browsers the fallback renders the arrowhead in the default color.
                        */}
                        <marker
                            id="artifact-arrowhead"
                            viewBox="0 0 10 10"
                            refX="9"
                            refY="5"
                            markerWidth="6"
                            markerHeight="6"
                            orient="auto-start-reverse"
                            markerUnits="strokeWidth"
                        >
                            <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
                        </marker>
                    </defs>
                    {gridElements}
                    {(elements.length > 0)
                        ? renderedElements
                        : (fallbackDistanceElements.length > 0 ? fallbackDistanceElements : fallbackCircleElements)}
                </svg>
            </div>

            {/* ── Sliders ── */}
            {varsConfig.length > 0 && (
                <div style={{ padding: '4px 16px 8px' }}>
                    {varsConfig.map((v) => {
                        const id = v.id;
                        if (!id) return null;
                        const min = Number(v.min ?? 0);
                        const max = Number(v.max ?? 10);
                        const step = Number(v.step ?? 1);
                        const value = Number(variables[id] ?? min);
                        return (
                            <div key={id} style={sliderRowStyle}>
                                <span
                                    title={v.label || id}
                                    style={{ color: '#334e68', fontStyle: 'italic', fontSize: 14, fontWeight: 500, textAlign: 'right' }}
                                >
                                    {id}
                                </span>
                                <span style={{ color: '#52606d', fontSize: 13, fontFamily: 'monospace', textAlign: 'right' }}>
                                    {formatValue(value, step)}
                                </span>
                                <Slider
                                    value={value}
                                    min={min}
                                    max={max}
                                    step={step}
                                    onChange={(_event, next) => {
                                        const nextValue = Array.isArray(next) ? next[0] : next;
                                        setVariables((prev) => ({ ...prev, [id]: clamp(Number(nextValue), min, max) }));
                                    }}
                                    style={{ color: '#667eea' }}
                                />
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── Formulas ── */}
            {formulas.length > 0 && (
                <div style={{ padding: '4px 16px 14px' }}>
                    {formulas.map((formula) => (
                        <ArtifactMarkdown
                            key={formula.id || formula.latex}
                            content={appendObviousResult(
                                normalizeLatexSigns(interpolateTemplate(formula.latex || '', variables)),
                                formula,
                                variables,
                            )}
                            style={{ color: '#52606d', fontSize: 14 }}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function safeEvalExpression(exprString, vars) {
    if (typeof exprString !== 'string') return null;
    const body = exprString.trim().replace(/^=/, '');
    if (!body) return null;
    try {
        // eslint-disable-next-line no-new-func
        const fn = new Function(
            'vars', 'Math',
            'sqrt', 'abs', 'sin', 'cos', 'tan', 'log', 'exp', 'pow', 'min', 'max', 'PI',
            `with (vars) { return (${body}); }`
        );
        const result = Number(fn(
            vars || {}, Math,
            Math.sqrt, Math.abs, Math.sin, Math.cos, Math.tan,
            Math.log, Math.exp, Math.pow, Math.min, Math.max, Math.PI,
        ));
        return Number.isFinite(result) ? result : null;
    } catch (_e) {
        return null;
    }
}

function appendObviousResult(latex, formula, vars) {
    if (typeof latex !== 'string') return '';
    if (latex.includes('\\approx') || latex.includes('\\simeq')) return latex;

    // Primary path: model-provided evaluable expression.
    if (formula && typeof formula.expr === 'string' && formula.expr.trim()) {
        const val = safeEvalExpression(formula.expr, vars);
        if (val !== null) {
            const rounded = Math.round(val * 100) / 100;
            return `${latex} \\approx ${rounded}`;
        }
    }

    // Fallback: numeric sqrt of sum-of-squares pattern (legacy plans without expr).
    if (latex.includes('=') && /\\sqrt\s*\{/.test(latex) && /\d/.test(latex)) {
        const m = latex.match(/\\sqrt\s*\{\s*([0-9.]+)\s*\^\s*2\s*\+\s*([0-9.]+)\s*\^\s*2\s*\}/);
        if (m) {
            const a = Number(m[1]);
            const b = Number(m[2]);
            if (Number.isFinite(a) && Number.isFinite(b)) {
                const val = Math.sqrt(a * a + b * b);
                const rounded = Math.round(val * 100) / 100;
                return `${latex} \\approx ${rounded}`;
            }
        }
    }
    return latex;
}

