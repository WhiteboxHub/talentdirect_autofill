// content.js
(function () {
if (window.__AUTOFILL_RESUME_CONTENT_INIT__) return;
window.__AUTOFILL_RESUME_CONTENT_INIT__ = true;

let autoFillState = {
    hasRun: false,
    debouncing: false
};
let queueMonitorState = {
    runId: null,
    armed: false
};
/** @type {null | (() => void)} */
let queueSubmitWatchCleanup = null;

/** Block rapid re-runs (mutations + load + queue) that duplicate alerts / prompts */
let fillCooldownUntil = 0;
const FILL_COOLDOWN_MS = 5000;

/**
 * Queue and auto-fill read `normalizedData` from storage. If it is missing (stale profile sync)
 * but raw `resumeData` exists, normalize in-page — same shape as the side panel uses.
 */
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
                console.warn("AutoFill: ResumeProcessor.normalize failed", e);
            }
        }
        callback(normalized, result.aiEnabled || false);
    });
}

// Listen for messages from popup (Manual fallback or Edits)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "ping_content") {
        sendResponse({ status: "ready" });
        return;
    }
    if (request.action === "fill_form") {
        if (window !== window.top) {
            sendResponse({ status: "skipped", reason: "not_top_frame" });
            return;
        }
        console.log("AutoFill: Received manual trigger", request.normalizedData);
        const ran = fillForm(request.normalizedData, request.aiEnabled, true);
        sendResponse({ status: ran ? "done" : "skipped" });
        return;
    }
    if (request.action === "apply_edits") {
        if (window !== window.top) {
            sendResponse({ status: "skipped", reason: "not_top_frame" });
            return;
        }
        console.log("AutoFill: Received edits from Side Panel", request.edits);
        applyEdits(request.edits);
        sendResponse({ status: "done" });
        return;
    }
    if (request.action === "queue_begin_job") {
        if (window !== window.top) {
            sendResponse({ status: "skipped", reason: "not_top_frame" });
            return;
        }
        beginQueueJob(request);
        sendResponse({ status: "started" });
    }
});

function applyEdits(edits) {
    edits.forEach(edit => {
        // Attempt to find the input by ID, then name
        let input = document.getElementById(edit.id);
        if (!input) {
            input = document.querySelector(`[name="${edit.id}"]`);
        }

        if (input) {
            if (typeof GenericStrategy !== "undefined") {
                new GenericStrategy().setInputValue(input, edit.value, "green");
            } else {
                input.value = edit.value;
                ["input", "change", "blur"].forEach((eventType) => {
                    input.dispatchEvent(new Event(eventType, { bubbles: true }));
                });
            }
        }
    });
}

/**
 * Triggers the fill routine if it hasn't run recently for the current form state.
 */
function attemptAutoFill() {
    if (window !== window.top) return;
    if (autoFillState.debouncing) return;

    autoFillState.debouncing = true;
    setTimeout(() => {
        loadNormalizedDataFromStorage((normalized, aiEnabled) => {
            if (!normalized) {
                console.log("AutoFill: No resume in storage — open the side panel and load your JSON.");
                return;
            }
            console.log("AutoFill: Running with normalized resume data");
            fillForm(normalized, aiEnabled, false);
        });
        autoFillState.debouncing = false;
    }, 1500); // 1.5s debounce to let the SPA settle
}

/**
 * After submit, the browser does a full navigation to the thank-you page. The content script
 * restarts and loses in-memory queue watchers — re-arm from the background queue state.
 */
function maybeRearmQueueAfterNavigation() {
    if (window !== window.top) return;
    chrome.runtime.sendMessage({ action: "get_queue_context_for_tab" }, (res) => {
        if (chrome.runtime.lastError || !res || !res.active || !res.runId) return;
        queueMonitorState.runId = res.runId;
        queueMonitorState.armed = true;
        console.log("Apply queue: re-armed success detection for this tab after navigation.");
        armSubmitDetection();
    });
}

function hookQueueRearm() {
    maybeRearmQueueAfterNavigation();
    setTimeout(maybeRearmQueueAfterNavigation, 600);
    setTimeout(maybeRearmQueueAfterNavigation, 2000);
}

// 1. Listen for DOM Ready
window.addEventListener("load", attemptAutoFill);
window.addEventListener("load", sendAtsHeartbeat);
window.addEventListener("load", hookQueueRearm);
window.addEventListener("pageshow", () => {
    hookQueueRearm();
});
if (document.readyState === "complete") {
    hookQueueRearm();
} else {
    document.addEventListener("DOMContentLoaded", () => hookQueueRearm());
}

// 2. Listen for SPA Route Changes
// Overriding pushState/replaceState since popstate doesn't always catch internal route changes
const originalPushState = history.pushState;
history.pushState = function (...args) {
    originalPushState.apply(this, args);
    attemptAutoFill();
    sendAtsHeartbeat();
    hookQueueRearm();
};
const originalReplaceState = history.replaceState;
history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    attemptAutoFill();
    sendAtsHeartbeat();
    hookQueueRearm();
};
window.addEventListener("popstate", attemptAutoFill);
window.addEventListener("popstate", sendAtsHeartbeat);
window.addEventListener("popstate", hookQueueRearm);

// 3. Listen for Mutations (Dynamic Form Rendering)
const observer = new MutationObserver((mutations) => {
    let shouldTrigger = false;
    for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
            // Check if added nodes are form elements
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.tagName === 'INPUT' || node.tagName === 'SELECT' || node.tagName === 'TEXTAREA' || node.querySelector('input, select, textarea')) {
                        shouldTrigger = true;
                    }
                }
            });
        }
    }
    if (shouldTrigger) {
        attemptAutoFill();
    }
});

// Start observing the document body for injected form elements
if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
} else {
    document.addEventListener("DOMContentLoaded", () => {
        observer.observe(document.body, { childList: true, subtree: true });
    });
}

function fillForm(normalizedData, aiEnabled, isManualTrigger = false) {
    // Block internal job-board chrome on auto-fill. Queue / Force Fill use manual=true:
    // still block heavy AG Grid listing dashboards (column filters), but do not block
    // other pages that only loosely match "listings" heuristics.
    if (isJobListingDashboardPage()) {
        if (!isManualTrigger) return false;
        const agGridLike = document.querySelectorAll('input[id^="ag-"], input[id*="ag-"][id$="-input"]');
        if (agGridLike.length >= 2) return false;
    }

    // Only auto-fill (load/route/mutation) skips non-application pages.
    // Manual "Force Fill" and queue jobs must always run — URL may be short links,
    // company vanity domains, or the form may load after navigation.
    if (!isManualTrigger && !isLikelyApplicationPage()) {
        console.log("AutoFill: Skipping page - not a likely application form.");
        return false;
    }

    const now = Date.now();
    if (!isManualTrigger && now < fillCooldownUntil) {
        console.log("AutoFill: Skipped duplicate run (cooldown).");
        return false;
    }

    console.log("Detected URL:", window.location.href);

    const strategy = ATSStrategyRegistry.getStrategy(window.location.href, document);
    strategy.execute(normalizedData, aiEnabled);
    fillCooldownUntil = Date.now() + FILL_COOLDOWN_MS;
    return true;
}

let lastHeartbeatAt = 0;
function sendAtsHeartbeat() {
    const now = Date.now();
    if (now - lastHeartbeatAt < 2000) return;
    lastHeartbeatAt = now;
    try {
        chrome.runtime.sendMessage(
            {
                action: "ats_page_heartbeat",
                href: window.location.href
            },
            () => {
                void chrome.runtime.lastError;
            }
        );
    } catch (_) {
        /* extension context invalidated after reload */
    }
}

function isJobListingDashboardPage() {
    const title = (document.title || "").toLowerCase();
    const h1 = document.querySelector("h1");
    const h1Text = (h1 && h1.textContent) ? h1.textContent.toLowerCase() : "";
    const agGridLike = document.querySelectorAll('input[id^="ag-"], input[id*="ag-"][id$="-input"]');
    if (agGridLike.length >= 2) {
        return true;
    }
    const searchJobs = document.querySelector('input[placeholder*="search jobs" i], input[placeholder*="Search jobs" i]');
    if (searchJobs && (title.includes("job listing") || h1Text.includes("job listing"))) {
        return true;
    }
    if ((title.includes("job listings") || h1Text.includes("job listings")) && document.querySelector("table")) {
        return true;
    }
    return false;
}

function isLikelyApplicationPage() {
    const href = (window.location.href || "").toLowerCase();
    // Do not use generic "jobs" — it matches internal /jobs listing dashboards.
    const urlHints = [
        "apply",
        "application",
        "career",
        "careers",
        "greenhouse",
        "lever.co",
        "workday",
        "myworkdayjobs"
    ];
    if (urlHints.some((k) => href.includes(k))) {
        return true;
    }

    const form = document.querySelector("form");
    if (!form) return false;

    const inputCount = form.querySelectorAll("input, select, textarea").length;
    const hasSubmitLike = Array.from(form.querySelectorAll("button, input[type='submit'], a")).some((el) => {
        const txt = ((el.textContent || "") + " " + (el.value || "")).toLowerCase();
        return /apply|submit|continue|next/.test(txt);
    });

    return inputCount >= 3 && hasSubmitLike;
}

/** Only auto-click "Apply" on job description / landing pages — not on the application form itself. */
function isProbablyPreApplyLandingPage() {
    const href = (window.location.href || "").toLowerCase();
    if (href.includes("apply") || href.includes("application")) return false;
    if (document.querySelector('input[type="email"], input[id*="email" i], input[name*="email" i]'))
        return false;
    if (document.querySelector('input[id*="first_name" i], input[name*="first_name" i], input[id*="firstname" i]'))
        return false;
    return true;
}

function beginQueueJob(request) {
    queueMonitorState.runId = request.runId;
    queueMonitorState.armed = true;

    // Arm success detection immediately (URL / thank-you DOM only — not Submit clicks). Background
    // also advances on /confirmation for this tab.
    armSubmitDetection();

    setTimeout(() => {
        if (isProbablyPreApplyLandingPage()) {
            clickApplyButtonIfPresent();
        }
    }, 800);

    const tryQueueFill = () => {
        loadNormalizedDataFromStorage((normalized, aiEnabled) => {
            if (!normalized) {
                console.warn(
                    "Queue mode: no resume in storage. Open the side panel, load your JSON resume (or pick a profile), then start the queue again."
                );
                return;
            }
            fillForm(normalized, aiEnabled, true);
        });
    };

    tryQueueFill();
    setTimeout(tryQueueFill, 2200);
    setTimeout(tryQueueFill, 5200);
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
        try {
            queueSubmitWatchCleanup();
        } catch (_) {
            void 0;
        }
    }
    queueSubmitWatchCleanup = null;
}

function armSubmitDetection() {
    if (!queueMonitorState.armed) return;
    clearQueueSubmitWatch();

    const successPatterns = [
        /application submitted/i,
        /thank you for applying/i,
        /your application has been submitted/i,
        /your application has been received/i,
        /we('ve| have) received your application/i,
        /application complete/i
    ];

    // Narrow URL matches — avoid substring "submitted" inside unrelated words (e.g. "resubmitted").
    const urlSuccessPatterns = [
        /\/confirmation(?:\/|\?|#|$)/i,
        /\/thank[-_/]?you/i,
        /\/success(?:\/|\?|#|$)/i,
        /\/application[-_]?(?:submitted|complete)/i,
        /[?&](?:submitted|success)=/i
    ];

    let finished = false;
    const finish = (signal) => {
        if (finished || !queueMonitorState.armed) return;
        finished = true;
        clearQueueSubmitWatch();
        notifyQueueSubmitDetected(signal);
    };

    const checkSuccessHeuristic = () => {
        if (!queueMonitorState.armed || !queueMonitorState.runId) return false;
        if (urlSuccessPatterns.some((re) => re.test(window.location.href))) {
            finish("url_signal");
            return true;
        }
        const bodyText = (document.body?.innerText || "").slice(0, 20000);
        if (successPatterns.some((re) => re.test(bodyText))) {
            finish("dom_signal");
            return true;
        }
        return false;
    };

    // Do NOT advance the queue on Submit click or form "submit" — that fires before validation and
    // before navigation, and moveNext() would point queueRuntime.tabId at the *next* job tab while
    // the user is still on the current tab. Only treat success when URL/DOM match the thank-you
    // page (and background.js matches /confirmation on the same tab).
    const cleanups = [];

    if (checkSuccessHeuristic()) {
        cleanups.forEach((fn) => fn());
        return;
    }

    const observerRoot = document.body || document.documentElement;
    if (!observerRoot) {
        queueSubmitWatchCleanup = () => {
            cleanups.forEach((fn) => fn());
        };
        return;
    }

    const observer = new MutationObserver(() => {
        checkSuccessHeuristic();
    });
    observer.observe(observerRoot, { childList: true, subtree: true, characterData: true });
    cleanups.push(() => observer.disconnect());

    const urlPoll = setInterval(() => {
        if (!queueMonitorState.armed || finished) {
            clearInterval(urlPoll);
            return;
        }
        checkSuccessHeuristic();
    }, 1200);
    cleanups.push(() => clearInterval(urlPoll));

    queueSubmitWatchCleanup = () => {
        cleanups.forEach((fn) => fn());
    };
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
            () => {
                void chrome.runtime.lastError;
            }
        );
    } catch (_) {
        void 0;
    }
}

})();
