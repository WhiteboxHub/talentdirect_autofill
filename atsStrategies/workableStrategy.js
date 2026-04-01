/**
 * workableStrategy.js
 * Strategy for Workable application forms.
 */
class WorkableStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 70; 
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('workable.com'),
        WorkableStrategy
    );
}
