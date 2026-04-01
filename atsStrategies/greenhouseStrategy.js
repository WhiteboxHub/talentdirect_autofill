/**
 * greenhouseStrategy.js
 * Strategy for Greenhouse application forms.
 * Delegates to GenericStrategy.execute() for fill reports, shadow DOM, and required-field highlighting.
 * Overrides findPlatformSpecificMatch() for Greenhouse-specific field detection.
 */
class GreenhouseStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 60;
    }

    findPlatformSpecificMatch(input, data) {
        const id = (input.id || "").toLowerCase();

        let labelTxt = "";
        if (input.id) {
            const labelEl = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
            if (labelEl) labelTxt = labelEl.innerText.toLowerCase();
        }

        if (!labelTxt) {
            const parentDiv = input.closest('div.field') || input.closest('div.input-wrapper') || input.closest('div.select__container') || input.parentElement;
            labelTxt = parentDiv ? (parentDiv.querySelector('label')?.innerText || "").toLowerCase() : "";
        }

        if (id.includes('first_name')) return { value: data?.identity?.first_name, confidence: 95 };
        if (id.includes('last_name')) return { value: data?.identity?.last_name, confidence: 95 };
        if (id.includes('email')) return { value: data?.contact?.email, confidence: 95 };
        if (id.includes('phone')) return { value: data?.contact?.phone, confidence: 95 };

        if (labelTxt.includes("linkedin") || id.includes("linkedin")) return { value: data?.contact?.linkedin, confidence: 90 };
        if (labelTxt.includes("github") || labelTxt.includes("portfolio") || labelTxt.includes("website")) return { value: data?.contact?.portfolio || data?.contact?.github, confidence: 85 };

        return null;
    }
}

if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url) => url.includes('greenhouse.io'),
        GreenhouseStrategy
    );
}
