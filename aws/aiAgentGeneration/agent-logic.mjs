import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
function artifactLog(...args) {
    console.log("[artifact-debug]", ...args);
}

const GENERATE_VISUAL_TOOL = {
    type: "function",
    function: {
        name: "generate_visual",
        description: "Generate an interactive visual (sliders + shapes + formulas) to help the student understand a math concept. Only call this when a visual genuinely aids understanding.",
        parameters: {
            type: "object",
            properties: {
                concept: {
                    type: "string",
                    description: "Short snake_case label for the concept being visualized, e.g. 'pythagorean_theorem', 'slope_intercept', 'unit_circle'. Used for analytics.",
                },
                title: { type: "string", description: "Display title for the visual." },
                canvas: {
                    type: "object",
                    properties: {
                        width: { type: "number" },
                        height: { type: "number" },
                    },
                    required: ["width", "height"],
                },
                variables: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            id: { type: "string" },
                            label: { type: "string" },
                            min: { type: "number" },
                            max: { type: "number" },
                            step: { type: "number" },
                            defaultValue: { type: "number" },
                        },
                        required: ["id", "label", "min", "max", "step", "defaultValue"],
                    },
                },
                elements: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            id: { type: "string" },
                            type: {
                                type: "string",
                                enum: [
                                    "line",
                                    "arrow",
                                    "circle",
                                    "rect",
                                    "text",
                                    "polyline",
                                    "polygon",
                                    "triangle",
                                ],
                                description: "Primitive element. Use `arrow` for any directed quantity (displacement, gradient, flow, velocity, field, force, slope direction). Use `polyline`/`polygon` for multi-point shapes, `triangle` with x1/y1/x2/y2/x3/y3.",
                            },
                            x: {}, y: {},
                            x1: {}, y1: {}, x2: {}, y2: {}, x3: {}, y3: {},
                            width: {}, height: {}, r: {},
                            points: {},
                            text: { type: "string" },
                            stroke: { type: "string" },
                            fill: { type: "string" },
                            strokeWidth: { type: "number" },
                            fontSize: { type: "number" },
                            opacity: { type: "number" },
                        },
                        required: ["id", "type"],
                    },
                },
                formulas: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            id: { type: "string" },
                            latex: { type: "string", description: "One symbolic LaTeX line (e.g., 'F_{tot} = \\\\sqrt{F_1^2 + F_2^2}'). Do NOT include the plugged-in numeric line; the renderer appends the numeric result automatically from `expr`." },
                            expr: { type: "string", description: "Optional evaluable expression using variable IDs (e.g., 'sqrt(F1*F1 + F2*F2)'). Supported: Math.*, bare sqrt/abs/sin/cos/tan/log/exp/pow/min/max/PI. When present, the renderer appends '≈ <computed value>' after the latex." },
                        },
                        required: ["id", "latex"],
                    },
                },
            },
            required: ["concept", "title", "canvas", "variables", "elements"],
        },
    },
};

export function buildAgentPrompt({ userMessage, problemContext, studentState, conversationHistory, extracted = {} }) {
    // Load prompt template
    const promptTemplate = readFileSync(join(__dirname, 'prompt.txt'), 'utf-8');
    
    // Format skill mastery
    const skillMasteryText = studentState.skillMastery && Object.keys(studentState.skillMastery).length > 0
        ? Object.entries(studentState.skillMastery)
            .map(([skill, level]) => `- ${skill}: ${(level * 100).toFixed(0)}% mastery`)
            .join('\n')
        : 'No skill mastery data available for this step';

    // Format hints used (manual, UI-numbered hints only)
    let hintsText = 'No hints viewed yet';
    if (Array.isArray(studentState.hintsUsed) && studentState.hintsUsed.length > 0) {
        const maxHints = 3;

        // Only include hints that actually have non-empty text
        const nonEmptyHints = studentState.hintsUsed.filter((hint) => {
            const rawText = (hint.text || '').toString().trim();
            return rawText.length > 0;
        });

        if (nonEmptyHints.length > 0) {
            const recentHints = nonEmptyHints.slice(-maxHints);
            const lines = recentHints.map((hint, index) => {
                const rawText = (hint.text || '').toString().trim();
                const truncated =
                    rawText.length > 300 ? `${rawText.slice(0, 300)}...` : rawText;
                // displayIndex is the same number the student sees in the UI: "Hint {displayIndex}"
                const uiIndex = hint.displayIndex || (index + 1);
                return `- Hint ${uiIndex}: ${truncated}`;
            });
            hintsText = `Hints already shown to the student for this step:\n${lines.join('\n')}`;
        }
    }

    // Format answer correctness
    const correctnessText = studentState.isCorrect === null 
        ? 'Not attempted yet' 
        : studentState.isCorrect 
            ? 'Correct' 
            : 'Incorrect';

    // Format attempt history
    let attemptHistoryText = 'No previous attempts recorded';
    if (studentState.attemptHistory && Object.keys(studentState.attemptHistory).length > 0) {
        const histories = [];
        for (const [problemTitle, questions] of Object.entries(studentState.attemptHistory)) {
            for (const [question, attempts] of Object.entries(questions)) {
                if (attempts.length > 0) {
                    histories.push(`  Question: "${question}"\n  Attempts: ${attempts.join(', ')}`);
                }
            }
        }
        attemptHistoryText = histories.length > 0 ? histories.join('\n\n') : 'No previous attempts recorded';
    }

    // Format current lesson mastery
    let currentLessonMasteryText = 'No lesson mastery data available (student has not attempted this lesson yet)';
    if (studentState.currentLessonMastery && studentState.currentLessonMastery.length > 0) {
        currentLessonMasteryText = studentState.currentLessonMastery
            .map(lesson => `- ${lesson.name}: ${lesson.mastery}%`)
            .join('\n');
    }

    // Build system prompt by replacing placeholders
    const systemPrompt = promptTemplate
        .replace('{courseName}', problemContext.courseName || 'Math')
        .replace('{problemTitle}', problemContext.problemTitle || 'Math Problem')
        .replace('{stepTitle}', problemContext.currentStep?.title || 'Problem Step')
        .replace('{stepBody}', problemContext.currentStep?.body ? `Details: ${problemContext.currentStep.body}` : '')
        .replace('{correctAnswer}', Array.isArray(problemContext.currentStep?.correctAnswer) 
            ? problemContext.currentStep.correctAnswer[0] 
            : problemContext.currentStep?.correctAnswer || 'Not provided')
        .replace('{studentAnswer}', studentState.currentAnswer || 'No answer provided yet')
        .replace('{correctnessStatus}', correctnessText)
        .replace('{hintsUsed}', hintsText)
        .replace('{attemptHistory}', attemptHistoryText)
        .replace('{currentLessonMastery}', currentLessonMasteryText)
        .replace('{skillMastery}', skillMasteryText)
        .replace('{userMessage}', userMessage);

    // Build message array with conversation history
    const messages = [
        { role: "system", content: systemPrompt }
    ];

    // Add conversation history if it exists
    if (conversationHistory && conversationHistory.length > 0) {
        messages.push(...conversationHistory);
    }

    // Build the last user message.
    // If the problem has figures (sent as base64 data URLs from the browser), attach them
    // as multimodal image_url parts so the vision model can see them.
    const images = Array.isArray(extracted?.images) ? extracted.images : [];
    if (images.length > 0) {
        const parts = [{ type: "text", text: userMessage }];
        for (const img of images) {
            parts.push({ type: "image_url", image_url: { url: img, detail: "auto" } });
        }
        messages.push({ role: "user", content: parts });
    } else {
        messages.push({ role: "user", content: userMessage });
    }

    return messages;
}

function safeParseJson(raw) {
    if (!raw || typeof raw !== "string") return { parsed: null, error: "empty-or-non-string" };
    const trimmed = raw.trim();
    try {
        return { parsed: JSON.parse(trimmed), error: null };
    } catch (e) {
        const firstBrace = trimmed.indexOf("{");
        const lastBrace = trimmed.lastIndexOf("}");
        if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
            return { parsed: null, error: `no-json-brace-block:${e?.message || "parse-error"}` };
        }
        const candidate = trimmed.slice(firstBrace, lastBrace + 1);
        try {
            return { parsed: JSON.parse(candidate), error: null };
        } catch (e2) {
            return { parsed: null, error: `candidate-parse-failed:${e2?.message || "parse-error"}` };
        }
    }
}

// Node equivalent of a Pydantic model_validate gate.
function modelValidateArtifactDecision(input) {
    if (!input || typeof input !== "object") return null;
    if (typeof input.enable_interactive_artifact !== "boolean") {
        artifactLog("validate:decision:missing-enable-flag");
        return null;
    }

    const reason = typeof input.reason === "string" ? input.reason : "";

    if (!input.enable_interactive_artifact) {
        return {
            enable_interactive_artifact: false,
            reason,
            artifact_plan: null,
        };
    }

    const plan = modelValidateArtifactPlan(input.artifact_plan);
    if (!plan) {
        artifactLog("validate:decision:invalid-plan");
        return null;
    }

    return {
        enable_interactive_artifact: true,
        reason,
        artifact_plan: plan,
    };
}

function modelValidateArtifactPlan(plan) {
    if (!plan || typeof plan !== "object") {
        artifactLog("validate:plan:not-object");
        return null;
    }
    if (typeof plan.title !== "string" || !plan.title.trim()) {
        artifactLog("validate:plan:missing-title");
        return null;
    }

    const canvas = plan.canvas;
    if (!canvas || typeof canvas !== "object") {
        artifactLog("validate:plan:missing-canvas");
        return null;
    }
    const width = toFiniteNumber(canvas.width);
    const height = toFiniteNumber(canvas.height);
    if (!width || !height) {
        artifactLog("validate:plan:bad-canvas-size", { width, height });
        return null;
    }
    if (width < 200 || width > 1200 || height < 120 || height > 800) {
        artifactLog("validate:plan:canvas-out-of-range", { width, height });
        return null;
    }

    const variables = Array.isArray(plan.variables) ? plan.variables : [];
    const elements = Array.isArray(plan.elements) ? plan.elements : [];
    const formulas = Array.isArray(plan.formulas) ? plan.formulas : [];

    if (variables.length > 20 || elements.length > 100 || formulas.length > 20) {
        artifactLog("validate:plan:too-many-items", {
            variables: variables.length,
            elements: elements.length,
            formulas: formulas.length,
        });
        return null;
    }

    const validatedVariables = variables.map(modelValidateVariable).filter(Boolean);
    if (validatedVariables.length !== variables.length) {
        artifactLog("validate:plan:variables-invalid");
        return null;
    }

    const validatedElements = elements.map(modelValidateElement).filter(Boolean);
    if (validatedElements.length !== elements.length) {
        const failedIdx = elements.map((el, i) => modelValidateElement(el) ? null : i).filter(i => i !== null);
        artifactLog("validate:plan:elements-invalid", {
            total: elements.length,
            valid: validatedElements.length,
            failedIndices: failedIdx,
            failedElements: failedIdx.map(i => JSON.stringify(elements[i]).slice(0, 200)),
        });
        return null;
    }

    const validatedFormulas = formulas.map(modelValidateFormula).filter(Boolean);
    if (validatedFormulas.length !== formulas.length) {
        artifactLog("validate:plan:formulas-invalid");
        return null;
    }

    return {
        title: plan.title.trim(),
        canvas: { width, height },
        variables: validatedVariables,
        elements: validatedElements,
        formulas: validatedFormulas,
    };
}

function modelValidateVariable(v) {
    if (!v || typeof v !== "object") return null;
    if (!isNonEmptyString(v.id) || !isNonEmptyString(v.label)) return null;
    const min = toFiniteNumber(v.min);
    const max = toFiniteNumber(v.max);
    const step = toFiniteNumber(v.step);
    const defaultValue = toFiniteNumber(v.defaultValue);
    if (min === null || max === null || step === null || defaultValue === null) return null;
    if (!(min < max) || step <= 0) return null;
    if (defaultValue < min || defaultValue > max) return null;
    return { id: v.id, label: v.label, min, max, step, defaultValue };
}

function modelValidateElement(el) {
    if (!el || typeof el !== "object") return null;
    if (!isNonEmptyString(el.id)) return null;
    const validTypes = new Set([
        "line", "arrow", "circle", "rect", "text",
        "polyline", "polygon", "triangle",
    ]);
    if (!validTypes.has(el.type)) {
        artifactLog("validate:element:bad-type", { id: el.id, type: el.type });
        return null;
    }

    const out = { id: el.id, type: el.type };
    const stringKeys = new Set(["text", "stroke", "fill"]);
    const allowedKeys = [
        "x", "y", "x1", "y1", "x2", "y2", "x3", "y3",
        "width", "height", "r", "points", "text",
        "stroke", "fill", "strokeWidth", "fontSize", "opacity",
    ];
    for (const key of allowedKeys) {
        if (el[key] === undefined) continue;
        if (stringKeys.has(key)) {
            if (typeof el[key] !== "string") {
                artifactLog("validate:element:string-expected", { id: el.id, key, value: el[key] });
                return null;
            }
            out[key] = el[key];
            continue;
        }
        // `points` is allowed to be an array or a string (pass through untouched).
        if (key === "points") {
            if (Array.isArray(el.points) || typeof el.points === "string") {
                out.points = el.points;
                continue;
            }
            artifactLog("validate:element:bad-points", { id: el.id, type: typeof el.points });
            return null;
        }
        if (typeof el[key] === "number") {
            if (!Number.isFinite(el[key])) {
                artifactLog("validate:element:non-finite", { id: el.id, key, value: el[key] });
                return null;
            }
            out[key] = el[key];
            continue;
        }
        // LLMs sometimes omit the "=" prefix for expressions. Auto-prepend it
        // so the renderer's evaluateExpression picks them up correctly.
        if (typeof el[key] === "string") {
            out[key] = el[key].startsWith("=") ? el[key] : `=${el[key]}`;
            continue;
        }
        artifactLog("validate:element:unexpected-value", { id: el.id, key, type: typeof el[key] });
        return null;
    }
    return out;
}

function modelValidateFormula(f) {
    if (!f || typeof f !== "object") return null;
    if (!isNonEmptyString(f.id) || !isNonEmptyString(f.latex)) return null;
    const out = { id: f.id, latex: f.latex };
    if (isNonEmptyString(f.expr)) out.expr = f.expr.trim();
    return out;
}

function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}

function toFiniteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

export async function generateAgentResponse(openai, prompt, responseStream = null, config = {}) {
    const {
        model = "gpt-4o",
        temperature = 0.7,
        max_tokens = 800,
        problemId = null,
        stepId = null,
    } = config;

    const stream = await openai.chat.completions.create({
        model,
        messages: prompt,
        stream: true,
        temperature,
        max_tokens,
        tools: [GENERATE_VISUAL_TOOL],
        tool_choice: "auto",
    });

    let fullResponse = "";

    // Accumulate tool_call deltas keyed by index.
    // Each entry: { id, name, arguments: "" }
    const toolCallAccumulators = {};
    
    for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        // --- text content ---
        const content = delta.content || "";
        if (content) {
            fullResponse += content;
            if (responseStream) {
                responseStream.write(JSON.stringify({
                    type: "content",
                    content,
                    timestamp: Date.now()
                }) + '\n');
            } else {
                process.stdout.write(content);
            }
        }

        // --- tool_call deltas ---
        if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
                const idx = tc.index;
                if (!toolCallAccumulators[idx]) {
                    toolCallAccumulators[idx] = {
                        id: tc.id || "",
                        name: tc.function?.name || "",
                        arguments: "",
                    };
                }
                if (tc.id) toolCallAccumulators[idx].id = tc.id;
                if (tc.function?.name) toolCallAccumulators[idx].name = tc.function.name;
                if (tc.function?.arguments) toolCallAccumulators[idx].arguments += tc.function.arguments;
            }
        }
    }

    // --- Extract artifact decision from tool call (if any) ---
    let artifactDecision = null;

    const visualCall = Object.values(toolCallAccumulators).find(tc => tc.name === "generate_visual");
    if (visualCall) {
        artifactLog("tool-call:raw", { argsLength: visualCall.arguments.length, preview: visualCall.arguments.slice(0, 400) });

        const parseResult = safeParseJson(visualCall.arguments);
        if (parseResult.parsed) {
            const { concept, ...planFields } = parseResult.parsed;

            const plan = modelValidateArtifactPlan(planFields);
            if (plan) {
                artifactDecision = {
                    enable_interactive_artifact: true,
                    reason: `tool_call:${concept || "unknown"}`,
                    artifact_plan: plan,
                };
                artifactLog("tool-call:validated", {
                    concept,
                    title: plan.title,
                    vars: plan.variables.length,
                    elements: plan.elements.length,
                });

                // Phase 2 analytics: log every concept the LLM visualizes.
                // Recording structural fingerprints (element-type counts, variable
                // count, formula/expr counts) lets us cluster concepts by shape
                // later without re-reading every plan.
                const elementTypeCounts = plan.elements.reduce((acc, el) => {
                    acc[el.type] = (acc[el.type] || 0) + 1;
                    return acc;
                }, {});
                const formulaCount = Array.isArray(plan.formulas) ? plan.formulas.length : 0;
                const formulaWithExprCount = Array.isArray(plan.formulas)
                    ? plan.formulas.filter(f => typeof f.expr === "string" && f.expr.trim()).length
                    : 0;
                console.log("[visual-concept]", JSON.stringify({
                    event: "visual_concept",
                    concept: concept || "unknown",
                    title: plan.title,
                    problemId,
                    stepId,
                    variableCount: plan.variables.length,
                    variableIds: plan.variables.map(v => v.id),
                    elementCount: plan.elements.length,
                    elementTypeCounts,
                    formulaCount,
                    formulaWithExprCount,
                    timestamp: new Date().toISOString(),
                }));
            } else {
                artifactLog("tool-call:validation-failed");
            }
        } else {
            artifactLog("tool-call:parse-failed", parseResult.error);
        }
    }

    // When the model only produced a tool call with no text, send a brief
    // fallback so the chat bubble isn't empty for the student.
    if (!fullResponse && artifactDecision) {
        const fallback = "Here's an interactive visual to help you explore this concept. Try adjusting the sliders!";
        fullResponse = fallback;
        if (responseStream) {
            responseStream.write(JSON.stringify({
                type: "content",
                content: fallback,
                timestamp: Date.now()
            }) + '\n');
        }
    }

    if (responseStream) {
        responseStream.write(JSON.stringify({
            type: "complete",
            fullResponse,
            artifactDecision,
            timestamp: Date.now()
        }) + '\n');
    }

    return fullResponse;
}