import React, { useMemo, useState } from 'react';
import { Box, Slider, Typography } from '@material-ui/core';
import ArtifactFrame from './ArtifactFrame';
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

    // Run multiple passes so templates introduced by earlier replacements can also resolve.
    // Keep expression matcher strict (no braces inside) to avoid swallowing LaTeX braces.
    const templateRegex = /\{\{\s*([^{}]+?)\s*\}\}/g;
    for (let i = 0; i < 4; i += 1) {
        let changed = false;
        output = output.replace(templateRegex, (_full, expression) => {
            try {
                const fn = new Function('vars', 'Math', `with (vars) { return (${expression}); }`);
                const value = fn(vars, Math);
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

    // Final cleanup for any malformed remnants that can break KaTeX.
    output = output
        .replace(/\{\{/g, '')
        .replace(/\}\}/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

    return output;
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

function inferCircleDomainFromConfig(varsConfig) {
    const byKey = {};
    varsConfig.forEach((cfg) => {
        if (cfg?.id) byKey[String(cfg.id).toLowerCase()] = cfg;
    });

    const centerXCfg = byKey.centerx || byKey.h || byKey.cx;
    const centerYCfg = byKey.centery || byKey.k || byKey.cy;
    const radiusCfg = byKey.radius || byKey.r;
    if (!radiusCfg) return null;

    const cx = Number(centerXCfg?.defaultValue ?? 0);
    const cy = Number(centerYCfg?.defaultValue ?? 0);
    const r = Number(radiusCfg?.defaultValue);
    if (!Number.isFinite(r) || r <= 0) return null;

    const xCenter = Number.isFinite(cx) ? cx : 0;
    const yCenter = Number.isFinite(cy) ? cy : 0;
    const span = Math.max(4, r + 2);

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

function getPrimaryCircleMeta(vars, context) {
    const keys = Object.keys(vars).reduce((acc, key) => {
        acc[key.toLowerCase()] = key;
        return acc;
    }, {});
    const cxKey = keys.centerx || keys.h || keys.cx;
    const cyKey = keys.centery || keys.k || keys.cy;
    const rKey = keys.radius || keys.r;
    if (!rKey) return null;

    const cxRaw = cxKey ? Number(vars[cxKey]) : 0;
    const cyRaw = cyKey ? Number(vars[cyKey]) : 0;
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
    if (!(Number.isFinite(rawValue) && rawValue >= min && rawValue <= max && max > min)) {
        return rawValue;
    }
    const t = (rawValue - min) / (max - min);
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

    if (type === 'line') {
        const x1 = resolveCoord(element.x, 'x', vars, context);
        const y1 = resolveCoord(element.y, 'y', vars, context);
        const x2 = resolveCoord(element.x2, 'x', vars, context);
        const y2 = resolveCoord(element.y2, 'y', vars, context);
        return (
            <line
                key={element.id}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={toColor(element.stroke, '#252525')}
                strokeWidth={evaluateExpression(element.strokeWidth ?? 2, vars)}
                opacity={evaluateExpression(element.opacity ?? 1, vars)}
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
        const text = interpolateTemplate(element.text || '', vars);

        // Heuristic: if this is a center label and we have a circle, place label outside the circle.
        if (isLikelyCenterLabel(text)) {
            const circle = getPrimaryCircleMeta(vars, context);
            if (circle) {
                x = circle.cx + circle.r + 10;
                y = circle.cy - 2;
            }
        }
        return (
            <text
                key={element.id}
                x={x}
                y={y}
                fill={toColor(element.fill, '#334e68')}
                fontSize={evaluateExpression(element.fontSize ?? 12, vars)}
                opacity={evaluateExpression(element.opacity ?? 1, vars)}
            >
                {text}
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

    const varsConfig = Array.isArray(plan?.variables) ? plan.variables : [];
    const [variables, setVariables] = useState(() => {
        const initial = {};
        varsConfig.forEach((v) => {
            if (!v?.id) return;
            const min = Math.round(Number(v.min ?? 0));
            const max = Math.round(Number(v.max ?? 10));
            const fallback = Number.isFinite(min) ? min : 0;
            const value = Math.round(Number(v.defaultValue ?? fallback));
            initial[v.id] = Math.round(clamp(Number.isFinite(value) ? value : fallback, min, max));
        });
        return initial;
    });

    const canvas = plan?.canvas && typeof plan.canvas === 'object' ? plan.canvas : {};
    const width = Number(canvas.width ?? 380) || 380;
    const height = Number(canvas.height ?? 220) || 220;

    const elements = Array.isArray(plan?.elements) ? plan.elements : [];
    const formulas = Array.isArray(plan?.formulas) ? plan.formulas : [];
    const varConfigById = useMemo(() => getVarConfigById(varsConfig), [varsConfig]);
    const globalDomain = useMemo(() => getGlobalDomain(varsConfig), [varsConfig]);
    const fittedCircleDomain = useMemo(() => inferCircleDomainFromConfig(varsConfig), [varsConfig]);
    const xDomain = useMemo(
        () => fittedCircleDomain?.xDomain || getAxisDomain(varsConfig, 'x', globalDomain),
        [fittedCircleDomain, varsConfig, globalDomain]
    );
    const yDomain = useMemo(
        () => fittedCircleDomain?.yDomain || getAxisDomain(varsConfig, 'y', globalDomain),
        [fittedCircleDomain, varsConfig, globalDomain]
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

    return (
        <ArtifactFrame title="Concept Exploration">
            <Box display="flex" flexDirection="column" gridGap={10}>
                {plan.title ? (
                    <Typography variant="body2" style={{ fontWeight: 600, color: '#1f2933' }}>
                        {plan.title}
                    </Typography>
                ) : null}

                <Box display="flex" justifyContent="center">
                    <svg width={width} height={height}>
                        {gridElements}
                        {(elements.length > 0)
                            ? renderedElements
                            : (fallbackDistanceElements.length > 0 ? fallbackDistanceElements : fallbackCircleElements)}
                    </svg>
                </Box>

                {formulas.map((formula) => (
                    <ArtifactMarkdown
                        key={formula.id || formula.latex}
                        content={interpolateTemplate(formula.latex || '', variables)}
                    />
                ))}

                {varsConfig.length > 0 ? (
                    <Box>
                        <Typography variant="caption" style={{ color: '#52606d', fontWeight: 600 }}>
                            Adjust variables
                        </Typography>
                        {varsConfig.map((v) => {
                            const id = v.id;
                            if (!id) return null;
                            const min = Math.round(Number(v.min ?? 0));
                            const max = Math.round(Number(v.max ?? 10));
                            const step = 1;
                            const value = Math.round(Number(variables[id] ?? min));
                            return (
                                <Box mt={1} key={id}>
                                    <Typography variant="caption" style={{ color: '#52606d' }}>
                                        {v.label || id}: {value}
                                    </Typography>
                                    <Slider
                                        value={value}
                                        min={min}
                                        max={max}
                                        step={step}
                                        onChange={(_event, next) => {
                                            const num = Math.round(Number(next));
                                            setVariables((prev) => ({ ...prev, [id]: Math.round(clamp(num, min, max)) }));
                                        }}
                                        valueLabelDisplay="auto"
                                    />
                                </Box>
                            );
                        })}
                    </Box>
                ) : null}
            </Box>
        </ArtifactFrame>
    );
}

