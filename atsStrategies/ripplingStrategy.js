/**
 * ripplingStrategy.js
 * Strategy for Rippling application forms.
 */
class RipplingStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 70; 
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('rippling.com'),
        RipplingStrategy
    );
}
