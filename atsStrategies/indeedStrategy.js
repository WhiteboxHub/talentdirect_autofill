/**
 * indeedStrategy.js
 * Strategy for Indeed application forms.
 */
class IndeedStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 70; 
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('indeed.com'),
        IndeedStrategy
    );
}
