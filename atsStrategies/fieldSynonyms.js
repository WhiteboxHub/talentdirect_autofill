/**
 * Default keyword bundles for matching form labels to canonical JSON paths.
 * Wildcards: education.*.field, work_history.*.field apply to any index.
 * Loaded before fieldRegistry.js / genericStrategy.js.
 */
(function () {
    const G = typeof globalThis !== "undefined" ? globalThis : window;
    G.AUTOFILL_FIELD_SYNONYMS = {
        "identity.first_name": ["first_name", "first name", "fname", "given name", "givenname"],
        "identity.middle_name": ["middle name", "middle initial", "mname", "middle"],
        "identity.last_name": ["last_name", "last name", "lname", "surname", "family name"],
        "identity.full_name": ["full name", "full_name", "fullname", "legal name", "applicant name", "your name", "complete name"],
        "contact.email": ["email", "e-mail", "mail", "email address"],
        "contact.phone": ["phone", "tel", "mobile", "cell", "contact", "phone number"],
        "contact.portfolio": ["website", "url", "portfolio", "link", "personal website"],
        "contact.address": ["address", "street", "address line 1"],
        "contact.city": ["city", "town"],
        "contact.zip_code": ["zip", "postal", "code", "zip code"],
        "contact.state": ["state", "province", "region"],
        "contact.country": ["country", "country format"],
        "contact.linkedin": ["linkedin", "linkedin url", "linkedin profile"],
        "contact.github": ["github", "github profile", "github url"],
        "summary.short": ["summary", "about", "bio", "description"],
        "summary.long": ["cover letter", "additional information", "tell us about yourself"],
        "employment.current_role": ["title", "position", "role", "job_title", "current role", "current title"],
        "employment.current_company": ["company", "employer", "current company", "organization"],
        "employment.years_total": ["total experience", "years experience", "total years"],
        "skills.skills_string": ["skills", "technologies", "technical skills", "core competencies"],

        "education.*.institution": ["school", "university", "college", "institution", "school name"],
        "education.*.area": ["major", "field of study", "concentration", "area of study"],
        "education.*.studyType": ["degree", "degree type", "program", "qualification", "study type"],
        "education.*.startDate": ["education start", "school start", "attended from"],
        "education.*.endDate": ["education end", "graduation", "school end", "attended to"],
        "education.*.gpa": ["gpa", "grade point", "cgpa"],
        "education.*.location": ["school location", "campus location", "university location", "education location"],

        "work_history.*.name": ["employer", "company", "organization", "workplace"],
        "work_history.*.position": ["job title", "role", "position", "title"],
        "work_history.*.location": ["work location", "job location", "office location"],
        "work_history.*.startDate": ["employment start", "job start", "start date"],
        "work_history.*.endDate": ["employment end", "job end", "end date"],
        "work_history.*.summary": ["job description", "responsibilities", "role description", "achievements", "key accomplishments"],

        "projects.*.name": ["project name", "project title"],
        "projects.*.description": ["project description", "describe the project", "project details"],
        "projects.*.url": ["project url", "project link", "repository", "demo link"],

        "skills.*.keyword": []
    };
})();
