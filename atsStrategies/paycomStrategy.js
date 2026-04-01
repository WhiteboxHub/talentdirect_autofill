/**
 * paycomStrategy.js
 * Strategy for Paycom application forms.
 */
class PaycomStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 70; 
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('paycom.com'),
        PaycomStrategy
    );
}
