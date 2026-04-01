/**
 * applytojobStrategy.js
 * Strategy for ApplyToJob application forms.
 */
class ApplyToJobStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 70; 
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('applytojob.com'),
        ApplyToJobStrategy
    );
}
