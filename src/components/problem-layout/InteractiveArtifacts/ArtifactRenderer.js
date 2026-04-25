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
        // Inject bare Math helpers (sqrt, cos, sin, …) in addition to `Math.*`
        // so LLM-friendly expressions like `cos(t)` or `sqrt(F1*F1+F2*F2)`
        // evaluate consistently everywhere — coord fields, function-plot
        // expressions, and formula exprs.
        // eslint-disable-next-line no-new-func
        const fn = new Function(
            'vars', 'Math',
            'sqrt', 'abs', 'sin', 'cos', 'tan', 'log', 'exp', 'pow', 'min', 'max', 'PI', 'E',
            `with (vars) { return (${body}); }`
        );
        const result = fn(
            vars, Math,
            Math.sqrt, Math.abs, Math.sin, Math.cos, Math.tan,
            Math.log, Math.exp, Math.pow, Math.min, Math.max, Math.PI, Math.E,
        );
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

// How many decimal places the number is written with. Capped so that
// a pathological default like 2.71828182 doesn't give us millions of ticks.
function getDecimalPlaces(n) {
    if (!Number.isFinite(n)) return 0;
    const s = String(n);
    const dot = s.indexOf('.');
    if (dot === -1) return 0;
    return Math.min(s.length - dot - 1, 3);
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
    // Magnitude is based ONLY on the default (the true answer). We deliberately
    // ignore the LLM's min/max because it often picks absurdly wide ranges.
    const magnitude = Math.abs(anchor) > 0
        ? Math.abs(anchor)
        : 1;
    // Two competing constraints:
    //   - niceStep: target ~50 ticks across the range so dragging feels natural.
    //   - resolution: the decimal precision of the default itself, so the slider
    //     can actually land on the answer (e.g. 26.4 needs step ≤ 0.1).
    // We take the SMALLER of the two so the answer is always expressible.
    const niceStep = niceNumber(magnitude / 50);
    const resolution = Math.pow(10, -getDecimalPlaces(anchor));
    const step = Math.min(niceStep, resolution);
    // Span is still derived from the ~50-tick target so the exploration range
    // doesn't collapse when we shrink the step for precision reasons.
    const halfSpan = Math.max(niceStep * 25, resolution * 25);
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

// Tokens that should be treated as built-ins, not user sliders, when scanning
// expressions for variable references.
const EXPRESSION_RESERVED_TOKENS = new Set([
    'Math', 'PI', 'E', 'sqrt', 'abs', 'sin', 'cos', 'tan', 'log', 'exp',
    'pow', 'min', 'max', 'true', 'false', 'null', 'undefined',
]);

// Extract the user-defined slider tokens referenced inside an expression.
function collectVarTokens(expr, byId) {
    if (typeof expr !== 'string') return [];
    const body = expr.trim().replace(/^=/, '').trim();
    const matches = body.match(/[A-Za-z_][A-Za-z0-9_]*/g);
    if (!matches) return [];
    const set = new Set();
    matches.forEach((t) => {
        if (EXPRESSION_RESERVED_TOKENS.has(t)) return;
        if (byId[t]) set.add(t);
    });
    return Array.from(set);
}

// Compute the set of numeric values an expression can take across the slider
// space. Works for literals, bare variables, and compound expressions alike —
// evaluates at every (min, max) corner of the referenced sliders.
function extentsOfExpr(expr, byId) {
    if (expr === undefined || expr === null) return [];
    if (typeof expr === 'number' && Number.isFinite(expr)) return [expr];
    if (typeof expr !== 'string') return [];
    const trimmed = expr.trim().replace(/^=/, '').trim();
    if (!trimmed) return [];
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) return [asNumber];

    const tokens = collectVarTokens(expr, byId);
    if (tokens.length === 0) return [];
    if (tokens.length > 4) return []; // cap combinatorial explosion

    const values = [];
    const combos = 1 << tokens.length;
    for (let mask = 0; mask < combos; mask += 1) {
        const scope = {};
        tokens.forEach((t, i) => {
            const cfg = byId[t];
            scope[t] = (mask & (1 << i)) ? Number(cfg.max) : Number(cfg.min);
        });
        const result = evaluateExpression(expr, scope);
        if (Number.isFinite(result)) values.push(result);
    }
    return values;
}

// Modest default domain when a scene has no coord content. Intentionally NOT
// derived from slider ranges, which can pollute an axis with unrelated
// variables (e.g. a `mass` slider stretching the y-axis).
const DEFAULT_DOMAIN = { min: -1, max: 1, valid: true };

// Clamp the number of corners we evaluate for a function element. 2^4=16
// combinations × samples is acceptable; more would be combinatorial.
const MAX_FN_SCAN_TOKENS = 4;

// Sample a function element across its independent variable × every combo of
// referenced slider extremes, pushing the resulting (x, y) pairs into the
// running domain buckets. Keeps the axis domain wide enough that the full
// curve (including its peaks/troughs) fits the canvas.
function pushFunctionElementExtents(el, byId, xVals, yVals) {
    const SCAN_SAMPLES = 12;
    const evalAtCorners = (expr, extraScopeBuilder, onValue) => {
        const tokens = collectVarTokens(expr, byId);
        const limited = tokens.length > MAX_FN_SCAN_TOKENS ? [] : tokens;
        const combos = 1 << limited.length;
        for (let mask = 0; mask < Math.max(1, combos); mask += 1) {
            const sliderScope = {};
            limited.forEach((t, i) => {
                const cfg = byId[t];
                sliderScope[t] = (mask & (1 << i))
                    ? Number(cfg?.max)
                    : Number(cfg?.min);
            });
            for (let i = 0; i < SCAN_SAMPLES; i += 1) {
                const extra = extraScopeBuilder(i / (SCAN_SAMPLES - 1));
                const value = evaluateExpression(expr, { ...sliderScope, ...extra });
                if (Number.isFinite(value)) onValue(value, extra);
            }
        }
    };

    if (typeof el.fnX === 'string' && typeof el.fnY === 'string') {
        const tMinCandidates = extentsOfExpr(el.tMin ?? 0, byId);
        const tMaxCandidates = extentsOfExpr(el.tMax ?? 1, byId);
        const tMinVal = tMinCandidates.length ? Math.min(...tMinCandidates) : 0;
        const tMaxVal = tMaxCandidates.length ? Math.max(...tMaxCandidates) : 1;
        const buildTScope = (u) => ({ t: tMinVal + (tMaxVal - tMinVal) * u });
        evalAtCorners(el.fnX, buildTScope, (v) => xVals.push(v));
        evalAtCorners(el.fnY, buildTScope, (v) => yVals.push(v));
        return;
    }
    if (typeof el.fn === 'string') {
        const xMinCandidates = extentsOfExpr(el.xMin ?? -5, byId);
        const xMaxCandidates = extentsOfExpr(el.xMax ?? 5, byId);
        const xMinVal = xMinCandidates.length ? Math.min(...xMinCandidates) : -5;
        const xMaxVal = xMaxCandidates.length ? Math.max(...xMaxCandidates) : 5;
        xVals.push(xMinVal, xMaxVal);
        const buildXScope = (u) => ({ x: xMinVal + (xMaxVal - xMinVal) * u });
        evalAtCorners(el.fn, buildXScope, (v, scope) => {
            yVals.push(v);
            if (Number.isFinite(scope.x)) xVals.push(scope.x);
        });
    }
}

// Walk every element and every coordinate field, compute the true reachable
// min/max of each axis across the entire slider space. Handles literals
// (`cy: 0`), bare variables (`cx: "=d1"`), negations (`cx: "=-d1"`), and
// compound expressions (`cx: "=d1 + d2"`) uniformly.
function inferAxisDomainsFromElements(elements, varsConfig) {
    const byId = {};
    varsConfig.forEach((c) => { if (c?.id) byId[c.id] = c; });
    const xKeys = ['x', 'x1', 'x2', 'x3', 'cx'];
    const yKeys = ['y', 'y1', 'y2', 'y3', 'cy'];
    const xVals = [0];
    const yVals = [0];

    (Array.isArray(elements) ? elements : []).forEach((el) => {
        if (!el) return;
        xKeys.forEach((k) => xVals.push(...extentsOfExpr(el[k], byId)));
        yKeys.forEach((k) => yVals.push(...extentsOfExpr(el[k], byId)));
        if (Array.isArray(el.points)) {
            el.points.forEach((p) => {
                if (!p) return;
                xVals.push(...extentsOfExpr(p.x, byId));
                yVals.push(...extentsOfExpr(p.y, byId));
            });
        }
        // For function elements, sample the curve across the sampling
        // variable's range × every combination of referenced slider extremes,
        // so the domain covers the full traced curve (not just its endpoints).
        if (el.type === 'function') {
            pushFunctionElementExtents(el, byId, xVals, yVals);
        }
    });

    const toRange = (arr) => {
        const filtered = arr.filter((v) => Number.isFinite(v));
        if (filtered.length <= 1) return null; // only the origin anchor
        const mn = Math.min(...filtered);
        const mx = Math.max(...filtered);
        if (!(mx > mn)) return null;
        return { min: mn, max: mx, valid: true };
    };

    return { xDomain: toRange(xVals), yDomain: toRange(yVals) };
}

// Inflate an axis domain so the largest pixel-space element in the scene can
// be drawn at any slider position (including the extremes) without clipping
// the SVG edge — AND so the grid can safely fill the entire SVG (no wasted
// whitespace padding around the plot).
//
// Derivation: the domain becomes [min - m, max + m]. When a slider hits its
// max, its position maps to pixel `(span + m)/(span + 2m) * axisSize`. The
// distance from that pixel to the SVG edge is `m/(span + 2m) * axisSize`,
// which must be ≥ pixelExtent + safetyPx. Solving for m:
//     m ≥ k * span / (1 - 2k),   where k = (pixelExtent + safetyPx) / axisSize.
// We also enforce a minimum visual breathing room (`minFraction`) so simple
// scenes still feel airy.
function padDomainForPixelExtent(domain, axisSize, pixelExtent, safetyPx = 4, minFraction = 0.2) {
    if (!domain || !Number.isFinite(domain.min) || !Number.isFinite(domain.max)) return domain;
    const span = domain.max - domain.min;
    if (!(span > 0)) return domain;

    let margin = span * minFraction;
    if (axisSize > 0 && pixelExtent > 0) {
        const k = (pixelExtent + safetyPx) / axisSize;
        if (k < 0.45) {
            const needed = (k * span) / (1 - 2 * k);
            if (needed > margin) margin = needed;
        } else {
            // Element is nearly as large as the axis. Can't avoid clipping
            // cleanly; at least reserve half the visible domain as margin.
            margin = Math.max(margin, span * 0.5);
        }
    }
    return { min: domain.min - margin, max: domain.max + margin, valid: true };
}

// Single source of truth for per-element-type pixel-space caps. Used both to
// compute the domain margin (so shapes don't clip the SVG edge) and to clamp
// the actual rendered size (so the renderer never exceeds its declared max).
// Keeping these aligned is what makes the bounds story self-consistent.
//
// Adding a new element type: add one entry. Both the margin math and the
// rendering clamp will pick it up automatically.
function circlePixelRadiusCap(width, height) {
    return Math.max(16, Math.min(width, height) * 0.35);
}

function pixelExtentForElement(el, width, height) {
    if (!el || typeof el.type !== 'string') return 0;
    switch (el.type) {
        case 'circle':
            return circlePixelRadiusCap(width, height);
        case 'arrow':
            // Arrowhead marker (strokeWidth * markerWidth). 6*2 default.
            return 12;
        case 'text': {
            // Approximate: font-size is the vertical extent; width depends on
            // string length (rough 0.6em per char).
            const fontSize = Number(el.fontSize) || 12;
            const textLen = typeof el.text === 'string' ? el.text.length : 0;
            return Math.max(fontSize, Math.min(textLen * fontSize * 0.6, 60));
        }
        default:
            return 0;
    }
}

// Compute the ACTUAL max rendered pixel radius for a circle, given how its `r`
// expression would be interpreted by the renderer. Critical distinction: the
// renderer has three code paths for circle radius —
//
//   1. Bare true-radius variable (`=r`, label="radius"): scaleFromVarToken
//      maps world value to pixel range [8, cap].
//   2. Bare non-radius variable (`=m1`): scaleFromVarToken maps to [3, 10]
//      (marker range — prevents huge circles from mass/misc sliders).
//   3. Literal number or compound expression: clamped to [2, cap] in pixels.
//
// Knowing the real max (not the theoretical cap) lets the domain margin stay
// tight, so scenes with small shapes fill more of the canvas.
function maxRenderedCirclePixelRadius(element, byId, cap) {
    const rExpr = element?.r;
    if (typeof rExpr === 'number' && Number.isFinite(rExpr)) {
        return clamp(Math.abs(rExpr), 2, cap);
    }
    if (typeof rExpr !== 'string') return cap;
    const trimmed = rExpr.trim();
    const body = trimmed.startsWith('=') ? trimmed.slice(1).trim() : trimmed;
    if (!body) return cap;
    const literal = Number(body);
    if (Number.isFinite(literal)) return clamp(Math.abs(literal), 2, cap);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(body)) {
        const cfg = byId[body];
        if (cfg) {
            const idLower = String(cfg.id).toLowerCase();
            const labelLower = String(cfg.label || '').toLowerCase();
            const isTrueRadius =
                idLower === 'r'
                || idLower.includes('radius')
                || labelLower.includes('radius')
                || labelLower === 'r';
            return isTrueRadius ? cap : 10;
        }
    }
    const extents = extentsOfExpr(rExpr, byId);
    if (extents.length === 0) return cap;
    const maxAbs = extents.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    return clamp(maxAbs, 2, cap);
}

// Max pixel-space extent across every element in the scene. Feeds the domain
// margin calculation so shapes never clip. Uses real rendered sizes (not
// type-level theoretical maxes) so simple scenes don't waste canvas space.
function computeMaxPixelExtent(elements, varsConfig, width, height) {
    const byId = {};
    (Array.isArray(varsConfig) ? varsConfig : []).forEach((c) => {
        if (c?.id) byId[c.id] = c;
    });
    const circleCap = circlePixelRadiusCap(width, height);
    let maxExtent = 0;
    (Array.isArray(elements) ? elements : []).forEach((el) => {
        if (!el) return;
        if (el.type === 'circle') {
            maxExtent = Math.max(maxExtent, maxRenderedCirclePixelRadius(el, byId, circleCap));
        } else {
            maxExtent = Math.max(maxExtent, pixelExtentForElement(el, width, height));
        }
    });
    return maxExtent;
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
            : null;
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

// Compute the pixel-space bounding box of an element at the current slider
// values. Used by `attach` on text labels so they follow whatever they label
// as sliders move. Returns null when the element type doesn't have a sensible
// box (e.g. text labels themselves, or function curves which are handled
// below with a simple midpoint approximation).
function getElementPxBox(el, vars, context) {
    if (!el || typeof el.type !== 'string') return null;
    switch (el.type) {
        case 'circle': {
            const cx = resolveCoord(el.x, 'x', vars, context);
            const cy = resolveCoord(el.y, 'y', vars, context);
            const rawR = resolveCoord(el.r, 'r', vars, context);
            const r = clamp(
                Number.isFinite(rawR) ? rawR : 0,
                2,
                circlePixelRadiusCap(context.width, context.height),
            );
            return { minX: cx - r, maxX: cx + r, minY: cy - r, maxY: cy + r };
        }
        case 'line':
        case 'arrow': {
            const x1 = resolveCoord(el.x ?? el.x1, 'x', vars, context);
            const y1 = resolveCoord(el.y ?? el.y1, 'y', vars, context);
            const x2 = resolveCoord(el.x2, 'x', vars, context);
            const y2 = resolveCoord(el.y2, 'y', vars, context);
            return {
                minX: Math.min(x1, x2),
                maxX: Math.max(x1, x2),
                minY: Math.min(y1, y2),
                maxY: Math.max(y1, y2),
            };
        }
        case 'rect': {
            // Note: rect width/height are already in pixel space (evaluateExpression
            // passes them straight to <rect>), so the bbox math mirrors the render.
            const x = resolveCoord(el.x, 'x', vars, context);
            const y = resolveCoord(el.y, 'y', vars, context);
            const w = evaluateExpression(el.width, vars);
            const h = evaluateExpression(el.height, vars);
            return { minX: x, maxX: x + w, minY: y, maxY: y + h };
        }
        case 'polyline':
        case 'polygon': {
            const points = Array.isArray(el.points) ? el.points : [];
            if (points.length === 0) return null;
            const xs = points.map((p) => resolveCoord(p?.x, 'x', vars, context));
            const ys = points.map((p) => resolveCoord(p?.y, 'y', vars, context));
            return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
        }
        case 'triangle': {
            const pts = [
                { x: el.x1, y: el.y1 },
                { x: el.x2, y: el.y2 },
                { x: el.x3, y: el.y3 },
            ].filter((p) => p.x !== undefined && p.y !== undefined);
            if (pts.length === 0) return null;
            const xs = pts.map((p) => resolveCoord(p.x, 'x', vars, context));
            const ys = pts.map((p) => resolveCoord(p.y, 'y', vars, context));
            return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
        }
        default:
            return null;
    }
}

// Pick a point on a bbox given a named side. SVG y grows downward, so "top"
// is minY and "bottom" is maxY.
function anchorFromBox(box, side) {
    if (!box) return null;
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    switch (side) {
        case 'left':        return { x: box.minX, y: cy };
        case 'right':       return { x: box.maxX, y: cy };
        case 'top':         return { x: cx,       y: box.minY };
        case 'bottom':      return { x: cx,       y: box.maxY };
        case 'topLeft':     return { x: box.minX, y: box.minY };
        case 'topRight':    return { x: box.maxX, y: box.minY };
        case 'bottomLeft':  return { x: box.minX, y: box.maxY };
        case 'bottomRight': return { x: box.maxX, y: box.maxY };
        case 'center':
        default:            return { x: cx,       y: cy };
    }
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

    if (type === 'function') {
        // Sample the function (either y = f(x) or parametric (x(t), y(t))) into
        // world-space points, then render as a polyline. Supports tens to a
        // couple hundred samples — curves are cheap; anything coarser looks
        // jagged and anything finer hurts render cost without helping fidelity.
        const rawSamples = evaluateExpression(element.samples ?? 60, vars);
        const samples = clamp(Math.round(rawSamples) || 60, 2, 200);
        const points = [];
        const parametric = typeof element.fnX === 'string' && typeof element.fnY === 'string';
        if (parametric) {
            const tMin = evaluateExpression(element.tMin ?? 0, vars);
            const tMax = evaluateExpression(element.tMax ?? 1, vars);
            if (Number.isFinite(tMin) && Number.isFinite(tMax) && tMax !== tMin) {
                for (let i = 0; i < samples; i += 1) {
                    const t = tMin + (tMax - tMin) * (i / (samples - 1));
                    const scope = { ...vars, t };
                    const xVal = evaluateExpression(element.fnX, scope);
                    const yVal = evaluateExpression(element.fnY, scope);
                    if (Number.isFinite(xVal) && Number.isFinite(yVal)) {
                        points.push({ x: xVal, y: yVal });
                    }
                }
            }
        } else if (typeof element.fn === 'string') {
            const fallbackMin = context.xDomain?.min ?? -5;
            const fallbackMax = context.xDomain?.max ?? 5;
            const xMin = evaluateExpression(element.xMin ?? fallbackMin, vars);
            const xMax = evaluateExpression(element.xMax ?? fallbackMax, vars);
            if (Number.isFinite(xMin) && Number.isFinite(xMax) && xMax !== xMin) {
                for (let i = 0; i < samples; i += 1) {
                    const xVal = xMin + (xMax - xMin) * (i / (samples - 1));
                    const scope = { ...vars, x: xVal };
                    const yVal = evaluateExpression(element.fn, scope);
                    if (Number.isFinite(yVal)) {
                        points.push({ x: xVal, y: yVal });
                    }
                }
            }
        }
        if (points.length < 2) return null;

        const mapped = points
            .map((p) => {
                const px = resolveCoord(p.x, 'x', vars, context);
                const py = resolveCoord(p.y, 'y', vars, context);
                return `${px},${py}`;
            })
            .join(' ');

        const stroke = toColor(element.stroke, '#0C74E8');
        const strokeWidth = evaluateExpression(element.strokeWidth ?? 2, vars);
        const opacity = evaluateExpression(element.opacity ?? 1, vars);
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
        // Clamp to the same cap declared in pixelExtentForElement. Bare tokens
        // like `=r` already go through scaleFromVarToken's pixel mapping, but
        // complex expressions (e.g. `=r * 50`) bypass that and can produce
        // huge radii. This clamp keeps the renderer honest either way.
        const rawR = resolveCoord(element.r, 'r', vars, context);
        const rCap = circlePixelRadiusCap(context.width, context.height);
        const r = clamp(Number.isFinite(rawR) ? rawR : 0, 2, rCap);
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
        // `attach` lets a label track another element as sliders move. Compute
        // the target's bbox NOW (so the label follows live), pick a side of
        // that box, then nudge by a pixel offset. If attach is missing or the
        // target doesn't exist, fall back to the usual x/y coords.
        let x;
        let y;
        const attach = element.attach;
        if (attach && typeof attach === 'object' && typeof attach.to === 'string') {
            const targetEl = context.elementById?.[attach.to];
            const box = getElementPxBox(targetEl, vars, context);
            const anchor = anchorFromBox(box, attach.side);
            if (anchor) {
                x = anchor.x + (Number(attach.offsetX) || 0);
                y = anchor.y + (Number(attach.offsetY) || 0);
            }
        }
        if (!Number.isFinite(x)) x = resolveCoord(element.x, 'x', vars, context);
        if (!Number.isFinite(y)) y = resolveCoord(element.y, 'y', vars, context);
        // SVG <text> can't render LaTeX, so strip it down to readable plain text.
        const text = latexToPlainText(interpolateTemplate(element.text || '', vars));
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
    // True reachable bounds of every element's coordinates across the slider
    // space. This is authoritative — it sees literals, negations, and complex
    // expressions, not just bare variable tokens. When a scene has no coord
    // content (rare), we fall back to a modest default domain rather than
    // polluting an axis with unrelated slider ranges.
    const sceneAxisDomains = useMemo(
        () => inferAxisDomainsFromElements(elements, varsConfig),
        [elements, varsConfig]
    );
    // Scene-wide max pixel extent. Uses the ACTUAL rendered size per element
    // (not the theoretical per-type cap) so scenes with small shapes get
    // tight domain margins and fill more of the canvas.
    const maxPixelExtent = useMemo(
        () => computeMaxPixelExtent(elements, varsConfig, width, height),
        [elements, varsConfig, width, height]
    );
    const xDomain = useMemo(
        () => padDomainForPixelExtent(
            sceneAxisDomains.xDomain || DEFAULT_DOMAIN,
            width,
            maxPixelExtent,
        ),
        [sceneAxisDomains, width, maxPixelExtent]
    );
    const yDomain = useMemo(
        () => padDomainForPixelExtent(
            sceneAxisDomains.yDomain || DEFAULT_DOMAIN,
            height,
            maxPixelExtent,
        ),
        [sceneAxisDomains, height, maxPixelExtent]
    );
    const elementById = useMemo(() => {
        const map = {};
        elements.forEach((el) => {
            if (el?.id) map[el.id] = el;
        });
        return map;
    }, [elements]);
    const renderContext = useMemo(() => ({
        width,
        height,
        // Grid and positions fill the entire SVG; breathing room is baked
        // into the domain margin above, not reserved as whitespace here.
        padding: 0,
        varConfigById,
        xDomain,
        yDomain,
        // Used by text `attach` to look up the element being labeled.
        elementById,
    }), [width, height, varConfigById, xDomain, yDomain, elementById]);
    const gridElements = useMemo(() => createGridElements(renderContext), [renderContext]);

    const renderedElements = useMemo(
        () => elements.map((element) => renderElement(element, variables, renderContext)).filter(Boolean),
        [elements, variables, renderContext]
    );

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
                    {renderedElements}
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

