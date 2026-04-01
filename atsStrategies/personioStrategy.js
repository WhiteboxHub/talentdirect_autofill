/**
 * personioStrategy.js
 * Strategy for Personio application forms.
 */
class PersonioStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 70; 
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('personio.com'),
        PersonioStrategy
    );
}
