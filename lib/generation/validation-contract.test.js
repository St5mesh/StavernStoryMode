import { describe, it, expect } from 'vitest';
import * as validation from './validation.js';
import { parseStagedResponse } from './staged-scene-parser.js';

describe('validation module export contract', () => {
    it('exports staged scene normalization and validators as named exports', () => {
        expect(typeof validation.normalizeStagedScenePayload).toBe('function');
        expect(typeof validation.validateScenePlanOutput).toBe('function');
        expect(typeof validation.validateSceneBatchOutput).toBe('function');
    });

    it('keeps backwards-compatible normalize aliases', () => {
        expect(validation.normalizeStagedPayload).toBe(validation.normalizeStagedScenePayload);
        expect(validation.normalizeScenePayload).toBe(validation.normalizeStagedScenePayload);
    });
});

describe('staged scenes normalization path', () => {
    it('parses and normalizes aliased staged scene payloads through scenes flow', () => {
        const parsed = parseStagedResponse(
            '3b',
            '{"scene":{"index":0,"title":"Opening","beats":[{"index":0}]}}',
            800,
            [0]
        );

        expect(parsed.scenes).toHaveLength(1);
        expect(parsed.scenes[0].title).toBe('Opening');
    });

    it('throws clear error for empty staged response', () => {
        expect(() => parseStagedResponse('3b', '   ', 800, [0]))
            .toThrow(/Empty response/i);
    });

    it('throws clear error for malformed staged JSON', () => {
        expect(() => parseStagedResponse('3b', '{"scenes":[{"index":0}]', 800, [0]))
            .toThrow(/Failed to parse JSON/i);
    });
});
