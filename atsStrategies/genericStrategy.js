/**
 * genericStrategy.js
 * Default strategy for applying resume data to standard job application forms.
 */
class GenericStrategy {
    constructor() {
        this.CONFIDENCE_THRESHOLD = 70;
        /** Below this: do not show Accept/Reject popups (too noisy / wrong field). */
        this.MIN_PROMPT_CONFIDENCE = 52;

        // Field Mapping Dictionary
        // Avoid bare "name" — it matches unrelated fields (e.g. question_name, Veteran Status siblings).
        this.FIELD_MAPPING = {
            "identity.first_name": ["first_name", "first name", "fname", "given name", "givenname"],
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
            "employment.current_role": ["title", "position", "role", "job_title", "current role", "current title"],
            "employment.current_company": ["company", "employer", "current company", "organization", "most recent employer"],
            "employment.years_total": ["total experience", "years experience", "total years"],
            "preferences.work_authorization": ["authorized to work", "legally authorized", "work authorization", "eligible to work"],
            "preferences.requires_visa_sponsorship": ["visa", "sponsorship", "immigration sponsorship", "require immigration"],
            "preferences.salary_expectation": ["salary", "compensation", "pay expectation", "salary expectation"],
            "preferences.preferred_start_date": ["start date", "available to start", "earliest start", "preferred start"],
            "preferences.how_did_you_hear": ["hear about", "how did you", "heard about this"],
            "preferences.gender": ["gender"],
            "preferences.hispanic_latino": ["hispanic", "latino"],
            "preferences.veteran_status": ["veteran status", "veteran"],
            "preferences.disability_status": ["disability status", "disability"]
        };
    }

    getNestedValue(obj, path) {
        return path.split('.').reduce((acc, part) => acc && acc[part], obj);
    }

    /**
     * React / Remix (e.g. Greenhouse) controlled inputs ignore plain `el.value = x`.
     * Use the native prototype setter so the DOM updates and frameworks sync state.
     */
    setNativeInputValue(el, value) {
        if (el == null || value === undefined || value === null) return;
        const str = String(value);
        const tag = el.tagName;
        if (tag === "INPUT") {
            const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
            if (desc && desc.set) {
                desc.set.call(el, str);
                return;
            }
        } else if (tag === "TEXTAREA") {
            const desc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
            if (desc && desc.set) {
                desc.set.call(el, str);
                return;
            }
        }
        el.value = str;
    }

    dispatchInputEvents(el) {
        try {
            el.dispatchEvent(
                new InputEvent("input", {
                    bubbles: true,
                    cancelable: true,
                    inputType: "insertReplacementText",
                    data: el.value
                })
            );
        } catch (_) {
            el.dispatchEvent(new Event("input", { bubbles: true }));
        }
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
    }

    /**
     * Skip search bars, AG Grid column filters, and other non-application controls.
     */
    shouldSkipInput(input, normalizedData) {
        const type = (input.type || "").toLowerCase();
        const id = (input.id || "").toLowerCase();
        const name = (input.name || "").toLowerCase();
        const ph = (input.placeholder || "").toLowerCase();
        const aria = (input.getAttribute("aria-label") || "").toLowerCase();

        if (input.getAttribute("aria-hidden") === "true") return true;
        if (input.tabIndex === -1 && type === "text" && input.hasAttribute("required")) {
            const r = input.getBoundingClientRect();
            if (r.width < 2 && r.height < 2) return true;
        }

        if (type === "search") return true;
        if (/^ag-\d+-input$/.test(id) || /^ag-\d+-filter$/.test(id)) return true;
        if (id.includes("ag-") && (id.includes("filter") || id.includes("-input"))) return true;
        if (ph.includes("search jobs") || ph === "search..." || ph === "search") return true;
        if (aria.includes("filter column") || aria.includes("column filter")) return true;
        if (name === "q" && ph.includes("search")) return true;

        const hasPreferences = normalizedData?.preferences && (
            normalizedData.preferences.work_authorization ||
            normalizedData.preferences.gender ||
            normalizedData.preferences.auto_consent
        );
        if (hasPreferences) return false;

        const label = (this.getLabelText(input) || "").toLowerCase();
        const combined = `${label} ${id} ${name} ${aria}`.toLowerCase();
        if (input.tagName === "SELECT" || type === "radio" || type === "checkbox" ||
            input.getAttribute('role') === 'combobox') {
            if (
                /veteran|gender|ethnic|race|disability|sponsor|authorized to work|legally permitted|country of citizenship|pronoun|sexual orientation|marital|dependents|religion|age|eeo|demographic|voluntary self|identification|protected veteran/i.test(
                    combined
                )
            ) {
                return true;
            }
        }
        return false;
    }

    /**
     * Inputs inside Shadow DOM (common on React/MUI/corporate sites) are invisible to
     * document.querySelectorAll — walk the tree and open shadow roots.
     */
    collectAllFormElements() {
        const out = [];
        const seen = new Set();
        const visit = (node) => {
            if (!node) return;
            if (node.nodeType === Node.ELEMENT_NODE) {
                const el = node;
                const tag = el.tagName;
                if (/^INPUT|TEXTAREA|SELECT$/i.test(tag)) {
                    if (!seen.has(el)) {
                        seen.add(el);
                        out.push(el);
                    }
                }
                if (el.shadowRoot) visit(el.shadowRoot);
                for (const c of el.children) visit(c);
            } else if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
                for (const c of node.childNodes) visit(c);
            }
        };
        if (document.documentElement) visit(document.documentElement);
        return out;
    }

    /**
     * Subclasses override this to add platform-specific field matching.
     * Called before the generic heuristic matcher. Return { value, confidence } or null.
     */
    findPlatformSpecificMatch(input, normalizedData) {
        return null;
    }

    tryInjectResumeFile(fileInputs) {
        if (!fileInputs.length) return;
        chrome.storage.local.get(['resumeFile'], (result) => {
            const resumeFile = result?.resumeFile;
            if (!resumeFile || !resumeFile.data) {
                fileInputs.forEach(fi => {
                    const wrapper = fi.closest('.file-upload, .field-wrapper, [class*="upload"]') || fi.parentElement;
                    if (wrapper) {
                        wrapper.style.outline = '2px solid #ef4444';
                        wrapper.title = 'Please attach your resume manually';
                    }
                });
                return;
            }
            try {
                const byteString = atob(resumeFile.data.split(',')[1]);
                const ab = new ArrayBuffer(byteString.length);
                const ia = new Uint8Array(ab);
                for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
                const blob = new Blob([ab], { type: resumeFile.type || 'application/pdf' });
                const file = new File([blob], resumeFile.name || 'resume.pdf', { type: resumeFile.type || 'application/pdf' });

                fileInputs.forEach(fi => {
                    const label = (this.getLabelText(fi) || fi.id || '').toLowerCase();
                    if (/cover.?letter/i.test(label)) return;
                    try {
                        const dt = new DataTransfer();
                        dt.items.add(file);
                        fi.files = dt.files;
                        fi.dispatchEvent(new Event('change', { bubbles: true }));
                        fi.dispatchEvent(new Event('input', { bubbles: true }));
                    } catch (_) {
                        const wrapper = fi.closest('.file-upload, .field-wrapper') || fi.parentElement;
                        if (wrapper) {
                            wrapper.style.outline = '2px solid #ef4444';
                            wrapper.title = 'Please attach your resume manually';
                        }
                    }
                });
            } catch (_) {
                fileInputs.forEach(fi => {
                    const wrapper = fi.closest('.file-upload, .field-wrapper') || fi.parentElement;
                    if (wrapper) {
                        wrapper.style.outline = '2px solid #ef4444';
                        wrapper.title = 'Please attach your resume manually';
                    }
                });
            }
        });
    }

    execute(normalizedData, aiEnabled) {
        const inputs = this.collectAllFormElements();
        const autoConsent = normalizedData?.preferences?.auto_consent === true;
        let fillReport = [];
        const unmatchedForAi = [];
        const fileInputs = [];

        inputs.forEach(input => {
            if ((input.type || '').toLowerCase() === 'file') {
                fileInputs.push(input);
                return;
            }
            if (input.type === 'hidden' || input.disabled || input.readOnly) return;
            if (this.shouldSkipInput(input, normalizedData)) return;

            const label = this.getLabelText(input) || '';
            const labelLower = label.toLowerCase();

            // Auto-consent for "I confirm" / privacy / consent fields
            if (autoConsent && this.isConsentField(labelLower)) {
                const type = (input.type || '').toLowerCase();
                if (type === 'checkbox') {
                    input.checked = true;
                    this.dispatchInputEvents(input);
                    fillReport.push({ id: input.id || input.name, label, value: 'checked', confidence: 100, status: 'filled' });
                    return;
                }
                if (this.isReactSelect(input)) {
                    this.fillReactSelect(input, 'I confirm');
                    fillReport.push({ id: input.id || input.name, label, value: 'I confirm', confidence: 100, status: 'filled' });
                    return;
                }
                if (input.tagName === 'SELECT') {
                    this.setInputValue(input, 'I confirm', 'green');
                    fillReport.push({ id: input.id || input.name, label, value: 'I confirm', confidence: 100, status: 'filled' });
                    return;
                }
            }

            let match = this.findPlatformSpecificMatch(input, normalizedData);
            if (!match || !match.value) {
                match = this.findValueForInput(input, normalizedData);
            }

            let status = 'unmatched';
            let finalValue = '';

            if (match && match.value) {
                if (match.confidence >= this.CONFIDENCE_THRESHOLD) {
                    this.setInputValue(input, match.value, 'green');
                    status = 'filled';
                    finalValue = match.value;
                } else if (match.confidence >= this.MIN_PROMPT_CONFIDENCE) {
                    this.promptUserConfirmation(input, match.value, match.confidence);
                    status = 'low_confidence';
                    finalValue = match.value;
                }
            } else {
                if (input.required || input.getAttribute('aria-required') === 'true') {
                    if (aiEnabled) {
                        unmatchedForAi.push({ input, label });
                    } else {
                        this.highlightUnmatchedRequired(input);
                    }
                    status = 'unmatched_required';
                }
            }

            if (status !== 'unmatched') {
                const labelText = label || input.name || input.id || input.placeholder || "Unknown Field";
                fillReport.push({
                    id: input.id || input.name || Math.random().toString(36).substr(2, 9),
                    label: labelText,
                    value: finalValue,
                    confidence: match ? match.confidence : 0,
                    status: status
                });
            }
        });

        // AI fallback for unmatched required fields
        if (aiEnabled && unmatchedForAi.length > 0) {
            this.fillWithAi(unmatchedForAi, normalizedData, fillReport);
        }

        if (fileInputs.length > 0) {
            this.tryInjectResumeFile(fileInputs);
        }

        chrome.runtime.sendMessage({
            action: 'fill_report',
            report: fillReport
        });
    }

    isConsentField(labelLower) {
        return /i confirm|i have read|privacy notice|true and correct|consent|i agree|i acknowledge/i.test(labelLower);
    }

    fillWithAi(unmatchedFields, normalizedData, fillReport) {
        const profileSummary = [
            `Name: ${normalizedData?.identity?.full_name || 'N/A'}`,
            `Location: ${normalizedData?.contact?.city || ''}, ${normalizedData?.contact?.state || ''}`,
            `Current Role: ${normalizedData?.employment?.current_role || 'N/A'}`,
            `Years Experience: ${normalizedData?.employment?.years_total || 0}`
        ].join('. ');

        unmatchedFields.forEach(({ input, label }) => {
            const isSelectType = this.isReactSelect(input) || input.tagName === 'SELECT';
            const prompt = isSelectType
                ? `You are filling a job application form. The question is: "${label}". The applicant profile: ${profileSummary}. Answer with ONLY the most likely option text (Yes/No or the best dropdown choice). No explanation.`
                : `You are filling a job application form. The question is: "${label}". The applicant profile: ${profileSummary}. Write a brief, professional answer (1-2 sentences max). No explanation or preamble.`;

            chrome.runtime.sendMessage({ action: 'generate_ai_answer', prompt }, (res) => {
                if (chrome.runtime.lastError) {
                    this.highlightUnmatchedRequired(input);
                    return;
                }
                const answer = res?.text;
                if (!answer || answer.startsWith('[Ollama')) {
                    this.highlightUnmatchedRequired(input);
                    return;
                }
                const cleaned = answer.trim().replace(/^["']|["']$/g, '');
                this.setInputValue(input, cleaned, 'green');
                fillReport.push({
                    id: input.id || input.name,
                    label: label,
                    value: cleaned,
                    confidence: 75,
                    status: 'filled'
                });
            });
        });
    }

    findCustomAnswer(input, hostname, customAtsAnswers) {
        if (!customAtsAnswers) return null;

        const features = this.extractFeatures(input);
        const combinedText = `${features.name_attr} ${features.id_attr} ${features.label_text} ${features.aria_label}`.toLowerCase();

        // Determine which ATS key we are currently under
        let atsKey = "Global";
        if (hostname.includes("greenhouse.io")) atsKey = "Greenhouse";
        else if (hostname.includes("lever.co")) atsKey = "Lever";
        else if (hostname.includes("workday.com") || hostname.includes("myworkdayjobs.com")) atsKey = "Workday";

        // Check platform specific answers first, then fallback to Global
        const answerSets = [customAtsAnswers[atsKey], customAtsAnswers["Global"]];

        for (const answers of answerSets) {
            if (answers && typeof answers === 'object') {
                // Iterate through keys defined by user
                for (const [questionKeyword, customValue] of Object.entries(answers)) {
                    if (combinedText.includes(questionKeyword.toLowerCase())) {
                        return { value: customValue, confidence: 100 };
                    }
                }
            }
        }
        return null;
    }

    extractFeatures(input) {
        return {
            name_attr: (input.name || "").toLowerCase(),
            id_attr: (input.id || "").toLowerCase(),
            placeholder: (input.placeholder || "").toLowerCase(),
            aria_label: (input.getAttribute('aria-label') || "").toLowerCase(),
            label_text: this.getLabelText(input).toLowerCase(),
            nearby_text: this.getNearbyText(input).toLowerCase(),
            input_type: (input.type || "text").toLowerCase(),
            normalized_combined: (typeof ResumeProcessor !== 'undefined') ?
                ResumeProcessor.normalizeText(
                    `${input.name || ""} ${input.id || ""} ${this.getLabelText(input)} ${input.getAttribute('aria-label') || ""}`
                ) : ""
        };
    }

    calculateConfidence(features, keywords, fieldKey) {
        let keywordScore = 0;
        const keywordWeights = {
            name_attr: 40,
            id_attr: 40,
            aria_label: 35,
            label_text: 35,
            placeholder: 20
        };

        let matchedPrimaryFeature = false;

        keywords.forEach(keyword => {
            const kw = keyword.toLowerCase();
            for (const [featureName, weight] of Object.entries(keywordWeights)) {
                const featureValue = features[featureName];
                if (featureValue && featureValue.includes(kw)) {
                    keywordScore += weight;
                    matchedPrimaryFeature = true;
                    if (featureValue === kw) {
                        keywordScore += weight * 0.5;
                    }
                }
            }
        });
        keywordScore = Math.min(keywordScore, 70);

        let contextScore = 0;
        keywords.forEach(keyword => {
            const kw = keyword.toLowerCase();
            // Nearby text often contains other fields' labels — only use long, specific phrases.
            if (features.nearby_text && kw.length >= 8 && features.nearby_text.includes(kw)) {
                contextScore += 5;
            }
        });
        contextScore = Math.min(contextScore, 15);

        let typeScore = 0;
        const isEmailField = fieldKey === 'email';
        const isPhoneField = fieldKey === 'phone';
        const isUrlField = fieldKey.includes('url') || fieldKey.includes('linkedin') || fieldKey.includes('github') || fieldKey === 'website';

        if (isEmailField && features.input_type === 'email') typeScore = 15;
        else if (isPhoneField && features.input_type === 'tel') typeScore = 15;
        else if (isUrlField && features.input_type === 'url') typeScore = 15;
        else typeScore = 5;

        let confidence = keywordScore + contextScore + typeScore;

        if (!matchedPrimaryFeature) {
            confidence = Math.min(confidence, 30);
        }

        return Math.min(Math.round(confidence), 100);
    }

    /**
     * Modern ATS forms (Greenhouse/Remix, Workday) expose stable hints: autocomplete, name, id.
     * Use these before fuzzy keyword scoring so the right JSON field always wins.
     */
    resolveFieldFromHtmlSemantics(input, normalizedData) {
        if (!normalizedData) return null;

        const ac = (input.getAttribute("autocomplete") || "").toLowerCase().trim();
        const acToPath = {
            "given-name": "identity.first_name",
            "additional-name": "identity.middle_name",
            "family-name": "identity.last_name",
            name: "identity.full_name",
            email: "contact.email",
            tel: "contact.phone",
            "tel-national": "contact.phone",
            "tel-local": "contact.phone",
            url: "contact.portfolio",
            "street-address": "contact.address",
            "address-line1": "contact.address",
            "address-line2": "contact.address",
            "address-level2": "contact.city",
            "address-level1": "contact.state",
            "postal-code": "contact.zip_code",
            country: "contact.country",
            "country-name": "contact.country"
        };
        if (ac && acToPath[ac]) {
            const value = this.getNestedValue(normalizedData, acToPath[ac]);
            if (value) return { value, confidence: 99 };
        }

        const id = (input.id || "").toLowerCase();
        const name = (input.name || "").toLowerCase();
        const hay = `${id} ${name}`;

        const pick = (path) => {
            const value = this.getNestedValue(normalizedData, path);
            return value ? { value, confidence: 97 } : null;
        };

        if (
            /(^|_)(first|fname|given|firstname|first_name)(_|$)|first.?name|given.?name|legalname.?first/i.test(
                hay
            )
        ) {
            const m = pick("identity.first_name");
            if (m) return m;
        }
        if (/(^|_)(last|lname|surname|family|lastname|last_name)(_|$)|last.?name|family.?name|legalname.?last/i.test(hay)) {
            const m = pick("identity.last_name");
            if (m) return m;
        }
        if (/(^|_)(middle|mname|middle_name)(_|$)|middle.?name/i.test(hay)) {
            const m = pick("identity.middle_name");
            if (m) return m;
        }
        if (/full_?name|fullname|legal_?name|applicant_?name/i.test(hay)) {
            const m = pick("identity.full_name");
            if (m) return m;
        }
        if (/(^|_)(email|e-mail|mail)(_|$)|\bemail\b/i.test(hay)) {
            const m = pick("contact.email");
            if (m) return m;
        }
        if (/(^|_)(phone|tel|mobile|cell|sms)(_|$)|\bphone\b|telephone/i.test(hay)) {
            const m = pick("contact.phone");
            if (m) return m;
        }
        if (/linkedin/i.test(hay)) {
            const m = pick("contact.linkedin");
            if (m) return m;
        }
        if (/github/i.test(hay)) {
            const m = pick("contact.github");
            if (m) return m;
        }
        if (/(^|_)(city|town|locality|municipality)(_|$)/i.test(hay)) {
            const m = pick("contact.city");
            if (m) return m;
        }
        if (/(^|_)(state|region|province|territory|statecode|state_code)(_|$)/i.test(hay)) {
            const m = pick("contact.state");
            if (m) return m;
        }
        if (/(zip|postal|zipcode|zip_code|postcode)/i.test(hay)) {
            const m = pick("contact.zip_code");
            if (m) return m;
        }
        if (/(^|_)(country|countrycode|country_code|nation)(_|$)/i.test(hay)) {
            const m = pick("contact.country");
            if (m) return m;
        }
        if (/(portfolio|personal_?website|company_?site)(_|$)/i.test(hay) && /url|link|website/i.test(hay)) {
            const m = pick("contact.portfolio");
            if (m) return m;
        }

        return null;
    }

    findValueForInput(input, normalizedData) {
        const semantics = this.resolveFieldFromHtmlSemantics(input, normalizedData);
        if (semantics) return semantics;

        const features = this.extractFeatures(input);

        // --- 1. Attempt Domain-Specific Dynamic Reverse Lookups ---
        // E.g., "years of experience with javascript"
        if (features.normalized_combined.includes("year") || features.normalized_combined.includes("experience")) {
            if (normalizedData.reverse_maps) {
                // Check skills first
                for (const [skill, years] of Object.entries(normalizedData.reverse_maps.skill_to_years)) {
                    if (features.normalized_combined.includes(skill)) {
                        return { value: years.toString(), confidence: 95 };
                    }
                }
                // Check titles/companies
                for (const [company, months] of Object.entries(normalizedData.reverse_maps.company_to_duration)) {
                    if (features.normalized_combined.includes(company)) {
                        return { value: Math.round(months / 12).toString(), confidence: 90 };
                    }
                }
                for (const [title, months] of Object.entries(normalizedData.reverse_maps.title_to_duration)) {
                    if (features.normalized_combined.includes(title)) {
                        return { value: Math.round(months / 12).toString(), confidence: 90 };
                    }
                }
            }
        }

        // --- 2. Standard Heuristic Matching ---
        let bestMatch = { value: null, confidence: 0 };

        for (const [fieldKey, keywords] of Object.entries(this.FIELD_MAPPING)) {
            const confidence = this.calculateConfidence(features, keywords, fieldKey);

            if (confidence > bestMatch.confidence) {
                const value = this.getNestedValue(normalizedData, fieldKey);

                if (value) {
                    bestMatch = { value, confidence };
                }
            }
        }

        return bestMatch.confidence > 0 ? bestMatch : null;
    }

    getLabelText(input) {
        if (input.parentElement && input.parentElement.tagName === 'LABEL') {
            return input.parentElement.innerText;
        }
        if (input.id) {
            const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
            if (label) return label.innerText;
        }
        const labeledBy = input.getAttribute('aria-labelledby');
        if (labeledBy) {
            const parts = labeledBy.trim().split(/\s+/);
            const text = parts
                .map(id => { const el = document.getElementById(id); return el ? el.innerText : ""; })
                .filter(Boolean)
                .join(" ");
            if (text) return text;
        }
        const aria = (input.getAttribute('aria-label') || '').trim();
        if (aria) return aria;
        const ph = (input.getAttribute('placeholder') || '').trim();
        if (ph && ph.length < 120) return ph;
        return '';
    }

    getNearbyText(input) {
        let container = input.parentElement;
        let iterations = 0;
        while (container && iterations < 2) {
            const text = container.innerText || "";
            if (text.length > 0 && text.length < 200) {
                return text;
            }
            container = container.parentElement;
            iterations++;
        }
        return '';
    }

    isReactSelect(input) {
        if (input.getAttribute('role') === 'combobox' && input.getAttribute('aria-haspopup') === 'true') return true;
        const parent = input.closest('.select-shell, .select__control, [class*="css-"][class*="-container"]');
        return !!parent;
    }

    fillReactSelect(input, value) {
        if (!value) return;
        const val = String(value);

        const fireKey = (el, key, extra = {}) => {
            const base = { key, code: key === 'Enter' ? 'Enter' : `Key${key.toUpperCase()}`,
                           keyCode: key === 'Enter' ? 13 : key.charCodeAt(0),
                           which: key === 'Enter' ? 13 : key.charCodeAt(0),
                           bubbles: true, cancelable: true, ...extra };
            el.dispatchEvent(new KeyboardEvent('keydown', base));
            if (key !== 'Enter' && key !== 'ArrowDown') {
                el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: key, inputType: 'insertText' }));
            }
            el.dispatchEvent(new KeyboardEvent('keyup', base));
        };

        const openMenu = () => {
            input.focus();
            input.dispatchEvent(new Event('focus', { bubbles: true }));
            const ctrl = input.closest('.select__control, [class*="control"]');
            if (ctrl) {
                ctrl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
                ctrl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
                ctrl.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
            }
            fireKey(input, 'ArrowDown', { keyCode: 40, which: 40, code: 'ArrowDown' });
        };

        const typeAndSelect = () => {
            this.setNativeInputValue(input, '');
            input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '', inputType: 'deleteContentBackward' }));

            this.setNativeInputValue(input, val);
            for (const ch of val) {
                fireKey(input, ch);
            }
            input.dispatchEvent(new Event('change', { bubbles: true }));

            const pressEnter = (attempt) => {
                const menuVisible = this._findReactSelectMenu(input);
                const options = menuVisible
                    ? menuVisible.querySelectorAll('[class*="option"], [role="option"]')
                    : [];

                if (options.length > 0 || attempt >= 4) {
                    if (options.length > 0) {
                        const lower = val.toLowerCase();
                        let targetIdx = 0;
                        options.forEach((opt, i) => {
                            const txt = (opt.textContent || '').trim().toLowerCase();
                            if (txt === lower || txt.startsWith(lower)) { targetIdx = i; }
                        });
                        for (let i = 0; i < targetIdx; i++) {
                            fireKey(input, 'ArrowDown', { keyCode: 40, which: 40, code: 'ArrowDown' });
                        }
                    }
                    setTimeout(() => {
                        fireKey(input, 'Enter', { keyCode: 13, which: 13, code: 'Enter' });
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    }, 50);
                } else {
                    setTimeout(() => pressEnter(attempt + 1), 150);
                }
            };

            setTimeout(() => pressEnter(0), 250);
        };

        openMenu();
        setTimeout(typeAndSelect, 150);
    }

    _findReactSelectMenu(input) {
        const shell = input.closest('.select-shell, [class*="css-"][class*="-container"]');
        if (shell) {
            const m = shell.querySelector('[class*="menu"]');
            if (m) return m;
        }
        const ctrl = input.closest('.select__control, [class*="control"]');
        if (ctrl && ctrl.parentElement) {
            const m = ctrl.parentElement.querySelector('[class*="menu"]');
            if (m) return m;
        }
        const id = input.id;
        if (id) {
            const portal = document.querySelector(`[id*="react-select-${CSS.escape(id)}"][id*="listbox"]`);
            if (portal && portal.closest('[class*="menu"]')) return portal.closest('[class*="menu"]');
        }
        return document.querySelector('[class*="select__menu"], [class*="-menu"][class*="css-"]');
    }

    setInputValue(input, value, highlightType = 'green') {
        if (!value && highlightType !== 'red') return;

        if (value) {
            const type = (input.type || '').toLowerCase();

            if (type === 'checkbox' || type === 'radio') {
                input.checked = true;
                this.dispatchInputEvents(input);
            } else if (this.isReactSelect(input)) {
                this.fillReactSelect(input, value);
            } else if (input.tagName === "SELECT") {
                for (let i = 0; i < input.options.length; i++) {
                    if (input.options[i].text.toLowerCase().includes(value.toLowerCase()) ||
                        input.options[i].value.toLowerCase().includes(value.toLowerCase())) {
                        input.selectedIndex = i;
                        break;
                    }
                }
                ["input", "change", "blur"].forEach((eventType) => {
                    input.dispatchEvent(new Event(eventType, { bubbles: true }));
                });
            } else {
                this.setNativeInputValue(input, value);
                this.dispatchInputEvents(input);
            }
        }

        const originalBg = input.style.backgroundColor;
        const originalBorder = input.style.border;

        if (highlightType === 'green') {
            input.style.backgroundColor = "#dcfce7"; // green-100
            input.style.border = "2px solid #22c55e"; // green-500
        } else if (highlightType === 'red') {
            input.style.backgroundColor = "#fee2e2"; // red-100
            input.style.border = "2px solid #ef4444"; // red-500
        }

        // Revert green highlighting after 3 seconds
        if (highlightType === 'green') {
            setTimeout(() => {
                input.style.backgroundColor = originalBg;
                input.style.border = originalBorder;
            }, 3000);
        }
    }

    highlightUnmatchedRequired(input) {
        if (input.getAttribute("aria-hidden") === "true") return;
        this.setInputValue(input, null, 'red');
    }

    promptUserConfirmation(input, suggestion, confidence) {
        const originalBorder = input.style.border;
        const originalBackground = input.style.backgroundColor;

        input.style.border = "2px solid #f59e0b";
        input.style.backgroundColor = "#fffbeb";

        const container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.zIndex = '2147483647';
        container.style.pointerEvents = 'auto';
        container.style.backgroundColor = '#ffffff';
        container.style.border = '1px solid #d1d5db';
        container.style.borderRadius = '4px';
        container.style.padding = '8px';
        container.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '4px';
        container.style.fontSize = '12px';
        container.style.fontFamily = 'system-ui, sans-serif';
        container.style.color = '#374151';

        const info = document.createElement('div');
        const strong = document.createElement('strong');
        strong.textContent = 'Suggested: ';
        const valueText = document.createTextNode(suggestion);
        const br = document.createElement('br');
        const confSpan = document.createElement('span');
        confSpan.style.color = '#6b7280';
        confSpan.style.fontSize = '10px';
        confSpan.textContent = `Confidence: ${Number(confidence) || 0}%`;
        info.appendChild(strong);
        info.appendChild(valueText);
        info.appendChild(br);
        info.appendChild(confSpan);

        const buttonRow = document.createElement('div');
        buttonRow.style.display = 'flex';
        buttonRow.style.gap = '4px';
        buttonRow.style.marginTop = '4px';

        const acceptBtn = document.createElement('button');
        acceptBtn.type = 'button';
        acceptBtn.textContent = '\u2713 Accept';
        acceptBtn.style.padding = '2px 8px';
        acceptBtn.style.backgroundColor = '#10b981';
        acceptBtn.style.color = 'white';
        acceptBtn.style.border = 'none';
        acceptBtn.style.borderRadius = '2px';
        acceptBtn.style.cursor = 'pointer';

        const rejectBtn = document.createElement('button');
        rejectBtn.type = 'button';
        rejectBtn.textContent = '\u2717 Reject';
        rejectBtn.style.padding = '2px 8px';
        rejectBtn.style.backgroundColor = '#ef4444';
        rejectBtn.style.color = 'white';
        rejectBtn.style.border = 'none';
        rejectBtn.style.borderRadius = '2px';
        rejectBtn.style.cursor = 'pointer';

        buttonRow.appendChild(acceptBtn);
        buttonRow.appendChild(rejectBtn);
        container.appendChild(info);
        container.appendChild(buttonRow);

        const rect = input.getBoundingClientRect();
        container.style.top = `${rect.bottom + 4}px`;
        container.style.left = `${Math.max(8, rect.left)}px`;

        document.body.appendChild(container);

        const stop = (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        };

        const cleanup = () => {
            container.remove();
            input.style.border = originalBorder;
            input.style.backgroundColor = originalBackground;
        };

        const onAccept = (e) => {
            stop(e);
            this.setInputValue(input, suggestion);
            cleanup();
        };
        const onReject = (e) => {
            stop(e);
            cleanup();
        };

        acceptBtn.addEventListener('mousedown', stop, true);
        rejectBtn.addEventListener('mousedown', stop, true);
        acceptBtn.addEventListener('click', onAccept, true);
        rejectBtn.addEventListener('click', onReject, true);
    }
}
