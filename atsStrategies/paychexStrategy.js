/**
 * paychexStrategy.js
 * Strategy for Paychex application forms.
 */
class PaychexStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 70; 
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('paychex.com'),
        PaychexStrategy
    );
}
