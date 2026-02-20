/**
 * greenhouseStrategy.js
 * Strategy for Greenhouse application forms.
 */
class GreenhouseStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 60; // Lower threshold as Greenhouse structures are more predictable
    }

    execute(normalizedData, aiEnabled) {
        console.log("Executing GreenhouseStrategy...");

        // Greenhouse specific targets, e.g., input[id^="job_application_"]
        const inputs = document.querySelectorAll('input, select, textarea');

        inputs.forEach(input => {
            if (input.type === 'hidden' || input.disabled || input.readOnly) return;

            let match = this.findGreenhouseSpecificMatch(input, normalizedData);

            // Fallback to generic matching if no specific match found
            if (!match || !match.value) {
                match = this.findValueForInput(input, normalizedData);
            }

            if (match && match.value) {
                if (match.confidence >= this.CONFIDENCE_THRESHOLD) {
                    this.setInputValue(input, match.value);
                } else {
                    this.promptUserConfirmation(input, match.value, match.confidence);
                }
            } else if (aiEnabled) {
                console.log("AI Enabled: Would attempt to fill unmatched field", input.name || input.id);
            }
        });

        alert('Greenhouse AutoFill complete! Please review the form.');
    }

    findGreenhouseSpecificMatch(input, data) {
        const id = (input.id || "").toLowerCase();
        const parentDiv = input.closest('div.field');
        const labelTxt = parentDiv ? (parentDiv.querySelector('label')?.innerText || "").toLowerCase() : "";

        if (id.includes('first_name')) return { value: data.first_name, confidence: 95 };
        if (id.includes('last_name')) return { value: data.last_name, confidence: 95 };
        if (id.includes('email')) return { value: data.email, confidence: 95 };
        if (id.includes('phone')) return { value: data.phone, confidence: 95 };

        // Specific checks based on common Greenhouse custom questions
        if (labelTxt.includes("linkedin") || id.includes("linkedin")) return { value: data.linkedin_url, confidence: 90 };
        if (labelTxt.includes("github") || labelTxt.includes("portfolio") || labelTxt.includes("website")) return { value: data.portfolio_url || data.github_url, confidence: 85 };

        return null; // Return null if not a highly matched specific Greenhouse field
    }
}
