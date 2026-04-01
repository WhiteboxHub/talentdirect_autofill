/**
 * Builds a list of { path, keywords, value } from normalized resume data + synonym map.
 * No candidate data hardcoded — values come from normalizedData.
 */
(function () {
    const G = typeof globalThis !== "undefined" ? globalThis : window;

    function getNestedValue(obj, path) {
        if (!obj || !path) return undefined;
        const parts = String(path).split(".");
        let cur = obj;
        for (const p of parts) {
            if (cur == null) return undefined;
            if (/^\d+$/.test(p)) {
                const idx = parseInt(p, 10);
                cur = cur[idx];
            } else {
                cur = cur[p];
            }
        }
        return cur;
    }

    function segmentTokens(path) {
        return String(path)
            .split(".")
            .filter((s) => s && !/^\d+$/.test(s))
            .map((s) => s.replace(/_/g, " ").toLowerCase());
    }

    function resolveSynonymKeys(path) {
        const keys = [path];
        const mEd = /^education\.(\d+)\.(.+)$/.exec(path);
        if (mEd) {
            keys.push(`education.*.${mEd[2]}`);
        }
        const mWh = /^work_history\.(\d+)\.(.+)$/.exec(path);
        if (mWh) {
            keys.push(`work_history.*.${mWh[2]}`);
        }
        const mProj = /^projects\.(\d+)\.(.+)$/.exec(path);
        if (mProj) {
            keys.push(`projects.*.${mProj[2]}`);
        }
        if (/^skills\.keyword\.\d+$/.test(path)) {
            keys.push("skills.*.keyword");
        }
        return keys;
    }

    function keywordsForPath(path, synonymMap) {
        const map = synonymMap || G.AUTOFILL_FIELD_SYNONYMS || {};
        const seen = new Set();
        const out = [];

        function add(kw) {
            const t = String(kw).toLowerCase().trim();
            if (t.length < 2) return;
            if (seen.has(t)) return;
            seen.add(t);
            out.push(t);
        }

        for (const key of resolveSynonymKeys(path)) {
            const list = map[key];
            if (Array.isArray(list)) {
                list.forEach(add);
            }
        }
        segmentTokens(path).forEach(add);
        return out;
    }

    function pushScalar(entries, path, value, synonymMap) {
        if (value === undefined || value === null) return;
        if (typeof value === "object") return;
        const str = String(value).trim();
        if (!str) return;
        entries.push({
            path,
            value: str,
            keywords: keywordsForPath(path, synonymMap)
        });
    }

    /** Per-skill rows: keywords = synonyms + skill text only (avoid generic path tokens like "skills"). */
    function pushSkillKeywordRows(entries, normalizedData, synonymMap) {
        const nss = normalizedData.skills && normalizedData.skills.normalized_skill_set;
        if (!Array.isArray(nss)) return;
        const map = synonymMap || G.AUTOFILL_FIELD_SYNONYMS || {};
        const list = map["skills.*.keyword"] || [];
        nss.forEach((raw, i) => {
            const str = String(raw == null ? "" : raw).trim();
            if (str.length < 2) return;
            const seen = new Set();
            const keywords = [];
            function add(kw) {
                const t = String(kw).toLowerCase().trim();
                if (t.length < 2 || seen.has(t)) return;
                seen.add(t);
                keywords.push(t);
            }
            list.forEach(add);
            add(str);
            str.split(/[\s,/]+/).forEach((t) => add(t));
            entries.push({ path: `skills.keyword.${i}`, value: str, keywords });
        });
    }

    function walkScalars(prefix, obj, synonymMap, entries, depth) {
        if (depth > 12) return;
        if (obj == null) return;
        if (typeof obj !== "object") {
            pushScalar(entries, prefix, obj, synonymMap);
            return;
        }
        if (Array.isArray(obj)) return;

        for (const k of Object.keys(obj)) {
            const v = obj[k];
            const p = prefix ? `${prefix}.${k}` : k;
            if (v != null && typeof v === "object" && !Array.isArray(v)) {
                walkScalars(p, v, synonymMap, entries, depth + 1);
            } else {
                pushScalar(entries, p, v, synonymMap);
            }
        }
    }

    /**
     * @param {object} normalizedData - output of ResumeProcessor.normalize()
     * @param {Record<string, string[]>} [synonymMap] - defaults to AUTOFILL_FIELD_SYNONYMS
     * @returns {{ path: string, value: string, keywords: string[] }[]}
     */
    function buildFieldRegistry(normalizedData, synonymMap) {
        const map = synonymMap || G.AUTOFILL_FIELD_SYNONYMS || {};
        const entries = [];

        if (!normalizedData || typeof normalizedData !== "object") {
            return entries;
        }

        walkScalars("identity", normalizedData.identity, map, entries, 0);
        walkScalars("contact", normalizedData.contact, map, entries, 0);
        walkScalars("employment", normalizedData.employment, map, entries, 0);
        walkScalars("summary", normalizedData.summary, map, entries, 0);

        const skillsStr = normalizedData.skills && normalizedData.skills.skills_string;
        pushScalar(entries, "skills.skills_string", skillsStr, map);

        const edu = normalizedData.education;
        if (Array.isArray(edu)) {
            edu.forEach((row, i) => {
                if (!row || typeof row !== "object") return;
                ["institution", "area", "studyType", "startDate", "endDate", "gpa", "location"].forEach((key) => {
                    const path = `education.${i}.${key}`;
                    pushScalar(entries, path, row[key], map);
                });
            });
        }

        const wh = normalizedData.work_history;
        if (Array.isArray(wh)) {
            wh.forEach((row, i) => {
                if (!row || typeof row !== "object") return;
                ["name", "position", "location", "startDate", "endDate", "summary"].forEach((key) => {
                    const path = `work_history.${i}.${key}`;
                    pushScalar(entries, path, row[key], map);
                });
            });
        }

        const proj = normalizedData.projects;
        if (Array.isArray(proj)) {
            proj.forEach((row, i) => {
                if (!row || typeof row !== "object") return;
                ["name", "description", "url"].forEach((key) => {
                    const path = `projects.${i}.${key}`;
                    pushScalar(entries, path, row[key], map);
                });
            });
        }

        pushSkillKeywordRows(entries, normalizedData, map);

        return entries;
    }

    G.buildFieldRegistry = buildFieldRegistry;
    G.fieldRegistryGetNestedValue = getNestedValue;
})();
