/**
 * recruiteeStrategy.js
 * Strategy for Recruitee application forms.
 */
class RecruiteeStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 70; 
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('recruitee.com'),
        RecruiteeStrategy
    );
}
