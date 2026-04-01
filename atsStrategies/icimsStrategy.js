/**
 * icimsStrategy.js
 * Strategy for Icims application forms.
 */
class IcimsStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 70; 
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('icims.com'),
        IcimsStrategy
    );
}
