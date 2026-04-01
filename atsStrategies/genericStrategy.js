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
            "employment.current_company": ["company", "employer", "current company", "organization"],
            "employment.years_total": ["total experience", "years experience", "total years"]
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
    shouldSkipInput(input) {
        const type = (input.type || "").toLowerCase();
        const id = (input.id || "").toLowerCase();
        const name = (input.name || "").toLowerCase();
        const ph = (input.placeholder || "").toLowerCase();
        const aria = (input.getAttribute("aria-label") || "").toLowerCase();

        // Greenhouse / Remix: hidden "required" honeypots — prompts break focus (aria-hidden warnings).
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

        const label = (this.getLabelText(input) || "").toLowerCase();
        const combined = `${label} ${id} ${name} ${aria}`.toLowerCase();
        if (input.tagName === "SELECT" || type === "radio" || type === "checkbox") {
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

    execute(normalizedData, aiEnabled) {
        console.log("Executing GenericStrategy...");
        const inputs = this.collectAllFormElements();

        // This array will hold the report data for the side panel
        let fillReport = [];

        inputs.forEach(input => {
            if (input.type === 'hidden' || input.disabled || input.readOnly) return;
            if (this.shouldSkipInput(input)) return;
            const match = this.findValueForInput(input, normalizedData);

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
                /* below MIN_PROMPT_CONFIDENCE: skip — avoids wrong popups on every field */
            } else {
                // Check if it's a required field that was missed
                if (input.required || input.getAttribute('aria-required') === 'true') {
                    this.highlightUnmatchedRequired(input);
                    status = 'unmatched_required';
                }
            }

            // Only add to report if it's an actionable or matched field
            if (status !== 'unmatched') {
                const labelText = this.getLabelText(input) || input.name || input.id || input.placeholder || "Unknown Field";
                fillReport.push({
                    id: input.id || input.name || Math.random().toString(36).substr(2, 9),
                    label: labelText,
                    value: finalValue,
                    confidence: match ? match.confidence : 0,
                    status: status
                });
            }
        });

        // Send the fill report to the sidepanel
        chrome.runtime.sendMessage({
            action: 'fill_report',
            report: fillReport
        });

        console.log("AutoFill complete — check side panel Fill Summary (no blocking alert).");
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
            const labelElement = document.getElementById(labeledBy);
            if (labelElement) return labelElement.innerText;
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

    setInputValue(input, value, highlightType = 'green') {
        if (!value && highlightType !== 'red') return;

        if (value) {
            if (input.tagName === "SELECT") {
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
        info.innerHTML = `<strong>Suggested:</strong> ${suggestion}<br/><span style="color: #6b7280; font-size: 10px;">Confidence: ${confidence}%</span>`;

        const buttonRow = document.createElement('div');
        buttonRow.style.display = 'flex';
        buttonRow.style.gap = '4px';
        buttonRow.style.marginTop = '4px';

        const acceptBtn = document.createElement('button');
        acceptBtn.type = 'button';
        acceptBtn.innerHTML = '✓ Accept';
        acceptBtn.style.padding = '2px 8px';
        acceptBtn.style.backgroundColor = '#10b981';
        acceptBtn.style.color = 'white';
        acceptBtn.style.border = 'none';
        acceptBtn.style.borderRadius = '2px';
        acceptBtn.style.cursor = 'pointer';

        const rejectBtn = document.createElement('button');
        rejectBtn.type = 'button';
        rejectBtn.innerHTML = '✗ Reject';
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
