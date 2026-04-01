/**
 * ultiproStrategy.js
 * Strategy for Ultipro application forms.
 */
class UltiproStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 70; 
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('ultipro.com'),
        UltiproStrategy
    );
}
