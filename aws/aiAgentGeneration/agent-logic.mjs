import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
function artifactLog(...args) {
    console.log("[artifact-debug]", ...args);
}

export function buildAgentPrompt({ userMessage, problemContext, studentState, conversationHistory }) {
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

    // Add current user message
    messages.push({ role: "user", content: userMessage });

    return messages;
}

async function generateArtifactDecision(openai, { userMessage, problemContext, extracted = {} }, config = {}) {
    const {
        model = "gpt-4o-mini",
        temperature = 0,
        max_tokens = 1900,
    } = config;

    const courseName = problemContext?.courseName || "";
    const problemTitle = problemContext?.problemTitle || "";
    const stepTitle = problemContext?.currentStep?.title || "";
    const stepBody = problemContext?.currentStep?.body || "";

    const extractedText = (extracted?.text || "").toString();
    const extractedImages = Array.isArray(extracted?.images) ? extracted.images : [];

    const system = [
        "You decide whether an interactive learning artifact should be generated for a student question.",
        "You are NOT restricted to predefined artifact types. Generate a generic artifact plan that can be rendered dynamically.",
        "",
        "Return ONLY valid JSON (no markdown fences) matching this schema:",
        "{",
        '  "enable_interactive_artifact": boolean,',
        '  "reason": string,',
        '  "artifact_plan": {',
        '    "title": string,',
        '    "canvas": { "width": number, "height": number },',
        '    "variables": [',
        '      { "id": string, "label": string, "min": number, "max": number, "step": number, "defaultValue": number }',
        '    ],',
        '    "elements": [',
        '      {',
        '        "id": string,',
        '        "type": "line" | "circle" | "rect" | "text",',
        '        "x": number | "=expression",',
        '        "y": number | "=expression",',
        '        "x2": number | "=expression",',
        '        "y2": number | "=expression",',
        '        "width": number | "=expression",',
        '        "height": number | "=expression",',
        '        "r": number | "=expression",',
        '        "text": string,',
        '        "stroke": string,',
        '        "fill": string,',
        '        "strokeWidth": number,',
        '        "fontSize": number,',
        '        "opacity": number',
        '      }',
        '    ],',
        '    "formulas": [',
        '      { "id": string, "latex": string }',
        '    ]',
        '  }',
        "}",
        "",
        "Rules:",
        "- PRIORITIZE THE LATEST USER MESSAGE over prior step context.",
        "- If the latest user message explicitly asks to draw/visualize a concept, set enable_interactive_artifact=true and generate an artifact_plan for THAT concept.",
        "- If the user asks for plain procedural algebra without visualization intent, set enable_interactive_artifact=false and artifact_plan=null.",
        "- Use only variable IDs in expressions (e.g. '=centerX + r', '=Math.sqrt(a*a+b*b)').",
        "- Keep plans concise: 2-8 variables, 3-25 elements, canvas around 320-520 by 180-320.",
        "- Use sensible defaults; include at least one slider variable when artifact is enabled.",
        "- Formula strings should use LaTeX and may include template expressions in double braces, e.g. '\\\\(c = \\\\sqrt{a^2+b^2} \\\\approx {{Math.sqrt(a*a+b*b).toFixed(2)}}\\\\)'.",
        "- Text element strings may also include {{expression}} templates.",
    ].join("\n");

    const user = [
        "Context:",
        `- courseName: ${courseName}`,
        `- problemTitle: ${problemTitle}`,
        `- stepTitle: ${stepTitle}`,
        `- stepBody: ${stepBody}`,
        extractedText ? `- extractedText: ${extractedText}` : "",
        extractedImages.length ? `- extractedImages: ${JSON.stringify(extractedImages)}` : "",
        "",
        `User question: ${userMessage}`,
    ].filter(Boolean).join("\n");

    try {
        artifactLog("decision:start", {
            userMessagePreview: (userMessage || "").slice(0, 120),
            stepTitle,
            hasExtractedImages: extractedImages.length > 0,
        });

        const resp = await openai.chat.completions.create({
            model,
            messages: [
                { role: "system", content: system },
                { role: "user", content: user },
            ],
            temperature,
            max_tokens,
            response_format: { type: "json_object" },
        });

        const raw = resp.choices?.[0]?.message?.content || "";
        artifactLog("decision:raw", { length: raw.length, preview: raw.slice(0, 400) });

        const parseResult = safeParseJson(raw);
        const parsed = parseResult.parsed;
        artifactLog("decision:parsed", parsed ? {
            enable_interactive_artifact: parsed.enable_interactive_artifact,
            hasPlan: !!parsed.artifact_plan,
            planTitle: parsed.artifact_plan?.title,
            varCount: Array.isArray(parsed.artifact_plan?.variables) ? parsed.artifact_plan.variables.length : 0,
            elementCount: Array.isArray(parsed.artifact_plan?.elements) ? parsed.artifact_plan.elements.length : 0,
        } : { error: parseResult.error });

        const validated = modelValidateArtifactDecision(parsed);
        if (validated) {
            artifactLog("decision:validated:first-pass", {
                enabled: validated.enable_interactive_artifact,
                title: validated.artifact_plan?.title || null,
                vars: validated.artifact_plan?.variables?.length || 0,
                elements: validated.artifact_plan?.elements?.length || 0,
            });
            return validated;
        }
        artifactLog("decision:first-pass-invalid");

        // One repair attempt for malformed output.
        const repaired = await repairArtifactDecision(openai, raw, {
            model,
            max_tokens,
        });
        artifactLog("decision:repair-raw", repaired ? {
            enable_interactive_artifact: repaired.enable_interactive_artifact,
            hasPlan: !!repaired.artifact_plan,
        } : null);

        const repairedValidated = modelValidateArtifactDecision(repaired);
        artifactLog("decision:validated:repair-pass", repairedValidated ? {
            enabled: repairedValidated.enable_interactive_artifact,
            title: repairedValidated.artifact_plan?.title || null,
            vars: repairedValidated.artifact_plan?.variables?.length || 0,
            elements: repairedValidated.artifact_plan?.elements?.length || 0,
        } : null);
        return repairedValidated;
    } catch (_e) {
        artifactLog("decision:error");
        return null;
    }
}

function safeParseJson(raw) {
    if (!raw || typeof raw !== "string") return { parsed: null, error: "empty-or-non-string" };
    const trimmed = raw.trim();
    try {
        return { parsed: JSON.parse(trimmed), error: null };
    } catch (e) {
        // Best effort: extract first JSON object in case model wrapped content.
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

async function repairArtifactDecision(openai, invalidRaw, config = {}) {
    const {
        model = "gpt-4o-mini",
        max_tokens = 400,
    } = config;

    const repairPrompt = [
        "You must repair malformed JSON into valid JSON matching this schema exactly:",
        "{",
        '  "enable_interactive_artifact": boolean,',
        '  "reason": string,',
        '  "artifact_plan": null | {',
        '    "title": string,',
        '    "canvas": { "width": number, "height": number },',
        '    "variables": [{ "id": string, "label": string, "min": number, "max": number, "step": number, "defaultValue": number }],',
        '    "elements": [{ "id": string, "type": "line"|"circle"|"rect"|"text" }],',
        '    "formulas": [{ "id": string, "latex": string }]',
        '  }',
        "}",
        "Rules:",
        "- Return ONLY JSON.",
        "- If you cannot recover, return enable_interactive_artifact=false and artifact_plan=null.",
        "",
        "Malformed content:",
        invalidRaw || "",
    ].join("\n");

    try {
        const resp = await openai.chat.completions.create({
            model,
            messages: [{ role: "user", content: repairPrompt }],
            temperature: 0,
            max_tokens,
            response_format: { type: "json_object" },
        });
        const parseResult = safeParseJson(resp.choices?.[0]?.message?.content || "");
        if (!parseResult.parsed) {
            artifactLog("decision:repair-parse-failed", parseResult.error);
        }
        return parseResult.parsed;
    } catch (_e) {
        return null;
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
        artifactLog("validate:plan:elements-invalid");
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
    const validTypes = new Set(["line", "circle", "rect", "text"]);
    if (!validTypes.has(el.type)) return null;

    const out = { id: el.id, type: el.type };
    const allowedKeys = [
        "x", "y", "x2", "y2", "width", "height", "r", "text",
        "stroke", "fill", "strokeWidth", "fontSize", "opacity",
    ];
    for (const key of allowedKeys) {
        if (el[key] === undefined) continue;
        if (["text", "stroke", "fill"].includes(key)) {
            if (typeof el[key] !== "string") return null;
            out[key] = el[key];
            continue;
        }
        if (typeof el[key] === "number") {
            if (!Number.isFinite(el[key])) return null;
            out[key] = el[key];
            continue;
        }
        if (typeof el[key] === "string" && el[key].startsWith("=")) {
            out[key] = el[key];
            continue;
        }
        return null;
    }
    return out;
}

function modelValidateFormula(f) {
    if (!f || typeof f !== "object") return null;
    if (!isNonEmptyString(f.id) || !isNonEmptyString(f.latex)) return null;
    return { id: f.id, latex: f.latex };
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
        max_tokens = 800  
    } = config;

    const stream = await openai.chat.completions.create({
        model,
        messages: prompt,
        stream: true,
        temperature,
        max_tokens
    });

    let fullResponse = "";
    
    for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        
        if (content) {
            fullResponse += content;
            
            if (responseStream) {
                responseStream.write(JSON.stringify({
                    type: "content",
                    content: content,
                    timestamp: Date.now()
                }) + '\n');
            } else {
                process.stdout.write(content);
            }
        }
    }

    if (responseStream) {
        const userMessage = prompt?.[prompt.length - 1]?.content || "";
        const problemContext = config?.problemContext || {};
        const extracted = config?.extracted || {};
        const artifactDecision = await generateArtifactDecision(
            openai,
            { userMessage, problemContext, extracted },
            config?.artifactDecisionConfig || {}
        );

        responseStream.write(JSON.stringify({
            type: "complete",
            fullResponse: fullResponse,
            artifactDecision,
            timestamp: Date.now()
        }) + '\n');
    }

    return fullResponse;
}