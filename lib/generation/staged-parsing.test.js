import { describe, it, expect } from 'vitest';
import { robustParseJSON } from '../blueprint/utils.js';
import {
    normalizeStagedScenePayload,
    validateSceneBatchOutput,
    validateScenePlanOutput,
} from './validation.js';

describe('staged JSON parsing hardening', () => {
    it('parses JSON with prefixed junk before root object', () => {
        const parsed = robustParseJSON('Note: generated output follows\n{ "scene_plan": [{"index":0,"title":"A","phase":"setup","purpose":"P"}] }');
        expect(parsed.scene_plan).toHaveLength(1);
    });

    it('parses first balanced JSON and ignores trailing prose/braces', () => {
        const parsed = robustParseJSON('{"scenes":[{"index":0,"beats":[{"index":0}]}]}\nThanks! } extra');
        expect(parsed.scenes).toHaveLength(1);
    });

    it('coerces root array into scenes object for staged scene batches', () => {
        const parsed = robustParseJSON('[{"index":0,"title":"A","beats":[{"index":0}]}]');
        const { data, normalization } = normalizeStagedScenePayload('3b', parsed);

        expect(normalization).toBe('wrapped_root_array_as_scenes');
        expect(data.scenes).toHaveLength(1);
        expect(() => validateSceneBatchOutput(data, [0])).not.toThrow();
    });

    it('coerces single scene object into scenes array', () => {
        const parsed = robustParseJSON('{"scene":{"index":1,"title":"B","beats":[{"index":0}]}}');
        const { data, normalization } = normalizeStagedScenePayload('3b', parsed);

        expect(normalization).toBe('wrapped_single_scene_as_scenes');
        expect(data.scenes).toHaveLength(1);
        expect(() => validateSceneBatchOutput(data, [1])).not.toThrow();
    });

    it('maps alternate casing/pluralization for scene arrays', () => {
        const parsed = robustParseJSON('{"Scenes":[{"index":2,"title":"C","beats":[{"index":0}]}]}');
        const { data, normalization } = normalizeStagedScenePayload('3b', parsed);

        expect(normalization).toBe('mapped_alias_to_scenes');
        expect(data.scenes).toHaveLength(1);
        expect(() => validateSceneBatchOutput(data, [2])).not.toThrow();
    });

    it('coerces root array into scene_plan for staged scene plans', () => {
        const parsed = robustParseJSON('[{"index":0,"title":"A","phase":"setup","purpose":"P"}]');
        const { data, normalization } = normalizeStagedScenePayload('3a', parsed);

        expect(normalization).toBe('wrapped_root_array_as_scene_plan');
        expect(() => validateScenePlanOutput(data)).not.toThrow();
    });

    it('fails clearly on malformed/truncated JSON', () => {
        const parseMalformed = () => robustParseJSON('{"scenes":[{"index":0,"beats":[{"index":0}]');
        expect(parseMalformed).toThrow(SyntaxError);
        expect(parseMalformed).toThrow(/unexpected|expected|unterminated/i);
    });
});
