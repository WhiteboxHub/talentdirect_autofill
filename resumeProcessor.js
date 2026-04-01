/**
 * Utility to process and normalize JSON Resume data into a flat, searchable index.
 */
class ResumeProcessor {
    /**
     * Text Normalization Utility
     * - Lowercases text
     * - Removes punctuation (replaces with space)
     * - Standardizes whitespace
     * - Expands abbreviations
     */
    static normalizeText(text) {
        if (!text || typeof text !== 'string') return '';

        let normalized = text.toLowerCase()
            .replace(/[^\w\s]|_/g, ' ') // Strip punctuation
            .replace(/\s+/g, ' ')       // Standardize whitespace
            .trim();

        // Abbreviation expansion dictionary
        const abbreviations = {
            "ml": "machine learning",
            "ai": "artificial intelligence",
            "js": "javascript",
            "ts": "typescript",
            "fe": "frontend",
            "be": "backend",
            "fs": "fullstack",
            "ux": "user experience",
            "ui": "user interface",
            "aws": "amazon web services",
            "gcp": "google cloud platform",
            "db": "database",
            "sdlc": "software development life cycle",
            "qa": "quality assurance"
        };

        // Split, expand, and rejoin
        return normalized.split(' ').map(word => abbreviations[word] || word).join(' ');
    }

    /**
     * Normalizes a JSON Resume into a structured internal index.
     */
    static normalize(resumeData) {
        if (!resumeData) return {};

        const basics = resumeData.basics || {};
        const work = resumeData.work || [];
        const skills = resumeData.skills || [];
        const location = basics.location || {};
        const profiles = basics.profiles || [];

        // 1. Identity
        const fullName = basics.name || "";
        const nameParts = fullName.split(' ');
        let firstName = "", middleName = "", lastName = "";

        if (nameParts.length > 0) {
            firstName = nameParts[0];
            lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";
            middleName = nameParts.length > 2 ? nameParts.slice(1, nameParts.length - 1).join(" ") : "";
        }

        const identity = {
            first_name: firstName,
            middle_name: middleName,
            last_name: lastName,
            full_name: fullName
        };

        // 2. Contact & Links
        const getProfile = (network) => {
            const p = profiles.find(pf => this.normalizeText(pf.network).includes(network));
            return p ? (p.url || "").trim() : "";
        };

        const trimUrl = (u) => (typeof u === "string" ? u.trim() : "");
        const urlField = trimUrl(basics.url);
        const websiteField = trimUrl(basics.website);
        const isLinkedInUrl = (u) => u && /linkedin\.com/i.test(u);
        const isGitHubUrl = (u) => u && /github\.com/i.test(u);

        let linkedin = getProfile("linkedin");
        let github = getProfile("github");
        if (!linkedin) {
            if (isLinkedInUrl(urlField)) linkedin = urlField;
            else if (isLinkedInUrl(websiteField)) linkedin = websiteField;
        }
        if (!github) {
            if (isGitHubUrl(urlField)) github = urlField;
            else if (isGitHubUrl(websiteField)) github = websiteField;
        }

        let portfolio = "";
        if (urlField && !isLinkedInUrl(urlField) && !isGitHubUrl(urlField)) portfolio = urlField;
        else if (websiteField && !isLinkedInUrl(websiteField) && !isGitHubUrl(websiteField)) {
            portfolio = websiteField;
        }

        const contact = {
            email: basics.email || "",
            phone: basics.phone ? basics.phone.replace(/[^\d+]/g, "") : "", // Keep only digits and +
            linkedin,
            github,
            portfolio,

            // Location included in contact for convenience
            address: location.address || "",
            city: location.city || "",
            state: location.region || "",
            zip_code: location.postalCode || "",
            country: location.countryCode || ""
        };

        // 3. Employment & Reverse Maps
        const currentWork = work[0] || {};
        let totalMonths = 0;

        const companyToDuration = {};
        const titleToDuration = {};
        const rolesByYear = {};

        work.forEach(job => {
            const start = new Date(job.startDate);
            const end = job.endDate ? new Date(job.endDate) : new Date();

            if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                const diffTime = Math.abs(end - start);
                const diffMonths = Math.ceil(diffTime / (1000 * 60 * 60 * 24 * 30.44));
                totalMonths += diffMonths;

                const normCompany = this.normalizeText(job.company || job.name || "");
                const normTitle = this.normalizeText(job.position);

                // Track durations
                companyToDuration[normCompany] = (companyToDuration[normCompany] || 0) + diffMonths;
                titleToDuration[normTitle] = (titleToDuration[normTitle] || 0) + diffMonths;

                // Track roles by year
                const startYear = start.getFullYear();
                const endYear = end.getFullYear();
                for (let y = startYear; y <= endYear; y++) {
                    if (!rolesByYear[y]) rolesByYear[y] = [];
                    if (!rolesByYear[y].includes(job.position)) {
                        rolesByYear[y].push(job.position);
                    }
                }
            }
        });

        const employment = {
            current_role: currentWork.position || basics.label || "",
            current_company: currentWork.company || currentWork.name || "",
            years_total: Math.round(totalMonths / 12),
            roles_by_year: rolesByYear
        };

        /** Indexed work history for field registry (education-style paths). JSON Resume uses `company`. */
        const work_history = (work || []).map((w) => ({
            name: w.company || w.name || "",
            position: w.position || "",
            location: w.location || "",
            startDate: w.startDate || "",
            endDate: w.endDate || "",
            summary:
                w.summary ||
                (Array.isArray(w.highlights) ? w.highlights.filter(Boolean).join("\n") : "") ||
                ""
        }));

        const projects = (resumeData.projects || []).map((p) => ({
            name: (p && p.name) || "",
            description: (p && p.description) || "",
            url: (p && p.url) || ""
        }));

        // 4. Skills & Reverse Maps
        const normalizedSkillSet = new Set();
        const skillFrequency = {};
        const skillToYears = {};
        const skillCategories = {};

        skills.forEach(skillCategory => {
            const catName = this.normalizeText(skillCategory.name);
            skillCategories[catName] = [];

            const keywords = skillCategory.keywords || [skillCategory.name];

            keywords.forEach(keyword => {
                const normKeyword = this.normalizeText(keyword);
                normalizedSkillSet.add(normKeyword);
                skillCategories[catName].push(normKeyword);

                // Estimate skill frequency/years based on overall employment
                // In a perfect system, skills would map to specific jobs. 
                // We'll approximate by assigning total experience to core skills for now.
                skillFrequency[normKeyword] = (skillFrequency[normKeyword] || 0) + 1;
                skillToYears[normKeyword] = employment.years_total;
            });
        });

        const skillsData = {
            normalized_skill_set: Array.from(normalizedSkillSet),
            skill_frequency: skillFrequency,
            skill_categories: skillCategories,
            skills_string: Array.from(normalizedSkillSet).join(", ")
        };

        // Summaries
        const summaryLong = basics.summary || "";
        let summaryShort = "";
        if (summaryLong) {
            const firstSentence = summaryLong.split(/[.!?]/)[0];
            summaryShort = firstSentence ? firstSentence.trim() + "." : summaryLong;
        }

        // Application Preferences (pass through with defaults)
        const prefs = resumeData.applicationPreferences || {};
        const preferences = {
            work_authorization: prefs.work_authorization || "",
            requires_visa_sponsorship: prefs.requires_visa_sponsorship || "",
            salary_expectation: prefs.salary_expectation || "",
            preferred_start_date: prefs.preferred_start_date || "",
            how_did_you_hear: prefs.how_did_you_hear || "",
            gender: prefs.gender || "",
            hispanic_latino: prefs.hispanic_latino || "",
            veteran_status: prefs.veteran_status || "",
            disability_status: prefs.disability_status || "",
            auto_consent: prefs.auto_consent === true
        };

        // Output Index
        return {
            identity: identity,
            contact: contact,
            employment: employment,
            work_history: work_history,
            projects: projects,
            skills: skillsData,
            summary: {
                short: summaryShort,
                long: summaryLong
            },
            education: resumeData.education || [],
            preferences: preferences,
            reverse_maps: {
                skill_to_years: skillToYears,
                company_to_duration: companyToDuration,
                title_to_duration: titleToDuration
            }
        };
    }
}

// Export for use in extension (depending on environment)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ResumeProcessor;
} else {
    window.ResumeProcessor = ResumeProcessor;
}
