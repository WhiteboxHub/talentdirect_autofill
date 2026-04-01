(() => {
    if (typeof window !== "undefined" && window.__autofillJobListingsIntegrationLoaded) {
        return;
    }
    if (typeof window !== "undefined") {
        window.__autofillJobListingsIntegrationLoaded = true;
    }
    const APPLY_NOW_LABEL = "Apply Now";
    let injectedToolbar = false;
    let injectedFloating = false;

    function showListingToast(message, isError) {
        let el = document.getElementById("autofill-resume-extension-toast");
        if (!el) {
            el = document.createElement("div");
            el.id = "autofill-resume-extension-toast";
            el.setAttribute("role", "status");
            Object.assign(el.style, {
                position: "fixed",
                bottom: "24px",
                right: "24px",
                maxWidth: "min(360px, calc(100vw - 32px))",
                padding: "12px 16px",
                borderRadius: "8px",
                fontSize: "14px",
                lineHeight: "1.4",
                fontFamily: "system-ui, sans-serif",
                zIndex: "2147483647",
                boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                display: "none"
            });
            document.body.appendChild(el);
        }
        el.textContent = message;
        el.style.background = isError ? "#fef2f2" : "#f0fdf4";
        el.style.color = isError ? "#991b1b" : "#166534";
        el.style.border = isError ? "1px solid #fecaca" : "1px solid #bbf7d0";
        if (el._toastTimer) clearTimeout(el._toastTimer);
        el.style.display = "block";
        el._toastTimer = setTimeout(() => {
            el.style.display = "none";
        }, 6000);
    }

    function normalizeUrl(url) {
        if (!url) return null;
        const trimmed = String(url).trim();
        if (!trimmed || trimmed === "#" || trimmed.startsWith("javascript:")) return null;
        try {
            return new URL(trimmed, window.location.href).href;
        } catch (_) {
            return null;
        }
    }

    /**
     * Collect job URLs in table row order (first row → first in queue).
     * With Job URL / Apply column: only that column; empty Apply rows are skipped (queue starts at first row with a link).
     * Without that column: data-job-url or ATS-like links per row (fallback).
     */
    function extractUrlsFromTable() {
        const urls = [];
        const seen = new Set();

        function add(u) {
            const n = normalizeUrl(u);
            if (!n || seen.has(n)) return;
            if (/^(mailto|tel|javascript):/i.test(n)) return;
            seen.add(n);
            urls.push(n);
        }

        function normalizeHeaderText(cell) {
            return (cell.textContent || "").trim().toLowerCase().replace(/\s+/g, " ");
        }

        /** Job Listings: "Job URL". Candidate dashboard (screenshot): last column "Apply" with external link. */
        function columnHeaderIsUrlColumn(cell) {
            const t = normalizeHeaderText(cell);
            if (/^job\s*url$|^joburl$|^apply\s*url$|^application\s*url$|^apply$/.test(t) || t === "job url") {
                return true;
            }
            const colId = (cell.getAttribute("col-id") || cell.getAttribute("data-field") || "")
                .trim()
                .toLowerCase();
            return /^(apply|joburl|job_url|applyurl)$/.test(colId);
        }

        function findUrlColumnIndexInHeaderRow(headerRow) {
            if (!headerRow) return -1;
            const cells = headerRow.querySelectorAll(
                "th, td, [role='columnheader'], .ag-header-cell"
            );
            for (let i = 0; i < cells.length; i++) {
                if (columnHeaderIsUrlColumn(cells[i])) return i;
            }
            return -1;
        }

        function findJobUrlColumnIndex(table) {
            const headerRow = table.querySelector("thead tr") || table.querySelector("tr");
            return findUrlColumnIndexInHeaderRow(headerRow);
        }

        /** AG Grid (Whitebox job board): headers are .ag-header-cell; last column is "Apply". */
        function findAgGridUrlColumnIndex(root) {
            const headerRow =
                root.querySelector(".ag-header-row[role='row']") || root.querySelector(".ag-header-row");
            return findUrlColumnIndexInHeaderRow(headerRow);
        }

        const tableColIndex = new Map();
        document.querySelectorAll("table").forEach((table) => {
            const j = findJobUrlColumnIndex(table);
            if (j >= 0) tableColIndex.set(table, j);
        });

        const gridColIndex = new Map();
        document.querySelectorAll(".ag-root-wrapper, .ag-root").forEach((root) => {
            if (root.classList.contains("ag-root") && root.closest(".ag-root-wrapper")) return;
            const j = findAgGridUrlColumnIndex(root);
            if (j >= 0) gridColIndex.set(root, j);
        });

        document.querySelectorAll("[role='grid']").forEach((grid) => {
            if (grid.closest(".ag-root-wrapper, .ag-root")) return;
            const headerRow = Array.from(grid.querySelectorAll("[role='row']")).find((row) =>
                row.querySelector("[role='columnheader']")
            );
            const j = findUrlColumnIndexInHeaderRow(headerRow);
            if (j >= 0) gridColIndex.set(grid, j);
        });

        function cellsForDataRow(row) {
            const tds = row.querySelectorAll("td");
            if (tds.length) return tds;
            return row.querySelectorAll("[role='gridcell'], .ag-cell");
        }

        /** Only Job URL / Apply cell; never Title. Returns true if a URL was added. */
        function tryAddFromUrlColumnCell(cell) {
            if (!cell) return false;
            const anchors = cell.querySelectorAll("a[href]");
            for (const a of anchors) {
                const href = normalizeUrl(a.getAttribute("href"));
                if (!href || /^(mailto|tel|javascript):/i.test(href)) continue;
                add(href);
                return true;
            }
            const txt = (cell.textContent || "").trim();
            if (/^https?:\/\//i.test(txt)) {
                add(txt);
                return true;
            }
            return false;
        }

        const rowWalker = document.querySelectorAll(
            "table tbody tr, table tbody [role='row'], [role='grid'] [role='row']:not([role='columnheader']), .ag-body [role='row'], .ag-center-cols-container [role='row']"
        );

        rowWalker.forEach((tr) => {
            if (tr.closest("thead")) return;
            if (tr.querySelector && tr.querySelector("[data-autofill-apply-now]")) return;

            const fromData = tr.getAttribute("data-job-url");
            if (fromData) {
                add(fromData);
                return;
            }

            const cellData = tr.querySelector("[data-job-url]");
            if (cellData && cellData.getAttribute("data-job-url")) {
                add(cellData.getAttribute("data-job-url"));
                return;
            }

            const table = tr.closest("table");
            if (table && tableColIndex.has(table)) {
                const colIdx = tableColIndex.get(table);
                const cells = cellsForDataRow(tr);
                const cell = cells[colIdx];
                tryAddFromUrlColumnCell(cell);
                return;
            }

            const gridRoot =
                tr.closest(".ag-root-wrapper") || tr.closest(".ag-root") || tr.closest("[role='grid']");
            if (gridRoot && gridColIndex.has(gridRoot)) {
                const colIdx = gridColIndex.get(gridRoot);
                const cells = cellsForDataRow(tr);
                const cell = cells[colIdx];
                tryAddFromUrlColumnCell(cell);
                return;
            }

            const links = tr.querySelectorAll('a[href^="http"], a[href^="//"]');
            for (const a of links) {
                const href = normalizeUrl(a.getAttribute("href"));
                if (!href) continue;
                if (
                    /greenhouse|lever|workday|myworkdayjobs|ashby|icims|jobvite|smartrecruiters|taleo|workable|bamboohr|successfactors|adp|recruitee|teamtailor|personio|paycom|paychex|oraclecloud|applytojob|brassring|rippling|linkedin|indeed/i.test(href) ||
                    /\/(job|jobs|apply|careers)\b/i.test(href)
                ) {
                    add(href);
                    return;
                }
            }
        });

        return urls;
    }

    function startQueueFromListingPage() {
        const urls = extractUrlsFromTable();
        if (!urls.length) {
            showListingToast(
                "No job URLs found. Add a Job URL column or data-job-url on rows with http(s) links, then try again.",
                true
            );
            return;
        }

        chrome.runtime.sendMessage({ action: "start_apply_queue", urls }, (response) => {
            const err = chrome.runtime.lastError;
            if (err) {
                showListingToast(
                    "Queue could not start. Reload the extension, refresh this page, then try again. (" +
                        err.message +
                        ")",
                    true
                );
                return;
            }
            if (!response || !response.ok) {
                showListingToast(response?.error || "Could not start queue.", true);
                return;
            }
            showListingToast(`Apply queue started: ${urls.length} job(s). First job opens in a new window.`, false);
            console.log(`AutoFill Extension: Apply queue started (${urls.length} jobs).`);
        });
    }

    function createApplyNowButton() {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = APPLY_NOW_LABEL;
        btn.title = "Open each job apply link in order (uses links in this table)";
        btn.style.marginLeft = "8px";
        btn.style.padding = "6px 10px";
        btn.style.border = "1px solid #d1d5db";
        btn.style.borderRadius = "6px";
        btn.style.background = "#ffffff";
        btn.style.cursor = "pointer";
        btn.style.fontSize = "12px";
        btn.addEventListener("click", startQueueFromListingPage);
        return btn;
    }

    function injectNearToolbar() {
        if (injectedToolbar) return;

        const candidates = Array.from(document.querySelectorAll("button, div, span, a, p, h1, h2"));
        const anchorText = /autofill extension|job listings|search jobs/i;
        const node = candidates.find((n) => anchorText.test(n.textContent || ""));
        if (!node) return;

        const wrapper =
            node.closest("header, [class*='toolbar'], [class*='Toolbar'], .flex, div") || node.parentElement;
        if (!wrapper) return;
        if (wrapper.querySelector('[data-autofill-apply-now="1"]')) return;

        const btn = createApplyNowButton();
        btn.dataset.autofillApplyNow = "1";
        wrapper.appendChild(btn);
        injectedToolbar = true;
    }

    function injectFloatingButton() {
        if (injectedFloating || document.querySelector('[data-autofill-apply-now-floating="1"]')) return;
        const table = document.querySelector("table, [role='grid'], [class*='ag-root']");
        if (!table) return;

        const wrap = document.createElement("div");
        wrap.dataset.autofillApplyNowFloating = "1";
        wrap.style.cssText =
            "position:fixed;bottom:20px;right:20px;z-index:2147483646;padding:0;font-family:system-ui,sans-serif;";
        const btn = createApplyNowButton();
        btn.style.cssText =
            "margin:0;padding:10px 14px;border:1px solid #4338ca;border-radius:8px;background:#4f46e5;color:#fff;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,.15);";
        btn.addEventListener("click", () => startQueueFromListingPage());
        wrap.appendChild(btn);
        document.body.appendChild(wrap);
        injectedFloating = true;
    }

    const observer = new MutationObserver(() => {
        injectNearToolbar();
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
    injectNearToolbar();
    setTimeout(injectFloatingButton, 2000);

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "collect_and_start_queue") {
            const urls = extractUrlsFromTable();
            if (!urls.length) {
                sendResponse({
                    ok: false,
                    error:
                        "No job URLs found. Ensure the Job URL column has links, or set data-job-url on each row. Scroll so rows are visible."
                });
                return false;
            }
            chrome.runtime.sendMessage({ action: "start_apply_queue", urls }, (response) => {
                const err = chrome.runtime.lastError;
                if (err) {
                    sendResponse({ ok: false, error: err.message });
                    return;
                }
                sendResponse(response || { ok: false, error: "Unknown error" });
            });
            return true;
        }
    });
})();
