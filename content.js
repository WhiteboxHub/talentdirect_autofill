// ... (previous code above remains the same)

function extractJobMetadata() {
    let company = "", role = "";
    const gC = document.querySelector('.company-name'), gR = document.querySelector('.app-title');
    if (gC) company = gC.innerText.trim(); if (gR) role = gR.innerText.trim();
    const lR = document.querySelector('.posting-header h2'), lC = document.querySelector('.posting-header .company-logo img')?.alt;
    if (lR) role = lR.innerText.trim(); if (lC) company = lC.replace(" logo", "").trim();
    if (!company || !role) {
        const m = document.title.match(/(.+) (at|\||-) (.+)/i);
        if (m) { role = m[1].trim(); company = m[3].trim(); } else role = document.title;
    }
    return { company: company.substring(0, 50) || "Company", role: role.substring(0, 70) || "Job" };
}

function extractJobDescription() {
    const ss = [
        '.job-description', '#job-description', '.description',
        '[class*="jobDescription"]', '[id*="jobDescription"]',
        '.posting-description', '.job-info', 'main', 'article',
        '#main-content', '.main-content'
    ];
    for (const s of ss) {
        const e = document.querySelector(s);
        if (e && e.innerText.trim().length > 300) {
            // Remove scripts, styles and other junk from innerText if possible
            const clone = e.cloneNode(true);
            clone.querySelectorAll('script, style, nav, footer, header').forEach(n => n.remove());
            const text = clone.innerText.trim();
            if (text.length > 300) return text.substring(0, 5000);
        }
    }
    // Fallback to body but try to find the largest text container
    return document.body.innerText.substring(0, 5000);
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