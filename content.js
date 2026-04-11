// content.js
/* global chrome, ResumeProcessor, ATSStrategyRegistry */
/* eslint-env browser */

(function () {
if (window.__AUTOFILL_RESUME_CONTENT_INIT__) return;
window.__AUTOFILL_RESUME_CONTENT_INIT__ = true;

const _AF_DEBUG = false;
const _log = _AF_DEBUG ? console.log.bind(console, '[AutoFill]') : () => {};
const _warn = _AF_DEBUG ? console.warn.bind(console, '[AutoFill]') : () => {};

let autoFillState = {
    debouncing: false
};
let queueMonitorState = {
    runId: null,
    armed: false
};
let queueSubmitWatchCleanup = null;

let openAIFillInFlight = false;
let partialRefillTimer = null;
let knownFieldIds = new Set();
let fillCooldownUntil = 0;
const FILL_COOLDOWN_MS = 3000;

let fillCompletedPageKey = null;
function pageKey() {
    return location.origin + location.pathname + location.search;
}
function shouldSkipAutomaticFill() {
    return fillCompletedPageKey !== null && fillCompletedPageKey === pageKey();
}

function loadNormalizedDataFromStorage(callback) {
    chrome.storage.local.get(["normalizedData", "resumeData", "aiEnabled"], (result) => {
        let normalized = result.normalizedData;
        if (
            (!normalized || (typeof normalized === "object" && Object.keys(normalized).length === 0)) &&
            result.resumeData &&
            typeof ResumeProcessor !== "undefined"
        ) {
            try {
                normalized = ResumeProcessor.normalize(result.resumeData);
            } catch (e) {
                _warn("ResumeProcessor.normalize failed", e);
            }
        }
        callback(normalized, result.aiEnabled || false, result.resumeData || null);
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (window !== window.top) return;

    if (request.action === "ping_content") {
        sendResponse({ status: "ready" });
        return;
    }

    if (request.action === "fill_form") {
        runFillEverythingFlow(request.normalizedData, request.data || null, {
            manual: true,
            source: "manual_click"
        }).then((ran) => {
            sendResponse({ status: ran ? "done" : "skipped" });
        }).catch((err) => {
            _warn("fill_form failed", err);
            sendResponse({ status: "skipped", error: String(err?.message || err) });
        });
        return true;
    }

    if (request.action === "apply_edits") {
        applyEdits(request.edits || []);
        sendResponse({ status: "done" });
        return;
    }

    if (request.action === "queue_begin_job") {
        beginQueueJob(request);
        sendResponse({ status: "started" });
        return;
    }
});

async function runFillEverythingFlow(normalizedData, resumeDataFromMessage, opts = {}) {
    const { manual = false, source = "unknown", partial = false } = opts;

    if (!manual && shouldSkipAutomaticFill()) return false;
    if (!manual && Date.now() < fillCooldownUntil) return false;
    if (openAIFillInFlight) return false;
    if (!manual && !isLikelyApplicationPage()) return false;

    openAIFillInFlight = true;
    try {
        const formSchema = scrapeFormStructure();
        if (!formSchema.length) return false;

        if (!partial) knownFieldIds = new Set(formSchema.map((f) => f.fieldId));
        else formSchema.forEach((f) => knownFieldIds.add(f.fieldId));

        const resumeData = resumeDataFromMessage || await getResumeDataFromStorage(normalizedData);
        const aiRes = await sendMessagePromise({
            action: "ACTION_FILL_ALL",
            resumeData,
            formSchema,
            context: {
                url: location.href,
                hostname: location.hostname,
                source,
                partial
            }
        });

        if (!aiRes || aiRes.ok !== true || !aiRes.plan) {
            if (aiRes?.useFallbackStrategy) {
                const fallbackRan = runAtsFallback(normalizedData);
                if (fallbackRan) markFillComplete();
                return fallbackRan;
            }
            return false;
        }

        executeFillPlan(aiRes.plan, formSchema);
        markFillComplete();
        return true;
    } catch (err) {
        _warn("OpenAI flow exception, ATS fallback:", err);
        const fallbackRan = runAtsFallback(normalizedData);
        if (fallbackRan) markFillComplete();
        return fallbackRan;
    } finally {
        fillCooldownUntil = Date.now() + FILL_COOLDOWN_MS;
        openAIFillInFlight = false;
    }
}

function runAtsFallback(normalizedData) {
    try {
        if (!normalizedData) return false;
        if (typeof ATSStrategyRegistry === "undefined") return false;
        const strategy = ATSStrategyRegistry.getStrategy(window.location.href, document);
        strategy.execute(normalizedData, true);
        return true;
    } catch (err) {
        _warn("ATS fallback failed", err);
        return false;
    }
}

function markFillComplete() {
    fillCompletedPageKey = pageKey();
}

function scrapeFormStructure() {
    const docs = collectAccessibleDocuments(window);
    const schema = [];
    const radioGroups = new Map();

    docs.forEach(({ doc, framePath }) => {
        const fields = queryDeep(doc, "input,select,textarea");
        fields.forEach((el, index) => {
            if (!(el instanceof Element)) return;
            if (!isCandidateField(el)) return;

            const tagName = (el.tagName || "").toLowerCase();
            const type = ((el.getAttribute("type") || tagName || "text")).toLowerCase();
            const id = el.id || "";
            const name = el.getAttribute("name") || "";
            const label = getFieldLabel(el, doc);
            const placeholder = el.getAttribute("placeholder") || "";
            const required = !!el.required || el.getAttribute("aria-required") === "true";
            const disabled = !!el.disabled;
            const visible = isVisible(el);
            const fieldId = buildStableFieldId(el, framePath, index);
            const currentValue = readCurrentValue(el);

            const item = {
                fieldId,
                id,
                name,
                tagName,
                type,
                label,
                placeholder,
                required,
                disabled,
                visible,
                framePath,
                currentValue,
                options: []
            };

            if (tagName === "select") {
                item.options = Array.from(el.options || []).map((o) => (o.textContent || "").trim()).filter(Boolean);
            }
            if (type === "radio") {
                const key = radioGroupKey(item);
                if (!radioGroups.has(key)) radioGroups.set(key, []);
                radioGroups.get(key).push(item);
            }
            schema.push(item);
        });
    });

    for (const field of schema) {
        if (field.type !== "radio") continue;
        const key = radioGroupKey(field);
        const group = radioGroups.get(key) || [];
        field.options = group.map((g) => g.label || g.currentValue || g.name || "");
    }

    return schema;
}

function collectAccessibleDocuments(rootWindow, path = "top", bucket = []) {
    try {
        if (rootWindow?.document) bucket.push({ doc: rootWindow.document, framePath: path });
    } catch (_) {}
    let frames = [];
    try {
        frames = Array.from(rootWindow.frames || []);
    } catch (_) {
        frames = [];
    }
    frames.forEach((child, i) => {
        try {
            void child.document;
            collectAccessibleDocuments(child, `${path}>iframe[${i}]`, bucket);
        } catch (_) {}
    });
    return bucket;
}

function queryDeep(root, selector) {
    const out = [];
    const seen = new Set();

    function walk(node) {
        if (!node || !node.querySelectorAll) return;
        const local = node.querySelectorAll(selector);
        for (const el of local) {
            if (!seen.has(el)) {
                seen.add(el);
                out.push(el);
            }
        }
        const all = node.querySelectorAll("*");
        for (const el of all) {
            if (el.shadowRoot) walk(el.shadowRoot);
        }
    }

    walk(root);
    return out;
}

function isCandidateField(el) {
    const tag = (el.tagName || "").toLowerCase();
    if (!["input", "select", "textarea"].includes(tag)) return false;
    const type = ((el.getAttribute("type") || "").toLowerCase());
    if (type === "hidden") return false;
    return true;
}

function getFieldLabel(el, doc) {
    const byFor = el.id ? doc.querySelector(`label[for="${cssEscape(el.id)}"]`) : null;
    if (byFor && byFor.textContent) return cleanLabel(byFor.textContent);

    const wrapped = el.closest("label");
    if (wrapped && wrapped.textContent) return cleanLabel(wrapped.textContent);

    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) return cleanLabel(ariaLabel);

    const ariaLabelledBy = el.getAttribute("aria-labelledby");
    if (ariaLabelledBy) {
        const ids = ariaLabelledBy.split(/\s+/).filter(Boolean);
        const txt = ids
            .map((id) => {
                const n = doc.getElementById(id);
                return n?.textContent ? cleanLabel(n.textContent) : "";
            })
            .filter(Boolean)
            .join(" ");
        if (txt) return txt;
    }

    const placeholder = el.getAttribute("placeholder");
    if (placeholder) return cleanLabel(placeholder);

    const container = el.closest("div,fieldset,section,li,td");
    if (container) {
        const candidate = container.querySelector("label,legend,[class*='label'],[data-testid*='label']");
        if (candidate?.textContent) return cleanLabel(candidate.textContent);
    }
    return "";
}

function cleanLabel(text) {
    return String(text || "").replace(/\s+/g, " ").replace(/\*+/g, "").trim();
}

function readCurrentValue(el) {
    const tag = (el.tagName || "").toLowerCase();
    const type = ((el.getAttribute("type") || tag)).toLowerCase();
    if (type === "checkbox" || type === "radio") return el.checked ? "checked" : "";
    return el.value || "";
}

function buildStableFieldId(el, framePath, indexHint) {
    const id = el.id || "";
    const name = el.getAttribute("name") || "";
    const type = ((el.getAttribute("type") || el.tagName || "field")).toLowerCase();
    const tag = (el.tagName || "field").toLowerCase();
    if (id) return `${framePath}::id=${id}`;
    if (name) return `${framePath}::name=${name}::type=${type}::idx=${indexHint}`;
    return `${framePath}::tag=${tag}::type=${type}::idx=${indexHint}`;
}

function radioGroupKey(field) {
    return `${field.framePath}::${field.name || field.id || field.label || "radio"}`;
}

function cssEscape(value) {
    try {
        return CSS.escape(value);
    } catch (_) {
        return String(value || "").replace(/"/g, '\\"');
    }
}

function isVisible(el) {
    try {
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return false;
    } catch (_) {}
    return true;
}

function executeFillPlan(plan, formSchema) {
    const fills = Array.isArray(plan?.fills) ? plan.fills : [];
    if (!fills.length) return { filled: 0, skipped: 0, errors: 0 };

    const schemaById = new Map(formSchema.map((f) => [f.fieldId, f]));
    let filled = 0;
    let skipped = 0;
    let errors = 0;

    for (const step of fills) {
        const meta = schemaById.get(step.fieldId);
        if (!meta) {
            skipped += 1;
            continue;
        }
        try {
            if (meta.type === "radio") {
                const ok = fillRadio(meta, step, formSchema);
                if (ok) filled += 1; else skipped += 1;
                continue;
            }

            const el = resolveElement(meta);
            if (!el) {
                skipped += 1;
                continue;
            }

            if (meta.type === "checkbox") {
                const checked = !!step.checked;
                if (el.checked !== checked) el.click();
                dispatchFrameworkSafeEvents(el);
                filled += 1;
                continue;
            }

            if (meta.tagName === "select") {
                const ok = fillSelect(el, step.valueText);
                if (ok) {
                    dispatchFrameworkSafeEvents(el);
                    filled += 1;
                } else {
                    skipped += 1;
                }
                continue;
            }

            const next = step.valueText == null ? "" : String(step.valueText);
            el.value = next;
            dispatchFrameworkSafeEvents(el);
            filled += 1;
        } catch (err) {
            _warn("executeFillPlan step failed", step, err);
            errors += 1;
        }
    }
    return { filled, skipped, errors };
}

function fillSelect(selectEl, desiredTextRaw) {
    const desiredText = String(desiredTextRaw || "").trim();
    if (!desiredText) return false;
    const options = Array.from(selectEl.options || []);
    const exact = options.find((o) => cleanLabel(o.textContent || "") === desiredText);
    const normalized = options.find((o) => normalize(o.textContent || "") === normalize(desiredText));
    const best = exact || normalized;
    if (!best) return false;
    selectEl.value = best.value;
    return true;
}

function fillRadio(meta, step, fullSchema) {
    const group = fullSchema.filter((f) => f.type === "radio" && radioGroupKey(f) === radioGroupKey(meta));
    if (!group.length) return false;

    const idx = Number(step.choiceIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= group.length) return false;

    const targetMeta = group[idx];
    const targetEl = resolveElement(targetMeta);
    if (!targetEl) return false;

    if (!targetEl.checked) targetEl.click();
    dispatchFrameworkSafeEvents(targetEl);
    return true;
}

function resolveElement(meta) {
    const docs = collectAccessibleDocuments(window);
    const frameDoc = docs.find((d) => d.framePath === meta.framePath)?.doc || document;

    if (meta.id) {
        const byId = frameDoc.getElementById(meta.id);
        if (byId) return byId;
    }
    if (meta.name) {
        const allByName = queryDeep(frameDoc, `[name="${cssEscape(meta.name)}"]`);
        if (meta.type === "radio") {
            const matched = allByName.find((el) => normalize(getFieldLabel(el, frameDoc)) === normalize(meta.label));
            return matched || allByName[0] || null;
        }
        return allByName[0] || null;
    }

    const fallback = queryDeep(frameDoc, `${meta.tagName}`);
    return fallback.find((el) => ((el.getAttribute("type") || el.tagName).toLowerCase() === meta.type)) || fallback[0] || null;
}

function dispatchFrameworkSafeEvents(el) {
    ["input", "change", "blur"].forEach((eventType) => {
        el.dispatchEvent(new Event(eventType, { bubbles: true }));
    });
}

function normalize(v) {
    return String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function setupDynamicPartialRefillObserver() {
    const observer = new MutationObserver((mutations) => {
        let foundPotentialFields = false;

        for (const m of mutations) {
            if (!m.addedNodes || !m.addedNodes.length) continue;
            for (const n of m.addedNodes) {
                if (n.nodeType !== Node.ELEMENT_NODE) continue;
                const el = n;
                if (el.matches?.("input,select,textarea") || el.querySelector?.("input,select,textarea")) {
                    foundPotentialFields = true;
                    break;
                }
            }
            if (foundPotentialFields) break;
        }
        if (!foundPotentialFields || openAIFillInFlight) return;

        if (partialRefillTimer) clearTimeout(partialRefillTimer);
        partialRefillTimer = setTimeout(async () => {
            if (openAIFillInFlight || Date.now() < fillCooldownUntil) return;

            loadNormalizedDataFromStorage(async (normalized, _aiEnabled, resumeRaw) => {
                if (!normalized) return;

                const freshSchema = scrapeFormStructure();
                const newOrEmpty = freshSchema.filter((f) => {
                    const isNew = !knownFieldIds.has(f.fieldId);
                    const empty = !f.currentValue;
                    return isNew || empty;
                });
                if (!newOrEmpty.length) return;
                newOrEmpty.forEach((f) => knownFieldIds.add(f.fieldId));

                try {
                    openAIFillInFlight = true;
                    const aiRes = await sendMessagePromise({
                        action: "ACTION_FILL_ALL",
                        resumeData: resumeRaw || await getResumeDataFromStorage(normalized),
                        formSchema: newOrEmpty,
                        context: {
                            url: location.href,
                            hostname: location.hostname,
                            source: "mutation_partial",
                            partial: true
                        }
                    });

                    if (!aiRes || aiRes.ok !== true || !aiRes.plan) {
                        if (aiRes?.useFallbackStrategy) runAtsFallback(normalized);
                        return;
                    }
                    executeFillPlan(aiRes.plan, freshSchema);
                    fillCooldownUntil = Date.now() + FILL_COOLDOWN_MS;
                } catch (err) {
                    _warn("Partial refill failed, ATS fallback:", err);
                    runAtsFallback(normalized);
                } finally {
                    openAIFillInFlight = false;
                }
            });
        }, 700);
    });

    const observe = () => {
        const root = document.body || document.documentElement;
        if (!root) return;
        observer.observe(root, { childList: true, subtree: true });
    };
    if (document.body) observe();
    else document.addEventListener("DOMContentLoaded", observe);
}

function applyEdits(edits) {
    edits.forEach(edit => {
        let input = document.getElementById(edit.id);
        if (!input && edit.id) {
            try {
                input = document.querySelector(`[name="${cssEscape(edit.id)}"]`);
            } catch (_) {}
        }
        if (input) {
            input.value = edit.value;
            dispatchFrameworkSafeEvents(input);
        }
    });
}

function attemptAutoFill() {
    if (window !== window.top) return;
    if (autoFillState.debouncing) return;
    if (shouldSkipAutomaticFill()) return;

    autoFillState.debouncing = true;
    setTimeout(() => {
        loadNormalizedDataFromStorage((normalized, _aiEnabled, resumeRaw) => {
            autoFillState.debouncing = false;
            if (!normalized) return;
            runFillEverythingFlow(normalized, resumeRaw, {
                manual: false,
                source: "auto"
            }).catch((e) => _warn("attemptAutoFill failed", e));
        });
    }, 1200);
}

function maybeRearmQueueAfterNavigation() {
    if (window !== window.top) return;
    chrome.runtime.sendMessage({ action: "get_queue_context_for_tab" }, (res) => {
        if (chrome.runtime.lastError || !res || !res.active || !res.runId) return;
        queueMonitorState.runId = res.runId;
        queueMonitorState.armed = true;
        armSubmitDetection();
    });
}

function hookQueueRearm() {
    maybeRearmQueueAfterNavigation();
    setTimeout(maybeRearmQueueAfterNavigation, 600);
    setTimeout(maybeRearmQueueAfterNavigation, 2000);
}

window.addEventListener("load", attemptAutoFill);
window.addEventListener("load", hookQueueRearm);
window.addEventListener("pageshow", () => hookQueueRearm());
if (document.readyState === "complete") hookQueueRearm();
else document.addEventListener("DOMContentLoaded", () => hookQueueRearm());

const originalPushState = history.pushState;
history.pushState = function (...args) {
    originalPushState.apply(this, args);
    attemptAutoFill();
    hookQueueRearm();
};
const originalReplaceState = history.replaceState;
history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    attemptAutoFill();
    hookQueueRearm();
};
window.addEventListener("popstate", attemptAutoFill);
window.addEventListener("popstate", hookQueueRearm);

setupDynamicPartialRefillObserver();

function isLikelyApplicationPage() {
    const href = (window.location.href || "").toLowerCase();
    const urlHints = ["apply", "application", "career", "careers", "greenhouse", "lever.co", "workday", "myworkdayjobs"];
    if (urlHints.some((k) => href.includes(k))) return true;

    const form = document.querySelector("form");
    if (!form) return false;

    const inputCount = form.querySelectorAll("input, select, textarea").length;
    const hasSubmitLike = Array.from(form.querySelectorAll("button, input[type='submit'], a")).some((el) => {
        const txt = ((el.textContent || "") + " " + (el.value || "")).toLowerCase();
        return /apply|submit|continue|next/.test(txt);
    });
    return inputCount >= 3 && hasSubmitLike;
}

function isProbablyPreApplyLandingPage() {
    const href = (window.location.href || "").toLowerCase();
    if (href.includes("apply") || href.includes("application")) return false;
    if (document.querySelector('input[type="email"], input[id*="email" i], input[name*="email" i]')) return false;
    if (document.querySelector('input[id*="first_name" i], input[name*="first_name" i], input[id*="firstname" i]')) return false;
    return true;
}

function beginQueueJob(request) {
    queueMonitorState.runId = request.runId;
    queueMonitorState.armed = true;
    armSubmitDetection();

    setTimeout(() => {
        if (isProbablyPreApplyLandingPage()) clickApplyButtonIfPresent();
    }, 800);

    const tryQueueFill = () => {
        loadNormalizedDataFromStorage((normalized, _aiEnabled, resumeRaw) => {
            if (!normalized) {
                _warn("Queue mode: no resume in storage");
                return;
            }
            runFillEverythingFlow(normalized, resumeRaw, {
                manual: true,
                source: "queue"
            }).catch((e) => _warn("queue fill failed", e));
        });
    };
    tryQueueFill();
    setTimeout(tryQueueFill, 2600);
}

function clickApplyButtonIfPresent() {
    const selectors = [
        'a[href*="apply" i]',
        'button[aria-label*="Apply" i]',
        'a[aria-label*="Apply" i]',
        '[role="button"][aria-label*="Apply" i]'
    ];
    for (const selector of selectors) {
        const nodes = document.querySelectorAll(selector);
        for (const node of nodes) {
            const text = (node.textContent || "").trim();
            if (/^(easy apply|apply now|apply)$/i.test(text)) {
                node.click();
                return true;
            }
        }
    }
    return false;
}

function clearQueueSubmitWatch() {
    if (typeof queueSubmitWatchCleanup === "function") {
        try { queueSubmitWatchCleanup(); } catch (_) {}
    }
    queueSubmitWatchCleanup = null;
}

function isQueueBlockedPageUrl(u) {
    if (!u) return false;
    const str = String(u).toLowerCase();
    if (/community\.workday\.com/i.test(str) && /maintenance/i.test(str)) return true;
    if (/maintenance-page/i.test(str)) return true;
    if (/\/maintenance(?:\/|\?|#|$)/i.test(str)) return true;
    if (/\/service-unavailable/i.test(str)) return true;
    if (/\/503(?:\/|\?|#|$)/i.test(str)) return true;
    if (/\/50[24](?:\/|\?|#|$)/i.test(str)) return true;
    return false;
}

function matchesBlockedPageDom(combined) {
    const patterns = [
        /workday is currently unavailable/i,
        /we are experiencing a service interruption/i,
        /experiencing a service interruption/i,
        /service is temporarily unavailable/i,
        /site (is )?under maintenance/i
    ];
    return patterns.some((re) => re.test(combined));
}

function armSubmitDetection() {
    if (!queueMonitorState.armed) return;
    clearQueueSubmitWatch();

    const successPatterns = [
        /application submitted/i,
        /thank you for applying/i,
        /thank you for your interest/i,
        /your application has been submitted/i,
        /your application has been received/i,
        /we('ve| have) received your application/i,
        /application complete/i,
        /successfully submitted/i,
        /you have successfully applied/i,
        /your application (was|is) successfully submitted/i,
        /candidacy.*submitted/i
    ];

    const urlSuccessPatterns = [
        /\/confirmation(?:\/|\?|#|$)/i,
        /\/thank[-_/]?you/i,
        /\/success(?:\/|\?|#|$)/i,
        /\/application[-_]?(?:submitted|complete)/i,
        /[?&](?:submitted|success)=/i,
        /\/applyconfirmation/i,
        /\/apply-confirmation/i,
        /\/candidateconfirmation/i,
        /\/applicationstatus\/submitted/i
    ];

    let finished = false;
    const finish = (signal) => {
        if (finished || !queueMonitorState.armed) return;
        finished = true;
        clearQueueSubmitWatch();
        notifyQueueSubmitDetected(signal);
    };
    const finishBlocked = (signal) => {
        if (finished || !queueMonitorState.armed) return;
        finished = true;
        clearQueueSubmitWatch();
        notifyQueueSkipDetected(signal);
    };

    const checkBlockedHeuristic = () => {
        if (!queueMonitorState.armed || !queueMonitorState.runId) return false;
        const href = (window.location.href || "").toLowerCase();
        if (isQueueBlockedPageUrl(href)) {
            finishBlocked("blocked_url");
            return true;
        }
        const combined = (document.title || "") + "\n" + (document.body?.innerText || "").slice(0, 15000);
        if (matchesBlockedPageDom(combined)) {
            finishBlocked("blocked_dom");
            return true;
        }
        return false;
    };

    const checkSuccessHeuristic = () => {
        if (!queueMonitorState.armed || !queueMonitorState.runId) return false;
        if (urlSuccessPatterns.some((re) => re.test(window.location.href))) {
            finish("url_signal");
            return true;
        }
        const bodyText = (document.body?.innerText || "").slice(0, 20000);
        const titleText = document.title || "";
        const pageText = `${titleText}\n${bodyText}`;
        if (successPatterns.some((re) => re.test(pageText))) {
            finish("dom_signal");
            return true;
        }
        return false;
    };

    const runChecks = () => {
        if (checkBlockedHeuristic()) return true;
        return checkSuccessHeuristic();
    };

    const cleanups = [];
    if (runChecks()) {
        cleanups.forEach((fn) => fn());
        return;
    }

    const observerRoot = document.body || document.documentElement;
    if (!observerRoot) {
        queueSubmitWatchCleanup = () => cleanups.forEach((fn) => fn());
        return;
    }

    const observer = new MutationObserver(() => runChecks());
    observer.observe(observerRoot, { childList: true, subtree: true, characterData: true });
    cleanups.push(() => observer.disconnect());

    const urlPoll = setInterval(() => {
        if (!queueMonitorState.armed || finished) {
            clearInterval(urlPoll);
            return;
        }
        runChecks();
    }, 1200);
    cleanups.push(() => clearInterval(urlPoll));

    queueSubmitWatchCleanup = () => cleanups.forEach((fn) => fn());
}

function notifyQueueSubmitDetected(signal) {
    queueMonitorState.armed = false;
    clearQueueSubmitWatch();
    try {
        chrome.runtime.sendMessage(
            {
                action: "queue_submit_detected",
                runId: queueMonitorState.runId,
                signal
            },
            () => { void chrome.runtime.lastError; }
        );
    } catch (_) {}
}

function notifyQueueSkipDetected(signal) {
    queueMonitorState.armed = false;
    clearQueueSubmitWatch();
    try {
        chrome.runtime.sendMessage(
            {
                action: "queue_skip_job",
                runId: queueMonitorState.runId,
                signal
            },
            () => { void chrome.runtime.lastError; }
        );
    } catch (_) {}
}

function sendMessagePromise(payload) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage(payload, (response) => {
            if (chrome.runtime.lastError) {
                resolve({
                    ok: false,
                    useFallbackStrategy: true,
                    error: chrome.runtime.lastError.message
                });
                return;
            }
            resolve(response);
        });
    });
}

function getResumeDataFromStorage(normalizedFallback) {
    return new Promise((resolve) => {
        chrome.storage.local.get(["resumeData"], (res) => {
            resolve(res?.resumeData || normalizedFallback || {});
        });
    });
}

})();
