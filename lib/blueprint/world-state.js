/**
 * World State + Lore Integration helpers
 *
 * Handles:
 * - Runtime world-state continuity tracking
 * - Scene-aware lorebook filtering for prompt injection
 * - Auto lorebook entry generation from summaries and beat completion
 */

const DEFAULT_MAX_LORE_ENTRIES = 6;
const DEFAULT_MAX_LORE_CONTENT = 350;
const DEFAULT_MAX_STATE_EVENTS = 5;

/**
 * Create default world state object
 * @returns {Object}
 */
export function createDefaultWorldState() {
    return {
        version: 1,
        updatedAt: new Date().toISOString(),
        currentLocation: null,
        currentPhase: null,
        ongoingEvents: [],
        characters: {},
        recentBeats: [],
        sceneHistory: [],
    };
}

/**
 * Ensure world-state exists on blueprintState
 * @param {Object} blueprintState
 * @returns {Object}
 */
export function ensureWorldState(blueprintState) {
    blueprintState.worldState ??= createDefaultWorldState();
    blueprintState.worldState.ongoingEvents ??= [];
    blueprintState.worldState.characters ??= {};
    blueprintState.worldState.recentBeats ??= [];
    blueprintState.worldState.sceneHistory ??= [];
    return blueprintState.worldState;
}

/**
 * Track world-state changes from a scene summary
 * @param {Object} blueprintState
 * @param {Object} params
 * @param {number} params.sceneIndex
 * @param {Object} params.scene
 * @param {string} params.summary
 */
export function trackSceneSummaryState(blueprintState, { sceneIndex, scene, summary }) {
    const worldState = ensureWorldState(blueprintState);
    const timestamp = new Date().toISOString();
    const shortSummary = String(summary || '').trim();

    worldState.currentPhase = scene?.phase || worldState.currentPhase;
    worldState.currentLocation = inferLocation(scene, shortSummary) || worldState.currentLocation;
    worldState.updatedAt = timestamp;

    const sceneCharacters = normalizeCharacterFocus(scene);
    sceneCharacters.forEach(name => {
        worldState.characters[name] ??= {};
        worldState.characters[name].lastSeenScene = sceneIndex;
        worldState.characters[name].lastKnownLocation = worldState.currentLocation || worldState.characters[name].lastKnownLocation || null;
    });

    const summarySnippet = shortSummary.slice(0, 260);
    if (summarySnippet) {
        worldState.ongoingEvents.unshift({
            type: 'scene_summary',
            sceneIndex,
            sceneTitle: scene?.title || `Scene ${sceneIndex + 1}`,
            phase: scene?.phase || null,
            summary: summarySnippet,
            timestamp,
        });
    }

    worldState.sceneHistory.unshift({
        sceneIndex,
        sceneTitle: scene?.title || `Scene ${sceneIndex + 1}`,
        phase: scene?.phase || null,
        location: worldState.currentLocation,
        timestamp,
    });

    worldState.ongoingEvents = worldState.ongoingEvents.slice(0, 30);
    worldState.sceneHistory = worldState.sceneHistory.slice(0, 30);
}

/**
 * Track beat completion in world state
 * @param {Object} blueprintState
 * @param {Object} params
 * @param {number} params.sceneIndex
 * @param {number} params.beatIndex
 * @param {string} params.beatTitle
 * @param {Object} params.scene
 */
export function trackBeatCompletionState(blueprintState, { sceneIndex, beatIndex, beatTitle, scene }) {
    const worldState = ensureWorldState(blueprintState);
    const timestamp = new Date().toISOString();
    const signature = `scene:${sceneIndex}:beat:${beatIndex}`;

    if (worldState.recentBeats.some(b => b.signature === signature)) {
        return;
    }

    worldState.recentBeats.unshift({
        signature,
        sceneIndex,
        beatIndex,
        beatTitle: beatTitle || `Beat ${beatIndex + 1}`,
        sceneTitle: scene?.title || `Scene ${sceneIndex + 1}`,
        timestamp,
    });
    worldState.recentBeats = worldState.recentBeats.slice(0, 30);

    worldState.ongoingEvents.unshift({
        type: 'beat_complete',
        sceneIndex,
        beatIndex,
        beatTitle: beatTitle || `Beat ${beatIndex + 1}`,
        sceneTitle: scene?.title || `Scene ${sceneIndex + 1}`,
        timestamp,
    });
    worldState.ongoingEvents = worldState.ongoingEvents.slice(0, 30);
    worldState.updatedAt = timestamp;
}

/**
 * Build world state XML block for prompt injection
 * @param {Object} worldState
 * @param {number} maxEvents
 * @returns {string}
 */
export function buildWorldStateInjection(worldState, maxEvents = DEFAULT_MAX_STATE_EVENTS) {
    if (!worldState) return '';

    const location = worldState.currentLocation ? `<location>${escapeXml(worldState.currentLocation)}</location>` : '';
    const phase = worldState.currentPhase ? `<phase>${escapeXml(worldState.currentPhase)}</phase>` : '';

    const events = (worldState.ongoingEvents || [])
        .slice(0, maxEvents)
        .map(event => {
            if (event.type === 'beat_complete') {
                return `    <event type="beat" scene="${event.sceneIndex + 1}">Completed beat: ${escapeXml(event.beatTitle || '')}</event>`;
            }
            return `    <event type="scene" scene="${event.sceneIndex + 1}">${escapeXml(event.summary || '')}</event>`;
        });

    const characterLines = Object.entries(worldState.characters || {})
        .slice(0, 8)
        .map(([name, state]) => {
            const locationAttr = state?.lastKnownLocation ? ` location="${escapeXml(state.lastKnownLocation)}"` : '';
            return `    <character name="${escapeXml(name)}"${locationAttr}/>`;
        });

    if (!location && !phase && events.length === 0 && characterLines.length === 0) {
        return '';
    }

    return `<world_state>
  <current>${location}${phase}</current>
${characterLines.length ? `  <characters>\n${characterLines.join('\n')}\n  </characters>\n` : ''}${events.length ? `  <recent_events>\n${events.join('\n')}\n  </recent_events>` : ''}
</world_state>`;
}

/**
 * Select relevant lore entries for current scene
 * @param {Object} blueprintState
 * @param {Object} scene
 * @param {Object} options
 * @returns {Array<Object>}
 */
export function selectRelevantLoreEntries(blueprintState, scene, options = {}) {
    const blueprint = blueprintState?.blueprint;
    const entries = blueprint?.embedded_lorebook?.entries;
    if (!Array.isArray(entries) || entries.length === 0) return [];

    const worldState = ensureWorldState(blueprintState);
    const sceneText = [
        scene?.title,
        scene?.situation,
        scene?.purpose,
        scene?.phase,
        blueprint?.setting?.location,
        worldState.currentLocation,
        ...normalizeCharacterFocus(scene),
    ].filter(Boolean).join(' ');

    const keywords = tokenize(sceneText);
    const maxEntries = Math.max(1, parseInt(options.maxEntries ?? DEFAULT_MAX_LORE_ENTRIES, 10) || DEFAULT_MAX_LORE_ENTRIES);

    const scored = entries
        .filter(entry => !entry?.disable)
        .map(entry => ({
            entry,
            score: scoreLoreEntry(entry, keywords),
        }))
        .filter(item => item.score > 0 || entryIsAlwaysOn(item.entry))
        .sort((a, b) => b.score - a.score || (a.entry.order || 100) - (b.entry.order || 100))
        .slice(0, maxEntries)
        .map(item => item.entry);

    return scored;
}

/**
 * Build lore XML block for prompt injection
 * @param {Array<Object>} loreEntries
 * @param {Array<string>} linkedLorebooks
 * @param {Object} options
 * @returns {string}
 */
export function buildLoreInjection(loreEntries = [], linkedLorebooks = [], options = {}) {
    const maxContentLength = Math.max(80, parseInt(options.maxContentLength ?? DEFAULT_MAX_LORE_CONTENT, 10) || DEFAULT_MAX_LORE_CONTENT);
    const itemXml = loreEntries.map(entry => {
        const label = entry.comment || 'Lore Entry';
        const keys = Array.isArray(entry.key) ? entry.key.join(', ') : '';
        const text = String(entry.content || '').trim();
        const clipped = text.length > maxContentLength ? `${text.slice(0, maxContentLength)}...` : text;
        return `  <entry label="${escapeXml(label)}" keys="${escapeXml(keys)}">${escapeXml(clipped)}</entry>`;
    });

    const linkedXml = linkedLorebooks.length > 0
        ? `  <linked>${escapeXml(linkedLorebooks.join(', '))}</linked>`
        : '';

    if (itemXml.length === 0 && !linkedXml) return '';

    return `<lore_context>
${itemXml.join('\n')}
${linkedXml}
</lore_context>`;
}

/**
 * Create and add a lore entry from scene summary
 * @param {Object} blueprintState
 * @param {Object} params
 * @returns {boolean} true if added
 */
export function addLoreEntryFromSceneSummary(blueprintState, { sceneIndex, scene, summary }) {
    const summaryText = String(summary || '').trim();
    if (!summaryText) return false;

    const entry = {
        uid: generateEntryUid(),
        key: buildLoreKeys(scene, summaryText),
        comment: `Scene ${sceneIndex + 1}: ${scene?.title || 'Summary'}`,
        content: summaryText.slice(0, 1200),
        constant: false,
        order: 200 + sceneIndex,
        disable: false,
        extensions: {
            story_mode_generated: true,
            generation_type: 'scene_summary',
            signature: `scene-summary:${sceneIndex}`,
            source_scene_index: sceneIndex,
            generated_at: new Date().toISOString(),
        },
    };

    return addLoreEntryIfMissing(blueprintState, entry);
}

/**
 * Create and add a lore entry from beat completion
 * @param {Object} blueprintState
 * @param {Object} params
 * @returns {boolean}
 */
export function addLoreEntryFromBeatCompletion(blueprintState, { sceneIndex, beatIndex, scene, beatTitle }) {
    const title = beatTitle || `Beat ${beatIndex + 1}`;
    const sceneTitle = scene?.title || `Scene ${sceneIndex + 1}`;
    const content = `During ${sceneTitle}, beat ${beatIndex + 1} ("${title}") was completed, advancing the scenario.`;

    const entry = {
        uid: generateEntryUid(),
        key: buildLoreKeys(scene, `${sceneTitle} ${title}`).slice(0, 6),
        comment: `Beat ${beatIndex + 1}: ${title}`,
        content,
        constant: false,
        order: 300 + sceneIndex,
        disable: false,
        extensions: {
            story_mode_generated: true,
            generation_type: 'beat_completion',
            signature: `beat:${sceneIndex}:${beatIndex}`,
            source_scene_index: sceneIndex,
            source_beat_index: beatIndex,
            generated_at: new Date().toISOString(),
        },
    };

    return addLoreEntryIfMissing(blueprintState, entry);
}

function addLoreEntryIfMissing(blueprintState, entry) {
    const settings = blueprintState?.blueprint;
    if (!settings) return false;

    const lorebook = ensureEmbeddedLorebook(blueprintState.blueprint);
    lorebook.entries ??= [];

    const signature = entry?.extensions?.signature;
    const exists = signature
        ? lorebook.entries.some(e => e?.extensions?.signature === signature)
        : lorebook.entries.some(e => e.comment === entry.comment && e.content === entry.content);

    if (exists) return false;

    lorebook.entries.push(entry);
    return true;
}

function ensureEmbeddedLorebook(blueprint) {
    blueprint.embedded_lorebook ??= {
        name: 'Story Mode Auto Lorebook',
        entries: [],
        metadata: {
            source_worlds: ['story-mode-generated'],
            selected_at_generation: false,
            generation_timestamp: new Date().toISOString(),
        },
    };
    return blueprint.embedded_lorebook;
}

function scoreLoreEntry(entry, keywords) {
    const keys = Array.isArray(entry?.key) ? entry.key.join(' ').toLowerCase() : '';
    const label = String(entry?.comment || '').toLowerCase();
    const content = String(entry?.content || '').toLowerCase();

    let score = 0;
    for (const token of keywords) {
        if (keys.includes(token)) score += 4;
        if (label.includes(token)) score += 2;
        if (content.includes(token)) score += 1;
    }
    return score;
}

function entryIsAlwaysOn(entry) {
    return entry?.constant === true;
}

function tokenize(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(token => token.length >= 3)
        .slice(0, 120);
}

function buildLoreKeys(scene, text) {
    const base = [
        scene?.title,
        scene?.phase,
        scene?.purpose,
        ...normalizeCharacterFocus(scene),
        ...tokenize(text).slice(0, 4),
    ].filter(Boolean);

    const uniq = [];
    for (const item of base) {
        const normalized = String(item).trim();
        if (!normalized) continue;
        if (!uniq.some(existing => existing.toLowerCase() === normalized.toLowerCase())) {
            uniq.push(normalized);
        }
    }
    return uniq.slice(0, 8);
}

function normalizeCharacterFocus(scene) {
    const focus = Array.isArray(scene?.character_focus) ? scene.character_focus : [];
    return focus
        .map(item => {
            if (typeof item === 'string') return item;
            return item?.name || item?.character_name || null;
        })
        .filter(Boolean);
}

function inferLocation(scene, summary) {
    const explicit = scene?.setting?.location || scene?.location;
    if (explicit) return explicit;

    const text = String(summary || '');
    const match = text.match(/\b(?:at|in|inside|within)\s+([A-Z][A-Za-z0-9' -]{2,40})/);
    return match ? match[1].trim() : null;
}

function generateEntryUid() {
    return Math.floor(Date.now() + Math.random() * 10000);
}

function escapeXml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
