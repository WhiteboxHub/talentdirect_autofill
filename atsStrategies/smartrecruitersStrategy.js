/**
 * smartrecruitersStrategy.js
 * Strategy for SmartRecruiters application forms.
 */
class SmartRecruitersStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 70; 
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('smartrecruiters.com'),
        SmartRecruitersStrategy
    );
}
