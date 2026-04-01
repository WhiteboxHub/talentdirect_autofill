/**
 * jobviteStrategy.js
 * Strategy for Jobvite application forms.
 */
class JobviteStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 70; 
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('jobvite.com'),
        JobviteStrategy
    );
}
