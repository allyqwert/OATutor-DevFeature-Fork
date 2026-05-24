import { resolveMetaLesson, resolveMetaLessonBranchAware } from "./metaLessonUtils";

describe("resolveMetaLessonBranchAware", () => {
  const lessonsById = {
    lesson_a1: { id: "lesson_a1" },
    lesson_a2: { id: "lesson_a2" },
    lesson_a3: { id: "lesson_a3" },
    lesson_b1: { id: "lesson_b1" },
    lesson_b2: { id: "lesson_b2" },
    lesson_b3: { id: "lesson_b3" },
    lesson_c1: { id: "lesson_c1" },
    lesson_c2: { id: "lesson_c2" },
    lesson_c3: { id: "lesson_c3" },
  };

  const metaLessonsById = {
    condition_a: {
      id: "condition_a",
      type: "meta_lesson",
      order: "sequence",
      choose: "all",
      lessons: ["lesson_a1", "lesson_a2", "lesson_a3"],
    },
    condition_b: {
      id: "condition_b",
      type: "meta_lesson",
      order: "sequence",
      choose: "all",
      lessons: ["lesson_b1", "lesson_b2", "lesson_b3"],
    },
    condition_c: {
      id: "condition_c",
      type: "meta_lesson",
      order: "sequence",
      choose: "all",
      lessons: ["lesson_c1", "lesson_c2", "lesson_c3"],
    },
    root_ab: {
      id: "root_ab",
      type: "meta_lesson",
      order: "random",
      choose: "1",
      lessons: ["condition_a", "condition_b", "condition_c"],
    },
    root_sequence_all: {
      id: "root_sequence_all",
      type: "meta_lesson",
      order: "sequence",
      choose: "all",
      lessons: ["condition_a", "condition_b"],
    },
    root_with_invalid_child: {
      id: "root_with_invalid_child",
      type: "meta_lesson",
      order: "random",
      choose: "1",
      lessons: ["missing_child", "condition_a"],
    },
    circular_root: {
      id: "circular_root",
      type: "meta_lesson",
      order: "random",
      choose: "1",
      lessons: ["circular_root"],
    },
  };

  const findLessonById = (id) => lessonsById[id];
  const findMetaLessonById = (id) => metaLessonsById[id];

  it("returns one full nested condition sequence for random choose=1 roots", () => {
    const selectedPath = resolveMetaLessonBranchAware(
      metaLessonsById.root_ab,
      findLessonById,
      findMetaLessonById
    );

    const validConditionPaths = [
      ["lesson_a1", "lesson_a2", "lesson_a3"],
      ["lesson_b1", "lesson_b2", "lesson_b3"],
      ["lesson_c1", "lesson_c2", "lesson_c3"],
    ];

    expect(selectedPath).toHaveLength(3);
    expect(validConditionPaths).toContainEqual(selectedPath);
  });

  it("keeps legacy sequence/all flattening behavior", () => {
    const flattened = resolveMetaLessonBranchAware(
      metaLessonsById.root_sequence_all,
      findLessonById,
      findMetaLessonById
    );

    expect(flattened).toEqual([
      "lesson_a1",
      "lesson_a2",
      "lesson_a3",
      "lesson_b1",
      "lesson_b2",
      "lesson_b3",
    ]);
  });

  it("skips invalid children for random choose=1 branch selection", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const selectedPath = resolveMetaLessonBranchAware(
      metaLessonsById.root_with_invalid_child,
      findLessonById,
      findMetaLessonById
    );

    expect(selectedPath).toEqual(["lesson_a1", "lesson_a2", "lesson_a3"]);
    warnSpy.mockRestore();
  });

  it("terminates safely on circular references", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const selectedPath = resolveMetaLessonBranchAware(
      metaLessonsById.circular_root,
      findLessonById,
      findMetaLessonById
    );

    expect(selectedPath).toEqual([]);
    warnSpy.mockRestore();
  });
});

describe("resolveMetaLesson", () => {
  it("still flattens nested meta lessons", () => {
    const lessonsById = {
      l1: { id: "l1" },
      l2: { id: "l2" },
      l3: { id: "l3" },
    };
    const nestedMeta = {
      id: "nested",
      type: "meta_lesson",
      lessons: ["l2", "l3"],
      order: "sequence",
      choose: "all",
    };
    const rootMeta = {
      id: "root",
      type: "meta_lesson",
      lessons: ["l1", "nested"],
      order: "sequence",
      choose: "all",
    };
    const metaLessonsById = { nested: nestedMeta };

    const findLessonById = (id) => lessonsById[id];
    const findMetaLessonById = (id) => metaLessonsById[id];

    expect(resolveMetaLesson(rootMeta, findLessonById, findMetaLessonById)).toEqual(["l1", "l2", "l3"]);
  });
});
