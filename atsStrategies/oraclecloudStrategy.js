/**
 * oraclecloudStrategy.js
 * Strategy for OracleCloud application forms.
 */
class OracleCloudStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 70; 
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('oraclecloud.com'),
        OracleCloudStrategy
    );
}
