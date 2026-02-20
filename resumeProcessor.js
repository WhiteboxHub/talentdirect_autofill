/**
 * Utility to process and normalize JSON Resume data into a flat, searchable index.
 */
class ResumeProcessor {
    /**
     * Normalizes a JSON Resume into a flat internal index with derived and computed fields.
     * @param {Object} resumeData - The raw JSON resume following JSON Resume schema.
     * @returns {Object} A flat object containing normalized and computed values.
     */
    static normalize(resumeData) {
        if (!resumeData) return {};

        const basics = resumeData.basics || {};
        const work = resumeData.work || [];
        const skills = resumeData.skills || [];
        const location = basics.location || {};
        const profiles = basics.profiles || [];

        // 1. Basic Fields
        const fullName = basics.name || "";
        const nameParts = fullName.split(' ');
        const firstName = nameParts[0] || "";
        const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";

        // 2. Profile URLs
        const getProfile = (network) => {
            const p = profiles.find(pf => pf.network.toLowerCase().includes(network.toLowerCase()));
            return p ? p.url : "";
        };

        // 3. Current Work Info
        const currentWork = work[0] || {}; // Assuming first entry is most recent
        const currentTitle = currentWork.position || basics.label || "";
        const currentCompany = currentWork.name || "";

        // 4. Total Years Experience (Compute)
        const totalExperience = this.calculateExperience(work);

        // 5. Skills String
        const skillsString = skills.map(s => {
            const keywords = s.keywords ? (Array.isArray(s.keywords) ? s.keywords.join(", ") : s.keywords) : "";
            return s.name + (keywords ? `: ${keywords}` : "");
        }).join("; ");

        // 6. Summaries
        const summaryLong = basics.summary || "";
        let summaryShort = "";
        if (summaryLong) {
            const firstSentence = summaryLong.split(/[.!?]/)[0];
            summaryShort = firstSentence ? firstSentence.trim() + "." : summaryLong;
        }

        // Create the internal flat index
        const index = {
            // Core Identity
            full_name: fullName,
            first_name: firstName,
            last_name: lastName,
            email: basics.email || "",
            phone: basics.phone || "",

            // Socials
            linkedin_url: getProfile('linkedin'),
            github_url: getProfile('github'),
            portfolio_url: basics.url || "",

            // Professional
            current_title: currentTitle,
            current_company: currentCompany,
            total_years_experience: totalExperience.toString(),
            skills_string: skillsString,

            // Summaries
            summary_short: summaryShort,
            summary_long: summaryLong,

            // Location
            address: location.address || "",
            city: location.city || "",
            state: location.region || "",
            zip_code: location.postalCode || "",
            country: location.countryCode || ""
        };

        // 7. Precompute Aliases
        // This expands the index with common variations for easier matching
        const aliases = {
            "fname": index.first_name,
            "lname": index.last_name,
            "mobile": index.phone,
            "cell": index.phone,
            "contact": index.phone,
            "website": index.portfolio_url,
            "title": index.current_title,
            "job_title": index.current_title,
            "company": index.current_company,
            "employer": index.current_company,
            "years_exp": index.total_years_experience,
            "experience": index.total_years_experience,
            "linkedin": index.linkedin_url,
            "github": index.github_url,
            "street": index.address,
            "zip": index.zip_code,
            "region": index.state,
            "fullname": index.full_name,
            "current_role": index.current_title
        };

        return { ...index, ...aliases };
    }

    /**
     * Calculates total years of experience from work history.
     * @param {Array} work - Array of work history objects.
     * @returns {number} Rounded total years of experience.
     */
    static calculateExperience(work) {
        if (!work || work.length === 0) return 0;

        let totalMonths = 0;
        work.forEach(job => {
            const start = new Date(job.startDate);
            const end = job.endDate ? new Date(job.endDate) : new Date(); // Empty end date means current

            if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                const diffTime = Math.abs(end - start);
                const diffMonths = Math.ceil(diffTime / (1000 * 60 * 60 * 24 * 30.44));
                totalMonths += diffMonths;
            }
        });

        return Math.round(totalMonths / 12);
    }
}

// Export for use in extension (depending on environment)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ResumeProcessor;
} else {
    window.ResumeProcessor = ResumeProcessor;
}
