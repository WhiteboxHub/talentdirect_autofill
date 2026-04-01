/**
 * leverStrategy.js
 * Strategy for Lever application forms.
 * Delegates to GenericStrategy.execute() for fill reports, shadow DOM, and required-field highlighting.
 * Overrides findPlatformSpecificMatch() for Lever-specific field detection.
 */
class LeverStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 65;
    }

    findPlatformSpecificMatch(input, data) {
        const nameAttr = (input.name || "").toLowerCase();

        if (nameAttr === 'name') return { value: data?.identity?.full_name, confidence: 95 };
        if (nameAttr === 'email') return { value: data?.contact?.email, confidence: 95 };
        if (nameAttr === 'phone') return { value: data?.contact?.phone, confidence: 95 };
        if (nameAttr === 'org') return { value: data?.employment?.current_company, confidence: 90 };

        if (nameAttr.includes('url')) {
            if (nameAttr.includes('linkedin')) return { value: data?.contact?.linkedin, confidence: 95 };
            if (nameAttr.includes('github')) return { value: data?.contact?.github, confidence: 95 };
            if (nameAttr.includes('portfolio')) return { value: data?.contact?.portfolio, confidence: 95 };
        }

        return null;
    }
}

if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url) => url.includes('lever.co'),
        LeverStrategy
    );
}
