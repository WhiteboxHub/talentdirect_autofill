/**
 * linkedinStrategy.js
 * Strategy for Linkedin application forms.
 */
class LinkedinStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 70; 
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('linkedin.com/jobs'),
        LinkedinStrategy
    );
}
