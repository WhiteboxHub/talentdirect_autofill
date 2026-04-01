/**
 * brassringStrategy.js
 * Strategy for Brassring application forms.
 */
class BrassringStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 70; 
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('brassring.com'),
        BrassringStrategy
    );
}
