/* global chrome */
(() => {
    if (typeof window !== "undefined" && window.__autofillJobListingsIntegrationLoaded) {
        return;
    }
    if (typeof window !== "undefined") {
        window.__autofillJobListingsIntegrationLoaded = true;
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

    /** AG Grid keeps only visible rows in the DOM; scroll the body viewport to collect every row. */
    function findAgBodyScrollViewport() {
        const selectors = [
            ".ag-body-viewport",
            ".ag-center-cols-viewport",
            ".ag-body-vertical-scroll-viewport"
        ];
        for (const sel of selectors) {
            const nodes = document.querySelectorAll(sel);
            for (const el of nodes) {
                if (el.scrollHeight > el.clientHeight + 8) return el;
            }
        }
        return null;
    }

    /**
     * Merge URLs from repeated extractUrlsFromTable() calls while scrolling (virtualized grids).
     */
    async function collectUrlsForQueue() {
        const merged = [];
        const seen = new Set();
        function mergeBatch() {
            for (const u of extractUrlsFromTable()) {
                if (!seen.has(u)) {
                    seen.add(u);
                    merged.push(u);
                }
            }
        }

        mergeBatch();
        const viewport = findAgBodyScrollViewport();
        if (!viewport) {
            return merged;
        }

        const startTop = viewport.scrollTop;
        let lastTop = -1;
        let stuck = 0;
        let lastHeight = viewport.scrollHeight;

        for (let step = 0; step < 150; step++) {
            const maxScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
            const delta = Math.max(100, Math.floor(viewport.clientHeight * 0.72));
            viewport.scrollTop = Math.min(viewport.scrollTop + delta, maxScroll);
            await new Promise((r) => setTimeout(r, 90));
            mergeBatch();

            if (viewport.scrollHeight > lastHeight + 20) {
                lastHeight = viewport.scrollHeight;
                stuck = 0;
            }

            if (Math.abs(viewport.scrollTop - lastTop) < 0.5) {
                stuck++;
                if (stuck >= 5) break;
            } else {
                stuck = 0;
            }
            lastTop = viewport.scrollTop;

            if (maxScroll <= 1 || viewport.scrollTop >= maxScroll - 1) {
                mergeBatch();
                break;
            }
        }

        viewport.scrollTop = startTop;
        return merged;
    }

    function sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
    }

    function getPaginationText() {
        const selectors = [
            ".ag-paging-page-summary-panel",
            ".ag-paging-row-summary-panel",
            "[class*='pagination']",
            "[class*='Pagination']"
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && (el.textContent || "").trim()) {
                return (el.textContent || "").replace(/\s+/g, " ").trim();
            }
        }
        return "";
    }

    function getPageToken() {
        const summary = getPaginationText();
        const firstRow = document.querySelector(
            ".ag-center-cols-container [role='row'], table tbody tr, [role='grid'] [role='row']:not([role='columnheader'])"
        );
        const firstRowText = (firstRow?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
        return `${summary}||${firstRowText}`;
    }

    function findNextPageButton() {
        const selectors = [
            ".ag-paging-button[ref='btNext']",
            ".ag-paging-button[aria-label*='next' i]",
            "button[aria-label*='next' i]",
            "button[title*='next' i]",
            "[role='button'][aria-label*='next' i]",
            "[data-testid*='next' i]"
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) return el;
        }
        const candidates = Array.from(document.querySelectorAll("button, [role='button'], a"));
        return (
            candidates.find((el) => /^(>|›|»|next)$/i.test((el.textContent || "").trim())) || null
        );
    }

    function isDisabled(el) {
        if (!el) return true;
        const cls = (el.className || "").toString().toLowerCase();
        return (
            el.disabled ||
            el.getAttribute("aria-disabled") === "true" ||
            cls.includes("disabled") ||
            cls.includes("inactive") ||
            cls.includes("ag-disabled")
        );
    }

    async function waitForPageAdvance(beforeToken) {
        for (let i = 0; i < 20; i++) {
            await sleep(180);
            const now = getPageToken();
            if (now && now !== beforeToken) return true;
        }
        return false;
    }

    async function collectUrlsAcrossPagination() {
        const merged = [];
        const seen = new Set();
        const merge = (batch) => {
            for (const u of batch) {
                if (!seen.has(u)) {
                    seen.add(u);
                    merged.push(u);
                }
            }
        };

        merge(await collectUrlsForQueue());

        const MAX_PAGES = 25;
        for (let page = 1; page < MAX_PAGES; page++) {
            const nextBtn = findNextPageButton();
            if (!nextBtn || isDisabled(nextBtn)) break;

            const beforeToken = getPageToken();
            nextBtn.click();
            const moved = await waitForPageAdvance(beforeToken);
            if (!moved) break;
            merge(await collectUrlsForQueue());
        }

        return merged;
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "collect_and_start_queue") {
            void (async () => {
                try {
                    const urls = await collectUrlsAcrossPagination();
                    if (!urls.length) {
                        sendResponse({
                            ok: false,
                            error:
                                "No job URLs found. Ensure the Job URL / Apply column has links. If the table is large, wait — the extension scrolls the grid to collect all rows."
                        });
                        return;
                    }
                    chrome.runtime.sendMessage({ action: "start_apply_queue", urls }, (response) => {
                        const err = chrome.runtime.lastError;
                        if (err) {
                            sendResponse({ ok: false, error: err.message });
                            return;
                        }
                        sendResponse(response || { ok: false, error: "Unknown error" });
                    });
                } catch (e) {
                    sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
                }
            })();
            return true;
        }
    });
})();
