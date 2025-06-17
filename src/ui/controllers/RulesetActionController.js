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
        
        this.#registerActionHandlers();
    }

    #registerActionHandlers = () => {
        EventBus.subscribe(EVENTS.COMMAND_EXECUTE_GENERATE_RULESET, () => {
            const state = this.getState();
            const bias = state.useCustomBias ? state.bias : Math.random();
            EventBus.dispatch(EVENTS.COMMAND_GENERATE_RANDOM_RULESET, {
                bias,
                generationMode: state.genMode,
                applyScope: state.genScope,
                shouldReset: state.genAutoReset
            });
        });

        EventBus.subscribe(EVENTS.COMMAND_EXECUTE_MUTATE_RULESET, () => {
            const state = this.getState();
            EventBus.dispatch(EVENTS.COMMAND_MUTATE_RULESET, {
                mutationRate: state.mutateRate / 100.0,
                scope: state.mutateScope,
                mode: state.mutateMode
            });
        });

        EventBus.subscribe(EVENTS.COMMAND_EXECUTE_CLONE_AND_MUTATE, () => {
            const state = this.getState();
            EventBus.dispatch(EVENTS.COMMAND_CLONE_AND_MUTATE, {
                mutationRate: state.mutateRate / 100.0,
                mode: state.mutateMode
            });
        });
    }

    getState() {
        return { ...this.state };
    }

    getGenerationConfig() {
        return [
            { value: 'random', text: 'Random' },
            { value: 'n_count', text: 'N-Count' },
            { value: 'r_sym', text: 'R-Sym' }
        ];
    }

    getMutationModeConfig() {
        return [
            { value: 'single', text: 'Single' },
            { value: 'r_sym', text: 'R-Sym' },
            { value: 'n_count', text: 'N-Count' }
        ];
    }

    getMutationScopeConfig() {
        return [
            { value: 'selected', text: 'Selected' },
            { value: 'all', text: 'All' }
        ];
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


} 