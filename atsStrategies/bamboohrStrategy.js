/**
 * bamboohrStrategy.js
 * Strategy for BambooHr application forms.
 */
class BambooHrStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 70; 
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('bamboohr.com'),
        BambooHrStrategy
    );
}
