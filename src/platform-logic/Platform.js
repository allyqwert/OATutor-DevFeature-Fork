import React from "react";
import { AppBar, Toolbar } from "@material-ui/core";
import LinearProgress from "@material-ui/core/LinearProgress";
import Grid from "@material-ui/core/Grid";
import ProblemWrapper from "@components/problem-layout/ProblemWrapper.js";
import LessonSelectionWrapper from "@components/problem-layout/LessonSelectionWrapper.js";
import { withRouter } from "react-router-dom";
import Button from "@material-ui/core/Button";
import {
    resolveMetaLesson,
    resolveMetaLessonBranchAware,
    applyMetaLessonLogic,
} from "../util/metaLessonUtils.js";

import {
    coursePlans,
    findLessonById,
    LESSON_PROGRESS_STORAGE_KEY,
    MIDDLEWARE_URL,
    SITE_NAME,
    ThemeContext,
    MASTERY_THRESHOLD,
    SHOW_NOT_CANVAS_WARNING,
    CANVAS_WARNING_STORAGE_KEY,
} from "../config/config.js";
import to from "await-to-js";
import { toast } from "react-toastify";
import ToastID from "../util/toastIds";
import BrandLogoNav from "@components/BrandLogoNav";
import { cleanArray } from "../util/cleanObject";
import ErrorBoundary from "@components/ErrorBoundary";
import { CONTENT_SOURCE } from "@common/global-config";
import withTranslation from '../util/withTranslation';
import { LocalizationConsumer } from '../util/LocalizationContext';

let problemPool = require(`@generated/processed-content-pool/${CONTENT_SOURCE}.json`);

let seed = Date.now().toString();
console.log("Generated seed");

const findMetaLessonById = (ID) => {
    for (const course of coursePlans) {
        if (course.editor) {
            continue;
        }
        const metaLessons = course.metaLessons || [];
        const foundInMetaLessons = metaLessons.find((metaLesson) => metaLesson.id === ID);
        if (foundInMetaLessons) {
            return foundInMetaLessons;
        }
        const foundInLessons = (course.lessons || []).find(
            (lesson) => lesson.id === ID && lesson.type === "meta_lesson"
        );
        if (foundInLessons) {
            return foundInLessons;
        }
    }
};

class Platform extends React.Component {
    static contextType = ThemeContext;

    constructor(props, context) {
        super(props);
        
        this.problemIndex = {
            problems: problemPool,
        };
        this.completedProbs = new Set();
        this.lesson = null;

        this.metaLesson = null;
        this.metaLessonLessons = [];
        this.currentMetaLessonIndex = -1;
        this.completedMetaLessonLessons = new Set();

        this.user = context.user || {};
        console.debug("USER: ", this.user)
        this.isPrivileged = !!this.user.privileged;
        this.context = context;

        // Add each Q Matrix skill model attribute to each step
        for (const problem of this.problemIndex.problems) {
            for (
                let stepIndex = 0;
                stepIndex < problem.steps.length;
                stepIndex++
            ) {
                const step = problem.steps[stepIndex];
                step.knowledgeComponents = cleanArray(
                    context.skillModel[step.id] || []
                );
            }
        }
        if (this.props.lessonID == null) {
            this.state = {
                currProblem: null,
                status: "courseSelection",
                seed: seed,
            };
        } else {
            this.state = {
                currProblem: null,
                status: "courseSelection",
                seed: seed,
            };
        }

        this.selectLesson = this.selectLesson.bind(this);
    }

    componentDidMount() {
        this._isMounted = true;

        const { enterCourse, exitCourse} = this.props;

        const isHomePage = this.props.history.location.pathname === '/';
        if (isHomePage) {
            exitCourse();
            this.onComponentUpdate(null, null, null);
            return;
        }

        if (this.props.lessonID != null) {
            console.log("calling selectLesson from componentDidMount...") 
            const lesson =
                findLessonById(this.props.lessonID) ||
                findMetaLessonById(this.props.lessonID);
            console.debug("lesson: ", lesson)
            if (!lesson) {
                this.props.history.push("/");
                return;
            }
            this.selectLesson(lesson).then(
                (_) => {
                    console.debug(
                        "loaded lesson " + this.props.lessonID,
                        this.lesson
                    );
                }
            );

            // const { setLanguage } = this.props;
            
            // if (lesson.courseName == 'Matematik 4') {
            //     setLanguage('se')
            // } else {
            //     const defaultLocale = localStorage.getItem('defaultLocale');
            //     setLanguage(defaultLocale)
            // }

            const course = coursePlans.find(
                (c) =>
                    c.lessons.some((l) => l.id === this.props.lessonID) ||
                    (c.metaLessons || []).some((m) => m.id === this.props.lessonID)
            );
            
            if (course) {
                // Pass course ID and language from coursePlans.json
                enterCourse(course.courseName, course.language);
            }

        } else if (this.props.courseNum != null) {

            const course = coursePlans[parseInt(this.props.courseNum)];
            if (course) {
                enterCourse(course.courseName, course.language);
            }

            this.selectCourse(coursePlans[parseInt(this.props.courseNum)]);
        }


        this.onComponentUpdate(null, null, null);
    }

    componentWillUnmount() {
        this._isMounted = false;
        this.context.problemID = "n/a";
    }

    componentDidUpdate(prevProps, prevState, snapshot) {
        
        const { enterCourse, exitCourse } = this.props;
        
        // If navigating to home, exit course context
        if (this.props.history.location.pathname === '/' && 
            prevProps.history.location.pathname !== '/') {
            exitCourse();
        }
        
        // If lesson changed, update course context
        if (this.props.lessonID !== prevProps.lessonID && this.props.lessonID != null) {
            const lesson =
                findLessonById(this.props.lessonID) ||
                findMetaLessonById(this.props.lessonID);
            const course = coursePlans.find(
                (c) =>
                    c.lessons.some((l) => l.id === this.props.lessonID) ||
                    (c.metaLessons || []).some((m) => m.id === this.props.lessonID)
            );
            
            if (course) {
                enterCourse(course.courseName, course.language);
            }
            if (lesson) {
                this.selectLesson(lesson, false);
            } else {
                this.props.history.push("/");
            }
        }
        
        // If course changed
        if (this.props.courseNum !== prevProps.courseNum && this.props.courseNum != null) {
            const course = coursePlans[parseInt(this.props.courseNum)];
            if (course) {
                enterCourse(course.courseName, course.language);
            }
        }

        this.onComponentUpdate(prevProps, prevState, snapshot);
    }

    
    onComponentUpdate(prevProps, prevState, snapshot) {
        if (
            Boolean(this.state.currProblem?.id) &&
            this.context.problemID !== this.state.currProblem.id
        ) {
            this.context.problemID = this.state.currProblem.id;
        }
        if (this.state.status !== "learning") {
            this.context.problemID = "n/a";
        }
    }

    getProgressBarData() {
        if (!this.lesson) return { completed: 0, total: 0, percent: 0 };

        const lessonName = String(this.lesson.name.replace("Lesson ", "") + " " + this.lesson.topics);
        const problems = this.problemIndex.problems.filter(
            ({ lesson }) => String(lesson).includes(this.lesson.topics)
        );
        const completed = this.completedProbs.size;
        const total = problems.length;
        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
        return { completed, total, percent };
    }
    
    async selectLesson(lesson, updateServer=true) {
        if (lesson && lesson.type === "meta_lesson") {
            return this.selectMetaLesson(lesson, updateServer);
        }
        const context = this.context;
        console.debug("lesson: ", context)
        console.debug("update server: ", updateServer)
        console.debug("context: ", context)
        if (!this._isMounted) {
            console.debug("component not mounted, returning early (1)");
            return;
        }
        if (this.isPrivileged) {
            // from canvas or other LTI Consumers
            console.log("valid privilege")
            let err, response;
            [err, response] = await to(
                fetch(`${MIDDLEWARE_URL}/setLesson`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        token: context?.jwt || this.context?.jwt || "",
                        lesson,
                    }),
                })
            );
            if (err || !response) {
                toast.error(
                    `Error setting lesson for assignment "${this.user.resource_link_title}"`
                );
                console.debug(err, response);
                return;
            } else {
                if (response.status !== 200) {
                    switch (response.status) {
                        case 400:
                            const responseText = await response.text();
                            let [message, ...addInfo] = responseText.split("|");
                            if (
                                Array.isArray(addInfo) &&
                                addInfo[0].length > 1
                            ) {
                                addInfo = JSON.parse(addInfo[0]);
                            }
                            switch (message) {
                                case "resource_already_linked":
                                    toast.error(
                                        `${addInfo.from} has already been linked to lesson ${addInfo.to}. Please create a new assignment.`,
                                        {
                                            toastId:
                                                ToastID.set_lesson_duplicate_error.toString(),
                                        }
                                    );
                                    return;
                                default:
                                    toast.error(`Error: ${responseText}`, {
                                        toastId:
                                            ToastID.expired_session.toString(),
                                        closeOnClick: true,
                                    });
                                    return;
                            }
                        case 401:
                            toast.error(
                                `Your session has either expired or been invalidated, please reload the page to try again.`,
                                {
                                    toastId: ToastID.expired_session.toString(),
                                }
                            );
                            this.props.history.push("/session-expired");
                            return;
                        case 403:
                            toast.error(
                                `You are not authorized to make this action. (Are you an instructor?)`,
                                {
                                    toastId: ToastID.not_authorized.toString(),
                                }
                            );
                            return;
                        default:
                            toast.error(
                                `Error setting lesson for assignment "${this.user.resource_link_title}." If reloading does not work, please contact us.`,
                                {
                                    toastId:
                                        ToastID.set_lesson_unknown_error.toString(),
                                }
                            );
                            return;
                    }
                } else {
                    toast.success(
                        `Successfully linked assignment "${this.user.resource_link_title}" to lesson ${lesson.id} "${lesson.topics}"`,
                        {
                            toastId: ToastID.set_lesson_success.toString(),
                        }
                    );
                    const responseText = await response.text();
                    let [message, ...addInfo] = responseText.split("|");
                    this.props.history.push(
                        `/assignment-already-linked?to=${addInfo.to}`
                    );
                }
            }
        }

        this.lesson = lesson;

        const loadLessonProgress = async () => {
            const { getByKey } = this.context.browserStorage;
            return await getByKey(
                LESSON_PROGRESS_STORAGE_KEY(this.lesson.id)
            ).catch((err) => {});
        };

        const [, prevCompletedProbs] = await Promise.all([
            this.props.loadBktProgress(),
            loadLessonProgress(),
        ]);
        if (!this._isMounted) {
            console.debug("component not mounted, returning early (2)");
            return;
        }
        if (prevCompletedProbs) {
            console.debug(
                "student has already made progress w/ problems in this lesson before",
                prevCompletedProbs
            );
            this.completedProbs = new Set(prevCompletedProbs);
        }
        this.setState(
            {
                currProblem: this._nextProblem(
                    this.context ? this.context : context
                ),
            },
            () => {
                //console.log(this.state.currProblem);
                //console.log(this.lesson);
            }
        );
    }

    async selectMetaLesson(metaLesson, updateServer = true) {
        const order = metaLesson.order || "sequence";
        const choose = metaLesson.choose || "all";

        const resolvedLessonIds = resolveMetaLessonBranchAware(
            metaLesson,
            findLessonById,
            findMetaLessonById
        );

        if (resolvedLessonIds.length === 0) {
            console.error("Meta lesson contains no valid lessons:", metaLesson);
            toast.error("Meta lesson contains no valid lessons.");
            this.props.history.push("/");
            return;
        }

        this.metaLesson = metaLesson;
        this.completedMetaLessonLessons = new Set();

        const META_LESSON_PATH_KEY = `meta_lesson_path_${metaLesson.id}`;
        const { getByKey, setByKey } = this.context.browserStorage;

        const loadMetaLessonProgress = async () => {
            return await getByKey(
                LESSON_PROGRESS_STORAGE_KEY(metaLesson.id)
            ).catch(() => {});
        };

        const loadSavedMetaLessonPath = async () => {
            return await getByKey(META_LESSON_PATH_KEY).catch(() => {});
        };

        const [, prevMetaLessonProgress, savedPathRaw] = await Promise.all([
            this.props.loadBktProgress(),
            loadMetaLessonProgress(),
            loadSavedMetaLessonPath(),
        ]);

        if (prevMetaLessonProgress) {
            this.completedMetaLessonLessons = new Set(prevMetaLessonProgress);
        }

        const getValidRandomChoose1Paths = (targetMetaLesson) => {
            const validPaths = [];
            const childLessonIds = Array.isArray(targetMetaLesson.lessons)
                ? targetMetaLesson.lessons
                : [];

            for (const childId of childLessonIds) {
                const lesson = findLessonById(childId);
                if (lesson && !lesson.type) {
                    validPaths.push([childId]);
                    continue;
                }

                const nestedMetaLesson = findMetaLessonById(childId);
                if (nestedMetaLesson && nestedMetaLesson.type === "meta_lesson") {
                    const nestedPath = resolveMetaLesson(
                        nestedMetaLesson,
                        findLessonById,
                        findMetaLessonById
                    );
                    if (nestedPath.length > 0) {
                        validPaths.push(nestedPath);
                    }
                }
            }

            return validPaths;
        };

        const isValidRandomChoose1Path = (path, targetMetaLesson) => {
            if (!Array.isArray(path) || path.length === 0) {
                return false;
            }
            if (!path.every((id) => typeof id === "string" && findLessonById(id))) {
                return false;
            }

            const validPaths = getValidRandomChoose1Paths(targetMetaLesson);
            return validPaths.some(
                (validPath) =>
                    validPath.length === path.length &&
                    validPath.every((id, index) => id === path[index])
            );
        };

        const isValidSequenceAllPath = (path, resolvedIds) => {
            if (!Array.isArray(path) || path.length !== resolvedIds.length) {
                return false;
            }
            const sortedPath = [...path].sort();
            const sortedResolved = [...resolvedIds].sort();
            const sameElements = sortedPath.every((id, i) => id === sortedResolved[i]);
            const allExist = path.every((id) => findLessonById(id));
            return sameElements && allExist;
        };

        let lessonsToShow;

        if (order === "random" && choose === "all") {
            lessonsToShow = applyMetaLessonLogic(resolvedLessonIds, order, choose);
        } else if (order === "random" && choose === "1") {
            if (isValidRandomChoose1Path(savedPathRaw, metaLesson)) {
                lessonsToShow = [...savedPathRaw];
            } else {
                lessonsToShow = [...resolvedLessonIds];
                await setByKey(META_LESSON_PATH_KEY, lessonsToShow).catch(() => {});
            }
        } else if (order === "sequence" && choose === "all") {
            if (isValidSequenceAllPath(savedPathRaw, resolvedLessonIds)) {
                lessonsToShow = [...savedPathRaw];
            } else {
                lessonsToShow = applyMetaLessonLogic(resolvedLessonIds, order, choose);
                await setByKey(META_LESSON_PATH_KEY, lessonsToShow).catch(() => {});
            }
        } else {
            lessonsToShow = applyMetaLessonLogic(resolvedLessonIds, order, choose);
        }

        console.log("[selectMetaLesson TEST] rootMetaLessonId:", metaLesson.id);
        console.log("[selectMetaLesson TEST] order:", order);
        console.log("[selectMetaLesson TEST] choose:", choose);
        console.log("[selectMetaLesson TEST] resolvedLessonIds:", resolvedLessonIds);
        console.log("[selectMetaLesson TEST] finalSelectedLessonPath:", lessonsToShow);

        this.metaLessonLessons = lessonsToShow;
        this.currentMetaLessonIndex = 0;

        if (this.completedMetaLessonLessons.size > 0) {
            for (let i = 0; i < this.metaLessonLessons.length; i++) {
                if (!this.completedMetaLessonLessons.has(this.metaLessonLessons[i])) {
                    this.currentMetaLessonIndex = i;
                    break;
                }
            }
        }

        if (this.currentMetaLessonIndex < this.metaLessonLessons.length) {
            const firstLessonId = this.metaLessonLessons[this.currentMetaLessonIndex];
            const firstLesson = findLessonById(firstLessonId);

            if (firstLesson) {
                return this.selectLesson(
                    {
                        ...firstLesson,
                        isPartOfMetaLesson: true,
                        metaLessonId: metaLesson.id,
                        metaLessonName: metaLesson.name,
                    },
                    updateServer
                );
            }
        }

        this.setState({ status: "graduated" });
    }

    hasRemainingMetaLessonLessons() {
        return (
            this.metaLesson &&
            this.metaLessonLessons.length > 0 &&
            this.currentMetaLessonIndex < this.metaLessonLessons.length - 1
        );
    }

    handleMetaSubLessonComplete = async () => {
        const currentLessonId = this.metaLessonLessons[this.currentMetaLessonIndex];
        console.log("[Meta Progression TEST] completed sub-lesson:", currentLessonId);
        console.log("[Meta Progression TEST] current index:", this.currentMetaLessonIndex);
        console.log("[Meta Progression TEST] meta lesson path:", this.metaLessonLessons);

        this.completedMetaLessonLessons.add(currentLessonId);
        const { setByKey } = this.context.browserStorage;
        await setByKey(
            LESSON_PROGRESS_STORAGE_KEY(this.metaLesson.id),
            Array.from(this.completedMetaLessonLessons)
        ).catch(() => {});

        if (this.hasRemainingMetaLessonLessons()) {
            console.log("[Meta Progression TEST] showing meta progression screen");
            this.setState({ status: "metaLessonProgress", currProblem: null });
            return;
        }

        this.setState({ status: "graduated", currProblem: null });
        this.metaLesson = null;
        this.metaLessonLessons = [];
        this.currentMetaLessonIndex = -1;
        this.completedMetaLessonLessons = new Set();
    };

    continueMetaLesson = async () => {
        console.log("[Meta Progression TEST] continuing to next sub-lesson");
        await this.nextMetaLessonLesson();
    };

    async nextMetaLessonLesson() {
        if (!this.metaLesson || this.metaLessonLessons.length === 0) return;

        console.log("[Meta Progression TEST] current index:", this.currentMetaLessonIndex);
        console.log("[Meta Progression TEST] meta lesson path:", this.metaLessonLessons);

        this.currentMetaLessonIndex++;

        while (this.currentMetaLessonIndex < this.metaLessonLessons.length) {
            const nextLessonId = this.metaLessonLessons[this.currentMetaLessonIndex];
            const nextLesson = findLessonById(nextLessonId);

            if (nextLesson) {
                this.completedProbs = new Set();

                await this.selectLesson(
                    {
                        ...nextLesson,
                        isPartOfMetaLesson: true,
                        metaLessonId: this.metaLesson.id,
                        metaLessonName: this.metaLesson.name,
                    },
                    false
                );

                if (this._isMounted) {
                    this.setState({ status: "learning" });
                }
                return;
            }
            this.currentMetaLessonIndex++;
        }

        this.setState({ status: "graduated", currProblem: null });
        this.metaLesson = null;
        this.metaLessonLessons = [];
        this.currentMetaLessonIndex = -1;
        this.completedMetaLessonLessons = new Set();
    }

    isMetaLessonSidebarMode() {
        return Boolean(
            this.metaLesson &&
            this.metaLessonLessons.length > 0 &&
            (this.lesson?.isPartOfMetaLesson ||
                findMetaLessonById(this.props.lessonID)?.id === this.metaLesson.id ||
                this.state.status === "metaLessonProgress")
        );
    }

    renderMetaLessonSidebar() {
        console.log("[Meta Sidebar TEST] metaLesson:", this.metaLesson);
        console.log("[Meta Sidebar TEST] metaLessonLessons:", this.metaLessonLessons);
        console.log("[Meta Sidebar TEST] currentMetaLessonIndex:", this.currentMetaLessonIndex);

        const metaName = this.metaLesson?.name || "Meta lesson";
        const totalCount = this.metaLessonLessons.length;
        const completedCount = this.completedMetaLessonLessons.size;
        const currentIndex = this.currentMetaLessonIndex;
        const stepNumber = currentIndex >= 0 ? Math.min(currentIndex + 1, totalCount) : 1;

        return (
            <>
                <div style={{ marginBottom: 16, marginTop: 10 }}>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>{metaName}</div>
                    <div style={{ color: "#5F6368", fontSize: 13, marginTop: 8 }}>
                        {completedCount} of {totalCount} completed
                    </div>
                    {totalCount > 0 && (
                        <div style={{ color: "#5F6368", fontSize: 13 }}>
                            Step {stepNumber} of {totalCount}
                        </div>
                    )}
                </div>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, width: "100%" }}>
                    {this.metaLessonLessons.map((lessonId, index) => {
                        const lesson = findLessonById(lessonId);
                        const label =
                            lesson?.name ||
                            lesson?.topics ||
                            (lesson ? lesson.id : null) ||
                            "Unavailable lesson";
                        const isCompleted = this.completedMetaLessonLessons.has(lessonId);
                        const isCurrent = index === currentIndex;
                        const borderColor = isCurrent ? "#0B9B8A" : isCompleted ? "#0B9B8A" : "#EBEFF2";
                        const backgroundColor = isCurrent ? "#F0FAF8" : "#ffffff";
                        const opacity = isCompleted && !isCurrent ? 0.75 : 1;

                        return (
                            <li
                                key={lessonId}
                                style={{
                                    backgroundColor,
                                    padding: "12px 16px",
                                    borderLeft: `4px solid ${borderColor}`,
                                    marginBottom: 8,
                                    opacity,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 8,
                                }}
                            >
                                <span style={{ fontSize: 14, fontWeight: isCurrent ? 600 : 400 }}>
                                    {label}
                                </span>
                                {isCompleted && (
                                    <span style={{ fontSize: 12, color: "#0B9B8A", flexShrink: 0 }}>
                                        Done
                                    </span>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </>
        );
    }

    renderMetaLessonProgressScreen() {
        const completedCount = this.completedMetaLessonLessons.size;
        const totalCount = this.metaLessonLessons.length;
        const metaName = this.metaLesson?.name || "Meta lesson";

        return (
            <div
                style={{
                    minHeight: "60vh",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                }}
            >
                <h1>Sub-lesson complete</h1>
                <p>{metaName}</p>
                <p>
                    {completedCount} of {totalCount} lessons completed
                </p>
                <div style={{ display: "flex", gap: 20, marginTop: 36 }}>
                    <Button variant="contained" color="primary" onClick={this.continueMetaLesson}>
                        Continue to Next Lesson
                    </Button>
                    <Button
                        variant="outlined"
                        color="primary"
                        onClick={() => this.props.history.push("/")}
                    >
                        Back to Home
                    </Button>
                </div>
            </div>
        );
    }

    selectCourse = (course, context) => {
        this.course = course;
        this.setState({
            status: "lessonSelection",
        });
    };

    _nextProblem = (context) => {
        seed = Date.now().toString();
        this.setState({ seed: seed });
        this.props.saveProgress();
        const problems = this.problemIndex.problems.filter(
            ({ courseName }) => !courseName.toString().startsWith("!!")
        );
        let chosenProblem;

        console.debug(
            "Platform.js: sample of available problems",
            problems.slice(0, 10)
        );

        for (const problem of problems) {
            // Calculate the mastery for this problem
            let probMastery = 1;
            let isRelevant = false;
            for (const step of problem.steps) {
                if (typeof step.knowledgeComponents === "undefined") {
                    continue;
                }
                for (const kc of step.knowledgeComponents) {
                    if (typeof context.bktParams[kc] === "undefined") {
                        console.log("BKT Parameter " + kc + " does not exist.");
                        continue;
                    }
                    if (kc in this.lesson.learningObjectives) {
                        isRelevant = true;
                    }
                    // Multiply all the mastery priors
                    if (!(kc in context.bktParams)) {
                        console.log("Missing BKT parameter: " + kc);
                    }
                    probMastery *= context.bktParams[kc].probMastery;
                }
            }
            if (isRelevant) {
                problem.probMastery = probMastery;
            } else {
                problem.probMastery = null;
            }
        }

        console.debug(
            `Platform.js: available problems ${problems.length}, completed problems ${this.completedProbs.size}`
        );
        chosenProblem = context.heuristic(problems, this.completedProbs);
        console.debug("Platform.js: chosen problem", chosenProblem);

        const objectives = Object.keys(this.lesson.learningObjectives);
        console.debug("Platform.js: objectives", objectives);
        let score = objectives.reduce((x, y) => {
            return x + context.bktParams[y].probMastery;
        }, 0);
        score /= objectives.length;
        this.displayMastery(score);
        //console.log(Object.keys(context.bktParams).map((skill) => (context.bktParams[skill].probMastery <= this.lesson.learningObjectives[skill])));

        // There exists a skill that has not yet been mastered (a True)
        // Note (number <= null) returns false
        if (
            !Object.keys(context.bktParams).some(
                (skill) =>
                    context.bktParams[skill].probMastery <= MASTERY_THRESHOLD
            )
        ) {
            if (this.lesson?.isPartOfMetaLesson && this.metaLesson) {
                return null;
            }
            this.setState({ status: "graduated" });
            console.log("Graduated");
            return null;
        } else if (chosenProblem == null) {
            console.debug("no problems were chosen");
            // We have finished all the problems
            if (this.lesson && !this.lesson.allowRecycle) {
                // If we do not allow problem recycle then we have exhausted the pool
                this.setState({ status: "exhausted" });
                return null;
            } else {
                this.completedProbs = new Set();
                chosenProblem = context.heuristic(
                    problems,
                    this.completedProbs
                );
            }
        }

        if (chosenProblem) {
            this.setState({ currProblem: chosenProblem, status: "learning" });
            // console.log("Next problem: ", chosenProblem.id);
            console.debug("problem information", chosenProblem);
            this.context.firebase.startedProblem(
                chosenProblem.id,
                chosenProblem.courseName,
                chosenProblem.lesson,
                this.lesson.learningObjectives
            );
            return chosenProblem;
        } else {
            console.debug("still no chosen problem..? must be an error");
        }
    };

    problemComplete = async (context) => {
        this.completedProbs.add(this.state.currProblem.id);
        const { setByKey } = this.context.browserStorage;
        await setByKey(
            LESSON_PROGRESS_STORAGE_KEY(this.lesson.id),
            this.completedProbs
        ).catch((error) => {
            this.context.firebase.submitSiteLog(
                "site-error",
                `componentName: Platform.js`,
                {
                    errorName: error.name || "n/a",
                    errorCode: error.code || "n/a",
                    errorMsg: error.message || "n/a",
                    errorStack: error.stack || "n/a",
                },
                this.state.currProblem.id
            );
        });

        if (this.lesson.enableCompletionMode) {
            const relevantKc = {};
            Object.keys(this.lesson.learningObjectives).forEach((x) => {
                relevantKc[x] = context.bktParams[x]?.probMastery ?? 0;
            });

            // Check if all problems are completed or all skills 
            const progressData = this.getProgressBarData();
            const progressPercent = progressData.percent / 100;

            const allProblemsCompleted = progressData.completed === progressData.total;
            if (allProblemsCompleted) {
                console.debug("updateCanvas called because lesson is complete");
            }

            this.updateCanvas(progressPercent, relevantKc);
        }

        const nextProblem = this._nextProblem(context);

        if (!nextProblem && this.lesson?.isPartOfMetaLesson && this.metaLesson) {
            await this.handleMetaSubLessonComplete();
        }
    };

    updateCanvas = async (mastery, components) => {
        if (this.context.jwt) {
            console.debug("updating canvas with problem score");

            let err, response;
            [err, response] = await to(
                fetch(`${MIDDLEWARE_URL}/postScore`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        token: this.context?.jwt || "",
                        mastery,
                        components,
                    }),
                })
            );
            if (err || !response) {
                toast.error(
                    `An unknown error occurred trying to submit this problem. If reloading does not work, please contact us.`,
                    {
                        toastId: ToastID.submit_grade_unknown_error.toString(),
                    }
                );
                console.debug(err, response);
            } else {
                if (response.status !== 200) {
                    switch (response.status) {
                        case 400:
                            const responseText = await response.text();
                            let [message, ...addInfo] = responseText.split("|");
                            if (
                                Array.isArray(addInfo) &&
                                addInfo.length > 0 &&
                                addInfo[0]
                            ) {
                                addInfo = JSON.parse(addInfo[0]);
                            }
                            switch (message) {
                                case "lost_link_to_lms":
                                    toast.error(
                                        "It seems like the link back to your LMS has been lost. Please re-open the assignment to make sure your score is saved.",
                                        {
                                            toastId:
                                                ToastID.submit_grade_link_lost.toString(),
                                        }
                                    );
                                    return;
                                case "unable_to_handle_score":
                                    toast.warn(
                                        "Something went wrong and we can't update your score right now. Your progress will be saved locally so you may continue working.",
                                        {
                                            toastId:
                                                ToastID.submit_grade_unable.toString(),
                                            closeOnClick: true,
                                        }
                                    );
                                    return;
                                default:
                                    toast.error(`Error: ${responseText}`, {
                                        closeOnClick: true,
                                    });
                                    return;
                            }
                        case 401:
                            toast.error(
                                `Your session has either expired or been invalidated, please reload the page to try again.`,
                                {
                                    toastId: ToastID.expired_session.toString(),
                                }
                            );
                            return;
                        case 403:
                            toast.error(
                                `You are not authorized to make this action. (Are you a registered student?)`,
                                {
                                    toastId: ToastID.not_authorized.toString(),
                                }
                            );
                            return;
                        default:
                            toast.error(
                                `An unknown error occurred trying to submit this problem. If reloading does not work, please contact us.`,
                                {
                                    toastId:
                                        ToastID.set_lesson_unknown_error.toString(),
                                }
                            );
                            return;
                    }
                } else {
                    console.debug("successfully submitted grade to Canvas");
                }
            }
        } else {
            const { getByKey, setByKey } = this.context.browserStorage;
            const showWarning =
                !(await getByKey(CANVAS_WARNING_STORAGE_KEY)) &&
                SHOW_NOT_CANVAS_WARNING;
            if (showWarning) {
                toast.warn(
                    "No credentials found (did you launch this assignment from Canvas?)",
                    {
                        toastId: ToastID.warn_not_from_canvas.toString(),
                        autoClose: false,
                        onClick: () => {
                            toast.dismiss(
                                ToastID.warn_not_from_canvas.toString()
                            );
                        },
                        onClose: () => {
                            setByKey(CANVAS_WARNING_STORAGE_KEY, 1);
                        },
                    }
                );
            } else {
                // can ignore
            }
        }
    };


    displayMastery = (mastery) => {
        this.setState({ mastery: mastery });
        if (mastery >= MASTERY_THRESHOLD) {
            if (this.lesson?.isPartOfMetaLesson) {
                return;
            }
            toast.success("You've successfully completed this assignment!", {
                toastId: ToastID.successfully_completed_lesson.toString(),
            });
        }
    };

    render() {
        const { translate } = this.props;
        this.studentNameDisplay = this.context.studentName
        ? decodeURIComponent(this.context.studentName) + " | "
        : translate('platform.LoggedIn') + " | ";

        const inLesson = Boolean(this.props.lessonID);
        const showMetaSidebar =
            inLesson &&
            this.isMetaLessonSidebarMode() &&
            (this.state.status === "learning" || this.state.status === "metaLessonProgress");

        const headerLesson =
            findLessonById(this.props.lessonID) ||
            findMetaLessonById(this.props.lessonID);

        return (
            <div
                style={{
                    backgroundColor: "#F6F6F6",
                    paddingBottom: 20,
                    display: "flex",
                    flexDirection: "column",
                }}
            >
                <AppBar position="static">
                    <Toolbar>
                        <Grid
                            container
                            spacing={0}
                            role={"navigation"}
                            alignItems={"center"}
                        >
                            <Grid item xs={3} key={1}>
                                <BrandLogoNav
                                    isPrivileged={this.isPrivileged}
                                />
                            </Grid>
                            <Grid item xs={6} key={2}>
                                <div
                                    style={{
                                        textAlign: "center",
                                        textAlignVertical: "center",
                                        paddingTop: "3px",
                                    }}
                                >
                                    {headerLesson
                                        ? `${headerLesson.name || ""} ${headerLesson.topics || ""}`.trim()
                                        : this.metaLesson?.name || ""}
                                </div>
                            </Grid>
                            <Grid item xs={3} key={3}>
                                <div
                                    style={{
                                        textAlign: "right",
                                        paddingTop: "3px",
                                    }}
                                >
                                    {this.state.status !== "courseSelection" &&
                                    this.state.status !== "lessonSelection" &&
                                    (this.lesson.showStuMastery == null ||
                                        this.lesson.showStuMastery)
                                        ? this.studentNameDisplay +
                                        translate('platform.Mastery') +
                                          Math.round(this.state.mastery * 100) +
                                          "%"
                                        : ""}
                                </div>
                            </Grid>
                        </Grid>
                    </Toolbar>
                </AppBar>

                {/* Progress Bar */}
                {this.lesson?.enableCompletionMode && (
                    <div style={{ padding: "10px 20px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                            <span>Progress</span>
                            <span>{this.getProgressBarData().percent}% ({this.getProgressBarData().completed}/{this.getProgressBarData().total})</span>
                        </div>
                        <LinearProgress
                            variant="determinate"
                            value={this.getProgressBarData().percent}
                            style={{ height: 10, borderRadius: 5 }}
                        />
                    </div>
                )}

                <div style={{ display: "flex", flex: 1 }}>
                    {showMetaSidebar ? (
                        <div
                            style={{
                                width: 280,
                                flexShrink: 0,
                                padding: 16,
                                backgroundColor: "#FFFFFF",
                                borderRight: "1px solid #EBEFF2",
                                alignSelf: "flex-start",
                                minHeight: "calc(100vh - 120px)",
                            }}
                        >
                            {this.renderMetaLessonSidebar()}
                        </div>
                    ) : (
                        ""
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                        {this.state.status === "courseSelection" ? (
                            <LessonSelectionWrapper
                                selectLesson={this.selectLesson}
                                selectCourse={this.selectCourse}
                                history={this.props.history}
                                removeProgress={this.props.removeProgress}
                            />
                        ) : (
                            ""
                        )}
                        {this.state.status === "lessonSelection" ? (
                            <LessonSelectionWrapper
                                selectLesson={this.selectLesson}
                                removeProgress={this.props.removeProgress}
                                history={this.props.history}
                                courseNum={this.props.courseNum}
                            />
                        ) : (
                            ""
                        )}
                        {this.state.status === "learning" ? (
                            <ErrorBoundary
                                componentName={"Problem"}
                                descriptor={"problem"}
                            >
                                <ProblemWrapper
                                    problem={this.state.currProblem}
                                    problemComplete={this.problemComplete}
                                    lesson={this.lesson}
                                    seed={this.state.seed}
                                    lessonID={this.props.lessonID}
                                    displayMastery={this.displayMastery}
                                    progressPercent={this.getProgressBarData().percent / 100}
                                />
                            </ErrorBoundary>
                        ) : (
                            ""
                        )}
                        {this.state.status === "metaLessonProgress" ? (
                            this.renderMetaLessonProgressScreen()
                        ) : (
                            ""
                        )}
                        {this.state.status === "exhausted" ? (
                            <center>
                                <h2>
                                    Thank you for learning with {SITE_NAME}. You have
                                    finished all problems.
                                </h2>
                            </center>
                        ) : (
                            ""
                        )}
                        {this.state.status === "graduated" ? (
                            <center>
                                <h2>
                                    Thank you for learning with {SITE_NAME}. You have
                                    mastered all the skills for this session!
                                </h2>
                            </center>
                        ) : (
                            ""
                        )}
                    </div>
                </div>
            </div>
        );
    }
}

// export default withRouter(withTranslation(Platform));

export default withRouter(withTranslation((props) => (
    <LocalizationConsumer>
        {({ language, enterCourse, exitCourse }) => (
            <Platform
                {...props}
                language={language}
                enterCourse={enterCourse}
                exitCourse={exitCourse}
            />
        )}
    </LocalizationConsumer>
)));
