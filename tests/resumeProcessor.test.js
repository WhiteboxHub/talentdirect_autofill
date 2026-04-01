const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const ResumeProcessor = require('../resumeProcessor.js');

describe('ResumeProcessor.normalizeText', () => {
    it('lowercases and strips punctuation', () => {
        assert.equal(ResumeProcessor.normalizeText('Hello, World!'), 'hello world');
    });

    it('expands known abbreviations', () => {
        assert.equal(ResumeProcessor.normalizeText('ML engineer'), 'machine learning engineer');
        assert.equal(ResumeProcessor.normalizeText('AI on AWS'), 'artificial intelligence on amazon web services');
    });

    it('returns empty string for falsy input', () => {
        assert.equal(ResumeProcessor.normalizeText(null), '');
        assert.equal(ResumeProcessor.normalizeText(''), '');
        assert.equal(ResumeProcessor.normalizeText(undefined), '');
    });
});

describe('ResumeProcessor.normalize', () => {
    const sampleResume = {
        basics: {
            name: 'Ramana Gangarao',
            label: 'AI Engineer',
            email: 'test@example.com',
            phone: '(754) 275-7752',
            url: 'https://example.com',
            summary: 'AI Engineer with 9+ years of experience. Specializing in RAG pipelines.',
            location: {
                city: 'San Francisco',
                region: 'CA',
                countryCode: 'US',
                postalCode: '94105'
            },
            profiles: [
                { network: 'LinkedIn', url: 'https://linkedin.com/in/ramana' },
                { network: 'GitHub', url: 'https://github.com/RamanaGR' }
            ]
        },
        work: [
            {
                name: 'Optum',
                position: 'AI Engineer',
                startDate: '2025-12',
                endDate: ''
            },
            {
                name: 'Wipro Limited',
                position: 'Developer Analyst',
                startDate: '2021-09',
                endDate: '2024-08'
            }
        ],
        skills: [
            {
                name: 'Programming Languages',
                keywords: ['Python', 'JavaScript', 'Java']
            },
            {
                name: 'Cloud',
                keywords: ['AWS', 'GCP']
            }
        ],
        education: [
            {
                institution: 'Atlantis University',
                area: 'Information Technology',
                studyType: 'MS',
                startDate: '2024-08',
                endDate: '2025-10'
            }
        ]
    };

    it('returns empty object for null input', () => {
        assert.deepEqual(ResumeProcessor.normalize(null), {});
        assert.deepEqual(ResumeProcessor.normalize(undefined), {});
    });

    it('extracts identity from basics.name', () => {
        const result = ResumeProcessor.normalize(sampleResume);
        assert.equal(result.identity.first_name, 'Ramana');
        assert.equal(result.identity.last_name, 'Gangarao');
        assert.equal(result.identity.full_name, 'Ramana Gangarao');
        assert.equal(result.identity.middle_name, '');
    });

    it('handles three-part names with middle name', () => {
        const data = { basics: { name: 'John Michael Doe' } };
        const result = ResumeProcessor.normalize(data);
        assert.equal(result.identity.first_name, 'John');
        assert.equal(result.identity.middle_name, 'Michael');
        assert.equal(result.identity.last_name, 'Doe');
    });

    it('extracts contact details', () => {
        const result = ResumeProcessor.normalize(sampleResume);
        assert.equal(result.contact.email, 'test@example.com');
        assert.equal(result.contact.phone, '7542757752');
        assert.equal(result.contact.city, 'San Francisco');
        assert.equal(result.contact.state, 'CA');
        assert.equal(result.contact.country, 'US');
        assert.equal(result.contact.zip_code, '94105');
        assert.equal(result.contact.portfolio, 'https://example.com');
    });

    it('resolves LinkedIn and GitHub profiles', () => {
        const result = ResumeProcessor.normalize(sampleResume);
        assert.equal(result.contact.linkedin, 'https://linkedin.com/in/ramana');
        assert.equal(result.contact.github, 'https://github.com/RamanaGR');
    });

    it('extracts current employment', () => {
        const result = ResumeProcessor.normalize(sampleResume);
        assert.equal(result.employment.current_role, 'AI Engineer');
        assert.equal(result.employment.current_company, 'Optum');
        assert.ok(result.employment.years_total >= 3);
    });

    it('normalizes skills into flat keyword set', () => {
        const result = ResumeProcessor.normalize(sampleResume);
        assert.ok(result.skills.normalized_skill_set.length >= 5);
        assert.ok(result.skills.normalized_skill_set.includes('python'));
        assert.ok(result.skills.normalized_skill_set.includes('javascript'));
        assert.ok(result.skills.normalized_skill_set.includes('java'));
    });

    it('expands abbreviations in skills', () => {
        const result = ResumeProcessor.normalize(sampleResume);
        assert.ok(result.skills.normalized_skill_set.includes('amazon web services'));
        assert.ok(result.skills.normalized_skill_set.includes('google cloud platform'));
    });

    it('extracts summary short and long', () => {
        const result = ResumeProcessor.normalize(sampleResume);
        assert.ok(result.summary.long.includes('AI Engineer with 9+'));
        assert.ok(result.summary.short.endsWith('.'));
    });

    it('passes education through', () => {
        const result = ResumeProcessor.normalize(sampleResume);
        assert.equal(result.education.length, 1);
        assert.equal(result.education[0].institution, 'Atlantis University');
    });

    it('builds reverse maps', () => {
        const result = ResumeProcessor.normalize(sampleResume);
        assert.ok(result.reverse_maps.skill_to_years);
        assert.ok(result.reverse_maps.company_to_duration);
        assert.ok(result.reverse_maps.title_to_duration);
    });

    it('handles empty resume gracefully', () => {
        const result = ResumeProcessor.normalize({});
        assert.equal(result.identity.first_name, '');
        assert.equal(result.contact.email, '');
        assert.equal(result.employment.current_role, '');
        assert.equal(result.skills.normalized_skill_set.length, 0);
    });

    it('handles resume with no work entries', () => {
        const data = { basics: { name: 'Test User', email: 'a@b.com' } };
        const result = ResumeProcessor.normalize(data);
        assert.equal(result.employment.years_total, 0);
        assert.equal(result.employment.current_role, '');
    });

    it('normalizes applicationPreferences into preferences', () => {
        const data = {
            basics: { name: 'Test' },
            applicationPreferences: {
                work_authorization: 'Yes',
                requires_visa_sponsorship: 'No',
                salary_expectation: '$150,000',
                gender: 'Male',
                auto_consent: true
            }
        };
        const result = ResumeProcessor.normalize(data);
        assert.equal(result.preferences.work_authorization, 'Yes');
        assert.equal(result.preferences.requires_visa_sponsorship, 'No');
        assert.equal(result.preferences.salary_expectation, '$150,000');
        assert.equal(result.preferences.gender, 'Male');
        assert.equal(result.preferences.auto_consent, true);
    });

    it('defaults preferences when applicationPreferences is missing', () => {
        const result = ResumeProcessor.normalize(sampleResume);
        assert.equal(result.preferences.work_authorization, '');
        assert.equal(result.preferences.auto_consent, false);
    });
});
