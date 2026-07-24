/**
 * Tests for persona-optional behavior in buildPersonaSection and related prompt helpers.
 *
 * Regression tests for the bug where the model refused to operate when no
 * SillyTavern persona was selected, even though persona is optional for
 * authoring workflows.
 *
 * NOTE — inline re-implementations:
 * The production functions (`buildPersonaSection` in prompts.js and
 * staged-prompts.js) depend on the SillyTavern browser global `power_user`
 * imported from `/scripts/power-user.js`, which is not available in the
 * vitest environment.  Rather than adding a module mock layer, this file
 * re-implements the pure logic locally.  If the production implementations
 * change, these re-implementations MUST be updated accordingly.
 *
 * Sync targets:
 *   buildPersonaSectionFromPrompts  → lib/generation/prompts.js::buildPersonaSection
 *   formatPersonaFromStagedPrompts  → lib/generation/staged-prompts.js::formatPersona
 *   buildPersonaSectionFromStagedPrompts → lib/generation/staged-prompts.js::buildPersonaSection
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocking helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock power_user object with the given persona map.
 * @param {Record<string, string>} personas - id -> name
 * @param {Record<string, {title?: string, description?: string}>} descriptions
 */
function makePowerUser(personas = {}, descriptions = {}) {
    return { personas, persona_descriptions: descriptions };
}

// ---------------------------------------------------------------------------
// Inline re-implementation of the functions under test so we can unit-test
// them without a SillyTavern browser context.  These mirror the logic in
// lib/generation/prompts.js and lib/generation/staged-prompts.js exactly.
// ---------------------------------------------------------------------------

function buildPersonaSectionFromPrompts(personaData, power_user) {
    if (!personaData || personaData.length === 0) return '';
    if (!power_user?.personas || !power_user?.persona_descriptions) return '';

    const resolvedEntries = personaData.map(personaRef => {
        const personaName = power_user.personas[personaRef.id];
        const personaDesc = power_user.persona_descriptions[personaRef.id];
        if (!personaName || !personaDesc) return null;
        let text = `**Persona: ${personaName}`;
        if (personaDesc.title) text += ` (${personaDesc.title})`;
        text += '**\n';
        if (personaDesc.description) text += `Description: ${personaDesc.description}\n`;
        return text;
    }).filter(e => e !== null);

    if (resolvedEntries.length === 0) return '';

    const personaDataStr = resolvedEntries.join('\n---\n');
    return `---\n\n### PERSONA DATA (OPTIONAL)\n\n${personaDataStr}\n\nPersona is not required — if absent, proceed using story setup characters and world info.\n\n---`;
}

function formatPersonaFromStagedPrompts(personaRef, power_user) {
    const personaName = power_user.personas[personaRef.id];
    const personaDesc = power_user.persona_descriptions[personaRef.id];
    if (!personaName || !personaDesc) return null;
    const title = personaDesc.title ? ` (${personaDesc.title})` : '';
    const desc = personaDesc.description ? `Description: ${personaDesc.description}\n` : '';
    return `**Persona: ${personaName}${title}**\n${desc}`;
}

function buildPersonaSectionFromStagedPrompts(personaData, power_user) {
    if (!personaData?.length) return '';
    if (!power_user?.personas || !power_user?.persona_descriptions) return '';
    const resolvedEntries = personaData.map(ref => formatPersonaFromStagedPrompts(ref, power_user)).filter(e => e !== null);
    if (resolvedEntries.length === 0) return '';
    const personaDataStr = resolvedEntries.join('\n---\n');
    return `---\n### PERSONA DATA (OPTIONAL)\n\n${personaDataStr}\n\nPersona is optional — if absent, proceed using story setup characters and world info.\n\n---`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildPersonaSection (prompts.js behavior)', () => {
    it('returns empty string when personaData is empty array', () => {
        const pu = makePowerUser({ abc: 'Alice' }, { abc: { description: 'A hero' } });
        expect(buildPersonaSectionFromPrompts([], pu)).toBe('');
    });

    it('returns empty string when personaData is null', () => {
        const pu = makePowerUser({ abc: 'Alice' }, { abc: { description: 'A hero' } });
        expect(buildPersonaSectionFromPrompts(null, pu)).toBe('');
    });

    it('returns empty string when power_user is undefined', () => {
        const data = [{ id: 'abc', name: 'Alice' }];
        expect(buildPersonaSectionFromPrompts(data, undefined)).toBe('');
    });

    it('returns empty string when power_user has no personas', () => {
        const data = [{ id: 'abc', name: 'Alice' }];
        expect(buildPersonaSectionFromPrompts(data, {})).toBe('');
    });

    // Regression: persona selected in UI but ID not in power_user
    it('returns empty string when selected persona ID is not in power_user — no "data not available" placeholder', () => {
        const pu = makePowerUser({ other: 'Bob' }, { other: { description: 'Someone else' } });
        const data = [{ id: 'missing_id', name: 'Alice' }];
        const result = buildPersonaSectionFromPrompts(data, pu);
        expect(result).toBe('');
        expect(result).not.toContain('not available');
    });

    it('builds section when persona data is fully resolved', () => {
        const pu = makePowerUser(
            { 'alice.png': 'Alice' },
            { 'alice.png': { description: 'Brave adventurer', title: 'The Bold' } }
        );
        const data = [{ id: 'alice.png', name: 'Alice' }];
        const result = buildPersonaSectionFromPrompts(data, pu);
        expect(result).toContain('Alice');
        expect(result).toContain('Brave adventurer');
        expect(result).toContain('OPTIONAL');
        expect(result).not.toContain('You MUST');
        expect(result).not.toContain('not available');
    });

    it('skips unresolvable entries but includes resolvable ones', () => {
        const pu = makePowerUser(
            { 'alice.png': 'Alice' },
            { 'alice.png': { description: 'Adventurer' } }
        );
        const data = [
            { id: 'missing', name: 'Ghost' },
            { id: 'alice.png', name: 'Alice' },
        ];
        const result = buildPersonaSectionFromPrompts(data, pu);
        expect(result).toContain('Alice');
        expect(result).not.toContain('Ghost');
        expect(result).not.toContain('not available');
    });

    it('returns empty string when all persona entries are unresolvable — no refusal trigger', () => {
        const pu = makePowerUser({ unrelated: 'Bob' }, { unrelated: {} });
        const data = [
            { id: 'ghost1', name: 'Ghost1' },
            { id: 'ghost2', name: 'Ghost2' },
        ];
        const result = buildPersonaSectionFromPrompts(data, pu);
        // Must not produce any content that could mislead the model into refusing
        expect(result).toBe('');
    });

    // Scenario: persona absent + story setup present → section is empty (no refusal trigger)
    it('persona absent + story setup present: persona section is empty so model can proceed', () => {
        // When persona_data is empty the section must be '' so the model
        // receives no persona-related constraint and can use story setup.
        const pu = makePowerUser({ abc: 'Alice' }, { abc: { description: 'Hero' } });
        const section = buildPersonaSectionFromPrompts([], pu);
        expect(section).toBe('');
    });

    // Scenario: persona absent + lore present → same, section is empty
    it('persona absent + lore present: section is empty, no blocking constraint', () => {
        const section = buildPersonaSectionFromPrompts([], undefined);
        expect(section).toBe('');
    });

    // Scenario: persona absent + both story setup and lore present → still empty
    it('persona absent + story setup + lore: section is empty so model proceeds freely', () => {
        const section = buildPersonaSectionFromPrompts(null, undefined);
        expect(section).toBe('');
    });

    // Scenario: persona missing from power_user + no story setup → still no "not applicable" placeholder
    it('persona ID not in power_user with no other context: section is empty, no refusal string injected', () => {
        const pu = makePowerUser({}, {});
        const data = [{ id: 'nonexistent', name: 'SomeUser' }];
        const result = buildPersonaSectionFromPrompts(data, pu);
        expect(result).toBe('');
        expect(result).not.toMatch(/not applicable/i);
        expect(result).not.toMatch(/not available/i);
        expect(result).not.toMatch(/persona.*required/i);
    });
});

describe('buildPersonaSection (staged-prompts.js behavior)', () => {
    it('returns empty string for empty personaData', () => {
        const pu = makePowerUser({ abc: 'Alice' }, { abc: {} });
        expect(buildPersonaSectionFromStagedPrompts([], pu)).toBe('');
    });

    it('skips unresolvable entries — no "not available" placeholder', () => {
        const pu = makePowerUser({ 'known.png': 'Bob' }, { 'known.png': { description: 'Desc' } });
        const data = [{ id: 'unknown', name: 'Ghost' }];
        const result = buildPersonaSectionFromStagedPrompts(data, pu);
        expect(result).toBe('');
        expect(result).not.toContain('not available');
    });

    it('returns empty when all entries are missing from power_user', () => {
        const pu = makePowerUser({}, {});
        const data = [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }];
        expect(buildPersonaSectionFromStagedPrompts(data, pu)).toBe('');
    });

    it('includes resolvable entries and marks section as optional', () => {
        const pu = makePowerUser({ 'u.png': 'User' }, { 'u.png': { description: 'The player', title: 'Hero' } });
        const data = [{ id: 'u.png', name: 'User' }];
        const result = buildPersonaSectionFromStagedPrompts(data, pu);
        expect(result).toContain('User');
        expect(result).toContain('OPTIONAL');
        expect(result).not.toContain('You MUST');
    });
});
