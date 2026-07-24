import { robustParseJSON, extractFirstJsonObject } from '../blueprint/utils.js';
import * as sceneValidation from './validation.js';

function getStagedValidationHelpers() {
    const validateScenePlanOutput = sceneValidation.validateScenePlanOutput;
    const validateSceneBatchOutput = sceneValidation.validateSceneBatchOutput;
    const normalizeStagedScenePayload = sceneValidation.normalizeStagedScenePayload
        || sceneValidation.normalizeStagedPayload
        || sceneValidation.normalizeScenePayload;

    if (typeof validateScenePlanOutput !== 'function' || typeof validateSceneBatchOutput !== 'function') {
        throw new Error('Staged scenes validation contract error: expected scene validators are not exported from lib/generation/validation.js');
    }

    if (typeof normalizeStagedScenePayload !== 'function') {
        throw new Error('Staged scenes validation contract error: expected normalizeStagedScenePayload export from lib/generation/validation.js');
    }

    return {
        validateScenePlanOutput,
        validateSceneBatchOutput,
        normalizeStagedScenePayload,
    };
}

/**
 * Parse and validate a staged phase response
 * @param {string} subPhase - '3a' or '3b'
 * @param {string} rawText - Raw LLM response
 * @param {number} maxTokens - Token budget used
 * @param {Array<number>} [expectedIndices] - Expected indices for batch validation
 * @returns {Object} Parsed data
 */
export function parseStagedResponse(subPhase, rawText, maxTokens, expectedIndices) {
    const createError = (message) => {
        const error = new Error(message);
        error.tokensUsed = maxTokens;
        return error;
    };

    if (!rawText?.trim()) {
        throw createError(`Staged ${subPhase}: Empty response (${maxTokens} tokens)`);
    }

    const trimmed = rawText.trim();
    const extracted = extractFirstJsonObject(trimmed);
    const extractionFoundBalancedJson = extracted !== null;
    const extractedLength = extracted?.length || 0;
    const startPreview = trimmed.slice(0, 80).replace(/\s+/g, ' ');
    const endPreview = trimmed.slice(-80).replace(/\s+/g, ' ');

    let data;
    try {
        data = robustParseJSON(rawText);
    } catch (jsonParseError) {
        console.error(`[Story Mode] Staged ${subPhase} parse diagnostics`, {
            extractedLength,
            extractionFoundBalancedJson,
            jsonParseReason: jsonParseError.message,
            schemaValidationReason: null,
            previewStart: startPreview,
            previewEnd: endPreview,
        });
        throw createError(`Staged ${subPhase}: Failed to parse JSON - JSON.parse: ${jsonParseError.message}`);
    }

    const { validateScenePlanOutput, validateSceneBatchOutput, normalizeStagedScenePayload } = getStagedValidationHelpers();
    const validator = subPhase === '3a' ? validateScenePlanOutput : validateSceneBatchOutput;
    const { data: normalizedData, normalization } = normalizeStagedScenePayload(subPhase, data);

    try {
        validator(normalizedData, expectedIndices);
        return normalizedData;
    } catch (validationError) {
        console.error(`[Story Mode] Staged ${subPhase} parse diagnostics`, {
            extractedLength,
            extractionFoundBalancedJson,
            jsonParseReason: null,
            schemaValidationReason: validationError.message,
            normalization,
            previewStart: startPreview,
            previewEnd: endPreview,
        });
        throw createError(`Staged ${subPhase}: Failed to parse JSON - ${validationError.message}`);
    }
}
