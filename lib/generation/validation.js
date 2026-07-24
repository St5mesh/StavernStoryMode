/**
 * Validation helpers for blueprint generation
 * @module generation/validation
 */

/**
 * Validate that a phase result is safe to merge
 */
export function validatePhaseResult(phaseResult, phase) {
    if (!phaseResult || typeof phaseResult !== 'object') {
        throw new Error(`Phase ${phase}: Invalid result - expected object, got ${typeof phaseResult}`);
    }

    if (Array.isArray(phaseResult)) {
        throw new Error(`Phase ${phase}: Invalid result - expected object, got array`);
    }

    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    for (const key of dangerousKeys) {
        if (Object.prototype.hasOwnProperty.call(phaseResult, key)) {
            throw new Error(`Phase ${phase}: Invalid result - dangerous key "${key}" detected`);
        }
    }

    return phaseResult;
}

/**
 * Validate phase output data
 */
export function validatePhaseOutput(phase, data) {
    if (!data || typeof data !== 'object') {
        throw new Error('Output must be an object');
    }

    if (phase === 3) {
        if (!Array.isArray(data.scene_plan) || data.scene_plan.length === 0) {
            throw new Error('Response missing or empty "scene_plan" array');
        }

        data.scene_plan.forEach((scene, i) => {
            if (!Array.isArray(scene.beats) || scene.beats.length === 0) {
                const title = scene.title || 'Untitled';
                throw new Error(`Scene ${i + 1} ("${title}") missing "beats" array. Every scene must have at least 3 beats.`);
            }
        });
    }

    if (phase === 4) {
        if (!data.primary_ending) throw new Error('Response missing "primary_ending"');
        if (!data.blueprint_title && !data.title) throw new Error('Response missing "blueprint_title"');
    }

    return true;
}

/**
 * Get scene identifier for error messages
 * @param {Object} scene - Scene object
 * @param {number} index - Scene index
 * @returns {string} Human-readable identifier
 */
function getSceneIdentifier(scene, index) {
    return scene.title ? `("${scene.title}")` : index;
}

/**
 * Get object value by case-insensitive key match
 * Returns the first matching property value for any candidate key.
 * @param {Object} obj
 * @param {string[]} keyCandidates
 * @returns {*}
 */
function getCaseInsensitiveValue(obj, keyCandidates) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
    const entries = Object.entries(obj);
    for (const candidate of keyCandidates) {
        const match = entries.find(([key]) => key.toLowerCase() === candidate.toLowerCase());
        if (match) return match[1];
    }
    return undefined;
}

/**
 * Deterministically normalize near-miss staged payloads before strict validation.
 * Applies only safe shape coercions; does not invent scene content.
 * @param {'3a'|'3b'} subPhase
 * @param {*} parsedData
 * @returns {{ data: *, normalization: string|null }}
 */
export function normalizeStagedScenePayload(subPhase, parsedData) {
    if (subPhase === '3a') {
        if (Array.isArray(parsedData)) {
            return { data: { scene_plan: parsedData }, normalization: 'wrapped_root_array_as_scene_plan' };
        }

        if (!parsedData || typeof parsedData !== 'object') {
            return { data: parsedData, normalization: null };
        }

        if (Array.isArray(parsedData.scene_plan)) {
            return { data: parsedData, normalization: null };
        }

        const planAliases = ['scenePlan', 'scenePlans', 'scene_plans', 'scene_outlines', 'sceneOutline', 'scenes'];
        const aliasedPlan = getCaseInsensitiveValue(parsedData, planAliases);
        if (Array.isArray(aliasedPlan)) {
            return { data: { ...parsedData, scene_plan: aliasedPlan }, normalization: 'mapped_alias_to_scene_plan' };
        }

        const singleScene = getCaseInsensitiveValue(parsedData, ['scene']);
        if (singleScene && typeof singleScene === 'object' && !Array.isArray(singleScene)) {
            return { data: { ...parsedData, scene_plan: [singleScene] }, normalization: 'wrapped_single_scene_as_scene_plan' };
        }

        return { data: parsedData, normalization: null };
    }

    if (Array.isArray(parsedData)) {
        return { data: { scenes: parsedData }, normalization: 'wrapped_root_array_as_scenes' };
    }

    if (!parsedData || typeof parsedData !== 'object') {
        return { data: parsedData, normalization: null };
    }

    if (Array.isArray(parsedData.scenes)) {
        return { data: parsedData, normalization: null };
    }

    const sceneAliases = ['scene_list', 'sceneList', 'scene_batch', 'sceneBatch', 'scene_data'];
    const aliasedScenes = getCaseInsensitiveValue(parsedData, ['scenes', ...sceneAliases]);
    if (Array.isArray(aliasedScenes)) {
        return { data: { ...parsedData, scenes: aliasedScenes }, normalization: 'mapped_alias_to_scenes' };
    }

    const singleScene = getCaseInsensitiveValue(parsedData, ['scene']);
    if (singleScene && typeof singleScene === 'object' && !Array.isArray(singleScene)) {
        return { data: { ...parsedData, scenes: [singleScene] }, normalization: 'wrapped_single_scene_as_scenes' };
    }

    return { data: parsedData, normalization: null };
}

/**
 * Validate scene plan output (Phase 3a - lightweight outlines)
 * @param {Object} data - Parsed JSON output
 * @returns {boolean} True if valid
 * @throws {Error} If validation fails
 */
export function validateScenePlanOutput(data) {
    if (!data || typeof data !== 'object') {
        throw new Error('Scene plan output must be an object');
    }
    if (!Array.isArray(data.scene_plan) || data.scene_plan.length === 0) {
        throw new Error('Scene plan missing or empty "scene_plan" array');
    }

    const requiredFields = ['title', 'phase', 'purpose'];
    data.scene_plan.forEach((scene, i) => {
        const missing = requiredFields.find(field => !scene[field]);
        if (missing) {
            throw new Error(`Scene plan outline ${getSceneIdentifier(scene, i)} missing "${missing}"`);
        }
    });

    return true;
}

/**
 * Validate scene batch output (Phase 3b..3n - full detail)
 * @param {Object} data - Parsed JSON output
 * @param {Array<number>} expectedIndices - Expected scene indices
 * @returns {boolean} True if valid
 * @throws {Error} If validation fails
 */
export function validateSceneBatchOutput(data, expectedIndices) {
    if (!data || typeof data !== 'object') {
        throw new Error('Scene batch output must be an object');
    }
    if (!Array.isArray(data.scenes) || data.scenes.length === 0) {
        throw new Error('Scene batch missing or empty "scenes" array');
    }

    data.scenes.forEach((scene, i) => {
        if (!Array.isArray(scene.beats) || scene.beats.length === 0) {
            throw new Error(`Batch scene ${i} ${getSceneIdentifier(scene, i)} missing "beats" array`);
        }
    });

    // Warn (but don't throw) if indices don't match expected
    if (expectedIndices?.length) {
        const actualIndices = data.scenes.map(s => s.index);
        const missing = expectedIndices.filter(idx => !actualIndices.includes(idx));
        if (missing.length > 0) {
            console.warn(`[Story Mode] Scene batch: expected indices ${expectedIndices}, got ${actualIndices}. Missing: ${missing}`);
        }
    }

    return true;
}

// Backward-compatible aliases retained to prevent runtime import mismatches in Scenes flow.
// Keep these aliases unless all external callers are updated to normalizeStagedScenePayload.
export const normalizeStagedPayload = normalizeStagedScenePayload;
export const normalizeScenePayload = normalizeStagedScenePayload;
