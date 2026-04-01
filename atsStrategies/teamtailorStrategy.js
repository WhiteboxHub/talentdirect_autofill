/**
 * teamtailorStrategy.js
 * Strategy for Teamtailor application forms.
 */
class TeamtailorStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 70; 
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('teamtailor.com'),
        TeamtailorStrategy
    );
}
