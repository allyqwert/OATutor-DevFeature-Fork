export function resolveMetaLesson(metaLesson, findLessonById, findMetaLessonById, visited = new Set()) {
    if (!metaLesson || metaLesson.type !== "meta_lesson") {
        return [];
    }

    if (visited.has(metaLesson.id)) {
        console.warn(`Circular reference detected in meta lesson: ${metaLesson.id}`);
        return [];
    }
    visited.add(metaLesson.id);

    const resolvedLessonIds = [];

    for (const lessonId of metaLesson.lessons || []) {
        const lesson = findLessonById(lessonId);
        if (lesson && !lesson.type) {
            resolvedLessonIds.push(lessonId);
        } else {
            const nestedMetaLesson = findMetaLessonById(lessonId);
            if (nestedMetaLesson && nestedMetaLesson.type === "meta_lesson") {
                const nestedIds = resolveMetaLesson(
                    nestedMetaLesson,
                    findLessonById,
                    findMetaLessonById,
                    new Set(visited)
                );
                resolvedLessonIds.push(...nestedIds);
            } else {
                console.warn(`[resolveMetaLesson] Could not resolve lesson ID: ${lessonId}`);
            }
        }
    }

    return resolvedLessonIds;
}

export function resolveMetaLessonBranchAware(metaLesson, findLessonById, findMetaLessonById, visited = new Set()) {
    if (!metaLesson || metaLesson.type !== "meta_lesson") {
        return [];
    }

    const order = metaLesson.order || "sequence";
    const choose = metaLesson.choose || "all";

    if (!(order === "random" && choose === "1")) {
        return resolveMetaLesson(metaLesson, findLessonById, findMetaLessonById, new Set(visited));
    }

    if (visited.has(metaLesson.id)) {
        console.warn(`Circular reference detected in meta lesson: ${metaLesson.id}`);
        return [];
    }
    visited.add(metaLesson.id);

    const childLessonIds = Array.isArray(metaLesson.lessons) ? metaLesson.lessons : [];
    console.log("[Meta Branch TEST] directChildren:", childLessonIds);
    const shuffledChildIds = shuffleArray(childLessonIds);

    for (const childId of shuffledChildIds) {
        const lesson = findLessonById(childId);
        if (lesson && !lesson.type) {
            console.log("[Meta Branch TEST] selectedChild:", childId);
            console.log("[Meta Branch TEST] selectedChildIsMeta:", false);
            console.log("[Meta Branch TEST] branchResolvedPath:", [childId]);
            return [childId];
        }

        const nestedMetaLesson = findMetaLessonById(childId);
        if (nestedMetaLesson && nestedMetaLesson.type === "meta_lesson") {
            const nestedResolved = resolveMetaLesson(
                nestedMetaLesson,
                findLessonById,
                findMetaLessonById,
                new Set(visited)
            );

            if (nestedResolved.length > 0) {
                console.log("[Meta Branch TEST] selectedChild:", childId);
                console.log("[Meta Branch TEST] selectedChildIsMeta:", Boolean(findMetaLessonById(childId)));
                console.log("[Meta Branch TEST] branchResolvedPath:", nestedResolved);
                return nestedResolved;
            }

            console.warn(`[resolveMetaLessonBranchAware] Nested meta lesson resolved empty: ${childId}`);
            continue;
        }

        console.warn(`[resolveMetaLessonBranchAware] Could not resolve lesson ID: ${childId}`);
    }

    console.warn(`[resolveMetaLessonBranchAware] No valid branch found for meta lesson: ${metaLesson.id}`);
    return [];
}

export function applyMetaLessonLogic(lessonIds, order, choose) {
    if (!lessonIds || lessonIds.length === 0) {
        return [];
    }

    let result = [...lessonIds];

    if (order === "random") {
        result = shuffleArray(result);
    }

    if (choose === "1") {
        result = [result[0]];
    }

    return result;
}

function shuffleArray(array) {
    const shuffled = [...array];
    const seed = Date.now() + Math.random();
    let seedValue = seed % 2147483647;
    const seededRandom = () => {
        seedValue = (seedValue * 16807) % 2147483647;
        return (seedValue - 1) / 2147483646;
    };
    
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(seededRandom() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

