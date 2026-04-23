// content.js

// content.js

let autoFillState = {
    hasRun: false,
    debouncing: false
};

// Listen for messages from popup (Manual fallback or Edits)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fill_form") {
        console.log("AutoFill: Received manual trigger", request.normalizedData);
        fillForm(request.normalizedData, request.aiEnabled, true);
        sendResponse({ status: "done" });
    } else if (request.action === "apply_edits") {
        console.log("AutoFill: Received edits from Side Panel", request.edits);
        applyEdits(request.edits);
        sendResponse({ status: "done" });
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
            // Need a way to call setInputValue which is inside the strategy. 
            // For simplicity, we just replicate the dispatch logic here since it's a direct override.
            input.value = edit.value;

            ['input', 'change', 'blur'].forEach(eventType => {
                const event = new Event(eventType, { bubbles: true });
                input.dispatchEvent(event);
            });

            // Flash green to confirm edit application
            const originalBg = input.style.backgroundColor;
            const originalBorder = input.style.border;
            input.style.backgroundColor = "#dcfce7";
            input.style.border = "2px solid #22c55e";

            setTimeout(() => {
                input.style.backgroundColor = originalBg;
                input.style.border = originalBorder;
            }, 3000);
        }
    });
}

/**
 * Triggers the fill routine if it hasn't run recently for the current form state.
 */
function attemptAutoFill() {
    if (autoFillState.debouncing) return;

    autoFillState.debouncing = true;
    setTimeout(() => {
        chrome.storage.local.get(['normalizedData', 'aiEnabled'], (result) => {
            if (result.normalizedData) {
                console.log("AutoFill: Automatically executing using cached normalized data");
                fillForm(result.normalizedData, result.aiEnabled || false, false);
            }
        });
        autoFillState.debouncing = false;
    }, 1500); // 1.5s debounce to let the SPA settle
}

// 1. Listen for DOM Ready
window.addEventListener('load', attemptAutoFill);

// 2. Listen for SPA Route Changes
// Overriding pushState/replaceState since popstate doesn't always catch internal route changes
const originalPushState = history.pushState;
history.pushState = function (...args) {
    originalPushState.apply(this, args);
    attemptAutoFill();
};
const originalReplaceState = history.replaceState;
history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    attemptAutoFill();
};
window.addEventListener('popstate', attemptAutoFill);

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
observer.observe(document.body, { childList: true, subtree: true });

function fillForm(normalizedData, aiEnabled, isManualTrigger = false) {
    console.log("Detected URL:", window.location.href);

    const strategy = ATSStrategyRegistry.getStrategy(window.location.href, document);
    strategy.execute(normalizedData, aiEnabled);
}

// ==========================================
// CLI Bridge Integration
// ==========================================
window.addEventListener('JOBCLI_START_FILL', async (event) => {
    console.log("AutoFill: Received JOBCLI_START_FILL from Playwright.");
    try {
        const response = await fetch("http://127.0.0.1:8080/api/v1/context").catch(() => null);
        
        if (!response || !response.ok) {
            console.warn("AutoFill: CLI server not reachable or returned error. Falling back to cached data if any.");
            attemptAutoFill();
            window.dispatchEvent(new CustomEvent('JOBCLI_FILL_COMPLETE', { detail: { error: "Fetch failed" } }));
            return;
        }
        
        const data = await response.json();
        
        await chrome.storage.local.set({ 
            cli_resume: data.resume,
            cli_memory: data.memory,
            normalizedData: data.resume 
        });

        console.log("AutoFill: Successfully fetched and cached CLI context.");

        // Execute Autofill
        fillForm(data.resume, true, true);
        
        // Wait a bit for async DOM changes (React updates)
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Generate MVP fillReport
        const report = {
            url: window.location.href,
            success_count: Object.keys(data.resume?.personal || {}).length, // simple proxy for MVP
            failure_count: 0,
            fields_filled: data.resume?.personal || {},
            unfilled_fields: []
        };

        // Send Feedback to CLI
        await fetch("http://127.0.0.1:8080/api/v1/report", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(report)
        });

        console.log("AutoFill: Sent fillReport to CLI.");
        
        window.dispatchEvent(new CustomEvent('JOBCLI_FILL_COMPLETE'));
        
    } catch (err) {
        console.error("AutoFill CLI Integration Error:", err);
        window.dispatchEvent(new CustomEvent('JOBCLI_FILL_COMPLETE', { detail: { error: err.message } }));
    }
});
