/**
 * workdayStrategy.js
 * Strategy for Workday application forms.
 * Delegates to GenericStrategy.execute() for fill reports, shadow DOM, and required-field highlighting.
 * Overrides findPlatformSpecificMatch() for Workday-specific data-automation-id detection.
 */
class WorkdayStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 70;
    }

    findPlatformSpecificMatch(input, data) {
        const dataAutomationId = (input.getAttribute('data-automation-id') || "").toLowerCase();

        if (!dataAutomationId) return null;

        if (dataAutomationId.includes('legalname-first')) return { value: data?.identity?.first_name, confidence: 95 };
        if (dataAutomationId.includes('legalname-last')) return { value: data?.identity?.last_name, confidence: 95 };
        if (dataAutomationId.includes('legalname-middle')) return { value: data?.identity?.middle_name, confidence: 95 };
        if (dataAutomationId.includes('email')) return { value: data?.contact?.email, confidence: 95 };
        if (dataAutomationId.includes('phone-number')) return { value: data?.contact?.phone, confidence: 95 };
        if (dataAutomationId.includes('address-line1')) return { value: data?.contact?.address, confidence: 95 };
        if (dataAutomationId.includes('address-city')) return { value: data?.contact?.city, confidence: 95 };
        if (dataAutomationId.includes('address-state')) return { value: data?.contact?.state, confidence: 90 };
        if (dataAutomationId.includes('address-postal-code')) return { value: data?.contact?.zip_code, confidence: 95 };
        if (dataAutomationId.includes('country')) return { value: data?.contact?.country, confidence: 90 };

        return null;
    }
}

if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('workday.com') || url.includes('myworkdayjobs.com'),
        WorkdayStrategy
    );
}
