/**
 * successfactorsStrategy.js
 * Strategy for SuccessFactors application forms.
 */
class SuccessFactorsStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 70; 
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('sapsf.com') || url.includes('successfactors.com'),
        SuccessFactorsStrategy
    );
}
