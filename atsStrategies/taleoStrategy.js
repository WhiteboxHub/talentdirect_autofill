/**
 * taleoStrategy.js
 * Strategy for Taleo application forms.
 */
class TaleoStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 70; 
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('taleo.net'),
        TaleoStrategy
    );
}
