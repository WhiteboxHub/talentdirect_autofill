/**
 * adpStrategy.js
 * Strategy for Adp application forms.
 */
class AdpStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 70; 
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('adp.com'),
        AdpStrategy
    );
}
