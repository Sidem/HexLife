import * as PersistenceService from '../../services/PersistenceService.js';
import { EventBus, EVENTS } from '../../services/EventBus.js';

export class RulesetActionController {
    constructor() {
        this.#registerActionHandlers();
    }

    #registerActionHandlers = () => {
        EventBus.subscribe(EVENTS.COMMAND_EXECUTE_GENERATE_RULESET, () => {
            const bias = this.getUseCustomBias() ? this.getBias() : Math.random();
            EventBus.dispatch(EVENTS.COMMAND_GENERATE_RANDOM_RULESET, {
                bias,
                generationMode: this.getGenMode(),
                applyScope: this.getGenScope(),
                shouldReset: this.getGenAutoReset()
            });
        });

        EventBus.subscribe(EVENTS.COMMAND_EXECUTE_MUTATE_RULESET, () => {
            EventBus.dispatch(EVENTS.COMMAND_MUTATE_RULESET, {
                mutationRate: this.getMutateRate() / 100.0,
                scope: this.getMutateScope(),
                mode: this.getMutateMode()
            });
        });

        EventBus.subscribe(EVENTS.COMMAND_EXECUTE_CLONE_AND_MUTATE, () => {
            EventBus.dispatch(EVENTS.COMMAND_CLONE_AND_MUTATE, {
                mutationRate: this.getMutateRate() / 100.0,
                mode: this.getMutateMode(),
                ensureMutation: this.getEnsureMutation()
            });
        });

        EventBus.subscribe(EVENTS.COMMAND_EXECUTE_BREED_WORLDS, () => {
            EventBus.dispatch(EVENTS.COMMAND_BREED_WORLDS, {
                mode: this.getBreedMode(),
                postMutationRate: this.getBreedMutationRate() / 100.0
            });
        });
    }

    getGenMode = () => PersistenceService.loadUISetting('rulesetGenerationMode', 'r_sym');
    getBias = () => PersistenceService.loadUISetting('biasValue', 0.33);
    getUseCustomBias = () => PersistenceService.loadUISetting('useCustomBias', true);
    getGenScope = () => PersistenceService.loadUISetting('globalRulesetScopeAll', true) ? 'all' : 'selected';
    getGenAutoReset = () => PersistenceService.loadUISetting('resetOnNewRule', true);
    getMutateRate = () => PersistenceService.loadUISetting('mutationRate', 1);
    getMutateMode = () => PersistenceService.loadUISetting('mutateMode', 'single');
    getMutateScope = () => PersistenceService.loadUISetting('mutateScope', 'selected');
    getEnsureMutation = () => PersistenceService.loadUISetting('ensureMutation', true);
    getBreedMode = () => PersistenceService.loadUISetting('breedMode', 'r_sym');
    getBreedMutationRate = () => PersistenceService.loadUISetting('breedMutationRate', 1);

    getGenerationConfig() {
        return [
            { value: 'random', text: 'Random' },
            { value: 'n_count', text: 'N-Count' },
            { value: 'totalistic', text: 'Totalistic' },
            { value: 'r_sym', text: 'R-Sym' }
        ];
    }

    getMutationModeConfig() {
        return [
            { value: 'single', text: 'Single' },
            { value: 'r_sym', text: 'R-Sym' },
            { value: 'n_count', text: 'N-Count' },
            { value: 'totalistic', text: 'Totalistic' }
        ];
    }

    getMutationScopeConfig() {
        return [
            { value: 'selected', text: 'Selected' },
            { value: 'all', text: 'All' }
        ];
    }

    getBreedModeConfig() {
        return [
            { value: 'uniform', text: 'Uniform' },
            { value: 'r_sym', text: 'R-Sym' },
            { value: 'n_count', text: 'N-Count' },
            { value: 'totalistic', text: 'Totalistic' }
        ];
    }

    getBreedMutationRateSliderConfig() {
        return {
            label: 'Offspring Mutation:',
            min: 0,
            max: 50,
            step: 1,
            unit: '%',
            showValue: true,
            onChange: this.setBreedMutationRate
        };
    }

    getMutationRateSliderConfig() {
        return {
            label: 'Mutation Rate:',
            min: 1,
            max: 50,
            step: 1,
            unit: '%',
            showValue: true,
            onChange: this.setMutateRate
        };
    }

    getBiasSliderConfig() {
        return {
            label: 'Bias:',
            min: 0,
            max: 1,
            step: 0.001,
            unit: '',
            showValue: true,
            onChange: this.setBias
        };
    }

    getGenScopeSwitchConfig() {
        return {
            label: 'Apply to:',
            type: 'radio',
            name: 'rulesetScope', 
            items: [
                { value: 'selected', text: 'Selected' },
                { value: 'all', text: 'All' }
            ],
            onChange: this.setGenScope
        };
    }

    getGenAutoResetSwitchConfig() {
        return {
            type: 'checkbox',
            name: 'resetOnNewRule', 
            items: [{ value: 'reset', text: 'Auto-Reset World(s)' }],
            onChange: this.setGenAutoReset
        };
    }
    
    setGenMode = (mode) => PersistenceService.saveUISetting('rulesetGenerationMode', mode);
    setBias = (bias) => PersistenceService.saveUISetting('biasValue', bias);
    setUseCustomBias = (useCustom) => PersistenceService.saveUISetting('useCustomBias', useCustom);
    setGenScope = (scope) => PersistenceService.saveUISetting('globalRulesetScopeAll', scope === 'all');
    setGenAutoReset = (shouldReset) => PersistenceService.saveUISetting('resetOnNewRule', shouldReset);
    setMutateRate = (rate) => PersistenceService.saveUISetting('mutationRate', rate);
    setMutateMode = (mode) => PersistenceService.saveUISetting('mutateMode', mode);
    setMutateScope = (scope) => PersistenceService.saveUISetting('mutateScope', scope);
    setEnsureMutation = (shouldEnsure) => PersistenceService.saveUISetting('ensureMutation', shouldEnsure);
    setBreedMode = (mode) => PersistenceService.saveUISetting('breedMode', mode);
    setBreedMutationRate = (rate) => PersistenceService.saveUISetting('breedMutationRate', rate);
} 