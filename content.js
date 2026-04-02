// content.js
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
/** @type {null | (() => void)} */
let queueSubmitWatchCleanup = null;

/** Block rapid re-runs (mutations + load + queue) that duplicate alerts / prompts */
let fillCooldownUntil = 0;
const FILL_COOLDOWN_MS = 5000;

/**
 * After any successful fill for `pageKey()`, block *automatic* re-fills (load/mutation/SPA)
 * so user edits are not overwritten. Force Fill and queue use manual=true and bypass this.
 */
let fillCompletedPageKey = null;

function pageKey() {
    return location.origin + location.pathname + location.search;
}

function shouldSkipAutomaticFill() {
    return fillCompletedPageKey !== null && fillCompletedPageKey === pageKey();
}

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
                _warn("ResumeProcessor.normalize failed", e);
            }
        }
        callback(normalized, result.aiEnabled || false);
    });
}

// Listen for messages from popup (Manual fallback or Edits)
// With manifest "all_frames": true, this script runs in every iframe. Only the top frame may
// call sendResponse — Chrome allows one response per tabs.sendMessage; duplicate responses
// cause persistent runtime/connection errors in the service worker and side panel.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (window !== window.top) {
        return;
    }
    if (request.action === "ping_content") {
        sendResponse({ status: "ready" });
        return;
    }
    if (request.action === "fill_form") {
        if (window !== window.top) {
            sendResponse({ status: "skipped", reason: "not_top_frame" });
            return;
        }
        _log("Received manual trigger");
        const ran = fillForm(request.normalizedData, request.aiEnabled, true);
        sendResponse({ status: ran ? "done" : "skipped" });
        return;
    }
    if (request.action === "apply_edits") {
        if (window !== window.top) {
            sendResponse({ status: "skipped", reason: "not_top_frame" });
            return;
        }
        _log("Received edits from Side Panel");
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
        let input = document.getElementById(edit.id);
        if (!input && edit.id) {
            try {
                input = document.querySelector(`[name="${CSS.escape(edit.id)}"]`);
            } catch (_) { /* invalid selector */ }
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
    if (shouldSkipAutomaticFill()) {
        _log("Automatic fill skipped — already completed for this page");
        return;
    }

    autoFillState.debouncing = true;
    setTimeout(() => {
        loadNormalizedDataFromStorage((normalized, aiEnabled) => {
            autoFillState.debouncing = false;
            if (!normalized) {
                return;
            }
            fillForm(normalized, aiEnabled, false);
        });
    }, 1500);
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
        _log("Queue: re-armed success detection after navigation");
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
    if (shouldTrigger && !shouldSkipAutomaticFill()) {
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
    if (!isManualTrigger && shouldSkipAutomaticFill()) {
        _log("fillForm: automatic run skipped — already filled this URL");
        return false;
    }

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
        _log("Skipping page - not a likely application form");
        return false;
    }

    const now = Date.now();
    if (!isManualTrigger && now < fillCooldownUntil) {
        _log("Skipped duplicate run (cooldown)");
        return false;
    }

    _log("Fill on:", window.location.hostname);

    const strategy = ATSStrategyRegistry.getStrategy(window.location.href, document);
    strategy.execute(normalizedData, aiEnabled);
    fillCooldownUntil = Date.now() + FILL_COOLDOWN_MS;
    fillCompletedPageKey = pageKey();
    return true;
}

let lastHeartbeatAt = 0;
function sendAtsHeartbeat() {
    if (window !== window.top) return;
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
                _warn("Queue mode: no resume in storage");
                return;
            }
            fillForm(normalized, aiEnabled, true);
        });
    };

    tryQueueFill();
    setTimeout(tryQueueFill, 2800);
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

/** Keep patterns aligned with background.js isQueueBlockedOrUnusableUrl when updating either file. */
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
        /we have received your application/i,
        /application complete/i,
        /successfully submitted/i,
        /you have successfully applied/i,
        /your application (was|is) successfully submitted/i,
        /candidacy.*submitted/i,
        // Duplicate / cooldown — same outcome for the queue: nothing left to do on this job; advance
        /your application was already submitted/i,
        /application was already submitted/i,
        /you (have|had) already (applied|submitted)/i,
        /you('ve| have) already applied/i,
        /already applied (for|to) (this|the) (job|role|position)/i,
        /duplicate (application|submission)/i,
        /we received your previous application/i,
        /submit a new application.*after your last application/i,
        /cannot submit another application/i,
        /unable to submit.*already/i
    ];

    // Narrow URL matches — avoid substring "submitted" inside unrelated words (e.g. "resubmitted").
    const urlSuccessPatterns = [
        /\/confirmation(?:\/|\?|#|$)/i,
        /\/thank[-_/]?you/i,
        /\/success(?:\/|\?|#|$)/i,
        /\/application[-_]?(?:submitted|complete)/i,
        /[?&](?:submitted|success)=/i,
        // Workday post-apply URLs (see background.js isQueueSuccessUrl)
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
        const combined =
            (document.title || "") +
            "\n" +
            (document.body?.innerText || "").slice(0, 15000);
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

    // Do NOT advance the queue on Submit click or form "submit" — that fires before validation and
    // before navigation, and moveNext() would point queueRuntime.tabId at the *next* job tab while
    // the user is still on the current tab. Only treat success when URL/DOM match the thank-you
    // page (and background.js matches /confirmation on the same tab).
    const cleanups = [];

    if (runChecks()) {
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
        runChecks();
    });
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
            () => {
                void chrome.runtime.lastError;
            }
        );
    } catch (_) {
        void 0;
    }
}

})();
