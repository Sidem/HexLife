import * as PersistenceService from '../../services/PersistenceService.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class RulesetActionController {
    constructor() {
        this.state = {
            genMode: PersistenceService.loadUISetting('rulesetGenerationMode', 'r_sym'),
            bias: PersistenceService.loadUISetting('biasValue', 0.33),
            useCustomBias: PersistenceService.loadUISetting('useCustomBias', true),
            genScope: PersistenceService.loadUISetting('globalRulesetScopeAll', true) ? 'all' : 'selected',
            genAutoReset: PersistenceService.loadUISetting('resetOnNewRule', true),
            mutateRate: PersistenceService.loadUISetting('mutationRate', 1),
            mutateMode: PersistenceService.loadUISetting('mutateMode', 'single'),
            mutateScope: PersistenceService.loadUISetting('mutateScope', 'selected'),
        };
    }

    getState() {
        return { ...this.state };
    }
    
    setGenMode = (mode) => {
        this.state.genMode = mode;
        PersistenceService.saveUISetting('rulesetGenerationMode', mode);
    }

    setBias = (bias) => {
        this.state.bias = bias;
        PersistenceService.saveUISetting('biasValue', bias);
    }

    setUseCustomBias = (useCustom) => {
        this.state.useCustomBias = useCustom;
        PersistenceService.saveUISetting('useCustomBias', useCustom);
    }

    setGenScope = (scope) => {
        this.state.genScope = scope;
        PersistenceService.saveUISetting('globalRulesetScopeAll', scope === 'all');
    }

    setGenAutoReset = (shouldReset) => {
        this.state.genAutoReset = shouldReset;
        PersistenceService.saveUISetting('resetOnNewRule', shouldReset);
    }

    setMutateRate = (rate) => {
        this.state.mutateRate = rate;
        PersistenceService.saveUISetting('mutationRate', rate);
    }

    setMutateMode = (mode) => {
        this.state.mutateMode = mode;
        PersistenceService.saveUISetting('mutateMode', mode);
    }

    setMutateScope = (scope) => {
        this.state.mutateScope = scope;
        PersistenceService.saveUISetting('mutateScope', scope);
    }

    
    generate() {
        const bias = this.state.useCustomBias ? this.state.bias : Math.random();
        EventBus.dispatch(EVENTS.COMMAND_GENERATE_RANDOM_RULESET, {
            bias,
            generationMode: this.state.genMode,
            resetScopeForThisChange: this.state.genAutoReset ? this.state.genScope : 'none'
        });
    }

    mutate() {
        EventBus.dispatch(EVENTS.COMMAND_MUTATE_RULESET, {
            mutationRate: this.state.mutateRate / 100.0,
            scope: this.state.mutateScope,
            mode: this.state.mutateMode
        });
    }

    cloneAndMutate() {
        EventBus.dispatch(EVENTS.COMMAND_CLONE_AND_MUTATE, {
            mutationRate: this.state.mutateRate / 100.0,
            mode: this.state.mutateMode
        });
    }
} 